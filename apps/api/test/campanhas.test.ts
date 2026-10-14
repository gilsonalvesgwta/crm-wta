import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeEvolution, FakeSmtp } from './fakes.js';

const KEY = 'chave-global-de-teste';

let f: Fixture;
let app: NestFastifyApplication;
let evo: FakeEvolution;
let smtp: FakeSmtp;
let ip = 0;
let admin: Browser;
let marketing: Browser;
let sales: Browser;
let adminB: Browser;
let instance: string;
let token: string;
let wa: string;
let mail: string;
let vip: string;
let cold: string;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.62.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const hook = (body: unknown) => new Browser(app, '10.62.9.9').req('POST', `/api/v1/webhooks/evolution/${token}`, body, { 'x-crm-request': 'x' });
const run = () => app.get(DispatcherService).runOnce();
/** Roda o despachante até a campanha terminar (ou desistir). */
async function drain(campaignId: string) {
  for (let i = 0; i < 20; i++) {
    await f.admin.query("update campaigns set next_at = now() - interval '1 second' where id = $1 and status = 'sending'", [campaignId]);
    await run();
    const s = await f.admin.query<{ status: string }>('select status from campaigns where id = $1', [campaignId]);
    if (s.rows[0]!.status !== 'sending' && s.rows[0]!.status !== 'scheduled') return s.rows[0]!.status;
  }
  return 'sending';
}

