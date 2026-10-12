-- Senha, força bruta, verificação em duas etapas, nova senha por link e convites.

set role crm_app;
select t.ctx(null, null);

-- Perfil
select t.ok((select email = 'a@a.test' and not is_platform_admin and not totp_enabled from app.auth_user_profile(t.ua())),
  'auth_user_profile devolve o perfil sem a senha');

-- Troca de senha encerra as outras sessões, mantendo a atual.
create temp table s2 (id uuid);
insert into s2 select app.session_create(t.ub(), '\xbb01', now() + interval '1 hour', null, null);
insert into s2 select app.session_create(t.ub(), '\xbb02', now() + interval '1 hour', null, null);
select app.auth_set_password(t.ub(), 'novo-hash-de-senha-com-mais-de-vinte', (select app_s.session_id from app.session_find('\xbb01') app_s));
select t.ok(t.count($$select 1 from app.session_find('\xbb01')$$) = 1, 'a troca de senha mantém a sessão atual');
select t.ok(t.count($$select 1 from app.session_find('\xbb02')$$) = 0, 'a troca de senha encerra as outras sessões');
select t.ok(app.auth_password_hash(t.ub()) = 'novo-hash-de-senha-com-mais-de-vinte', 'a senha nova fica gravada');
select t.throws($$select app.auth_set_password(t.ub(), 'curto', null)$$, '22023', 'hash de senha curto é recusado');

-- Força bruta: contagem por e-mail desde o último login certo, e por IP.
select app.auth_record_event('login.failed', null, null, 'alvo@x.test', '10.9.9.9', null);
select app.auth_record_event('login.failed', null, null, 'alvo@x.test', '10.9.9.9', null);
select app.auth_record_event('login.failed', null, null, 'outro@x.test', '10.9.9.9', null);
select t.ok((select by_email = 2 and by_ip = 3 from app.auth_failure_counts('ALVO@x.test', '10.9.9.9', now() - interval '15 minutes')),
  'falhas contadas por e-mail e por IP');
select app.auth_record_event('login.ok', null, null, 'alvo@x.test', '10.9.9.9', null);
select t.ok((select by_email = 0 from app.auth_failure_counts('alvo@x.test', '10.9.9.9', now() - interval '15 minutes')),
  'um login certo zera a contagem do e-mail');
select t.ok((select by_email = 0 and by_ip = 0 from app.auth_failure_counts('alvo@x.test', '10.9.9.9', now() + interval '1 minute')),
  'falhas fora da janela não contam');

-- Verificação em duas etapas
select t.ok((select secret_enc is null and not enabled from app.auth_totp_secret(t.ua())), 'sem 2FA, não há segredo');
select app.auth_totp_begin(t.ua(), '\xc0ffee');
select t.ok((select secret_enc = '\xc0ffee' and not enabled from app.auth_totp_secret(t.ua())), 'segredo pendente fica guardado');
select t.throws($$select app.auth_totp_enable(t.ua(), array['\x01','\x02']::bytea[])$$, '22023', 'menos de 8 códigos de recuperação é recusado');
select app.auth_totp_enable(t.ua(), array['\x01','\x02','\x03','\x04','\x05','\x06','\x07','\x08']::bytea[]);
select t.ok((select enabled from app.auth_totp_secret(t.ua())), '2FA ativado');
select t.ok((select totp_enabled from app.auth_user_profile(t.ua())), 'o perfil mostra 2FA ativo');
select t.throws($$select app.auth_totp_begin(t.ua(), '\xbad0')$$, '42501', 'não troca o segredo com 2FA ativo');
select t.ok(app.auth_use_recovery_code(t.ua(), '\x03'), 'código de recuperação vale uma vez');
select t.ok(not app.auth_use_recovery_code(t.ua(), '\x03'), 'e não vale a segunda');
select t.ok(not app.auth_use_recovery_code(t.ub(), '\x04'), 'código de uma pessoa não vale para outra');
select t.ok(app.auth_recovery_codes_left(t.ua()) = 7, 'restam 7 códigos');
select t.throws('select count(*) from mfa_recovery_codes', '42501', 'códigos de recuperação não são legíveis pela aplicação');
select app.auth_totp_disable(t.ua());
select t.ok((select secret_enc is null and not enabled from app.auth_totp_secret(t.ua())), 'desativar apaga o segredo');
select t.ok(app.auth_recovery_codes_left(t.ua()) = 0, 'e os códigos');

-- Nova senha por link
select t.ok(app.auth_password_reset_create('naoexiste@x.test', '\xd001', now() + interval '1 day') = 'unknown',
  'e-mail desconhecido não gera link');
