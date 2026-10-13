// Verificação em duas etapas desligada pela variável EXIGIR_2FA (REQUIRE_MFA=false),
// para o período de testes. O padrão (exigida) é coberto por admin.test.ts.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { loadConfig } from '../src/config.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';

let f: Fixture;
let app: NestFastifyApplication;

before(async () => {
  f = await createDatabase();
  ({ app } = await startApi(f, { REQUIRE_MFA: 'false' }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'dono@plataforma.test', [{ tenant: f.tenantA, role: 'admin' }], { platformAdmin: true });
});

after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

test('o padrão é exigir; só "false" ou "0" desliga', () => {
  const base = { DATABASE_URL: 'x', APP_URL: 'https://x.test', MASTER_KEYS: `1:${Buffer.alloc(32).toString('base64')}` };
  assert.equal(loadConfig(base).REQUIRE_MFA, true);
  assert.equal(loadConfig({ ...base, REQUIRE_MFA: 'true' }).REQUIRE_MFA, true);
  assert.equal(loadConfig({ ...base, REQUIRE_MFA: 'false' }).REQUIRE_MFA, false);
  assert.equal(loadConfig({ ...base, REQUIRE_MFA: '0' }).REQUIRE_MFA, false);
});

test('administrador sem 2FA abre as áreas administrativas e a plataforma', async () => {
  const b = new Browser(app, '10.40.0.1');
  assert.equal((await b.login('admin@a.test')).status, 200);
  const me = await b.get('/api/v1/auth/me');
  assert.equal(me.body.mfa.adminRequired, false);
  assert.equal((await b.get('/api/v1/members')).status, 200);
  assert.equal((await b.get('/api/v1/roles')).status, 200);
  const p = new Browser(app, '10.40.0.2');
  await p.login('dono@plataforma.test');
  assert.equal((await p.get('/api/v1/platform/tenants')).status, 200);
});

test('quem ativou a 2FA continua precisando do código para entrar', async () => {
  const b = new Browser(app, '10.40.0.3');
  await b.login('admin@a.test');
  const s = await b.post('/api/v1/auth/mfa/setup');
  assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  const again = new Browser(app, '10.40.0.4');
  await again.login('admin@a.test');
  assert.equal((await again.get('/api/v1/members')).body.type, 'mfa-pending');
  // Com a exigência desligada, o administrador pode desligar a própria 2FA.
  const off = await b.post('/api/v1/auth/mfa/disable', { password: 'senha forte de teste 2026' });
  assert.equal(off.status, 204);
});
