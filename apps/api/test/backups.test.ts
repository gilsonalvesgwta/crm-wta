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

  test('a API sobrevive às conexões derrubadas (troca do banco na restauração completa)', async () => {
    await owner.get('/api/v1/platform/tenants');
    await f.admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and usename = 'crm_api'`, [f.dbName]);
    await new Promise((r) => setTimeout(r, 200));
    let status = 0;
    for (let i = 0; i < 3 && status !== 200; i++) status = (await owner.get('/api/v1/platform/tenants')).status;
    assert.equal(status, 200);
  });

  test('só o administrador geral vê; excluir uma cópia', async () => {
    assert.equal((await admin.get('/api/v1/platform/backups')).status, 404);
    assert.equal((await admin.raw(`/api/v1/platform/backups/${copy}/download`)).status, 404);
    assert.equal((await owner.del(`/api/v1/platform/backups/${copy}`)).status, 204);
    assert.equal((await owner.get('/api/v1/platform/backups')).body.items.some((i: { name: string }) => i.name === copy), false);
  });
});

describe('cópias dentro da empresa', () => {
  let adminB: Browser;
  let seller: Browser;
  let mine: string;

  before(async () => {
    await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
    await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
    adminB = await login('admin@b.test', true);
    seller = await login('vendas@a.test', true);
    await f.admin.query(`insert into contacts (tenant_id, first_name) values ($1, 'Contato da A')`, [f.tenantA]);
  });

  test('o administrador da empresa faz a cópia só da própria empresa', async () => {
    const empty = await admin.get('/api/v1/backups');
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.available, true);
    assert.equal(empty.body.retentionDays, 7);
    assert.deepEqual(empty.body.items, []);

    const r = await admin.post('/api/v1/backups');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.type, 'backup_tenant');
    await agent.tick(null);
    const j = await admin.get(`/api/v1/backups/jobs/${r.body.id}`);
    assert.equal(j.body.status, 'done', JSON.stringify(j.body));

    const o = await admin.get('/api/v1/backups');
    assert.equal(o.body.items.length, 1);
    mine = o.body.items[0].name;
    assert.match(mine, /-empresa\.tar$/);
    assert.equal(Date.parse(o.body.items[0].expiresAt) - Date.parse(o.body.items[0].createdAt), 7 * 86_400_000);
    assert.equal(o.body.jobs[0].id, r.body.id);
    assert.equal(o.body.items[0].tables, undefined, 'não expõe detalhes internos');

    const d = await admin.raw(`/api/v1/backups/${mine}/download`);
    assert.equal(d.status, 200);
    assert.deepEqual(d.body, readFileSync(path.join(dir, 'empresas', f.tenantA, mine)));
  });

  test('outra empresa não vê, não baixa e não restaura a cópia', async () => {
    const o = await adminB.get('/api/v1/backups');
    assert.equal(o.status, 200);
    assert.deepEqual(o.body.items, []);
    assert.deepEqual(o.body.jobs, []);
    assert.equal((await adminB.raw(`/api/v1/backups/${mine}/download`)).status, 404);
    assert.equal((await adminB.post(`/api/v1/backups/${mine}/restore`, { confirm: 'RESTAURAR' })).status, 404);
    assert.equal((await adminB.del(`/api/v1/backups/${mine}`)).status, 404);
    const jobs = (await owner.get('/api/v1/platform/backups')).body.jobs;
    assert.equal((await adminB.get(`/api/v1/backups/jobs/${jobs[0].id}`)).status, 404);
    assert.equal((await admin.get('/api/v1/platform/backups')).status, 404, 'a empresa não vê as cópias da plataforma');
  });

  test('quem não administra a empresa não usa as cópias', async () => {
    assert.equal((await seller.get('/api/v1/backups')).status, 403);
    assert.equal((await seller.post('/api/v1/backups')).status, 403);
    assert.equal((await seller.raw(`/api/v1/backups/${mine}/download`)).status, 403);
  });

  test('restaurar a cópia da empresa, com confirmação', async () => {
    await f.admin.query(`delete from contacts where tenant_id = $1`, [f.tenantA]);
    const url = `/api/v1/backups/${mine}/restore`;
    assert.equal((await admin.post(url, {})).status, 422, 'sem digitar RESTAURAR');
    const r = await admin.post(url, { confirm: 'RESTAURAR' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await agent.tick(null);
    const j = await admin.get(`/api/v1/backups/jobs/${r.body.id}`);
    assert.equal(j.body.status, 'done', JSON.stringify(j.body));
    const n = await f.admin.query(`select count(*)::int as n from contacts where tenant_id = $1 and first_name = 'Contato da A'`, [f.tenantA]);
    assert.equal(n.rows[0].n, 1);
    const b = await f.admin.query(`select count(*)::int as n from contacts where tenant_id = $1`, [f.tenantB]);
    assert.equal(b.rows[0].n, 1, 'a outra empresa não muda');
    // O administrador continua conectado e vê a cópia de segurança feita antes.
    const o = await admin.get('/api/v1/backups');
    assert.equal(o.status, 200);
    assert.equal(o.body.items.length, 2);
  });

  test('excluir uma cópia da empresa', async () => {
    assert.equal((await admin.del(`/api/v1/backups/${mine}`)).status, 204);
    const o = await admin.get('/api/v1/backups');
    assert.equal(o.body.items.some((i: { name: string }) => i.name === mine), false);
    assert.equal((await admin.del(`/api/v1/backups/${mine}`)).status, 404);
  });
});