select t.ok(app.auth_password_reset_create('A@A.test', '\xd002', now() + interval '1 day') = 'created', 'link criado');
select app.auth_password_reset_create('a@a.test', '\xd003', now() + interval '1 day');
select app.auth_password_reset_create('a@a.test', '\xd004', now() + interval '1 day');
select t.ok(app.auth_password_reset_create('a@a.test', '\xd005', now() + interval '1 day') = 'throttled',
  'o quarto pedido em 10 minutos é segurado');
insert into s2 select app.session_create(t.ua(), '\xaa10', now() + interval '1 hour', null, null);
select t.ok(app.auth_password_reset_consume('\xd003', 'senha-redefinida-pelo-link-0001') = t.ua(), 'o link troca a senha');
select t.ok(app.auth_password_hash(t.ua()) = 'senha-redefinida-pelo-link-0001', 'a senha nova vale');
select t.ok(app.auth_password_reset_consume('\xd003', 'outra-senha-pelo-mesmo-link-01') is null, 'o link não vale duas vezes');
select t.ok(app.auth_password_reset_consume('\xd002', 'outra-senha-por-link-antigo-01') is null, 'usar um link invalida os outros');
select t.ok(t.count($$select 1 from app.session_find('\xaa10')$$) = 0, 'redefinir a senha encerra as sessões');
reset role;
insert into password_resets (user_id, token_hash, expires_at, created_at)
values (t.ub(), '\xd0ff', now() - interval '1 minute', now() - interval '2 days');
set role crm_app;
select t.ok(app.auth_password_reset_consume('\xd0ff', 'senha-por-link-vencido-000001') is null, 'link vencido não vale');

-- Convites: o de 00_base (novo@a.test, token \x01) cria usuário novo.
select t.ok((select tenant_name = 'Empresa A' and not user_exists from app.auth_invitation_info('\x01')), 'convite válido mostra a empresa');
select t.throws($$select * from app.auth_invitation_accept('\x01', null, '', null)$$, '22023', 'usuário novo precisa de nome e senha');
create temp table inv (user_id uuid, tenant_id uuid);
insert into inv select * from app.auth_invitation_accept('\x01', null, 'Nova Pessoa', 'hash-da-nova-pessoa-000000001');
select t.ok((select tenant_id = t.a() from inv), 'aceitar o convite liga a pessoa à empresa');
select t.ok(t.count('select 1 from app.auth_user_tenants((select user_id from inv))') = 1, 'a pessoa nova já tem a empresa');
select t.ok(t.count($$select 1 from app.auth_invitation_info('\x01')$$) = 0, 'convite aceito não vale mais');
select t.throws($$select * from app.auth_invitation_accept('\x01', null, 'De novo', 'hash-da-nova-pessoa-000000001')$$, '42501',
  'convite aceito não é aceito de novo');
select t.ctx(t.a(), null);
select t.ok(t.count($$select 1 from membership_roles mr join memberships m on m.id = mr.membership_id
  where m.user_id = (select user_id from inv) and mr.role_id = t.role_a()$$) = 1, 'o perfil do convite é aplicado');
select t.ctx(null, null);

-- Convite para quem já tem conta exige estar logado como essa conta.
reset role;
insert into invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
values (t.b(), 'a@a.test', t.role_b(), '\x05', t.mb(), now() + interval '1 day'),
       (t.b(), 'vencido@b.test', null, '\x06', t.mb(), now() - interval '1 second');
set role crm_app;
select t.ok((select user_exists from app.auth_invitation_info('\x05')), 'o convite informa que a conta já existe');
select t.throws($$select * from app.auth_invitation_accept('\x05', null, null, null)$$, '28000', 'sem login, conta existente não aceita');
select t.throws($$select * from app.auth_invitation_accept('\x05', t.ub(), null, null)$$, '28000', 'outra pessoa logada não aceita');
select t.ok((select tenant_id = t.b() from app.auth_invitation_accept('\x05', t.ua(), null, null)), 'a dona da conta aceita');
select t.ok(t.count('select 1 from app.auth_user_tenants(t.ua())') = 2, 'e passa a ter as duas empresas');
select t.ok(t.count($$select 1 from app.auth_invitation_info('\x06')$$) = 0, 'convite vencido não vale');

-- Encerrar sessão própria
insert into s2 select app.session_create(t.ub(), '\xbb03', now() + interval '1 hour', null, null);
select t.ok(not app.session_revoke_own((select session_id from app.session_find('\xbb03')), t.ua()),
  'ninguém encerra a sessão de outra pessoa');
select t.ok(app.session_revoke_own((select session_id from app.session_find('\xbb03')), t.ub()),
  'a pessoa encerra a própria sessão');

reset role;
