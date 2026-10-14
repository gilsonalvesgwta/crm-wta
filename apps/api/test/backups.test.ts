import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { BackupAgent } from '../src/backup/agent.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, here.includes('.test-out') ? '../../../..' : '../../..');

let f: Fixture;
let app: NestFastifyApplication;
let dir: string;
let agent: BackupAgent;
let owner: Browser;
let admin: Browser;
let copy: string;
let ip = 0;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.70.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

before(async () => {
  f = await createDatabase();
  const u = new URL(process.env.ADMIN_URL!);
  process.env.PGHOST = u.hostname;
  process.env.PGPORT = u.port || '5432';
  process.env.PGUSER = decodeURIComponent(u.username || 'postgres');
  if (u.password) process.env.PGPASSWORD = decodeURIComponent(u.password);
  dir = mkdtempSync(path.join(tmpdir(), 'crm-copias-api-'));
  agent = new BackupAgent({
    backupDir: dir, filesDir: mkdtempSync(path.join(tmpdir(), 'crm-arq-')), database: f.dbName,
    migrateScript: path.join(repoRoot, 'packages/db/migrate.sh'), log: () => undefined,
  });
  ({ app } = await startApi(f, { BACKUP_DIR: dir }));
  await createUser(f, 'dono@plataforma.test', [{ tenant: f.tenantA, role: 'admin' }], { platformAdmin: true });
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  owner = await login('dono@plataforma.test', true);
  admin = await login('admin@a.test', true);
  await f.admin.query(`insert into contacts (tenant_id, first_name) values ($1, 'Contato da B')`, [f.tenantB]);
});

after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

describe('cópias na plataforma', () => {
  test('sem a pasta ligada, a tela avisa e não aceita pedido', async () => {
    const r = await owner.get('/api/v1/platform/backups');
    assert.equal(r.status, 200);
    assert.equal(r.body.available, false);
    assert.equal((await owner.post('/api/v1/platform/backups')).status, 409);
  });

  test('cópia agora: o pedido vai para a fila e o agente executa', async () => {
    await agent.prepareDirs();
    const r = await owner.post('/api/v1/platform/backups');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'pending');
    assert.equal((await owner.post('/api/v1/platform/backups')).status, 409, 'um trabalho por vez');
    await agent.tick(null);
    const o = await owner.get('/api/v1/platform/backups');
    assert.equal(o.body.agent.alive, true);
    assert.equal(o.body.items.length, 1);
    copy = o.body.items[0].name;
    assert.deepEqual(o.body.items[0].tenants.map((t: { name: string }) => t.name).sort(), ['Empresa A', 'Empresa B']);
    assert.equal(o.body.jobs[0].status, 'done');
    assert.equal(o.body.jobs[0].requestedBy, 'dono@plataforma.test');
    const j = await owner.get(`/api/v1/platform/backups/jobs/${r.body.id}`);
    assert.equal(j.body.result, copy);
  });

  test('baixar a cópia e enviar de volta', async () => {
    const d = await owner.raw(`/api/v1/platform/backups/${copy}/download`);
    assert.equal(d.status, 200);
    assert.match(String(d.headers['content-disposition']), new RegExp(copy));
    assert.deepEqual(d.body, readFileSync(path.join(dir, copy)));
    assert.equal((await owner.raw('/api/v1/platform/backups/..%2F..%2Fetc%2Fpasswd/download')).status, 404);

    const up = await owner.upload('/api/v1/platform/backups/upload', 'minha-copia.tar', d.body, 'application/x-tar');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.type, 'inspect');
    await agent.tick(null);
    const o = await owner.get('/api/v1/platform/backups');
    const sent = o.body.items.find((i: { kind: string }) => i.kind === 'enviada');
    assert.ok(sent);
    assert.equal(sent.tenants.length, 2);
    assert.equal((await owner.upload('/api/v1/platform/backups/upload', 'planilha.csv', 'a;b', 'text/csv')).status, 422);
  });

  test('restaurar uma empresa da cópia, com confirmação', async () => {
    await f.admin.query(`delete from contacts where tenant_id = $1`, [f.tenantB]);
    const url = `/api/v1/platform/backups/${copy}/restore`;
    assert.equal((await owner.post(url, { scope: 'tenant', tenantId: f.tenantB })).status, 422, 'sem digitar RESTAURAR');
    assert.equal((await owner.post(url, { scope: 'tenant', tenantId: '00000000-0000-4000-8000-000000000000', confirm: 'RESTAURAR' })).status, 422);
    const r = await owner.post(url, { scope: 'tenant', tenantId: f.tenantB, confirm: 'RESTAURAR' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await agent.tick(null);
    const j = await owner.get(`/api/v1/platform/backups/jobs/${r.body.id}`);
    assert.equal(j.body.status, 'done', JSON.stringify(j.body));
    const n = await f.admin.query(`select count(*)::int as n from contacts where tenant_id = $1`, [f.tenantB]);
    assert.equal(n.rows[0].n, 1);
    // A API continua funcionando depois da restauração.
    assert.equal((await owner.get('/api/v1/platform/tenants')).status, 200);
  });

  test('só o administrador geral vê; excluir uma cópia', async () => {
    assert.equal((await admin.get('/api/v1/platform/backups')).status, 404);
    assert.equal((await admin.raw(`/api/v1/platform/backups/${copy}/download`)).status, 404);
    assert.equal((await owner.del(`/api/v1/platform/backups/${copy}`)).status, 204);
    assert.equal((await owner.get('/api/v1/platform/backups')).body.items.some((i: { name: string }) => i.name === copy), false);
  });
});
