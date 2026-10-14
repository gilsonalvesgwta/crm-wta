import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { newToken, tokenHash } from '../domain/secrets.js';
import { jidToE164, readEvolutionEvent } from '../domain/whatsapp.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { Evolution, EvolutionError } from '../infra/evolution.js';
import { sendTenantMail, SmtpError, textToHtml, verifyTenantSmtp } from '../infra/tenant-mail.js';
import { assertWithin, tenantLimits } from './limits.js';
import { MessagesService } from './messages.service.js';
import { metaWebhook } from './meta.service.js';

export type EmailAccountInput = {
  name: string; host: string; port: number; secure: boolean; user: string; pass?: string | null; fromName: string; address: string;
};

type AccountRow = {
  id: string; kind: 'whatsapp_evolution' | 'whatsapp_cloud' | 'email_smtp' | 'instagram'; name: string; status: string; external_id: string | null;
  address: string | null; config: Record<string, unknown>; secret: Buffer | null; last_error: string | null;
  connected_at: Date | null; created_at: Date;
};

const ACCOUNT_COLUMNS = 'id, kind, name, status, external_id, address, config, secret, last_error, connected_at, created_at';

function view(a: AccountRow) {
  const c = a.config as { host?: string; port?: number; secure?: boolean; user?: string; fromName?: string };
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    status: a.status,
    address: a.address,
    instance: a.external_id,
    lastError: a.last_error,
    connectedAt: a.connected_at,
    createdAt: a.created_at,
    ...(a.kind === 'email_smtp'
      ? { smtp: { host: c.host ?? '', port: c.port ?? 587, secure: !!c.secure, user: c.user ?? '', fromName: c.fromName ?? '', hasPassword: !!a.secret } }
      : {}),
    ...(a.kind === 'whatsapp_cloud'
      ? { cloud: { phoneNumberId: a.external_id, wabaId: (a.config.wabaId as string) ?? '', verifiedName: (a.config.verifiedName as string) ?? null, quality: (a.config.quality as string) ?? null, hasToken: !!a.secret } }
      : {}),
    ...(a.kind === 'instagram'
      ? { instagram: { igUserId: a.external_id, host: (a.config.host as string) ?? 'instagram', hasToken: !!a.secret } }
      : {}),
  };
}

function evoMessage(err: unknown): string {
  return err instanceof EvolutionError ? err.message : 'Falha ao falar com a Evolution API.';
}

@Injectable()
export class ChannelsService {
  private readonly log = new Logger('canais');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(Evolution) private readonly evo: Evolution,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  private webhookUrl(token: string): string {
    return `${this.cfg.EVOLUTION_WEBHOOK_BASE ?? this.cfg.APP_URL.replace(/\/+$/, '')}/api/v1/webhooks/evolution/${token}`;
  }

  private async account(q: Q, id: string): Promise<AccountRow> {
    const r = await q.query<AccountRow>(`select ${ACCOUNT_COLUMNS} from channel_accounts where id = $1`, [id]);
    if (!r.rows[0]) throw Problem.notFound('Conta não encontrada.');
    return r.rows[0];
  }

  private async count(q: Q, kind: AccountRow['kind']): Promise<number> {
    return (await q.query<{ n: number }>('select count(*)::int as n from channel_accounts where kind = $1', [kind])).rows[0]!.n;
  }

  // ---- Lista -----------------------------------------------------------------------

