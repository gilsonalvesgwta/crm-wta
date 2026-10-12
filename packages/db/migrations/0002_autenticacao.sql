-- 0002_autenticacao
-- Funções de que o login, a verificação em duas etapas, a troca de senha e os
-- convites precisam antes de existir contexto de empresa. Todas rodam com os
-- direitos de crm_owner, fixam o search_path e são liberadas pelo nome.

set local role crm_owner;

-- Contagem de falhas de login por e-mail.
create index auth_events_email_idx on auth_events (email, occurred_at desc);
create index auth_events_ip_idx on auth_events (ip, occurred_at desc);

-- Códigos de recuperação da verificação em duas etapas, só com o hash.
create table mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  code_hash   bytea not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, code_hash)
);
alter table mfa_recovery_codes enable row level security;
alter table mfa_recovery_codes force row level security;
-- Nenhuma política e nenhuma concessão: só as funções abaixo alcançam a tabela.

-- ---------------------------------------------------------------------------
-- Perfil e senha
-- ---------------------------------------------------------------------------

create function app.auth_user_profile(p_user_id uuid)
returns table (id uuid, email text, name text, status text, totp_enabled boolean, is_platform_admin boolean)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select u.id, u.email, u.name, u.status, u.totp_enabled_at is not null, u.is_platform_admin
  from public.users u
  where u.id = p_user_id
$$;

create function app.auth_password_hash(p_user_id uuid) returns text
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select u.password_hash from public.users u where u.id = p_user_id and u.status = 'active'
$$;

-- Troca a senha e encerra as outras sessões da pessoa.
create function app.auth_set_password(p_user_id uuid, p_password_hash text, p_keep_session uuid default null)
returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_password_hash is null or length(p_password_hash) < 20 then
    raise exception 'hash de senha inválido' using errcode = '22023';
  end if;
  update public.users set password_hash = p_password_hash where id = p_user_id and status = 'active';
  if not found then
    raise exception 'usuário inexistente ou desativado' using errcode = '42501';
  end if;
  update public.sessions set revoked_at = now()
  where user_id = p_user_id and revoked_at is null
    and (p_keep_session is null or id <> p_keep_session);
end
$$;

-- ---------------------------------------------------------------------------
-- Proteção contra força bruta
-- ---------------------------------------------------------------------------

