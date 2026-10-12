-- Isolamento entre empresas, visto pelo papel que a aplicação usa.

set role crm_app;

-- 1. Sem contexto de empresa, nada é devolvido: a consulta falha. ------------
select t.ctx(null, null);

do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and k.relkind in ('r', 'p') and not k.relispartition
      and c.table_name <> 'sessions'
    order by 1
  loop
    perform t.throws(format('select count(*) from %I', r.table_name), '42501',
      format('sem contexto, ler %s falha', r.table_name));
  end loop;
end
$$;

select t.throws('select count(*) from tenants', '42501', 'sem contexto, ler tenants falha');
select t.throws('select count(*) from users', '42501', 'sem contexto, ler users falha');
select t.ok(t.count('select 1 from sessions') = 0, 'sem usuário no contexto, nenhuma sessão aparece');
select t.throws('select count(*) from password_resets', '42501', 'password_resets não é legível pela aplicação');

-- 2. No contexto de A, nenhuma linha de B aparece. ----------------------------
select t.ctx(t.a(), t.ua());

do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and k.relkind in ('r', 'p') and not k.relispartition
      and has_table_privilege('crm_app', k.oid, 'SELECT')
    order by 1
  loop
    perform t.ok(
      t.count(format('select 1 from %I where tenant_id is distinct from t.a()', r.table_name)) = 0,
      format('no contexto de A, %s não mostra linha de outra empresa', r.table_name));
    if r.table_name <> 'sessions' then
      perform t.ok(
        t.count(format('select 1 from %I', r.table_name)) > 0,
        format('no contexto de A, %s mostra as linhas de A', r.table_name));
    end if;
  end loop;
end
$$;

select t.ok(t.count('select 1 from tenants') = 1, 'A enxerga uma única empresa');
select t.ok(t.count('select 1 from tenants where id = t.a()') = 1, 'e essa empresa é A');
select t.ok(t.count('select 1 from users') = 2, 'A enxerga só os usuários com vínculo em A');
select t.ok(t.count('select 1 from users where id = t.ub()') = 0, 'o usuário de B não aparece para A');

-- Busca direta por identificador de B.
select t.ok(t.count('select 1 from teams where id = t.team_b()') = 0, 'equipe de B por identificador: nada');
select t.ok(t.count('select 1 from memberships where id = t.mb()') = 0, 'vínculo de B por identificador: nada');
select t.ok(t.count('select 1 from roles where id = t.role_b()') = 0, 'perfil de B por identificador: nada');
select t.ok(t.count($$select 1 from api_keys where prefix = 'crm_test_b01'$$) = 0, 'chave de API de B: nada');
select t.ok(t.count($$select 1 from tenant_domains where domain = 'b.crm.test'$$) = 0, 'domínio de B: nada');

-- 3. Escrita cruzada. ---------------------------------------------------------
select t.throws($$insert into teams (tenant_id, name) values (t.b(), 'Intrusa')$$, '42501',
  'A não cria equipe em B');
select t.throws($$update teams set tenant_id = t.b() where id = t.team_a()$$, '42501',
  'A não move uma equipe sua para B');
select t.ok(t.affected($$update teams set name = 'Alterada' where id = t.team_b()$$) = 0,
  'A não altera equipe de B');
select t.ok(t.affected($$delete from memberships where tenant_id = t.b()$$) = 0,
  'A não apaga vínculos de B');
select t.ok(t.affected($$delete from api_keys where prefix = 'crm_test_b01'$$) = 0,
  'A não apaga chave de API de B');
select t.throws(
  $$insert into team_members (tenant_id, team_id, membership_id) values (t.a(), t.team_a(), t.mb())$$,
  '23503', 'A não põe um vínculo de B na sua equipe');
select t.throws(
  $$insert into membership_roles (tenant_id, membership_id, role_id) values (t.a(), t.ma(), t.role_b())$$,
  '23503', 'A não usa um perfil de B');
select t.throws(
  $$insert into role_permissions (tenant_id, role_id, permission, scope) values (t.b(), t.role_b(), 'deals:view', 'tenant')$$,
  '42501', 'A não concede permissão em perfil de B');

