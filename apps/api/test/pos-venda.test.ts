import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeEvolution } from './fakes.js';

const KEY = 'chave-global-de-teste';

let f: Fixture;
let app: NestFastifyApplication;
let evo: FakeEvolution;
let ip = 0;
let admin: Browser;
let sales: Browser;
let adminB: Browser;
let wa: string;
let pipeline: { id: string; stages: { id: string; kind: string; name: string }[] };
let salesMember: string;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.66.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const run = () => app.get(DispatcherService).runOnce();
const stage = (kind: string) => pipeline.stages.find((s) => s.kind === kind)!;
async function deal(title: string, extra: Record<string, unknown> = {}) {
  const d = await admin.post('/api/v1/deals', { pipelineId: pipeline.id, title, valueCents: 150_000, ...extra });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  return d.body.id as string;
}

before(async () => {
  f = await createDatabase();
  evo = new FakeEvolution(KEY);
  await evo.start();
  ({ app } = await startApi(f, { EVOLUTION_URL: `${evo.url}/`, EVOLUTION_API_KEY: KEY, CHANNEL_ALLOW_PRIVATE_HOSTS: 'true' }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  adminB = await login('admin@b.test', true);
  const pl = await admin.post('/api/v1/pipelines', { name: 'Consórcio' });
  assert.equal(pl.status, 201, JSON.stringify(pl.body));
  pipeline = pl.body;

  const r = await admin.post('/api/v1/channels/whatsapp', { name: 'Avisos' });
  const instance = r.body.account.instance;
  wa = r.body.account.id;
  const token = /\/evolution\/([A-Za-z0-9_-]{43})$/.exec(evo.instances.get(instance)!.webhook)![1]!;
  await new Browser(app, '10.66.9.9').req('POST', `/api/v1/webhooks/evolution/${token}`,
    { event: 'connection.update', instance, data: { instance, state: 'open', wuid: '5511988887777@s.whatsapp.net', statusReason: 200 } }, { 'x-crm-request': 'x' });
  salesMember = (await f.admin.query<{ id: string }>(`select m.id from memberships m join users u on u.id = m.user_id where u.email = 'vendas@a.test'`)).rows[0]!.id;
  await f.admin.query(`update memberships set notify_phone = '+5511977770000' where id = $1`, [salesMember]);
});

after(async () => {
  await app?.close();
  await evo?.stop();
  if (f) await dropDatabase(f);
});

describe('Data do fechamento', () => {
  test('ganho com a data em que fechou de verdade: o relatório conta naquele mês', async () => {
    const id = await deal('Carta antiga');
    const fut = await admin.post(`/api/v1/deals/${id}/move`, { stageId: stage('won').id, closedAt: '2999-01-01' });
    assert.equal(fut.status, 422, 'não aceita data no futuro');
    const r = await admin.post(`/api/v1/deals/${id}/move`, { stageId: stage('won').id, closedAt: '2025-03-15' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'won');
    assert.equal(r.body.closedAt.slice(0, 10), '2025-03-15');
    // Sem data: hoje, como sempre.
    const id2 = await deal('Carta nova');
    const r2 = await admin.post(`/api/v1/deals/${id2}/move`, { stageId: stage('won').id });
    assert.ok(Date.now() - Date.parse(r2.body.closedAt) < 60_000);
  });

  test('corrigir a data de um negócio já fechado', async () => {
    const id = await deal('Fechado hoje por engano');
    await admin.post(`/api/v1/deals/${id}/move`, { stageId: stage('won').id });
    const r = await admin.patch(`/api/v1/deals/${id}/closed-at`, { closedAt: '2026-01-10' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.closedAt.slice(0, 10), '2026-01-10');
    const open = await deal('Ainda aberto');
    assert.equal((await admin.patch(`/api/v1/deals/${open}/closed-at`, { closedAt: '2026-01-10' })).status, 409);
    assert.equal((await adminB.patch(`/api/v1/deals/${id}/closed-at`, { closedAt: '2026-01-10' })).status, 404);
  });

  test('fechar vários de uma vez com a data certa; os que não dá voltam com o motivo', async () => {
    const a = await deal('Importado A');
    const b = await deal('Importado B');
    const noValue = (await admin.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'Sem valor' })).body.id as string;
    const r = await admin.post('/api/v1/deals/bulk-close', { ids: [a, b, noValue], outcome: 'won', closedAt: '2024-11-20' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.closed, 2);
    assert.equal(r.body.skipped.length, 1);
    assert.equal(r.body.skipped[0].id, noValue);
    assert.match(r.body.skipped[0].reason, /exige/);
    const rows = await f.admin.query<{ status: string; closed_at: Date }>('select status, closed_at from deals where id = any($1::uuid[]) order by title', [[a, b]]);
    assert.ok(rows.rows.every((x) => x.status === 'won' && x.closed_at.toISOString().slice(0, 10) === '2024-11-20'));
    // Perdidos em lote: muda também a data de quem já estava perdido.
    const c = await deal('Importado C');
    const l = await admin.post('/api/v1/deals/bulk-close', { ids: [c], outcome: 'lost', closedAt: '2023-05-02' });
    assert.equal(l.body.closed, 1);
    const again = await admin.post('/api/v1/deals/bulk-close', { ids: [c], outcome: 'lost', closedAt: '2023-06-01' });
    assert.equal(again.body.closed, 1);
    assert.equal((await f.admin.query<{ closed_at: Date }>('select closed_at from deals where id = $1', [c])).rows[0]!.closed_at.toISOString().slice(0, 10), '2023-06-01');
    const other = await adminB.post('/api/v1/deals/bulk-close', { ids: [a], outcome: 'lost', closedAt: '2023-05-02' });
    assert.equal(other.body.closed, 0, 'outra empresa não fecha');
  });
});

describe('Pós-venda', () => {
  let won: string;
  let contact: string;

  test('configuração: padrão sugerido, só o administrador salva e confere o que falta', async () => {
    const s = await sales.get('/api/v1/aftersale/settings');
    assert.equal(s.status, 200);
    assert.equal(s.body.enabled, false);
    assert.match(s.body.alertText, /\{\{cliente\}\}/);
    const body = {
      enabled: true, firstDays: 30, repeatDays: 15, maxTimes: 2, sendAt: '00:00', pipelineIds: [], since: null, notifyOwner: false,
      memberIds: [salesMember], extraPhones: ['(11) 96666-5555'], whatsapp: true, accountId: wa, inApp: true,
      alertText: 'Pós-venda: {{cliente}} ({{telefone}}) fechou há {{dias}} dias — {{vez}} aviso.', customerText: 'Oi {{primeiro_nome}}, tudo certo com a sua carta?',
    };
    assert.equal((await sales.put('/api/v1/aftersale/settings', body)).status, 403);
    const bad = await admin.put('/api/v1/aftersale/settings', { ...body, accountId: null, extraPhones: ['12345678'] });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.body.errors.map((e: { field: string }) => e.field).sort(), ['accountId', 'extraPhones.0']);
    const ok = await admin.put('/api/v1/aftersale/settings', body);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.extraPhones, ['+5511966665555']);
    assert.equal((await adminB.get('/api/v1/aftersale/settings')).body.enabled, false, 'outra empresa não é afetada');
  });

  test('X dias depois do ganho: avisa a equipe por WhatsApp e no CRM, e repete a cada Y dias até o limite', async () => {
    contact = (await admin.post('/api/v1/contacts', { firstName: 'Marcos', lastName: 'Silva', phones: [{ number: '+55 11 95555-1234' }] })).body.id;
    won = await deal('Carta 300 mil', { contactId: contact });
    await admin.post(`/api/v1/deals/${won}/move`, { stageId: stage('won').id, closedAt: new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10) });
    // Os negócios fechados em 2024/2025 dos testes acima também entram (sem data "a partir de").
    const before = evo.sent.length;
    await run();
    const msgs = evo.sent.slice(before);
    const toTeam = msgs.filter((m) => JSON.stringify(m.body).includes('Marcos Silva'));
    assert.equal(new Set(toTeam.map((m) => String(m.body.number))).size, 2, 'as duas pessoas (fixa e número avulso)');
    assert.match(String(toTeam[0]!.body.text), /Pós-venda: Marcos Silva \(\(11\) 95555-1234\) fechou há 31 dias — 1º aviso\./);
    const n = await f.admin.query(`select title, link from notifications where kind = 'deal.aftersale' and membership_id = $1`, [salesMember]);
    assert.equal(n.rowCount, 1);
    assert.equal(n.rows[0].link, '/pos-venda');
    // Mesmo dia: não repete.
    const again = evo.sent.length;
    await run();
    assert.equal(evo.sent.length, again);
    // 15 dias depois: 2º aviso; depois para (limite de 2).
    await f.admin.query(`update deal_aftersale set last_notified_at = now() - interval '15 days' where deal_id = $1`, [won]);
    await run();
    assert.match(JSON.stringify(evo.sent.slice(again)), /2º aviso/);
    await f.admin.query(`update deal_aftersale set last_notified_at = now() - interval '15 days' where deal_id = $1`, [won]);
    const third = evo.sent.length;
    await run();
    assert.ok(!JSON.stringify(evo.sent.slice(third)).includes('Marcos'), 'não passa do limite');
  });

  test('tela: lista quem contatar com a mensagem pronta; "Feito" tira da lista', async () => {
    // Vendedor vê só os negócios dele.
    assert.ok(!(await sales.get('/api/v1/aftersale?tab=due')).body.items.some((x: { id: string }) => x.id === won));
    const r = await admin.get('/api/v1/aftersale?tab=due');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const item = r.body.items.find((x: { id: string }) => x.id === won);
    assert.ok(item);
    assert.equal(item.contact.phone, '+5511955551234');
    assert.equal(item.message, 'Oi Marcos, tudo certo com a sua carta?');
    assert.equal(item.notifiedCount, 2);
    assert.equal((await adminB.post(`/api/v1/aftersale/${won}/done`, {})).status, 404);
    assert.equal((await sales.post(`/api/v1/aftersale/${won}/done`, {})).status, 404, 'vendedor não marca negócio de outro');
    assert.equal((await admin.post(`/api/v1/aftersale/${won}/done`, { note: 'Ligou, está satisfeito' })).status, 200);
    assert.ok(!(await admin.get('/api/v1/aftersale?tab=due')).body.items.some((x: { id: string }) => x.id === won));
    const done = (await admin.get('/api/v1/aftersale?tab=done')).body.items.find((x: { id: string }) => x.id === won);
    assert.equal(done.note, 'Ligou, está satisfeito');
    assert.ok(done.doneBy);
    const tl = await f.admin.query(`select kind from timeline_entries where deal_id = $1 and kind like 'deal.aftersale%' order by occurred_at`, [won]);
    assert.deepEqual(tl.rows.map((x) => x.kind), ['deal.aftersale_notified', 'deal.aftersale_notified', 'deal.aftersale_done']);
    assert.equal((await admin.post(`/api/v1/aftersale/${won}/done`, { done: false })).status, 200);
    assert.ok((await admin.get('/api/v1/aftersale?tab=due')).body.items.some((x: { id: string }) => x.id === won), 'desfazer volta para a lista');
  });

  test('"a partir de": negócios antigos não entram', async () => {
    const s = (await admin.get('/api/v1/aftersale/settings')).body;
    const r = await admin.put('/api/v1/aftersale/settings', { ...s, since: new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const list = (await admin.get('/api/v1/aftersale?tab=due')).body.items.map((x: { title: string }) => x.title);
    assert.ok(list.includes('Carta 300 mil'));
    assert.ok(!list.includes('Importado A'), 'fechado em 2024 fica de fora');
  });
});
