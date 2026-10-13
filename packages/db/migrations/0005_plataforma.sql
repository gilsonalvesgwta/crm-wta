-- 0005_plataforma
-- Venda do CRM: planos com limites, assinatura de cada empresa, eventos de
-- pagamento da Greenn, dados de contato da empresa, exclusão de empresa,
-- marca com logotipo e domínio próprio verificado.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- ---------------------------------------------------------------------------
-- Empresa: dados de contato e cobrança
-- ---------------------------------------------------------------------------

alter table tenants
  add column contact_name  text check (contact_name is null or length(contact_name) <= 200),
  add column contact_email text check (contact_email is null or (contact_email = lower(contact_email) and contact_email ~ '^[^@\s]+@[^@\s]+$')),
  add column phone         text check (phone is null or length(phone) <= 40),
  add column document      text check (document is null or length(document) <= 30),
  add column notes         text check (notes is null or length(notes) <= 4000);

-- Excluir uma empresa apaga, em cascata, tudo o que é dela. O registro de
-- exportações só aceita inserção, salvo quando a exclusão vem da empresa.
create function app.forbid_change_unless_cascade() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'a tabela % só aceita inserção', tg_table_name
    using errcode = '42501';
end
$$;
drop trigger exports_append_only on exports;
create trigger exports_append_only before update or delete on exports
  for each row execute function app.forbid_change_unless_cascade();

grant delete on tenants to crm_platform;

-- ---------------------------------------------------------------------------
-- Planos e assinaturas
-- ---------------------------------------------------------------------------

-- Limites: número nulo é ilimitado; recursos são verdadeiro ou falso.
--   max_users, max_whatsapp, max_email_accounts, max_automations,
--   custom_domain, api_access
create table plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 120),
  description    text check (description is null or length(description) <= 2000),
  price_cents    bigint not null default 0 check (price_cents >= 0),
  currency       text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'quarterly', 'yearly', 'one_time')),
  duration_days  integer not null default 30 check (duration_days between 1 and 3660),
  limits         jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  active         boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index plans_name_uq on plans (lower(name));
create trigger plans_updated_at before update on plans
  for each row execute function app.set_updated_at();

-- Produto da Greenn que concede um plano. A duração da oferta vale para venda
-- avulsa; em assinatura, o fim do período vem do contrato.
create table plan_offers (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references plans (id) on delete cascade,
  provider          text not null default 'greenn' check (provider in ('greenn')),
  external_product  text not null check (external_product ~ '^[0-9A-Za-z_-]{1,40}$'),
  label             text check (label is null or length(label) <= 120),
  duration_days     integer check (duration_days is null or duration_days between 1 and 3660),
  created_at        timestamptz not null default now(),
  unique (provider, external_product)
);

create table tenant_subscriptions (
  tenant_id           uuid primary key references tenants (id) on delete cascade,
  plan_id             uuid references plans (id) on delete set null,
  status              text not null default 'active' check (status in ('trial', 'active', 'past_due', 'canceled', 'expired', 'inactive')),
  current_period_end  timestamptz,
  started_at          timestamptz not null default now(),
  canceled_at         timestamptz,
  source              text not null default 'manual' check (source in ('manual', 'greenn')),
  customer_email      text check (customer_email is null or customer_email = lower(customer_email)),
  external_contract   text,
  external_sale       text,
  notes               text check (notes is null or length(notes) <= 2000),
  updated_at          timestamptz not null default now()
);
create index tenant_subscriptions_email_idx on tenant_subscriptions (customer_email);
create index tenant_subscriptions_contract_idx on tenant_subscriptions (external_contract);
create index tenant_subscriptions_expiry_idx on tenant_subscriptions (current_period_end) where status in ('trial', 'active', 'past_due', 'canceled');
create trigger tenant_subscriptions_updated_at before update on tenant_subscriptions
  for each row execute function app.set_updated_at();

