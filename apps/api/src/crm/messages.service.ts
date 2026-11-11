import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { CONFIG, type Config } from '../config.js';
import { phoneVariants, readEvolutionMessage, statusAdvances, toEvolutionNumber, type EvoMessage, type EvoStatus } from '../domain/whatsapp.js';
import { SecretBox } from '../domain/secrets.js';
import { Problem } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Evolution, EvolutionError } from '../infra/evolution.js';
import { Meta, MetaError, type MetaHost } from '../infra/meta.js';
import { AudioError, convertVoice } from '../infra/audio.js';
import { enrichContact } from './contact-enrich.js';
import { splitName } from '../domain/contact-info.js';
import { kindFromContent, renderTemplate, templateVariables, type IgMessage } from '../domain/meta.js';
import { sendTenantMail, SmtpError, textToHtml } from '../infra/tenant-mail.js';
import { memberJson } from './fields.js';
import { FilesService } from './files.service.js';
import { RecordsService } from './records.service.js';

export type SendInput = {
  accountId: string; to?: string | null; text?: string | null; subject?: string | null;
  /** WhatsApp oficial: modelo aprovado e os valores de {{1}}, {{2}}… */
  templateId?: string | null; templateParams?: string[] | null;
  /** Áudio gravado no CRM: mensagem de voz. */
  voice?: boolean | null;
};

/** Envio feito por um fluxo do WhatsApp oficial: botões e mídia da biblioteca. */
export type FlowSendExtras = {
  /** Modelo: dado de cada botão de resposta rápida (posição do botão no modelo e o dado que volta no clique). */
  buttonPayloads?: { index: number; payload: string }[];
  /** Mensagem interativa com até 3 botões de resposta (o id volta no clique). */
  replyButtons?: { id: string; title: string }[];
  /** Arquivo da biblioteca de mídia (vai por link assinado). */
  mediaFileId?: string | null;
};

/** Canal de cada tipo de conta. */
export function channelOf(kind: string): 'whatsapp' | 'email' | 'instagram' {
  return kind === 'email_smtp' ? 'email' : kind === 'instagram' ? 'instagram' : 'whatsapp';
}

const WINDOW_MS = 24 * 3600_000;
export type Upload = { name: string; data: Buffer };

/** Colunas de uma mensagem para a interface e a API. */
export const MESSAGE_COLUMNS = `
  m.id, m.channel, m.direction, m.status, m.kind, m.remote, m.subject, m.body, m.error,
  m.contact_id as "contactId", m.created_at as "createdAt", m.sent_at as "sentAt", m.delivered_at as "deliveredAt",
  m.read_at as "readAt", m.seen_at as "seenAt",
  (select json_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'address', a.address)
     from channel_accounts a where a.id = m.channel_account_id) as account,
  ${memberJson('m.sent_by')} as "sentBy",
  (select json_build_object('id', r.id, 'name', r.name) from automation_rules r where r.id = m.automation_rule_id) as automation,
  (select json_build_object('id', k.id, 'name', k.name) from campaigns k where k.id = m.campaign_id) as campaign,
  (select json_build_object('id', f.id, 'name', f.original_name, 'contentType', f.content_type, 'sizeBytes', f.size_bytes)
     from files f where f.id = m.file_id and f.deleted_at is null) as file`;

function kindOf(contentType: string): 'image' | 'audio' | 'video' | 'document' {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  return 'document';
}

/** Resposta que pede para não receber mais mensagens automáticas. */
const OPT_OUT = /^(sair|parar|pare|stop|cancelar|descadastrar|nao quero mais)[.!]?$/i;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
};

const MEDIA_KINDS = new Set(['image', 'audio', 'video', 'document', 'sticker']);

/** Tipo de anexo do Instagram para o arquivo (nulo se o Instagram não aceita). */
function igAttachmentType(contentType: string, voice: boolean): 'image' | 'video' | 'audio' | 'file' | null {
  const t = contentType.split(';')[0]!.trim();
  if (voice) return 'audio';
  if (/^image\/(jpeg|png|gif)$/.test(t)) return 'image';
  if (/^video\/(mp4|quicktime|webm)$/.test(t)) return 'video';
  if (/^audio\/(mp4|x-m4a|aac|wav|mpeg)$/.test(t)) return 'audio';
  if (t === 'application/pdf') return 'file';
  return null;
}

/** Endereço da mídia do Instagram que vale guardar (o domínio é conferido na hora de baixar). */
function igMediaUrl(u: string | undefined): string | null {
  return u && /^https?:\/\/\S+$/.test(u) && u.length <= 4000 ? u : null;
}

type TemplateRow = {
  name: string; language: string; body: string; header: string | null; header_format: string | null; header_file_id: string | null;
  header_media_url: string | null; file_name: string | null; buttons: { type: string; text: string }[] | null;
};

