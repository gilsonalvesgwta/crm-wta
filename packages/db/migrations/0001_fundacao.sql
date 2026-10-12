-- 0001_fundacao
-- Papéis do banco, funções de contexto e as tabelas de plataforma, identidade e acesso.
-- Executada pelo migrate.sh como superusuário do banco dedicado do CRM.
-- Compatível com PostgreSQL 16 ou superior.

-- ---------------------------------------------------------------------------
-- Papéis
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'crm_owner') then
    create role crm_owner nologin bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'crm_app') then
    create role crm_app nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'crm_dispatch') then
    create role crm_dispatch nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'crm_platform') then
    create role crm_platform nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'crm_backup') then
    create role crm_backup nologin bypassrls;
  end if;
end
$$;

grant pg_read_all_data to crm_backup;

do $$
begin
  execute format('grant create on database %I to crm_owner', current_database());
end
$$;
grant usage, create on schema public to crm_owner;
grant usage on schema public to crm_app, crm_dispatch, crm_platform;
revoke create on schema public from public;

set local role crm_owner;

-- Função criada por crm_owner não fica executável por todos os papéis.
alter default privileges for role crm_owner revoke execute on functions from public;

create schema app;
revoke all on schema app from public;
grant usage on schema app to crm_app, crm_dispatch, crm_platform;

-- ---------------------------------------------------------------------------
-- Contexto da requisição
-- ---------------------------------------------------------------------------

-- Empresa da transação atual. Sem contexto, falha: nenhuma consulta devolve
-- dados de todas as empresas por esquecimento.
create function app.tenant_id() returns uuid
language plpgsql stable
as $$
declare
  v text := current_setting('app.tenant_id', true);
begin
  if v is null or v = '' then
    raise exception 'contexto de empresa ausente (app.tenant_id)'
      using errcode = '42501';
  end if;
  return v::uuid;
end
$$;

-- Usuário da transação atual. Nulo quando o ator é uma integração ou o sistema.
create function app.user_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create function app.forbid_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'a tabela % só aceita inserção', tg_table_name
    using errcode = '42501';
end
$$;

-- ---------------------------------------------------------------------------
-- Plataforma
-- ---------------------------------------------------------------------------

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  status      text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  timezone    text not null default 'America/Sao_Paulo',
  locale      text not null default 'pt-BR',
  modules     jsonb not null default '{}'::jsonb check (jsonb_typeof(modules) = 'object'),
  limits      jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger tenants_updated_at before update on tenants
  for each row execute function app.set_updated_at();

create table tenant_domains (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  domain       text not null unique check (domain = lower(domain) and domain ~ '^[a-z0-9.-]{3,253}$'),
  kind         text not null check (kind in ('subdomain', 'custom')),
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index tenant_domains_tenant_idx on tenant_domains (tenant_id);

create table tenant_branding (
  tenant_id       uuid primary key references tenants (id) on delete cascade,
  product_name    text check (product_name is null or length(btrim(product_name)) between 1 and 80),
  theme           jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object'),
  previous_theme  jsonb check (previous_theme is null or jsonb_typeof(previous_theme) = 'object'),
  logo_file_key          text,
  logo_compact_file_key  text,
  favicon_file_key       text,
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);
create trigger tenant_branding_updated_at before update on tenant_branding
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Identidade
-- ---------------------------------------------------------------------------

-- Identidade global: uma pessoa pode pertencer a várias empresas.
create table users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  name               text not null check (length(btrim(name)) between 1 and 200),
  password_hash      text,
  status             text not null default 'active' check (status in ('active', 'disabled')),
  totp_secret_enc    bytea,
  totp_enabled_at    timestamptz,
  is_platform_admin  boolean not null default false,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger users_updated_at before update on users
  for each row execute function app.set_updated_at();

create table business_units (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table memberships (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  user_id           uuid not null references users (id) on delete cascade,
  status            text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  business_unit_id  uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id)
);
create index memberships_user_idx on memberships (user_id);
create trigger memberships_updated_at before update on memberships
  for each row execute function app.set_updated_at();

create table teams (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  name              text not null check (length(btrim(name)) between 1 and 120),
  business_unit_id  uuid,
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id)
);

