import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { SecretBox } from '../domain/secrets.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { Meta, MetaError } from '../infra/meta.js';
import { memberJson } from './fields.js';

export type SpendInput = {
  platform: 'meta' | 'google' | 'tiktok' | 'other'; description?: string | null;
  firstDay: string; lastDay: string; amountCents: number;
};

const SPEND_COLUMNS = `
  s.id, s.platform, s.description, to_char(s.first_day, 'YYYY-MM-DD') as "firstDay", to_char(s.last_day, 'YYYY-MM-DD') as "lastDay",
  s.amount_cents::text as "amountCents", s.created_at as "createdAt",
  (select json_build_object('id', a.id, 'name', a.name) from ad_accounts a where a.id = s.ad_account_id) as account,
  ${memberJson('s.created_by')} as "createdBy"`;

const ACCOUNT_COLUMNS = `
  a.id, a.platform, a.external_id as "externalId", a.name, a.currency, a.status, a.last_error as "lastError",
  a.last_sync_at as "lastSyncAt", a.created_at as "createdAt"`;

/** Intervalo entre importações automáticas do gasto. */
const SYNC_EVERY = '6 hours';

/**
 * Investimento em anúncios: lançamentos manuais (qualquer plataforma) e
 * importação automática do gasto diário de contas da Meta Ads.
 * Ver: KPIs com a empresa toda ("reports:view" da empresa). Lançar e ligar
 * contas: "reports:export".
 */