  async list(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<AccountRow>(`select ${ACCOUNT_COLUMNS} from channel_accounts order by kind desc, created_at`);
      const limits = await tenantLimits(q);
      return {
        evolutionConfigured: this.evo.configured,
        accounts: r.rows.map((a) => ({ ...view(a), ...(a.kind === 'whatsapp_cloud' || a.kind === 'instagram' ? { webhook: metaWebhook(this.cfg, a.id) } : {}) })),
        limits: {
          whatsapp: { used: r.rows.filter((a) => a.kind === 'whatsapp_evolution' || a.kind === 'whatsapp_cloud').length, max: limits?.max_whatsapp ?? null },
          email: { used: r.rows.filter((a) => a.kind === 'email_smtp').length, max: limits?.max_email_accounts ?? null },
        },
      };
    });
  }

  /** Contas que podem enviar agora (para quem atende). */
  async available(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query(
        `select id, kind, name, address, status from channel_accounts
          where (kind in ('whatsapp_evolution', 'whatsapp_cloud', 'instagram') and status = 'connected') or (kind = 'email_smtp' and status <> 'error')
          order by kind desc, created_at`);
      return { items: r.rows };
    });
  }

  // ---- WhatsApp ---------------------------------------------------------------------

  async createWhatsapp(actor: Actor, name: string) {
    this.evo.assertConfigured();
    const token = newToken();
    const created = await this.db.app(tenantCtx(actor), async (q) => {
      await assertWithin(q, 'max_whatsapp', (await this.count(q, 'whatsapp_evolution')) + (await this.count(q, 'whatsapp_cloud')) + 1);
      const slug = (await q.query<{ slug: string }>('select slug from tenants where id = app.tenant_id()')).rows[0]!.slug
        .replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'empresa';
      const instance = `crmwta-${slug}-${randomBytes(4).toString('hex')}`;
      const r = await q.query<AccountRow>(
        `insert into channel_accounts (tenant_id, kind, name, status, external_id, webhook_token_hash, created_by)
         values (app.tenant_id(), 'whatsapp_evolution', $1, 'connecting', $2, $3, $4) returning ${ACCOUNT_COLUMNS}`,
        [name, instance, tokenHash(token), actor.membershipId]);
      await audit(q, actor, 'channel.created', 'channel_account', r.rows[0]!.id, { kind: 'whatsapp', instance });
      return r.rows[0]!;
    });
    try {
      const qr = await this.evo.createInstance(created.external_id!, this.webhookUrl(token));
      return { account: view(created), qr: qr.qr, pairingCode: qr.pairingCode };
    } catch (err) {
      // Sem a instância na Evolution, a conta não fica pela metade.
      await this.db.app(tenantCtx(actor), (q) => q.query('delete from channel_accounts where id = $1', [created.id]));
      throw new Problem(502, `A Evolution API recusou a criação: ${evoMessage(err)}`, 'evolution-error');
    }
  }

  /** Consulta a Evolution e grava o estado. Conectado: guarda o número. */
  private async syncState(actor: Actor, a: AccountRow): Promise<{ state: string; account: ReturnType<typeof view> }> {
    let state = 'unknown';
    let error: string | null = null;
    let owner: string | null = null;
    try {
      state = await this.evo.state(a.external_id!);
      if (state === 'open') owner = await this.evo.owner(a.external_id!).catch(() => null);
    } catch (err) {
      error = evoMessage(err);
    }
    const status = error ? 'error' : state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected';
    const row = await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<AccountRow>(
        `update channel_accounts set status = $2, last_error = $3,
                address = coalesce($4, address),
                connected_at = case when $2 = 'connected' then coalesce(connected_at, now()) else connected_at end
          where id = $1 returning ${ACCOUNT_COLUMNS}`, [a.id, status, error, jidToE164(owner)]);
      return r.rows[0]!;
    });
    return { state, account: view(row) };
  }

  async qr(actor: Actor, id: string) {
    this.evo.assertConfigured();
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, id));
    if (a.kind !== 'whatsapp_evolution') throw Problem.notFound('Conta não encontrada.');
    const s = await this.syncState(actor, a);
    if (s.state === 'open') return { account: s.account, qr: null, pairingCode: null };
    try {
      const c = await this.evo.connect(a.external_id!);
      return { account: s.account, qr: c.qr, pairingCode: c.pairingCode };
    } catch (err) {
      throw new Problem(502, `A Evolution API não gerou o QR code: ${evoMessage(err)}`, 'evolution-error');
    }
  }

  async refresh(actor: Actor, id: string) {
    this.evo.assertConfigured();
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, id));
    if (a.kind !== 'whatsapp_evolution') throw Problem.notFound('Conta não encontrada.');
    return (await this.syncState(actor, a)).account;
  }

  /** Reconecta o webhook da instância (endereço novo, token novo). */
  async rewire(actor: Actor, id: string) {
    this.evo.assertConfigured();
    const token = newToken();
    const a = await this.db.app(tenantCtx(actor), async (q) => {
      const row = await this.account(q, id);
      if (row.kind !== 'whatsapp_evolution') throw Problem.notFound('Conta não encontrada.');
      await q.query('update channel_accounts set webhook_token_hash = $2 where id = $1', [id, tokenHash(token)]);
      return row;
    });
    try {
      await this.evo.setWebhook(a.external_id!, this.webhookUrl(token));
    } catch (err) {
      throw new Problem(502, `A Evolution API recusou o webhook: ${evoMessage(err)}`, 'evolution-error');
    }
    return this.refresh(actor, id);
  }

  async disconnect(actor: Actor, id: string) {
    this.evo.assertConfigured();
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, id));
    if (a.kind !== 'whatsapp_evolution') throw Problem.notFound('Conta não encontrada.');
    try {
      await this.evo.logout(a.external_id!);
    } catch (err) {
      if (!(err instanceof EvolutionError) || ![400, 404].includes(err.status)) {
        throw new Problem(502, `A Evolution API não desconectou: ${evoMessage(err)}`, 'evolution-error');
      }
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<AccountRow>(
        `update channel_accounts set status = 'disconnected', last_error = null where id = $1 returning ${ACCOUNT_COLUMNS}`, [id]);
      await audit(q, actor, 'channel.disconnected', 'channel_account', id);
      return view(r.rows[0]!);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, id));
    if (a.kind === 'whatsapp_evolution' && this.evo.configured) {
      try {
        await this.evo.remove(a.external_id!);
      } catch (err) {
        if (!(err instanceof EvolutionError) || ![400, 404].includes(err.status)) {
          throw new Problem(502, `A Evolution API não removeu a instância: ${evoMessage(err)}`, 'evolution-error');
        }
      }
    }
    await this.db.app(tenantCtx(actor), async (q) => {
      await q.query('delete from channel_accounts where id = $1', [id]);
      await audit(q, actor, 'channel.removed', 'channel_account', id, { kind: a.kind, name: a.name });
    });
  }

  // ---- E-mail ------------------------------------------------------------------------

  async saveEmail(actor: Actor, id: string | null, input: EmailAccountInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const accountId = id ?? randomUUID();
      const config = { host: input.host, port: input.port, secure: input.secure, user: input.user, fromName: input.fromName };
      let row: AccountRow;
      if (!id) {
        if (!input.pass) throw Problem.badRequest('Falta a senha.', [{ field: 'pass', message: 'Informe a senha da caixa de e-mail.' }]);
        await assertWithin(q, 'max_email_accounts', (await this.count(q, 'email_smtp')) + 1);
        row = (await q.query<AccountRow>(
          `insert into channel_accounts (id, tenant_id, kind, name, status, address, config, secret, created_by)
           values ($1, app.tenant_id(), 'email_smtp', $2, 'pending', $3, $4, $5, $6) returning ${ACCOUNT_COLUMNS}`,
          [accountId, input.name, input.address, JSON.stringify(config), this.messages.sealSecret(accountId, input.pass), actor.membershipId])).rows[0]!;
        await audit(q, actor, 'channel.created', 'channel_account', accountId, { kind: 'email', address: input.address });
      } else {
        const cur = await this.account(q, id);
        if (cur.kind !== 'email_smtp') throw Problem.notFound('Conta não encontrada.');
        row = (await q.query<AccountRow>(
          `update channel_accounts set name = $2, address = $3, config = $4, secret = coalesce($5, secret), status = 'pending', last_error = null
            where id = $1 returning ${ACCOUNT_COLUMNS}`,
          [id, input.name, input.address, JSON.stringify(config), input.pass ? this.messages.sealSecret(id, input.pass) : null])).rows[0]!;
        await audit(q, actor, 'channel.updated', 'channel_account', id, { kind: 'email', passwordChanged: !!input.pass });
      }
      return view(row);
    });
  }

  /** Confere a conexão e manda um e-mail de teste para quem pediu. */
  async testEmail(actor: Actor, id: string) {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, id));
    if (a.kind !== 'email_smtp' || !a.secret) throw Problem.notFound('Conta não encontrada.');
    const c = a.config as { host: string; port: number; secure: boolean; user: string; fromName: string };
    const acc = { ...c, address: a.address!, pass: this.messages.openSecret(a.id, a.secret) };
    let error: string | null = null;
    try {
      await verifyTenantSmtp(acc, this.cfg.CHANNEL_ALLOW_PRIVATE_HOSTS);
      await sendTenantMail(acc, {
        to: actor.email,
        subject: `Teste do e-mail ${a.address} no ${this.cfg.APP_NAME}`,
        text: `Este é um e-mail de teste. A caixa ${a.address} está pronta para enviar mensagens pelo CRM.`,
        html: textToHtml(`Este é um e-mail de teste. A caixa ${a.address} está pronta para enviar mensagens pelo CRM.`),
      }, this.cfg.CHANNEL_ALLOW_PRIVATE_HOSTS);
    } catch (err) {
      error = err instanceof SmtpError ? err.message : 'Falha inesperada no teste.';
      if (!(err instanceof SmtpError)) this.log.error(`teste de e-mail: ${String(err)}`);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<AccountRow>(
        `update channel_accounts set status = $2, last_error = $3,
                connected_at = case when $2 = 'connected' then coalesce(connected_at, now()) else connected_at end
          where id = $1 returning ${ACCOUNT_COLUMNS}`, [id, error ? 'error' : 'connected', error]);
      return { account: view(r.rows[0]!), sentTo: error ? null : actor.email };
    });
  }

  // ---- Webhook da Evolution -------------------------------------------------------------

  async handleEvolution(token: string, body: unknown): Promise<{ handled: number }> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw Problem.notFound();
    const acc = await this.db.auth(async (q) => (await q.query<{ tenant_id: string; account_id: string; kind: string; external_id: string }>(
      'select tenant_id, account_id, kind, external_id from app.channel_by_webhook($1)', [tokenHash(token)])).rows[0]);
    if (!acc || acc.kind !== 'whatsapp_evolution') throw Problem.notFound();
    const read = readEvolutionEvent(body);
    // Aviso de outra instância com o mesmo token: ignorado.
    if (read.instance && read.instance !== acc.external_id) return { handled: 0 };
    let handled = 0;
    for (const ev of read.events) {
      try {
        if (ev.type === 'message') {
          if ((await this.messages.receiveWhatsapp(acc.tenant_id, acc.account_id, ev)) !== 'duplicate') handled++;
        } else if (ev.type === 'status') {
          if (await this.messages.updateStatus(acc.tenant_id, acc.account_id, ev)) handled++;
        } else if (ev.type === 'connection') {
          const status = ev.state === 'open' ? 'connected' : ev.state === 'connecting' ? 'connecting' : 'disconnected';
          await this.db.app({ tenantId: acc.tenant_id, userId: null }, (q) => q.query(
            `update channel_accounts set status = $2, address = coalesce($3, address), last_error = null,
                    connected_at = case when $2 = 'connected' then now() else connected_at end
              where id = $1`, [acc.account_id, status, ev.e164]));
          handled++;
        }
      } catch (err) {
        this.log.error(`aviso da Evolution não processado (${ev.type}): ${String(err)}`);
      }
    }
    return { handled };
  }
}
