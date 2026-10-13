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
import { contactOwnExtra } from './contacts.service.js';
import { memberJson } from './fields.js';
import { FilesService } from './files.service.js';
import { RecordsService } from './records.service.js';
import { Params, reachOf, reachSql } from './sql.js';

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
  (select json_build_object('id', f.id, 'name', f.original_name, 'contentType', f.content_type, 'sizeBytes', f.size_bytes)
     from files f where f.id = m.file_id and f.deleted_at is null) as file`;

function kindOf(contentType: string): 'image' | 'audio' | 'video' | 'document' {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  return 'document';
}

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

  /** Conversas: contatos no alcance, pela mensagem mais recente. */
  async inbox(actor: Actor, f: { unread?: boolean; q?: string; page: number; pageSize: number }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const reach = reachSql(p, 'c', reachOf(actor, 'contacts:view'), contactOwnExtra);
      const conds = [reach, 'c.anonymized_at is null'];
      if (f.unread) conds.push('coalesce(u.n, 0) > 0');
      if (f.q) conds.push(`app.norm(c.name) like '%' || app.norm(${p.add(f.q)}) || '%'`);
      const limit = p.add(f.pageSize);
      const offset = p.add((f.page - 1) * f.pageSize);
      const r = await q.query(
        `with last as (
           select distinct on (m.contact_id) m.contact_id, m.id, m.channel, m.direction, m.status, m.kind, m.body, m.subject, m.created_at
             from messages m order by m.contact_id, m.created_at desc
         ), unseen as (
           select contact_id, count(*)::int as n from messages where direction = 'in' and seen_at is null group by contact_id
         )
         select c.id, c.name,
                (select p.e164 from contact_phones p where p.contact_id = c.id order by p.is_primary desc, p.created_at limit 1) as phone,
                (select e.email from contact_emails e where e.contact_id = c.id order by e.is_primary desc, e.created_at limit 1) as email,
                coalesce(u.n, 0) as unread,
                json_build_object('id', l.id, 'channel', l.channel, 'direction', l.direction, 'status', l.status, 'kind', l.kind,
                                  'body', left(l.body, 200), 'subject', l.subject, 'createdAt', l.created_at) as "last",
                count(*) over ()::int as total
           from last l join contacts c on c.id = l.contact_id left join unseen u on u.contact_id = c.id
          where ${conds.join(' and ')}
          order by l.created_at desc
          limit ${limit} offset ${offset}`, p.values);
      return {
        items: r.rows.map(({ total: _t, ...rest }) => rest),
        total: (r.rows[0] as { total?: number } | undefined)?.total ?? 0, page: f.page, pageSize: f.pageSize,
      };
    });
  }

  /** Contatos com mensagem recebida ainda não vista, no alcance (para o menu). */
  async unreadCount(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const reach = reachSql(p, 'c', reachOf(actor, 'contacts:view'), contactOwnExtra);
      const r = await q.query<{ n: number }>(
        `select count(distinct m.contact_id)::int as n from messages m join contacts c on c.id = m.contact_id
          where m.direction = 'in' and m.seen_at is null and ${reach}`, p.values);
      return { count: r.rows[0]!.n };
    });
  }

  // ---- Envio ------------------------------------------------------------------------

  async send(actor: Actor, contactId: string, input: SendInput, file?: Upload) {
    const text = input.text?.trim() || null;
    if (!text && !file) throw Problem.badRequest('Mensagem vazia.', [{ field: 'text', message: 'Escreva a mensagem ou anexe um arquivo.' }]);

    // 1. Registra a mensagem como "na fila", com tudo conferido.
    const prep = await this.db.app(tenantCtx(actor), async (q) => {
      await this.records.assertAccess(q, actor, { kind: 'contact', id: contactId }, false);
      const a = (await q.query<{ id: string; kind: string; status: string; external_id: string | null; config: Record<string, unknown>; secret: Buffer | null; address: string | null; name: string }>(
        'select id, kind, status, external_id, config, secret, address, name from channel_accounts where id = $1', [input.accountId])).rows[0];
      if (!a) throw Problem.badRequest('Conta inválida.', [{ field: 'accountId', message: 'Escolha um WhatsApp ou e-mail da empresa.' }]);
      const channel = a.kind === 'whatsapp_evolution' ? 'whatsapp' : 'email';
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

      let fileId: string | null = null;
      let contentType: string | null = null;
      if (file) {
        fileId = await this.files.storeIn(q, actor, { name: file.name, data: file.data, purpose: 'message', ref: { kind: 'contact', id: contactId } });
        contentType = (await q.query<{ content_type: string }>('select content_type from files where id = $1', [fileId])).rows[0]!.content_type;
      }
      const kind = contentType ? kindOf(contentType) : 'text';
      const m = await q.query<{ id: string }>(
        `insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, remote, subject, body, kind, file_id, sent_by)
         values (app.tenant_id(), $1, $2, 'out', 'queued', $3, $4, $5, $6, $7, $8, $9) returning id`,
        [a.id, channel, contactId, to, channel === 'email' ? input.subject!.trim() : null, text, kind, fileId, actor.membershipId]);
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
        }, {
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
    return this.db.app(tenantCtx(actor), async (q) => {
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
        [error ? 'message.failed' : 'message.sent', actor.membershipId, contactId, JSON.stringify({ messageId: prep.id, channel: prep.channel })]);
      if (!error) await q.query('update contacts set last_activity_at = now() where id = $1', [contactId]);
      return this.row(q, prep.id);
    });
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
