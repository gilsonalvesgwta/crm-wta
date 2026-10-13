-- 0004_crm
-- CRM comercial: contatos, organizações, etiquetas, campos personalizados, notas,
-- linha do tempo, consentimento, origem, funis, negócios, produtos, leads,
-- distribuição, atividades, notificações, arquivos, importação e exportação.
-- Compatível com PostgreSQL 16 ou superior.

-- Extensões: busca por semelhança e sem acentos. Ficam em public e são
-- criadas antes da troca de papel, porque exigem superusuário.
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- O despachante (lembretes, importações) roda fora do contexto de empresa só
-- para escolher o próximo item. O papel de login da API pode assumi-lo.
do $$
begin
  if exists (select from pg_roles where rolname = 'crm_api') then
    grant crm_dispatch to crm_api;
  end if;
end
$$;

set local role crm_owner;

-- Texto normalizado para busca: minúsculas e sem acentos. Imutável para poder
-- entrar em índice.
create function app.norm(p text) returns text
language sql immutable parallel safe
set search_path = pg_catalog, public
as $$
  select lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p, '')))
$$;

-- ---------------------------------------------------------------------------
-- Organizações e contatos
-- ---------------------------------------------------------------------------

create table organizations (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 1 and 200),
  legal_name           text check (legal_name is null or length(legal_name) <= 200),
  tax_id               text check (tax_id is null or tax_id ~ '^[0-9A-Za-z./-]{1,30}$'),
  domain               text check (domain is null or (domain = lower(domain) and domain ~ '^[a-z0-9.-]{3,253}$')),
  website              text check (website is null or length(website) <= 500),
  email                text check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$')),
  phone                text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  industry             text check (industry is null or length(industry) <= 120),
  address              jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  owner_membership_id  uuid,
  team_id              uuid,
  custom               jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
  created_by           uuid,
  last_activity_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, owner_membership_id) references memberships (tenant_id, id) on delete set null (owner_membership_id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index organizations_name_trgm on organizations using gin (app.norm(name) gin_trgm_ops);
create index organizations_tenant_name_idx on organizations (tenant_id, lower(name));
create index organizations_tenant_owner_idx on organizations (tenant_id, owner_membership_id);
create index organizations_tenant_domain_idx on organizations (tenant_id, domain) where domain is not null;
create trigger organizations_updated_at before update on organizations
  for each row execute function app.set_updated_at();

create table contacts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  first_name           text not null check (length(btrim(first_name)) between 1 and 120),
  last_name            text check (last_name is null or length(last_name) <= 120),
  name                 text generated always as (btrim(first_name || ' ' || coalesce(last_name, ''))) stored,
  job_title            text check (job_title is null or length(job_title) <= 120),
  organization_id      uuid,
  tax_id               text check (tax_id is null or tax_id ~ '^[0-9A-Za-z./-]{1,30}$'),
  -- Aniversário sem ano é comum; o ano fica opcional.
  birth_day            smallint check (birth_day between 1 and 31),
  birth_month          smallint check (birth_month between 1 and 12),
  birth_year           smallint check (birth_year between 1900 and 2100),
  address              jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  owner_membership_id  uuid,
  team_id              uuid,
  custom               jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
  created_by           uuid,
  last_activity_at     timestamptz,
  anonymized_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  check ((birth_day is null) = (birth_month is null)),
  check (birth_year is null or birth_day is not null),
  check (birth_day is null or make_date(coalesce(birth_year::int, 2000), birth_month, birth_day) is not null),
  foreign key (tenant_id, organization_id) references organizations (tenant_id, id) on delete set null (organization_id),
  foreign key (tenant_id, owner_membership_id) references memberships (tenant_id, id) on delete set null (owner_membership_id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index contacts_name_trgm on contacts using gin (app.norm(first_name || ' ' || coalesce(last_name, '')) gin_trgm_ops);
create index contacts_tenant_created_idx on contacts (tenant_id, created_at desc, id);
create index contacts_tenant_name_idx on contacts (tenant_id, lower(first_name), lower(last_name));
create index contacts_tenant_owner_idx on contacts (tenant_id, owner_membership_id);
create index contacts_tenant_team_idx on contacts (tenant_id, team_id);
create index contacts_tenant_org_idx on contacts (tenant_id, organization_id);
create index contacts_tenant_birthday_idx on contacts (tenant_id, birth_month, birth_day) where birth_day is not null;
create trigger contacts_updated_at before update on contacts
  for each row execute function app.set_updated_at();

create table contact_emails (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  contact_id  uuid not null,
  email       text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  label       text not null default 'work' check (label in ('work', 'personal', 'other')),
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (contact_id, email),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade
);
create index contact_emails_tenant_email_idx on contact_emails (tenant_id, email);
create unique index contact_emails_one_primary on contact_emails (contact_id) where is_primary;

create table contact_phones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  contact_id  uuid not null,
  e164        text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label       text not null default 'mobile' check (label in ('mobile', 'whatsapp', 'work', 'home', 'other')),
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (contact_id, e164),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade
);
create index contact_phones_tenant_e164_idx on contact_phones (tenant_id, e164);
create unique index contact_phones_one_primary on contact_phones (contact_id) where is_primary;

-- ---------------------------------------------------------------------------
-- Etiquetas e campos personalizados
-- ---------------------------------------------------------------------------

create table tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  color       text not null default '#64748B' check (color ~ '^#[0-9A-F]{6}$'),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index tags_tenant_name_uq on tags (tenant_id, lower(name));

create table contact_tags (
  tenant_id   uuid not null,
  contact_id  uuid not null,
  tag_id      uuid not null,
  primary key (contact_id, tag_id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references tags (tenant_id, id) on delete cascade
);
create index contact_tags_tenant_tag_idx on contact_tags (tenant_id, tag_id);

create table organization_tags (
  tenant_id        uuid not null,
  organization_id  uuid not null,
  tag_id           uuid not null,
  primary key (organization_id, tag_id),
  foreign key (tenant_id, organization_id) references organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references tags (tenant_id, id) on delete cascade
);
create index organization_tags_tenant_tag_idx on organization_tags (tenant_id, tag_id);

create table custom_field_definitions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  entity       text not null check (entity in ('contact', 'organization', 'deal', 'lead')),
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (length(btrim(label)) between 1 and 80),
  type         text not null check (type in ('text', 'long_text', 'number', 'currency', 'date', 'boolean', 'select', 'multi_select', 'url', 'email', 'phone')),
  options      jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required     boolean not null default false,
  position     integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, entity, key)
);

