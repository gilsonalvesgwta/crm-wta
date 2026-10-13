// Leitura dos avisos (webhooks) da Evolution API v2 e regras de número.
// Campos conferidos na documentação da Evolution v2 (eventos MESSAGES_UPSERT,
// MESSAGES_UPDATE, SEND_MESSAGE, CONNECTION_UPDATE). A confirmação com um
// servidor real fica registrada em docs/INTEGRATIONS.md.

export type MessageKind = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contact' | 'other';

export type EvoMessage = {
  type: 'message';
  id: string;
  fromMe: boolean;
  e164: string;
  pushName: string | null;
  kind: MessageKind;
  text: string | null;
  at: Date;
  media: { base64: string; mimetype: string | null; fileName: string | null } | null;
};
export type EvoStatus = { type: 'status'; id: string; status: 'sent' | 'delivered' | 'read' | 'failed' };
export type EvoConnection = { type: 'connection'; state: 'open' | 'close' | 'connecting'; e164: string | null };
export type EvoIgnored = { type: 'ignored'; reason: string };
export type EvoEvent = EvoMessage | EvoStatus | EvoConnection | EvoIgnored;

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** "messages.upsert", "MESSAGES_UPSERT" → "messages.upsert". */
export function eventName(v: unknown): string {
  return (str(v) ?? '').toLowerCase().replace(/_/g, '.');
}

/** JID de pessoa ("5511999998888@s.whatsapp.net") em E.164. Grupos, listas e canais: null. */
export function jidToE164(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m ? `+${m[1]}` : null;
}

/**
 * Variações do mesmo número no Brasil: o WhatsApp ainda usa, para muitos
 * celulares, o número sem o nono dígito. Devolve o número e a outra forma.
 */
export function phoneVariants(e164: string): string[] {
  const out = [e164];
  const m = /^\+55(\d{2})(\d+)$/.exec(e164);
  if (m) {
    const [, ddd, rest] = m as unknown as [string, string, string];
    if (rest.length === 8 && /^[6-9]/.test(rest)) out.push(`+55${ddd}9${rest}`);
    if (rest.length === 9 && rest.startsWith('9') && /^[6-9]/.test(rest.slice(1))) out.push(`+55${ddd}${rest.slice(1)}`);
  }
  return out;
}

/** Número para a Evolution: só dígitos, com o código do país. */
export function toEvolutionNumber(e164: string): string {
  return e164.replace(/\D/g, '');
}

