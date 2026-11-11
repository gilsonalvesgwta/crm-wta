import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeMeta } from './fakes.js';

const TOKEN = 'EAAG-token-de-teste';
const SECRET = 'segredo-do-app-de-teste';
const PHONE_ID = '100000000123';

let f: Fixture;
let app: NestFastifyApplication;
let meta: FakeMeta;
let ip = 0;
let admin: Browser;
let adminB: Browser;
let cloud: string;
let hookPath: string;
let template: string;
let flowId: string;
let tag: string;
let n = 0;

async function login(email: string): Promise<Browser> {
  const b = new Browser(app, `10.67.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  const s = await b.post('/api/v1/auth/mfa/setup');
  assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  return b;
}

async function hook(body: unknown) {
  const raw = JSON.stringify(body);
  const sig = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  const r = await app.inject({ method: 'POST', url: hookPath, payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, remoteAddress: '10.67.9.9' });
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as { handled: number };
}

/** Mensagem recebida pela Cloud API (texto, clique em botão do modelo ou da mensagem interativa). */
const wa = (from: string, msg: Record<string, unknown>, name = 'Cliente') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '200000000001', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '551133334444', phone_number_id: PHONE_ID },
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, id: `wamid.in.${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), ...msg }],
  } }] }],
});
type Sent = { to: string; type: string; text?: { body: string }; template?: { name: string; components: Record<string, unknown>[] };
  interactive?: { type: string; body: { text: string }; action: { buttons: { reply: { id: string; title: string } }[] } } };
/** Mensagens mandadas pelo WhatsApp oficial falso para um número. */
const sentTo = (to: string) => meta.sent.filter((s) => s.path === `${PHONE_ID}/messages` && (s.body as Sent).to === to).map((s) => s.body as Sent);

async function dispatch(campaignId: string) {
  for (let i = 0; i < 5; i++) {
    await f.admin.query("update campaigns set next_at = now() - interval '1 second' where id = $1 and status = 'sending'", [campaignId]);
    await app.get(DispatcherService).runOnce();
  }
}

