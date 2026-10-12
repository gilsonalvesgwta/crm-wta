import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHash } from 'node:crypto';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import type { MemoryMailer } from '../src/infra/mailer.js';
import { Browser, PASSWORD, createDatabase, createUser, dropDatabase, startApi, tokenFromMail, type Fixture } from './helpers.js';

let f: Fixture;
let app: NestFastifyApplication;
let mailer: MemoryMailer;

before(async () => {
  f = await createDatabase();
  ({ app, mailer } = await startApi(f));
  await createUser(f, 'ana@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'beto@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'carla@ab.test', [{ tenant: f.tenantA, role: 'sales' }, { tenant: f.tenantB, role: 'viewer' }]);
  await createUser(f, 'sem.empresa@x.test', []);
  await createUser(f, 'trava@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'esqueci@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'dois.fatores@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
});

after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

describe('saúde', () => {
  test('healthz e readyz respondem sem login', async () => {
    const b = new Browser(app);
    assert.equal((await b.get('/api/healthz')).status, 200);
    const r = await b.get('/api/readyz');
    assert.equal(r.status, 200);
    assert.equal(r.body.database, 'ok');
  });

  test('rota inexistente devolve 404 no formato de problema', async () => {
    const r = await new Browser(app).get('/api/v1/nao-existe');
    assert.equal(r.status, 404);
    assert.match(String(r.headers['content-type']), /application\/problem\+json/);
    assert.equal(r.body.status, 404);
  });

  test('cabeçalhos de segurança', async () => {
    const r = await new Browser(app).get('/api/healthz');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-frame-options'], 'DENY');
  });
});

describe('login', () => {
  test('sem sessão, /me pede login', async () => {
    const r = await new Browser(app).get('/api/v1/auth/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.type, 'unauthenticated');
  });

  test('senha errada e e-mail desconhecido dão a mesma resposta', async () => {
    const b = new Browser(app, '10.1.0.1');
    const r1 = await b.login('ana@a.test', 'senha errada qualquer');
    const r2 = await b.login('ninguem@a.test', 'senha errada qualquer');
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
    assert.equal(r1.body.title, r2.body.title);
    assert.equal(b.cookie, null);
  });

  test('campos inválidos devolvem 422 com o campo', async () => {
    const r = await new Browser(app).post('/api/v1/auth/login', { email: 'isso não é e-mail', password: '' });
    assert.equal(r.status, 422);
    const fields = r.body.errors.map((e: { field: string }) => e.field).sort();
    assert.deepEqual(fields, ['email', 'password']);
  });

  test('login certo grava cookie httpOnly, Secure e SameSite=Lax e entra na única empresa', async () => {
    const b = new Browser(app, '10.1.0.2');
    const r = await b.login('ANA@a.test');
    assert.equal(r.status, 200);
    assert.equal(r.body.tenantId, f.tenantA);
    assert.equal(r.body.mfaRequired, false);
    const set = String(r.headers['set-cookie']);
    assert.match(set, /HttpOnly/i);
    assert.match(set, /Secure/i);
    assert.match(set, /SameSite=Lax/i);
    assert.doesNotMatch(set, /Expires/i, 'sem "manter conectado", o cookie é de sessão do navegador');

    const me = await b.get('/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'ana@a.test');
    assert.equal(me.body.tenantId, f.tenantA);
    assert.equal(me.body.permissions['settings:admin'], 'tenant');
  });

  test('"manter conectado" grava validade no cookie', async () => {
    const b = new Browser(app, '10.1.0.3');
    const r = await b.post('/api/v1/auth/login', { email: 'beto@a.test', password: PASSWORD, remember: true });
    assert.equal(r.status, 200);
    assert.match(String(r.headers['set-cookie']), /Expires=/i);
  });

  test('o vendedor recebe só as permissões do perfil Comercial', async () => {
    const b = new Browser(app, '10.1.0.4');
    await b.login('beto@a.test');
    const me = await b.get('/api/v1/auth/me');
    assert.equal(me.body.permissions['deals:view'], 'own');
    assert.equal(me.body.permissions['settings:admin'], undefined);
    assert.equal(me.body.permissions['users:admin'], undefined);
  });

  test('mutação sem o cabeçalho anti-CSRF é recusada', async () => {
    const b = new Browser(app, '10.1.0.5');
    await b.login('beto@a.test');
    const r = await b.req('POST', '/api/v1/auth/logout', {}, { 'x-crm-request': '0' });
    assert.equal(r.status, 403);
    assert.equal(r.body.type, 'csrf');
    assert.equal((await b.get('/api/v1/auth/me')).status, 200, 'a sessão continua');
  });

  test('sair encerra a sessão no servidor', async () => {
    const b = new Browser(app, '10.1.0.6');
    await b.login('beto@a.test');
    const stolen = b.cookie;
    assert.equal((await b.post('/api/v1/auth/logout')).status, 204);
    const other = new Browser(app);
    other.cookie = stolen;
    assert.equal((await other.get('/api/v1/auth/me')).status, 401, 'o cookie antigo não vale mais');
  });

  test('cookie forjado não abre sessão', async () => {
    const b = new Browser(app);
    b.cookie = 'crm_session=' + 'A'.repeat(43);
    assert.equal((await b.get('/api/v1/auth/me')).status, 401);
  });

  test('conta sem empresa ativa não entra', async () => {
    const r = await new Browser(app, '10.1.0.7').login('sem.empresa@x.test');
    assert.equal(r.status, 403);
    assert.equal(r.body.type, 'no-tenant');
  });
});

describe('várias empresas', () => {
  test('quem tem duas empresas escolhe uma depois do login', async () => {
    const b = new Browser(app, '10.2.0.1');
    const r = await b.login('carla@ab.test');
    assert.equal(r.body.tenantId, null);
    assert.deepEqual(r.body.tenants.map((t: { name: string }) => t.name), ['Empresa A', 'Empresa B']);

    const me = await b.get('/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.tenantId, null);
    assert.deepEqual(me.body.permissions, {});

    assert.equal((await b.post('/api/v1/auth/tenant', { tenantId: f.tenantB })).status, 204);
    const meB = await b.get('/api/v1/auth/me');
    assert.equal(meB.body.tenantId, f.tenantB);
    assert.equal(meB.body.permissions['deals:view'], 'tenant', 'na B ela é Visualizadora');
    assert.equal(meB.body.permissions['deals:edit'], undefined);

    assert.equal((await b.post('/api/v1/auth/tenant', { tenantId: f.tenantA })).status, 204);
    const meA = await b.get('/api/v1/auth/me');
    assert.equal(meA.body.permissions['deals:view'], 'own', 'na A ela é Comercial');
  });

  test('não entra em empresa onde não tem vínculo', async () => {
    const b = new Browser(app, '10.2.0.2');
    await b.login('beto@a.test');
    const r = await b.post('/api/v1/auth/tenant', { tenantId: f.tenantB });
    assert.equal(r.status, 404);
    assert.equal((await b.get('/api/v1/auth/me')).body.tenantId, f.tenantA);
  });

  test('vínculo desativado derruba a sessão naquela empresa', async () => {
    const b = new Browser(app, '10.2.0.3');
    const userId = await createUser(f, 'temporario@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
    await b.login('temporario@a.test');
    assert.equal((await b.get('/api/v1/auth/me')).status, 200);
    await f.admin.query("update memberships set status = 'disabled' where user_id = $1", [userId]);
    assert.equal((await b.get('/api/v1/auth/me')).status, 401);
  });
});

describe('força bruta', () => {
  test('cinco senhas erradas travam o e-mail por um minuto, mesmo com a senha certa', async () => {
    const b = new Browser(app, '10.3.0.1');
    for (let i = 0; i < 5; i++) assert.equal((await b.login('trava@a.test', 'errada ' + i)).status, 401);
    const r = await b.login('trava@a.test');
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) > 0);
    assert.equal(b.cookie, null);
    const blocked = await f.admin.query("select count(*)::int as n from auth_events where kind = 'login.blocked' and email = 'trava@a.test'");
    assert.equal(blocked.rows[0].n, 1);
  });

  test('o bloqueio de um e-mail não atinge outro', async () => {
    const r = await new Browser(app, '10.3.0.2').login('beto@a.test');
    assert.equal(r.status, 200);
  });

  test('cada tentativa fica registrada', async () => {
    const r = await f.admin.query(
      "select count(*)::int as n from auth_events where email = 'trava@a.test' and kind = 'login.failed' and detail->>'reason' = 'password'");
    assert.equal(r.rows[0].n, 5);
  });
});

describe('nova senha por link', () => {
  test('pedir, receber o e-mail, redefinir e entrar com a senha nova', async () => {
    const old = new Browser(app, '10.4.0.1');
    await old.login('esqueci@a.test');

    const b = new Browser(app, '10.4.0.2');
    const r = await b.post('/api/v1/auth/password/forgot', { email: 'esqueci@a.test' });
    assert.equal(r.status, 202);
    const mail = mailer.sent.find((m) => m.to === 'esqueci@a.test');
    assert.ok(mail, 'e-mail enviado');
    assert.match(mail.subject, /nova senha/);
    const token = tokenFromMail(mail.text);
    assert.match(mail.text, /^.*https:\/\/crm\.teste\.local\/redefinir-senha\?token=/m);

    const fraca = await b.post('/api/v1/auth/password/reset', { token, password: 'curta' });
    assert.equal(fraca.status, 422);

    assert.equal((await b.post('/api/v1/auth/password/reset', { token, password: 'nova senha bem comprida' })).status, 204);
    assert.equal((await b.post('/api/v1/auth/password/reset', { token, password: 'outra senha bem comprida' })).status, 422,
      'o link não vale duas vezes');
    assert.equal((await old.get('/api/v1/auth/me')).status, 401, 'as sessões antigas foram encerradas');
    assert.equal((await b.login('esqueci@a.test')).status, 401, 'a senha antiga não vale');
    assert.equal((await b.login('esqueci@a.test', 'nova senha bem comprida')).status, 200);
  });

  test('e-mail desconhecido recebe a mesma resposta e nenhum e-mail sai', async () => {
    const before = mailer.sent.length;
    const r = await new Browser(app).post('/api/v1/auth/password/forgot', { email: 'fantasma@a.test' });
    assert.equal(r.status, 202);
    assert.equal(mailer.sent.length, before);
  });

  test('o e-mail não guarda o token no banco, só o hash', async () => {
    const mail = mailer.sent.find((m) => m.to === 'esqueci@a.test')!;
    const token = tokenFromMail(mail.text);
    const r = await f.admin.query('select count(*)::int as n from password_resets where token_hash = $1',
      [createHash('sha256').update(token).digest()]);
    assert.equal(r.rows[0].n, 1);
  });
});

describe('troca de senha', () => {
  test('exige a senha atual e mantém só a sessão atual', async () => {
    const userId = await createUser(f, 'troca@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
    const b1 = new Browser(app, '10.5.0.1');
    const b2 = new Browser(app, '10.5.0.2');
    await b1.login('troca@a.test');
    await b2.login('troca@a.test');
    const wrong = await b1.post('/api/v1/auth/password/change', { currentPassword: 'errada', newPassword: 'senha nova comprida 1' });
    assert.equal(wrong.status, 422);
    const ok = await b1.post('/api/v1/auth/password/change', { currentPassword: PASSWORD, newPassword: 'senha nova comprida 1' });
    assert.equal(ok.status, 204);
    assert.equal((await b1.get('/api/v1/auth/me')).status, 200);
    assert.equal((await b2.get('/api/v1/auth/me')).status, 401);
    const ev = await f.admin.query("select count(*)::int as n from auth_events where kind = 'password.changed' and user_id = $1", [userId]);
    assert.equal(ev.rows[0].n, 1);
  });
});

describe('verificação em duas etapas', () => {
  let secret: Buffer;
  let recovery: string[];

  test('configurar e ativar com um código do aplicativo', async () => {
    const b = new Browser(app, '10.6.0.1');
    await b.login('dois.fatores@a.test');
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal(s.status, 200);
    assert.match(s.body.otpauthUri, /^otpauth:\/\/totp\//);
    secret = base32Decode(s.body.secret);

    const bad = await b.post('/api/v1/auth/mfa/enable', { code: '000000' });
    assert.equal(bad.status, 401);
    const ok = await b.post('/api/v1/auth/mfa/enable', { code: totpAt(secret, Date.now()) });
    assert.equal(ok.status, 200);
    recovery = ok.body.recoveryCodes;
    assert.equal(recovery.length, 10);

    const enc = await f.admin.query("select totp_secret_enc from users where email = 'dois.fatores@a.test'");
    assert.ok(!enc.rows[0].totp_secret_enc.includes(secret), 'o segredo fica cifrado no banco');
  });

  test('no próximo login, nada abre antes do código', async () => {
    const b = new Browser(app, '10.6.0.2');
    const r = await b.login('dois.fatores@a.test');
    assert.equal(r.body.mfaRequired, true);
    const me = await b.get('/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.mfa.pending, true);
    const blocked = await b.get('/api/v1/auth/sessions');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.type, 'mfa-pending');

    assert.equal((await b.post('/api/v1/auth/mfa/verify', { code: '123456' })).status, 401);
    assert.equal((await b.post('/api/v1/auth/mfa/verify', { code: totpAt(secret, Date.now()) })).status, 200);
    assert.equal((await b.get('/api/v1/auth/sessions')).status, 200);
  });

  test('código de recuperação vale uma vez', async () => {
    const b = new Browser(app, '10.6.0.3');
    await b.login('dois.fatores@a.test');
    const r = await b.post('/api/v1/auth/mfa/verify', { code: recovery[0]!.toUpperCase() });
    assert.equal(r.status, 200);
    assert.equal(r.body.usedRecoveryCode, true);
    assert.equal(r.body.recoveryCodesLeft, 9);

    const b2 = new Browser(app, '10.6.0.4');
    await b2.login('dois.fatores@a.test');
    assert.equal((await b2.post('/api/v1/auth/mfa/verify', { code: recovery[0]! })).status, 401);
  });

  test('administrador não pode desligar a verificação', async () => {
    const b = new Browser(app, '10.6.0.5');
    await b.login('ana@a.test');
    const s = await b.post('/api/v1/auth/mfa/setup');
    const key = base32Decode(s.body.secret);
    await b.post('/api/v1/auth/mfa/enable', { code: totpAt(key, Date.now()) });
    const r = await b.post('/api/v1/auth/mfa/disable', { password: PASSWORD });
    assert.equal(r.status, 403);
    assert.equal(r.body.type, 'mfa-mandatory');
  });
});

describe('sessões', () => {
  test('a pessoa lista e encerra as próprias sessões, e não as de outra', async () => {
    const b1 = new Browser(app, '10.7.0.1');
    const b2 = new Browser(app, '10.7.0.2');
    await b1.login('carla@ab.test');
    await b2.login('carla@ab.test');
    const list = await b1.get('/api/v1/auth/sessions');
    assert.equal(list.status, 200);
    assert.ok(list.body.items.length >= 2);
    assert.equal(list.body.items.filter((s: { current: boolean }) => s.current).length, 1);
    const other = list.body.items.find((s: { current: boolean; ip: string }) => !s.current && s.ip === '10.7.0.2');
    assert.ok(other);

    const intruder = new Browser(app, '10.7.0.3');
    await intruder.login('beto@a.test');
    assert.equal((await intruder.del(`/api/v1/auth/sessions/${other.id}`)).status, 404);
    assert.equal((await b2.get('/api/v1/auth/me')).status, 200);

    assert.equal((await b1.del(`/api/v1/auth/sessions/${other.id}`)).status, 204);
    assert.equal((await b2.get('/api/v1/auth/me')).status, 401);
  });
});

describe('convites', () => {
  async function invite(tenant: string, email: string, role: string): Promise<string> {
    const token = 'convite-' + email.replace(/[^a-z]/g, '') + '-0123456789abcdef';
    const roleId = (tenant === f.tenantA ? f.roles.a : f.roles.b).get(role);
    await f.admin.query(
      `insert into invitations (tenant_id, email, role_id, token_hash, expires_at) values ($1, $2, $3, $4, now() + interval '7 days')`,
      [tenant, email, roleId, createHash('sha256').update(token).digest()]);
    return token;
  }

  test('pessoa nova aceita, cria a conta e entra', async () => {
    const token = await invite(f.tenantA, 'nova@a.test', 'marketing');
    const b = new Browser(app, '10.8.0.1');
    const info = await b.get(`/api/v1/auth/invitations/${token}`);
    assert.equal(info.status, 200);
    assert.equal(info.body.tenantName, 'Empresa A');
    assert.equal(info.body.userExists, false);

    assert.equal((await b.post('/api/v1/auth/invitations/accept', { token, name: 'Nova', password: 'curta' })).status, 422);
    const r = await b.post('/api/v1/auth/invitations/accept', { token, name: 'Nova Pessoa', password: 'minha senha comprida' });
    assert.equal(r.status, 200);
    assert.equal(r.body.createdUser, true);
    assert.equal((await b.login('nova@a.test', 'minha senha comprida')).status, 200);
    const me = await b.get('/api/v1/auth/me');
    assert.equal(me.body.permissions['campaigns:edit'], 'tenant', 'perfil Marketing aplicado');
    assert.equal((await b.get(`/api/v1/auth/invitations/${token}`)).status, 404, 'convite usado não vale mais');
  });

  test('quem já tem conta precisa estar logado como ela', async () => {
    const token = await invite(f.tenantB, 'beto@a.test', 'viewer');
    const anon = new Browser(app, '10.8.0.2');
    const r1 = await anon.post('/api/v1/auth/invitations/accept', { token });
    assert.equal(r1.status, 403);
    assert.equal(r1.body.type, 'login-required');

    const wrong = new Browser(app, '10.8.0.3');
    await wrong.login('ana@a.test');
    assert.equal((await wrong.post('/api/v1/auth/invitations/accept', { token })).status, 403);

    const beto = new Browser(app, '10.8.0.4');
    await beto.login('beto@a.test');
    assert.equal((await beto.post('/api/v1/auth/invitations/accept', { token })).status, 200);
    const me = await beto.get('/api/v1/auth/me');
    assert.equal(me.body.tenants.length, 2);
  });
});