create table team_members (
  tenant_id      uuid not null,
  team_id        uuid not null,
  membership_id  uuid not null,
  role           text not null default 'member' check (role in ('leader', 'member')),
  created_at     timestamptz not null default now(),
  primary key (team_id, membership_id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade
);
create index team_members_tenant_membership_idx on team_members (tenant_id, membership_id);

-- ---------------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------------

-- Perfis são dados de cada empresa. Os modelos iniciais são criados pela
-- aplicação a partir da matriz de permissões.
create table roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  key         text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name        text not null check (length(btrim(name)) between 1 and 80),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create table role_permissions (
  tenant_id   uuid not null,
  role_id     uuid not null,
  permission  text not null check (permission ~ '^[a-z_]+:[a-z_]+$'),
  scope       text not null check (scope in ('own', 'team', 'tenant')),
  primary key (role_id, permission),
  foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade
);
create index role_permissions_tenant_idx on role_permissions (tenant_id);

create table membership_roles (
  tenant_id      uuid not null,
  membership_id  uuid not null,
  role_id        uuid not null,
  primary key (membership_id, role_id),
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade
);
create index membership_roles_tenant_idx on membership_roles (tenant_id);

create table sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users (id) on delete cascade,
  tenant_id        uuid references tenants (id) on delete cascade,
  token_hash       bytea not null unique,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  mfa_verified_at  timestamptz,
  ip               inet,
  user_agent       text
);
create index sessions_user_idx on sessions (user_id);

create table invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  email        text not null check (email = lower(email)),
  role_id      uuid,
  token_hash   bytea not null unique,
  invited_by   uuid,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, role_id) references roles (tenant_id, id),
  foreign key (tenant_id, invited_by) references memberships (tenant_id, id)
);
create index invitations_tenant_email_idx on invitations (tenant_id, email);

create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index password_resets_user_idx on password_resets (user_id);

create table api_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 120),
  prefix        text not null unique check (prefix ~ '^[a-z0-9_]{8,24}$'),
  key_hash      bytea not null,
  scopes        text[] not null default '{}',
  created_by    uuid,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id)
);
create index api_keys_tenant_idx on api_keys (tenant_id);

-- ---------------------------------------------------------------------------
-- Registros que só aceitam inserção, particionados por mês
-- ---------------------------------------------------------------------------

create table auth_events (
  id           uuid not null default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  kind         text not null check (kind ~ '^[a-z_.]{3,60}$'),
  user_id      uuid,
  tenant_id    uuid,
  email        text,
  ip           inet,
  user_agent   text,
  detail       jsonb not null default '{}'::jsonb,
  primary key (id, occurred_at)
) partition by range (occurred_at);
create index auth_events_tenant_idx on auth_events (tenant_id, occurred_at desc);
create index auth_events_user_idx on auth_events (user_id, occurred_at desc);

create table audit_log (
  id           uuid not null default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  tenant_id    uuid,
  actor_type   text not null check (actor_type in ('user', 'api_key', 'system', 'platform')),
  actor_id     uuid,
  action       text not null check (action ~ '^[a-z_]+\.[a-z_.]+$'),
  object_type  text,
  object_id    uuid,
  detail       jsonb not null default '{}'::jsonb,
  ip           inet,
  request_id   text,
  primary key (id, occurred_at)
) partition by range (occurred_at);
create index audit_log_tenant_idx on audit_log (tenant_id, occurred_at desc);
create index audit_log_object_idx on audit_log (tenant_id, object_type, object_id);

create trigger auth_events_append_only before update or delete on auth_events
  for each row execute function app.forbid_change();
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function app.forbid_change();

-- Cria as partições mensais que faltam. Cada partição nasce com RLS forçado e
-- sem concessões: o acesso é sempre pela tabela mãe.
create function app.ensure_month_partitions(p_table regclass, p_from date, p_months int)
returns int
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_schema  text;
  v_name    text;
  v_start   date := date_trunc('month', p_from)::date;
  v_part    text;
  v_created int := 0;
begin
  select n.nspname, c.relname into v_schema, v_name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.oid = p_table and c.relkind = 'p';
  if v_name is null then
    raise exception '% não é uma tabela particionada', p_table;
  end if;

  for i in 0 .. greatest(p_months, 1) - 1 loop
    v_part := format('%s_y%sm%s', v_name, to_char(v_start, 'YYYY'), to_char(v_start, 'MM'));
    if to_regclass(format('%I.%I', v_schema, v_part)) is null then
      execute format(
        'create table %I.%I partition of %I.%I for values from (%L) to (%L)',
        v_schema, v_part, v_schema, v_name, v_start, (v_start + interval '1 month')::date
      );
      execute format('alter table %I.%I enable row level security', v_schema, v_part);
      execute format('alter table %I.%I force row level security', v_schema, v_part);
      v_created := v_created + 1;
    end if;
    v_start := (v_start + interval '1 month')::date;
  end loop;
  return v_created;
