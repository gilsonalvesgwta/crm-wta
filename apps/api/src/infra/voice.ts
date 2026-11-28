// Operadoras de voz: cada uma liga, toca o áudio e avisa o resultado de um
// jeito. Aqui fica a tradução para um formato só (ligar, SMS, resposta da
// chamada e leitura dos avisos). Nada aqui guarda estado.
import { resolvePublicHost } from '../domain/net-guard.js';

export type VoiceProviderKind = 'twilio' | 'plivo' | 'telnyx' | 'zenvia' | 'infobip' | 'sip' | 'http';
export type CallStatus = 'queued' | 'answered' | 'no_answer' | 'busy' | 'failed' | 'machine' | 'canceled';

/** Conta da operadora: dados sem segredo e os segredos já abertos. */
export type VoiceAccount = { provider: VoiceProviderKind; config: Record<string, string>; secret: Record<string, string> };

export type CallRequest = {
  /** E.164 (+5511999998888). */
  to: string;
  /** MP3 público do áudio. */
  audioUrl: string;
  /** WAV 8 kHz público (centrais SIP/Asterisk). */
  audioWavUrl: string;
  /** Base dos avisos desta ligação: <APP_URL>/api/v1/public/voz/<conta>/<destinatário>. */
  callbackBase: string;
  /** Espera uma tecla depois do áudio. */
  digits: boolean;
  ringSeconds: number;
  machineDetection: boolean;
  /** Identificador nosso da ligação (destinatário). */
  reference: string;
};

/** O que um aviso da operadora diz sobre a ligação (campos ausentes: não mudou). */
export type CallEvent = { ref?: string; status?: CallStatus; final?: boolean; digits?: string; seconds?: number };

export class VoiceError extends Error {}

export type VoiceOptions = {
  /** Só nos testes: troca o endereço de todas as operadoras. */
  baseOverride?: string;
  /** Permite endereços internos (central na mesma rede). */
  allowPrivate: boolean;
  timeoutMs?: number;
};

/** Campos de cada operadora: o que é dado comum e o que é segredo (para a tela e a validação). */
export const PROVIDER_FIELDS: Record<VoiceProviderKind, { config: string[]; required: string[]; secret: string[]; sms: boolean }> = {
  twilio: { config: ['accountSid', 'from'], required: ['accountSid', 'from'], secret: ['authToken'], sms: true },
  plivo: { config: ['authId', 'from'], required: ['authId', 'from'], secret: ['authToken'], sms: true },
  telnyx: { config: ['applicationId', 'from', 'messagingProfileId'], required: ['applicationId', 'from'], secret: ['apiKey'], sms: true },
  zenvia: { config: ['from', 'apiBase'], required: [], secret: ['accessToken'], sms: true },
  infobip: { config: ['baseUrl', 'from'], required: ['baseUrl', 'from'], secret: ['apiKey'], sms: true },
  sip: { config: ['ariUrl', 'ariUser', 'endpoint', 'context', 'callerId'], required: ['ariUrl', 'ariUser', 'endpoint'], secret: ['ariPassword'], sms: false },
  http: { config: ['callUrl', 'smsUrl', 'from'], required: ['callUrl'], secret: ['authorization'], sms: true },
};

export const ZENVIA_DEFAULT_BASE = 'https://api2.totalvoice.com.br';

// ---- Números -------------------------------------------------------------------------------

const digitsOf = (e164: string) => e164.replace(/\D/g, '');
/** Número nacional (DDD + número) quando é do Brasil; senão, os dígitos. */
export function nationalOf(e164: string): string {
  const d = digitsOf(e164);
  return d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
}
const plusOf = (n: string) => `+${digitsOf(n)}`;

// ---- HTTP ----------------------------------------------------------------------------------

function target(url: string, o: VoiceOptions): string {
  if (!o.baseOverride) return url;
  const u = new URL(url);
  const b = new URL(o.baseOverride);
  u.protocol = b.protocol;
  u.host = b.host;
  return u.toString();
}

