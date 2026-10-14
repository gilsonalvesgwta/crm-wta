import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeEvolution, FakeSmtp } from './fakes.js';

const KEY = 'chave-global-de-teste';

let f: Fixture;
let app: NestFastifyApplication;
let evo: FakeEvolution;
let smtp: FakeSmtp;
let ip = 0;
let admin: Browser;
let sales: Browser;
let sales2: Browser;
let adminB: Browser;
let instance: string;
let token: string;
let wa: string;
let mail: string;
let salesMember: string;
let sales2Member: string;
let team: string;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.61.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const hook = (body: unknown) => new Browser(app, '10.61.9.9').req('POST', `/api/v1/webhooks/evolution/${token}`, body, { 'x-crm-request': 'x' });
const incoming = (jid: string, id: string, text: string, pushName = 'Cliente') => hook({
  event: 'messages.upsert', instance, destination: 'x', date_time: new Date().toISOString(), server_url: 'x', apikey: 'x',
  data: { key: { remoteJid: `${jid}@s.whatsapp.net`, fromMe: false, id }, pushName, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) },
});

async function contact(b: Browser, body: Record<string, unknown>): Promise<string> {
  const r = await b.post('/api/v1/contacts', { allowDuplicate: true, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

async function member(email: string): Promise<string> {
  return (await f.admin.query<{ id: string }>('select m.id from memberships m join users u on u.id = m.user_id where u.email = $1', [email])).rows[0]!.id;
}

before(async () => {
  f = await createDatabase();
  evo = new FakeEvolution(KEY);
  await evo.start();
  smtp = new FakeSmtp('vendas@empresa-a.test', 'senha-da-caixa');
  await smtp.start();
  ({ app } = await startApi(f, { EVOLUTION_URL: `${evo.url}/`, EVOLUTION_API_KEY: KEY, CHANNEL_ALLOW_PRIVATE_HOSTS: 'true' }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'vendas2@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  salesMember = await member('vendas@a.test');
  sales2Member = await member('vendas2@a.test');
  team = (await f.admin.query<{ id: string }>("insert into teams (tenant_id, name) values ($1, 'Vendas Sul') returning id", [f.tenantA])).rows[0]!.id;
  await f.admin.query('insert into team_members (tenant_id, team_id, membership_id) values ($1, $2, $3), ($1, $2, $4)', [f.tenantA, team, salesMember, sales2Member]);
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  sales2 = await login('vendas2@a.test', false);
  adminB = await login('admin@b.test', true);

  const r = await admin.post('/api/v1/channels/whatsapp', { name: 'Comercial' });
  instance = r.body.account.instance;
  wa = r.body.account.id;
  token = /\/evolution\/([A-Za-z0-9_-]{43})$/.exec(evo.instances.get(instance)!.webhook)![1]!;
  await hook({ event: 'connection.update', instance, data: { instance, state: 'open', wuid: '5511988887777@s.whatsapp.net', statusReason: 200 } });
  const m = await admin.post('/api/v1/channels/email', {
    name: 'Vendas', host: '127.0.0.1', port: smtp.port, secure: false, user: 'vendas@empresa-a.test', pass: 'senha-da-caixa',
    fromName: 'Empresa A', address: 'vendas@empresa-a.test',
  });
  mail = m.body.id;
});

after(async () => {
  await app?.close();
  await evo?.stop();
  await smtp?.stop();
  if (f) await dropDatabase(f);
});

describe('iniciar conversa', () => {
  let contactId: string;
  let conv: string;

  test('contato novo, sem mensagem nenhuma: a conversa abre e o WhatsApp sai', async () => {
    contactId = await contact(sales, { firstName: 'Paula', phones: [{ number: '+55 11 91234-5678' }], emails: [{ email: 'paula@cliente.test' }] });
    const r = await sales.post('/api/v1/conversations', { contactId, channel: 'whatsapp' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    conv = r.body.id;
    assert.equal(r.body.status, 'open');
    assert.equal(r.body.assignee.id, salesMember, 'quem abre (ou o dono do contato) fica responsável');
    assert.equal(r.body.last, null);
    // De novo: a mesma conversa.
    assert.equal((await sales.post('/api/v1/conversations', { contactId, channel: 'whatsapp' })).body.id, conv);

    const before = evo.sent.length;
    const s = await sales.post(`/api/v1/conversations/${conv}/messages`, { accountId: wa, text: 'Olá Paula!' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.status, 'sent');
    assert.equal(evo.sent.length, before + 1);
    const g = await sales.get(`/api/v1/conversations/${conv}`);
    assert.ok(g.body.firstResponseAt);
    assert.equal(g.body.last.body, 'Olá Paula!');
  });

  test('e-mail é outra conversa, e só aceita conta de e-mail', async () => {
    const r = await sales.post('/api/v1/conversations', { contactId, channel: 'email' });
    assert.equal(r.status, 201);
    assert.notEqual(r.body.id, conv);
    assert.equal((await sales.post(`/api/v1/conversations/${r.body.id}/messages`, { accountId: wa, text: 'x' })).status, 422);
    const s = await sales.post(`/api/v1/conversations/${r.body.id}/messages`, { accountId: mail, subject: 'Proposta', text: 'Segue a proposta.' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const h = await sales.get(`/api/v1/conversations/${r.body.id}/messages`);
    assert.deepEqual(h.body.items.map((m: { channel: string }) => m.channel), ['email'], 'a conversa de e-mail mostra só e-mails');
    const byChannel = await sales.get('/api/v1/conversations?channel=email');
    assert.deepEqual(byChannel.body.items.map((i: { id: string }) => i.id), [r.body.id]);
  });

  test('contato sem telefone não abre conversa de WhatsApp', async () => {
    const id = await contact(sales, { firstName: 'Sem fone', emails: [{ email: 'semfone@cliente.test' }] });
    const r = await sales.post('/api/v1/conversations', { contactId: id, channel: 'whatsapp' });
    assert.equal(r.status, 422);
    assert.equal(r.body.errors[0].field, 'channel');
  });

  test('não abre conversa com contato fora do alcance', async () => {
    const other = await contact(admin, { firstName: 'Do admin', phones: [{ number: '+55 11 90000-1111' }] });
    assert.equal((await sales.post('/api/v1/conversations', { contactId: other, channel: 'whatsapp' })).status, 404);
    assert.equal((await adminB.post('/api/v1/conversations', { contactId, channel: 'whatsapp' })).status, 404);
  });
});

describe('estado, responsável e filtros', () => {
  let conv: string;

  test('número desconhecido: conversa sem responsável que o comercial pode assumir', async () => {
    await incoming('5521955554444', 'IN-A', 'Quero saber o preço', 'Rafael');
    const list = await sales.get('/api/v1/conversations?assignee=none');
    const item = list.body.items.find((i: { contact: { name: string } }) => i.contact.name === 'Rafael');
    assert.ok(item, 'aparece para quem pode assumir');
    conv = item.id;
    assert.equal(item.unread, 1);
    assert.equal((await sales.get('/api/v1/conversations/unread')).body.count >= 1, true);

    // Não pode passar para outra pessoa, mas pode assumir.
    assert.equal((await sales.patch(`/api/v1/conversations/${conv}`, { assigneeId: sales2Member })).status, 403);
    const take = await sales.patch(`/api/v1/conversations/${conv}`, { assigneeId: salesMember });
    assert.equal(take.status, 200, JSON.stringify(take.body));
    assert.equal(take.body.assignee.id, salesMember);
    // Assumida: o colega (sem alcance de equipe para responder) não vê mais.
    assert.equal((await sales2.get(`/api/v1/conversations/${conv}`)).status, 404);
    assert.equal((await sales2.patch(`/api/v1/conversations/${conv}`, { assigneeId: sales2Member })).status, 404);
  });

  test('marcar como lida, responder, aguardar e encerrar; o cliente escreve e reabre', async () => {
    assert.equal((await sales.post(`/api/v1/conversations/${conv}/seen`)).body.marked, 1);
    assert.equal((await sales.get(`/api/v1/conversations/${conv}`)).body.unread, 0);
    assert.equal((await sales.patch(`/api/v1/conversations/${conv}`, { status: 'waiting' })).body.status, 'waiting');
    assert.equal((await sales.get('/api/v1/conversations?status=waiting')).body.items.some((i: { id: string }) => i.id === conv), true);
    const closed = await sales.patch(`/api/v1/conversations/${conv}`, { status: 'closed' });
    assert.equal(closed.body.status, 'closed');
    assert.ok(closed.body.closedAt);
    const open = await sales.get('/api/v1/conversations');
    assert.equal(open.body.counts.closed >= 1, true);
    await incoming('5521955554444', 'IN-B', 'Ainda está disponível?');
    const g = await sales.get(`/api/v1/conversations/${conv}`);
    assert.equal(g.body.status, 'open');
    assert.equal(g.body.closedAt, null);
    assert.equal(g.body.assignee.id, salesMember, 'o responsável continua');
  });

  test('o administrador atribui e troca a equipe; filtros por pessoa, equipe, etiqueta e negócio', async () => {
    const r = await admin.patch(`/api/v1/conversations/${conv}`, { assigneeId: sales2Member, teamId: team });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.team.name, 'Vendas Sul');
    assert.equal((await sales2.get(`/api/v1/conversations/${conv}`)).status, 200, 'o novo responsável passa a ver');
    const ids = async (qs: string) => (await admin.get(`/api/v1/conversations?status=all&${qs}`)).body.items.map((i: { id: string }) => i.id);
    assert.deepEqual(await ids(`assignee=${sales2Member}`), [conv]);
    assert.deepEqual(await ids(`teamId=${team}`), [conv]);

    const contactId = (await admin.get(`/api/v1/conversations/${conv}`)).body.contactId;
    const tag = await admin.post('/api/v1/tags', { name: 'Quente' });
    assert.equal(tag.status, 201, JSON.stringify(tag.body));
    await f.admin.query('insert into contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)', [f.tenantA, contactId, tag.body.id]);
    assert.deepEqual(await ids(`tagId=${tag.body.id}`), [conv]);
    assert.equal((await ids('deal=open')).includes(conv), false);
    assert.equal((await ids('deal=none')).includes(conv), true);
    const pipes = await admin.get('/api/v1/pipelines');
    const pipelineId = pipes.body[0]?.id ?? (await admin.post('/api/v1/pipelines', { name: 'Vendas' })).body.id;
    const d = await admin.post('/api/v1/deals', { pipelineId, title: 'Orçamento Rafael', contactId });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.equal((await ids('deal=open')).includes(conv), true);
    assert.equal((await ids(`deal=${pipelineId}`)).includes(conv), true);
    assert.equal((await admin.get('/api/v1/conversations?status=nada')).status, 422);
  });

  test('a empresa B não vê nem altera', async () => {
    assert.equal((await adminB.get(`/api/v1/conversations/${conv}`)).status, 404);
    assert.equal((await adminB.patch(`/api/v1/conversations/${conv}`, { status: 'closed' })).status, 404);
    assert.equal((await adminB.get('/api/v1/conversations')).body.items.length, 0);
  });
});

describe('respostas prontas', () => {
  let shared: string;
  let mine: string;

  test('o administrador cria respostas da empresa; o comercial, as suas', async () => {
    const r = await admin.post('/api/v1/quick-replies', { channel: 'whatsapp', shortcut: 'Boas-Vindas', title: 'Boas-vindas', body: 'Olá, {{primeiro_nome}}!', shared: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.shortcut, 'boas-vindas');
    assert.equal(r.body.shared, true);
    shared = r.body.id;
    assert.equal((await sales.post('/api/v1/quick-replies', { channel: 'whatsapp', shortcut: 'x', title: 'X', body: 'x', shared: true })).status, 403);
    const m = await sales.post('/api/v1/quick-replies', { channel: 'whatsapp', shortcut: 'preco', title: 'Preço', body: 'O valor é...' });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    mine = m.body.id;
    const dup = await admin.post('/api/v1/quick-replies', { channel: 'whatsapp', shortcut: 'boas-vindas', title: 'De novo', body: 'x', shared: true });
    assert.equal(dup.status, 422);
    assert.equal(dup.body.errors[0].field, 'shortcut');
    assert.equal((await admin.post('/api/v1/quick-replies', { channel: 'email', shortcut: 'proposta', title: 'Proposta', body: 'Segue.', shared: true })).status, 422, 'e-mail pede assunto');
    assert.equal((await admin.post('/api/v1/quick-replies', { channel: 'email', shortcut: 'proposta', title: 'Proposta', subject: 'Sua proposta', body: 'Segue.', shared: true })).status, 201);
  });

  test('cada um vê as da empresa e as suas; busca e filtro por canal', async () => {
    const s = await sales.get('/api/v1/quick-replies?channel=whatsapp');
    assert.deepEqual(s.body.items.map((i: { shortcut: string }) => i.shortcut).sort(), ['boas-vindas', 'preco']);
    assert.equal(s.body.canShare, false);
    const s2 = await sales2.get('/api/v1/quick-replies?channel=whatsapp');
    assert.deepEqual(s2.body.items.map((i: { shortcut: string }) => i.shortcut), ['boas-vindas'], 'a resposta pessoal não aparece para o colega');
    assert.deepEqual((await sales.get('/api/v1/quick-replies?q=valor')).body.items.map((i: { id: string }) => i.id), [mine]);
    assert.deepEqual((await sales.get('/api/v1/quick-replies?channel=email')).body.items.map((i: { shortcut: string }) => i.shortcut), ['proposta']);
    assert.equal((await adminB.get('/api/v1/quick-replies')).body.items.length, 0);
  });

  test('editar e excluir: a própria sim; a da empresa e a do colega, não', async () => {
    assert.equal((await sales.patch(`/api/v1/quick-replies/${mine}`, { channel: 'whatsapp', shortcut: 'preco', title: 'Preço', body: 'O valor é R$ 100.' })).status, 200);
    assert.equal((await sales.patch(`/api/v1/quick-replies/${shared}`, { channel: 'whatsapp', shortcut: 'boas-vindas', title: 'X', body: 'x', shared: true })).status, 403);
    assert.equal((await sales.del(`/api/v1/quick-replies/${shared}`)).status, 403);
    assert.equal((await sales2.del(`/api/v1/quick-replies/${mine}`)).status, 404);
    assert.equal((await adminB.del(`/api/v1/quick-replies/${shared}`)).status, 404);
    assert.equal((await sales.del(`/api/v1/quick-replies/${mine}`)).status, 204);
    assert.equal((await admin.del(`/api/v1/quick-replies/${shared}`)).status, 204);
  });
});