const KIND_BY_TYPE: Record<string, MessageKind> = {
  conversation: 'text', extendedTextMessage: 'text', imageMessage: 'image', audioMessage: 'audio', pttMessage: 'audio',
  videoMessage: 'video', ptvMessage: 'video', documentMessage: 'document', documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker', locationMessage: 'location', liveLocationMessage: 'location', contactMessage: 'contact',
  contactsArrayMessage: 'contact',
};
// Não viram mensagem no histórico: reações, edições, apagamentos, enquetes internas.
const SKIP_TYPES = new Set(['reactionMessage', 'protocolMessage', 'editedMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'messageContextInfo']);

function readMessage(d: Record<string, unknown>): EvoMessage | EvoIgnored {
  const key = obj(d.key);
  const id = str(key?.id);
  if (!key || !id) return { type: 'ignored', reason: 'sem identificador' };
  const jids = [str(key.remoteJid), str(key.remoteJidAlt), str(key.senderPn), str(d.senderPn)];
  const remote = str(key.remoteJid) ?? '';
  if (/@(g\.us|broadcast|newsletter)$/.test(remote)) return { type: 'ignored', reason: 'grupo, status ou canal' };
  const e164 = jids.map(jidToE164).find((v) => v) ?? null;
  if (!e164) return { type: 'ignored', reason: 'número não identificado' };
  const message = obj(d.message) ?? {};
  const msgType = str(d.messageType) ?? Object.keys(message).find((k) => k !== 'messageContextInfo' && k !== 'base64') ?? '';
  if (SKIP_TYPES.has(msgType)) return { type: 'ignored', reason: msgType };
  const kind = KIND_BY_TYPE[msgType] ?? 'other';
  const inner = obj(message[msgType]) ?? {};
  const docInner = msgType === 'documentWithCaptionMessage' ? obj(obj(inner.message)?.documentMessage) ?? {} : inner;
  let text: string | null = null;
  if (msgType === 'conversation') text = str(message.conversation);
  else if (msgType === 'extendedTextMessage') text = str(inner.text);
  else if (kind === 'location') {
    const lat = inner.degreesLatitude, lng = inner.degreesLongitude;
    text = typeof lat === 'number' && typeof lng === 'number' ? `Localização: https://maps.google.com/?q=${lat},${lng}` : 'Localização';
  } else if (kind === 'contact') text = str(inner.displayName) ? `Contato: ${str(inner.displayName)}` : 'Contato compartilhado';
  else text = str(docInner.caption) ?? null;
  const base64 = str(message.base64) ?? str(d.base64);
  const media = base64 && ['image', 'audio', 'video', 'document', 'sticker'].includes(kind)
    ? { base64, mimetype: str(docInner.mimetype), fileName: str(docInner.fileName) }
    : null;
  const ts = Number(d.messageTimestamp);
  return {
    type: 'message',
    id,
    fromMe: key.fromMe === true,
    e164,
    pushName: str(d.pushName),
    kind,
    text: text ? text.slice(0, 65536) : null,
    at: Number.isFinite(ts) && ts > 1_000_000_000 ? new Date(ts * 1000) : new Date(),
    media,
  };
}

const ACK: Record<string, EvoStatus['status']> = {
  SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed',
  '2': 'sent', '3': 'delivered', '4': 'read', '5': 'read', '0': 'failed',
};

function readStatus(d: Record<string, unknown>): EvoStatus | EvoIgnored {
  const id = str(d.keyId) ?? str(obj(d.key)?.id) ?? str(d.messageId);
  const raw = str(d.status) ?? str(obj(d.update)?.status);
  const status = raw ? ACK[raw.toUpperCase()] : undefined;
  if (!id || !status) return { type: 'ignored', reason: 'atualização sem estado' };
  return { type: 'status', id, status };
}

/** Lê um aviso da Evolution. Um aviso pode trazer várias mensagens. */
export function readEvolutionEvent(body: unknown): { instance: string | null; events: EvoEvent[] } {
  const root = obj(body);
  if (!root) return { instance: null, events: [{ type: 'ignored', reason: 'corpo inválido' }] };
  const name = eventName(root.event);
  const instance = str(root.instance);
  const data = root.data;
  const list = Array.isArray(data) ? data.map(obj).filter((x): x is Record<string, unknown> => !!x) : obj(data) ? [obj(data)!] : [];
  if (name === 'messages.upsert' || name === 'send.message') {
    const items = list.flatMap((d) => (Array.isArray(d.messages) ? (d.messages as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x) : [d]));
    return { instance, events: items.map(readMessage) };
  }
  if (name === 'messages.update') return { instance, events: list.map(readStatus) };
  if (name === 'connection.update') {
    const d = list[0] ?? {};
    const state = str(d.state);
    if (state !== 'open' && state !== 'close' && state !== 'connecting') return { instance, events: [{ type: 'ignored', reason: 'estado desconhecido' }] };
    return { instance, events: [{ type: 'connection', state, e164: jidToE164(str(d.wuid) ?? undefined) }] };
  }
  return { instance, events: [{ type: 'ignored', reason: name || 'evento sem nome' }] };
}

const RANK: Record<string, number> = { queued: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

/** O estado só avança (um "entregue" atrasado não desfaz o "lida"). */
export function statusAdvances(current: string, next: EvoStatus['status']): boolean {
  if (next === 'failed') return current === 'queued' || current === 'sent';
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}
