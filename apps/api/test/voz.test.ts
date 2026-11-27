import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { answerXml, parseEvent } from '../src/infra/voice.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeEvolution } from './fakes.js';

const KEY = 'chave-global-de-teste';
const TWILIO_SID = 'AC0000000000000000000000000000test';
const TWILIO_TOKEN = 'token-twilio-de-teste-1234';
const ZENVIA_TOKEN = 'token-zenvia-de-teste-5678';

type Hit = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> };

/** Operadoras de mentira (Twilio, Zenvia, central Asterisk e API própria) num servidor só. */
class FakeCarrier {
  server: Server | null = null;
  url = '';
  hits: Hit[] = [];
  private n = 0;
  zenviaResult: Record<string, unknown> = { id: 77, status: 'atendida', duracao_segundos: 14, resposta: '2' };

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
        const p = req.url ?? '';
        this.hits.push({ method: req.method ?? '', path: p, headers: req.headers, body });
        const json = (status: number, v: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
        const twilioOk = req.headers.authorization === `Basic ${Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')}`;
        if (p.startsWith('/2010-04-01/')) {
          if (!twilioOk) return json(401, { code: 20003, message: 'Authenticate' });
          if (p.endsWith('/Calls.json')) return json(201, { sid: `CA${++this.n}` });
          if (p.endsWith('/Messages.json')) return json(201, { sid: `SM${++this.n}` });
          return json(200, { sid: TWILIO_SID, status: 'active' });
        }
        if (['/audio', '/sms', '/saldo'].includes(p) || p.startsWith('/audio/')) {
          if (req.headers['access-token'] !== ZENVIA_TOKEN) return json(401, { sucesso: false, mensagem: 'Token inválido' });
          if (p === '/audio') return json(200, { sucesso: true, dados: { id: 77 } });
          if (p === '/audio/77') return json(200, { sucesso: true, dados: this.zenviaResult });
          return json(200, { sucesso: true, dados: { saldo: 10 } });
        }
        if (p.startsWith('/ari/')) return json(200, p.startsWith('/ari/channels') ? { id: 'canal-1' } : { system: { version: '20' } });
        if (p === '/ligar') return json(200, { id: 'ext-1' });
        json(404, {});
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  calls() {
    return this.hits.filter((h) => h.path.endsWith('/Calls.json'));
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}

let f: Fixture;
let app: NestFastifyApplication;
let evo: FakeEvolution;
let carrier: FakeCarrier;
let ip = 0;
let admin: Browser;
let marketing: Browser;
let sales: Browser;
let adminB: Browser;
let wa: string;
let hot: string;
let reached: string;
let lead: string;
let ana: string;
let bia: string;
let audio: Buffer;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.64.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const run = () => app.get(DispatcherService).runOnce();
async function drain(campaignId: string) {
  for (let i = 0; i < 20; i++) {
    await f.admin.query("update campaigns set next_at = now() - interval '1 second' where id = $1 and status = 'sending'", [campaignId]);
    await run();
    const s = await f.admin.query<{ status: string }>('select status from campaigns where id = $1', [campaignId]);
    if (s.rows[0]!.status !== 'sending' && s.rows[0]!.status !== 'scheduled') return s.rows[0]!.status;
  }
  return 'sending';
}

/** Aviso da operadora, como ela manda (formulário; GET para a central). */
async function notify(url: string, form: Record<string, string> = {}, method: 'POST' | 'GET' = 'POST') {
  const u = new URL(url);
  const r = await app.inject({
    method, url: method === 'GET' ? `${u.pathname}?${new URLSearchParams({ ...Object.fromEntries(u.searchParams), ...form })}` : `${u.pathname}${u.search}`,
    headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
    payload: method === 'POST' ? new URLSearchParams(form).toString() : undefined,
    remoteAddress: '54.0.0.1',
  });
  return { status: r.statusCode, text: r.body, type: String(r.headers['content-type'] ?? '') };
}

const recipients = async (campaign: string) => (await f.admin.query<{ id: string; contact_id: string; status: string; call_status: string | null; call_digits: string | null;
  call_seconds: number | null; call_extras: Record<string, string>; reason: string | null }>(
  'select id, contact_id, status, call_status, call_digits, call_seconds, call_extras, reason from campaign_recipients where campaign_id = $1', [campaign])).rows;

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-voz-'));
  const ogg = path.join(dir, 'gravacao.ogg');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', ogg]);
  audio = readFileSync(ogg);

  f = await createDatabase();
  evo = new FakeEvolution(KEY);
  await evo.start();
  carrier = new FakeCarrier();
  await carrier.start();
  ({ app } = await startApi(f, { EVOLUTION_URL: `${evo.url}/`, EVOLUTION_API_KEY: KEY, CHANNEL_ALLOW_PRIVATE_HOSTS: 'true', VOICE_PROVIDER_BASE_URL: carrier.url }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'mkt@a.test', [{ tenant: f.tenantA, role: 'marketing' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test', true);
  marketing = await login('mkt@a.test', false);
  sales = await login('vendas@a.test', false);
  adminB = await login('admin@b.test', true);

  // WhatsApp por QR code conectado (para o envio junto da ligação).
  const r = await admin.post('/api/v1/channels/whatsapp', { name: 'Comercial' });
  const instance = r.body.account.instance;
  wa = r.body.account.id;
  const token = /\/evolution\/([A-Za-z0-9_-]{43})$/.exec(evo.instances.get(instance)!.webhook)![1]!;
  await new Browser(app, '10.64.9.9').req('POST', `/api/v1/webhooks/evolution/${token}`,
    { event: 'connection.update', instance, data: { instance, state: 'open', wuid: '5511988887777@s.whatsapp.net', statusReason: 200 } }, { 'x-crm-request': 'x' });

  lead = (await admin.post('/api/v1/tags', { name: 'Lista de ligação' })).body.id;
  hot = (await admin.post('/api/v1/tags', { name: 'Quer saber mais' })).body.id;
  reached = (await admin.post('/api/v1/tags', { name: 'Atendeu a ligação' })).body.id;
  const contact = async (name: string, phone: string | null) => {
    const c = await admin.post('/api/v1/contacts', { allowDuplicate: true, firstName: name, phones: phone ? [{ number: phone }] : []});
    assert.equal(c.status, 201, JSON.stringify(c.body));
    await f.admin.query('insert into contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)', [f.tenantA, c.body.id, lead]);
    return c.body.id as string;
  };
  ana = await contact('Ana', '+55 11 3333-0001');
  bia = await contact('Bia', '+55 11 91111-0002');
  await contact('Caio', null);
});

after(async () => {
  await app?.close();
  await evo?.stop();
  await carrier?.stop();
  if (f) await dropDatabase(f);
});

describe('Avisos de cada operadora (formato único)', () => {
  test('Twilio/Telnyx, Plivo, Infobip, central SIP, Zenvia e API própria', () => {
    assert.deepEqual(parseEvent('twilio', 'status', { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '12' }), { ref: 'CA1', status: 'answered', final: true, seconds: 12 });
    assert.equal(parseEvent('twilio', 'status', { CallStatus: 'no-answer' }).status, 'no_answer');
    assert.equal(parseEvent('twilio', 'status', { CallStatus: 'completed', CallDuration: '9', AnsweredBy: 'machine_end_beep' }).status, 'machine');
    assert.equal(parseEvent('plivo', 'status', { RequestUUID: 'r1', CallStatus: 'timeout', Duration: '0' }).status, 'no_answer');
    assert.equal(parseEvent('plivo', 'status', { CallStatus: 'busy' }).status, 'busy');
    assert.deepEqual(parseEvent('twilio', 'tecla', { Digits: '3' }), { digits: '3' });
    const ib = parseEvent('infobip', 'infobip', { results: [{ messageId: 'm1', status: { groupName: 'DELIVERED' }, voiceCall: { duration: 18, dtmfCodes: '1' } }] });
    assert.deepEqual(ib, { ref: 'm1', status: 'answered', final: true, seconds: 18, digits: '1' });
    assert.equal(parseEvent('infobip', 'infobip', { results: [{ status: { groupName: 'UNDELIVERABLE' }, error: { name: 'EC_NO_ANSWER' } }] }).status, 'no_answer');
    assert.deepEqual(parseEvent('sip', 'sip', { evento: 'tecla', tecla: '2' }), { digits: '2' });
    assert.deepEqual(parseEvent('sip', 'sip', { evento: 'fim', status: 'ANSWER', duracao: '15' }), { status: 'answered', final: true, seconds: 15 });
    assert.equal(parseEvent('sip', 'sip', { evento: 'fim', status: 'NOANSWER', duracao: '0' }).status, 'no_answer');
    assert.equal(parseEvent('zenvia', 'zenvia', { dados: { id: 5, status: 'não atendida' } }).status, 'no_answer');
    assert.equal(parseEvent('zenvia', 'zenvia', { dados: { id: 5, status: 'caixa postal' } }).status, 'machine');
    assert.deepEqual(parseEvent('http', 'http', { status: 'busy', reference: 'x' }), { ref: 'x', status: 'busy', final: true, seconds: undefined, digits: undefined });
    assert.match(answerXml('plivo', 'https://a/x.mp3', true, 'https://a/t'), /<GetInput action="https:\/\/a\/t"[^>]*numDigits="1"[^>]*><Play>https:\/\/a\/x\.mp3<\/Play><\/GetInput>/);
    assert.match(answerXml('twilio', 'https://a/x.mp3?a=1&b=2', false, ''), /<Play>https:\/\/a\/x\.mp3\?a=1&amp;b=2<\/Play><Hangup\/>/);
  });
});

describe('Campanha de voz', () => {
  let twilio: string;
  let fileId: string;
  let campaign: string;

  test('operadora: só o administrador cadastra; o token fica cifrado e não volta', async () => {
    const body = { name: 'Twilio', provider: 'twilio', config: { accountSid: TWILIO_SID, from: '+55 11 4000-0000' }, secret: { authToken: TWILIO_TOKEN } };
    assert.equal((await sales.post('/api/v1/voice/providers', body)).status, 403);
    assert.equal((await marketing.post('/api/v1/voice/providers', body)).status, 403);
    const miss = await admin.post('/api/v1/voice/providers', { ...body, secret: {} });
    assert.equal(miss.status, 422);
    assert.ok(miss.body.errors.some((e: { field: string }) => e.field === 'secret.authToken'));
    const r = await admin.post('/api/v1/voice/providers', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    twilio = r.body.id;
    assert.equal(r.body.status, 'untested');
    assert.equal(r.body.secretHint, '1234');
    assert.ok(!JSON.stringify(r.body).includes(TWILIO_TOKEN));
    const row = await f.admin.query('select secret from voice_providers where id = $1', [twilio]);
    assert.ok(!row.rows[0].secret.toString('latin1').includes(TWILIO_TOKEN), 'o banco guarda cifrado');
    const list = await marketing.get('/api/v1/voice/providers');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((x: { name: string }) => x.name), ['Twilio'], 'quem faz campanha vê as operadoras para escolher');
    assert.equal((await adminB.get('/api/v1/voice/providers')).body.items.length, 0, 'outra empresa não vê');
    assert.equal((await adminB.post(`/api/v1/voice/providers/${twilio}/test`, {})).status, 404);
    // Editar sem mandar o token mantém o atual.
    const u = await admin.patch(`/api/v1/voice/providers/${twilio}`, { ...body, name: 'Twilio Brasil', secret: undefined });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.equal(u.body.secretHint, '1234');
  });

  test('áudio gravado na hora vira MP3 na biblioteca', async () => {
    const r = await marketing.upload('/api/v1/voice/audios', 'gravacao.ogg', audio, 'audio/ogg');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.contentType, 'audio/mpeg');
    assert.match(r.body.name, /\.mp3$/);
    fileId = r.body.id;
    assert.ok((await marketing.get('/api/v1/voice/audios')).body.items.some((x: { id: string }) => x.id === fileId));
    assert.equal((await marketing.upload('/api/v1/voice/audios', 'nota.txt', 'não é áudio', 'text/plain')).status, 422);
  });

  test('teste: confere as credenciais, liga de verdade e só fica "testada" quando atendem', async () => {
    const check = await admin.post(`/api/v1/voice/providers/${twilio}/test`, {});
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.equal(check.body.called, false);
    const call = await admin.post(`/api/v1/voice/providers/${twilio}/test`, { to: '(11) 98888-0000', audioFileId: fileId });
    assert.equal(call.status, 200, JSON.stringify(call.body));
    assert.equal(call.body.status, 'untested');
    const hit = carrier.calls().at(-1)!;
    assert.equal(hit.body.To, '+5511988880000');
    assert.equal(hit.body.From, '+551140000000');
    const answer = await notify(hit.body.Url as string, { CallSid: 'CA1', CallStatus: 'in-progress' });
    assert.equal(answer.status, 200);
    assert.match(answer.type, /xml/);
    const play = /<Play>([^<]+)<\/Play>/.exec(answer.text)![1]!.replace(/&amp;/g, '&');
    // A operadora busca o áudio no endereço assinado: MP3 e, para centrais, WAV 8 kHz.
    const mp3 = await app.inject({ method: 'GET', url: new URL(play).pathname });
    assert.equal(mp3.statusCode, 200);
    assert.equal(mp3.headers['content-type'], 'audio/mpeg');
    const wav = await app.inject({ method: 'GET', url: new URL(play).pathname.replace(/[A-Za-z0-9_-]{32}\.mp3$/, 'x'.repeat(32) + '.wav') });
    assert.equal(wav.statusCode, 404, 'assinatura de outro formato não vale');
    assert.equal((await notify(hit.body.StatusCallback as string, { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '8' })).status, 200);
    const p = (await admin.get('/api/v1/voice/providers')).body.items[0];
    assert.equal(p.status, 'ok');
    // Credencial errada: fica com erro e a mensagem da operadora.
    await admin.patch(`/api/v1/voice/providers/${twilio}`, { name: 'Twilio Brasil', provider: 'twilio', config: { accountSid: TWILIO_SID, from: '+55 11 4000-0000' }, secret: { authToken: 'errado-0000' } });
    const bad = await admin.post(`/api/v1/voice/providers/${twilio}/test`, {});
    assert.equal(bad.status, 422);
    assert.match(bad.body.title, /recusou as credenciais/);
    await admin.patch(`/api/v1/voice/providers/${twilio}`, { name: 'Twilio Brasil', provider: 'twilio', config: { accountSid: TWILIO_SID, from: '+55 11 4000-0000' }, secret: { authToken: TWILIO_TOKEN } });
  });

  test('público por telefone: vale fixo e celular; quem não tem telefone fica de fora', async () => {
    const r = await marketing.post('/api/v1/campaigns/preview', { channel: 'voice', audience: { tagIds: [lead] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.eligible, 2);
    assert.equal(r.body.noAddress, 1);
  });

  test('cria, confere o que falta e liga para o público', async () => {
    const base = { name: 'Torpedo Black Friday', channel: 'voice', audience: { tagIds: [lead] }, perMinute: 60 };
    const c = await marketing.post('/api/v1/campaigns', base);
    assert.equal(c.status, 201, JSON.stringify(c.body));
    campaign = c.body.id;
    const missing = await admin.post(`/api/v1/campaigns/${campaign}/start`, {});
    assert.equal(missing.status, 422);
    assert.deepEqual(missing.body.errors.map((e: { field: string }) => e.field).sort(), ['audioFileId', 'voiceProviderId']);
    const voice = {
      digits: true, ringSeconds: 25,
      keys: { 1: { label: 'Quero saber mais', tagId: hot, whatsapp: true, notifyOwner: true }, 9: { label: 'Não ligar mais', optOut: true } },
      whatsapp: { accountId: wa, text: 'Oi {{primeiro_nome}}, segue o link da oferta!', when: 'key' },
      sms: { text: 'Tentamos falar com você sobre a Black Friday.', when: 'not_answered' },
    };
    const u = await marketing.patch(`/api/v1/campaigns/${campaign}`, { ...base, voiceProviderId: twilio, audioFileId: fileId, voice, successTagId: reached });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.equal(u.body.voiceProvider.name, 'Twilio Brasil');
    assert.equal(u.body.audio.id, fileId);
    assert.equal(u.body.voice.keys['1'].label, 'Quero saber mais');
    assert.equal((await adminB.get(`/api/v1/campaigns/${campaign}`)).status, 404);
    const started = await admin.post(`/api/v1/campaigns/${campaign}/start`, {});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const before = carrier.calls().length;
    assert.equal(await drain(campaign), 'done');
    const calls = carrier.calls().slice(before);
    assert.deepEqual(calls.map((h) => h.body.To).sort(), ['+551133330001', '+5511911110002']);
    assert.equal(calls[0]!.body.Timeout, '25');
    const rs = await recipients(campaign);
    assert.ok(rs.every((r) => r.status === 'sent' && r.call_status === 'queued'));
  });

  test('atendeu e apertou 1: etiqueta, aviso ao responsável e WhatsApp; atendida marca a etiqueta de sucesso', async () => {
    const r = (await recipients(campaign)).find((x) => x.contact_id === ana)!;
    const hit = carrier.calls().find((h) => (h.body.Url as string).includes(r.id))!;
    const answer = await notify(hit.body.Url as string, { CallSid: 'CA9', CallStatus: 'in-progress' });
    assert.match(answer.text, /<Gather input="dtmf" numDigits="1"[^>]*action="[^"]+\/tecla"/);
    const sentBefore = evo.sent.length;
    const key = await notify((/action="([^"]+)"/.exec(answer.text)![1]!).replace(/&amp;/g, '&'), { Digits: '1' });
    assert.match(key.text, /<Hangup\/>/);
    // Aviso repetido não repete nada.
    await notify((/action="([^"]+)"/.exec(answer.text)![1]!).replace(/&amp;/g, '&'), { Digits: '1' });
    const wa = evo.sent.slice(sentBefore);
    assert.equal(wa.length, 1, 'um WhatsApp só');
    assert.match(JSON.stringify(wa[0]!.body), /Oi Ana, segue o link da oferta!/);
    const tags = await f.admin.query('select tag_id from contact_tags where contact_id = $1', [ana]);
    assert.ok(tags.rows.some((t) => t.tag_id === hot), 'etiqueta da tecla');
    const n = await f.admin.query(`select title, body from notifications where kind = 'campaign.voice_key'`);
    assert.equal(n.rowCount, 1);
    assert.match(n.rows[0].title, /Ana apertou 1/);
    await notify(hit.body.StatusCallback as string, { CallSid: 'CA9', CallStatus: 'completed', CallDuration: '21' });
    const after = (await recipients(campaign)).find((x) => x.contact_id === ana)!;
    assert.equal(after.call_status, 'answered');
    assert.equal(after.call_digits, '1');
    assert.equal(after.call_seconds, 21);
    assert.equal(after.call_extras.whatsapp, 'sent');
    assert.equal(after.call_extras.sms, undefined, 'atendeu: o SMS de "não atendeu" não sai');
    assert.ok((await f.admin.query('select 1 from contact_tags where contact_id = $1 and tag_id = $2', [ana, reached])).rowCount, 'etiqueta de sucesso');
  });

  test('não atendeu: sai o SMS pela operadora; o relatório mostra o resultado de cada ligação', async () => {
    const r = (await recipients(campaign)).find((x) => x.contact_id === bia)!;
    const hit = carrier.calls().find((h) => (h.body.Url as string).includes(r.id))!;
    await notify(hit.body.StatusCallback as string, { CallSid: 'CA10', CallStatus: 'no-answer', CallDuration: '0' });
    const sms = carrier.hits.filter((h) => h.path.endsWith('/Messages.json')).at(-1)!;
    assert.equal(sms.body.To, '+5511911110002');
    assert.equal(sms.body.Body, 'Tentamos falar com você sobre a Black Friday.');
    const after = (await recipients(campaign)).find((x) => x.contact_id === bia)!;
    assert.equal(after.call_status, 'no_answer');
    assert.equal(after.call_extras.sms, 'sent');
    assert.ok(!(await f.admin.query('select 1 from contact_tags where contact_id = $1 and tag_id = $2', [bia, reached])).rowCount);
    const k = (await marketing.get(`/api/v1/campaigns/${campaign}`)).body;
    assert.equal(k.stats.answered, 1);
    assert.equal(k.stats.pressed, 1);
    assert.equal(k.stats.noAnswer, 1);
    const list = (await marketing.get(`/api/v1/campaigns/${campaign}/recipients`)).body.items;
    assert.deepEqual(list.map((x: { name: string; callStatus: string; callDigits: string | null }) => [x.name, x.callStatus, x.callDigits]).sort(),
      [['Ana', 'answered', '1'], ['Bia', 'no_answer', null]]);
  });

  test('endereço de aviso adulterado ou de outra operadora: 404', async () => {
    const r = (await recipients(campaign))[0]!;
    const good = carrier.calls().find((h) => (h.body.Url as string).includes(r.id))!.body.Url as string;
    assert.equal((await notify(good.replace(/\.([A-Za-z0-9_-]{32})\//, '.' + 'A'.repeat(32) + '/'), {})).status, 404);
    assert.equal((await notify(good.replace(/\/atender$/, '/qualquer'), {})).status, 404);
    assert.equal((await notify(good.replace(r.id, '00000000-0000-4000-8000-000000000000'), {})).status, 404);
  });

  test('não dá para excluir a operadora com campanha em andamento', async () => {
    await f.admin.query(`update campaigns set status = 'paused' where id = $1`, [campaign]);
    assert.equal((await admin.del(`/api/v1/voice/providers/${twilio}`)).status, 409);
    await f.admin.query(`update campaigns set status = 'done' where id = $1`, [campaign]);
  });
});

describe('Zenvia, central SIP e API própria', () => {
  test('Zenvia: liga com o número nacional e o resultado é consultado pelo despachante', async () => {
    const z = await admin.post('/api/v1/voice/providers', { name: 'Zenvia', provider: 'zenvia', config: { from: '+55 11 4000-1111' }, secret: { accessToken: ZENVIA_TOKEN } });
    assert.equal(z.status, 201, JSON.stringify(z.body));
    assert.equal((await admin.post(`/api/v1/voice/providers/${z.body.id}/test`, {})).status, 200);
    const fileId = (await f.admin.query<{ id: string }>(`select id from files where content_type = 'audio/mpeg' limit 1`)).rows[0]!.id;
    const c = await marketing.post('/api/v1/campaigns', {
      name: 'Zenvia', channel: 'voice', audience: { contactIds: [ana] }, perMinute: 60, voiceProviderId: z.body.id, audioFileId: fileId,
      voice: { digits: true, keys: { 2: { label: 'Falar com vendedor', notifyOwner: true } } },
    });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal((await admin.post(`/api/v1/campaigns/${c.body.id}/start`, {})).status, 200);
    assert.equal(await drain(c.body.id), 'done');
    const hit = carrier.hits.filter((h) => h.path === '/audio').at(-1)!;
    assert.equal(hit.body.numero_destino, '1133330001');
    assert.equal(hit.body.bina, '1140001111');
    assert.equal(hit.body.resposta_usuario, true);
    assert.match(String(hit.body.url_audio), /\/api\/v1\/public\/voz\/audio\/.+\.mp3$/);
    await f.admin.query(`update campaign_recipients set sent_at = now() - interval '3 minutes' where campaign_id = $1`, [c.body.id]);
    await run();
    const r = (await recipients(c.body.id))[0]!;
    assert.equal(r.call_status, 'answered');
    assert.equal(r.call_digits, '2');
    assert.equal(r.call_seconds, 14);
  });

  test('central própria (Asterisk): confere a ARI e avisa por GET com a tecla e o fim', async () => {
    const s = await admin.post('/api/v1/voice/providers', {
      name: 'Minha central', provider: 'sip', config: { ariUrl: 'https://pbx.empresa.test:8089', ariUser: 'crm', endpoint: 'PJSIP/{nacional}@operadora', callerId: '1140002222' },
      secret: { ariPassword: 'senha-ari' },
    });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.match(s.body.callbackUrl, /\/api\/v1\/public\/voz\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}\/\{destinatario\}$/);
    assert.equal((await admin.post(`/api/v1/voice/providers/${s.body.id}/test`, {})).status, 200);
    const info = carrier.hits.filter((h) => h.path === '/ari/asterisk/info').at(-1)!;
    assert.equal(info.headers.authorization, `Basic ${Buffer.from('crm:senha-ari').toString('base64')}`);
    const fileId = (await f.admin.query<{ id: string }>(`select id from files where content_type = 'audio/mpeg' limit 1`)).rows[0]!.id;
    const t = await admin.post(`/api/v1/voice/providers/${s.body.id}/test`, { to: '11 3333-0009', audioFileId: fileId });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    const ch = carrier.hits.filter((h) => h.path.startsWith('/ari/channels')).at(-1)!;
    const q = new URL(`http://x${ch.path}`).searchParams;
    assert.equal(q.get('endpoint'), 'PJSIP/1133330009@operadora');
    assert.equal(q.get('context'), 'crm-voz');
    const vars = (ch.body as { variables: Record<string, string> }).variables;
    assert.match(vars.CRM_AUDIO!, /\.wav$/);
    const wav = await app.inject({ method: 'GET', url: new URL(vars.CRM_AUDIO!).pathname });
    assert.equal(wav.statusCode, 200);
    assert.equal(wav.rawPayload.subarray(0, 4).toString(), 'RIFF');
    assert.equal((await notify(vars.CRM_CB!, { evento: 'fim', status: 'ANSWER', duracao: '6' }, 'GET')).status, 200);
    assert.equal((await admin.get('/api/v1/voice/providers')).body.items.find((x: { id: string }) => x.id === s.body.id).status, 'ok');
  });

  test('API própria: manda o pedido com o endereço de retorno', async () => {
    const h = await admin.post('/api/v1/voice/providers', { name: 'Outra operadora', provider: 'http', config: { callUrl: 'https://api.operadora.test/ligar' }, secret: { authorization: 'Bearer abc' } });
    assert.equal(h.status, 201, JSON.stringify(h.body));
    const fileId = (await f.admin.query<{ id: string }>(`select id from files where content_type = 'audio/mpeg' limit 1`)).rows[0]!.id;
    assert.equal((await admin.post(`/api/v1/voice/providers/${h.body.id}/test`, { to: '11 98888-0001', audioFileId: fileId })).status, 200);
    const hit = carrier.hits.filter((x) => x.path === '/ligar').at(-1)!;
    assert.equal(hit.headers.authorization, 'Bearer abc');
    assert.equal(hit.body.to, '+5511988880001');
    assert.match(String(hit.body.callbackUrl), /\/http$/);
  });
});