-- Avisos de pagamento recebidos. O corpo guardado é o resumido (sem documento
-- nem endereço do comprador). Aviso repetido tem a mesma impressão digital e
-- não é aplicado duas vezes.
create table billing_events (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),
  provider         text not null default 'greenn',
  fingerprint      text not null unique,
  event_type       text,
  status           text,
  external_product text,
  external_sale    text,
  external_contract text,
  customer_email   text,
  tenant_id        uuid references tenants (id) on delete set null,
  action           text not null check (action in ('activated', 'renewed', 'created', 'canceled', 'deactivated', 'ignored', 'unmatched', 'invalid')),
  detail           jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index billing_events_received_idx on billing_events (received_at desc);
create index billing_events_tenant_idx on billing_events (tenant_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Domínio próprio: estado da verificação
-- ---------------------------------------------------------------------------

alter table tenant_domains
  add column dns_ok      boolean not null default false,
  add column routing_ok  boolean not null default false,
  add column checked_at  timestamptz,
  add column last_error  text check (last_error is null or length(last_error) <= 500);

-- Uma empresa tem no máximo um domínio próprio.
create unique index tenant_domains_one_custom on tenant_domains (tenant_id) where kind = 'custom';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table plans enable row level security;
alter table plans force row level security;
alter table plan_offers enable row level security;
alter table plan_offers force row level security;
alter table tenant_subscriptions enable row level security;
alter table tenant_subscriptions force row level security;
alter table billing_events enable row level security;
alter table billing_events force row level security;

-- Planos: a plataforma administra; as empresas leem (para mostrar o próprio
-- plano e conferir limites).
create policy platform_all on plans for all to crm_platform using (true) with check (true);
create policy app_read on plans for select to crm_app using (true);
grant select, insert, update, delete on plans to crm_platform;
grant select on plans to crm_app;

create policy platform_all on plan_offers for all to crm_platform using (true) with check (true);
grant select, insert, update, delete on plan_offers to crm_platform;

create policy platform_all on tenant_subscriptions for all to crm_platform using (true) with check (true);
create policy tenant_read on tenant_subscriptions for select to crm_app
  using (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on tenant_subscriptions to crm_platform;
grant select on tenant_subscriptions to crm_app;

create policy platform_all on billing_events for all to crm_platform using (true) with check (true);
grant select, insert on billing_events to crm_platform;

-- A plataforma passa a ver e editar a marca das empresas (não é dado de cliente).
create policy platform_all on tenant_branding for all to crm_platform using (true) with check (true);
grant select, insert, update on tenant_branding to crm_platform;

-- Domínios: a empresa altera o próprio; a verificação é gravada pela aplicação.
grant update (dns_ok, routing_ok, checked_at, last_error) on tenant_domains to crm_platform;

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------

-- Marca pública de uma empresa pelo domínio do endereço (tela de login). Só
-- domínio verificado e empresa ativa; devolve só o que aparece na tela.
create function app.public_branding(p_domain text)
returns table (tenant_id uuid, tenant_name text, product_name text, theme jsonb, logo_file text, icon_file text)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select t.id, t.name, b.product_name, coalesce(b.theme, '{}'::jsonb), b.logo_file_key, b.logo_compact_file_key
  from public.tenant_domains d
  join public.tenants t on t.id = d.tenant_id and t.status = 'active'
  left join public.tenant_branding b on b.tenant_id = t.id
  where d.domain = lower(btrim(p_domain)) and d.verified_at is not null
$$;

-- Assinaturas vencidas: a empresa é suspensa. Roda no despachante.
create function app.expire_subscriptions()
returns table (tenant_id uuid)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  return query
  with vencidas as (
    update public.tenant_subscriptions s
       set status = 'expired'
     where s.status in ('trial', 'active', 'past_due', 'canceled')
       and s.current_period_end is not null and s.current_period_end < now()
    returning s.tenant_id
  ), suspensas as (
    update public.tenants t set status = 'suspended'
      from vencidas v where t.id = v.tenant_id and t.status = 'active'
    returning t.id
  )
  select v.tenant_id from vencidas v;
end
$$;

grant execute on function app.public_branding(text) to crm_app;
grant execute on function app.expire_subscriptions() to crm_dispatch;