-- ---------------------------------------------------------------------------
-- Funis, etapas, produtos e motivos
-- ---------------------------------------------------------------------------

create table pipelines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  position     integer not null default 0,
  currency     text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  -- Funil restrito: só quem está em pipeline_access (pessoa ou equipe) enxerga.
  restricted   boolean not null default false,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index pipelines_tenant_name_uq on pipelines (tenant_id, lower(name));
create trigger pipelines_updated_at before update on pipelines
  for each row execute function app.set_updated_at();

create table pipeline_access (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  pipeline_id    uuid not null,
  team_id        uuid,
  membership_id  uuid,
  check (num_nonnulls(team_id, membership_id) = 1),
  foreign key (tenant_id, pipeline_id) references pipelines (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade
);
create unique index pipeline_access_team_uq on pipeline_access (pipeline_id, team_id) where team_id is not null;
create unique index pipeline_access_member_uq on pipeline_access (pipeline_id, membership_id) where membership_id is not null;
create index pipeline_access_tenant_idx on pipeline_access (tenant_id);

create table pipeline_stages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  pipeline_id      uuid not null,
  name             text not null check (length(btrim(name)) between 1 and 80),
  position         integer not null default 0,
  color            text not null default '#64748B' check (color ~ '^#[0-9A-F]{6}$'),
  probability      smallint not null default 0 check (probability between 0 and 100),
  kind             text not null default 'open' check (kind in ('open', 'won', 'lost')),
  -- Campos exigidos para entrar na etapa: value, expected_close_date, contact,
  -- organization, products ou custom.<chave>.
  required_fields  text[] not null default '{}',
  -- Dias sem atividade até o negócio ser marcado como parado.
  rotting_days     integer check (rotting_days is null or rotting_days between 1 and 365),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, pipeline_id, id),
  foreign key (tenant_id, pipeline_id) references pipelines (tenant_id, id) on delete cascade
);
create index pipeline_stages_pipeline_idx on pipeline_stages (tenant_id, pipeline_id, position);

-- Transições permitidas. Uma etapa sem regra pode ir para qualquer outra do
-- mesmo funil; com regras, só para as listadas.
create table stage_transition_rules (
  tenant_id      uuid not null,
  pipeline_id    uuid not null,
  from_stage_id  uuid not null,
  to_stage_id    uuid not null,
  primary key (from_stage_id, to_stage_id),
  check (from_stage_id <> to_stage_id),
  foreign key (tenant_id, pipeline_id, from_stage_id) references pipeline_stages (tenant_id, pipeline_id, id) on delete cascade,
  foreign key (tenant_id, pipeline_id, to_stage_id) references pipeline_stages (tenant_id, pipeline_id, id) on delete cascade
);
create index stage_transition_rules_tenant_idx on stage_transition_rules (tenant_id, pipeline_id);