-- 4. Tabelas de plataforma e de identidade. ----------------------------------
select t.throws($$insert into tenants (name, slug) values ('Nova', 'nova')$$, '42501',
  'a aplicação não cria empresa');
select t.throws($$update tenants set status = 'active' where id = t.a()$$, '42501',
  'a aplicação não muda o estado da empresa');
select t.ok(t.affected($$update tenants set name = 'Empresa A' where id = t.a()$$) = 1,
  'A edita o próprio nome');
select t.ok(t.affected($$update tenants set name = 'Invadida' where id = t.b()$$) = 0,
  'A não edita o nome de B');

select t.throws('select password_hash from users', '42501', 'a senha não é legível pela aplicação');
select t.throws('select totp_secret_enc from users', '42501', 'o segredo de 2FA não é legível pela aplicação');
select t.throws($$update users set email = 'outro@a.test' where id = t.ua()$$, '42501',
  'o e-mail não é alterável direto na tabela');
select t.ok(t.affected($$update users set name = 'Ana de A' where id = t.ua()$$) = 1,
  'a pessoa altera o próprio nome');
select t.ok(t.affected($$update users set name = 'Outra' where id = t.uab()$$) = 0,
  'a pessoa não altera o nome de um colega');

-- 5. Auditoria só aceita inserção, e só da própria empresa. -------------------
select t.ok(
  t.affected($$insert into audit_log (tenant_id, actor_type, actor_id, action) values (t.a(), 'user', t.ua(), 'team.created')$$) = 1,
  'A grava auditoria de A');
select t.throws(
  $$insert into audit_log (tenant_id, actor_type, actor_id, action) values (t.b(), 'user', t.ua(), 'team.created')$$,
  '42501', 'A não grava auditoria em nome de B');
select t.throws($$update audit_log set action = 'x.y'$$, '42501', 'auditoria não é alterável pela aplicação');
select t.throws('delete from audit_log', '42501', 'auditoria não é apagável pela aplicação');
select t.throws($$insert into auth_events (kind) values ('login.ok')$$, '42501',
  'eventos de autenticação só entram por função');

-- 6. O mesmo, visto de B. -----------------------------------------------------
select t.ctx(t.b(), t.ub());
select t.ok(t.count('select 1 from teams where tenant_id = t.a()') = 0, 'B não vê equipe de A');
select t.ok(t.count('select 1 from audit_log where tenant_id = t.a()') = 0, 'B não vê auditoria de A');
select t.ok(t.count('select 1 from users where id = t.ua()') = 0, 'B não vê usuário só de A');
select t.ok(t.count('select 1 from users where id = t.uab()') = 1, 'B vê quem tem vínculo nas duas');

select t.ctx(null, null);
reset role;

-- 7. Regras que valem até para o dono do banco. -------------------------------
select t.throws(
  $$insert into team_members (tenant_id, team_id, membership_id) values (t.a(), t.team_a(), t.mb())$$,
  '23503', 'a chave composta barra a relação cruzada mesmo sem RLS');
select t.throws($$update audit_log set action = 'x.y' where tenant_id = t.a()$$, '42501',
  'o gatilho barra alteração de auditoria mesmo para o dono');
select t.throws($$delete from audit_log where tenant_id = t.a()$$, '42501',
  'o gatilho barra exclusão de auditoria mesmo para o dono');
select t.throws($$delete from auth_events$$, '42501',
  'o gatilho barra exclusão de eventos de autenticação');

-- 8. Papel da plataforma. -----------------------------------------------------
set role crm_platform;
select t.ok(t.count('select 1 from tenants') = 2, 'a plataforma lista todas as empresas');
select t.ok(t.affected($$update tenants set status = 'suspended' where id = t.b()$$) = 1,
  'a plataforma suspende uma empresa');
select t.ok(t.affected($$update tenants set status = 'active' where id = t.b()$$) = 1,
  'a plataforma reativa uma empresa');
select t.throws('select count(*) from memberships', '42501', 'a plataforma não lê vínculos de empresas');
select t.throws('select count(*) from users', '42501', 'a plataforma não lê usuários direto na tabela');
select t.throws('select count(*) from audit_log', '42501', 'a plataforma não lê a auditoria das empresas');
reset role;