/** Endereço informado pela empresa (central, API própria): só público, salvo se liberado. */
async function guard(url: string, o: VoiceOptions): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new VoiceError('Endereço inválido.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new VoiceError('Use um endereço http(s).');
  if (o.baseOverride) return;
  try {
    await resolvePublicHost(u.hostname, o.allowPrivate);
  } catch {
    throw new VoiceError('Endereço interno ou inexistente.');
  }
}

type Req = { method?: string; headers?: Record<string, string>; json?: unknown; form?: Record<string, string>; basic?: [string, string] };

async function call(url: string, r: Req, o: VoiceOptions): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = { accept: 'application/json', ...(r.headers ?? {}) };
  let body: string | undefined;
  if (r.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(r.json);
  } else if (r.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(r.form).toString();
  }
  if (r.basic) headers.authorization = `Basic ${Buffer.from(`${r.basic[0]}:${r.basic[1]}`).toString('base64')}`;
  let res: Response;
  try {
    res = await fetch(target(url, o), { method: r.method ?? 'POST', headers, body, signal: AbortSignal.timeout(o.timeoutMs ?? 15_000), redirect: 'error' });
  } catch (e) {
    throw new VoiceError(e instanceof Error && e.name === 'TimeoutError' ? 'A operadora demorou demais para responder.' : 'Não foi possível falar com a operadora.');
  }
  const text = (await res.text()).slice(0, 20_000);
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

/** Mensagem de erro curta da resposta da operadora. */
function failure(provider: string, r: { status: number; body: unknown; text: string }): VoiceError {
  const b = obj(r.body);
  const msg = str(b.message) ?? str(b.error_message) ?? str(obj(b.error).message) ?? str(b.error) ?? str(b.mensagem)
    ?? str(obj(obj(b.requestError).serviceException).text) ?? str(obj(b.errors?.[0]).detail) ?? str(obj(b.errors?.[0]).title);
  if (r.status === 401 || r.status === 403) return new VoiceError(`${provider} recusou as credenciais${msg ? `: ${msg}` : ''}.`);
  return new VoiceError(`${provider} recusou a ligação (${r.status})${msg ? `: ${msg.slice(0, 200)}` : ''}.`);
}

const need = (acc: VoiceAccount, ...keys: string[]) => {
  for (const k of keys) if (!acc.config[k] && !acc.secret[k]) throw new VoiceError(`Falta preencher "${k}" na operadora.`);
};

// ---- Ligar ---------------------------------------------------------------------------------

