import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';

let f: Fixture;
let app: NestFastifyApplication;
let ip = 0;
let admin: Browser;
let sales: Browser;
let adminB: Browser;
let salesMember: string;
let adminMember: string;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.64.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

/** Meio-dia (horário de Brasília) de n dias atrás, para não cair na virada do dia. */
function noonAgo(days: number, hour = 12): string {
  const local = new Date(Date.now() - 3 * 3600_000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - days, hour + 3));
  return d.toISOString();
}

const range = (days = 7) => {
  const to = new Date(Date.now() + 60_000);
  const from = new Date(to.getTime() - days * 86_400_000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
};

before(async () => {
  f = await createDatabase();
  ({ app } = await startApi(f));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  const m = async (e: string) => (await f.admin.query<{ id: string }>('select m.id from memberships m join users u on u.id = m.user_id where u.email = $1', [e])).rows[0]!.id;
  salesMember = await m('vendas@a.test');
  adminMember = await m('admin@a.test');
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  adminB = await login('admin@b.test', true);
});

after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

test('resultado da call: concluir pede o resultado, reabrir apaga', async () => {
  const c = await sales.post('/api/v1/contacts', { firstName: 'Teste Resultado' });
  const a = await sales.post('/api/v1/activities', { type: 'call', title: 'Call', startsAt: noonAgo(0, 10), contactId: c.body.id });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  let r = await sales.post(`/api/v1/activities/${a.body.id}/status`, { status: 'done', outcome: 'no_show' });
  assert.equal(r.body.outcome, 'no_show');
  r = await sales.post(`/api/v1/activities/${a.body.id}/status`, { status: 'open' });
  assert.equal(r.body.outcome, null);
  r = await sales.post(`/api/v1/activities/${a.body.id}/status`, { status: 'done' });
  assert.equal(r.body.outcome, 'held', 'sem resultado informado, conta como realizada');
  const t = await sales.post('/api/v1/activities', { type: 'task', title: 'Tarefa' });
  r = await sales.post(`/api/v1/activities/${t.body.id}/status`, { status: 'done', outcome: 'held' });
  assert.equal(r.body.outcome, null, 'tarefa comum não tem resultado');
  assert.equal((await sales.post(`/api/v1/activities/${t.body.id}/status`, { status: 'done', outcome: 'talvez' })).status, 422);
  // Fora dos números abaixo.
  await f.admin.query('delete from activities where id = any($1::uuid[])', [[a.body.id, t.body.id]]);
});

test('indicadores comerciais: contatados, calls, vendas na call e no follow-up, conversão', async () => {
  const pipes = await admin.get('/api/v1/pipelines');
  const pipelineId = pipes.body[0]?.id ?? (await admin.post('/api/v1/pipelines', { name: 'Vendas' })).body.id;
  const person = async (name: string) => (await sales.post('/api/v1/contacts', { firstName: name, phones: [{ number: `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` }] })).body.id as string;
  const call = async (contactId: string, at: string, outcome: 'held' | 'no_show') => {
    const a = await sales.post('/api/v1/activities', { type: 'call', title: 'Call de vendas', startsAt: at, contactId });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await sales.post(`/api/v1/activities/${a.body.id}/status`, { status: 'done', outcome })).status, 200);
  };
  const won = async (contactId: string, at: string, cents: number) => {
    const d = await sales.post('/api/v1/deals', { pipelineId, title: 'Venda', contactId, valueCents: cents });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    await f.admin.query("update deals set status = 'won', closed_at = $2, value_cents = $3 where id = $1", [d.body.id, at, cents]);
  };

  const [c1, c2, c3, c4, c5] = [await person('Ana'), await person('Bruno'), await person('Carla'), await person('Davi'), await person('Eva')];
  await call(c1, noonAgo(3), 'held'); await won(c1, noonAgo(3, 15), 100_000);   // na call
  await call(c2, noonAgo(3), 'held'); await won(c2, noonAgo(1, 10), 200_000);   // follow-up, 46 h depois
  await call(c3, noonAgo(2), 'no_show');                                        // não compareceu
  await call(c4, noonAgo(2), 'held');                                           // realizada, sem venda
  await won(c5, noonAgo(2), 50_000);                                            // venda sem call
  // Mensagem de alguém da equipe conta como contato; a de outra pessoa da equipe também.
  const c6 = await person('Fábio');
  await f.admin.query(
    `insert into messages (tenant_id, channel, direction, status, contact_id, remote, body, sent_by, created_at)
     values ($1, 'whatsapp', 'out', 'sent', $2, '+5511900000000', 'Oi', $3, $4),
            ($1, 'whatsapp', 'out', 'sent', $5, '+5511900000000', 'Oi de novo', $3, $4)`,
    [f.tenantA, c6, salesMember, noonAgo(1), c4]);
  await f.admin.query(
    `insert into messages (tenant_id, channel, direction, status, contact_id, remote, body, sent_by, created_at)
     values ($1, 'whatsapp', 'out', 'sent', $2, '+5511900000000', 'Do admin', $3, $4)`, [f.tenantA, c5, adminMember, noonAgo(1)]);

  const r = await admin.get(`/api/v1/dashboard/sales?${range()}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.totals;
  assert.equal(t.contacted, 5, 'Ana, Bruno e Davi (calls), Fábio e Eva (mensagens); Davi conta uma vez');
  assert.deepEqual(t.calls, { scheduled: 4, held: 3, noShow: 1, rescheduled: 0, attendanceRate: 0.75 });
  assert.equal(t.sales.onCall, 1);
  assert.equal(t.sales.followUp, 1);
  assert.equal(t.sales.withoutCall, 1);
  assert.equal(t.sales.total, 3);
  assert.equal(t.sales.valueCents, 350_000);
  assert.equal(t.sales.valueOnCallCents, 100_000);
  assert.equal(t.sales.averageFollowUpSeconds, 46 * 3600);
  assert.deepEqual(t.conversion, { people: 3, onCall: 1, followUp: 1, onCallRate: 1 / 3, followUpRate: 0.5 });
  assert.equal(r.body.previous.sales.total, 0);
  assert.equal(r.body.daily.length >= 7, true);
  assert.equal(r.body.daily.reduce((s: number, d: { held: number }) => s + d.held, 0), 3);
  assert.equal(r.body.daily.reduce((s: number, d: { contacted: number }) => s + d.contacted, 0), 6, 'por dia: Ana e Bruno, Davi, Fábio, Davi e Eva');
  const seller = r.body.sellers.find((s: { id: string }) => s.id === salesMember);
  assert.equal(seller.sales.total, 3);
  assert.equal(seller.contacted, 4);
  assert.equal(r.body.sellers.find((s: { id: string }) => s.id === adminMember).contacted, 1);

  // Filtro por vendedor e período curto.
  const only = await admin.get(`/api/v1/dashboard/sales?${range(2)}&ownerId=${adminMember}`);
  assert.equal(only.body.totals.contacted, 1);
  assert.equal(only.body.totals.sales.total, 0);

  // O comercial vê só os próprios números.
  const mine = await sales.get(`/api/v1/dashboard/sales?${range()}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.totals.contacted, 4);
  assert.deepEqual(mine.body.sellers.map((s: { id: string }) => s.id), [salesMember]);

  // Outra empresa não vê nada.
  const other = await adminB.get(`/api/v1/dashboard/sales?${range()}`);
  assert.equal(other.body.totals.contacted, 0);
  assert.equal(other.body.totals.sales.total, 0);

  assert.equal((await admin.get('/api/v1/dashboard/sales?from=2026-01-01T00:00:00Z&to=2027-06-01T00:00:00Z')).status, 422);
});
