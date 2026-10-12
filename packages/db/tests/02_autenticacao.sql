-- Funções de autenticação e de sessão, chamadas pelo papel da aplicação
-- antes de existir contexto de empresa.

set role crm_app;
select t.ctx(null, null);

select t.ok(
  (select password_hash = 'hash-a' and status = 'active' and not totp_enabled from app.auth_find_user('  A@A.test ')),
  'auth_find_user acha por e-mail, sem diferenciar maiúsculas e espaços');
select t.ok(t.count($$select 1 from app.auth_find_user('nao@existe.test')$$) = 0,
  'auth_find_user devolve vazio para e-mail desconhecido');

select t.ok(t.count('select 1 from app.auth_user_tenants(t.uab())') = 2,
  'quem tem dois vínculos recebe as duas empresas');
select t.ok(t.count('select 1 from app.auth_user_tenants(t.ua())') = 1,
  'quem tem um vínculo recebe uma empresa');

select t.ok((select tenant_id = t.a() from app.auth_resolve_domain('A.crm.test')),
  'o domínio leva à empresa certa');
select t.ok(t.count($$select 1 from app.auth_resolve_domain('desconhecido.test')$$) = 0,
  'domínio desconhecido não leva a empresa nenhuma');

-- Sessão: criar, escolher empresa, validar, revogar.
create temp table s (id uuid);
insert into s select app.session_create(t.ua(), '\xaa01', now() + interval '8 hours', '10.0.0.1', 'teste');

select t.ok(
  (select user_id = t.ua() and tenant_id is null and membership_id is null from app.session_find('\xaa01')),
  'sessão nova é encontrada, ainda sem empresa');
select t.ok(t.count($$select 1 from app.session_find('\xdead')$$) = 0,
  'token desconhecido não acha sessão');

select t.throws($$select app.session_set_tenant((select id from s), t.b())$$, '42501',
  'a sessão não entra em empresa onde a pessoa não tem vínculo');
select app.session_set_tenant((select id from s), t.a());
select t.ok(
  (select tenant_id = t.a() and membership_id = t.ma() from app.session_find('\xaa01')),
  'a sessão entra na empresa onde há vínculo ativo');

select t.throws($$select app.session_create(t.ua(), '\xaa02', now() - interval '1 minute', null, null)$$, '22023',
  'sessão não nasce já vencida');
select t.throws($$insert into sessions (user_id, token_hash, expires_at) values (t.ua(), '\xaa03', now() + interval '1 hour')$$,
  '42501', 'a aplicação não insere sessão direto na tabela');
select t.throws('select token_hash from sessions', '42501', 'o hash do token não é legível pela aplicação');

select t.ctx(null, t.ua());
select t.ok(t.count('select 1 from sessions') = 1, 'a pessoa lista as próprias sessões');
select t.ctx(null, t.ub());
select t.ok(t.count('select 1 from sessions') = 0, 'e não as de outra pessoa');
select t.ctx(null, null);

-- Empresa suspensa, vínculo desativado e usuário desativado derrubam a sessão.
reset role;
update tenants set status = 'suspended' where id = t.a();
set role crm_app;
select t.ok(t.count($$select 1 from app.session_find('\xaa01')$$) = 0, 'empresa suspensa invalida a sessão');
select t.ok(t.count('select 1 from app.auth_user_tenants(t.ua())') = 0, 'empresa suspensa some da lista de empresas');
select t.ok((select tenant_status = 'suspended' from app.auth_resolve_domain('a.crm.test')),
  'o domínio de empresa suspensa informa o estado');
reset role;
update tenants set status = 'active' where id = t.a();
update memberships set status = 'disabled' where id = t.ma();
set role crm_app;
select t.ok(t.count($$select 1 from app.session_find('\xaa01')$$) = 0, 'vínculo desativado invalida a sessão');
reset role;
update memberships set status = 'active' where id = t.ma();
update users set status = 'disabled' where id = t.ua();
set role crm_app;
select t.ok(t.count($$select 1 from app.session_find('\xaa01')$$) = 0, 'usuário desativado invalida a sessão');
select t.throws($$select app.session_create(t.ua(), '\xaa04', now() + interval '1 hour', null, null)$$, '42501',
  'usuário desativado não abre sessão');
reset role;
update users set status = 'active' where id = t.ua();
set role crm_app;
select t.ok(t.count($$select 1 from app.session_find('\xaa01')$$) = 1, 'com tudo ativo de novo, a sessão volta a valer');

-- Vencimento e revogação.
reset role;
update sessions set expires_at = now() - interval '1 second' where token_hash = '\xaa01';
set role crm_app;
select t.ok(t.count($$select 1 from app.session_find('\xaa01')$$) = 0, 'sessão vencida não vale');
reset role;
update sessions set expires_at = now() + interval '1 hour' where token_hash = '\xaa01';
set role crm_app;

select app.session_mark_mfa((select id from s));
select t.ok((select mfa_verified_at is not null from app.session_find('\xaa01')), 'a confirmação de 2FA fica registrada na sessão');

select app.session_revoke((select id from s));
select t.ok(t.count($$select 1 from app.session_find('\xaa01')$$) = 0, 'sessão revogada não vale');
select t.throws($$select app.session_set_tenant((select id from s), t.a())$$, '42501',
  'sessão revogada não troca de empresa');

insert into s select app.session_create(t.uab(), '\xab01', now() + interval '1 hour', null, null);
insert into s select app.session_create(t.uab(), '\xab02', now() + interval '1 hour', null, null);
select t.ok(app.session_revoke_all(t.uab()) = 2, 'revogar tudo encerra todas as sessões da pessoa');
select t.ok(t.count($$select 1 from app.session_find('\xab01')$$) = 0, 'e nenhuma delas vale depois');

-- Eventos de autenticação entram por função e ficam visíveis só para a empresa.
select app.auth_record_event('login.failed', null, t.a(), 'X@A.test', '10.0.0.9', 'teste', '{"motivo":"senha"}');
select t.ctx(t.a(), null);
select t.ok(t.count($$select 1 from auth_events where kind = 'login.failed' and email = 'x@a.test'$$) = 1,
  'A vê o evento de login da própria empresa');
select t.ctx(t.b(), null);
select t.ok(t.count($$select 1 from auth_events where kind = 'login.failed'$$) = 0,
  'B não vê evento de login de A');

select t.ctx(null, null);
reset role;
