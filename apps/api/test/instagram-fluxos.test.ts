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
const IG = '17841400000099';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

let f: Fixture;
let app: NestFastifyApplication;
let meta: FakeMeta;
let ip = 0;
let admin: Browser;
let sales: Browser;
let adminB: Browser;
let account: string;
let hookPath: string;
let n = 0;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.66.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

async function hook(body: unknown) {
  const raw = JSON.stringify(body);
  const sig = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  const r = await app.inject({ method: 'POST', url: hookPath, payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, remoteAddress: '10.66.9.9' });
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as { handled: number };
}

const comment = (from: string, username: string, text: string, opts: { media?: string; live?: boolean; id?: string } = {}) => {
  const id = opts.id ?? `1800000000${String(++n).padStart(7, '0')}`;
  meta.commenters.set(id, from);
  return { id, body: { object: 'instagram', entry: [{ id: IG, time: Math.floor(Date.now() / 1000), changes: [{
    field: opts.live ? 'live_comments' : 'comments',
    value: { from: { id: from, username }, media: { id: opts.media ?? '17900000000000001', media_product_type: opts.live ? 'LIVE' : 'REELS' }, id, text },
  }] }] } };
};
const dm = (from: string, message: Record<string, unknown>) => ({
  object: 'instagram', entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: `mid.in.${++n}`, ...message } }] }],
});
const postback = (from: string, payload: string, title = 'Quero') => ({
  object: 'instagram', entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: Date.now(), postback: { mid: `mid.pb.${++n}`, title, payload } }] }],
});
const reaction = (from: string, mid: string) => ({
  object: 'instagram', entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: Date.now(), reaction: { mid, action: 'react', reaction: 'love', emoji: '❤️' } }] }],
});
/** Mensagens mandadas pelo Instagram falso (direct e respostas a comentários) a partir de um ponto. */
const sentFrom = (i: number) => meta.sent.slice(i).filter((s) => s.path.startsWith(IG) || s.path.endsWith('/replies'));

async function flow(trigger: string, draft: unknown, name = `Fluxo ${++n}`) {
  const c = await admin.post('/api/v1/instagram/flows', { accountId: account, name, triggerType: trigger });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await admin.patch(`/api/v1/instagram/flows/${c.body.id}`, { draft });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const p = await admin.post(`/api/v1/instagram/flows/${c.body.id}/publish`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.status, 'active');
  return c.body.id as string;
}

