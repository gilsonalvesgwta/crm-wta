import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { readCloudWebhook, readInstagramWebhook, templateRequest, validSignature, waToE164, type TemplateInput } from '../domain/meta.js';
import { tokenHash } from '../domain/secrets.js';
import { Problem } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Meta, MetaError, type MetaHost } from '../infra/meta.js';
import { assertWithin } from './limits.js';
import { MessagesService } from './messages.service.js';

export type CloudInput = { name: string; phoneNumberId: string; wabaId: string; token?: string | null; appSecret?: string | null };
export type InstagramInput = { name: string; igUserId: string; host: MetaHost; token?: string | null; appSecret?: string | null };

type Account = { id: string; tenant_id?: string; kind: string; name: string; status: string; external_id: string | null; config: Record<string, unknown>; secret: Buffer | null };

const TEMPLATE_COLUMNS = `t.id, t.channel_account_id as "accountId", t.meta_id as "metaId", t.name, t.language, t.category, t.header, t.body, t.footer,
  t.buttons, t.examples, t.status, t.reason, t.updated_at as "updatedAt",
  (select a.name from channel_accounts a where a.id = t.channel_account_id) as "accountName"`;

function derive(cfg: Config, purpose: string, accountId: string, len = 43): string {
  return createHmac('sha256', cfg.masterKeys[cfg.currentKey]!).update(`${purpose}:${accountId}`).digest('base64url').slice(0, len);
}

/** Endereço e token de verificação que a empresa cola no app da Meta (sempre os mesmos para a conta). */
export function metaWebhook(cfg: Config, accountId: string) {
  const base = cfg.EVOLUTION_WEBHOOK_BASE ?? cfg.APP_URL.replace(/\/+$/, '');
  return { url: `${base}/api/v1/webhooks/meta/${derive(cfg, 'meta-hook', accountId)}`, verifyToken: derive(cfg, 'meta-verify', accountId, 32) };
}

function problemFrom(err: unknown): Problem {
  if (err instanceof MetaError) return new Problem(502, err.message, 'meta-error');
  return err as Problem;
}

/**
 * Canais da Meta: WhatsApp pela API oficial (Cloud API) e Instagram. Cada
 * empresa usa o próprio app da Meta: token permanente e segredo do app ficam
 * cifrados; os avisos chegam num endereço próprio de cada conta e são
 * conferidos pela assinatura.
 */
@Injectable()
export class MetaService {
  private readonly log = new Logger('meta');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(Meta) private readonly meta: Meta,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  private derive(purpose: string, accountId: string, len = 43): string {
    return derive(this.cfg, purpose, accountId, len);
  }

  webhook(accountId: string) {
    return metaWebhook(this.cfg, accountId);
  }

  private async account(q: Q, id: string, kind?: string): Promise<Account> {
    const r = await q.query<Account>('select id, kind, name, status, external_id, config, secret from channel_accounts where id = $1', [id]);
    const a = r.rows[0];
    if (!a || (kind && a.kind !== kind)) throw Problem.notFound('Conta não encontrada.');
    return a;
  }

  private seal(id: string, cur: Buffer | null, token?: string | null, appSecret?: string | null): Buffer {
    const old = cur ? this.messages.metaCreds(id, cur) : { token: '', appSecret: '' };
    const next = { token: token || old.token, appSecret: appSecret || old.appSecret };
    if (!next.token) throw Problem.badRequest('Falta o token.', [{ field: 'token', message: 'Cole o token de acesso permanente.' }]);
    if (!next.appSecret) throw Problem.badRequest('Falta o segredo do app.', [{ field: 'appSecret', message: 'Cole a chave secreta do app (Configurações › Básico, na Meta).' }]);
    return this.messages.sealSecret(id, JSON.stringify(next));
  }

  // ---- Contas ---------------------------------------------------------------------------

