// A versão nova só fica saudável depois que o banco tem as migrações dela.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledMigrations } from '../src/health/health.controller.js';
import { Browser, createDatabase, dropDatabase, startApi, type Fixture } from './helpers.js';

let f: Fixture;

before(async () => {
  f = await createDatabase();
});

after(async () => {
  if (f) await dropDatabase(f);
});

test('as migrações desta versão são encontradas', () => {
  const m = bundledMigrations();
  assert.ok(m && m.includes('0001_fundacao') && m.includes('0004_crm'));
});

test('migração pendente deixa a API fora de serviço até ser aplicada', async () => {
  const saved = (await f.admin.query("select checksum from ctl.migrations where name = '0004_crm'")).rows[0];
  await f.admin.query("delete from ctl.migrations where name = '0004_crm'");
  const { app } = await startApi(f);
  try {
    const b = new Browser(app);
    const r = await b.get('/api/healthz');
    assert.equal(r.status, 503);
    assert.equal(r.body.type, 'migrations-pending');
    assert.equal((await b.get('/api/readyz')).status, 503);
    await f.admin.query("insert into ctl.migrations (name, checksum) values ('0004_crm', $1)", [saved.checksum]);
    assert.equal((await b.get('/api/healthz')).status, 200);
    assert.equal((await b.get('/api/readyz')).status, 200);
  } finally {
    await app.close();
  }
});