/** Faz a ligação e devolve o identificador da operadora. */
export async function placeCall(acc: VoiceAccount, q: CallRequest, o: VoiceOptions): Promise<{ ref: string | null }> {
  const cb = q.callbackBase;
  const c = acc.config;
  const s = acc.secret;
  switch (acc.provider) {
    case 'twilio': {
      need(acc, 'accountSid', 'from', 'authToken');
      const form: Record<string, string> = {
        To: q.to, From: plusOf(c.from!), Url: `${cb}/atender`, Method: 'POST',
        StatusCallback: `${cb}/status`, StatusCallbackMethod: 'POST', Timeout: String(q.ringSeconds),
      };
      if (q.machineDetection) form.MachineDetection = 'Enable';
      const r = await call(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid!)}/Calls.json`, { form, basic: [c.accountSid!, s.authToken!] }, o);
      if (r.status >= 300) throw failure('A Twilio', r);
      return { ref: str(obj(r.body).sid) ?? null };
    }
    case 'telnyx': {
      // TeXML: mesma linguagem de resposta da Twilio.
      need(acc, 'applicationId', 'from', 'apiKey');
      const json: Record<string, unknown> = {
        To: q.to, From: plusOf(c.from!), Url: `${cb}/atender`, UrlMethod: 'POST',
        StatusCallback: `${cb}/status`, StatusCallbackMethod: 'POST', Timeout: q.ringSeconds,
      };
      if (q.machineDetection) json.MachineDetection = 'Enable';
      const r = await call(`https://api.telnyx.com/v2/texml/calls/${encodeURIComponent(c.applicationId!)}`, { json, headers: { authorization: `Bearer ${s.apiKey}` } }, o);
      if (r.status >= 300) throw failure('A Telnyx', r);
      const b = obj(r.body);
      return { ref: str(b.call_sid) ?? str(b.sid) ?? str(obj(b.data).call_sid) ?? str(obj(b.data).id) ?? null };
    }
    case 'plivo': {
      need(acc, 'authId', 'from', 'authToken');
      const json: Record<string, unknown> = {
        from: digitsOf(c.from!), to: digitsOf(q.to), answer_url: `${cb}/atender`, answer_method: 'POST',
        hangup_url: `${cb}/status`, hangup_method: 'POST', ring_timeout: q.ringSeconds,
      };
      if (q.machineDetection) json.machine_detection = 'true';
      const r = await call(`https://api.plivo.com/v1/Account/${encodeURIComponent(c.authId!)}/Call/`, { json, basic: [c.authId!, s.authToken!] }, o);
      if (r.status >= 300) throw failure('A Plivo', r);
      const b = obj(r.body);
      return { ref: str(b.request_uuid) ?? str(Array.isArray(b.request_uuid) ? b.request_uuid[0] : undefined) ?? null };
    }
    case 'zenvia': {
      // Zenvia Voz (antiga TotalVoice): toca o áudio e guarda a tecla; o resultado é consultado depois.
      need(acc, 'accessToken');
      const json: Record<string, unknown> = { numero_destino: nationalOf(q.to), url_audio: q.audioUrl, resposta_usuario: q.digits, gravar_audio: false };
      if (c.from) json.bina = nationalOf(c.from);
      if (q.machineDetection) json.detecta_caixa = true;
      const r = await call(`${(c.apiBase || ZENVIA_DEFAULT_BASE).replace(/\/+$/, '')}/audio`, { json, headers: { 'access-token': s.accessToken! } }, o);
      const b = obj(r.body);
      if (r.status >= 300 || b.sucesso === false) throw failure('A Zenvia', r);
      return { ref: str(obj(b.dados).id) ?? null };
    }
    case 'infobip': {
      need(acc, 'baseUrl', 'from', 'apiKey');
      const base = /^https?:\/\//.test(c.baseUrl!) ? c.baseUrl! : `https://${c.baseUrl}`;
      await guard(base, o);
      const msg: Record<string, unknown> = {
        from: digitsOf(c.from!), destinations: [{ to: digitsOf(q.to), messageId: q.reference }], audioFileUrl: q.audioUrl,
        notifyUrl: `${cb}/infobip`, notifyContentType: 'application/json', callbackData: q.reference, callTimeout: q.ringSeconds,
      };
      if (q.digits) msg.dtmfTimeout = 6;
      if (q.machineDetection) msg.machineDetection = 'hangup';
      const r = await call(`${base.replace(/\/+$/, '')}/tts/3/advanced`, { json: { messages: [msg] }, headers: { authorization: `App ${s.apiKey}` } }, o);
      if (r.status >= 300) throw failure('A Infobip', r);
      return { ref: str(obj(obj(r.body).messages?.[0]).messageId) ?? q.reference };
    }
    case 'sip': {
      // Central própria (Asterisk) pela ARI: liga e entra no roteiro "crm-voz", que toca o áudio e avisa o CRM.
      need(acc, 'ariUrl', 'ariUser', 'endpoint', 'ariPassword');
      await guard(c.ariUrl!, o);
      const endpoint = c.endpoint!.replace('{e164}', q.to).replace('{numero}', digitsOf(q.to)).replace('{nacional}', nationalOf(q.to));
      const params = new URLSearchParams({ endpoint, extension: 's', context: c.context || 'crm-voz', priority: '1', timeout: String(q.ringSeconds) });
      if (c.callerId) params.set('callerId', c.callerId);
      const r = await call(`${c.ariUrl!.replace(/\/+$/, '')}/ari/channels?${params.toString()}`, {
        json: { variables: { CRM_AUDIO: q.audioWavUrl, CRM_CB: `${cb}/sip`, CRM_DIGITS: q.digits ? '1' : '0' } }, basic: [c.ariUser!, s.ariPassword!],
      }, o);
      if (r.status >= 300) throw failure('A central', r);
      return { ref: str(obj(r.body).id) ?? null };
    }
    case 'http': {
      need(acc, 'callUrl');
      await guard(c.callUrl!, o);
      const r = await call(c.callUrl!, {
        json: { to: q.to, from: c.from || null, audioUrl: q.audioUrl, audioWavUrl: q.audioWavUrl, digits: q.digits, ringSeconds: q.ringSeconds,
          reference: q.reference, callbackUrl: `${cb}/http` },
        headers: s.authorization ? { authorization: s.authorization } : {},
      }, o);
      if (r.status >= 300) throw failure('A operadora', r);
      const b = obj(r.body);
      return { ref: str(b.id) ?? str(b.callId) ?? str(b.reference) ?? q.reference };
    }
  }
}

