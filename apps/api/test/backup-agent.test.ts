// Agente de cópias contra um PostgreSQL real: cópia, restauração de uma
// empresa e do banco inteiro, e cópia antiga (sem donos).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { BackupAgent, parseCopy } from '../src/backup/agent.js';
import { manifestFile } from '../src/backup/format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, here.includes('.test-out') ? '../../../..' : '../../..');
const MIGRATE = path.join(repoRoot, 'packages/db/migrate.sh');

const base = new URL(process.env.ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54330/postgres');
process.env.PGHOST = base.hostname || '127.0.0.1';
process.env.PGPORT = base.port || '5432';
process.env.PGUSER = decodeURIComponent(base.username || 'postgres');
if (base.password) process.env.PGPASSWORD = decodeURIComponent(base.password);

const DB = `crm_bk_${randomBytes(4).toString('hex')}`;
const A = '00000000-0000-4000-8000-0000000000aa';
const B = '00000000-0000-4000-8000-0000000000bb';
const UA = '00000000-0000-4000-8000-0000000001aa';

let dir: string;
let files: string;
let agent: BackupAgent;

async function q<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = [], db = DB) {
  const c = new pg.Client({ database: db });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

before(async () => {
  await q(`create database ${DB}`, [], 'postgres');
  const url = new URL(base.toString());
  url.pathname = `/${DB}`;
  execFileSync(MIGRATE, { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  await q(`insert into tenants (id, name, slug) values ($1, 'Ótica Aurora', 'otica-aurora'), ($2, 'Padaria Sol', 'padaria-sol')`, [A, B]);
  await q(`insert into users (id, email, name, password_hash) values ($1, 'dona@aurora.test', 'Dona Aurora', 'x')`, [UA]);
  await q(`insert into memberships (tenant_id, user_id) values ($1, $2)`, [A, UA]);
  await q(`insert into contacts (tenant_id, first_name, last_name) values ($1, 'Maria', 'Cliente'), ($1, 'João', null), ($2, 'Pedro', 'Padeiro')`, [A, B]);
  const plan = await q<{ id: string }>(`insert into plans (name) values ('Básico') returning id`);
  await q(`insert into tenant_subscriptions (tenant_id, plan_id, status) values ($1, $2, 'active')`, [A, plan[0]!.id]);
  dir = mkdtempSync(path.join(tmpdir(), 'crm-copias-'));
  files = mkdtempSync(path.join(tmpdir(), 'crm-arq-'));
  mkdirSync(path.join(files, A), { recursive: true });
  writeFileSync(path.join(files, A, 'contrato.pdf'), 'conteúdo da Aurora');
  mkdirSync(path.join(files, B), { recursive: true });
  writeFileSync(path.join(files, B, 'cardapio.pdf'), 'conteúdo da Padaria');
  agent = new BackupAgent({ backupDir: dir, filesDir: files, database: DB, migrateScript: MIGRATE, log: () => undefined });
});

after(async () => {
  const dbs = await q<{ datname: string }>(`select datname from pg_database where datname like $1 or datname = 'crm_restaurar'`, [`${DB}%`], 'postgres');
  for (const d of dbs) await q(`drop database if exists "${d.datname}" with (force)`, [], 'postgres');
});

let copy: string;

describe('agente de cópias', () => {
  test('lê o bloco COPY com escapes', () => {
    const rows = parseCopy('COPY public.tenants (id, name, slug) FROM stdin;\n1\tA\\tB\tx\n2\t\\N\ty\n\\.\n', 'tenants');
    assert.deepEqual(rows, [{ id: '1', name: 'A\tB', slug: 'x' }, { id: '2', name: null, slug: 'y' }]);
  });

  test('a cópia leva banco, arquivos e um manifesto com as empresas', async () => {
    const m = await agent.backupNow('manual');
    copy = m.name;
    assert.match(m.name, /^crm-\d{8}-\d{6}-manual\.tar$/);
    assert.equal(m.includesFiles, true);
    assert.deepEqual(m.tenants.map((t) => t.slug).sort(), ['otica-aurora', 'padaria-sol']);
    assert.ok(m.migrations.includes('0001_fundacao'));
    assert.ok(m.sizeBytes > 0);
    const side = JSON.parse(readFileSync(manifestFile(dir, m.name), 'utf8'));
    assert.equal(side.name, m.name);
  });

  test('restaura uma empresa excluída, sem mexer na outra', async () => {
    await q('delete from tenants where id = $1', [A]);
    execFileSync('rm', ['-rf', path.join(files, A)]);
    await q(`insert into contacts (tenant_id, first_name) values ($1, 'Cliente novo da padaria')`, [B]);

    const msg = await agent.restoreTenant(copy, A);
    assert.match(msg, /Ótica Aurora/);
    const names = (await q<{ name: string }>('select name from contacts where tenant_id = $1 order by name', [A])).map((r) => r.name);
    assert.deepEqual(names, ['João', 'Maria Cliente'], 'contatos de volta, com o nome gerado');
    assert.equal((await q('select 1 from memberships where tenant_id = $1 and user_id = $2', [A, UA])).length, 1, 'o vínculo da administradora volta');
    assert.equal((await q<{ status: string }>('select status from tenant_subscriptions where tenant_id = $1', [A]))[0]!.status, 'active');
    assert.equal((await q("select 1 from contacts where first_name = 'Cliente novo da padaria'")).length, 1, 'a outra empresa ficou como estava');
    assert.equal(readFileSync(path.join(files, A, 'contrato.pdf'), 'utf8'), 'conteúdo da Aurora', 'os arquivos da empresa voltam');
    const safety = (await import('node:fs')).readdirSync(dir).filter((f) => f.includes('antes-de-restaurar') && f.endsWith('.tar'));
    assert.equal(safety.length, 1, 'antes de restaurar, uma cópia do estado atual');
    // Os gatilhos voltam a valer depois da restauração.
    await assert.rejects(q(`update timeline_entries set kind = 'x.y' where tenant_id = $1`, [A]).then(async () => {
      await q(`insert into timeline_entries (tenant_id, kind, contact_id) select tenant_id, 'contact.created', id from contacts where tenant_id = $1 limit 1`, [A]);
      await q(`update timeline_entries set kind = 'x.y' where tenant_id = $1`, [A]);
    }));
  });

  test('restaura o banco inteiro e guarda o anterior', async () => {
    const msg = await agent.restoreFull(copy);
    assert.match(msg, /Restaurado de/);
    assert.equal((await q("select 1 from contacts where first_name = 'Cliente novo da padaria'")).length, 0, 'volta ao momento da cópia');
    assert.equal((await q('select 1 from contacts')).length, 3);
    const olds = await q<{ datname: string }>('select datname from pg_database where datname like $1', [`${DB}_anterior_%`], 'postgres');
    assert.equal(olds.length, 1);
    const own = await q<{ o: string }>(`select proowner::regrole::text as o from pg_proc where proname = 'tenant_id' and pronamespace = 'app'::regnamespace`);
    assert.equal(own[0]!.o, 'crm_owner');
    assert.ok(existsSync(path.join(files, B, 'cardapio.pdf')));
  });

  test('cópia antiga (.dump sem donos) ganha manifesto e restaura com os donos certos', async () => {
    const legacy = 'crm-20261012-033000.dump';
    execFileSync('pg_dump', ['--format=custom', '--no-owner', `--file=${path.join(dir, legacy)}`], { env: { ...process.env, PGDATABASE: DB } });
    await agent.tick(null);
    const m = JSON.parse(readFileSync(manifestFile(dir, legacy), 'utf8'));
    assert.equal(m.kind, 'antiga');
    assert.equal(m.includesFiles, false);
    assert.equal(m.tenants.length, 2);
    await agent.restoreFull(legacy);
    const own = await q<{ o: string }>(`select relowner::regrole::text as o from pg_class where relname = 'contacts' and relnamespace = 'public'::regnamespace`);
    assert.equal(own[0]!.o, 'crm_owner');
  });

  test('fila: pedido da plataforma é executado e registrado', async () => {
    const job = agent.newJob('backup', { requestedBy: 'teste' });
    writeFileSync(path.join(dir, '.trabalhos', `${job.id}.json`), JSON.stringify(job));
    await agent.tick(null);
    const done = JSON.parse(readFileSync(path.join(dir, '.trabalhos', `${job.id}.json`), 'utf8'));
    assert.equal(done.status, 'done');
    assert.match(done.result, /-manual\.tar$/);
    assert.ok(done.log.length > 0);
    const beat = JSON.parse(readFileSync(path.join(dir, '.trabalhos', 'agente.json'), 'utf8'));
    assert.ok(Date.now() - Date.parse(beat.at) < 60_000);
  });

  test('arquivo enviado que não é cópia é recusado e apagado', async () => {
    const bad = 'crm-20261001-000000-enviada.tar';
    execFileSync('tar', ['-cf', path.join(dir, bad), '-C', files, '.']);
    const job = agent.newJob('inspect', { file: bad });
    const r = await agent.runJob(job);
    assert.equal(r.status, 'failed');
    assert.match(r.error!, /não é uma cópia/);
    assert.equal(existsSync(path.join(dir, bad)), false);
  });
});