create table products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 160),
  sku          text check (sku is null or sku ~ '^[A-Za-z0-9._/-]{1,60}$'),
  description  text check (description is null or length(description) <= 2000),
  price_cents  bigint not null default 0 check (price_cents >= 0),
  currency     text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index products_tenant_sku_uq on products (tenant_id, lower(sku)) where sku is not null;
create index products_tenant_name_idx on products (tenant_id, lower(name));
create trigger products_updated_at before update on products
  for each row execute function app.set_updated_at();

create table outcome_reasons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  kind        text not null check (kind in ('won', 'lost')),
  name        text not null check (length(btrim(name)) between 1 and 120),
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index outcome_reasons_tenant_name_uq on outcome_reasons (tenant_id, kind, lower(name));

-- ---------------------------------------------------------------------------
-- Leads e distribuição
-- ---------------------------------------------------------------------------

create table leads (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  contact_id           uuid not null,
  title                text not null check (length(btrim(title)) between 1 and 200),
  status               text not null default 'new' check (status in ('new', 'working', 'qualified', 'disqualified')),
  source               text check (source is null or length(source) <= 120),
  owner_membership_id  uuid,
  team_id              uuid,
  disqualify_reason    text check (disqualify_reason is null or length(disqualify_reason) <= 500),
  deal_id              uuid,
  assigned_at          timestamptz,
  qualified_at         timestamptz,
  custom               jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
  created_by           uuid,
  last_activity_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, owner_membership_id) references memberships (tenant_id, id) on delete set null (owner_membership_id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index leads_tenant_status_idx on leads (tenant_id, status, created_at desc);
create index leads_tenant_owner_idx on leads (tenant_id, owner_membership_id);
create index leads_tenant_team_idx on leads (tenant_id, team_id);
create index leads_tenant_contact_idx on leads (tenant_id, contact_id);
create trigger leads_updated_at before update on leads
  for each row execute function app.set_updated_at();

-- Rodízio: o primeiro roteiro ativo que combina com o lead escolhe o próximo
-- membro da lista. A linha do roteiro é travada durante a escolha, então
-- entradas simultâneas não pegam o mesmo membro.
create table assignment_rules (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 120),
  active         boolean not null default true,
  position       integer not null default 0,
  source_filter  text check (source_filter is null or length(source_filter) <= 120),
  team_id        uuid,
  last_position  integer not null default -1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id)
);
create trigger assignment_rules_updated_at before update on assignment_rules
  for each row execute function app.set_updated_at();