before(async () => {
  f = await createDatabase();
  meta = new FakeMeta([TOKEN]);
  await meta.start();
  ({ app } = await startApi(f, { META_GRAPH_URL: meta.url, META_INSTAGRAM_URL: meta.url }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test');
  adminB = await login('admin@b.test');
  const c = await admin.post('/api/v1/channels/whatsapp-cloud', { name: 'Oficial', phoneNumberId: PHONE_ID, wabaId: '200000000001', token: TOKEN, appSecret: SECRET });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  cloud = c.body.id;
  hookPath = new URL(c.body.webhook.url).pathname;
  const t = await admin.post('/api/v1/whatsapp-templates', {
    accountId: cloud, name: 'raio_x', category: 'MARKETING', body: 'Olá {{1}}! Quer receber o seu Raio X gratuito?', examples: ['Maria'],
    buttons: [{ type: 'QUICK_REPLY', text: 'QUERO MEU RAIO X' }, { type: 'QUICK_REPLY', text: 'COMO FUNCIONA?' }, { type: 'URL', text: 'Site', url: 'https://exemplo.com' }],
  });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  template = t.body.id;
  tag = (await admin.post('/api/v1/tags', { name: 'Quer Raio X' })).body.id;
});

after(async () => {
  await app?.close();
  await meta?.stop();
  if (f) await dropDatabase(f);
});

describe('fluxos do WhatsApp oficial', () => {
  test('criar o fluxo de transmissão: começa pelo modelo; só publica com modelo aprovado e botões ligados', async () => {
    const accs = await admin.get('/api/v1/whatsapp/accounts');
    assert.deepEqual(accs.body.map((a: { id: string }) => a.id), [cloud]);
    assert.equal((await admin.post('/api/v1/whatsapp/flows', { accountId: cloud, name: 'X', triggerType: 'comment' })).status, 422, 'gatilho do Instagram não');
    const c = await admin.post('/api/v1/whatsapp/flows', { accountId: cloud, name: 'Raio X', triggerType: 'wa_broadcast' });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    flowId = c.body.id;
    assert.deepEqual(c.body.draft.nodes.map((x: { type: string }) => x.type), ['trigger', 'template']);
    assert.ok(c.body.issues.some((i: { level: string; message: string }) => i.level === 'error' && /modelo aprovado/.test(i.message)));
    assert.equal((await admin.post(`/api/v1/whatsapp/flows/${flowId}/publish`)).status, 422, 'sem modelo escolhido não publica');
    // Não aparece nos fluxos do Instagram, nem abre por lá; outra empresa não vê.
    assert.equal((await admin.get(`/api/v1/instagram/flows/${flowId}`)).status, 404);
    assert.ok(!(await admin.get('/api/v1/instagram/flows')).body.some((x: { id: string }) => x.id === flowId));
    assert.equal((await adminB.get(`/api/v1/whatsapp/flows/${flowId}`)).status, 404);
    assert.equal((await admin.post('/api/v1/instagram/flows', { accountId: cloud, name: 'X', triggerType: 'wa_broadcast' })).status, 422);

    const draft = {
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { type: 'wa_broadcast', match: 'any', keywords: [], frequency: 'every' } },
        { id: 'n1', type: 'template', position: { x: 380, y: 0 }, data: { templateId: template, name: 'raio_x (pt_BR)', params: ['{{nome}}'], buttons: [{ id: 'q0', title: 'QUERO MEU RAIO X' }, { id: 'q1', title: 'COMO FUNCIONA?' }] } },
        { id: 'n2', type: 'action', position: { x: 760, y: 0 }, data: { ops: [{ kind: 'add_tag', tagId: tag }] } },
        { id: 'n3', type: 'question', position: { x: 1140, y: 0 }, data: { text: 'Perfeito, {{nome}}! Qual o seu melhor e-mail?', saveTo: 'email', key: 'email', validate: 'email', retryText: 'Esse e-mail não parece certo. Pode mandar de novo?', timeoutHours: null } },
        { id: 'n4', type: 'text', position: { x: 1520, y: 0 }, data: { text: 'Obrigado! Seu Raio X chega em {{email}}.', buttons: [] } },
        { id: 'n5', type: 'text', position: { x: 760, y: 300 }, data: { text: 'É simples: analisamos o seu caso e mandamos o relatório.', buttons: [{ id: 'b1', title: 'Quero agora', url: null }] } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' },
        { id: 'e2', source: 'n1', sourceHandle: 'btn:q0', target: 'n2' },
        { id: 'e3', source: 'n2', sourceHandle: 'next', target: 'n3' },
        { id: 'e4', source: 'n3', sourceHandle: 'next', target: 'n4' },
        { id: 'e5', source: 'n1', sourceHandle: 'btn:q1', target: 'n5' },
        { id: 'e6', source: 'n5', sourceHandle: 'btn:b1', target: 'n2' },
      ],
    };
    // Modelo ainda em análise: não publica.
    assert.equal((await admin.patch(`/api/v1/whatsapp/flows/${flowId}`, { draft })).status, 200);
    const pending = await admin.post(`/api/v1/whatsapp/flows/${flowId}/publish`);
    assert.equal(pending.status, 422);
    assert.match(pending.body.errors[0].message, /aprovado/);
    await f.admin.query(`update whatsapp_templates set status = 'APPROVED' where id = $1`, [template]);
    // Botão que não é resposta rápida do modelo (o 3º é link): recusa.
    const bad = structuredClone(draft);
    bad.nodes[1]!.data = { ...bad.nodes[1]!.data, buttons: [{ id: 'q2', title: 'Site' }] } as never;
    assert.equal((await admin.patch(`/api/v1/whatsapp/flows/${flowId}`, { draft: bad })).status, 200);
    assert.equal((await admin.post(`/api/v1/whatsapp/flows/${flowId}/publish`)).status, 422);
    // Primeiro passo não é modelo: erro.
    const text = structuredClone(draft);
    text.edges[0] = { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n5' };
    const t = await admin.patch(`/api/v1/whatsapp/flows/${flowId}`, { draft: text });
    assert.ok(t.body.issues.some((i: { nodeId: string; level: string }) => i.nodeId === 'n5' && i.level === 'error'));
    assert.equal((await admin.patch(`/api/v1/whatsapp/flows/${flowId}`, { draft })).status, 200);
    const p = await admin.post(`/api/v1/whatsapp/flows/${flowId}/publish`);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.status, 'active');
    const list = await admin.get('/api/v1/whatsapp/flows');
    assert.deepEqual(list.body.map((x: { id: string }) => x.id), [flowId]);
  });

  let campaign: string;
  test('transmissão: a campanha com o fluxo manda o modelo com o dado de cada botão', async () => {
    const audience = (await admin.post('/api/v1/tags', { name: 'Lista Raio X' })).body.id;
    for (const [name, phone] of [['Bruna', '+55 31 97777-2222'], ['Caio', '+55 31 96666-3333']] as const) {
      const c = await admin.post('/api/v1/contacts', { firstName: name, phones: [{ number: phone }] });
      await f.admin.query('insert into contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)', [f.tenantA, c.body.id, audience]);
    }
    // Fluxo de outro tipo ou de outra empresa não serve.
    const kw = await admin.post('/api/v1/whatsapp/flows', { accountId: cloud, name: 'Palavra', triggerType: 'wa_keyword' });
    const base = { name: 'Raio X novembro', channel: 'whatsapp', accountId: cloud, audience: { tagIds: [audience] }, perMinute: 120 };
    assert.equal((await admin.post('/api/v1/campaigns', { ...base, flowId: kw.body.id })).status, 422);
    const k = await admin.post('/api/v1/campaigns', { ...base, flowId });
    assert.equal(k.status, 201, JSON.stringify(k.body));
    assert.equal(k.body.flowId, flowId);
    assert.equal(k.body.flow.name, 'Raio X');
    campaign = k.body.id;
    const s = await admin.post(`/api/v1/campaigns/${campaign}/start`, {});
    assert.equal(s.status, 200, JSON.stringify(s.body));
    await dispatch(campaign);
    const got = await admin.get(`/api/v1/campaigns/${campaign}`);
    assert.equal(got.body.status, 'done');
    assert.equal(got.body.stats.sent, 2);

    const out = sentTo('5531977772222');
    assert.equal(out.length, 1);
    assert.equal(out[0]!.type, 'template');
    assert.equal(out[0]!.template!.name, 'raio_x');
    const comps = out[0]!.template!.components as { type: string; sub_type?: string; index?: string; parameters: { type: string; text?: string; payload?: string }[] }[];
    assert.deepEqual(comps.find((c) => c.type === 'body')!.parameters.map((x) => x.text), ['Bruna']);
    const btns = comps.filter((c) => c.type === 'button');
    assert.deepEqual(btns.map((b) => [b.sub_type, b.index]), [['quick_reply', '0'], ['quick_reply', '1']]);
    assert.match(btns[0]!.parameters[0]!.payload!, /^f:[0-9a-f-]{36}:q0$/);
    // No histórico: a mensagem com a campanha e o fluxo, e os botões no texto.
    const m = await f.admin.query<{ campaign_id: string; ig_flow_id: string; body: string }>(
      `select campaign_id, ig_flow_id, body from messages where remote = '+5531977772222' and direction = 'out'`);
    assert.equal(m.rows[0]!.campaign_id, campaign);
    assert.equal(m.rows[0]!.ig_flow_id, flowId);
    assert.match(m.rows[0]!.body, /\[QUERO MEU RAIO X\] \[COMO FUNCIONA\?\]/);
    const r = await f.admin.query<{ n: number }>(`select count(*)::int as n from campaign_recipients where campaign_id = $1 and message_id is not null and status = 'sent'`, [campaign]);
    assert.equal(r.rows[0]!.n, 2);
  });

  test('o clique no botão do modelo continua o fluxo: etiqueta, pergunta com validação e resposta final', async () => {
    const payload = ((sentTo('5531977772222')[0]!.template!.components as { type: string; parameters: { payload?: string }[] }[])
      .filter((c) => c.type === 'button')[0]!.parameters[0]!.payload)!;
    // A Meta pode mandar o número sem o nono dígito.
    const r = await hook(wa('553177772222', { type: 'button', button: { payload, text: 'QUERO MEU RAIO X' } }, 'Bruna'));
    assert.equal(r.handled, 1);
    const contact = (await f.admin.query<{ contact_id: string }>(`select contact_id from contact_phones where e164 = '+5531977772222'`)).rows[0]!.contact_id;
    assert.equal((await f.admin.query('select 1 from contact_tags where contact_id = $1 and tag_id = $2', [contact, tag])).rowCount, 1, 'etiqueta adicionada');
    let out = sentTo('5531977772222');
    assert.deepEqual([out.at(-1)!.type, out.at(-1)!.text!.body], ['text', 'Perfeito, Bruna! Qual o seu melhor e-mail?']);
    // Repetir o mesmo clique não faz nada.
    await hook(wa('5531977772222', { type: 'button', button: { payload, text: 'QUERO MEU RAIO X' } }, 'Bruna'));
    assert.equal(sentTo('5531977772222').length, out.length);

    await hook(wa('5531977772222', { type: 'text', text: { body: 'bruna arroba exemplo' } }, 'Bruna'));
    out = sentTo('5531977772222');
    assert.equal(out.at(-1)!.text!.body, 'Esse e-mail não parece certo. Pode mandar de novo?');
    await hook(wa('5531977772222', { type: 'text', text: { body: 'Bruna@Exemplo.com' } }, 'Bruna'));
    out = sentTo('5531977772222');
    assert.equal(out.at(-1)!.text!.body, 'Obrigado! Seu Raio X chega em bruna@exemplo.com.');
    assert.equal((await f.admin.query(`select 1 from contact_emails where contact_id = $1 and email = 'bruna@exemplo.com'`, [contact])).rowCount, 1);
    const run = (await f.admin.query<{ status: string }>(`select status from ig_flow_runs where flow_id = $1 and contact_id = $2`, [flowId, contact])).rows[0]!;
    assert.equal(run.status, 'done');
  });

  test('escrever o nome do botão vale como clique; botão da mensagem interativa continua o caminho', async () => {
    await hook(wa('5531966663333', { type: 'text', text: { body: 'Como funciona?' } }, 'Caio'));
    let out = sentTo('5531966663333');
    const last = out.at(-1)!;
    assert.equal(last.type, 'interactive');
    assert.equal(last.interactive!.body.text, 'É simples: analisamos o seu caso e mandamos o relatório.');
    const reply = last.interactive!.action.buttons[0]!.reply;
    assert.equal(reply.title, 'Quero agora');
    assert.match(reply.id, /^f:[0-9a-f-]{36}:b1$/);
    await hook(wa('5531966663333', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: reply.id, title: 'Quero agora' } } }, 'Caio'));
    out = sentTo('5531966663333');
    assert.equal(out.at(-1)!.text!.body, 'Perfeito, Caio! Qual o seu melhor e-mail?');
    const h = await f.admin.query<{ body: string }>(`select body from messages where remote = '+5531966663333' and direction = 'out' and kind = 'text' order by created_at`);
    assert.ok(h.rows.some((x) => x.body.endsWith('[Quero agora]')), 'o botão aparece no histórico');
  });

  test('resultados: disparos, cliques por botão e quem tocou na campanha', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const r = await admin.get(`/api/v1/whatsapp/flows/${flowId}/results?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.totals.triggered, 2);
    assert.equal(r.body.totals.completed, 1);
    const clicks = Object.fromEntries(r.body.buttons.map((b: { button: string; clicks: number }) => [b.button, b.clicks]));
    assert.deepEqual(clicks, { 'QUERO MEU RAIO X': 1, 'COMO FUNCIONA?': 1, 'Quero agora': 1 });
    const k = await admin.get(`/api/v1/campaigns/${campaign}`);
    assert.equal(k.body.flowStats.clicked, 2);
    assert.equal(k.body.flowStats.waiting, 1);
  });

  test('palavra-chave: mensagem com a palavra começa o fluxo para quem escreveu', async () => {
    const c = await admin.post('/api/v1/whatsapp/flows', { accountId: cloud, name: 'Preço', triggerType: 'wa_keyword' });
    const draft = {
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { type: 'wa_keyword', match: 'contains', keywords: ['preço'], frequency: 'once_per_contact' } },
        { id: 'n1', type: 'text', position: { x: 380, y: 0 }, data: { text: 'Oi, {{nome}}! O plano custa R$ 99. Pelo número {{telefone}}.', buttons: [] } },
      ],
      edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' }],
    };
    assert.equal((await admin.patch(`/api/v1/whatsapp/flows/${c.body.id}`, { draft })).status, 200);
    assert.equal((await admin.post(`/api/v1/whatsapp/flows/${c.body.id}/publish`)).status, 200);
    await hook(wa('5521988887777', { type: 'text', text: { body: 'Qual o PRECO?' } }, 'Dani Souza'));
    let out = sentTo('5521988887777');
    assert.equal(out.at(-1)!.text!.body, 'Oi, Dani! O plano custa R$ 99. Pelo número +5521988887777.');
    // Uma vez por pessoa.
    await hook(wa('5521988887777', { type: 'text', text: { body: 'e o preço?' } }, 'Dani Souza'));
    out = sentTo('5521988887777');
    assert.equal(out.length, 1);
    // Pausar encerra quem estava no meio; o fluxo pausado não dispara.
    assert.equal((await admin.post(`/api/v1/whatsapp/flows/${c.body.id}/pause`)).body.status, 'paused');
    await hook(wa('5521977776666', { type: 'text', text: { body: 'preço' } }, 'Edu'));
    assert.equal(sentTo('5521977776666').length, 0);
  });
});
