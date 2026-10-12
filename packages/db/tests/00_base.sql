-- Ferramentas de teste e dados de duas empresas, A e B.
-- Roda como superusuário, depois das migrações.

create schema t;

create table t.results (
  n     serial primary key,
  name  text not null
);

create function t.ok(p_cond boolean, p_name text) returns void
language plpgsql
as $$
begin
  if p_cond is not true then
    raise exception 'FALHOU: %', p_name;
  end if;
  insert into t.results (name) values (p_name);
end
$$;

-- Espera que o comando falhe com o código informado.
create function t.throws(p_sql text, p_state text, p_name text) returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  if v_state is null then
    raise exception 'FALHOU: % (o comando passou, esperava erro %)', p_name, p_state;
  end if;
  if v_state <> p_state then
    raise exception 'FALHOU: % (erro % "%", esperava %)', p_name, v_state, v_msg, p_state;
  end if;
  insert into t.results (name) values (p_name);
end
$$;

create function t.count(p_sql text) returns bigint
language plpgsql
as $$
declare
  v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  return v;
end
$$;

-- Linhas afetadas por um comando de escrita.
create function t.affected(p_sql text) returns bigint
language plpgsql
as $$
declare
  v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end
$$;

create function t.ctx(p_tenant uuid, p_user uuid default null) returns void
language sql
as $$
  select set_config('app.tenant_id', coalesce(p_tenant::text, ''), false),
         set_config('app.user_id', coalesce(p_user::text, ''), false)
$$;

create function t.a() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-00000000000a'::uuid $$;
create function t.b() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-00000000000b'::uuid $$;
create function t.ua() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-0000000000a1'::uuid $$;
create function t.ub() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-0000000000b1'::uuid $$;
create function t.uab() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-0000000000ab'::uuid $$;
create function t.ma() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-000000000a01'::uuid $$;
create function t.mb() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-000000000b01'::uuid $$;
create function t.team_a() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-000000000a02'::uuid $$;
create function t.team_b() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-000000000b02'::uuid $$;
create function t.role_a() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-000000000a03'::uuid $$;
create function t.role_b() returns uuid language sql immutable as $$ select '00000000-0000-7000-8000-000000000b03'::uuid $$;

grant usage on schema t to crm_app, crm_platform;
grant execute on all functions in schema t to crm_app, crm_platform;
grant select, insert on t.results to crm_app, crm_platform;
grant usage on sequence t.results_n_seq to crm_app, crm_platform;

-- Dados ----------------------------------------------------------------------

insert into tenants (id, name, slug) values
  (t.a(), 'Empresa A', 'empresa-a'),
  (t.b(), 'Empresa B', 'empresa-b');

insert into tenant_domains (tenant_id, domain, kind) values
  (t.a(), 'a.crm.test', 'subdomain'),
  (t.b(), 'b.crm.test', 'subdomain');

insert into tenant_branding (tenant_id, product_name, theme) values
  (t.a(), 'CRM A', '{"primary":"#FF6600"}'),
  (t.b(), 'CRM B', '{"primary":"#0F766E"}');

insert into users (id, email, name, password_hash) values
  (t.ua(), 'a@a.test', 'Ana de A', 'hash-a'),
  (t.ub(), 'b@b.test', 'Bruno de B', 'hash-b'),
  (t.uab(), 'ambas@x.test', 'Carla das duas', 'hash-ab');

insert into business_units (tenant_id, name) values (t.a(), 'Matriz'), (t.b(), 'Matriz');

insert into memberships (id, tenant_id, user_id) values
  (t.ma(), t.a(), t.ua()),
  (t.mb(), t.b(), t.ub());
insert into memberships (tenant_id, user_id) values
  (t.a(), t.uab()),
  (t.b(), t.uab());

insert into teams (id, tenant_id, name) values
  (t.team_a(), t.a(), 'Comercial'),
  (t.team_b(), t.b(), 'Comercial');

insert into team_members (tenant_id, team_id, membership_id, role) values
  (t.a(), t.team_a(), t.ma(), 'leader'),
  (t.b(), t.team_b(), t.mb(), 'leader');

insert into roles (id, tenant_id, key, name, is_system) values
  (t.role_a(), t.a(), 'admin', 'Administrador', true),
  (t.role_b(), t.b(), 'admin', 'Administrador', true);

insert into role_permissions (tenant_id, role_id, permission, scope) values
  (t.a(), t.role_a(), 'contacts:view', 'tenant'),
  (t.b(), t.role_b(), 'contacts:view', 'tenant');

insert into membership_roles (tenant_id, membership_id, role_id) values
  (t.a(), t.ma(), t.role_a()),
  (t.b(), t.mb(), t.role_b());

insert into invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at) values
  (t.a(), 'novo@a.test', t.role_a(), '\x01', t.ma(), now() + interval '1 day'),
  (t.b(), 'novo@b.test', t.role_b(), '\x02', t.mb(), now() + interval '1 day');

insert into api_keys (tenant_id, name, prefix, key_hash, scopes, created_by) values
  (t.a(), 'n8n A', 'crm_test_a01', '\x0a', '{contacts:read}', t.ma()),
  (t.b(), 'n8n B', 'crm_test_b01', '\x0b', '{contacts:read}', t.mb());

insert into password_resets (user_id, token_hash, expires_at) values
  (t.ua(), '\x11', now() + interval '1 hour');

insert into audit_log (tenant_id, actor_type, actor_id, action) values
  (t.a(), 'user', t.ua(), 'tenant.updated'),
  (t.b(), 'user', t.ub(), 'tenant.updated');

insert into auth_events (kind, user_id, tenant_id, email) values
  ('login.ok', t.ua(), t.a(), 'a@a.test'),
  ('login.ok', t.ub(), t.b(), 'b@b.test');