create table assignment_rule_members (
  tenant_id      uuid not null,
  rule_id        uuid not null,
  membership_id  uuid not null,
  position       integer not null,
  primary key (rule_id, membership_id),
  unique (rule_id, position),
  foreign key (tenant_id, rule_id) references assignment_rules (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade
);
create index assignment_rule_members_tenant_idx on assignment_rule_members (tenant_id);

-- ---------------------------------------------------------------------------
-- Negócios
-- ---------------------------------------------------------------------------

create table deals (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  pipeline_id          uuid not null,
  stage_id             uuid not null,
  title                text not null check (length(btrim(title)) between 1 and 200),
  value_cents          bigint not null default 0 check (value_cents >= 0),
  currency             text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  -- Mantido pelo gatilho a partir do tipo da etapa.
  status               text not null default 'open' check (status in ('open', 'won', 'lost')),
  contact_id           uuid,
  organization_id      uuid,
  lead_id              uuid,
  owner_membership_id  uuid,
  team_id              uuid,
  outcome_reason_id    uuid,
  outcome_note         text check (outcome_note is null or length(outcome_note) <= 1000),
  expected_close_date  date,
  stage_entered_at     timestamptz not null default now(),
  closed_at            timestamptz,
  custom               jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
  created_by           uuid,
  last_activity_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, pipeline_id) references pipelines (tenant_id, id),
  foreign key (tenant_id, pipeline_id, stage_id) references pipeline_stages (tenant_id, pipeline_id, id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete set null (contact_id),
  foreign key (tenant_id, organization_id) references organizations (tenant_id, id) on delete set null (organization_id),
  foreign key (tenant_id, lead_id) references leads (tenant_id, id) on delete set null (lead_id),
  foreign key (tenant_id, owner_membership_id) references memberships (tenant_id, id) on delete set null (owner_membership_id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, outcome_reason_id) references outcome_reasons (tenant_id, id) on delete set null (outcome_reason_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index deals_tenant_pipeline_stage_idx on deals (tenant_id, pipeline_id, stage_id, stage_entered_at);
create index deals_tenant_owner_idx on deals (tenant_id, owner_membership_id);
create index deals_tenant_team_idx on deals (tenant_id, team_id);
create index deals_tenant_contact_idx on deals (tenant_id, contact_id);
create index deals_tenant_org_idx on deals (tenant_id, organization_id);
create index deals_tenant_status_closed_idx on deals (tenant_id, status, closed_at);
create index deals_title_trgm on deals using gin (app.norm(title) gin_trgm_ops);
create trigger deals_updated_at before update on deals
  for each row execute function app.set_updated_at();

alter table leads add foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete set null (deal_id);

create table deal_participants (
  tenant_id      uuid not null,
  deal_id        uuid not null,
  membership_id  uuid not null,
  primary key (deal_id, membership_id),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade
);
create index deal_participants_tenant_member_idx on deal_participants (tenant_id, membership_id);

create table deal_tags (
  tenant_id  uuid not null,
  deal_id    uuid not null,
  tag_id     uuid not null,
  primary key (deal_id, tag_id),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references tags (tenant_id, id) on delete cascade
);
create index deal_tags_tenant_tag_idx on deal_tags (tenant_id, tag_id);

create table deal_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  deal_id           uuid not null,
  product_id        uuid,
  name              text not null check (length(btrim(name)) between 1 and 160),
  quantity          numeric(12, 3) not null check (quantity > 0),
  unit_price_cents  bigint not null check (unit_price_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  check (discount_cents <= round(quantity * unit_price_cents)),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete set null (product_id)
);
create index deal_items_tenant_deal_idx on deal_items (tenant_id, deal_id);

-- Histórico de etapas, gravado pelo gatilho do negócio. Só inserção.
create table deal_stage_history (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  deal_id              uuid not null,
  pipeline_id          uuid not null,
  from_stage_id        uuid,
  to_stage_id          uuid not null,
  moved_at             timestamptz not null default now(),
  moved_by             uuid,
  seconds_in_previous  bigint,
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade
);
create index deal_stage_history_deal_idx on deal_stage_history (tenant_id, deal_id, moved_at);
create trigger deal_stage_history_append_only before update on deal_stage_history
  for each row execute function app.forbid_change();

-- Status, data de fechamento e histórico acompanham a etapa.
create function app.deal_stage_sync() returns trigger
language plpgsql
as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    select kind into v_kind from pipeline_stages
    where tenant_id = new.tenant_id and pipeline_id = new.pipeline_id and id = new.stage_id;
    new.status := coalesce(v_kind, 'open');
    if tg_op = 'UPDATE' then
      new.stage_entered_at := now();
    end if;
    if new.status = 'open' then
      new.closed_at := null;
      new.outcome_reason_id := null;
      new.outcome_note := null;
    elsif tg_op = 'INSERT' or old.status = 'open' or new.closed_at is null then
      new.closed_at := now();
    end if;
  end if;
  return new;
end
$$;
create trigger deals_stage_sync before insert or update of stage_id on deals
  for each row execute function app.deal_stage_sync();

create function app.deal_stage_log() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into deal_stage_history (tenant_id, deal_id, pipeline_id, from_stage_id, to_stage_id, moved_by)
    values (new.tenant_id, new.id, new.pipeline_id, null, new.stage_id, app.user_id());
  elsif new.stage_id is distinct from old.stage_id then
    insert into deal_stage_history (tenant_id, deal_id, pipeline_id, from_stage_id, to_stage_id, moved_by, seconds_in_previous)
    values (new.tenant_id, new.id, new.pipeline_id, old.stage_id, new.stage_id, app.user_id(),
            extract(epoch from (now() - old.stage_entered_at))::bigint);
  end if;
  return null;
end
$$;
create trigger deals_stage_log after insert or update of stage_id on deals
  for each row execute function app.deal_stage_log();

-- ---------------------------------------------------------------------------
-- Notas, linha do tempo, origem, consentimento, supressão e mesclagens
-- ---------------------------------------------------------------------------

create table notes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants (id) on delete cascade,
  body                  text not null check (length(btrim(body)) between 1 and 20000),
  author_membership_id  uuid,
  contact_id            uuid,
  organization_id       uuid,
  deal_id               uuid,
  lead_id               uuid,
  pinned                boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, id),
  check (num_nonnulls(contact_id, organization_id, deal_id, lead_id) >= 1),
  foreign key (tenant_id, author_membership_id) references memberships (tenant_id, id) on delete set null (author_membership_id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id) references organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references leads (tenant_id, id) on delete cascade
);
create index notes_contact_idx on notes (tenant_id, contact_id, created_at desc) where contact_id is not null;
create index notes_org_idx on notes (tenant_id, organization_id, created_at desc) where organization_id is not null;
create index notes_deal_idx on notes (tenant_id, deal_id, created_at desc) where deal_id is not null;
create index notes_lead_idx on notes (tenant_id, lead_id, created_at desc) where lead_id is not null;
create trigger notes_updated_at before update on notes
  for each row execute function app.set_updated_at();

-- Linha do tempo: o que aconteceu com cada registro, em ordem. Guarda nomes de
-- campos e identificadores, nunca o valor de dado pessoal.
create table timeline_entries (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  occurred_at          timestamptz not null default clock_timestamp(),
  kind                 text not null check (kind ~ '^[a-z_]+\.[a-z_.]+$'),
  actor_membership_id  uuid,
  contact_id           uuid,
  organization_id      uuid,
  deal_id              uuid,
  lead_id              uuid,
  data                 jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  check (num_nonnulls(contact_id, organization_id, deal_id, lead_id) >= 1),
  foreign key (tenant_id, actor_membership_id) references memberships (tenant_id, id) on delete set null (actor_membership_id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id) references organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references leads (tenant_id, id) on delete cascade
);
create index timeline_contact_idx on timeline_entries (tenant_id, contact_id, occurred_at desc) where contact_id is not null;
create index timeline_org_idx on timeline_entries (tenant_id, organization_id, occurred_at desc) where organization_id is not null;
create index timeline_deal_idx on timeline_entries (tenant_id, deal_id, occurred_at desc) where deal_id is not null;
create index timeline_lead_idx on timeline_entries (tenant_id, lead_id, occurred_at desc) where lead_id is not null;
create trigger timeline_entries_no_update before update on timeline_entries
  for each row execute function app.forbid_change();

-- Pontos de contato com a origem. Só inserção: a primeira origem é a linha
-- mais antiga e nunca é sobrescrita. Campo ausente fica nulo, nunca presumido.
create table attribution_touches (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  contact_id    uuid not null,
  lead_id       uuid,
  deal_id       uuid,
  occurred_at   timestamptz not null default clock_timestamp(),
  recorded_via  text not null check (recorded_via in ('manual', 'import', 'form', 'api', 'channel')),
  source        text check (source is null or length(source) <= 200),
  medium        text check (medium is null or length(medium) <= 200),
  campaign      text check (campaign is null or length(campaign) <= 200),
  term          text check (term is null or length(term) <= 200),
  content       text check (content is null or length(content) <= 200),
  click_ids     jsonb not null default '{}'::jsonb check (jsonb_typeof(click_ids) = 'object'),
  referrer      text check (referrer is null or length(referrer) <= 2000),
  landing_page  text check (landing_page is null or length(landing_page) <= 2000),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references leads (tenant_id, id) on delete set null (lead_id),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete set null (deal_id)
);
create index attribution_contact_idx on attribution_touches (tenant_id, contact_id, occurred_at, id);
create index attribution_source_idx on attribution_touches (tenant_id, source, occurred_at);
create trigger attribution_touches_no_update before update on attribution_touches
  for each row execute function app.forbid_change();

-- Consentimento por canal e finalidade. Cada mudança é uma linha nova; vale a
-- mais recente.
create table consents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  contact_id    uuid not null,
  channel       text not null check (channel in ('email', 'whatsapp', 'sms', 'phone', 'instagram')),
  purpose       text not null default 'marketing' check (purpose in ('marketing', 'service')),
  status        text not null check (status in ('granted', 'revoked')),
  source        text not null check (length(btrim(source)) between 1 and 200),
  evidence      text check (evidence is null or length(evidence) <= 2000),
  recorded_by   uuid,
  recorded_at   timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, recorded_by) references memberships (tenant_id, id) on delete set null (recorded_by)
);
create index consents_contact_idx on consents (tenant_id, contact_id, channel, purpose, recorded_at desc);
create trigger consents_no_update before update on consents
  for each row execute function app.forbid_change();