before(async () => {
  f = await createDatabase();
  meta = new FakeMeta([TOKEN]);
  await meta.start();
  ({ app } = await startApi(f, { META_GRAPH_URL: meta.url, META_INSTAGRAM_URL: meta.url }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  adminB = await login('admin@b.test', true);
  const r = await admin.post('/api/v1/channels/instagram', { name: 'Insta', igUserId: IG, token: TOKEN, appSecret: SECRET });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  account = r.body.id;
  hookPath = new URL(r.body.webhook.url).pathname;
});

after(async () => {
  await app?.close();
  await meta?.stop();
  if (f) await dropDatabase(f);
});

describe('fluxos do Instagram', () => {
  test('a conta ativa os avisos que os fluxos usam (comentários, live, menções, reações, cliques)', async () => {
    assert.deepEqual(meta.igFields.sort(), ['comments', 'live_comments', 'mentions', 'message_reactions', 'messages', 'messaging_postbacks']);
    const d = await admin.get(`/api/v1/instagram/diagnostics?accountId=${account}`);
    assert.equal(d.status, 200);
    assert.deepEqual(d.body.missing, []);
    meta.igFields = ['messages'];
    const d2 = await admin.get(`/api/v1/instagram/diagnostics?accountId=${account}`);
    assert.ok(d2.body.missing.includes('comments'));
    const fixed = await admin.post('/api/v1/instagram/diagnostics/subscribe', { accountId: account });
    assert.deepEqual(fixed.body.missing, []);
  });

  test('comentário "eu quero": responde no comentário e no privado; clique, pergunta, condição e ação', async () => {
    const vip = (await admin.post('/api/v1/tags', { name: 'VIP' })).body;
    const leadTag = (await admin.post('/api/v1/tags', { name: 'Lead Instagram' })).body;
    const id = await flow('comment', {
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { type: 'comment', posts: 'any', match: 'contains', keywords: ['eu quero'], frequency: 'once_per_post' } },
        { id: 'n1', type: 'comment_reply', position: { x: 300, y: 0 }, data: { variants: ['Te mandei no direct! 📩'] } },
        { id: 'n2', type: 'private_reply', position: { x: 600, y: 0 }, data: { text: 'Oi, {{nome}}! Toque no botão 👇', buttons: [{ id: 'b1', title: 'Quero' }] } },
        { id: 'n3', type: 'text', position: { x: 900, y: 0 }, data: { text: 'Aqui está o catálogo, {{usuario}}!', buttons: [{ id: 'l1', title: 'Ver catálogo', url: 'https://exemplo.com/catalogo' }] } },
        { id: 'n4', type: 'question', position: { x: 1200, y: 0 }, data: { text: 'Qual o seu e-mail?', saveTo: 'email', key: 'email', validate: 'email', retryText: 'Esse e-mail não parece certo. Manda de novo?' } },
        { id: 'n5', type: 'condition', position: { x: 1500, y: 0 }, data: { match: 'all', rules: [{ kind: 'has_tag', tagId: vip.id }] } },
        { id: 'n6', type: 'action', position: { x: 1800, y: -100 }, data: { ops: [{ kind: 'add_tag', tagId: vip.id }] } },
        { id: 'n7', type: 'action', position: { x: 1800, y: 100 }, data: { ops: [{ kind: 'add_tag', tagId: leadTag.id }, { kind: 'create_lead', title: 'Catálogo: {{usuario}}' }, { kind: 'set_field', key: 'origem', value: 'reels {{comentario}}' }] } },
        { id: 'n8', type: 'text', position: { x: 2100, y: 0 }, data: { text: 'Obrigado! Já anotei: {{email}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' },
        { id: 'e2', source: 'n1', sourceHandle: 'next', target: 'n2' },
        { id: 'e3', source: 'n2', sourceHandle: 'btn:b1', target: 'n3' },
        { id: 'e4', source: 'n3', sourceHandle: 'next', target: 'n4' },
        { id: 'e5', source: 'n4', sourceHandle: 'next', target: 'n5' },
        { id: 'e6', source: 'n5', sourceHandle: 'yes', target: 'n6' },
        { id: 'e7', source: 'n5', sourceHandle: 'no', target: 'n7' },
        { id: 'e8', source: 'n7', sourceHandle: 'next', target: 'n8' },
      ],
    }, 'Eu quero');

    // Comentário com a palavra-chave (maiúscula, com exclamação).
    let mark = meta.sent.length;
    const c1 = comment('900000000001', 'maria.silva', 'EU QUERO!!');
    assert.equal((await hook(c1.body)).handled, 1);
    let out = sentFrom(mark);
    assert.equal(out[0]!.path, `${c1.id}/replies`, 'responde no comentário');
    assert.equal((out[0]!.body as { message: string }).message, 'Te mandei no direct! 📩');
    const priv = out[1]!.body as { recipient: { comment_id: string }; message: { attachment: { payload: { text: string; buttons: { payload: string; title: string }[] } } } };
    assert.equal(priv.recipient.comment_id, c1.id, 'resposta privada ao comentário');
    assert.equal(priv.message.attachment.payload.buttons[0]!.title, 'Quero');
    const payload = priv.message.attachment.payload.buttons[0]!.payload;
    assert.match(payload, /^f:[0-9a-f-]{36}:b1$/);
    const run = (await f.admin.query<{ status: string; wait_kind: string; contact_id: string }>('select status, wait_kind, contact_id from ig_flow_runs where flow_id = $1', [id])).rows[0]!;
    assert.deepEqual([run.status, run.wait_kind], ['waiting', 'click']);
    assert.equal((await f.admin.query("select first_name from contacts where id = $1", [run.contact_id])).rows[0].first_name, 'Cliente', 'o nome do perfil completa o contato');

    // A mesma pessoa no mesmo reels: não dispara de novo; sem a palavra, nada; a própria conta, nada.
    mark = meta.sent.length;
    await hook(comment('900000000001', 'maria.silva', 'eu quero de novo').body);
    await hook(comment('900000000002', 'joao', 'que lindo').body);
    await hook(comment(IG, 'empresa', 'eu quero').body);
    assert.equal(sentFrom(mark).length, 0);

    // Toque no botão: manda o catálogo (com link) e a pergunta.
    mark = meta.sent.length;
    await hook(postback('900000000001', payload));
    out = sentFrom(mark);
    const cat = out[0]!.body as { message: { attachment: { payload: { text: string; buttons: { type: string; url: string }[] } } } };
    assert.equal(cat.message.attachment.payload.text, 'Aqui está o catálogo, @maria.silva!');
    assert.equal(cat.message.attachment.payload.buttons[0]!.type, 'web_url');
    assert.equal((out[1]!.body as { message: { text: string } }).message.text, 'Qual o seu e-mail?');
    // Clique repetido não faz nada.
    mark = meta.sent.length;
    await hook(postback('900000000001', payload));
    assert.equal(sentFrom(mark).length, 0);

    // Resposta inválida: pede de novo. Válida: guarda o e-mail, condição "não", ações e agradecimento.
    mark = meta.sent.length;
    await hook(dm('900000000001', { text: 'meu email' }));
    assert.equal((sentFrom(mark)[0]!.body as { message: { text: string } }).message.text, 'Esse e-mail não parece certo. Manda de novo?');
    mark = meta.sent.length;
    await hook(dm('900000000001', { text: 'Maria@Exemplo.com' }));
    assert.equal((sentFrom(mark)[0]!.body as { message: { text: string } }).message.text, 'Obrigado! Já anotei: maria@exemplo.com');
    const email = await f.admin.query('select email from contact_emails where contact_id = $1', [run.contact_id]);
    assert.equal(email.rows[0].email, 'maria@exemplo.com');
    const tags = await f.admin.query('select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1', [run.contact_id]);
    assert.deepEqual(tags.rows.map((r: { name: string }) => r.name), ['Lead Instagram'], 'caminho "não" da condição');
    const lead = await f.admin.query('select title, source from leads where contact_id = $1', [run.contact_id]);
    assert.deepEqual(lead.rows[0], { title: 'Catálogo: @cliente.insta', source: 'Instagram' });
    assert.equal((await f.admin.query('select custom from contacts where id = $1', [run.contact_id])).rows[0].custom.origem, 'reels EU QUERO!!');
    assert.equal((await f.admin.query('select status from ig_flow_runs where flow_id = $1', [id])).rows[0].status, 'done');

    // Tudo aparece em Conversas, com o nome do fluxo.
    const msgs = await f.admin.query<{ direction: string; ig_flow_id: string | null; body: string }>(
      `select direction, ig_flow_id, body from messages where contact_id = $1 and channel = 'instagram' order by created_at`, [run.contact_id]);
    assert.ok(msgs.rows.filter((m) => m.direction === 'out').every((m) => m.ig_flow_id === id));
    assert.ok(msgs.rows.some((m) => m.direction === 'in' && m.body === 'Maria@Exemplo.com'));

    // Resultados.
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const res = await admin.get(`/api/v1/instagram/flows/${id}/results?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.triggered, 1);
    assert.equal(res.body.totals.people, 1);
    assert.equal(res.body.totals.completed, 1);
    assert.deepEqual(res.body.buttons, [{ nodeId: 'n2', button: 'Quero', clicks: 1 }]);
    assert.equal(res.body.nodes.find((x: { nodeId: string }) => x.nodeId === 'n4').answered, 1);
    assert.equal(res.body.runs[0].contact.name, 'Cliente Insta');
  });

  test('palavra no direct com botão (o Instagram recusa o modelo: vai como resposta rápida) e espera de 5 minutos', async () => {
    const id = await flow('dm_keyword', {
      nodes: [
        { id: 'trigger', type: 'trigger', data: { type: 'dm_keyword', match: 'contains', keywords: ['preço'], frequency: 'every' } },
        { id: 'a', type: 'text', data: { text: 'Quer receber a tabela?', buttons: [{ id: 'sim', title: 'Sim' }] } },
        { id: 'w', type: 'wait', data: { amount: 5, unit: 'minutes' } },
        { id: 'b', type: 'text', data: { text: 'Aqui está a tabela de preços.' } },
      ],
      edges: [
        { id: '1', source: 'trigger', target: 'a' }, { id: '2', source: 'a', sourceHandle: 'btn:sim', target: 'w' }, { id: '3', source: 'w', target: 'b' },
      ],
    });
    meta.rejectButtonTemplate = true;
    let mark = meta.sent.length;
    await hook(dm('900000000003', { text: 'Qual o preco?' }));
    meta.rejectButtonTemplate = false;
    const q = sentFrom(mark)[0]!.body as { message: { text: string; quick_replies: { payload: string; title: string }[] } };
    assert.equal(q.message.text, 'Quer receber a tabela?');
    assert.equal(q.message.quick_replies[0]!.title, 'Sim');
    // Toque na resposta rápida (chega como mensagem).
    mark = meta.sent.length;
    await hook(dm('900000000003', { text: 'Sim', quick_reply: { payload: q.message.quick_replies[0]!.payload } }));
    assert.equal(sentFrom(mark).length, 0, 'esperando os 5 minutos');
    const run = (await f.admin.query<{ id: string; wait_kind: string; wake_at: Date }>('select id, wait_kind, wake_at from ig_flow_runs where flow_id = $1', [id])).rows[0]!;
    assert.equal(run.wait_kind, 'delay');
    assert.ok(run.wake_at.getTime() - Date.now() > 4 * 60_000);
    await f.admin.query("update ig_flow_runs set wake_at = now() - interval '1 second' where id = $1", [run.id]);
    await app.get(DispatcherService).runOnce();
    assert.equal((sentFrom(mark)[0]!.body as { message: { text: string } }).message.text, 'Aqui está a tabela de preços.');
    assert.equal((await f.admin.query('select status from ig_flow_runs where id = $1', [run.id])).rows[0].status, 'done');
  });

  test('menção e resposta a story, reação e comentário em live', async () => {
    const text = (t: string) => ({ nodes: [{ id: 'trigger', type: 'trigger', data: { type: t, match: 'any', frequency: 'every' } }, { id: 'a', type: 'text', data: { text: `fluxo ${t}` } }], edges: [{ id: '1', source: 'trigger', target: 'a' }] });
    await flow('story_mention', text('story_mention'));
    await flow('story_reply', text('story_reply'));
    await flow('reaction', text('reaction'));
    await flow('live_comment', {
      nodes: [{ id: 'trigger', type: 'trigger', data: { type: 'live_comment', match: 'any' } }, { id: 'p', type: 'private_reply', data: { text: 'Oi da live!' } }],
      edges: [{ id: '1', source: 'trigger', target: 'p' }],
    });
    const last = (mark: number) => (sentFrom(mark)[0]?.body as { message: { text: string } } | undefined)?.message.text;
    let mark = meta.sent.length;
    await hook(dm('900000000004', { attachments: [{ type: 'story_mention', payload: { url: 'https://cdn.exemplo/story.jpg' } }] }));
    assert.equal(last(mark), 'fluxo story_mention');
    mark = meta.sent.length;
    await hook(dm('900000000004', { text: 'Amei!', reply_to: { story: { id: 'story-1', url: 'https://cdn.exemplo/s.jpg' } } }));
    assert.equal(last(mark), 'fluxo story_reply');
    mark = meta.sent.length;
    await hook(reaction('900000000004', 'mid.algum'));
    assert.equal(last(mark), 'fluxo reaction');
    mark = meta.sent.length;
    const lc = comment('900000000005', 'na.live', 'oi', { live: true, media: '17900000000000009' });
    await hook(lc.body);
    assert.deepEqual((sentFrom(mark)[0]!.body as { recipient: unknown }).recipient, { comment_id: lc.id });
    // O mesmo aviso chegando de novo não roda de novo.
    mark = meta.sent.length;
    await hook(lc.body);
    assert.equal(sentFrom(mark).length, 0);
  });

  test('no comentário, o direct só abre pelo clique: texto direto falha com o motivo; publicação escolhida', async () => {
    const id = await flow('comment', {
      nodes: [
        { id: 'trigger', type: 'trigger', data: { type: 'comment', posts: 'chosen', postIds: ['17900000000000002'], match: 'any', frequency: 'every' } },
        { id: 'a', type: 'text', data: { text: 'Direto no direct' } },
      ],
      edges: [{ id: '1', source: 'trigger', target: 'a' }],
    });
    let mark = meta.sent.length;
    await hook(comment('900000000006', 'ana', 'oi', { media: '17900000000000001' }).body);
    assert.equal((await f.admin.query('select count(*)::int as n from ig_flow_runs where flow_id = $1', [id])).rows[0].n, 0, 'outra publicação');
    mark = meta.sent.length;
    await hook(comment('900000000006', 'ana', 'oi', { media: '17900000000000002' }).body);
    assert.equal(sentFrom(mark).length, 0);
    const run = (await f.admin.query<{ status: string; last_error: string }>('select status, last_error from ig_flow_runs where flow_id = $1', [id])).rows[0]!;
    assert.equal(run.status, 'failed');
    assert.match(run.last_error, /conversa ainda não estava aberta/);
    const from = new Date(Date.now() - 3600_000).toISOString();
    const res = await admin.get(`/api/v1/instagram/flows/${id}/results?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
    assert.match(res.body.errors[0].error, /conversa ainda não estava aberta/);
    // O diagnóstico mostra os avisos e o que aconteceu com cada um.
    const d = await admin.get(`/api/v1/instagram/diagnostics?accountId=${account}`);
    assert.ok(d.body.events.some((e: { kind: string; outcome: string }) => e.kind === 'comment' && /já passou/.test(e.outcome)));
    assert.ok(d.body.events.some((e: { outcome: string }) => /nenhum fluxo/.test(e.outcome)));
  });

  test('publicar com erro é barrado; rascunho não mexe no publicado; pausar, duplicar, excluir', async () => {
    const c = await admin.post('/api/v1/instagram/flows', { accountId: account, name: 'Erro', triggerType: 'dm_keyword' });
    assert.deepEqual(c.body.draft.nodes.map((x: { type: string }) => x.type), ['trigger', 'text']);
    await admin.patch(`/api/v1/instagram/flows/${c.body.id}`, {
      draft: { nodes: [{ id: 'trigger', type: 'trigger', data: { type: 'dm_keyword', match: 'any' } }, { id: 'p', type: 'private_reply', data: { text: 'x' } }], edges: [{ id: '1', source: 'trigger', target: 'p' }] },
    });
    const bad = await admin.post(`/api/v1/instagram/flows/${c.body.id}/publish`);
    assert.equal(bad.status, 422);
    assert.match(bad.body.errors[0].message, /só funciona com gatilho de comentário/);
    assert.equal((await admin.patch(`/api/v1/instagram/flows/${c.body.id}`, { draft: { nodes: [] } })).status, 422, 'desenho inválido');

    const list = await admin.get('/api/v1/instagram/flows');
    const eu = list.body.find((x: { name: string }) => x.name === 'Eu quero');
    assert.equal(eu.status, 'active');
    assert.equal(eu.triggered7d, 1);
    // Mudar o rascunho: publicado continua, com "alterações não publicadas".
    const full = await admin.get(`/api/v1/instagram/flows/${eu.id}`);
    const draft = { ...full.body.draft, nodes: full.body.draft.nodes.map((x: { id: string; data: Record<string, unknown> }) => x.id === 'n1' ? { ...x, data: { variants: ['Mudou'] } } : x) };
    const saved = await admin.patch(`/api/v1/instagram/flows/${eu.id}`, { draft });
    assert.equal(saved.body.unpublishedChanges, true);
    assert.equal((await f.admin.query('select published->\'nodes\'->1->\'data\'->\'variants\'->>0 as v from ig_flows where id = $1', [eu.id])).rows[0].v, 'Te mandei no direct! 📩');

    const dup = await admin.post(`/api/v1/instagram/flows/${eu.id}/duplicate`);
    assert.equal(dup.body.name, 'Eu quero (cópia)');
    assert.equal(dup.body.status, 'draft');
    // Pausar encerra quem estava esperando.
    await hook(comment('900000000007', 'pedro', 'eu quero', { media: '17900000000000003' }).body);
    assert.equal((await f.admin.query("select count(*)::int as n from ig_flow_runs where flow_id = $1 and status = 'waiting'", [eu.id])).rows[0].n, 1);
    assert.equal((await admin.post(`/api/v1/instagram/flows/${eu.id}/pause`)).body.status, 'paused');
    assert.equal((await f.admin.query("select count(*)::int as n from ig_flow_runs where flow_id = $1 and status = 'waiting'", [eu.id])).rows[0].n, 0);
    assert.equal((await admin.post(`/api/v1/instagram/flows/${eu.id}/resume`)).body.status, 'active');
    assert.equal((await admin.req('DELETE', `/api/v1/instagram/flows/${dup.body.id}`)).status, 204);

    // Quem não edita campanhas vê, mas não cria; outra empresa não vê nada.
    assert.equal((await sales.get('/api/v1/instagram/flows')).status, 200);
    assert.equal((await sales.post('/api/v1/instagram/flows', { accountId: account, name: 'X', triggerType: 'comment' })).status, 403);
    assert.equal((await adminB.get('/api/v1/instagram/flows')).body.length, 0);
    assert.equal((await adminB.get(`/api/v1/instagram/flows/${eu.id}`)).status, 404);
    assert.equal((await adminB.post('/api/v1/instagram/flows', { accountId: account, name: 'X', triggerType: 'comment' })).status, 422);
  });

  test('publicações, biblioteca de mídia (bloco de mídia manda o arquivo) e contatos com a janela aberta', async () => {
    const posts = await admin.get(`/api/v1/instagram/posts?accountId=${account}`);
    assert.deepEqual(posts.body.map((p: { type: string }) => p.type), ['reels', 'post']);

    const up = await admin.upload('/api/v1/instagram/media', 'catalogo.png', PNG, 'image/png');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const bad = await admin.upload('/api/v1/instagram/media', 'planilha.csv', Buffer.from('a,b\n1,2'), 'text/csv');
    assert.equal(bad.status, 422);
    const lib = await admin.get('/api/v1/instagram/media');
    assert.equal(lib.body.items.length, 1);
    assert.equal(lib.body.quotaBytes, 3 * 1024 ** 3);
    assert.ok(lib.body.usedBytes > 0);

    await flow('dm_keyword', {
      nodes: [
        { id: 'trigger', type: 'trigger', data: { type: 'dm_keyword', match: 'exact', keywords: ['catálogo'] } },
        { id: 'm', type: 'media', data: { fileId: up.body.id, name: 'catalogo.png', kind: 'image' } },
      ],
      edges: [{ id: '1', source: 'trigger', target: 'm' }],
    });
    const mark = meta.sent.length;
    await hook(dm('900000000008', { text: 'Catalogo' }));
    const att = (sentFrom(mark)[0]!.body as { message: { attachment: { type: string; payload: { url: string } } } }).message.attachment;
    assert.equal(att.type, 'image');
    const path = new URL(att.payload.url).pathname;
    const file = await app.inject({ method: 'GET', url: path });
    assert.equal(file.statusCode, 200, 'a Meta consegue buscar o arquivo');
    assert.deepEqual(file.rawPayload, PNG);
    assert.equal((await admin.req('DELETE', `/api/v1/instagram/media/${up.body.id}`)).status, 204);
    assert.equal((await admin.get('/api/v1/instagram/media')).body.items.length, 0);

    const people = await admin.get('/api/v1/instagram/contacts?q=cliente');
    assert.equal(people.body.items[0].name, 'Cliente Insta');
    assert.equal(people.body.items[0].windowOpen, true);
    const all = await admin.get('/api/v1/instagram/contacts');
    assert.ok(all.body.total >= 5);
  });
});
