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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

let f: Fixture;
let app: NestFastifyApplication;
let meta: FakeMeta;
let ip = 0;
let admin: Browser;
let adminB: Browser;
let cloud: string;
let hookPath: string;
let verifyToken: string;
let ig: string;
let igHook: string;

async function login(email: string): Promise<Browser> {
  const b = new Browser(app, `10.64.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  const s = await b.post('/api/v1/auth/mfa/setup');
  assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  return b;
}

/** Aviso da Meta assinado com o segredo do app (ou com outro, para testar a recusa). */
async function hook(path: string, body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const r = await app.inject({ method: 'POST', url: path, payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, remoteAddress: '10.64.9.9' });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
}

const waMessage = (from: string, id: string, msg: Record<string, unknown>, name = 'Cliente Oficial') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '200000000001', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '551133334444', phone_number_id: '100000000123' },
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), ...msg }],
  } }] }],
});

before(async () => {
  f = await createDatabase();
  meta = new FakeMeta([TOKEN]);
  await meta.start();
  ({ app } = await startApi(f, { META_GRAPH_URL: meta.url, META_INSTAGRAM_URL: meta.url }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test');
  adminB = await login('admin@b.test');
});

after(async () => {
  await app?.close();
  await meta?.stop();
  if (f) await dropDatabase(f);
});

describe('WhatsApp oficial (Cloud API)', () => {
  test('cadastrar: token errado mostra o erro; certo conecta e mostra o endereço dos avisos', async () => {
    const bad = await admin.post('/api/v1/channels/whatsapp-cloud', { name: 'Oficial', phoneNumberId: '100000000123', wabaId: '200000000001', token: 'errado', appSecret: SECRET });
    assert.equal(bad.status, 201, JSON.stringify(bad.body));
    assert.equal(bad.body.status, 'error');
    assert.match(bad.body.lastError, /token de acesso é inválido/);
    cloud = bad.body.id;
    const ok = await admin.patch(`/api/v1/channels/whatsapp-cloud/${cloud}`, { name: 'Oficial', phoneNumberId: '100000000123', wabaId: '200000000001', token: TOKEN });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'connected');
    assert.equal(ok.body.address, '+551133334444');
    assert.equal(ok.body.subscribed, true);
    assert.equal(meta.calls.at(-1)!.path, '200000000001/subscribed_apps', 'o app é ligado à conta do WhatsApp Business');
    hookPath = new URL(ok.body.webhook.url).pathname;
    verifyToken = ok.body.webhook.verifyToken;
    const list = await admin.get('/api/v1/channels');
    const acc = list.body.accounts.find((a: { id: string }) => a.id === cloud);
    assert.equal(acc.cloud.verifiedName, 'Empresa Teste');
    assert.equal(acc.webhook.url, ok.body.webhook.url, 'o endereço é sempre o mesmo');
    const raw = await f.admin.query<{ secret: Buffer }>('select secret from channel_accounts where id = $1', [cloud]);
    assert.equal(raw.rows[0]!.secret.includes(Buffer.from(TOKEN)), false, 'o token fica cifrado');
    assert.equal(JSON.stringify(list.body).includes(TOKEN), false, 'e não volta para a tela');
  });

  test('a Meta verifica o endereço; aviso sem assinatura certa é recusado', async () => {
    const v = await app.inject({ method: 'GET', url: `${hookPath}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=12345` });
    assert.equal(v.statusCode, 200);
    assert.equal(v.body, '12345');
    assert.equal((await app.inject({ method: 'GET', url: `${hookPath}?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=1` })).statusCode, 403);
    assert.equal((await hook(hookPath, waMessage('5521999990000', 'wamid.X', { type: 'text', text: { body: 'oi' } }), 'outro-segredo')).status, 403);
    assert.equal((await hook('/api/v1/webhooks/meta/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', {})).status, 404);
  });

  let conv: string;
  test('mensagem recebida cria o contato e a conversa; a resposta sai pela Cloud API e o status volta', async () => {
    const r = await hook(hookPath, waMessage('5521999990000', 'wamid.IN1', { type: 'text', text: { body: 'Quero um orçamento' } }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.handled, 1);
    const list = await admin.get('/api/v1/conversations?channel=whatsapp');
    const c = list.body.items.find((i: { contact: { name: string } }) => i.contact.name === 'Cliente Oficial');
    assert.ok(c);
    conv = c.id;
    const s = await admin.post(`/api/v1/conversations/${conv}/messages`, { accountId: cloud, text: 'Olá! Já mando.' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.status, 'sent');
    const out = meta.sent.at(-1)!;
    assert.deepEqual([out.path, out.body.to, out.body.type, (out.body.text as { body: string }).body], ['100000000123/messages', '5521999990000', 'text', 'Olá! Já mando.']);
    const wamid = (await f.admin.query<{ external_id: string }>('select external_id from messages where id = $1', [s.body.id])).rows[0]!.external_id;
    await hook(hookPath, { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: '100000000123' }, statuses: [{ id: wamid, status: 'read', timestamp: '1', recipient_id: '5521999990000' }] } }] }] });
    const h = await admin.get(`/api/v1/conversations/${conv}/messages`);
    assert.equal(h.body.items.at(-1).status, 'read');
  });

  test('imagem recebida é baixada da Meta e fica no histórico', async () => {
    meta.media.set('media-123', { data: PNG, type: 'image/png' });
    await hook(hookPath, waMessage('5521999990000', 'wamid.IN2', { type: 'image', image: { id: 'media-123', mime_type: 'image/png', caption: 'Foto' } }));
    const h = await admin.get(`/api/v1/conversations/${conv}/messages`);
    const m = h.body.items.find((x: { body: string }) => x.body === 'Foto');
    assert.equal(m.kind, 'image');
    assert.equal(m.file.contentType, 'image/png');
  });

  let template: string;
  test('fora das 24 h: texto livre é recusado; modelo criado, aprovado e enviado', async () => {
    const c = await admin.post('/api/v1/contacts', { firstName: 'Nunca Escreveu', phones: [{ number: '+55 31 98888-1111' }] });
    const start = await admin.post('/api/v1/conversations', { contactId: c.body.id, channel: 'whatsapp' });
    const free = await admin.post(`/api/v1/conversations/${start.body.id}/messages`, { accountId: cloud, text: 'Oi' });
    assert.equal(free.status, 409);
    assert.equal(free.body.type, 'outside-window');

    const bad = await admin.post('/api/v1/whatsapp-templates', { accountId: cloud, name: 'oferta', category: 'MARKETING', body: '{{1}} tem oferta', examples: [] });
    assert.equal(bad.status, 422);
    const t = await admin.post('/api/v1/whatsapp-templates', {
      accountId: cloud, name: 'Boas_Vindas', category: 'UTILITY', header: 'Bem-vindo', body: 'Olá {{1}}, seu pedido {{2}} está pronto.', footer: 'Empresa Teste',
      buttons: ['Falar com atendente'], examples: ['Maria', '123'],
    });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal(t.body.name, 'boas_vindas');
    assert.equal(t.body.status, 'PENDING');
    template = t.body.id;
    const sentTpl = meta.templates.at(-1)!;
    assert.deepEqual(sentTpl.components.map((x) => (x as { type: string }).type), ['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
    // Ainda pendente: não pode usar.
    assert.equal((await admin.post(`/api/v1/conversations/${start.body.id}/messages`, { accountId: cloud, templateId: template, templateParams: ['Ana', '1'] })).status, 422);
    // A Meta aprova (pelo aviso) e o CRM atualiza.
    await hook(hookPath, { object: 'whatsapp_business_account', entry: [{ id: '200000000001', changes: [{ field: 'message_template_status_update',
      value: { event: 'APPROVED', message_template_id: Number(sentTpl.id), message_template_name: 'boas_vindas', message_template_language: 'pt_BR', reason: 'NONE' } }] }] });
    const approved = await admin.get(`/api/v1/whatsapp-templates?accountId=${cloud}&approved=1`);
    assert.deepEqual(approved.body.items.map((x: { name: string }) => x.name), ['boas_vindas']);

    assert.equal((await admin.post(`/api/v1/conversations/${start.body.id}/messages`, { accountId: cloud, templateId: template, templateParams: ['Ana'] })).status, 422, 'falta variável');
    const s = await admin.post(`/api/v1/conversations/${start.body.id}/messages`, { accountId: cloud, templateId: template, templateParams: ['Ana', '987'] });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.body, 'Bem-vindo\n\nOlá Ana, seu pedido 987 está pronto.');
    const out = meta.sent.at(-1)!.body as { type: string; template: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] } };
    assert.equal(out.type, 'template');
    assert.equal(out.template.name, 'boas_vindas');
    assert.equal(out.template.language.code, 'pt_BR');
    assert.deepEqual(out.template.components[0]!.parameters.map((p) => p.text), ['Ana', '987']);
  });

  test('sincronizar traz os modelos da Meta; outra empresa não vê; excluir apaga lá e aqui', async () => {
    for (const t of meta.templates) t.status = 'APPROVED';
    meta.templates.push({ id: '9123', name: 'lembrete', language: 'pt_BR', category: 'UTILITY', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT',
      components: [{ type: 'BODY', text: 'Lembrete: {{1}}', example: { body_text: [['amanhã']] } }] });
    const s = await admin.post('/api/v1/whatsapp-templates/sync', { accountId: cloud });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const all = await admin.get('/api/v1/whatsapp-templates');
    const rej = all.body.items.find((x: { name: string }) => x.name === 'lembrete');
    assert.equal(rej.status, 'REJECTED');
    assert.equal(rej.reason, 'INVALID_FORMAT');
    assert.equal((await adminB.get('/api/v1/whatsapp-templates')).body.items.length, 0);
    assert.equal((await adminB.del(`/api/v1/whatsapp-templates/${rej.id}`)).status, 404);
    assert.equal((await admin.del(`/api/v1/whatsapp-templates/${rej.id}`)).status, 204);
    assert.equal(meta.templates.some((t) => t.name === 'lembrete'), false);
  });

  test('campanha pelo WhatsApp oficial sai com o modelo e as variáveis de cada contato', async () => {
    const tag = (await admin.post('/api/v1/tags', { name: 'Oficial' })).body.id;
    const c = await admin.post('/api/v1/contacts', { firstName: 'Bruna', phones: [{ number: '+55 31 97777-2222' }] });
    await f.admin.query('insert into contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)', [f.tenantA, c.body.id, tag]);
    const k = await admin.post('/api/v1/campaigns', { name: 'Oficial', channel: 'whatsapp', accountId: cloud, audience: { tagIds: [tag] }, perMinute: 120, templateId: template, templateParams: ['{{primeiro_nome}}'] });
    assert.equal(k.status, 201, JSON.stringify(k.body));
    const fail = await admin.post(`/api/v1/campaigns/${k.body.id}/start`, {});
    assert.equal(fail.status, 422, 'faltam variáveis do modelo');
    assert.equal(fail.body.errors[0].field, 'templateParams');
    await admin.patch(`/api/v1/campaigns/${k.body.id}`, { name: 'Oficial', channel: 'whatsapp', accountId: cloud, audience: { tagIds: [tag] }, perMinute: 120, templateId: template, templateParams: ['{{primeiro_nome}}', 'A1'] });
    assert.equal((await admin.post(`/api/v1/campaigns/${k.body.id}/start`, {})).status, 200);
    for (let i = 0; i < 5; i++) {
      await f.admin.query("update campaigns set next_at = now() - interval '1 second' where id = $1 and status = 'sending'", [k.body.id]);
      await app.get(DispatcherService).runOnce();
    }
    const out = meta.sent.at(-1)!.body as { to: string; type: string; template: { components: { parameters: { text: string }[] }[] } };
    assert.deepEqual([out.to, out.type, out.template.components[0]!.parameters.map((p) => p.text)], ['5531977772222', 'template', ['Bruna', 'A1']]);
    assert.equal((await admin.get(`/api/v1/campaigns/${k.body.id}`)).body.status, 'done');
  });
});

describe('registro do número e chaves', () => {
  test('com o PIN, o número é registrado na Cloud API; PIN errado mostra o erro', async () => {
    const wrong = await admin.patch(`/api/v1/channels/whatsapp-cloud/${cloud}`, { name: 'Oficial', phoneNumberId: '100000000123', wabaId: '200000000001', pin: '000000' });
    assert.equal(wrong.body.status, 'error');
    assert.match(wrong.body.lastError, /não foi registrado/);
    assert.equal((await admin.patch(`/api/v1/channels/whatsapp-cloud/${cloud}`, { name: 'Oficial', phoneNumberId: '100000000123', wabaId: '200000000001', pin: '12' })).status, 422);
    const ok = await admin.patch(`/api/v1/channels/whatsapp-cloud/${cloud}`, { name: 'Oficial', phoneNumberId: '100000000123', wabaId: '200000000001', pin: '123456' });
    assert.equal(ok.body.status, 'connected', JSON.stringify(ok.body));
    assert.equal(ok.body.registered, true);
    const reg = meta.calls.filter((c) => c.path === '100000000123/register').at(-1)!;
    assert.deepEqual(reg.body, { messaging_product: 'whatsapp', pin: '123456' });
  });
});

describe('Instagram', () => {
  test('cadastrar e receber: o contato nasce com o @ do Instagram', async () => {
    const r = await admin.post('/api/v1/channels/instagram', { name: 'Insta', igUserId: '17841400000099', token: TOKEN, appSecret: SECRET });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'connected');
    assert.equal(r.body.address, '@empresa.teste');
    assert.equal(meta.calls.at(-1)!.path, 'me/subscribed_apps', 'os avisos de mensagens são ativados para a conta');
    ig = r.body.id;
    igHook = new URL(r.body.webhook.url).pathname;
    const msg = (mid: string, text: string, at = Date.now()) => ({ object: 'instagram', entry: [{ id: '17841400000099', time: at, messaging: [
      { sender: { id: '912345678901' }, recipient: { id: '17841400000099' }, timestamp: at, message: { mid, text } }] }] });
    const h = await hook(igHook, msg('mid.IN1', 'Oi! Vi o anúncio.'));
    assert.equal(h.body.handled, 1);
    const handle = await f.admin.query<{ contact_id: string; username: string }>("select contact_id, username from contact_handles where value = '912345678901'");
    assert.equal(handle.rows[0]!.username, 'cliente.insta');
    const list = await admin.get('/api/v1/conversations?channel=instagram');
    assert.equal(list.body.items[0].contact.name, 'Cliente Insta');
    assert.equal(list.body.items[0].contact.instagram, '@cliente.insta');
    assert.equal((await hook(igHook, msg('mid.IN1', 'Oi! Vi o anúncio.'))).body.handled, 0, 'repetido não duplica');
  });

  test('responder dentro de 24 h; depois disso o Instagram não deixa', async () => {
    const conv = (await admin.get('/api/v1/conversations?channel=instagram')).body.items[0].id;
    const s = await admin.post(`/api/v1/conversations/${conv}/messages`, { accountId: ig, text: 'Olá! Como posso ajudar?' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const out = meta.sent.at(-1)!;
    assert.deepEqual([out.path, (out.body.recipient as { id: string }).id, (out.body.message as { text: string }).text], ['17841400000099/messages', '912345678901', 'Olá! Como posso ajudar?']);
    await f.admin.query("update messages set created_at = now() - interval '2 days' where channel = 'instagram' and direction = 'in'");
    const late = await admin.post(`/api/v1/conversations/${conv}/messages`, { accountId: ig, text: 'Ainda aí?' });
    assert.equal(late.status, 409);
    assert.match(late.body.title, /24 horas/);
    assert.equal((await admin.post(`/api/v1/conversations/${conv}/messages`, { accountId: cloud, text: 'x' })).status, 422, 'conta de outro canal');
  });

  test('aviso assinado com a segunda chave (app do Instagram) também vale', async () => {
    await admin.patch(`/api/v1/channels/instagram/${ig}`, { name: 'Insta', igUserId: '17841400000099', appSecret2: 'chave-do-app-do-instagram' });
    const body = { object: 'instagram', entry: [{ id: '17841400000099', time: Date.now(), messaging: [
      { sender: { id: '912345678901' }, recipient: { id: '17841400000099' }, timestamp: Date.now(), message: { mid: 'mid.IN2', text: 'Outra' } }] }] };
    assert.equal((await hook(igHook, body, 'chave-do-app-do-instagram')).status, 200);
    assert.equal((await hook(igHook, body, 'chave-errada')).status, 403);
  });

  test('o token do Instagram é renovado sozinho antes dos 60 dias', async () => {
    await f.admin.query(`update channel_accounts set config = config || jsonb_build_object('tokenRefreshedAt', now() - interval '8 days') where id = $1`, [ig]);
    await app.get(DispatcherService).runOnce();
    assert.deepEqual(meta.refreshed, [TOKEN]);
    const conv = (await admin.get('/api/v1/conversations?channel=instagram')).body.items[0].id;
    await f.admin.query("update messages set created_at = now() where channel = 'instagram' and direction = 'in'");
    meta.tokens.delete(TOKEN);
    const s = await admin.post(`/api/v1/conversations/${conv}/messages`, { accountId: ig, text: 'Com o token novo' });
    assert.equal(s.body.status, 'sent', 'usa o token renovado');
    meta.tokens.add(TOKEN);
    await app.get(DispatcherService).runOnce();
    assert.equal(meta.refreshed.length, 1, 'não renova de novo logo em seguida');
  });
});