-- Falhas recentes por e-mail (desde o último login certo daquele e-mail) e por IP.
create function app.auth_failure_counts(p_email text, p_ip inet, p_since timestamptz)
returns table (by_email int, by_ip int, last_failure_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  with ok as (
    select max(e.occurred_at) as at
    from public.auth_events e
    where e.email = lower(btrim(p_email)) and e.kind = 'login.ok' and e.occurred_at >= p_since
  )
  select
    (select count(*)::int from public.auth_events e, ok
      where e.email = lower(btrim(p_email)) and e.kind = 'login.failed'
        and e.occurred_at >= greatest(p_since, coalesce(ok.at, p_since))),
    (select count(*)::int from public.auth_events e
      where p_ip is not null and e.ip = p_ip and e.kind = 'login.failed' and e.occurred_at >= p_since),
    (select max(e.occurred_at) from public.auth_events e
      where e.email = lower(btrim(p_email)) and e.kind = 'login.failed' and e.occurred_at >= p_since)
$$;

-- ---------------------------------------------------------------------------
-- Verificação em duas etapas (TOTP)
-- ---------------------------------------------------------------------------

create function app.auth_totp_secret(p_user_id uuid)
returns table (secret_enc bytea, enabled boolean)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select u.totp_secret_enc, u.totp_enabled_at is not null
  from public.users u
  where u.id = p_user_id and u.status = 'active'
$$;

-- Guarda um segredo novo, ainda não ativado. Recusa se já houver um ativo.
create function app.auth_totp_begin(p_user_id uuid, p_secret_enc bytea) returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  update public.users set totp_secret_enc = p_secret_enc
  where id = p_user_id and status = 'active' and totp_enabled_at is null;
  if not found then
    raise exception 'verificação em duas etapas já ativa ou usuário inválido' using errcode = '42501';
  end if;
end
$$;

-- Ativa o segredo pendente e troca os códigos de recuperação.
create function app.auth_totp_enable(p_user_id uuid, p_code_hashes bytea[]) returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(array_length(p_code_hashes, 1), 0) < 8 then
    raise exception 'são necessários ao menos 8 códigos de recuperação' using errcode = '22023';
  end if;
  update public.users set totp_enabled_at = now()
  where id = p_user_id and status = 'active' and totp_enabled_at is null and totp_secret_enc is not null;
  if not found then
    raise exception 'nenhuma ativação pendente' using errcode = '42501';
  end if;
  delete from public.mfa_recovery_codes where user_id = p_user_id;
  insert into public.mfa_recovery_codes (user_id, code_hash)
  select p_user_id, h from unnest(p_code_hashes) as h;
end
$$;

create function app.auth_totp_disable(p_user_id uuid) returns void
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  update public.users set totp_enabled_at = null, totp_secret_enc = null where id = p_user_id;
  delete from public.mfa_recovery_codes where user_id = p_user_id;
$$;

-- Usa um código de recuperação. Cada código vale uma vez.
create function app.auth_use_recovery_code(p_user_id uuid, p_code_hash bytea) returns boolean
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  with u as (
    update public.mfa_recovery_codes set used_at = now()
    where user_id = p_user_id and code_hash = p_code_hash and used_at is null
    returning 1
  )
  select exists (select 1 from u)
$$;

create function app.auth_recovery_codes_left(p_user_id uuid) returns int
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select count(*)::int from public.mfa_recovery_codes where user_id = p_user_id and used_at is null
$$;

-- ---------------------------------------------------------------------------
-- Nova senha por link
-- ---------------------------------------------------------------------------

-- Resultado: 'created', 'unknown' (e-mail sem usuário ativo) ou 'throttled'
-- (3 pedidos em 10 minutos). A API responde igual nos três casos.
create function app.auth_password_reset_create(p_email text, p_token_hash bytea, p_expires_at timestamptz)
returns text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_user uuid;
begin
  select id into v_user from public.users where email = lower(btrim(p_email)) and status = 'active';
  if v_user is null then
    return 'unknown';
  end if;
  if (select count(*) from public.password_resets
      where user_id = v_user and created_at > now() - interval '10 minutes') >= 3 then
    return 'throttled';
  end if;
  insert into public.password_resets (user_id, token_hash, expires_at) values (v_user, p_token_hash, p_expires_at);
  return 'created';
end
$$;

-- Consome o link: troca a senha, invalida os outros links e encerra as sessões.
create function app.auth_password_reset_consume(p_token_hash bytea, p_password_hash text) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_user uuid;
begin
  update public.password_resets set used_at = now()
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  returning user_id into v_user;
  if v_user is null then
    return null;
  end if;
  update public.password_resets set used_at = now() where user_id = v_user and used_at is null;
  perform app.auth_set_password(v_user, p_password_hash, null);
  return v_user;
end
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------

create function app.auth_invitation_info(p_token_hash bytea)
returns table (tenant_id uuid, tenant_name text, email text, user_exists boolean)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select i.tenant_id, t.name, i.email,
         exists (select 1 from public.users u where u.email = i.email)
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = p_token_hash
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

-- Aceita o convite. Se o e-mail ainda não tem usuário, cria um com o nome e a
-- senha informados. Se já tem, exige que quem aceita esteja logado como ele.
create function app.auth_invitation_accept(
  p_token_hash bytea, p_current_user uuid, p_name text, p_password_hash text
) returns table (user_id uuid, tenant_id uuid)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_inv   public.invitations%rowtype;
  v_user  uuid;
  v_mem   uuid;
begin
  select i.* into v_inv
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = p_token_hash
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  for update of i;
  if v_inv.id is null then
    raise exception 'convite inválido ou vencido' using errcode = '42501';
  end if;

  select u.id into v_user from public.users u where u.email = v_inv.email;
  if v_user is null then
    if p_name is null or length(btrim(p_name)) = 0 or p_password_hash is null then
      raise exception 'nome e senha são obrigatórios' using errcode = '22023';
    end if;
    insert into public.users (email, name, password_hash)
    values (v_inv.email, btrim(p_name), p_password_hash)
    returning id into v_user;
  elsif p_current_user is distinct from v_user then
    raise exception 'entre com a conta do e-mail convidado para aceitar' using errcode = '28000';
  end if;

  insert into public.memberships (tenant_id, user_id, status)
  values (v_inv.tenant_id, v_user, 'active')
  on conflict on constraint memberships_tenant_id_user_id_key
    do update set status = 'active'
  returning id into v_mem;

  if v_inv.role_id is not null then
    insert into public.membership_roles (tenant_id, membership_id, role_id)
    values (v_inv.tenant_id, v_mem, v_inv.role_id)
    on conflict do nothing;
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return query select v_user, v_inv.tenant_id;
end
$$;

-- Sessão: encerrar uma sessão específica da própria pessoa.
create function app.session_revoke_own(p_session_id uuid, p_user_id uuid) returns boolean
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  with r as (
    update public.sessions set revoked_at = now()
    where id = p_session_id and user_id = p_user_id and revoked_at is null
    returning 1
  )
  select exists (select 1 from r)
$$;

revoke execute on all functions in schema app from public;

grant execute on function app.auth_user_profile(uuid) to crm_app;
grant execute on function app.auth_password_hash(uuid) to crm_app;
grant execute on function app.auth_set_password(uuid, text, uuid) to crm_app;
grant execute on function app.auth_failure_counts(text, inet, timestamptz) to crm_app;
grant execute on function app.auth_totp_secret(uuid) to crm_app;
grant execute on function app.auth_totp_begin(uuid, bytea) to crm_app;
grant execute on function app.auth_totp_enable(uuid, bytea[]) to crm_app;
grant execute on function app.auth_totp_disable(uuid) to crm_app;
grant execute on function app.auth_use_recovery_code(uuid, bytea) to crm_app;
grant execute on function app.auth_recovery_codes_left(uuid) to crm_app;
grant execute on function app.auth_password_reset_create(text, bytea, timestamptz) to crm_app;
grant execute on function app.auth_password_reset_consume(bytea, text) to crm_app;
grant execute on function app.auth_invitation_info(bytea) to crm_app;
grant execute on function app.auth_invitation_accept(bytea, uuid, text, text) to crm_app;
grant execute on function app.session_revoke_own(uuid, uuid) to crm_app;