/** SMS pela mesma operadora. */
export async function sendSms(acc: VoiceAccount, to: string, text: string, o: VoiceOptions): Promise<void> {
  const c = acc.config;
  const s = acc.secret;
  let r: { status: number; body: unknown; text: string };
  switch (acc.provider) {
    case 'twilio':
      r = await call(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid!)}/Messages.json`,
        { form: { To: to, From: plusOf(c.from!), Body: text }, basic: [c.accountSid!, s.authToken!] }, o);
      break;
    case 'plivo':
      r = await call(`https://api.plivo.com/v1/Account/${encodeURIComponent(c.authId!)}/Message/`,
        { json: { src: digitsOf(c.from!), dst: digitsOf(to), text }, basic: [c.authId!, s.authToken!] }, o);
      break;
    case 'telnyx':
      r = await call('https://api.telnyx.com/v2/messages', {
        json: { from: plusOf(c.from!), to, text, ...(c.messagingProfileId ? { messaging_profile_id: c.messagingProfileId } : {}) },
        headers: { authorization: `Bearer ${s.apiKey}` },
      }, o);
      break;
    case 'zenvia':
      r = await call(`${(c.apiBase || ZENVIA_DEFAULT_BASE).replace(/\/+$/, '')}/sms`, { json: { numero_destino: nationalOf(to), mensagem: text }, headers: { 'access-token': s.accessToken! } }, o);
      if (obj(r.body).sucesso === false) r = { ...r, status: 400 };
      break;
    case 'infobip': {
      const base = /^https?:\/\//.test(c.baseUrl!) ? c.baseUrl! : `https://${c.baseUrl}`;
      await guard(base, o);
      r = await call(`${base.replace(/\/+$/, '')}/sms/2/text/advanced`,
        { json: { messages: [{ from: c.from, destinations: [{ to: digitsOf(to) }], text }] }, headers: { authorization: `App ${s.apiKey}` } }, o);
      break;
    }
    case 'http':
      if (!c.smsUrl) throw new VoiceError('Esta operadora não tem endereço de SMS configurado.');
      await guard(c.smsUrl, o);
      r = await call(c.smsUrl, { json: { to, from: c.from || null, text }, headers: s.authorization ? { authorization: s.authorization } : {} }, o);
      break;
    case 'sip':
      throw new VoiceError('A central SIP não manda SMS. Escolha outra operadora para o SMS.');
  }
  if (r.status >= 300) throw failure('A operadora', r);
}

// ---- Durante a ligação ------------------------------------------------------------------------

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Resposta quando a pessoa atende (Twilio, Telnyx TeXML ou Plivo): toca o áudio e, se pedido, espera uma tecla. */
export function answerXml(provider: VoiceProviderKind, audioUrl: string, digits: boolean, keyUrl: string): string {
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const play = `<Play>${xml(audioUrl)}</Play>`;
  if (!digits) return `${head}<Response>${play}<Hangup/></Response>`;
  if (provider === 'plivo') {
    return `${head}<Response><GetInput action="${xml(keyUrl)}" method="POST" inputType="dtmf" numDigits="1" digitEndTimeout="6" redirect="true">${play}</GetInput><Hangup/></Response>`;
  }
  return `${head}<Response><Gather input="dtmf" numDigits="1" timeout="6" action="${xml(keyUrl)}" method="POST">${play}</Gather><Hangup/></Response>`;
}

