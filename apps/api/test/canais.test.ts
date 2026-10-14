import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeEvolution, FakeSmtp } from './fakes.js';

const KEY = 'chave-global-de-teste';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

let f: Fixture;
let app: NestFastifyApplication;
let evo: FakeEvolution;
let smtp: FakeSmtp;
let ip = 0;
let admin: Browser;
let sales: Browser;
let adminB: Browser;
let instance: string;
let token: string;
let waAccount: string;

async function login(email: string, mfa: boolean, tenant?: string): Promise<Browser> {
  const b = new Browser(app, `10.60.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  if (tenant) assert.equal((await b.post('/api/v1/auth/tenant', { tenantId: tenant })).status, 200);
  return b;
}

/** Aviso da Evolution chegando pelo endereço do webhook. */
const hook = (body: unknown, t = token) => new Browser(app, '10.60.9.9').req('POST', `/api/v1/webhooks/evolution/${t}`, body, { 'x-crm-request': 'x' });
const upsert = (data: Record<string, unknown>, event = 'messages.upsert') => hook({ event, instance, data, destination: 'x', date_time: new Date().toISOString(), server_url: 'x', apikey: 'x' });

async function contact(b: Browser, body: Record<string, unknown>): Promise<string> {
  const r = await b.post('/api/v1/contacts', { allowDuplicate: true, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
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
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  adminB = await login('admin@b.test', true);
});

after(async () => {
  await app?.close();
  await evo?.stop();
  await smtp?.stop();
  if (f) await dropDatabase(f);
});

describe('WhatsApp pela Evolution', () => {
  test('cria a instância com o prefixo do CRM, o webhook próprio e o QR code', async () => {
    const r = await admin.post('/api/v1/channels/whatsapp', { name: 'Comercial' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    instance = r.body.account.instance;
    waAccount = r.body.account.id;
    assert.match(instance, /^crmwta-empresa-a-[0-9a-f]{8}$/);
    assert.equal(r.body.qr, 'data:image/png;base64,UVIx');
    const fake = evo.instances.get(instance)!;
    const m = /^https:\/\/crm\.teste\.local\/api\/v1\/webhooks\/evolution\/([A-Za-z0-9_-]{43})$/.exec(fake.webhook);
    assert.ok(m, fake.webhook);
    token = m[1]!;
    const stored = await f.admin.query('select webhook_token_hash, status from channel_accounts where id = $1', [waAccount]);
    assert.equal(stored.rows[0].status, 'connecting');
    assert.notEqual(stored.rows[0].webhook_token_hash.toString('base64url'), token, 'o banco guarda só o hash do token');
  });

  test('novo QR code enquanto não conecta; conectado, guarda o número', async () => {
    const q1 = await admin.get(`/api/v1/channels/${waAccount}/qr`);
    assert.equal(q1.status, 200);
    assert.equal(q1.body.qr, 'data:image/png;base64,UVIy');
    assert.equal(q1.body.pairingCode, 'WXYZ9876');
    const h = await hook({ event: 'connection.update', instance, data: { instance, state: 'open', wuid: '5511988887777@s.whatsapp.net', statusReason: 200 } });
    assert.equal(h.status, 200);
    const list = await admin.get('/api/v1/channels');
    const a = list.body.accounts.find((x: { id: string }) => x.id === waAccount);
    assert.equal(a.status, 'connected');
    assert.equal(a.address, '+5511988887777');
    assert.equal(list.body.evolutionConfigured, true);
    evo.instances.get(instance)!.state = 'open';
    evo.instances.get(instance)!.owner = '5511988887777@s.whatsapp.net';
    const q2 = await admin.get(`/api/v1/channels/${waAccount}/qr`);
    assert.equal(q2.body.qr, null, 'conectado não precisa de QR');
  });

  test('o limite do plano vale para números de WhatsApp', async () => {
    const plan = await f.admin.query<{ id: string }>(`insert into plans (name, limits) values ('Um número', '{"max_whatsapp": 1}') returning id`);
    await f.admin.query("insert into tenant_subscriptions (tenant_id, plan_id, status) values ($1, $2, 'active')", [f.tenantA, plan.rows[0]!.id]);
    const r = await admin.post('/api/v1/channels/whatsapp', { name: 'Suporte' });
    assert.equal(r.status, 403);
    assert.equal(r.body.type, 'plan-limit');
    await f.admin.query('delete from tenant_subscriptions where tenant_id = $1', [f.tenantA]);
  });

  test('mensagem de número desconhecido cria o contato e aparece nas conversas', async () => {
    const r = await upsert({
      key: { remoteJid: '5521977776666@s.whatsapp.net', fromMe: false, id: 'IN-1' }, pushName: 'Maria Cliente',
      message: { conversation: 'Oi, quero um orçamento' }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000),
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.handled, 1);
    const c = await f.admin.query<{ id: string; name: string }>(
      "select c.id, c.name from contacts c join contact_phones p on p.contact_id = c.id where p.e164 = '+5521977776666'");
    assert.equal(c.rows[0]!.name, 'Maria Cliente');
    const inbox = await admin.get('/api/v1/conversations');
    assert.equal(inbox.status, 200);
    const item = inbox.body.items.find((i: { contactId: string }) => i.contactId === c.rows[0]!.id);
    assert.equal(item.channel, 'whatsapp');
    assert.equal(item.status, 'open');
    assert.equal(item.assignee, null);
    assert.equal(item.unread, 1);
    assert.equal(item.last.body, 'Oi, quero um orçamento');
    assert.equal((await admin.get('/api/v1/conversations/unread')).body.count, 1);
    // Repetido: não duplica.
    await upsert({ key: { remoteJid: '5521977776666@s.whatsapp.net', fromMe: false, id: 'IN-1' }, message: { conversation: 'Oi, quero um orçamento' }, messageType: 'conversation' });
    const h = await admin.get(`/api/v1/contacts/${c.rows[0]!.id}/messages`);
    assert.equal(h.body.items.length, 1);
    assert.equal(h.body.items[0].direction, 'in');
    assert.equal(h.body.items[0].account.name, 'Comercial');
    assert.equal((await admin.post(`/api/v1/contacts/${c.rows[0]!.id}/messages/seen`)).body.marked, 1);
    assert.equal((await admin.get('/api/v1/conversations/unread')).body.count, 0);
    // O comercial (alcance próprio) não vê o contato sem responsável, mas vê a conversa sem responsável para assumir.
    assert.equal((await sales.get(`/api/v1/contacts/${c.rows[0]!.id}/messages`)).status, 404);
    assert.deepEqual((await sales.get('/api/v1/conversations')).body.items.map((i: { id: string }) => i.id), [item.id]);
    const t = await f.admin.query("select kind from timeline_entries where contact_id = $1 order by occurred_at", [c.rows[0]!.id]);
    assert.deepEqual(t.rows.map((x) => x.kind), ['contact.created', 'message.received']);
  });

  test('número sem o nono dígito encontra o contato já cadastrado', async () => {
    const id = await contact(admin, { firstName: 'João', phones: [{ number: '+55 11 98765-4321' }] });
    await upsert({ key: { remoteJid: '551187654321@s.whatsapp.net', fromMe: false, id: 'IN-2' }, pushName: 'Jão', message: { extendedTextMessage: { text: 'Bom dia' } }, messageType: 'extendedTextMessage' });
    const h = await admin.get(`/api/v1/contacts/${id}/messages`);
    assert.equal(h.body.items.length, 1);
    assert.equal(h.body.items[0].body, 'Bom dia');
    const n = await f.admin.query("select count(*)::int as n from contacts where first_name = 'Jão'");
    assert.equal(n.rows[0].n, 0, 'não criou outro contato');
  });

  test('envia texto, recebe os avisos de entrega e leitura, e o eco não duplica', async () => {
    const id = await contact(admin, { firstName: 'Ana', phones: [{ number: '+5531955554444' }] });
    const r = await admin.post(`/api/v1/contacts/${id}/messages`, { accountId: waAccount, text: 'Olá, Ana! Segue a proposta.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'sent');
    assert.equal(r.body.sentBy.name, 'admin');
    const sent = evo.sent.at(-1)!;
    assert.deepEqual([sent.instance, sent.type, sent.body.number, sent.body.text], [instance, 'text', '5531955554444', 'Olá, Ana! Segue a proposta.']);
    const ext = (await f.admin.query('select external_id from messages where id = $1', [r.body.id])).rows[0].external_id;
    // Eco do próprio envio.
    await upsert({ key: { remoteJid: '5531955554444@s.whatsapp.net', fromMe: true, id: ext }, message: { conversation: 'Olá, Ana! Segue a proposta.' }, messageType: 'conversation' }, 'send.message');
    await hook({ event: 'messages.update', instance, data: { keyId: ext, remoteJid: '5531955554444@s.whatsapp.net', fromMe: true, status: 'READ' } });
    await hook({ event: 'messages.update', instance, data: { keyId: ext, remoteJid: '5531955554444@s.whatsapp.net', fromMe: true, status: 'DELIVERY_ACK' } });
    const h = await admin.get(`/api/v1/contacts/${id}/messages`);
    assert.equal(h.body.items.length, 1, 'o eco não vira outra mensagem');
    assert.equal(h.body.items[0].status, 'read', 'um "entregue" atrasado não desfaz o "lida"');
    assert.ok(h.body.items[0].readAt && h.body.items[0].deliveredAt);
  });

  test('mensagem enviada pelo celular entra no histórico como enviada', async () => {
    const id = await contact(admin, { firstName: 'Bia', phones: [{ number: '+5531944443333' }] });
    await upsert({ key: { remoteJid: '5531944443333@s.whatsapp.net', fromMe: true, id: 'PHONE-1' }, pushName: 'Eu mesmo', message: { conversation: 'Mandei do celular' }, messageType: 'conversation' });
    const h = await admin.get(`/api/v1/contacts/${id}/messages`);
    assert.equal(h.body.items[0].direction, 'out');
    assert.equal(h.body.items[0].sentBy, null);
  });

  test('envia e recebe arquivos', async () => {
    const id = await contact(admin, { firstName: 'Caio', phones: [{ number: '+5541933332222' }] });
    const boundary = '----crmteste';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="accountId"\r\n\r\n${waAccount}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nFoto do produto\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n`),
      PNG, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await admin.req('POST', `/api/v1/contacts/${id}/messages/file`, body, { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-crm-request': '1' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.kind, 'image');
    assert.equal(r.body.file.name, 'foto.png');
    const sent = evo.sent.at(-1)!;
    assert.deepEqual([sent.type, sent.body.mediatype, sent.body.mimetype, sent.body.caption, sent.body.media], ['media', 'image', 'image/png', 'Foto do produto', PNG.toString('base64')]);

    await upsert({
      key: { remoteJid: '5541933332222@s.whatsapp.net', fromMe: false, id: 'IN-IMG' }, pushName: 'Caio',
      message: { imageMessage: { caption: 'Olha essa', mimetype: 'image/png' }, base64: PNG.toString('base64') }, messageType: 'imageMessage',
    });
    const h = await admin.get(`/api/v1/contacts/${id}/messages`);
    const img = h.body.items.find((m: { direction: string }) => m.direction === 'in');
    assert.equal(img.kind, 'image');
    assert.equal(img.body, 'Olha essa');
    assert.equal(img.file.contentType, 'image/png');
    const url = await admin.get(`/api/v1/files/${img.file.id}/url`);
    assert.equal(url.status, 200);
    const dl = await admin.raw(url.body.url);
    assert.equal(dl.status, 200);
    assert.deepEqual(dl.body, PNG);
    // Arquivo de conversa não aparece entre os anexos do contato.
    assert.equal((await admin.get(`/api/v1/records/contact/${id}/files`)).body.length, 0);
  });

  test('falha no envio fica registrada com o motivo', async () => {
    const id = await contact(admin, { firstName: 'Sem Zap', phones: [{ number: '+5511900001111' }] });
    evo.failNext = { status: 400, body: { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: '5511900001111@s.whatsapp.net', number: '5511900001111' }] } } };
    const r = await admin.post(`/api/v1/contacts/${id}/messages`, { accountId: waAccount, text: 'Oi' });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'failed');
    assert.equal(r.body.error, 'Este número não tem WhatsApp.');
    const t = await f.admin.query("select kind from timeline_entries where contact_id = $1 and kind like 'message.%'", [id]);
    assert.deepEqual(t.rows.map((x) => x.kind), ['message.failed']);
  });

  test('avisos inválidos, de grupo ou com token errado', async () => {
    assert.equal((await hook({ event: 'messages.upsert', instance, data: {} }, 'token-errado-token-errado-token-errado-x')).status, 404);
    assert.equal((await hook({}, 'curto')).status, 404);
    const g = await upsert({ key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: 'G1' }, message: { conversation: 'grupo' }, messageType: 'conversation' });
    assert.equal(g.body.handled, 0);
    const other = await hook({ event: 'messages.upsert', instance: 'outra-instancia', data: { key: { remoteJid: '5511911112222@s.whatsapp.net', id: 'X' }, message: { conversation: 'x' } } });
    assert.equal(other.body.handled, 0, 'aviso com o nome de outra instância é ignorado');
  });

  test('sem a permissão, sem acesso; outra empresa não vê a conta', async () => {
    assert.equal((await sales.get('/api/v1/channels')).status, 403);
    assert.equal((await sales.get('/api/v1/channels/available')).status, 200);
    assert.equal((await adminB.get(`/api/v1/channels/${waAccount}/qr`)).status, 404);
    assert.equal((await adminB.del(`/api/v1/channels/${waAccount}`)).status, 404);
  });
});

