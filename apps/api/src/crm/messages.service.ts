import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { CONFIG, type Config } from '../config.js';
import { phoneVariants, statusAdvances, toEvolutionNumber, type EvoMessage, type EvoStatus } from '../domain/whatsapp.js';
import { SecretBox } from '../domain/secrets.js';
import { Problem } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Evolution, EvolutionError } from '../infra/evolution.js';
import { sendTenantMail, SmtpError, textToHtml } from '../infra/tenant-mail.js';
import { memberJson } from './fields.js';
import { FilesService } from './files.service.js';
import { RecordsService } from './records.service.js';

export type SendInput = { accountId: string; to?: string | null; text?: string | null; subject?: string | null };
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
  'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

@Injectable()
export class MessagesService {
  private readonly log = new Logger('mensagens');
  private readonly box: SecretBox;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(Evolution) private readonly evo: Evolution,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(RecordsService) private readonly records: RecordsService,
  ) {
    this.box = new SecretBox(cfg.masterKeys, cfg.currentKey);
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
  sendInConversation(actor: Actor, contactId: string, channel: 'whatsapp' | 'email', input: SendInput, file?: Upload) {
    return this.sendAs({ tenantId: actor.tenantId!, actor, automationRuleId: null, checked: true, channel }, contactId, input, file);
  }

  /** Envio de uma automação: sem pessoa, respeitando a lista de supressão. */
  sendByAutomation(tenantId: string, ruleId: string, contactId: string, input: SendInput) {
    return this.sendAs({ tenantId, actor: null, automationRuleId: ruleId }, contactId, input);
  }

  private async sendAs(
    by: {
      tenantId: string; actor: Actor | null; automationRuleId: string | null; checked?: boolean; channel?: 'whatsapp' | 'email';
      campaignId?: string;
    },
    contactId: string, input: SendInput, file?: Upload,
  ) {
    const actor = by.actor;
    const ctx = actor ? tenantCtx(actor) : { tenantId: by.tenantId, userId: null };
    const text = input.text?.trim() || null;
    if (!text && !file) throw Problem.badRequest('Mensagem vazia.', [{ field: 'text', message: 'Escreva a mensagem ou anexe um arquivo.' }]);

    // 1. Registra a mensagem como "na fila", com tudo conferido.
    const prep = await this.db.app(ctx, async (q) => {
      if (actor && !by.checked) await this.records.assertAccess(q, actor, { kind: 'contact', id: contactId }, false);
      const a = (await q.query<{ id: string; kind: string; status: string; external_id: string | null; config: Record<string, unknown>; secret: Buffer | null; address: string | null; name: string }>(
        'select id, kind, status, external_id, config, secret, address, name from channel_accounts where id = $1', [input.accountId])).rows[0];
      if (!a) throw Problem.badRequest('Conta inválida.', [{ field: 'accountId', message: 'Escolha um WhatsApp ou e-mail da empresa.' }]);
      const channel = a.kind === 'whatsapp_evolution' ? 'whatsapp' : 'email';
      if (by.channel && by.channel !== channel) {
        throw Problem.badRequest('Conta de outro canal.', [{ field: 'accountId', message: by.channel === 'email' ? 'Escolha uma conta de e-mail.' : 'Escolha um WhatsApp.' }]);
      }
      if (by.campaignId && channel === 'email' && a.status === 'error') {
        throw Problem.conflict(`A conta de e-mail "${a.name}" está com erro. Confira em Configurações › Canais.`);
      }
      if (channel === 'whatsapp' && a.status !== 'connected') {
        throw Problem.conflict(`O WhatsApp "${a.name}" não está conectado. Peça ao administrador para conectar em Configurações › Canais.`);
      }
      if (channel === 'email' && !input.subject?.trim()) {
        throw Problem.badRequest('Falta o assunto.', [{ field: 'subject', message: 'Escreva o assunto do e-mail.' }]);
      }
      const options = channel === 'whatsapp'
        ? (await q.query<{ v: string }>('select e164 as v from contact_phones where contact_id = $1 order by is_primary desc, created_at', [contactId])).rows.map((r) => r.v)
        : (await q.query<{ v: string }>('select email as v from contact_emails where contact_id = $1 order by is_primary desc, created_at', [contactId])).rows.map((r) => r.v);
      if (!options.length) {
        throw Problem.badRequest(channel === 'whatsapp' ? 'O contato não tem telefone.' : 'O contato não tem e-mail.',
          [{ field: 'to', message: channel === 'whatsapp' ? 'Cadastre um telefone no contato.' : 'Cadastre um e-mail no contato.' }]);
      }
      const to = input.to ? options.find((o) => o === input.to!.trim().toLowerCase() || o === input.to!.trim()) : options[0];
      if (!to) throw Problem.badRequest('Destino inválido.', [{ field: 'to', message: 'Escolha um telefone ou e-mail do contato.' }]);
      // Conversa individual, escrita por alguém da empresa: a lista de supressão vale para campanhas e automações.
      if (!actor) {
        const suppressed = await q.query('select 1 from suppression_list where channel = $1 and value = $2', [channel, to]);
        if (suppressed.rowCount) throw Problem.conflict('O contato pediu para não receber mensagens automáticas por este canal.');
      }

      let fileId: string | null = null;
      let contentType: string | null = null;
      if (file) {
        fileId = await this.files.storeIn(q, actor!, { name: file.name, data: file.data, purpose: 'message', ref: { kind: 'contact', id: contactId } });
        contentType = (await q.query<{ content_type: string }>('select content_type from files where id = $1', [fileId])).rows[0]!.content_type;
      }
      const kind = contentType ? kindOf(contentType) : 'text';
      const m = await q.query<{ id: string }>(
        `insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, remote, subject, body, kind, file_id, sent_by, automation_rule_id, campaign_id)
         values (app.tenant_id(), $1, $2, 'out', 'queued', $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [a.id, channel, contactId, to, channel === 'email' ? input.subject!.trim() : null, text, kind, fileId, actor?.membershipId ?? null, by.automationRuleId, by.campaignId ?? null]);
      return { id: m.rows[0]!.id, account: a, channel, to, kind, contentType };
    });

    // 2. Entrega pelo canal, fora da transação.
    let externalId: string | null = null;
    let error: string | null = null;
    try {
      if (prep.channel === 'whatsapp') {
        const number = toEvolutionNumber(prep.to);
        if (file) {
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
      if (err instanceof EvolutionError || err instanceof SmtpError) error = err.message;
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
        [error ? 'message.failed' : 'message.sent', actor?.membershipId ?? null, contactId,
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
      const known = await q.query('select 1 from messages where channel_account_id = $1 and external_id = $2', [accountId, ev.id]);
      if (known.rowCount) return 'duplicate';

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
        const data = Buffer.from(ev.media.base64, 'base64');
        if (data.length > 0 && data.length <= this.cfg.UPLOAD_MAX_MB * 1024 * 1024) {
          const ext = (ev.media.mimetype && EXT[ev.media.mimetype.split(';')[0]!.trim()]) ?? 'bin';
          const name = ev.media.fileName ?? `whatsapp-${ev.kind}.${ext}`;
          try {
            await q.query('savepoint midia');
            const fileId = await this.files.storeIn(q, { tenantId, membershipId: null } as unknown as Actor,
              { name, data, purpose: 'message', ref: { kind: 'contact', id: contactId } });
            await q.query('update messages set file_id = $1 where id = $2', [fileId, messageId]);
            await q.query('release savepoint midia');
          } catch (err) {
            // Tipo não aceito (ou falha ao gravar): a mensagem fica, sem o arquivo.
            await q.query('rollback to savepoint midia');
            this.log.warn(`mídia do WhatsApp não guardada: ${(err as Error).message}`);
          }
        }
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

  async updateStatus(tenantId: string, accountId: string, ev: EvoStatus): Promise<boolean> {
    return this.db.app({ tenantId, userId: null }, async (q) => {
      const r = await q.query<{ id: string; status: string }>(
        "select id, status from messages where channel_account_id = $1 and external_id = $2 and direction = 'out' for update", [accountId, ev.id]);
      const m = r.rows[0];
      if (!m || !statusAdvances(m.status, ev.status)) return false;
      await q.query(
        `update messages set status = $2,
                delivered_at = case when $2 in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end,
                read_at = case when $2 = 'read' then coalesce(read_at, now()) else read_at end,
                error = case when $2 = 'failed' then 'O WhatsApp não entregou a mensagem.' else error end
          where id = $1`, [m.id, ev.status]);
      return true;
    });
  }
}
