import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { bootstrap } from '../src/cli/bootstrap.js';
import { ROLE_TEMPLATES } from '../src/domain/permissions.js';
import { Browser, createDatabase, dropDatabase, startApi, type Fixture } from './helpers.js';

let f: Fixture;
let app: NestFastifyApplication;

before(async () => {
  f = await createDatabase();
  ({ app } = await startApi(f));
});
after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

const env = () => ({
  ADMIN_DATABASE_URL: f.adminUrl,
  BOOTSTRAP_EMAIL: 'Dono@WTA.test',
  BOOTSTRAP_NAME: 'Dono da WTA',
  BOOTSTRAP_PASSWORD: 'senha inicial forte 2026',
});

test('senha fraca impede a primeira configuração', async () => {
  await assert.rejects(bootstrap({ ...env(), BOOTSTRAP_PASSWORD: '12345678' }), /BOOTSTRAP_PASSWORD/);
  const r = await f.admin.query("select count(*)::int as n from tenants where slug = 'wta'");
  assert.equal(r.rows[0].n, 0, 'nada fica pela metade');
});

test('cria a empresa WTA, o superadministrador e os perfis', async () => {
  const r = await bootstrap(env());
  const t = await f.admin.query('select name, slug from tenants where id = $1', [r.tenantId]);
  assert.deepEqual(t.rows[0], { name: 'WTA Gestão e Automações', slug: 'wta' });
  const roles = await f.admin.query('select count(*)::int as n from roles where tenant_id = $1', [r.tenantId]);
  assert.equal(roles.rows[0].n, ROLE_TEMPLATES.length);
  const u = await f.admin.query('select email, is_platform_admin from users where id = $1', [r.userId]);
  assert.deepEqual(u.rows[0], { email: 'dono@wta.test', is_platform_admin: true });
});

test('rodar de novo não duplica nada nem troca a senha', async () => {
  const first = await f.admin.query("select password_hash from users where email = 'dono@wta.test'");
  const r = await bootstrap({ ...env(), BOOTSTRAP_PASSWORD: 'outra senha que seria ignorada' });
  const again = await f.admin.query("select password_hash from users where email = 'dono@wta.test'");
  assert.equal(again.rows[0].password_hash, first.rows[0].password_hash);
  const counts = await f.admin.query(
    `select (select count(*) from tenants where slug = 'wta')::int as t,
            (select count(*) from memberships where tenant_id = $1)::int as m,
            (select count(*) from roles where tenant_id = $1)::int as r`, [r.tenantId]);
  assert.deepEqual(counts.rows[0], { t: 1, m: 1, r: ROLE_TEMPLATES.length });
});

test('o dono entra como administrador da WTA', async () => {
  const b = new Browser(app);
  const r = await b.login('dono@wta.test', 'senha inicial forte 2026');
  assert.equal(r.status, 200);
  const me = await b.get('/api/v1/auth/me');
  assert.equal(me.body.user.isPlatformAdmin, true);
  assert.equal(me.body.permissions['users:admin'], 'tenant');
  const br = await b.get('/api/v1/branding');
  assert.equal(br.body.customized, false, 'a WTA começa com o tema padrão');
  assert.equal(br.body.theme.primary, '#FF6600');
});
