import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeEvolution } from './fakes.js';

const KEY = 'chave-evolution-de-teste';

let f: Fixture;
let app: NestFastifyApplication;
let evo: FakeEvolution;
let admin: Browser;
let adminB: Browser;
let account: string;
let instance: string;
let token: string;
let flowId: string;
let tag: string;
let ip = 0;
let n = 0;

async function login(email: string): Promise<Browser> {
  const b = new Browser(app, `10.71.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  const s = await b.post('/api/v1/auth/mfa/setup');
  assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  return b;
}

const hook = (body: unknown) => new Browser(app, '10.71.9.9').req('POST', `/api/v1/webhooks/evolution/${token}`, body, { 'x-crm-request': 'x' });

/** Mensagem que chega pelo WhatsApp por QR code (Evolution). */
async function inbound(from: string, text: string, fromMe = false, name = 'Cliente') {
  const r = await hook({
    event: 'messages.upsert', instance, destination: 'x', date_time: new Date().toISOString(), server_url: 'x', apikey: 'x',
    data: { key: { remoteJid: `${from}@s.whatsapp.net`, fromMe, id: `IN-QR-${++n}` }, pushName: name, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

/** Textos mandados pelo número de QR code para alguém. */
const sentTo = (number: string) => evo.sent.filter((s) => s.instance === instance && String(s.body.number).replace(/\D/g, '') === number);
const texts = (number: string) => sentTo(number).map((s) => String(s.body.text ?? s.body.caption ?? ''));

const btn = (id: string, title: string, keywords: string[] = [], url: string | null = null) => ({ id, title, url, keywords });
const text = (id: string, x: number, body: string, buttons: ReturnType<typeof btn>[] = [], extra: Record<string, unknown> = {}) =>
  ({ id, type: 'text', position: { x, y: 0 }, data: { text: body, buttons, retryText: 'Não entendi 😅 Responda com o número:', timeoutHours: null, ...extra } });

/** Desenho: pergunta com opções; 1 marca etiqueta e responde; 2 responde; "Outra resposta" vai para a equipe. */
function graph(trigger: 'wa_keyword' | 'wa_broadcast', withOther = false) {
  return {
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { type: trigger, posts: 'any', postIds: [], match: trigger === 'wa_keyword' ? 'contains' : 'any', keywords: ['promo'], frequency: 'every' } },
      text('n1', 300, 'Oi, {{primeiro_nome}}! Quer saber da Black Friday?', [btn('b1', 'Quero saber', ['sim', 'quero']), btn('b2', 'Agora não', ['nao']), btn('l1', 'Ver oferta', [], 'https://exemplo.com/bf')]),
      { id: 'a1', type: 'action', position: { x: 600, y: 0 }, data: { ops: [{ kind: 'add_tag', tagId: tag }] } },
      text('n2', 900, 'Ótimo! Já te passo os detalhes.'),
      text('n3', 600, 'Tudo bem! Se mudar de ideia, responda QUERO.'),
      text('n4', 600, 'Vou chamar alguém da equipe para te ajudar.'),
      { id: 'n5', type: 'action', position: { x: 900, y: 0 }, data: { ops: [{ kind: 'opt_out' }] } },
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' },
      { id: 'e2', source: 'n1', sourceHandle: 'btn:b1', target: 'a1' },
      { id: 'e3', source: 'a1', sourceHandle: 'next', target: 'n2' },
      { id: 'e4', source: 'n1', sourceHandle: 'btn:b2', target: 'n3' },
      { id: 'e5', source: 'n3', sourceHandle: 'next', target: 'n5' },
      ...(withOther ? [{ id: 'e6', source: 'n1', sourceHandle: 'other', target: 'n4' }] : []),
    ],
  };
}

async function dispatch(campaignId: string) {
  for (let i = 0; i < 6; i++) {
    await f.admin.query("update campaigns set next_at = now() - interval '1 second' where id = $1 and status = 'sending'", [campaignId]);
    await app.get(DispatcherService).runOnce();
  }
}

before(async () => {
  f = await createDatabase();
  evo = new FakeEvolution(KEY);
  await evo.start();
  ({ app } = await startApi(f, { EVOLUTION_URL: `${evo.url}/`, EVOLUTION_API_KEY: KEY, CHANNEL_ALLOW_PRIVATE_HOSTS: 'true' }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test');
  adminB = await login('admin@b.test');
  const r = await admin.post('/api/v1/channels/whatsapp', { name: 'Comercial QR' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  account = r.body.account.id;
  instance = r.body.account.instance;
  token = /\/webhooks\/evolution\/([A-Za-z0-9_-]+)$/.exec(evo.instances.get(instance)!.webhook)![1]!;
  await hook({ event: 'connection.update', instance, data: { instance, state: 'open', wuid: '5511988887777@s.whatsapp.net', statusReason: 200 } });
  evo.instances.get(instance)!.state = 'open';
  tag = (await admin.post('/api/v1/tags', { name: 'Quer Black Friday' })).body.id;
});

after(async () => {
  await app?.close();
  await evo?.stop();
  if (f) await dropDatabase(f);
});

describe('Fluxos no WhatsApp por QR code', () => {
  test('o número de QR code aparece para os fluxos e o fluxo novo já vem com um exemplo pronto', async () => {
    const accs = await admin.get('/api/v1/whatsapp/accounts');
    assert.equal(accs.status, 200);
    assert.deepEqual(accs.body.map((a: { id: string; mode: string }) => [a.id, a.mode]), [[account, 'qr']]);
    const c = await admin.post('/api/v1/whatsapp/flows', { accountId: account, name: 'Black Friday', triggerType: 'wa_broadcast' });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.mode, 'qr');
    const first = c.body.draft.nodes.find((x: { id: string }) => x.id === 'n1');
    assert.equal(first.type, 'text', 'no QR code a campanha começa por mensagem, sem modelo aprovado');
    assert.equal(first.data.buttons.length, 3);
    assert.deepEqual(c.body.issues.filter((i: { level: string }) => i.level === 'error'), []);
    // Modelo aprovado não existe no QR code: erro que impede publicar.
    const g = { ...c.body.draft, nodes: [...c.body.draft.nodes, { id: 'tp', type: 'template', position: { x: 0, y: 400 }, data: { templateId: null, name: null, params: [], buttons: [] } }] };
    const saved = await admin.patch(`/api/v1/whatsapp/flows/${c.body.id}`, { draft: g });
    assert.ok(saved.body.issues.some((i: { nodeId: string; level: string }) => i.nodeId === 'tp' && i.level === 'error'));
    assert.equal((await admin.post(`/api/v1/whatsapp/flows/${c.body.id}/publish`)).status, 422);
    // Outra empresa não vê o fluxo.
    assert.equal((await adminB.get(`/api/v1/whatsapp/flows/${c.body.id}`)).status, 404);
  });

  test('palavra-chave: mensagem com opções numeradas e "digitando…"; o número escolhe o caminho', async () => {
    const c = await admin.post('/api/v1/whatsapp/flows', { accountId: account, name: 'Promo', triggerType: 'wa_keyword' });
    flowId = c.body.id;
    const s = await admin.patch(`/api/v1/whatsapp/flows/${flowId}`, { draft: graph('wa_keyword') });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const p = await admin.post(`/api/v1/whatsapp/flows/${flowId}/publish`);
    assert.equal(p.status, 200, JSON.stringify(p.body));

    await inbound('5521911112222', 'oi, vi a promo!', false, 'Ana Souza');
    const first = sentTo('5521911112222');
    assert.equal(first.length, 1);
    assert.equal(first[0]!.body.text, 'Oi, Ana! Quer saber da Black Friday?\n\n1️⃣ Quero saber\n2️⃣ Agora não\n\n🔗 Ver oferta: https://exemplo.com/bf');
    assert.ok(Number(first[0]!.body.delay) >= 1000, 'mostra "digitando…" antes de mandar');

    await inbound('5521911112222', '1');
    assert.equal(texts('5521911112222').at(-1), 'Ótimo! Já te passo os detalhes.');
    const tagged = await f.admin.query(
      "select 1 from contact_tags ct join contact_phones p on p.contact_id = ct.contact_id where p.e164 = '+5521911112222' and ct.tag_id = $1", [tag]);
    assert.equal(tagged.rowCount, 1, 'a ação do caminho rodou');
  });

  test('aceita o nome ou uma palavra da opção; resposta fora das opções pede de novo (até 2 vezes)', async () => {
    await inbound('5521933334444', 'PROMO', false, 'Beto');
    await inbound('5521933334444', 'Sim, quero!');
    assert.equal(texts('5521933334444').at(-1), 'Ótimo! Já te passo os detalhes.');

    await inbound('5521955556666', 'promo', false, 'Carla');
    await inbound('5521955556666', 'quanto custa?');
    assert.equal(texts('5521955556666').at(-1), 'Não entendi 😅 Responda com o número:\n\n1️⃣ Quero saber\n2️⃣ Agora não');
    await inbound('5521955556666', 'hein');
    await inbound('5521955556666', 'de novo');
    assert.equal(sentTo('5521955556666').length, 3, 'pede de novo só 2 vezes');
    await inbound('5521955556666', '2️⃣');
    assert.equal(texts('5521955556666').at(-1), 'Tudo bem! Se mudar de ideia, responda QUERO.');
    // "Tirar das campanhas" rodou: o número entra na lista de supressão.
    const sup = await f.admin.query("select 1 from suppression_list where channel = 'whatsapp' and value = '+5521955556666'");
    assert.equal(sup.rowCount, 1);
  });

  test('com a saída "Outra resposta" ligada, segue por ela; a equipe respondendo pelo celular para o fluxo', async () => {
    await admin.patch(`/api/v1/whatsapp/flows/${flowId}`, { draft: graph('wa_keyword', true) });
    assert.equal((await admin.post(`/api/v1/whatsapp/flows/${flowId}/publish`)).status, 200);
    await inbound('5521977778888', 'promo', false, 'Dani');
    await inbound('5521977778888', 'tenho uma dúvida');
    assert.equal(texts('5521977778888').at(-1), 'Vou chamar alguém da equipe para te ajudar.');

    await inbound('5521999990000', 'promo', false, 'Edu');
    await inbound('5521999990000', 'Oi Edu, aqui é o Rhus!', true);
    const run = await f.admin.query("select status, last_error from ig_flow_runs where ig_user_id like '%999990000' order by updated_at desc limit 1");
    assert.equal(run.rows[0].status, 'canceled');
    assert.equal(run.rows[0].last_error, 'A equipe assumiu a conversa');
    await inbound('5521999990000', '1');
    assert.equal(sentTo('5521999990000').length, 1, 'depois que a equipe assumiu, o fluxo não responde');
  });

  test('campanha com fluxo pelo QR code: manda a primeira mensagem para a base e a resposta continua', async () => {
    const audience = (await admin.post('/api/v1/tags', { name: 'Base BF' })).body.id;
    for (const [name, phone] of [['Fábio', '+55 31 97777-1111'], ['Gabi', '+55 31 96666-2222']] as const) {
      const c = await admin.post('/api/v1/contacts', { firstName: name, phones: [{ number: phone }], allowDuplicate: true });
      await f.admin.query('insert into contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)', [f.tenantA, c.body.id, audience]);
    }
    const fl = await admin.post('/api/v1/whatsapp/flows', { accountId: account, name: 'BF campanha', triggerType: 'wa_broadcast' });
    await admin.patch(`/api/v1/whatsapp/flows/${fl.body.id}`, { draft: graph('wa_broadcast') });
    const base = { name: 'Black Friday', channel: 'whatsapp', accountId: account, audience: { tagIds: [audience] }, perMinute: 120 };
    const k = await admin.post('/api/v1/campaigns', { ...base, flowId: fl.body.id });
    assert.equal(k.status, 201, JSON.stringify(k.body));
    assert.equal((await admin.post(`/api/v1/campaigns/${k.body.id}/start`, {})).status, 422, 'fluxo ainda não publicado');
    assert.equal((await admin.post(`/api/v1/whatsapp/flows/${fl.body.id}/publish`)).status, 200);
    const s = await admin.post(`/api/v1/campaigns/${k.body.id}/start`, {});
    assert.equal(s.status, 200, JSON.stringify(s.body));
    await dispatch(k.body.id);
    const got = await admin.get(`/api/v1/campaigns/${k.body.id}`);
    assert.equal(got.body.stats.sent, 2, JSON.stringify(got.body.stats));
    assert.match(texts('5531977771111')[0]!, /^Oi, Fábio! Quer saber da Black Friday\?\n\n1️⃣ Quero saber/);
    await inbound('5531977771111', '1');
    assert.equal(texts('5531977771111').at(-1), 'Ótimo! Já te passo os detalhes.');
  });
});