create table suppression_list (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  channel     text not null check (channel in ('email', 'whatsapp', 'sms', 'phone', 'instagram')),
  value       text not null check (length(value) between 3 and 254),
  reason      text not null check (reason in ('opt_out', 'bounce', 'complaint', 'manual')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, channel, value),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);

create table contact_merges (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  kept_contact_id    uuid not null,
  merged_contact_id  uuid not null,
  snapshot           jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  merged_by          uuid,
  merged_at          timestamptz not null default now(),
  foreign key (tenant_id, kept_contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, merged_by) references memberships (tenant_id, id) on delete set null (merged_by)
);
create index contact_merges_kept_idx on contact_merges (tenant_id, kept_contact_id);

-- ---------------------------------------------------------------------------
-- Atividades, lembretes e notificações
-- ---------------------------------------------------------------------------

-- Série de uma atividade recorrente. As ocorrências são linhas de activities,
-- criadas até horizon_until; o despachante estende o horizonte.
create table activity_series (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  rule           jsonb not null check (jsonb_typeof(rule) = 'object'),
  timezone       text not null,
  horizon_until  timestamptz not null,
  ended          boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id)
);
create index activity_series_open_idx on activity_series (horizon_until) where not ended;

create table activities (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  type                 text not null default 'task' check (type in ('task', 'call', 'meeting', 'email', 'visit', 'other')),
  title                text not null check (length(btrim(title)) between 1 and 200),
  description          text check (description is null or length(description) <= 10000),
  starts_at            timestamptz,
  ends_at              timestamptz,
  all_day              boolean not null default false,
  status               text not null default 'open' check (status in ('open', 'done', 'canceled')),
  done_at              timestamptz,
  priority             text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  owner_membership_id  uuid not null,
  team_id              uuid,
  contact_id           uuid,
  organization_id      uuid,
  deal_id              uuid,
  lead_id              uuid,
  series_id            uuid,
  series_index         integer,
  reminder_minutes     integer check (reminder_minutes is null or reminder_minutes between 0 and 40320),
  reminder_at          timestamptz,
  reminder_sent_at     timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  check (ends_at is null or (starts_at is not null and ends_at >= starts_at)),
  check ((status = 'done') = (done_at is not null)),
  check (reminder_minutes is null or starts_at is not null),
  foreign key (tenant_id, owner_membership_id) references memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id) references organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, series_id) references activity_series (tenant_id, id) on delete set null (series_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index activities_owner_start_idx on activities (tenant_id, owner_membership_id, starts_at);
create index activities_tenant_start_idx on activities (tenant_id, starts_at);
create index activities_open_idx on activities (tenant_id, status, starts_at) where status = 'open';
create index activities_contact_idx on activities (tenant_id, contact_id) where contact_id is not null;
create index activities_deal_idx on activities (tenant_id, deal_id) where deal_id is not null;
create index activities_lead_idx on activities (tenant_id, lead_id) where lead_id is not null;
create index activities_org_idx on activities (tenant_id, organization_id) where organization_id is not null;
create index activities_series_idx on activities (tenant_id, series_id, series_index) where series_id is not null;
create index activities_reminder_due_idx on activities (reminder_at) where reminder_sent_at is null and reminder_at is not null and status = 'open';
create trigger activities_updated_at before update on activities
  for each row execute function app.set_updated_at();

-- O horário do lembrete acompanha o início; mudar o início rearma o lembrete.
create function app.activity_reminder_sync() returns trigger
language plpgsql
as $$
begin
  new.reminder_at := case
    when new.reminder_minutes is null or new.starts_at is null then null
    else new.starts_at - make_interval(mins => new.reminder_minutes)
  end;
  if tg_op = 'UPDATE' and new.reminder_at is distinct from old.reminder_at then
    new.reminder_sent_at := null;
  end if;
  return new;
end
$$;
create trigger activities_reminder_sync before insert or update of starts_at, reminder_minutes on activities
  for each row execute function app.activity_reminder_sync();

create table notifications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  membership_id  uuid not null,
  kind           text not null check (kind ~ '^[a-z_]+\.[a-z_.]+$'),
  title          text not null check (length(title) between 1 and 200),
  body           text check (body is null or length(body) <= 1000),
  link           text check (link is null or link ~ '^/[^/]'),
  activity_id    uuid,
  created_at     timestamptz not null default now(),
  read_at        timestamptz,
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, activity_id) references activities (tenant_id, id) on delete cascade
);
create index notifications_member_idx on notifications (tenant_id, membership_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Arquivos, importação, exportação e visões salvas
-- ---------------------------------------------------------------------------

create table files (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id) on delete cascade,
  -- A chave do objeto começa pela empresa: <tenant_id>/<ano>/<mês>/<id>.
  storage_key      text not null unique,
  purpose          text not null check (purpose in ('attachment', 'import', 'branding')),
  original_name    text not null check (length(original_name) between 1 and 255),
  content_type     text not null check (length(content_type) between 3 and 255),
  size_bytes       bigint not null check (size_bytes >= 0),
  sha256           bytea not null check (length(sha256) = 32),
  uploaded_by      uuid,
  contact_id       uuid,
  organization_id  uuid,
  deal_id          uuid,
  lead_id          uuid,
  activity_id      uuid,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (tenant_id, id),
  check (storage_key like tenant_id::text || '/%'),
  foreign key (tenant_id, uploaded_by) references memberships (tenant_id, id) on delete set null (uploaded_by),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id) references organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, activity_id) references activities (tenant_id, id) on delete cascade
);
create index files_contact_idx on files (tenant_id, contact_id) where contact_id is not null;
create index files_org_idx on files (tenant_id, organization_id) where organization_id is not null;
create index files_deal_idx on files (tenant_id, deal_id) where deal_id is not null;
create index files_lead_idx on files (tenant_id, lead_id) where lead_id is not null;

