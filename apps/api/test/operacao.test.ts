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
let viewer: Browser;
let adminB: Browser;
let instance: string;
let token: string;
let wa: string;
let salesMember: string;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.63.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const hook = (body: unknown) => new Browser(app, '10.63.9.9').req('POST', `/api/v1/webhooks/evolution/${token}`, body, { 'x-crm-request': 'x' });
const incoming = (jid: string, id: string, text: string, at: number) => hook({
  event: 'messages.upsert', instance, destination: 'x', date_time: new Date().toISOString(), server_url: 'x', apikey: 'x',
  data: { key: { remoteJid: `${jid}@s.whatsapp.net`, fromMe: false, id }, pushName: 'Cliente', message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(at / 1000) },
});
const range = () => {
  const to = new Date(Date.now() + 60_000);
  const from = new Date(to.getTime() - 7 * 86_400_000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
};

before(async () => {
  f = await createDatabase();
  evo = new FakeEvolution(KEY);
  await evo.start();
  ({ app } = await startApi(f, { EVOLUTION_URL: `${evo.url}/`, EVOLUTION_API_KEY: KEY }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'leitor@a.test', [{ tenant: f.tenantA, role: 'viewer' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  salesMember = (await f.admin.query<{ id: string }>("select m.id from memberships m join users u on u.id = m.user_id where u.email = 'vendas@a.test'")).rows[0]!.id;
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  viewer = await login('leitor@a.test', false);
  adminB = await login('admin@b.test', true);
  const r = await admin.post('/api/v1/channels/whatsapp', { name: 'Comercial' });
  instance = r.body.account.instance;
  wa = r.body.account.id;
  token = /\/evolution\/([A-Za-z0-9_-]{43})$/.exec(evo.instances.get(instance)!.webhook)![1]!;
  await hook({ event: 'connection.update', instance, data: { instance, state: 'open', wuid: '5511988887777@s.whatsapp.net', statusReason: 200 } });
});

after(async () => {
  await app?.close();
  await evo?.stop();
  if (f) await dropDatabase(f);
});

describe('status da operação', () => {
  test('volume, tempo de resposta, fila e atendentes', async () => {
    const t0 = Math.floor((Date.now() - 3600_000) / 1000) * 1000;
    await incoming('5521911110001', 'OP-1', 'Oi', t0);
    await incoming('5521911110001', 'OP-2', 'Tem alguém?', t0 + 60_000);
    await incoming('5521911110002', 'OP-3', 'Bom dia', t0);
    // A primeira conversa é respondida 10 minutos depois pelo comercial.
    const conv = (await admin.get('/api/v1/conversations?status=all')).body.items as { id: string; contact: { name: string; phone: string } }[];
    const one = conv.find((c) => c.contact.phone === '+5521911110001')!;
    await admin.patch(`/api/v1/conversations/${one.id}`, { assigneeId: salesMember });
    await sales.post(`/api/v1/conversations/${one.id}/messages`, { accountId: wa, text: 'Olá!' });
    await f.admin.query("update messages set created_at = $1 where direction = 'out' and body = 'Olá!'", [new Date(t0 + 600_000)]);

    const r = await admin.get(`/api/v1/dashboard/operation?${range()}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.messages, { received: 3, sent: 1 });
    assert.equal(r.body.response.answered, 1);
    assert.equal(r.body.response.unanswered, 1);
    assert.equal(r.body.response.averageSeconds, 600, 'conta da primeira mensagem da vez do cliente');
    assert.deepEqual(r.body.now, { active: 2, unassigned: 1, awaitingReply: 1 });
    assert.equal(r.body.daily.length, 8);
    assert.equal(r.body.daily.reduce((s: number, d: { conversations: number }) => s + d.conversations, 0), 2);
    assert.equal(r.body.heatmap.reduce((s: number, h: { n: number }) => s + h.n, 0), 3);
    assert.equal(r.body.channels[0].channel, 'whatsapp');
    assert.equal(r.body.channels[0].received, 3);
    const agent = r.body.agents.find((a: { id: string }) => a.id === salesMember);
    assert.deepEqual([agent.active, agent.sent, agent.answered, agent.averageResponseSeconds], [1, 1, 1, 600]);

    const byChannel = await admin.get(`/api/v1/dashboard/operation?${range()}&channel=email`);
    assert.equal(byChannel.body.messages.received, 0);
    const mine = await admin.get(`/api/v1/dashboard/operation?${range()}&assigneeId=${salesMember}`);
    assert.equal(mine.body.now.active, 1);
  });

  test('cada um vê o seu alcance; outra empresa não vê nada', async () => {
    const s = await sales.get(`/api/v1/dashboard/operation?${range()}`);
    assert.equal(s.status, 200);
    // O comercial vê a sua e a sem responsável (que pode assumir).
    assert.equal(s.body.now.active, 2);
    const v = await viewer.get(`/api/v1/dashboard/operation?${range()}`);
    assert.equal(v.status, 200);
    assert.equal(v.body.messages.received, 3, 'quem vê relatórios da empresa toda vê o volume');
    const b = await adminB.get(`/api/v1/dashboard/operation?${range()}`);
    assert.equal(b.body.messages.received, 0);
    assert.equal((await admin.get('/api/v1/dashboard/operation?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z')).status, 422, 'período de até um ano');
  });
});

describe('ações agendadas', () => {
  let contactId: string;
  let scheduled: string;

  test('agendar uma mensagem; sai no horário em nome de quem agendou', async () => {
    const c = await sales.post('/api/v1/contacts', { firstName: 'Lia', phones: [{ number: '+55 31 97777-0000' }] });
    contactId = c.body.id;
    const at = new Date(Date.now() + 3600_000).toISOString();
    const r = await sales.post('/api/v1/scheduled-messages', { contactId, accountId: wa, text: 'Lembrete da reunião', sendAt: at });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    scheduled = r.body.id;
    assert.equal(r.body.status, 'pending');
    assert.equal((await sales.post('/api/v1/scheduled-messages', { contactId, accountId: wa, text: 'x', sendAt: new Date(Date.now() - 3600_000).toISOString() })).status, 422);
    const list = await sales.get('/api/v1/scheduled?kind=message');
    assert.deepEqual(list.body.items.map((i: { id: string }) => i.id), [scheduled]);
    assert.equal((await adminB.get('/api/v1/scheduled')).body.items.length, 0);

    const before = evo.sent.length;
    await app.get(DispatcherService).runOnce();
    assert.equal(evo.sent.length, before, 'antes da hora não sai');
    await f.admin.query("update scheduled_messages set send_at = now() - interval '1 second' where id = $1", [scheduled]);
    await app.get(DispatcherService).runOnce();
    assert.equal(evo.sent.at(-1)!.body.text, 'Lembrete da reunião');
    const done = await sales.get('/api/v1/scheduled?kind=message&status=done');
    assert.equal(done.body.items[0].status, 'sent');
    const m = await f.admin.query<{ sent_by: string }>("select sent_by from messages where body = 'Lembrete da reunião'");
    assert.equal(m.rows[0]!.sent_by, salesMember);
  });

  test('mudar o horário e cancelar só antes de sair; a lista junta tarefas e automações', async () => {
    const r = await sales.post('/api/v1/scheduled-messages', { contactId, accountId: wa, text: 'Outra', sendAt: new Date(Date.now() + 7200_000).toISOString() });
    const moved = await sales.patch(`/api/v1/scheduled-messages/${r.body.id}`, { sendAt: new Date(Date.now() + 86_400_000).toISOString(), text: 'Outra, amanhã' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.body, 'Outra, amanhã');
    assert.equal((await sales.post(`/api/v1/scheduled-messages/${r.body.id}/cancel`)).body.status, 'canceled');
    assert.equal((await sales.post(`/api/v1/scheduled-messages/${r.body.id}/cancel`)).status, 409);
    assert.equal((await sales.patch(`/api/v1/scheduled-messages/${scheduled}`, { text: 'x' })).status, 409, 'a que já saiu não muda');
    // Outra pessoa (fora do alcance) não mexe.
    const other = await admin.post('/api/v1/scheduled-messages', { contactId, accountId: wa, text: 'Do admin', sendAt: new Date(Date.now() + 3600_000).toISOString() });
    assert.equal((await sales.post(`/api/v1/scheduled-messages/${other.body.id}/cancel`)).status, 404);

    await sales.post('/api/v1/activities', { title: 'Ligar para a Lia', type: 'call', startsAt: new Date(Date.now() + 3600_000).toISOString(), contactId });
    const all = await sales.get('/api/v1/scheduled');
    assert.deepEqual(Object.keys(all.body.counts).sort(), ['automation', 'campaign', 'message', 'task']);
    assert.equal(all.body.items.some((i: { kind: string; title: string }) => i.kind === 'task' && i.title === 'Ligar para a Lia'), true);
    const byContact = await admin.get(`/api/v1/scheduled?contactId=${contactId}`);
    assert.equal(byContact.body.items.some((i: { title: string }) => i.title === 'Ligar para a Lia'), true);
  });
});