end
$$;

do $$
begin
  perform app.ensure_month_partitions('auth_events', current_date, 3);
  perform app.ensure_month_partitions('audit_log', current_date, 3);
end
$$;

-- ---------------------------------------------------------------------------
-- RLS: toda tabela ligada e forçada
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_domains', 'tenant_branding', 'users', 'business_units',
    'memberships', 'teams', 'team_members', 'roles', 'role_permissions',
    'membership_roles', 'sessions', 'invitations', 'password_resets', 'api_keys',
    'auth_events', 'audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end
$$;

-- Isolamento padrão: a linha pertence à empresa do contexto.
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenant_domains', 'tenant_branding', 'business_units', 'memberships', 'teams',
    'team_members', 'roles', 'role_permissions', 'membership_roles', 'invitations',
    'api_keys'
  ] loop
    execute format(
      'create policy tenant_isolation on %I for all to crm_app '
      'using (tenant_id = (select app.tenant_id())) '
      'with check (tenant_id = (select app.tenant_id()))', t);
    execute format('grant select, insert, update, delete on %I to crm_app', t);
  end loop;
end
$$;

-- A empresa enxerga a própria linha; criar e suspender empresas é da plataforma.
create policy tenant_self on tenants for select to crm_app
  using (id = (select app.tenant_id()));
create policy tenant_self_update on tenants for update to crm_app
  using (id = (select app.tenant_id()))
  with check (id = (select app.tenant_id()));
grant select on tenants to crm_app;
grant update (name, timezone, locale) on tenants to crm_app;

create policy platform_all on tenants for all to crm_platform using (true) with check (true);
grant select, insert, update on tenants to crm_platform;
create policy platform_all on tenant_domains for all to crm_platform using (true) with check (true);
grant select, insert, update, delete on tenant_domains to crm_platform;

-- Usuários: visíveis para quem divide uma empresa com eles. Senha e segredo de
-- 2FA não têm concessão de leitura; só as funções de autenticação os alcançam.
create policy users_same_tenant on users for select to crm_app
  using (
    exists (
      select 1 from memberships m
      where m.user_id = users.id and m.tenant_id = (select app.tenant_id())
    )
  );
create policy users_self_update on users for update to crm_app
  using (id = (select app.user_id()))
  with check (id = (select app.user_id()));
grant select (id, email, name, status, totp_enabled_at, last_login_at, created_at, updated_at) on users to crm_app;
grant update (name) on users to crm_app;

-- Sessões: a pessoa lista as próprias; criar, validar e revogar é por função.
create policy sessions_own on sessions for select to crm_app
  using (user_id = (select app.user_id()));
grant select (id, user_id, tenant_id, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent) on sessions to crm_app;

-- password_resets: nenhuma política e nenhuma concessão. Só funções.

-- Eventos de autenticação e auditoria: a empresa lê os seus e a aplicação
-- insere no contexto da empresa. Alterar ou apagar não é concedido a ninguém.
create policy tenant_read on auth_events for select to crm_app
  using (tenant_id = (select app.tenant_id()));
grant select on auth_events to crm_app;

create policy tenant_read on audit_log for select to crm_app
  using (tenant_id = (select app.tenant_id()));
create policy tenant_insert on audit_log for insert to crm_app
  with check (tenant_id = (select app.tenant_id()));
grant select, insert on audit_log to crm_app;

create policy platform_read on auth_events for select to crm_platform using (true);
grant select on auth_events to crm_platform;

-- ---------------------------------------------------------------------------
-- Funções de autenticação
-- Rodam com os direitos de crm_owner porque precisam olhar antes de existir
-- contexto de empresa (login, troca de empresa, validação de sessão).
-- ---------------------------------------------------------------------------

create function app.auth_find_user(p_email text)
returns table (id uuid, password_hash text, status text, totp_enabled boolean, is_platform_admin boolean)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select u.id, u.password_hash, u.status, u.totp_enabled_at is not null, u.is_platform_admin
  from public.users u
  where u.email = lower(btrim(p_email))
$$;