create table imports (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  entity          text not null check (entity in ('contacts', 'organizations')),
  status          text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'canceled')),
  file_id         uuid not null,
  mapping         jsonb not null check (jsonb_typeof(mapping) = 'object'),
  options         jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  total_rows      integer not null default 0,
  processed_rows  integer not null default 0,
  created_count   integer not null default 0,
  updated_count   integer not null default 0,
  skipped_count   integer not null default 0,
  error_count     integer not null default 0,
  error           text,
  created_by      uuid,
  locked_until    timestamptz,
  attempts        integer not null default 0,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, file_id) references files (tenant_id, id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index imports_tenant_idx on imports (tenant_id, created_at desc);
create index imports_queue_idx on imports (created_at) where status in ('pending', 'processing');

create table import_rows (
  tenant_id   uuid not null,
  import_id   uuid not null,
  row_number  integer not null,
  status      text not null check (status in ('created', 'updated', 'skipped', 'error')),
  record_id   uuid,
  errors      jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  primary key (import_id, row_number),
  foreign key (tenant_id, import_id) references imports (tenant_id, id) on delete cascade
);
create index import_rows_tenant_idx on import_rows (tenant_id, import_id, status);

-- Registro de cada exportação: quem, o quê, com que filtros e quantas linhas.
create table exports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  entity      text not null check (entity in ('contacts', 'organizations', 'deals', 'leads', 'privacy')),
  filters     jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  row_count   integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index exports_tenant_idx on exports (tenant_id, created_at desc);
create trigger exports_append_only before update or delete on exports
  for each row execute function app.forbid_change();

create table saved_views (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  membership_id  uuid not null,
  entity         text not null check (entity in ('contacts', 'organizations', 'deals', 'leads', 'activities')),
  name           text not null check (length(btrim(name)) between 1 and 80),
  filters        jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  shared         boolean not null default false,
  created_at     timestamptz not null default now(),
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade
);
create index saved_views_tenant_idx on saved_views (tenant_id, entity);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'contacts', 'contact_emails', 'contact_phones', 'tags', 'contact_tags',
    'organization_tags', 'custom_field_definitions', 'pipelines', 'pipeline_access',
    'pipeline_stages', 'stage_transition_rules', 'products', 'outcome_reasons', 'leads',
    'assignment_rules', 'assignment_rule_members', 'deals', 'deal_participants', 'deal_tags',
    'deal_items', 'deal_stage_history', 'notes', 'timeline_entries', 'attribution_touches',
    'consents', 'suppression_list', 'contact_merges', 'activity_series', 'activities',
    'notifications', 'files', 'imports', 'import_rows', 'exports', 'saved_views'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end
$$;

-- Isolamento padrão com leitura e escrita completas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'contacts', 'contact_emails', 'contact_phones', 'tags', 'contact_tags',
    'organization_tags', 'custom_field_definitions', 'pipelines', 'pipeline_access',
    'pipeline_stages', 'stage_transition_rules', 'products', 'outcome_reasons', 'leads',
    'assignment_rules', 'assignment_rule_members', 'deals', 'deal_participants', 'deal_tags',
    'deal_items', 'notes', 'suppression_list', 'activity_series', 'activities', 'files',
    'imports', 'import_rows'
  ] loop
    execute format(
      'create policy tenant_isolation on %I for all to crm_app '
      'using (tenant_id = (select app.tenant_id())) '
      'with check (tenant_id = (select app.tenant_id()))', t);
    execute format('grant select, insert, update, delete on %I to crm_app', t);
  end loop;