describe('e-mail da empresa', () => {
  let mailAccount: string;
  const account = () => ({
    name: 'Vendas', host: '127.0.0.1', port: smtp.port, secure: false, user: 'vendas@empresa-a.test', pass: 'senha-da-caixa',
    fromName: 'Empresa A', address: 'vendas@empresa-a.test',
  });

  test('cadastra a caixa com a senha cifrada e manda o e-mail de teste', async () => {
    const r = await admin.post('/api/v1/channels/email', account());
    assert.equal(r.status, 201, JSON.stringify(r.body));
    mailAccount = r.body.id;
    assert.equal(r.body.smtp.hasPassword, true);
    assert.equal(JSON.stringify(r.body).includes('senha-da-caixa'), false, 'a senha não volta');
    const raw = await f.admin.query<{ secret: Buffer }>('select secret from channel_accounts where id = $1', [mailAccount]);
    assert.equal(raw.rows[0]!.secret.includes(Buffer.from('senha-da-caixa')), false, 'a senha fica cifrada no banco');
    const t = await admin.post(`/api/v1/channels/${mailAccount}/test`);
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(t.body.account.status, 'connected');
    assert.equal(t.body.sentTo, 'admin@a.test');
    assert.deepEqual(smtp.mails.at(-1)!.to, ['admin@a.test']);
  });

  test('senha errada: a conta fica com erro e o motivo', async () => {
    const r = await admin.patch(`/api/v1/channels/email/${mailAccount}`, { ...account(), pass: 'errada' });
    assert.equal(r.status, 200);
    const t = await admin.post(`/api/v1/channels/${mailAccount}/test`);
    assert.equal(t.body.account.status, 'error');
    assert.equal(t.body.account.lastError, 'Usuário ou senha recusados pelo servidor de e-mail.');
    await admin.patch(`/api/v1/channels/email/${mailAccount}`, { ...account(), pass: null });
    assert.equal((await admin.post(`/api/v1/channels/${mailAccount}/test`)).body.account.status, 'error', 'sem senha nova, continua a errada');
    await admin.patch(`/api/v1/channels/email/${mailAccount}`, account());
    assert.equal((await admin.post(`/api/v1/channels/${mailAccount}/test`)).body.account.status, 'connected');
  });

  test('envia e-mail ao contato, com assunto, e fica no histórico', async () => {
    const id = await contact(admin, { firstName: 'Carla', emails: [{ email: 'carla@cliente.test' }] });
    assert.equal((await admin.post(`/api/v1/contacts/${id}/messages`, { accountId: mailAccount, text: 'Oi' })).status, 422, 'e-mail sem assunto');
    const r = await admin.post(`/api/v1/contacts/${id}/messages`, { accountId: mailAccount, subject: 'Proposta comercial', text: 'Olá, Carla.\nSegue a proposta <b>hoje</b>.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'sent');
    assert.equal(r.body.channel, 'email');
    const m = smtp.mails.at(-1)!;
    assert.deepEqual(m.to, ['carla@cliente.test']);
    assert.match(m.data, /Subject: Proposta comercial/);
    assert.match(m.data, /&lt;b&gt;hoje&lt;\/b&gt;/, 'o texto não vira HTML');
    assert.match(m.data, /From: "?Empresa A"? <vendas@empresa-a\.test>/);
    const h = await admin.get(`/api/v1/contacts/${id}/messages`);
    assert.equal(h.body.items[0].subject, 'Proposta comercial');
    // Contato sem telefone não recebe WhatsApp.
    const w = await admin.post(`/api/v1/contacts/${id}/messages`, { accountId: waAccount, text: 'Oi' });
    assert.equal(w.status, 422);
    assert.equal(w.body.errors[0].field, 'to');
  });

  test('o limite do plano vale para contas de e-mail', async () => {
    const plan = await f.admin.query<{ id: string }>(`insert into plans (name, limits) values ('Um e-mail', '{"max_email_accounts": 1}') returning id`);
    await f.admin.query("insert into tenant_subscriptions (tenant_id, plan_id, status) values ($1, $2, 'active')", [f.tenantA, plan.rows[0]!.id]);
    assert.equal((await admin.post('/api/v1/channels/email', { ...account(), name: 'Outra' })).status, 403);
    await f.admin.query('delete from tenant_subscriptions where tenant_id = $1', [f.tenantA]);
  });
});

describe('conta removida e privacidade', () => {
  test('desconectar e remover a instância; o histórico fica', async () => {
    const d = await admin.post(`/api/v1/channels/${waAccount}/disconnect`);
    assert.equal(d.status, 200);
    assert.equal(d.body.status, 'disconnected');
    const id = (await f.admin.query<{ contact_id: string }>("select contact_id from messages where external_id = 'IN-1'")).rows[0]!.contact_id;
    const s = await admin.post(`/api/v1/contacts/${id}/messages`, { accountId: waAccount, text: 'Oi' });
    assert.equal(s.status, 409, 'desconectado não envia');
    assert.equal((await admin.del(`/api/v1/channels/${waAccount}`)).status, 204);
    assert.equal(evo.instances.get(instance)!.deleted, true);
    const h = await admin.get(`/api/v1/contacts/${id}/messages`);
    assert.equal(h.body.items.length, 1);
    assert.equal(h.body.items[0].account, null);
    assert.equal((await hook({ event: 'connection.update', instance, data: { state: 'open' } })).status, 404, 'o webhook da conta removida deixa de existir');
  });

  test('anonimizar o titular apaga as mensagens', async () => {
    const id = (await f.admin.query<{ contact_id: string }>("select contact_id from messages where external_id = 'IN-IMG'")).rows[0]!.contact_id;
    const exp = await admin.get(`/api/v1/privacy/contacts/${id}/export`);
    assert.equal(exp.status, 200);
    assert.ok(exp.body.messages.length >= 2);
    assert.equal((await admin.post(`/api/v1/privacy/contacts/${id}/anonymize`, { confirm: true })).status, 200);
    const n = await f.admin.query('select count(*)::int as n from messages where contact_id = $1', [id]);
    assert.equal(n.rows[0].n, 0);
  });
});

describe('sem a Evolution configurada', () => {
  test('a tela avisa e criar um número responde 409', async () => {
    await createUser(f, 'admin2@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
    const { app: app2 } = await startApi(f, { REQUIRE_MFA: 'false' });
    try {
      const b = new Browser(app2, '10.60.8.1');
      assert.equal((await b.login('admin2@a.test')).status, 200);
      const list = await b.get('/api/v1/channels');
      assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.equal(list.body.evolutionConfigured, false);
      const r = await b.post('/api/v1/channels/whatsapp', { name: 'X' });
      assert.equal(r.status, 409);
      assert.equal(r.body.type, 'evolution-not-configured');
    } finally {
      await app2.close();
    }
  });
});
