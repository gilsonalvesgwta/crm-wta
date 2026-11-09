// Meta (WhatsApp oficial e Instagram): leitura dos avisos (webhooks) e modelos
// de mensagem. Funções puras, testadas sem rede.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Obj : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

export type CloudMessage = {
  type: 'message'; phoneNumberId: string; id: string; from: string; name: string | null; kind: string; text: string | null;
  at: Date; media: { id: string; mimetype: string | null; fileName: string | null } | null;
};
export type CloudStatus = { type: 'status'; phoneNumberId: string; id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; error: string | null };
export type TemplateStatus = { type: 'template'; metaId: string | null; name: string | null; language: string | null; status: string; reason: string | null };
export type CloudEvent = CloudMessage | CloudStatus | TemplateStatus;

const KINDS: Record<string, string> = {
  text: 'text', image: 'image', audio: 'audio', voice: 'audio', video: 'video', document: 'document', sticker: 'sticker',
  location: 'location', contacts: 'contact', button: 'text', interactive: 'text', reaction: 'other',
};

/** Telefone do WhatsApp (só dígitos) em E.164. */
export function waToE164(wa: string): string | null {
  const d = wa.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

/** Avisos da Cloud API (objeto whatsapp_business_account). */
export function readCloudWebhook(body: unknown): CloudEvent[] {
  const b = obj(body);
  if (!b || b.object !== 'whatsapp_business_account') return [];
  const out: CloudEvent[] = [];
  for (const entry of arr(b.entry)) {
    for (const ch of arr(obj(entry)?.changes)) {
      const change = obj(ch);
      const value = obj(change?.value);
      if (!value) continue;
      if (change?.field === 'message_template_status_update') {
        out.push({ type: 'template', metaId: str(value.message_template_id), name: str(value.message_template_name),
          language: str(value.message_template_language), status: str(value.event) ?? 'PENDING', reason: str(value.reason) === 'NONE' ? null : str(value.reason) });
        continue;
      }
      if (change?.field !== 'messages') continue;
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map(arr(value.contacts).map((c) => [str(obj(c)?.wa_id) ?? '', str(obj(obj(c)?.profile)?.name)]));
      for (const m of arr(value.messages)) {
        const msg = obj(m);
        const id = str(msg?.id);
        const from = str(msg?.from);
        if (!msg || !id || !from) continue;
        const t = str(msg.type) ?? 'other';
        const part = obj(msg[t]);
        let text: string | null = null;
        if (t === 'text') text = str(obj(msg.text)?.body);
        else if (t === 'button') text = str(obj(msg.button)?.text);
        else if (t === 'interactive') text = str(obj(obj(msg.interactive)?.button_reply)?.title) ?? str(obj(obj(msg.interactive)?.list_reply)?.title);
        else if (part) text = str(part.caption);
        if (t === 'location' && part) text = `Localização: ${str(part.latitude)}, ${str(part.longitude)}${str(part.name) ? ` (${str(part.name)})` : ''}`;
        if (t === 'reaction') continue;
        const media = part && str(part.id) && ['image', 'audio', 'voice', 'video', 'document', 'sticker'].includes(t)
          ? { id: str(part.id)!, mimetype: str(part.mime_type), fileName: str(part.filename) } : null;
        const ts = Number(str(msg.timestamp));
        out.push({ type: 'message', phoneNumberId, id, from, name: names.get(from) ?? null, kind: KINDS[t] ?? 'other', text,
          at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(), media });
      }
      for (const s of arr(value.statuses)) {
        const st = obj(s);
        const id = str(st?.id);
        const status = str(st?.status);
        if (!id || !status || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        const err = obj(arr(st?.errors)[0]);
        out.push({ type: 'status', phoneNumberId, id, status: status as CloudStatus['status'],
          error: err ? (str(obj(err.error_data)?.details) ?? str(err.title) ?? str(err.message)) : null });
      }
    }
  }
  return out;
}

export type IgMessage = {
  type: 'message'; igUserId: string; id: string; sender: string; recipient: string; fromMe: boolean; text: string | null; kind: string;
  at: Date; attachments: { type: string; url: string }[];
  /** Resposta rápida tocada (payload do botão). */
  quickReply?: string | null;
  /** Resposta a um story (id e endereço do story). */
  replyToStory?: { id: string | null; url: string | null } | null;
  /** Menção num story (endereço do story). */
  storyMention?: string | null;
};

/** Comentário em post, reels ou live (objeto instagram, campos comments e live_comments). */
export type IgComment = {
  type: 'comment'; igUserId: string; id: string; mediaId: string | null; mediaType: string | null; live: boolean;
  parentId: string | null; from: { id: string; username: string | null }; text: string; at: Date;
};
/** Toque num botão (postback). */
export type IgPostback = { type: 'postback'; igUserId: string; sender: string; mid: string | null; payload: string; title: string | null; at: Date };
/** Reação a uma mensagem. */
export type IgReaction = { type: 'reaction'; igUserId: string; sender: string; mid: string; action: 'react' | 'unreact'; emoji: string | null; at: Date };
export type IgActivity = IgComment | IgPostback | IgReaction;

const when = (ts: unknown) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n > 1e12 ? n : n * 1000) : new Date();
};