end
$$;

-- Registros que só crescem: leitura e inserção. A linha do tempo e a origem
-- também podem ser apagadas, para a anonimização de um titular.
do $$
declare
  t text;
begin
  foreach t in array array[
    'deal_stage_history', 'timeline_entries', 'attribution_touches', 'consents',
    'contact_merges', 'exports'
  ] loop
    execute format(
      'create policy tenant_isolation on %I for all to crm_app '
      'using (tenant_id = (select app.tenant_id())) '
      'with check (tenant_id = (select app.tenant_id()))', t);
    execute format('grant select, insert on %I to crm_app', t);
  end loop;
end
$$;
grant delete on timeline_entries, attribution_touches to crm_app;

-- Visões salvas: cada pessoa vê as suas e as compartilhadas da empresa.
create policy own_or_shared on saved_views for select to crm_app
  using (tenant_id = (select app.tenant_id())
         and (shared or membership_id in (select id from memberships where user_id = (select app.user_id()))));
create policy own_write on saved_views for all to crm_app
  using (tenant_id = (select app.tenant_id())
         and membership_id in (select id from memberships where user_id = (select app.user_id())))
  with check (tenant_id = (select app.tenant_id())
              and membership_id in (select id from memberships where user_id = (select app.user_id())));
grant select, insert, update, delete on saved_views to crm_app;