export const HANGUP_XML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

// ---- Avisos da operadora ----------------------------------------------------------------------

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};
const dtmf = (v: unknown) => {
  const s = str(v)?.replace(/[^0-9*#]/g, '').slice(0, 20);
  return s || undefined;
};

/**
 * Lê o aviso de cada operadora. `kind` é o fim do endereço: atender, tecla,
 * status (Twilio, Telnyx, Plivo), infobip, sip, http ou zenvia.
 */
export function parseEvent(provider: VoiceProviderKind, kind: string, raw: unknown): CallEvent {
  const b = obj(raw);
  if (kind === 'tecla') return { digits: dtmf(b.Digits ?? b.digits) };
  if (kind === 'atender') {
    const machine = /^machine/.test(str(b.AnsweredBy) ?? '') || str(b.Machine) === 'true';
    return { ref: str(b.CallSid) ?? str(b.RequestUUID), status: machine ? 'machine' : 'answered' };
  }
  if (kind === 'status') {
    // Twilio/Telnyx: CallStatus; Plivo: CallStatus/HangupCause e Duration.
    const st = (str(b.CallStatus) ?? '').toLowerCase().replace(/_/g, '-');
    const seconds = num(b.CallDuration ?? b.Duration ?? b.BillDuration);
    const machine = /^machine/.test(str(b.AnsweredBy) ?? '') || str(b.Machine) === 'true';
    let status: CallStatus | undefined;
    if (st === 'completed') status = machine ? 'machine' : (seconds ?? 1) > 0 ? 'answered' : 'no_answer';
    else if (st === 'no-answer' || st === 'timeout') status = 'no_answer';
    else if (st === 'busy') status = 'busy';
    else if (st === 'failed') status = 'failed';
    else if (st === 'canceled' || st === 'cancel') status = 'canceled';
    const final = !!status;
    return { ref: str(b.CallSid) ?? str(b.RequestUUID), status, final, seconds };
  }
  if (kind === 'infobip') {
    const x = obj(Array.isArray(b.results) ? b.results[0] : b);
    const vc = obj(x.voiceCall);
    const group = (str(obj(x.status).groupName) ?? '').toUpperCase();
    const err = (str(obj(x.error).name) ?? '').toUpperCase();
    const seconds = num(vc.duration);
    let status: CallStatus = 'failed';
    if (/MACHINE/.test(err) || str(vc.machineDetection) === 'MACHINE') status = 'machine';
    else if (group === 'DELIVERED' && (seconds ?? 1) > 0) status = 'answered';
    else if (/NO_ANSWER|NOT_ANSWERED|TIMEOUT/.test(err)) status = 'no_answer';
    else if (/BUSY/.test(err)) status = 'busy';
    return { ref: str(x.messageId) ?? str(x.callbackData), status, final: true, seconds, digits: dtmf(vc.dtmfCodes ?? x.dtmfCodes) };
  }
  if (kind === 'sip') {
    // Roteiro do Asterisk: ?evento=tecla&tecla=1 ou ?evento=fim&status=ANSWER&duracao=12.
    if (str(b.evento) === 'tecla') return { digits: dtmf(b.tecla) };
    const st = (str(b.status) ?? '').toUpperCase();
    const seconds = num(b.duracao);
    const status: CallStatus = st === 'ANSWER' || ((seconds ?? 0) > 0 && !st) ? 'answered' : st === 'BUSY' ? 'busy' : st === 'NOANSWER' || st === 'CANCEL' ? 'no_answer'
      : st === 'MACHINE' ? 'machine' : 'failed';
    return { status, final: true, seconds };
  }
  if (kind === 'zenvia') {
    // Consulta GET /audio/{id} ou aviso configurado no painel: { dados: { status, duracao_segundos, resposta } }.
    const d = obj(b.dados ?? b);
    const st = (str(d.status) ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const seconds = num(d.duracao_segundos ?? d.duracao_falada_segundos);
    let status: CallStatus | undefined;
    if (/caixa|secretaria/.test(st)) status = 'machine';
    else if (/nao atendida|sem resposta|nao atend/.test(st)) status = 'no_answer';
    else if (/atendida|finalizada|concluida/.test(st)) status = (seconds ?? 1) > 0 ? 'answered' : 'no_answer';
    else if (/ocupad/.test(st)) status = 'busy';
    else if (/falha|erro|invalid|sem saldo|cancel/.test(st)) status = 'failed';
    return { ref: str(d.id), status, final: !!status, seconds, digits: dtmf(d.resposta ?? d.resposta_usuario) };
  }
  // API própria (http): { status, digits, duration }.
  const st = str(b.status) as CallStatus | undefined;
  const ok: CallStatus[] = ['answered', 'no_answer', 'busy', 'failed', 'machine', 'canceled'];
  return { ref: str(b.reference) ?? str(b.id), status: st && ok.includes(st) ? st : undefined, final: !!(st && ok.includes(st)), seconds: num(b.duration ?? b.seconds), digits: dtmf(b.digits) };
}

/** Zenvia: pergunta o resultado de uma ligação. */
export async function pollCall(acc: VoiceAccount, ref: string, o: VoiceOptions): Promise<CallEvent | null> {
  if (acc.provider !== 'zenvia') return null;
  const r = await call(`${(acc.config.apiBase || ZENVIA_DEFAULT_BASE).replace(/\/+$/, '')}/audio/${encodeURIComponent(ref)}`,
    { method: 'GET', headers: { 'access-token': acc.secret.accessToken! } }, o);
  if (r.status >= 300) return null;
  return parseEvent('zenvia', 'zenvia', r.body);
}

/** Confere as credenciais sem ligar (quando a operadora permite). */
export async function checkAccount(acc: VoiceAccount, o: VoiceOptions): Promise<void> {
  const c = acc.config;
  const s = acc.secret;
  let r: { status: number; body: unknown; text: string } | null = null;
  switch (acc.provider) {
    case 'twilio':
      r = await call(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid!)}.json`, { method: 'GET', basic: [c.accountSid!, s.authToken!] }, o);
      break;
    case 'plivo':
      r = await call(`https://api.plivo.com/v1/Account/${encodeURIComponent(c.authId!)}/`, { method: 'GET', basic: [c.authId!, s.authToken!] }, o);
      break;
    case 'telnyx':
      r = await call('https://api.telnyx.com/v2/balance', { method: 'GET', headers: { authorization: `Bearer ${s.apiKey}` } }, o);
      break;
    case 'zenvia':
      r = await call(`${(c.apiBase || ZENVIA_DEFAULT_BASE).replace(/\/+$/, '')}/saldo`, { method: 'GET', headers: { 'access-token': s.accessToken! } }, o);
      if (obj(r.body).sucesso === false) r = { ...r, status: 401 };
      break;
    case 'infobip': {
      const base = /^https?:\/\//.test(c.baseUrl!) ? c.baseUrl! : `https://${c.baseUrl}`;
      await guard(base, o);
      r = await call(`${base.replace(/\/+$/, '')}/account/1/balance`, { method: 'GET', headers: { authorization: `App ${s.apiKey}` } }, o);
      break;
    }
    case 'sip':
      await guard(c.ariUrl!, o);
      r = await call(`${c.ariUrl!.replace(/\/+$/, '')}/ari/asterisk/info`, { method: 'GET', basic: [c.ariUser!, s.ariPassword!] }, o);
      break;
    case 'http':
      await guard(c.callUrl!, o);
      return;
  }
  if (r && r.status >= 300) throw failure(acc.provider === 'sip' ? 'A central' : 'A operadora', r);
}