async function contact(body: Record<string, unknown>): Promise<string> {
  const r = await admin.post('/api/v1/contacts', { allowDuplicate: true, ...body });
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
  await createUser(f, 'mkt@a.test', [{ tenant: f.tenantA, role: 'marketing' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test', true);
  marketing = await login('mkt@a.test', false);
  sales = await login('vendas@a.test', false);
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

  vip = (await admin.post('/api/v1/tags', { name: 'VIP' })).body.id;
  cold = (await admin.post('/api/v1/tags', { name: 'Frio' })).body.id;
  const tagged = async (name: string, phone: string | null, email: string | null, tags: string[]) => {
    const id = await contact({ firstName: name, phones: phone ? [{ number: phone }] : [], emails: email ? [{ email }] : [] });
    for (const t of tags) await f.admin.query('insert into contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)', [f.tenantA, id, t]);
    return id;
  };
  await tagged('Ana', '+55 11 91111-0001', 'ana@cliente.test', [vip]);
  await tagged('Bia', '+55 11 91111-0002', 'bia@cliente.test', [vip]);
  await tagged('Caio', null, 'caio@cliente.test', [vip]);
  await tagged('Duda', '+55 11 91111-0004', null, [vip, cold]);
  const eva = await tagged('Eva', '+55 11 91111-0005', 'eva@cliente.test', [vip]);
  await f.admin.query(`insert into consents (tenant_id, contact_id, channel, purpose, status, source) values ($1, $2, 'whatsapp', 'marketing', 'revoked', 'pediu')`, [f.tenantA, eva]);
  await f.admin.query(`insert into suppression_list (tenant_id, channel, value, reason) values ($1, 'whatsapp', '+5511911110002', 'opt_out')`, [f.tenantA]);
});

after(async () => {
  await app?.close();
  await evo?.stop();
  await smtp?.stop();
  if (f) await dropDatabase(f);
});

describe('campanha de WhatsApp', () => {
  let id: string;

  test('o público mostra quem recebe e por que alguns ficam de fora', async () => {
    const r = await marketing.post('/api/v1/campaigns/preview', { channel: 'whatsapp', audience: { tagIds: [vip], excludeTagIds: [cold] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // VIP sem "Frio": Ana, Bia, Caio, Eva. Caio sem telefone; Bia pediu para sair; Eva revogou.
    assert.deepEqual(r.body, { total: 4, eligible: 1, noAddress: 1, revoked: 1, noConsent: 0, suppressed: 1, sample: ['Ana'] });
    const e = await marketing.post('/api/v1/campaigns/preview', { channel: 'email', audience: { tagIds: [vip] } });
    assert.equal(e.body.eligible, 4, 'por e-mail: Ana, Bia, Caio e Eva');
    assert.equal((await sales.post('/api/v1/campaigns/preview', { channel: 'whatsapp', audience: {} })).status, 403);
  });

  test('o marketing cria o rascunho; só quem aprova inicia o envio', async () => {
    const r = await marketing.post('/api/v1/campaigns', {
      name: 'Black Friday', description: 'Oferta para VIPs', channel: 'whatsapp', accountId: wa,
      audience: { tagIds: [vip, cold] }, body: 'Oi {{primeiro_nome}}, a {{empresa}} tem uma oferta!', perMinute: 120,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    id = r.body.id;
    assert.equal(r.body.status, 'draft');
    assert.equal(r.body.stats.total, 0);
    assert.equal((await marketing.post(`/api/v1/campaigns/${id}/start`, {})).status, 403, 'marketing não aprova');
    assert.equal((await marketing.patch(`/api/v1/campaigns/${id}`, { ...r.body, accountId: mail, audience: { tagIds: [vip, cold] } })).status, 422, 'conta de outro canal');
    assert.equal((await adminB.get(`/api/v1/campaigns/${id}`)).status, 404);
    assert.equal((await sales.get('/api/v1/campaigns')).status, 200, 'o comercial vê as campanhas');
  });

  test('aprovada, o despachante monta o público e envia no ritmo, com variáveis e o "responda SAIR"', async () => {
    const before = evo.sent.length;
    const s = await admin.post(`/api/v1/campaigns/${id}/start`, {});
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.status, 'scheduled');
    assert.equal((await admin.patch(`/api/v1/campaigns/${id}`, {
      name: 'X', channel: 'whatsapp', audience: {}, body: 'x',
    })).status, 200, 'agendada ainda pode ser editada');
    // Volta ao público original.
    await admin.patch(`/api/v1/campaigns/${id}`, { name: 'Black Friday', channel: 'whatsapp', accountId: wa, audience: { tagIds: [vip] }, body: 'Oi {{primeiro_nome}}, a {{empresa}} tem uma oferta!', perMinute: 120 });
    assert.equal(await drain(id), 'done');
    const sent = evo.sent.slice(before);
    // VIP com telefone: Ana, Duda (Bia na supressão, Eva revogou, Caio sem telefone).
    assert.deepEqual(sent.map((x) => x.body.number).sort(), ['5511911110001', '5511911110004']);
    const ana = sent.find((x) => x.body.number === '5511911110001')!;
    assert.equal(ana.body.text, 'Oi Ana, a Empresa A tem uma oferta!\n\nPara não receber mais mensagens, responda SAIR.');
    const g = await admin.get(`/api/v1/campaigns/${id}`);
    assert.equal(g.body.status, 'done');
    assert.equal(g.body.stats.total, 2);
    assert.equal(g.body.stats.sent, 2);
    assert.ok(g.body.finishedAt);
    const rec = await admin.get(`/api/v1/campaigns/${id}/recipients?status=sent`);
    assert.deepEqual(rec.body.items.map((x: { name: string }) => x.name).sort(), ['Ana', 'Duda']);
    const msgs = await f.admin.query('select count(*)::int as n from messages where campaign_id = $1', [id]);
    assert.equal(msgs.rows[0].n, 2, 'as mensagens ficam no histórico, ligadas à campanha');
  });

  test('quem responde SAIR vai para a supressão e não recebe a próxima', async () => {
    await hook({
      event: 'messages.upsert', instance, destination: 'x', date_time: new Date().toISOString(), server_url: 'x', apikey: 'x',
      data: { key: { remoteJid: '5511911110001@s.whatsapp.net', fromMe: false, id: 'SAIR-1' }, message: { conversation: 'Sair' }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) + 2 },
    });
    const s = await f.admin.query("select reason from suppression_list where channel = 'whatsapp' and value = '+5511911110001'");
    assert.equal(s.rows[0]?.reason, 'opt_out');
    const g = await admin.get(`/api/v1/campaigns/${id}`);
    assert.equal(g.body.stats.replied, 1, 'a resposta conta como resposta da campanha');
    const p = await admin.post('/api/v1/campaigns/preview', { channel: 'whatsapp', audience: { tagIds: [vip] } });
    assert.deepEqual(p.body.sample, ['Duda']);
  });

  test('duplicar, editar só antes do envio e excluir só o que não está em andamento', async () => {
    assert.equal((await admin.patch(`/api/v1/campaigns/${id}`, { name: 'Y', channel: 'whatsapp', audience: {}, body: 'x' })).status, 409);
    const d = await admin.post(`/api/v1/campaigns/${id}/duplicate`);
    assert.equal(d.status, 201);
    assert.equal(d.body.name, 'Black Friday (cópia)');
    assert.equal(d.body.status, 'draft');
    assert.equal((await admin.del(`/api/v1/campaigns/${d.body.id}`)).status, 204);
  });
});

describe('campanha de e-mail, pausa e conta desconectada', () => {
  test('e-mail com assunto, variáveis e link para sair que funciona', async () => {
    const r = await admin.post('/api/v1/campaigns', {
      name: 'Novidades', channel: 'email', accountId: mail, audience: { tagIds: [vip], consentOnly: false },
      subject: 'Novidades para {{primeiro_nome}}', body: 'Olá {{nome}}!\nConfira.', perMinute: 120,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await admin.post(`/api/v1/campaigns/${r.body.id}/start`, {})).status, 200);
    const before = smtp.mails.length;
    assert.equal(await drain(r.body.id), 'done');
    const got = smtp.mails.slice(before).map((m) => ({ to: m.to.join(','), raw: m.data.replace(/\r\n[ \t]+/g, ' ') }));
    assert.equal(got.length, 4);
    const caio = got.find((m) => m.to.includes('caio@cliente.test'))!;
    assert.match(caio.raw, /Subject: Novidades para Caio/);
    assert.match(caio.raw, /List-Unsubscribe: <https:\/\/crm\.teste\.local\/api\/v1\/public\/descadastrar\/[^>]+>/);
    const link = /descadastrar\/([A-Za-z0-9_.-]+)>/.exec(caio.raw)![1]!;
    const anon = new Browser(app, '10.62.9.10');
    const page = await anon.raw(`/api/v1/public/descadastrar/${link}`);
    assert.equal(page.status, 200);
    assert.match(String(page.body), /não vai mais receber/);
    const s = await f.admin.query("select 1 from suppression_list where tenant_id = $1 and channel = 'email' and value = 'caio@cliente.test'", [f.tenantA]);
    assert.equal(s.rowCount, 1);
    assert.equal((await anon.raw(`/api/v1/public/descadastrar/${link.slice(0, -2)}xx`)).status, 404, 'link alterado não vale');
  });

  test('sem conteúdo ou com público vazio não inicia; agendar para o passado também não', async () => {
    const c = await admin.post('/api/v1/campaigns', { name: 'Vazia', channel: 'whatsapp', audience: {} });
    const s = await admin.post(`/api/v1/campaigns/${c.body.id}/start`, {});
    assert.equal(s.status, 422);
    assert.deepEqual(s.body.errors.map((e: { field: string }) => e.field).sort(), ['accountId', 'body']);
    await admin.patch(`/api/v1/campaigns/${c.body.id}`, { name: 'Vazia', channel: 'whatsapp', accountId: wa, body: 'x', audience: { tagIds: ['00000000-0000-4000-8000-000000000000'] } });
    const e = await admin.post(`/api/v1/campaigns/${c.body.id}/start`, {});
    assert.equal(e.status, 422);
    assert.equal(e.body.errors[0].field, 'audience');
    await admin.patch(`/api/v1/campaigns/${c.body.id}`, { name: 'Vazia', channel: 'whatsapp', accountId: wa, body: 'x', audience: { tagIds: [vip] } });
    const past = await admin.post(`/api/v1/campaigns/${c.body.id}/start`, { scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
    assert.equal(past.status, 422);
    const future = await admin.post(`/api/v1/campaigns/${c.body.id}/start`, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(future.status, 200);
    await run();
    assert.equal((await admin.get(`/api/v1/campaigns/${c.body.id}`)).body.status, 'scheduled', 'espera a hora marcada');
    assert.equal((await admin.post(`/api/v1/campaigns/${c.body.id}/cancel`)).body.status, 'canceled');
  });

  test('WhatsApp desconectado no meio: a campanha pausa e retoma depois', async () => {
    const extra = [];
    for (let i = 0; i < 3; i++) extra.push(await contact({ firstName: `Lote ${i}`, phones: [{ number: `+55 21 92222-000${i}` }] }));
    const c = await admin.post('/api/v1/campaigns', { name: 'Lote', channel: 'whatsapp', accountId: wa, body: 'Oi', audience: { contactIds: extra }, perMinute: 60 });
    assert.equal((await admin.post(`/api/v1/campaigns/${c.body.id}/start`, {})).status, 200);
    await run();
    let g = await admin.get(`/api/v1/campaigns/${c.body.id}`);
    assert.equal(g.body.stats.sent, 1, 'um por vez no ritmo de 60 por minuto');
    await f.admin.query("update channel_accounts set status = 'disconnected' where id = $1", [wa]);
    await f.admin.query("update campaigns set next_at = now() where id = $1", [c.body.id]);
    await run();
    g = await admin.get(`/api/v1/campaigns/${c.body.id}`);
    assert.equal(g.body.status, 'paused');
    assert.match(g.body.lastError, /não está conectado/);
    assert.equal(g.body.stats.pending, 2, 'ninguém é perdido');
    await f.admin.query("update channel_accounts set status = 'connected' where id = $1", [wa]);
    assert.equal((await admin.post(`/api/v1/campaigns/${c.body.id}/resume`)).body.status, 'sending');
    assert.equal(await drain(c.body.id), 'done');
    g = await admin.get(`/api/v1/campaigns/${c.body.id}`);
    assert.equal(g.body.stats.sent, 3);
  });
});