/** Comentários, cliques em botão e reações (o que não é mensagem). */
export function readInstagramActivity(body: unknown): IgActivity[] {
  const b = obj(body);
  if (!b || b.object !== 'instagram') return [];
  const out: IgActivity[] = [];
  for (const e of arr(b.entry)) {
    const entry = obj(e);
    const igUserId = str(entry?.id);
    if (!igUserId) continue;
    for (const ch of arr(entry?.changes)) {
      const c = obj(ch);
      const field = str(c?.field);
      const v = obj(c?.value);
      if ((field !== 'comments' && field !== 'live_comments') || !v) continue;
      const from = obj(v.from);
      const id = str(v.id);
      const fromId = str(from?.id);
      if (!id || !fromId) continue;
      const media = obj(v.media);
      out.push({
        type: 'comment', igUserId, id, mediaId: str(media?.id), mediaType: str(media?.media_product_type), live: field === 'live_comments',
        parentId: str(v.parent_id), from: { id: fromId, username: str(from?.username) }, text: str(v.text) ?? '', at: when(entry?.time),
      });
    }
    for (const ev of arr(entry?.messaging)) {
      const m = obj(ev);
      const sender = str(obj(m?.sender)?.id);
      if (!sender) continue;
      const pb = obj(m?.postback);
      const payload = str(pb?.payload);
      if (pb && payload) out.push({ type: 'postback', igUserId, sender, mid: str(pb.mid), payload, title: str(pb.title), at: when(m?.timestamp) });
      const r = obj(m?.reaction);
      const rmid = str(r?.mid);
      if (r && rmid) {
        out.push({ type: 'reaction', igUserId, sender, mid: rmid, action: r.action === 'unreact' ? 'unreact' : 'react', emoji: str(r.emoji) ?? str(r.reaction), at: when(m?.timestamp) });
      }
    }
  }
  return out;
}

/** Avisos do Instagram (objeto instagram, campo messaging). */
export function readInstagramWebhook(body: unknown): IgMessage[] {
  const b = obj(body);
  if (!b || b.object !== 'instagram') return [];
  const out: IgMessage[] = [];
  for (const e of arr(b.entry)) {
    const entry = obj(e);
    const igUserId = str(entry?.id);
    if (!igUserId) continue;
    for (const ev of arr(entry?.messaging)) {
      const m = obj(ev);
      const message = obj(m?.message);
      const sender = str(obj(m?.sender)?.id);
      const recipient = str(obj(m?.recipient)?.id);
      const id = str(message?.mid);
      if (!message || !sender || !recipient || !id || message.is_deleted) continue;
      const attachments = arr(message.attachments).map((a) => ({ type: str(obj(a)?.type) ?? 'file', url: str(obj(obj(a)?.payload)?.url) ?? '' })).filter((a) => a.url);
      const kind = message.text ? 'text' : attachments.length ? igKind(attachments[0]!.type) : 'other';
      const ts = Number(m?.timestamp);
      const story = obj(obj(message.reply_to)?.story);
      const mention = arr(message.attachments).map(obj).find((a) => a?.type === 'story_mention');
      out.push({ type: 'message', igUserId, id, sender, recipient, fromMe: message.is_echo === true, text: str(message.text), kind,
        at: Number.isFinite(ts) && ts > 0 ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(), attachments,
        quickReply: str(obj(message.quick_reply)?.payload),
        replyToStory: story ? { id: str(story.id), url: str(story.url) } : null,
        storyMention: mention ? (str(obj(mention.payload)?.url) ?? '') : null });
    }
  }
  return out;
}