@Injectable()
export class MessagesService {
  private readonly log = new Logger('mensagens');
  private readonly box: SecretBox;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(Evolution) private readonly evo: Evolution,
    @Inject(Meta) private readonly meta: Meta,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(RecordsService) private readonly records: RecordsService,
  ) {
    this.box = new SecretBox(cfg.masterKeys, cfg.currentKey);
  }

  /** Arquivos (anexos de avisos) com o conteúdo. */
  async loadFiles(q: Q, ids: string[]): Promise<{ name: string; contentType: string; data: Buffer }[]> {
    const out: { name: string; contentType: string; data: Buffer }[] = [];
    for (const id of ids) {
      const f = (await q.query<{ original_name: string; content_type: string }>('select original_name, content_type from files where id = $1 and deleted_at is null', [id])).rows[0];
      if (f) out.push({ name: f.original_name, contentType: f.content_type, data: await this.files.readIn(q, id) });
    }
    return out;
  }

  /**
   * Aviso interno (para a equipe): manda direto pela conta, sem criar conversa
   * nem contato. WhatsApp: texto e cada anexo; e-mail: um e-mail com os anexos.
   */
  async sendNotice(tenantId: string, accountId: string, to: string, msg: { subject?: string; text: string; files: { name: string; contentType: string; data: Buffer }[] }) {
    const a = (await this.db.app({ tenantId, userId: null }, (q) => q.query<{ id: string; kind: string; status: string; external_id: string | null; config: Record<string, unknown>; secret: Buffer | null; address: string | null }>(
      'select id, kind, status, external_id, config, secret, address from channel_accounts where id = $1', [accountId]))).rows[0];
    if (!a) throw new Error('a conta de envio não existe mais');
    try {
      if (a.kind === 'whatsapp_evolution') {
        const number = to.replace(/\D/g, '');
        if (msg.text) await this.evo.sendText(a.external_id!, number, msg.text);
        for (const f of msg.files) {
          await this.evo.sendMedia(a.external_id!, number, {
            mediatype: f.contentType.startsWith('image/') ? 'image' : f.contentType.startsWith('video/') ? 'video' : f.contentType.startsWith('audio/') ? 'audio' : 'document',
            mimetype: f.contentType, base64: f.data.toString('base64'), fileName: f.name,
          });
        }
      } else if (a.kind === 'whatsapp_cloud') {
        // API oficial: mensagem livre só chega se a pessoa falou com o número nas últimas 24 h.
        const c = this.metaCreds(a.id, a.secret);
        const number = to.replace(/\D/g, '');
        if (msg.text) await this.meta.sendWhatsapp(a.external_id!, c.token, { to: number, type: 'text', text: { body: msg.text, preview_url: true } });
        for (const f of msg.files) {
          const mediaId = await this.meta.uploadMedia(a.external_id!, c.token, { data: f.data, type: f.contentType, name: f.name });
          const t = f.contentType.startsWith('image/') ? 'image' : f.contentType.startsWith('video/') ? 'video' : f.contentType.startsWith('audio/') ? 'audio' : 'document';
          await this.meta.sendWhatsapp(a.external_id!, c.token, { to: number, type: t, [t]: { id: mediaId, ...(t === 'document' ? { filename: f.name } : {}) } });
        }
      } else if (a.kind === 'email_smtp') {
        const c = a.config as { host: string; port: number; secure: boolean; user: string; fromName: string };
        await sendTenantMail({ host: c.host, port: c.port, secure: c.secure, user: c.user, fromName: c.fromName, address: a.address!, pass: this.openSecret(a.id, a.secret!) },
          { to, subject: msg.subject ?? 'Aviso do CRM', text: msg.text, html: textToHtml(msg.text), attachments: msg.files.map((f) => ({ filename: f.name, content: f.data, contentType: f.contentType })) },
          this.cfg.CHANNEL_ALLOW_PRIVATE_HOSTS);
      } else {
        throw new Error('essa conta não manda avisos');
      }
    } catch (err) {
      if (err instanceof EvolutionError || err instanceof SmtpError || err instanceof MetaError) throw new Error(err.message);
      throw err;
    }
  }

  /** Token e segredo do app de uma conta da Meta (guardados cifrados juntos). */
  metaCreds(accountId: string, sealed: Buffer | null): { token: string; appSecret: string; appSecret2?: string } {
    if (!sealed) throw new MetaError('A conta está sem o token de acesso.');
    return JSON.parse(this.openSecret(accountId, sealed)) as { token: string; appSecret: string; appSecret2?: string };
  }

  sealSecret(accountId: string, secret: string): Buffer {
    return this.box.seal(Buffer.from(secret, 'utf8'), `channel:${accountId}`);
  }

  openSecret(accountId: string, sealed: Buffer): string {
    return this.box.open(sealed, `channel:${accountId}`).toString('utf8');
  }

  async row(q: Q, id: string) {
    return (await q.query(`select ${MESSAGE_COLUMNS} from messages m where m.id = $1`, [id])).rows[0]!;
  }

  // ---- Histórico ------------------------------------------------------------------

  /** Mensagens de um contato, da mais antiga para a mais nova (as 200 mais recentes, ou antes de `before`). */
  async history(actor: Actor, contactId: string, before?: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.records.assertAccess(q, actor, { kind: 'contact', id: contactId }, false);
      const r = await q.query(
        `select * from (select ${MESSAGE_COLUMNS} from messages m
           where m.contact_id = $1 and ($2::timestamptz is null or m.created_at < $2)
           order by m.created_at desc limit 200) x order by "createdAt"`, [contactId, before ?? null]);
      return { items: r.rows };
    });
  }

  async markSeen(actor: Actor, contactId: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.records.assertAccess(q, actor, { kind: 'contact', id: contactId }, false);
      const r = await q.query("update messages set seen_at = now() where contact_id = $1 and direction = 'in' and seen_at is null", [contactId]);
      return { marked: r.rowCount ?? 0 };
    });
  }

  // ---- Envio ------------------------------------------------------------------------

  send(actor: Actor, contactId: string, input: SendInput, file?: Upload) {
    return this.sendAs({ tenantId: actor.tenantId!, actor, automationRuleId: null }, contactId, input, file);
  }

  /** Envio de uma campanha: sem pessoa, respeitando a lista de supressão, com o link para sair. */
  sendByCampaign(tenantId: string, campaignId: string, contactId: string, input: SendInput) {
    return this.sendAs({ tenantId, actor: null, automationRuleId: null, campaignId }, contactId, input);
  }

  /** Mensagem agendada: sai em nome de quem agendou. */
  sendScheduled(tenantId: string, ownerId: string | null, contactId: string, input: SendInput) {
    return this.sendAs({ tenantId, actor: null, automationRuleId: null, sentBy: ownerId }, contactId, input);
  }

  /** Assinatura do link de descadastro (empresa, canal e endereço). */
  unsubscribeToken(tenantId: string, channel: 'whatsapp' | 'email', address: string): string {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, c: channel, v: address })).toString('base64url');
    return `${payload}.${this.unsubscribeSig(payload)}`;
  }

  private unsubscribeSig(payload: string): string {
    return createHmac('sha256', this.cfg.masterKeys[this.cfg.currentKey]!).update(`descadastro:${payload}`).digest('base64url').slice(0, 32);
  }

  readUnsubscribeToken(token: string): { t: string; c: 'whatsapp' | 'email'; v: string } | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig || sig.length !== 32) return null;
    const want = Buffer.from(this.unsubscribeSig(payload));
    if (!timingSafeEqual(want, Buffer.from(sig.padEnd(32).slice(0, 32)))) return null;
    try {
      const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { t: string; c: 'whatsapp' | 'email'; v: string };
      return /^[0-9a-f-]{36}$/.test(v.t) && (v.c === 'email' || v.c === 'whatsapp') && typeof v.v === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  /** Grava o pedido de não receber mais (link do e-mail ou resposta SAIR). */
  async unsubscribe(tenantId: string, channel: 'whatsapp' | 'email', value: string): Promise<void> {
    await this.db.app({ tenantId, userId: null }, (q) => q.query(
      `insert into suppression_list (tenant_id, channel, value, reason) values (app.tenant_id(), $1, $2, 'opt_out')
       on conflict (tenant_id, channel, value) do nothing`, [channel, value]));
  }

  /** Envio dentro de uma conversa cujo acesso já foi conferido, só pelo canal dela. */
  sendInConversation(actor: Actor, contactId: string, channel: 'whatsapp' | 'email' | 'instagram', input: SendInput, file?: Upload) {
    return this.sendAs({ tenantId: actor.tenantId!, actor, automationRuleId: null, checked: true, channel }, contactId, input, file);
  }

  /** Envio de um fluxo do WhatsApp oficial (transmissão): sem pessoa, respeitando a lista de supressão. */
  sendByFlow(tenantId: string, flowId: string, campaignId: string | null, contactId: string, input: SendInput, extras: FlowSendExtras = {}) {
    return this.sendAs({ tenantId, actor: null, automationRuleId: null, flowId, ...(campaignId ? { campaignId } : {}) }, contactId, input, undefined, extras);
  }

  /** Envio de uma automação: sem pessoa, respeitando a lista de supressão. */
  sendByAutomation(tenantId: string, ruleId: string, contactId: string, input: SendInput) {
    return this.sendAs({ tenantId, actor: null, automationRuleId: ruleId }, contactId, input);
  }

  private async sendAs(
    by: {
      tenantId: string; actor: Actor | null; automationRuleId: string | null; checked?: boolean; channel?: 'whatsapp' | 'email' | 'instagram';
      campaignId?: string;
      /** Fluxo que mandou (aparece em Conversas). */
      flowId?: string;
      /** Mensagem agendada por uma pessoa: sai em nome dela, sem a lista de supressão. */
      sentBy?: string | null;
    },
    contactId: string, input: SendInput, file?: Upload, extras: FlowSendExtras = {},
  ) {
    const actor = by.actor;
    const ctx = actor ? tenantCtx(actor) : { tenantId: by.tenantId, userId: null };
    let text = input.text?.trim() || null;
    if (!text && !file && !input.templateId && !extras.mediaFileId) throw Problem.badRequest('Mensagem vazia.', [{ field: 'text', message: 'Escreva a mensagem ou anexe um arquivo.' }]);
    // Áudio gravado no CRM: Ogg/Opus para o WhatsApp (mensagem de voz) e M4A para o Instagram.
    if (file && input.voice) {
      const kind = (await this.db.app(ctx, (q) => q.query<{ kind: string }>('select kind from channel_accounts where id = $1', [input.accountId]))).rows[0]?.kind;
      if (kind === 'email_smtp') throw Problem.badRequest('Áudio gravado não vai por e-mail.', [{ field: 'file', message: 'Use WhatsApp ou Instagram.' }]);
      const target = kind === 'instagram' ? 'm4a' : 'ogg';
      try {
        file = { name: `audio-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.${target}`, data: await convertVoice(file.data, target) };
      } catch (err) {
        throw Problem.badRequest(err instanceof AudioError ? err.message : 'Não foi possível converter o áudio.', [{ field: 'file', message: 'Grave de novo.' }]);
      }
    }

    // 1. Registra a mensagem como "na fila", com tudo conferido.
    const prep = await this.db.app(ctx, async (q) => {
      if (actor && !by.checked) await this.records.assertAccess(q, actor, { kind: 'contact', id: contactId }, false);
      const a = (await q.query<{ id: string; kind: string; status: string; external_id: string | null; config: Record<string, unknown>; secret: Buffer | null; address: string | null; name: string }>(
        'select id, kind, status, external_id, config, secret, address, name from channel_accounts where id = $1', [input.accountId])).rows[0];
      if (!a) throw Problem.badRequest('Conta inválida.', [{ field: 'accountId', message: 'Escolha um WhatsApp ou e-mail da empresa.' }]);
      const channel = channelOf(a.kind);
      if (by.channel && by.channel !== channel) {
        throw Problem.badRequest('Conta de outro canal.', [{ field: 'accountId', message: by.channel === 'email' ? 'Escolha uma conta de e-mail.' : by.channel === 'instagram' ? 'Escolha o Instagram.' : 'Escolha um WhatsApp.' }]);
      }
      if (by.campaignId && channel === 'email' && a.status === 'error') {
        throw Problem.conflict(`A conta de e-mail "${a.name}" está com erro. Confira em Configurações › Canais.`);
      }
      if (channel !== 'email' && a.status !== 'connected') {
        throw Problem.conflict(`${channel === 'instagram' ? 'O Instagram' : 'O WhatsApp'} "${a.name}" não está conectado. Peça ao administrador para conectar em Configurações › Canais.`);
      }
      if (channel === 'email' && !input.subject?.trim()) {
        throw Problem.badRequest('Falta o assunto.', [{ field: 'subject', message: 'Escreva o assunto do e-mail.' }]);
      }
      const options = channel === 'whatsapp'
        ? (await q.query<{ v: string }>('select e164 as v from contact_phones where contact_id = $1 order by is_primary desc, created_at', [contactId])).rows.map((r) => r.v)
        : channel === 'instagram'
          ? (await q.query<{ v: string }>("select value as v from contact_handles where contact_id = $1 and kind = 'instagram' order by created_at", [contactId])).rows.map((r) => r.v)
          : (await q.query<{ v: string }>('select email as v from contact_emails where contact_id = $1 order by is_primary desc, created_at', [contactId])).rows.map((r) => r.v);
      if (!options.length) {
        throw Problem.badRequest(channel === 'whatsapp' ? 'O contato não tem telefone.' : channel === 'instagram' ? 'O contato não tem Instagram.' : 'O contato não tem e-mail.',
          [{ field: 'to', message: channel === 'whatsapp' ? 'Cadastre um telefone no contato.' : channel === 'instagram' ? 'O Instagram aparece quando a pessoa manda mensagem.' : 'Cadastre um e-mail no contato.' }]);
      }
      const to = input.to ? options.find((o) => o === input.to!.trim().toLowerCase() || o === input.to!.trim()) : options[0];
      if (!to) throw Problem.badRequest('Destino inválido.', [{ field: 'to', message: 'Escolha um telefone ou e-mail do contato.' }]);
      // Conversa individual, escrita por alguém da empresa: a lista de supressão vale para campanhas e automações.
      if (!actor && !by.sentBy) {
        const suppressed = await q.query('select 1 from suppression_list where channel = $1 and value = $2', [channel, to]);
        if (suppressed.rowCount) throw Problem.conflict('O contato pediu para não receber mensagens automáticas por este canal.');
      }

      // Canais da Meta: resposta livre só até 24 h depois da última mensagem do cliente; fora disso, modelo aprovado.
      let template: TemplateRow | null = null;
      if (a.kind === 'whatsapp_cloud' || a.kind === 'instagram') {
        const last = (await q.query<{ at: Date | null }>(
          `select max(created_at) as at from messages where contact_id = $1 and channel_account_id = $2 and direction = 'in'`, [contactId, a.id])).rows[0]!.at;
        const open = !!last && Date.now() - last.getTime() < WINDOW_MS;
        if (a.kind === 'whatsapp_cloud' && input.templateId) {
          template = (await q.query<TemplateRow>(
            `select t.name, t.language, t.body, t.header, t.header_format, t.header_file_id, t.header_media_url, t.buttons,
                    (select f.original_name from files f where f.id = t.header_file_id and f.deleted_at is null) as file_name
               from whatsapp_templates t where t.id = $1 and t.channel_account_id = $2 and t.status = 'APPROVED'`,
            [input.templateId, a.id])).rows[0] ?? null;
          if (!template) throw Problem.badRequest('Modelo inválido.', [{ field: 'templateId', message: 'Escolha um modelo aprovado deste número.' }]);
          const need = templateVariables(template.body);
          const params = (input.templateParams ?? []).map((v) => v.trim());
          if (params.length < need || params.slice(0, need).some((v) => !v)) {
            throw Problem.badRequest('Faltam valores do modelo.', [{ field: 'templateParams', message: `Preencha as ${need} variável(is) do modelo.` }]);
          }
          text = [template.header, renderTemplate(template.body, params)].filter(Boolean).join('\n\n');
        } else if (!open) {
          throw new Problem(409, a.kind === 'instagram'
            ? 'O Instagram só deixa responder até 24 horas depois da última mensagem do cliente.'
            : 'Passaram 24 horas da última mensagem do cliente (ou ele nunca escreveu): no WhatsApp oficial, comece com um modelo aprovado.',
          'outside-window');
        }
      }

      let fileId: string | null = null;
      let contentType: string | null = null;
      if (file) {
        fileId = await this.files.storeIn(q, actor!, { name: file.name, data: file.data, purpose: 'message', ref: { kind: 'contact', id: contactId } });
        contentType = (await q.query<{ content_type: string }>('select content_type from files where id = $1', [fileId])).rows[0]!.content_type;
        if (a.kind === 'instagram' && !igAttachmentType(contentType, !!input.voice)) {
          throw Problem.badRequest('Arquivo não aceito pelo Instagram.', [{ field: 'file', message: 'O Instagram aceita imagem (JPG, PNG, GIF), vídeo (MP4, MOV), áudio (M4A, AAC, WAV) e PDF.' }]);
        }
      }
      // Mídia da biblioteca (fluxo do WhatsApp oficial): vai por link assinado; no histórico fica o nome do arquivo.
      let library: { name: string; contentType: string } | null = null;
      if (extras.mediaFileId) {
        if (a.kind !== 'whatsapp_cloud') throw Problem.badRequest('Arquivo da biblioteca só pelo WhatsApp oficial.', [{ field: 'accountId', message: 'Escolha o WhatsApp oficial.' }]);
        const lf = (await q.query<{ original_name: string; content_type: string }>(
          `select original_name, content_type from files where id = $1 and purpose = 'media' and deleted_at is null`, [extras.mediaFileId])).rows[0];
        if (!lf) throw new Problem(409, 'O arquivo saiu da biblioteca de mídia.', 'media-missing');
        library = { name: lf.original_name, contentType: lf.content_type };
      }
      const kind = input.voice && file ? 'audio' : contentType ? kindOf(contentType) : library ? kindOf(library.contentType) : 'text';
      // Botões no histórico: "[Quero] [Saber mais]" depois do texto (só nos envios de fluxo).
      const buttons: string[] = extras.replyButtons?.length ? extras.replyButtons.map((b) => b.title)
        : extras.buttonPayloads?.length ? (template?.buttons ?? []).filter((b) => b.type === 'QUICK_REPLY').map((b) => b.text) : [];
      const body = library && !text ? `[${library.name}]` : buttons.length && text ? `${text}\n${buttons.map((b) => `[${b}]`).join(' ')}` : text;
      const m = await q.query<{ id: string }>(
        `insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, remote, subject, body, kind, file_id, sent_by, automation_rule_id, campaign_id, ig_flow_id)
         values (app.tenant_id(), $1, $2, 'out', 'queued', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [a.id, channel, contactId, to, channel === 'email' ? input.subject!.trim() : null, body, kind, fileId, actor?.membershipId ?? by.sentBy ?? null, by.automationRuleId, by.campaignId ?? null, by.flowId ?? null]);
      return { id: m.rows[0]!.id, account: a, channel, to, kind, contentType, template, fileId, library };
    });

    // 2. Entrega pelo canal, fora da transação.
    let externalId: string | null = null;
    let error: string | null = null;
    try {
      if (prep.account.kind === 'whatsapp_cloud') {
        const c = this.metaCreds(prep.account.id, prep.account.secret);
        const to = prep.to.replace(/\D/g, '');
        const phoneId = prep.account.external_id!;
        if (prep.template) {
          const params = (input.templateParams ?? []).slice(0, templateVariables(prep.template.body));
          const components: Record<string, unknown>[] = [];
          // Cabeçalho de mídia: o arquivo da biblioteca (link assinado) ou o exemplo guardado na Meta.
          const fmt = prep.template.header_format;
          if (fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT') {
            const link = prep.template.header_file_id && prep.template.file_name
              ? this.files.publicUrl(by.tenantId, prep.template.header_file_id, 3 * 86400) : prep.template.header_media_url;
            if (!link) throw new MetaError('O modelo tem cabeçalho de mídia, mas o arquivo não está mais na biblioteca de mídia.');
            const kind = fmt.toLowerCase();
            components.push({ type: 'header', parameters: [{ type: kind, [kind]: { link, ...(fmt === 'DOCUMENT' ? { filename: prep.template.file_name ?? 'documento.pdf' } : {}) } }] });
          }
          if (params.length) components.push({ type: 'body', parameters: params.map((v) => ({ type: 'text', text: v })) });
          // Fluxo: cada resposta rápida leva o dado que volta no clique (para continuar a conversa certa).
          for (const b of extras.buttonPayloads ?? []) {
            components.push({ type: 'button', sub_type: 'quick_reply', index: String(b.index), parameters: [{ type: 'payload', payload: b.payload }] });
          }
          externalId = await this.meta.sendWhatsapp(phoneId, c.token, { to, type: 'template', template: {
            name: prep.template.name, language: { code: prep.template.language }, components,
          } });
        } else if (extras.mediaFileId && prep.library) {
          const t = prep.kind === 'image' || prep.kind === 'video' || prep.kind === 'audio' ? prep.kind : 'document';
          externalId = await this.meta.sendWhatsapp(phoneId, c.token, { to, type: t, [t]: {
            link: this.files.publicUrl(by.tenantId, extras.mediaFileId, 3 * 86400),
            ...(t !== 'audio' && text ? { caption: text } : {}), ...(t === 'document' ? { filename: prep.library.name } : {}) } });
        } else if (extras.replyButtons?.length) {
          // Mensagem interativa: até 3 botões de resposta; o clique volta com o id do botão.
          externalId = await this.meta.sendWhatsapp(phoneId, c.token, { to, type: 'interactive', interactive: {
            type: 'button', body: { text: text!.slice(0, 1024) },
            action: { buttons: extras.replyButtons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) },
          } });
        } else if (file) {
          const mediaId = await this.meta.uploadMedia(phoneId, c.token, { data: file.data, type: prep.contentType!, name: file.name });
          const t = prep.kind === 'image' || prep.kind === 'video' || prep.kind === 'audio' ? prep.kind : 'document';
          externalId = await this.meta.sendWhatsapp(phoneId, c.token, { to, type: t, [t]: {
            id: mediaId, ...(t !== 'audio' && text ? { caption: text } : {}), ...(t === 'document' ? { filename: file.name } : {}) } });
        } else {
          externalId = await this.meta.sendWhatsapp(phoneId, c.token, { to, type: 'text', text: { body: text!, preview_url: true } });
        }
      } else if (prep.account.kind === 'instagram') {
        const c = this.metaCreds(prep.account.id, prep.account.secret);
        const host = (prep.account.config.host as MetaHost) ?? 'instagram';
        if (prep.fileId) {
          // O Instagram busca o arquivo pelo link assinado (vale 1 hora).
          const type = igAttachmentType(prep.contentType!, !!input.voice)!;
          externalId = (await this.meta.igSendMessage(prep.account.external_id!, c.token, host, { id: prep.to },
            { attachment: { type, payload: { url: this.files.publicUrl(by.tenantId, prep.fileId, 3600) } } })).messageId;
          if (text?.trim()) await this.meta.igSend(prep.account.external_id!, c.token, host, prep.to, text);
        } else {
          externalId = await this.meta.igSend(prep.account.external_id!, c.token, host, prep.to, text!);
        }
      } else if (prep.channel === 'whatsapp') {
        const number = toEvolutionNumber(prep.to);
        if (file && input.voice) {
          externalId = await this.evo.sendAudio(prep.account.external_id!, number, file.data.toString('base64'));
        } else if (file) {
          externalId = await this.evo.sendMedia(prep.account.external_id!, number, {
            mediatype: prep.kind === 'image' || prep.kind === 'video' || prep.kind === 'audio' ? prep.kind : 'document',
            mimetype: prep.contentType!, base64: file.data.toString('base64'), fileName: file.name, caption: text ?? undefined,
          });
        } else {
          externalId = await this.evo.sendText(prep.account.external_id!, number, text!);
        }
      } else {
        const c = prep.account.config as { host: string; port: number; secure: boolean; user: string; fromName: string };
        externalId = await sendTenantMail({
          host: c.host, port: c.port, secure: c.secure, user: c.user, fromName: c.fromName, address: prep.account.address!,
          pass: this.openSecret(prep.account.id, prep.account.secret!),
        }, by.campaignId ? this.campaignMail(by.tenantId, prep.to, input.subject!.trim(), text ?? '') : {
          to: prep.to, subject: input.subject!.trim(), text: text ?? '', html: textToHtml(text ?? ''),
          attachments: file ? [{ filename: file.name, content: file.data, contentType: prep.contentType! }] : undefined,
        }, this.cfg.CHANNEL_ALLOW_PRIVATE_HOSTS);
      }
    } catch (err) {
      if (err instanceof EvolutionError || err instanceof SmtpError || err instanceof MetaError) error = err.message;
      else {
        this.log.error(`envio falhou: ${String(err)}`);
        error = 'Falha inesperada no envio.';
      }
    }

    // 3. Resultado no histórico.
    return this.db.app(ctx, async (q) => {
      const params = [prep.id, error ? 'failed' : 'sent', error, externalId];
      try {
        await q.query(
          `update messages set status = case when status = 'queued' then $2 else status end, error = $3,
                  external_id = coalesce(external_id, $4), sent_at = case when $3::text is null then coalesce(sent_at, now()) end
            where id = $1`, params);
      } catch (err) {
        // O eco do envio já chegou com esse identificador e ficou em outra linha: guarda o resultado sem ele.
        if (pgCode(err) !== '23505') throw err;
        await q.query(
          `update messages set status = case when status = 'queued' then $2 else status end, error = $3,
                  sent_at = case when $3::text is null then coalesce(sent_at, now()) end where id = $1`, params.slice(0, 3));
      }
      await q.query(
        `insert into timeline_entries (tenant_id, kind, actor_membership_id, contact_id, data) values (app.tenant_id(), $1, $2, $3, $4)`,
        [error ? 'message.failed' : 'message.sent', actor?.membershipId ?? by.sentBy ?? null, contactId,
          JSON.stringify({ messageId: prep.id, channel: prep.channel, ...(by.automationRuleId ? { automation: by.automationRuleId } : {}) })]);
      if (!error) await q.query('update contacts set last_activity_at = now() where id = $1', [contactId]);
      return this.row(q, prep.id);
    });
  }

  /** E-mail de campanha: rodapé e cabeçalho de descadastro (um clique). */
  private campaignMail(tenantId: string, to: string, subject: string, text: string) {
    const url = `${this.cfg.APP_URL.replace(/\/$/, '')}/api/v1/public/descadastrar/${this.unsubscribeToken(tenantId, 'email', to)}`;
    const foot = `\n\n—\nPara não receber mais estes e-mails: ${url}`;
    const html = `${textToHtml(text)}<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666;margin-top:24px">`
      + `Para não receber mais estes e-mails, <a href="${url}">clique aqui</a>.</p>`;
    return { to, subject, text: text + foot, html, headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
  }

  // ---- Recebimento (webhook da Evolution) ---------------------------------------------

  /** Contato pelo número (com e sem o nono dígito). */
  private async contactByPhone(q: Q, e164: string): Promise<string | null> {
    const r = await q.query<{ contact_id: string }>(
      `select p.contact_id from contact_phones p join contacts c on c.id = p.contact_id
        where p.e164 = any($1::text[]) and c.anonymized_at is null
        order by p.is_primary desc, c.created_at limit 1`, [phoneVariants(e164)]);
    return r.rows[0]?.contact_id ?? null;
  }

  async receiveWhatsapp(tenantId: string, accountId: string, ev: EvoMessage): Promise<'stored' | 'duplicate' | 'claimed'> {
    return this.db.app({ tenantId, userId: null }, async (q) => {
      // Eco de uma mensagem enviada pelo CRM que ainda não recebeu o identificador.
      if (ev.fromMe) {
        const claimed = await q.query(
          `update messages set external_id = $1, status = 'sent', sent_at = coalesce(sent_at, now())
            where id = (select id from messages
                         where channel_account_id = $2 and direction = 'out' and status = 'queued' and external_id is null
                           and remote = any($3::text[]) and created_at > now() - interval '5 minutes'
                           and ($4::text is null or body = $4)
                         order by created_at limit 1 for update skip locked)
              and not exists (select 1 from messages where channel_account_id = $2 and external_id = $1)
          returning id`, [ev.id, accountId, phoneVariants(ev.e164), ev.kind === 'text' ? ev.text : null]);
        if (claimed.rowCount) return 'claimed';
      }
      const known = (await q.query<{ id: string; contact_id: string; kind: string; body: string | null; file_id: string | null }>(
        'select id, contact_id, kind, body, file_id from messages where channel_account_id = $1 and external_id = $2', [accountId, ev.id])).rows[0];
      if (known) {
        // A mesma mensagem chegou de novo com o conteúdo (o WhatsApp manda primeiro um aviso vazio quando ainda está decifrando): completa.
        if (known.kind === 'other' && !known.body && !known.file_id && (ev.text || ev.kind !== 'other' || ev.media)) {
          await q.query('update messages set body = $2, kind = $3 where id = $1', [known.id, ev.text, ev.kind]);
          if (ev.media) {
            await this.attachMedia(q, tenantId, known.contact_id, known.id, Buffer.from(ev.media.base64, 'base64'), ev.media.mimetype, ev.media.fileName,
              `whatsapp-${ev.kind}`);
          }
        }
        return 'duplicate';
      }

      let contactId = await this.contactByPhone(q, ev.e164);
      let created = false;
      if (!contactId) {
        const name = (!ev.fromMe && ev.pushName ? ev.pushName : ev.e164).slice(0, 120);
        contactId = (await q.query<{ id: string }>('insert into contacts (tenant_id, first_name) values (app.tenant_id(), $1) returning id', [name])).rows[0]!.id;
        await q.query("insert into contact_phones (tenant_id, contact_id, e164, label, is_primary) values (app.tenant_id(), $1, $2, 'whatsapp', true)", [contactId, ev.e164]);
        await q.query(
          `insert into attribution_touches (tenant_id, contact_id, recorded_via, source, medium) values (app.tenant_id(), $1, 'channel', 'whatsapp', 'chat')`, [contactId]);
        await q.query(
          `insert into timeline_entries (tenant_id, kind, contact_id, data) values (app.tenant_id(), 'contact.created', $1, $2)`,
          [contactId, JSON.stringify({ via: 'whatsapp' })]);
        created = true;
      }
      const ins = await q.query<{ id: string }>(
        `insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, external_id, remote, body, kind,
                               created_at, sent_at)
         values (app.tenant_id(), $1, 'whatsapp', $2, $3, $4, $5, $6, $7, $8, $9, case when $2 = 'out' then $9::timestamptz end)
         on conflict (channel_account_id, external_id) where external_id is not null and channel_account_id is not null do nothing
         returning id`,
        [accountId, ev.fromMe ? 'out' : 'in', ev.fromMe ? 'sent' : 'received', contactId, ev.id, ev.e164, ev.text, ev.kind, ev.at]);
      const messageId = ins.rows[0]?.id;
      if (!messageId) return 'duplicate';

      if (ev.media) {
        await this.attachMedia(q, tenantId, contactId, messageId, Buffer.from(ev.media.base64, 'base64'), ev.media.mimetype, ev.media.fileName,
          `whatsapp-${ev.kind}`);
      }
      await q.query(
        `insert into timeline_entries (tenant_id, kind, contact_id, data) values (app.tenant_id(), $1, $2, $3)`,
        [ev.fromMe ? 'message.sent' : 'message.received', contactId, JSON.stringify({ messageId, channel: 'whatsapp', newContact: created })]);
      // "SAIR": o número não recebe mais campanhas nem automações.
      if (!ev.fromMe && ev.text && OPT_OUT.test(ev.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())) {
        await q.query(
          `insert into suppression_list (tenant_id, channel, value, reason) values (app.tenant_id(), 'whatsapp', $1, 'opt_out')
           on conflict (tenant_id, channel, value) do nothing`, [ev.e164]);
        await q.query(
          `insert into timeline_entries (tenant_id, kind, contact_id, data) values (app.tenant_id(), 'consent.opt_out', $1, $2)`,
          [contactId, JSON.stringify({ channel: 'whatsapp', via: 'reply' })]);
      }
      await q.query('update contacts set last_activity_at = now() where id = $1', [contactId]);
      return 'stored';
    });
  }

  /** Mensagem do Instagram (recebida ou eco do que a empresa mandou pelo app). Contato pelo IGSID. */
  async receiveInstagram(tenantId: string, accountId: string, ev: IgMessage, extra: {
    profile: { name?: string; username?: string } | null; media: { data: Buffer; mimetype: string | null } | null;
  }): Promise<'stored' | 'duplicate' | 'claimed'> {
    const igsid = ev.fromMe ? ev.recipient : ev.sender;
    return this.db.app({ tenantId, userId: null }, async (q) => {
      const known = await q.query('select 1 from messages where channel_account_id = $1 and external_id = $2', [accountId, ev.id]);
      if (known.rowCount) return 'duplicate';
      if (ev.fromMe) {
        const claimed = await q.query(
          `update messages set external_id = $1, status = 'sent', sent_at = coalesce(sent_at, now())
            where id = (select id from messages where channel_account_id = $2 and direction = 'out' and status in ('queued', 'sent') and external_id is null
                         and remote = $3 and created_at > now() - interval '5 minutes' order by created_at limit 1 for update skip locked)
          returning id`, [ev.id, accountId, igsid]);
        if (claimed.rowCount) return 'claimed';
      }
      let contactId = (await q.query<{ contact_id: string }>(
        `select h.contact_id from contact_handles h join contacts c on c.id = h.contact_id
          where h.kind = 'instagram' and h.value = $1 and c.anonymized_at is null`, [igsid])).rows[0]?.contact_id ?? null;
      let created = false;
      const username = extra.profile?.username && /^[A-Za-z0-9._]{1,60}$/.test(extra.profile.username) ? extra.profile.username : null;
      if (!contactId) {
        const real = extra.profile?.name?.trim() ? splitName(extra.profile.name) : null;
        const name = real?.first ?? (username ? `@${username}` : `Instagram ${igsid.slice(-6)}`).slice(0, 120);
        contactId = (await q.query<{ id: string }>('insert into contacts (tenant_id, first_name, last_name) values (app.tenant_id(), $1, $2) returning id',
          [name, real?.last ?? null])).rows[0]!.id;
        await q.query(
          `insert into contact_handles (tenant_id, contact_id, kind, value, username) values (app.tenant_id(), $1, 'instagram', $2, $3)
           on conflict (tenant_id, kind, value) do nothing`, [contactId, igsid, username]);
        await q.query(
          `insert into attribution_touches (tenant_id, contact_id, recorded_via, source, medium) values (app.tenant_id(), $1, 'channel', 'instagram', 'direct')`, [contactId]);
        await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, data) values (app.tenant_id(), 'contact.created', $1, $2)`,
          [contactId, JSON.stringify({ via: 'instagram' })]);
        created = true;
      } else if (username) {
        await q.query(`update contact_handles set username = $2 where kind = 'instagram' and value = $1 and username is distinct from $2`, [igsid, username]);
      }
      // Nome do perfil e e-mail/telefone que a pessoa escreveu completam o contato.
      await enrichContact(q, contactId, { name: extra.profile?.name ?? null, text: ev.fromMe ? null : ev.text });
      const ins = await q.query<{ id: string }>(
        `insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, external_id, remote, body, kind, created_at, sent_at, media_url)
         values (app.tenant_id(), $1, 'instagram', $2, $3, $4, $5, $6, $7, $8, $9, case when $2 = 'out' then $9::timestamptz end, $10)
         on conflict (channel_account_id, external_id) where external_id is not null and channel_account_id is not null do nothing
         returning id`,
        [accountId, ev.fromMe ? 'out' : 'in', ev.fromMe ? 'sent' : 'received', contactId, ev.id, igsid, ev.text, ev.kind, ev.at, igMediaUrl(ev.attachments[0]?.url)]);
      const messageId = ins.rows[0]?.id;
      if (!messageId) return 'duplicate';
      if (extra.media) await this.attachMedia(q, tenantId, contactId, messageId, extra.media.data, extra.media.mimetype, null, `instagram-${ev.kind}`, true);
      await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, data) values (app.tenant_id(), $1, $2, $3)`,
        [ev.fromMe ? 'message.sent' : 'message.received', contactId, JSON.stringify({ messageId, channel: 'instagram', newContact: created })]);
      await q.query('update contacts set last_activity_at = now() where id = $1', [contactId]);
      return 'stored';
    });
  }

  /** Guarda a mídia de uma mensagem recebida; tipo não aceito fica sem o arquivo. */
  // ---- Mídia que chegou sem o arquivo ----------------------------------------------

  /**
   * Busca na Evolution o arquivo de uma mensagem de mídia que ficou sem ele
   * (aviso sem o conteúdo ou tipo recusado antes). Devolve a mensagem atualizada.
   */
  async fetchMedia(actor: Actor, messageId: string) {
    const m = await this.db.app(tenantCtx(actor), async (q) => {
      const r = (await q.query<{ contact_id: string; kind: string; body: string | null; file_id: string | null; external_id: string | null; account_kind: string | null; instance: string | null; account_id: string | null; media_url: string | null; secret: Buffer | null; config: Record<string, unknown> | null }>(
        `select m.contact_id, m.kind, m.body, m.file_id, m.external_id, m.media_url, a.kind as account_kind, a.secret, a.config, a.external_id as instance, a.id as account_id
           from messages m left join channel_accounts a on a.id = m.channel_account_id where m.id = $1`, [messageId])).rows[0];
      if (!r) throw Problem.notFound('Mensagem não encontrada.');
      await this.records.assertAccess(q, actor, { kind: 'contact', id: r.contact_id }, false);
      return r;
    });
    // Mensagem que chegou sem conteúdo (tipo novo ou ainda cifrada): busca de novo na Evolution.
    if (!m.file_id && m.kind === 'other' && !m.body) {
      if (m.account_kind !== 'whatsapp_evolution' || !m.instance || !m.external_id || !m.account_id) {
        throw new Problem(409, 'O WhatsApp não mandou o conteúdo desta mensagem (tipo que a API não entrega). Veja no celular.', 'content-unavailable');
      }
      const raw = await this.evo.findMessage(m.instance, m.external_id).catch((err: Error) => {
        throw new Problem(409, `A Evolution não respondeu (${err.message.slice(0, 160)}).`, 'content-unavailable');
      });
      const ev = raw ? readEvolutionMessage(raw) : null;
      if (!ev || ev.type !== 'message' || (!ev.text && ev.kind === 'other')) {
        const t = ev && ev.type === 'message' && ev.msgType ? ` (tipo "${ev.msgType}")` : '';
        throw new Problem(409, `O WhatsApp não entregou o conteúdo desta mensagem${t}. Ela pode ter chegado cifrada ou ser de um tipo que só abre no celular.`, 'content-unavailable');
      }
      await this.db.app(tenantCtx(actor), (q) => q.query('update messages set body = $2, kind = $3 where id = $1', [messageId, ev.text, ev.kind]));
      if (MEDIA_KINDS.has(ev.kind)) await this.recoverMedia(actor.tenantId!, m.account_id, m.instance, m.external_id);
      return this.db.app(tenantCtx(actor), (q) => this.row(q, messageId));
    }
    if (!m.file_id) {
      if (!MEDIA_KINDS.has(m.kind)) throw Problem.badRequest('Esta mensagem não tem arquivo.');
      if (m.account_kind === 'instagram') {
        const max = this.inboundMax;
        const reasons: string[] = [];
        const tryUrl = async (u: string) => {
          const r = await this.meta.fetchMediaDetailed(u, null, max);
          if ('error' in r) { reasons.push(r.error); return null; }
          return r;
        };
        let media = m.media_url ? await tryUrl(m.media_url) : null;
        // Sem endereço guardado (mensagens antigas) ou link vencido: pede à Meta os anexos da mensagem.
        if (!media && m.external_id && m.account_id) {
          const { token } = this.metaCreds(m.account_id, m.secret);
          const urls = await this.meta.igMessageAttachments(m.external_id, token, (m.config?.host as MetaHost) ?? 'instagram')
            .catch((err: Error) => { reasons.push(`a Meta não mostrou os anexos (${err.message.slice(0, 160)})`); return [] as string[]; });
          for (const u of urls) {
            media = await tryUrl(u);
            if (media) {
              await this.db.app(tenantCtx(actor), (q) => q.query('update messages set media_url = $2 where id = $1', [messageId, u.length <= 4000 ? u : null]));
              break;
            }
          }
        }
        const failed = media ? await this.db.app(tenantCtx(actor), (q) =>
          this.attachMedia(q, actor.tenantId!, m.contact_id, messageId, media!.data, media!.mimetype, null, `instagram-${m.kind}`, true)) : null;
        if (!media || failed) {
          const why = [...new Set([...reasons, ...(failed ? [failed] : [])])].join('; ') || 'o Instagram não mandou o endereço do arquivo';
          throw new Problem(409, `Não foi possível abrir o arquivo: ${why}. Se continuar, peça para a pessoa mandar de novo.`, 'media-unavailable');
        }
        return this.db.app(tenantCtx(actor), (q) => this.row(q, messageId));
      }
      if (m.account_kind !== 'whatsapp_evolution' || !m.instance || !m.external_id || !m.account_id) {
        throw new Problem(409, 'O arquivo desta mensagem não está mais disponível.', 'media-unavailable');
      }
      const ok = await this.recoverMedia(actor.tenantId!, m.account_id, m.instance, m.external_id);
      if (!ok) throw new Problem(409, 'O WhatsApp não devolveu o arquivo desta mensagem. Ele pode ter expirado no celular.', 'media-unavailable');
    }
    return this.db.app(tenantCtx(actor), (q) => this.row(q, messageId));
  }

  /** Mensagem da Evolution que chegou vazia: tenta de novo pelo histórico da Evolution (sem pessoa; usado logo depois do aviso). */
  async reloadContent(tenantId: string, accountId: string, instance: string, externalId: string): Promise<boolean> {
    const raw = await this.evo.findMessage(instance, externalId).catch(() => null);
    const ev = raw ? readEvolutionMessage(raw) : null;
    if (!ev || ev.type !== 'message' || (!ev.text && ev.kind === 'other')) return false;
    const done = await this.db.app({ tenantId, userId: null }, async (q) => (await q.query(
      `update messages set body = $3, kind = $4 where channel_account_id = $1 and external_id = $2 and kind = 'other' and body is null and file_id is null`,
      [accountId, externalId, ev.text, ev.kind])).rowCount === 1);
    if (done && MEDIA_KINDS.has(ev.kind)) await this.recoverMedia(tenantId, accountId, instance, externalId);
    return done;
  }

  /** Guarda o arquivo de uma mensagem da Evolution que ainda está sem ele. Usado logo depois do aviso e sob demanda. */
  async recoverMedia(tenantId: string, accountId: string, instance: string, externalId: string): Promise<boolean> {
    let media: Awaited<ReturnType<Evolution['mediaOf']>>;
    try {
      media = await this.evo.mediaOf(instance, externalId);
    } catch (err) {
      this.log.warn(`mídia do WhatsApp não baixada: ${(err as Error).message}`);
      return false;
    }
    if (!media) return false;
    return this.db.app({ tenantId, userId: null }, async (q) => {
      const r = (await q.query<{ id: string; contact_id: string; kind: string; file_id: string | null }>(
        'select id, contact_id, kind, file_id from messages where channel_account_id = $1 and external_id = $2 for update', [accountId, externalId])).rows[0];
      if (!r) return false;
      if (r.file_id) return true;
      await this.attachMedia(q, tenantId, r.contact_id, r.id, Buffer.from(media.base64, 'base64'), media.mimetype, media.fileName, `whatsapp-${r.kind}`);
      return (await q.query('select 1 from messages where id = $1 and file_id is not null', [r.id])).rowCount === 1;
    });
  }

  /** Mídia recebida pode ser maior que o limite de envio (vídeos e reels): até 100 MB. */
  get inboundMax(): number {
    return Math.max(this.cfg.UPLOAD_MAX_MB, 100) * 1024 * 1024;
  }

  /** Guarda a mídia recebida na mensagem. Devolve nulo quando deu certo ou o motivo da recusa. */
  private async attachMedia(q: Q, tenantId: string, contactId: string, messageId: string, data: Buffer, mimetype: string | null, fileName: string | null, prefix: string, fixKind = false): Promise<string | null> {
    if (!data.length) return 'arquivo vazio';
    if (data.length > this.inboundMax) return `arquivo maior que ${Math.floor(this.inboundMax / 1048576)} MB`;
    const ext = (mimetype && EXT[mimetype.split(';')[0]!.trim()]) ?? 'bin';
    try {
      await q.query('savepoint midia');
      const fileId = await this.files.storeIn(q, { tenantId, membershipId: null } as unknown as Actor,
        { name: fileName ?? `${prefix}.${ext}`, data, purpose: 'message', ref: { kind: 'contact', id: contactId }, maxBytes: this.inboundMax });
      await q.query('update messages set file_id = $1 where id = $2', [fileId, messageId]);
      if (fixKind) {
        // Instagram: o tipo vem do nome do anexo; o arquivo diz o que ele é de verdade.
        const f = (await q.query<{ content_type: string; kind: string }>(
          'select f.content_type, m.kind from files f join messages m on m.file_id = f.id where m.id = $1', [messageId])).rows[0];
        if (f) await q.query('update messages set kind = $2 where id = $1 and kind <> $2', [messageId, kindFromContent(f.kind, f.content_type)]);
      }
      await q.query('release savepoint midia');
      return null;
    } catch (err) {
      await q.query('rollback to savepoint midia');
      const reason = err instanceof Problem ? (err.errors?.[0]?.message ?? err.title) : (err as Error).message;
      this.log.warn(`mídia não guardada: ${reason}`);
      return reason.replace(/\.$/, '');
    }
  }

  async updateStatus(tenantId: string, accountId: string, ev: EvoStatus, detail: string | null = null): Promise<boolean> {
    return this.db.app({ tenantId, userId: null }, async (q) => {
      const r = await q.query<{ id: string; status: string }>(
        "select id, status from messages where channel_account_id = $1 and external_id = $2 and direction = 'out' for update", [accountId, ev.id]);
      const m = r.rows[0];
      if (!m || !statusAdvances(m.status, ev.status)) return false;
      await q.query(
        `update messages set status = $2,
                delivered_at = case when $2 in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end,
                read_at = case when $2 = 'read' then coalesce(read_at, now()) else read_at end,
                error = case when $2 = 'failed' then coalesce($3, 'O WhatsApp não entregou a mensagem.') else error end
          where id = $1`, [m.id, ev.status, detail ? `O WhatsApp não entregou: ${detail}`.slice(0, 1000) : null]);
      return true;
    });
  }
}