create function app.auth_user_tenants(p_user_id uuid)
returns table (tenant_id uuid, tenant_name text, tenant_slug text, membership_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select t.id, t.name, t.slug, m.id
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.status = 'active'
    and t.status = 'active'
  order by t.name
$$;

create function app.auth_resolve_domain(p_domain text)
returns table (tenant_id uuid, tenant_status text)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select t.id, t.status
  from public.tenant_domains d
  join public.tenants t on t.id = d.tenant_id
  where d.domain = lower(btrim(p_domain))
$$;

create function app.auth_record_event(
  p_kind text, p_user_id uuid, p_tenant_id uuid, p_email text,
  p_ip inet, p_user_agent text, p_detail jsonb default '{}'::jsonb
) returns void
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  insert into public.auth_events (kind, user_id, tenant_id, email, ip, user_agent, detail)
  values (p_kind, p_user_id, p_tenant_id, lower(btrim(p_email)), p_ip, left(p_user_agent, 400), coalesce(p_detail, '{}'::jsonb))
$$;

create function app.session_create(
  p_user_id uuid, p_token_hash bytea, p_expires_at timestamptz, p_ip inet, p_user_agent text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_expires_at <= now() then
    raise exception 'validade da sessão no passado' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id and u.status = 'active') then
    raise exception 'usuário inexistente ou desativado' using errcode = '42501';
  end if;
  insert into public.sessions (user_id, token_hash, expires_at, ip, user_agent)
  values (p_user_id, p_token_hash, p_expires_at, p_ip, left(p_user_agent, 400))
  returning id into v_id;
  update public.users set last_login_at = now() where id = p_user_id;
  return v_id;
end
$$;

-- Devolve a sessão só se estiver válida, de usuário ativo e, quando há empresa
-- escolhida, com vínculo e empresa ainda ativos.
create function app.session_find(p_token_hash bytea)
returns table (session_id uuid, user_id uuid, tenant_id uuid, membership_id uuid, expires_at timestamptz, mfa_verified_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select s.id, s.user_id, s.tenant_id, m.id, s.expires_at, s.mfa_verified_at
  from public.sessions s
  join public.users u on u.id = s.user_id and u.status = 'active'
  left join public.tenants t on t.id = s.tenant_id
  left join public.memberships m on m.tenant_id = s.tenant_id and m.user_id = s.user_id
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and (s.tenant_id is null or (t.status = 'active' and m.status = 'active'))
$$;

create function app.session_set_tenant(p_session_id uuid, p_tenant_id uuid) returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_user uuid;
begin
  select s.user_id into v_user
  from public.sessions s
  where s.id = p_session_id and s.revoked_at is null and s.expires_at > now();
  if v_user is null then
    raise exception 'sessão inválida' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and m.tenant_id = p_tenant_id
      and m.status = 'active' and t.status = 'active'
  ) then
    raise exception 'usuário sem vínculo ativo com a empresa' using errcode = '42501';
  end if;
  update public.sessions set tenant_id = p_tenant_id, last_seen_at = now() where id = p_session_id;
end
$$;

create function app.session_mark_mfa(p_session_id uuid) returns void
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  update public.sessions set mfa_verified_at = now()
  where id = p_session_id and revoked_at is null and expires_at > now()
$$;

create function app.session_touch(p_session_id uuid) returns void
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  update public.sessions set last_seen_at = now()
  where id = p_session_id and revoked_at is null
$$;

create function app.session_revoke(p_session_id uuid) returns void
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  update public.sessions set revoked_at = now()
  where id = p_session_id and revoked_at is null
$$;

create function app.session_revoke_all(p_user_id uuid) returns int
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  with r as (
    update public.sessions set revoked_at = now()
    where user_id = p_user_id and revoked_at is null
    returning 1
  )
  select count(*)::int from r
$$;

-- Toda função nasce executável por qualquer papel. Aqui a permissão é tirada
-- de todos e devolvida, pelo nome, só a quem precisa.
revoke execute on all functions in schema app from public;

grant execute on function app.tenant_id() to crm_app, crm_dispatch, crm_platform;
grant execute on function app.user_id() to crm_app, crm_dispatch, crm_platform;
grant execute on function app.auth_find_user(text) to crm_app;
grant execute on function app.auth_user_tenants(uuid) to crm_app;
grant execute on function app.auth_resolve_domain(text) to crm_app;
grant execute on function app.auth_record_event(text, uuid, uuid, text, inet, text, jsonb) to crm_app;
grant execute on function app.session_create(uuid, bytea, timestamptz, inet, text) to crm_app;
grant execute on function app.session_find(bytea) to crm_app;
grant execute on function app.session_set_tenant(uuid, uuid) to crm_app;
grant execute on function app.session_mark_mfa(uuid) to crm_app;
grant execute on function app.session_touch(uuid) to crm_app;
grant execute on function app.session_revoke(uuid) to crm_app;
grant execute on function app.session_revoke_all(uuid) to crm_app;