  async saveCloud(actor: Actor, id: string | null, b: CloudInput) {
    const saved = await this.db.app(tenantCtx(actor), async (q) => {
      const accId = id ?? (await q.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;
      const cur = id ? await this.account(q, id, 'whatsapp_cloud') : null;
      if (!id) {
        const n = (await q.query<{ n: number }>(`select count(*)::int as n from channel_accounts where kind in ('whatsapp_evolution', 'whatsapp_cloud')`)).rows[0]!.n;
        await assertWithin(q, 'max_whatsapp', n + 1);
      }
      const secret = this.seal(accId, cur?.secret ?? null, b.token, b.appSecret);
      const hash = tokenHash(this.derive('meta-hook', accId));
      try {
        await q.query('savepoint conta');
        if (cur) {
          await q.query(`update channel_accounts set name = $2, external_id = $3, config = $4, secret = $5, status = 'pending', webhook_token_hash = $6 where id = $1`,
            [accId, b.name, b.phoneNumberId, JSON.stringify({ ...cur.config, wabaId: b.wabaId }), secret, hash]);
        } else {
          await q.query(
            `insert into channel_accounts (id, tenant_id, kind, name, status, external_id, config, secret, webhook_token_hash, created_by)
             values ($1, app.tenant_id(), 'whatsapp_cloud', $2, 'pending', $3, $4, $5, $6, $7)`,
            [accId, b.name, b.phoneNumberId, JSON.stringify({ wabaId: b.wabaId }), secret, hash, actor.membershipId]);
          await audit(q, actor, 'channel.created', 'channel_account', accId, { kind: 'whatsapp_cloud', phoneNumberId: b.phoneNumberId });
        }
      } catch (err) {
        await q.query('rollback to savepoint conta');
        if (pgCode(err) === '23505') throw Problem.badRequest('Número já cadastrado.', [{ field: 'phoneNumberId', message: 'Este número já está ligado a uma conta do CRM.' }]);
        throw err;
      }
      return accId;
    });
    return this.test(actor, saved);
  }

  async saveInstagram(actor: Actor, id: string | null, b: InstagramInput) {
    const saved = await this.db.app(tenantCtx(actor), async (q) => {
      const accId = id ?? (await q.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;
      const cur = id ? await this.account(q, id, 'instagram') : null;
      const secret = this.seal(accId, cur?.secret ?? null, b.token, b.appSecret);
      const hash = tokenHash(this.derive('meta-hook', accId));
      try {
        await q.query('savepoint conta');
        if (cur) {
          await q.query(`update channel_accounts set name = $2, external_id = $3, config = $4, secret = $5, status = 'pending', webhook_token_hash = $6 where id = $1`,
            [accId, b.name, b.igUserId, JSON.stringify({ ...cur.config, host: b.host }), secret, hash]);
        } else {
          await q.query(
            `insert into channel_accounts (id, tenant_id, kind, name, status, external_id, config, secret, webhook_token_hash, created_by)
             values ($1, app.tenant_id(), 'instagram', $2, 'pending', $3, $4, $5, $6, $7)`,
            [accId, b.name, b.igUserId, JSON.stringify({ host: b.host }), secret, hash, actor.membershipId]);
          await audit(q, actor, 'channel.created', 'channel_account', accId, { kind: 'instagram', igUserId: b.igUserId });
        }
      } catch (err) {
        await q.query('rollback to savepoint conta');
        if (pgCode(err) === '23505') throw Problem.badRequest('Conta já cadastrada.', [{ field: 'igUserId', message: 'Este Instagram já está ligado a uma conta do CRM.' }]);
        throw err;
      }
      return accId;
    });
    return this.test(actor, saved);
  }

  /** Confere o token na Meta e guarda o número (ou o @ do Instagram). */
  async test(actor: Actor, id: string) {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, id));
    if (a.kind !== 'whatsapp_cloud' && a.kind !== 'instagram') throw Problem.notFound('Conta não encontrada.');
    let error: string | null = null;
    let address: string | null = null;
    const config: Record<string, unknown> = { ...a.config };
    try {
      const c = this.messages.metaCreds(a.id, a.secret);
      if (a.kind === 'whatsapp_cloud') {
        const info = await this.meta.phoneInfo(a.external_id!, c.token);
        address = info.display_phone_number ? waToE164(info.display_phone_number) : null;
        config.verifiedName = info.verified_name ?? null;
        config.quality = info.quality_rating ?? null;
      } else {
        const info = await this.meta.igInfo(a.external_id!, c.token, (a.config.host as MetaHost) ?? 'instagram');
        address = info.username ? `@${info.username}` : null;
      }
    } catch (err) {
      error = err instanceof MetaError ? err.message : 'Falha inesperada ao falar com a Meta.';
      if (!(err instanceof MetaError)) this.log.error(`teste da conta ${id}: ${String(err)}`);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      await q.query(
        `update channel_accounts set status = $2, last_error = $3, address = coalesce($4, address), config = $5,
                connected_at = case when $2 = 'connected' then coalesce(connected_at, now()) else connected_at end where id = $1`,
        [id, error ? 'error' : 'connected', error, address, JSON.stringify(config)]);
      return { id, status: error ? 'error' : 'connected', lastError: error, address, webhook: this.webhook(id) };
    });
  }

  // ---- Avisos (webhook) -----------------------------------------------------------------

  private async byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Problem.notFound();
    const acc = await this.db.auth(async (q) => (await q.query<{ tenant_id: string; account_id: string; kind: string; external_id: string }>(
      'select tenant_id, account_id, kind, external_id from app.channel_by_webhook($1)', [tokenHash(token)])).rows[0]);
    if (!acc || (acc.kind !== 'whatsapp_cloud' && acc.kind !== 'instagram')) throw Problem.notFound();
    return acc;
  }

  /** Verificação do endereço pela Meta (GET com hub.challenge). */
  async verify(token: string, mode: string | undefined, verifyToken: string | undefined, challenge: string | undefined): Promise<string> {
    const acc = await this.byToken(token);
    if (mode !== 'subscribe' || verifyToken !== this.derive('meta-verify', acc.account_id, 32) || !challenge || challenge.length > 200) {
      throw Problem.forbidden('Token de verificação não confere.');
    }
    return challenge;
  }

  async handle(token: string, raw: Buffer | undefined, signature: string | undefined, body: unknown): Promise<{ handled: number }> {
    const acc = await this.byToken(token);
    const ctx = { tenantId: acc.tenant_id, userId: null };
    const a = await this.db.app(ctx, (q) => this.account(q, acc.account_id));
    const creds = this.messages.metaCreds(a.id, a.secret);
    if (!raw || !validSignature(raw, signature, creds.appSecret)) throw Problem.forbidden('Assinatura inválida.');
    let handled = 0;
    if (a.kind === 'whatsapp_cloud') {
      for (const ev of readCloudWebhook(body)) {
        try {
          if (ev.type === 'template') {
            const r = await this.db.app(ctx, (q) => q.query(
              `update whatsapp_templates set status = $3, reason = $4, meta_id = coalesce(meta_id, $1)
                where channel_account_id = $5 and (meta_id = $1 or (name = $2 and ($6::text is null or language = $6)))`,
              [ev.metaId, ev.name, ev.status, ev.reason, a.id, ev.language]));
            handled += r.rowCount ?? 0;
            continue;
          }
          if (ev.phoneNumberId !== a.external_id) continue;
          if (ev.type === 'status') {
            if (await this.messages.updateStatus(acc.tenant_id, a.id, { type: 'status', id: ev.id, status: ev.status }, ev.error)) handled++;
            continue;
          }
          const e164 = waToE164(ev.from);
          if (!e164) continue;
          let media = null;
          if (ev.media) {
            const got = await this.meta.downloadMedia(ev.media.id, creds.token, 'facebook', this.cfg.UPLOAD_MAX_MB * 1024 * 1024).catch(() => null);
            if (got) media = { base64: got.data.toString('base64'), mimetype: got.mimetype ?? ev.media.mimetype, fileName: ev.media.fileName };
          }
          const r = await this.messages.receiveWhatsapp(acc.tenant_id, a.id, {
            type: 'message', id: ev.id, fromMe: false, e164, pushName: ev.name, kind: ev.kind as never, text: ev.text, at: ev.at, media,
          });
          if (r !== 'duplicate') handled++;
        } catch (err) {
          this.log.error(`aviso do WhatsApp oficial não processado: ${String(err)}`);
        }
      }
    } else {
      const host = (a.config.host as MetaHost) ?? 'instagram';
      for (const ev of readInstagramWebhook(body)) {
        try {
          if (ev.igUserId !== a.external_id) continue;
          const igsid = ev.fromMe ? ev.recipient : ev.sender;
          const profile = ev.fromMe ? null : await this.meta.igProfile(igsid, creds.token, host).catch(() => null);
          const att = ev.attachments[0];
          const media = att ? await this.meta.fetchMedia(att.url, null, this.cfg.UPLOAD_MAX_MB * 1024 * 1024).catch(() => null) : null;
          if ((await this.messages.receiveInstagram(acc.tenant_id, a.id, ev, { profile, media })) !== 'duplicate') handled++;
        } catch (err) {
          this.log.error(`aviso do Instagram não processado: ${String(err)}`);
        }
      }
    }
    return { handled };
  }

  // ---- Modelos de mensagem (WhatsApp oficial) ----------------------------------------------

  async templates(actor: Actor, f: { accountId?: string; approvedOnly?: boolean }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query(
        `select ${TEMPLATE_COLUMNS} from whatsapp_templates t
          where ($1::uuid is null or t.channel_account_id = $1) and (not $2 or t.status = 'APPROVED') and t.status <> 'DELETED'
          order by t.name, t.language`, [f.accountId ?? null, !!f.approvedOnly]);
      return { items: r.rows };
    });
  }

  async createTemplate(actor: Actor, t: TemplateInput) {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, t.accountId, 'whatsapp_cloud'));
    const wabaId = a.config.wabaId as string | undefined;
    if (!wabaId) throw Problem.badRequest('Falta o id da conta do WhatsApp Business.', [{ field: 'accountId', message: 'Edite a conta e informe o WABA ID.' }]);
    const exists = await this.db.app(tenantCtx(actor), (q) => q.query(
      `select 1 from whatsapp_templates where channel_account_id = $1 and name = $2 and language = $3 and status <> 'DELETED'`, [a.id, t.name, t.language]));
    if (exists.rowCount) throw Problem.badRequest('Nome já usado.', [{ field: 'name', message: 'Já existe um modelo com esse nome neste idioma.' }]);
    let res: { id?: string; status?: string; category?: string };
    try {
      res = await this.meta.createTemplate(wabaId, this.messages.metaCreds(a.id, a.secret).token, templateRequest(t));
    } catch (err) {
      throw problemFrom(err);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const status = ['APPROVED', 'REJECTED', 'PENDING', 'PAUSED'].includes(res.status ?? '') ? res.status! : 'PENDING';
      const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(res.category ?? '') ? res.category! : t.category;
      const r = await q.query<{ id: string }>(
        `insert into whatsapp_templates (tenant_id, channel_account_id, meta_id, name, language, category, header, body, footer, buttons, examples, status, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (channel_account_id, name, language) do update set meta_id = excluded.meta_id, category = excluded.category, header = excluded.header,
           body = excluded.body, footer = excluded.footer, buttons = excluded.buttons, examples = excluded.examples, status = excluded.status, reason = null
         returning id`,
        [a.id, res.id ?? null, t.name, t.language, category, t.header, t.body, t.footer,
          JSON.stringify(t.buttons.map((text) => ({ type: 'QUICK_REPLY', text }))), JSON.stringify(t.examples), status, actor.membershipId]);
      await audit(q, actor, 'whatsapp_template.created', 'whatsapp_template', r.rows[0]!.id, { name: t.name });
      return (await q.query(`select ${TEMPLATE_COLUMNS} from whatsapp_templates t where t.id = $1`, [r.rows[0]!.id])).rows[0];
    });
  }

  /** Traz da Meta os modelos e o estado de aprovação de cada um. */
  async syncTemplates(actor: Actor, accountId: string) {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, accountId, 'whatsapp_cloud'));
    const wabaId = a.config.wabaId as string | undefined;
    if (!wabaId) throw Problem.badRequest('Falta o id da conta do WhatsApp Business.', [{ field: 'accountId', message: 'Edite a conta e informe o WABA ID.' }]);
    let list: Awaited<ReturnType<Meta['listTemplates']>>;
    try {
      list = await this.meta.listTemplates(wabaId, this.messages.metaCreds(a.id, a.secret).token);
    } catch (err) {
      throw problemFrom(err);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      let n = 0;
      for (const t of list.data ?? []) {
        if (!/^[a-z0-9_]{1,512}$/.test(t.name) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language)) continue;
        const comps = (t.components ?? []) as { type?: string; format?: string; text?: string; buttons?: { type: string; text: string }[]; example?: { body_text?: string[][] } }[];
        const body = comps.find((c) => c.type === 'BODY')?.text;
        if (!body) continue;
        const header = comps.find((c) => c.type === 'HEADER' && c.format === 'TEXT')?.text ?? null;
        const footer = comps.find((c) => c.type === 'FOOTER')?.text ?? null;
        const buttons = comps.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
        const examples = comps.find((c) => c.type === 'BODY')?.example?.body_text?.[0] ?? [];
        const status = ['APPROVED', 'REJECTED', 'PENDING', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'LIMIT_EXCEEDED'].includes(t.status) ? t.status : 'PENDING';
        const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(t.category) ? t.category : 'UTILITY';
        await q.query(
          `insert into whatsapp_templates (tenant_id, channel_account_id, meta_id, name, language, category, header, body, footer, buttons, examples, status, reason)
           values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           on conflict (channel_account_id, name, language) do update set meta_id = excluded.meta_id, category = excluded.category, header = excluded.header,
             body = excluded.body, footer = excluded.footer, buttons = excluded.buttons, examples = excluded.examples, status = excluded.status, reason = excluded.reason`,
          [a.id, /^[0-9]+$/.test(t.id) ? t.id : null, t.name, t.language, category, header?.slice(0, 60) ?? null, body.slice(0, 1024), footer?.slice(0, 60) ?? null,
            JSON.stringify(buttons.slice(0, 10).map((b) => ({ type: b.type, text: b.text }))), JSON.stringify(examples.slice(0, 20)), status,
            t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason.slice(0, 1000) : null]);
        n++;
      }
      return { synced: n };
    });
  }

  async removeTemplate(actor: Actor, id: string) {
    const t = await this.db.app(tenantCtx(actor), async (q) => (await q.query<{ name: string; meta_id: string | null; channel_account_id: string }>(
      'select name, meta_id, channel_account_id from whatsapp_templates where id = $1', [id])).rows[0]);
    if (!t) throw Problem.notFound('Modelo não encontrado.');
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, t.channel_account_id, 'whatsapp_cloud'));
    try {
      if (a.config.wabaId) await this.meta.deleteTemplate(a.config.wabaId as string, this.messages.metaCreds(a.id, a.secret).token, t.name, t.meta_id);
    } catch (err) {
      // Já apagado na Meta: segue e apaga aqui.
      if (!(err instanceof MetaError && err.httpStatus === 404)) throw problemFrom(err);
    }
    await this.db.app(tenantCtx(actor), async (q) => {
      await q.query('delete from whatsapp_templates where id = $1', [id]);
      await audit(q, actor, 'whatsapp_template.deleted', 'whatsapp_template', id, { name: t.name });
    });
  }
}
