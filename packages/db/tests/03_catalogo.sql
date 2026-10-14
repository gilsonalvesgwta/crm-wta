-- Regras que precisam valer para qualquer tabela ou função nova.
-- Um objeto criado sem elas faz este arquivo falhar e barra a mesclagem.

select t.ok(
  (select count(*) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and not (c.relrowsecurity and c.relforcerowsecurity)) = 0,
  'toda tabela de public tem RLS ligado e forçado');

select t.ok(
  (select count(*) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and not c.relispartition
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)) = 0,
  'toda tabela com tenant_id tem ao menos uma política');

select t.ok(
  (select count(*) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relispartition
     and (has_table_privilege('crm_app', c.oid, 'SELECT') or has_table_privilege('crm_platform', c.oid, 'SELECT'))) = 0,
  'nenhuma partição é acessível direto: só pela tabela mãe');

select t.ok(
  (select count(*) from pg_proc p
   where p.pronamespace = 'app'::regnamespace
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) = 0,
  'nenhuma função de app é executável por qualquer papel');

select t.ok(
  (select count(*) from pg_proc p
   where p.pronamespace = 'app'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0,
  'toda função com direitos do dono fixa o search_path');

select t.ok(
  (select not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole
   from pg_roles where rolname = 'crm_app'),
  'crm_app não é superusuário nem ignora RLS');
select t.ok(
  (select not rolsuper and not rolbypassrls from pg_roles where rolname = 'crm_platform'),
  'crm_platform não ignora RLS');
select t.ok(not has_schema_privilege('crm_app', 'public', 'CREATE'), 'crm_app não cria objetos em public');
select t.ok(not has_schema_privilege('crm_app', 'app', 'CREATE'), 'crm_app não cria objetos em app');

-- Lista fechada do que a aplicação pode executar. Função nova precisa entrar
-- aqui de propósito.
select t.ok(
  (select array_agg(p.proname::text order by p.proname::text collate "C")
   from pg_proc p
   where p.pronamespace = 'app'::regnamespace
     and has_function_privilege('crm_app', p.oid, 'EXECUTE'))
  = array[
    'api_key_lookup', 'api_key_touch', 'auth_failure_counts', 'auth_find_user', 'auth_invitation_accept', 'auth_invitation_info',
    'auth_password_hash', 'auth_password_reset_consume', 'auth_password_reset_create',
    'auth_record_event', 'auth_recovery_codes_left', 'auth_resolve_domain', 'auth_set_password',
    'auth_totp_begin', 'auth_totp_disable', 'auth_totp_enable', 'auth_totp_secret',
    'auth_use_recovery_code', 'auth_user_profile', 'auth_user_tenants', 'channel_by_webhook', 'norm', 'public_branding',
    'session_create', 'session_find', 'session_mark_mfa', 'session_revoke',
    'session_revoke_all', 'session_revoke_own', 'session_set_tenant', 'session_touch',
    'tenant_id', 'user_id'
  ],
  'a aplicação executa exatamente as funções previstas');

-- Partições mensais.
select t.ok(app.ensure_month_partitions('audit_log', date '2031-01-15', 2) = 2,
  'ensure_month_partitions cria os meses que faltam');
select t.ok(app.ensure_month_partitions('audit_log', date '2031-01-15', 2) = 0,
  'e não recria os que já existem');
select t.ok(
  (select count(*) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relispartition
     and not (c.relrowsecurity and c.relforcerowsecurity)) = 0,
  'partição nova nasce com RLS forçado');
select t.ok(
  t.affected($$insert into audit_log (occurred_at, tenant_id, actor_type, action) values ('2031-02-10', t.a(), 'system', 'test.partition')$$) = 1,
  'a linha cai na partição do mês');
select t.throws(
  $$insert into audit_log (occurred_at, tenant_id, actor_type, action) values ('2045-01-01', t.a(), 'system', 'test.partition')$$,
  '23514', 'mês sem partição recusa a linha em vez de perdê-la');
select t.throws($$select app.ensure_month_partitions('teams', current_date, 1)$$, 'P0001',
  'ensure_month_partitions recusa tabela não particionada');

set role crm_app;
select t.throws('select count(*) from audit_log_y2031m01', '42501', 'a aplicação não lê uma partição direto');
reset role;