/**
 * Tipo da mensagem do Instagram pelo anexo: reels compartilhado é vídeo;
 * publicação compartilhada e menção em story são imagem; arquivo é documento.
 */
export function igKind(type: string): 'image' | 'video' | 'audio' | 'document' {
  if (type === 'image' || type === 'share' || type === 'ig_post' || type === 'story_mention' || type === 'animated_image') return 'image';
  if (type === 'video' || type === 'ig_reel' || type === 'reel') return 'video';
  if (type === 'audio') return 'audio';
  return 'document';
}

/** Tipo da mensagem corrigido pelo arquivo que chegou (o anexo às vezes vem com outro nome). */
export function kindFromContent(kind: string, contentType: string): string {
  const t = contentType.split(';')[0]!.trim();
  if (kind === 'audio' && (t.startsWith('audio/') || t === 'video/mp4')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return kind === 'image' || kind === 'video' || kind === 'audio' ? 'document' : kind;
}

/** Assinatura dos avisos (X-Hub-Signature-256) com o segredo do app. */
export function validSignature(raw: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', appSecret).update(raw).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---- Modelos -----------------------------------------------------------------------

/** Quantas variáveis {{1}}, {{2}}… o texto usa (precisam ser seguidas, a partir de 1). */
export function templateVariables(text: string): number {
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export function renderTemplate(text: string, params: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '');
}

/** Botão do modelo: resposta rápida, link (até 2) ou telefone (até 1). */
const templateButton = z.union([
  // Formato antigo: só o texto da resposta rápida.
  z.string().trim().min(1).max(25, { message: 'Botão com até 25 caracteres.' }).transform((text) => ({ type: 'QUICK_REPLY' as const, text })),
  z.object({
    type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']).default('QUICK_REPLY'),
    text: z.string().trim().min(1, { message: 'Dê um nome ao botão.' }).max(25, { message: 'Botão com até 25 caracteres.' }),
    url: z.string().trim().max(2000).nullable().optional(),
    phone: z.string().trim().max(20).nullable().optional(),
  }),
]);
export type TemplateButton = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string | null; phone?: string | null };

export const HEADER_FORMATS = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const;
export type HeaderFormat = (typeof HEADER_FORMATS)[number];

export const templateBody = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,512}$/, { message: 'Use só letras minúsculas sem acento, números e _ (ex.: boas_vindas).' }),
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).default('pt_BR'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION'], { message: 'Escolha a categoria.' }),
  // Cabeçalho: texto (até 60), imagem, vídeo ou documento (arquivo da biblioteca de mídia).
  headerFormat: z.enum(HEADER_FORMATS).nullable().optional(),
  header: z.string().trim().max(60, { message: 'Até 60 caracteres.' }).nullable().optional().transform((v) => v || null),
  headerFileId: z.string().uuid().nullable().optional().transform((v) => v || null),
  body: z.string().trim().min(1, { message: 'Escreva o texto do modelo.' }).max(1024, { message: 'Até 1024 caracteres.' }),
  footer: z.string().trim().max(60, { message: 'Até 60 caracteres.' }).nullable().optional().transform((v) => v || null),
  buttons: z.array(templateButton).max(10, { message: 'Até 10 botões.' }).default([]),
  examples: z.array(z.string().trim().min(1, { message: 'Dê um exemplo para cada variável.' }).max(200)).max(20).default([]),
}).transform((v) => {
  const headerFormat: HeaderFormat | null = v.headerFormat ?? (v.header ? 'TEXT' : null);
  return {
    ...v, headerFormat,
    header: headerFormat === 'TEXT' ? v.header : null,
    headerFileId: headerFormat && headerFormat !== 'TEXT' ? v.headerFileId : null,
    buttons: v.buttons.map((b): TemplateButton => ({
      type: b.type, text: b.text,
      ...(b.type === 'URL' ? { url: ('url' in b ? b.url : null) ?? null } : {}),
      ...(b.type === 'PHONE_NUMBER' ? { phone: ('phone' in b ? b.phone : null) ?? null } : {}),
    })),
  };
}).superRefine((v, ctx) => {
  const n = templateVariables(v.body);
  for (let i = 1; i <= n; i++) {
    if (!new RegExp(`\\{\\{\\s*${i}\\s*\\}\\}`).test(v.body)) ctx.addIssue({ code: 'custom', path: ['body'], message: `As variáveis precisam ser seguidas: falta {{${i}}}.` });
  }
  if (v.examples.length < n) ctx.addIssue({ code: 'custom', path: ['examples'], message: 'Dê um exemplo para cada variável.' });
  if (/\{\{/.test(v.header ?? '')) ctx.addIssue({ code: 'custom', path: ['header'], message: 'O título não aceita variáveis.' });
  if (v.headerFormat === 'TEXT' && !v.header) ctx.addIssue({ code: 'custom', path: ['header'], message: 'Escreva o título ou escolha outro cabeçalho.' });
  if (v.headerFormat && v.headerFormat !== 'TEXT' && !v.headerFileId) ctx.addIssue({ code: 'custom', path: ['headerFileId'], message: 'Escolha o arquivo do cabeçalho.' });
  if (/^\s*\{\{|\}\}\s*$/.test(v.body)) ctx.addIssue({ code: 'custom', path: ['body'], message: 'A Meta não aceita texto começando ou terminando com variável.' });
  const count = (t: TemplateButton['type']) => v.buttons.filter((b) => b.type === t).length;
  if (count('URL') > 2) ctx.addIssue({ code: 'custom', path: ['buttons'], message: 'Até 2 botões de link.' });
  if (count('PHONE_NUMBER') > 1) ctx.addIssue({ code: 'custom', path: ['buttons'], message: 'Só 1 botão de telefone.' });
  v.buttons.forEach((b, i) => {
    if (b.type === 'URL' && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(b.url ?? '')) ctx.addIssue({ code: 'custom', path: ['buttons', i, 'url'], message: 'Link começando com https://.' });
    if (b.type === 'PHONE_NUMBER' && !/^\+?[0-9]{10,15}$/.test((b.phone ?? '').replace(/[\s()-]/g, ''))) ctx.addIssue({ code: 'custom', path: ['buttons', i, 'phone'], message: 'Telefone com DDI e DDD (ex.: +55 11 99999-0000).' });
  });
  // A Meta pede as respostas rápidas juntas (antes ou depois dos outros botões).
  const kinds = v.buttons.map((b) => (b.type === 'QUICK_REPLY' ? 'q' : 'o')).join('').replace(/(.)\1+/g, '$1');
  if (kinds.length > 2) ctx.addIssue({ code: 'custom', path: ['buttons'], message: 'Deixe as respostas rápidas juntas (todas antes ou todas depois dos links e do telefone).' });
});
export type TemplateInput = z.infer<typeof templateBody>;

/** Telefone do botão no formato da Meta (+DDI...). */
export function buttonPhone(p: string | null | undefined): string {
  const d = (p ?? '').replace(/\D/g, '');
  return `+${d}`;
}

/** Corpo do pedido de criação de modelo na Meta (com o identificador do arquivo de exemplo do cabeçalho). */
export function templateRequest(t: TemplateInput, headerHandle?: string | null) {
  const n = templateVariables(t.body);
  const components: Obj[] = [];
  if (t.headerFormat === 'TEXT' && t.header) components.push({ type: 'HEADER', format: 'TEXT', text: t.header });
  if (t.headerFormat && t.headerFormat !== 'TEXT') components.push({ type: 'HEADER', format: t.headerFormat, example: { header_handle: [headerHandle ?? ''] } });
  components.push({ type: 'BODY', text: t.body, ...(n ? { example: { body_text: [t.examples.slice(0, n)] } } : {}) });
  if (t.footer) components.push({ type: 'FOOTER', text: t.footer });
  if (t.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: t.buttons.map((b) => b.type === 'URL' ? { type: 'URL', text: b.text, url: b.url }
        : b.type === 'PHONE_NUMBER' ? { type: 'PHONE_NUMBER', text: b.text, phone_number: buttonPhone(b.phone) } : { type: 'QUICK_REPLY', text: b.text }),
    });
  }
  return { name: t.name, language: t.language, category: t.category, components };
}
