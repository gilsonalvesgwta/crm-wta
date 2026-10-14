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
};

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
      const kind = message.text ? 'text' : attachments[0]?.type === 'image' ? 'image' : attachments[0]?.type === 'video' ? 'video'
        : attachments[0]?.type === 'audio' ? 'audio' : attachments.length ? 'document' : 'other';
      const ts = Number(m?.timestamp);
      out.push({ type: 'message', igUserId, id, sender, recipient, fromMe: message.is_echo === true, text: str(message.text), kind,
        at: Number.isFinite(ts) && ts > 0 ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(), attachments });
    }
  }
  return out;
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

export const templateBody = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,512}$/, { message: 'Use só letras minúsculas sem acento, números e _ (ex.: boas_vindas).' }),
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).default('pt_BR'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION'], { message: 'Escolha a categoria.' }),
  header: z.string().trim().max(60, { message: 'Até 60 caracteres.' }).nullable().optional().transform((v) => v || null),
  body: z.string().trim().min(1, { message: 'Escreva o texto do modelo.' }).max(1024, { message: 'Até 1024 caracteres.' }),
  footer: z.string().trim().max(60, { message: 'Até 60 caracteres.' }).nullable().optional().transform((v) => v || null),
  buttons: z.array(z.string().trim().min(1).max(25, { message: 'Botão com até 25 caracteres.' })).max(3).default([]),
  examples: z.array(z.string().trim().min(1, { message: 'Dê um exemplo para cada variável.' }).max(200)).max(20).default([]),
}).superRefine((v, ctx) => {
  const n = templateVariables(v.body);
  for (let i = 1; i <= n; i++) {
    if (!new RegExp(`\\{\\{\\s*${i}\\s*\\}\\}`).test(v.body)) ctx.addIssue({ code: 'custom', path: ['body'], message: `As variáveis precisam ser seguidas: falta {{${i}}}.` });
  }
  if (v.examples.length < n) ctx.addIssue({ code: 'custom', path: ['examples'], message: 'Dê um exemplo para cada variável.' });
  if (/\{\{/.test(v.header ?? '')) ctx.addIssue({ code: 'custom', path: ['header'], message: 'O título não aceita variáveis.' });
  if (/^\s*\{\{|\}\}\s*$/.test(v.body)) ctx.addIssue({ code: 'custom', path: ['body'], message: 'A Meta não aceita texto começando ou terminando com variável.' });
});
export type TemplateInput = z.infer<typeof templateBody>;

/** Corpo do pedido de criação de modelo na Meta. */
export function templateRequest(t: TemplateInput) {
  const n = templateVariables(t.body);
  const components: Obj[] = [];
  if (t.header) components.push({ type: 'HEADER', format: 'TEXT', text: t.header });
  components.push({ type: 'BODY', text: t.body, ...(n ? { example: { body_text: [t.examples.slice(0, n)] } } : {}) });
  if (t.footer) components.push({ type: 'FOOTER', text: t.footer });
  if (t.buttons.length) components.push({ type: 'BUTTONS', buttons: t.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) });
  return { name: t.name, language: t.language, category: t.category, components };
}