-- Notificações: o despachante cria para qualquer pessoa da empresa; cada
-- pessoa lê e marca como lidas só as suas.
create policy tenant_insert on notifications for insert to crm_app
  with check (tenant_id = (select app.tenant_id()));
create policy own_read on notifications for select to crm_app
  using (tenant_id = (select app.tenant_id())
         and membership_id in (select id from memberships where user_id = (select app.user_id())));
create policy own_update on notifications for update to crm_app
  using (tenant_id = (select app.tenant_id())
         and membership_id in (select id from memberships where user_id = (select app.user_id())))
  with check (tenant_id = (select app.tenant_id()));
grant select, insert on notifications to crm_app;
grant update (read_at) on notifications to crm_app;

-- ---------------------------------------------------------------------------
-- Despachante: escolhe o próximo item entre empresas. Devolve só
-- identificadores; o processamento acontece depois, no contexto da empresa.
-- ---------------------------------------------------------------------------

-- Lembretes vencidos. Marca como enviados na mesma operação, então dois
-- despachantes nunca pegam o mesmo lembrete.
create function app.claim_due_reminders(p_limit int)
returns table (tenant_id uuid, activity_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select a.id from activities a
    join tenants t on t.id = a.tenant_id and t.status = 'active'
    where a.reminder_sent_at is null and a.reminder_at is not null
      and a.reminder_at <= now() and a.status = 'open'
      and a.reminder_at > now() - interval '1 day'
    order by a.reminder_at
    limit greatest(least(p_limit, 500), 1)
    for update of a skip locked
  )
  update activities a set reminder_sent_at = now()
  from due where a.id = due.id
  returning a.tenant_id, a.id
$$;

-- Próxima importação pendente, ou uma em andamento cuja trava venceu (o
-- processo caiu no meio). A trava dura o tempo de um lote.
create function app.claim_import(p_lock_seconds int)
returns table (tenant_id uuid, import_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with next as (
    select i.id from imports i
    join tenants t on t.id = i.tenant_id and t.status = 'active'
    where i.status = 'pending'
       or (i.status = 'processing' and (i.locked_until is null or i.locked_until < now()))
    order by i.created_at
    limit 1
    for update of i skip locked
  )
  update imports i
     set status = 'processing',
         locked_until = now() + make_interval(secs => greatest(least(p_lock_seconds, 3600), 5)),
         started_at = coalesce(i.started_at, now()),
         attempts = i.attempts + 1
  from next where i.id = next.id
  returning i.tenant_id, i.id
$$;

-- Séries recorrentes cujo horizonte precisa ser estendido.
create function app.series_needing_extension(p_until timestamptz, p_limit int)
returns table (tenant_id uuid, series_id uuid)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select s.tenant_id, s.id from activity_series s
  join tenants t on t.id = s.tenant_id and t.status = 'active'
  where not s.ended and s.horizon_until < p_until
  order by s.horizon_until
  limit greatest(least(p_limit, 500), 1)
$$;

grant execute on function app.norm(text) to crm_app, crm_dispatch;
grant execute on function app.claim_due_reminders(int) to crm_dispatch;
grant execute on function app.claim_import(int) to crm_dispatch;
grant execute on function app.series_needing_extension(timestamptz, int) to crm_dispatch;

-- crm_dispatch só alcança as funções acima; nenhuma tabela.