@Injectable()
export class AdsService {
  private readonly log = new Logger('anuncios');
  private readonly box: SecretBox;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) cfg: Config,
    @Inject(Meta) private readonly meta: Meta,
  ) {
    this.box = new SecretBox(cfg.masterKeys, cfg.currentKey);
  }

  static assertCompanyView(actor: Actor): void {
    if (actor.permissions.get('reports:view') !== 'tenant') {
      throw Problem.forbidden('Os KPIs mostram a empresa toda: precisa ver relatórios da empresa inteira.');
    }
  }

  // ---- Lançamentos -----------------------------------------------------------------

  /** Lançamentos que tocam o período (datas AAAA-MM-DD). */
  async list(actor: Actor, from: string, to: string) {
    AdsService.assertCompanyView(actor);
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(
      `select ${SPEND_COLUMNS} from ad_spend s where s.first_day <= $2::date and s.last_day >= $1::date
        order by s.ad_account_id is not null, s.first_day desc, s.created_at desc limit 500`, [from, to])).rows
      .map((r) => ({ ...r, amountCents: Number(r.amountCents) })));
  }

  async create(actor: Actor, b: SpendInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ id: string }>(
        `insert into ad_spend (tenant_id, platform, description, first_day, last_day, amount_cents, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6) returning id`,
        [b.platform, b.description?.trim() || null, b.firstDay, b.lastDay, b.amountCents, actor.membershipId]);
      await audit(q, actor, 'ad_spend.create', 'ad_spend', r.rows[0]!.id, { platform: b.platform, amountCents: b.amountCents, firstDay: b.firstDay, lastDay: b.lastDay });
      return this.one(q, r.rows[0]!.id);
    });
  }

  async update(actor: Actor, id: string, b: SpendInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.manual(q, id);
      await q.query(
        `update ad_spend set platform = $2, description = $3, first_day = $4, last_day = $5, amount_cents = $6 where id = $1`,
        [id, b.platform, b.description?.trim() || null, b.firstDay, b.lastDay, b.amountCents]);
      await audit(q, actor, 'ad_spend.update', 'ad_spend', id, { platform: b.platform, amountCents: b.amountCents, firstDay: b.firstDay, lastDay: b.lastDay });
      return this.one(q, id);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      await this.manual(q, id);
      await q.query('delete from ad_spend where id = $1', [id]);
      await audit(q, actor, 'ad_spend.delete', 'ad_spend', id, {});
    });
  }

  private async manual(q: Q, id: string): Promise<void> {
    const r = (await q.query<{ ad_account_id: string | null }>('select ad_account_id from ad_spend where id = $1 for update', [id])).rows[0];
    if (!r) throw Problem.notFound('Lançamento não encontrado.');
    if (r.ad_account_id) throw new Problem(409, 'Este gasto vem da importação automática da Meta e não pode ser mudado aqui.', 'imported');
  }

  private async one(q: Q, id: string) {
    const r = (await q.query(`select ${SPEND_COLUMNS} from ad_spend s where s.id = $1`, [id])).rows[0]!;
    return { ...r, amountCents: Number(r.amountCents) };
  }

  // ---- Contas da Meta Ads ------------------------------------------------------------

  async accounts(actor: Actor) {
    AdsService.assertCompanyView(actor);
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(`select ${ACCOUNT_COLUMNS} from ad_accounts a order by a.created_at`)).rows);
  }

  /** Liga uma conta de anúncios da Meta: confere o token, guarda cifrado e importa os últimos 90 dias. */
  async connectMeta(actor: Actor, input: { accountId: string; token: string }) {
    const accountId = input.accountId.trim().replace(/^act_/i, '');
    if (!/^[0-9]{5,25}$/.test(accountId)) {
      throw Problem.badRequest('Confira o id da conta.', [{ field: 'accountId', message: 'Use o número da conta de anúncios (ex.: act_1234567890 ou 1234567890).' }]);
    }
    let info: Awaited<ReturnType<Meta['adAccount']>>;
    try {
      info = await this.meta.adAccount(accountId, input.token.trim());
    } catch (err) {
      const msg = err instanceof MetaError ? err.message : 'Não foi possível falar com a Meta.';
      throw Problem.badRequest('A Meta não aceitou a conta ou o token.', [{ field: 'token', message: msg }]);
    }
    const id = await this.db.app(tenantCtx(actor), async (q) => {
      const dup = await q.query("select 1 from ad_accounts where platform = 'meta' and external_id = $1", [accountId]);
      if (dup.rowCount) throw Problem.badRequest('Conta já ligada.', [{ field: 'accountId', message: 'Esta conta de anúncios já está ligada.' }]);
      const r = await q.query<{ id: string }>(
        `insert into ad_accounts (tenant_id, platform, external_id, name, currency, secret, created_by)
         values (app.tenant_id(), 'meta', $1, $2, $3, '\\x00', $4) returning id`,
        [accountId, (info.name ?? `Conta ${accountId}`).slice(0, 200), info.currency && /^[A-Z]{3}$/.test(info.currency) ? info.currency : null, actor.membershipId]);
      const newId = r.rows[0]!.id;
      await q.query('update ad_accounts set secret = $2 where id = $1', [newId, this.seal(newId, input.token.trim())]);
      await audit(q, actor, 'ad_account.connect', 'ad_account', newId, { platform: 'meta', externalId: accountId });
      return newId;
    });
    await this.sync(actor.tenantId!, id);
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(`select ${ACCOUNT_COLUMNS} from ad_accounts a where a.id = $1`, [id])).rows[0]);
  }

  async syncNow(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      if (!(await q.query('select 1 from ad_accounts where id = $1', [id])).rowCount) throw Problem.notFound('Conta não encontrada.');
    });
    await this.sync(actor.tenantId!, id);
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(`select ${ACCOUNT_COLUMNS} from ad_accounts a where a.id = $1`, [id])).rows[0]);
  }

  /** Desliga a conta. O gasto importado dela sai junto. */
  async disconnect(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query('delete from ad_accounts where id = $1', [id]);
      if (!r.rowCount) throw Problem.notFound('Conta não encontrada.');
      await audit(q, actor, 'ad_account.disconnect', 'ad_account', id, {});
    });
  }

  /** Importação automática: contas vencidas, uma rodada do despachante. */
  async dispatch(): Promise<number> {
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; account_id: string }>('select tenant_id, account_id from app.ad_sync_due(10)')).rows);
    for (const d of due) await this.sync(d.tenant_id, d.account_id);
    return due.length;
  }

  /**
   * Importa o gasto diário: na primeira vez, 90 dias; depois, os últimos 7
   * (a Meta ainda ajusta os dias recentes). Os dias importados são trocados.
   */
  private async sync(tenantId: string, accountId: string): Promise<void> {
    const ctx = { tenantId, userId: null };
    const a = await this.db.app(ctx, async (q) => (await q.query<{ id: string; external_id: string; secret: Buffer; last_sync_at: Date | null; tz: string }>(
      `select a.id, a.external_id, a.secret, a.last_sync_at, t.timezone as tz from ad_accounts a join tenants t on t.id = a.tenant_id where a.id = $1`,
      [accountId])).rows[0]);
    if (!a) return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: a.tz }).format(new Date());
    const since = new Intl.DateTimeFormat('en-CA', { timeZone: a.tz }).format(new Date(Date.now() - (a.last_sync_at ? 7 : 90) * 86_400_000));
    try {
      const days = await this.meta.adSpendByDay(a.external_id, this.open(a.id, a.secret), since, today);
      await this.db.app(ctx, async (q) => {
        await q.query('delete from ad_spend where ad_account_id = $1 and first_day between $2::date and $3::date', [a.id, since, today]);
        for (const d of days) {
          if (d.spend <= 0) continue;
          await q.query(
            `insert into ad_spend (tenant_id, platform, ad_account_id, first_day, last_day, amount_cents)
             values (app.tenant_id(), 'meta', $1, $2, $2, $3)
             on conflict (ad_account_id, first_day) where ad_account_id is not null do update set amount_cents = excluded.amount_cents`,
            [a.id, d.day, Math.round(d.spend * 100)]);
        }
        await q.query(
          `update ad_accounts set status = 'connected', last_error = null, last_sync_at = now(), sync_after = now() + interval '${SYNC_EVERY}' where id = $1`, [a.id]);
      });
    } catch (err) {
      const msg = err instanceof MetaError ? err.message : 'Falha ao importar o gasto da Meta.';
      this.log.warn(`importação de anúncios (${a.id}): ${msg}`);
      await this.db.app(ctx, (q) => q.query(
        `update ad_accounts set status = 'error', last_error = $2, sync_after = now() + interval '1 hour' where id = $1`, [a.id, msg.slice(0, 1000)]));
    }
  }

  private seal(id: string, token: string): Buffer {
    return this.box.seal(Buffer.from(token, 'utf8'), `ads:${id}`);
  }

  private open(id: string, sealed: Buffer): string {
    return this.box.open(sealed, `ads:${id}`).toString('utf8');
  }
}
