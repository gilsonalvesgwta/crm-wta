import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Problem } from '../http/problem.js';
import type { Actor } from '../access/actor.js';
import { AuthService } from '../auth/auth.service.js';
import { CONFIG, type Config } from '../config.js';
import { seedCrmDefaults, seedRoleTemplates } from '../platform/seed.js';
import { Storage } from '../infra/storage.js';
import { fingerprint, greennAction, parsePeriodEnd, readGreennEvent, secretMatches, type GreennEvent } from '../domain/greenn.js';
import type { PlanLimits } from '../domain/plans.js';
import { audit } from './audit.js';
import { createHash } from 'node:crypto';

type TenantRow = { id: string; name: string; slug: string; status: string; created_at: Date };

export type TenantEdit = {
  name?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  document?: string | null;
  notes?: string | null;
};

export type SubscriptionEdit = {
  planId: string | null;
  status: 'trial' | 'active' | 'past_due' | 'canceled' | 'expired' | 'inactive';
  currentPeriodEnd: string | null;
  notes?: string | null;
};

export type PlanInput = {
  name?: string;
  description?: string | null;
  priceCents?: number;
  currency?: string;
  billingPeriod?: 'monthly' | 'quarterly' | 'yearly' | 'one_time';
  durationDays?: number;
  limits?: PlanLimits;
  active?: boolean;
  position?: number;
};

/** Ator dos avisos automáticos (Greenn): sem pessoa. */
const SYSTEM = { userId: null, tenantId: null, name: 'Sistema' } as unknown as Actor;

function slugify(s: string): string {
  const base = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'empresa';
}

/**
 * Administração da plataforma. Roda como crm_platform, que vê só empresas,
 * planos, assinaturas e avisos de pagamento. Para preparar ou registrar algo
 * dentro de uma empresa, a transação troca para crm_app no contexto dela: a
 * plataforma não ganha leitura dos dados de clientes.
 */
@Injectable()
export class PlatformService {
  private readonly log = new Logger('plataforma');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(Storage) private readonly storage: Storage,
  ) {}

  private async asTenant(q: Q, tenantId: string, userId: string | null) {
    await q.query('set local role crm_app');
    await q.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenantId, userId ?? '']);
  }

  private async asPlatform(q: Q, userId: string | null) {
    await q.query('set local role crm_platform');
    await q.query("select set_config('app.tenant_id', '', true), set_config('app.user_id', $1, true)", [userId ?? '']);
  }

  /** Auditoria dentro da empresa, voltando depois ao papel da plataforma. */
  private async tenantAudit(q: Q, actor: Actor, tenantId: string, action: string, detail: Record<string, unknown> = {}, system = false) {
    await this.asTenant(q, tenantId, actor.userId);
    await audit(q, actor, action, 'tenant', tenantId, detail, { tenantId, actorType: system ? 'system' : 'platform' });
    await this.asPlatform(q, actor.userId);
  }

  // ---- Empresas -------------------------------------------------------------

  private async rows(q: Q, where = 'true', params: unknown[] = []) {
    const r = await q.query(
      `select t.id, t.name, t.slug, t.status, t.created_at as "createdAt", t.contact_name as "contactName",
              t.contact_email as "contactEmail", t.phone, t.document, t.notes,
              (select json_build_object('planId', s.plan_id, 'planName', p.name, 'status', s.status,
                       'currentPeriodEnd', s.current_period_end, 'source', s.source, 'customerEmail', s.customer_email,
                       'startedAt', s.started_at, 'canceledAt', s.canceled_at, 'notes', s.notes)
                 from tenant_subscriptions s left join plans p on p.id = s.plan_id where s.tenant_id = t.id) as subscription,
              (select json_build_object('domain', d.domain, 'dnsOk', d.dns_ok, 'routingOk', d.routing_ok, 'verifiedAt', d.verified_at)
                 from tenant_domains d where d.tenant_id = t.id and d.kind = 'custom') as domain
         from tenants t where ${where} order by t.name`, params);
    return r.rows as Record<string, unknown>[];
  }

  async list(actor: Actor) {
    return this.db.platform(actor.userId, (q) => this.rows(q));
  }

  /** Cria a empresa, os perfis padrão, o funil inicial e o convite do administrador. */
  private async createIn(q: Q, actor: Actor, input: { name: string; slug: string; adminEmail: string; contactName?: string | null }, system = false) {
    let tenant: TenantRow;
    try {
      const r = await q.query<TenantRow>(
        `insert into tenants (name, slug, contact_email, contact_name) values ($1, $2, $3, $4)
         returning id, name, slug, status, created_at`, [input.name, input.slug, input.adminEmail, input.contactName ?? null]);
      tenant = r.rows[0]!;
    } catch (e) {
      if (pgCode(e) === '23505') throw Problem.conflict('Já existe uma empresa com esse identificador.');
      throw e;
    }
    await this.asTenant(q, tenant.id, actor.userId);
    const roles = await seedRoleTemplates(q, tenant.id);
    await seedCrmDefaults(q, tenant.id);
    await q.query('insert into tenant_branding (tenant_id, theme) values ($1, $2)', [tenant.id, JSON.stringify({})]);
    const inv = await this.auth.createInvitation(q, tenant.id, input.adminEmail, roles.get('admin')!, null);
    await audit(q, actor, 'tenant.created', 'tenant', tenant.id, { name: input.name, slug: input.slug, adminEmail: input.adminEmail },
      { tenantId: tenant.id, actorType: system ? 'system' : 'platform' });
    await this.asPlatform(q, actor.userId);
    return { tenant, token: inv.token };
  }

  async create(actor: Actor, input: { name: string; slug: string; adminEmail: string }) {
    const out = await this.db.platform(actor.userId, (q) => this.createIn(q, actor, input));
    await this.auth.sendInvitation(input.adminEmail, out.tenant.name, actor.name, out.token);
    return { id: out.tenant.id, name: out.tenant.name, slug: out.tenant.slug, status: out.tenant.status, createdAt: out.tenant.created_at };
  }

  async get(actor: Actor, id: string) {
    return this.db.platform(actor.userId, async (q) => {
      const r = await this.rows(q, 't.id = $1', [id]);
      if (!r[0]) throw Problem.notFound('Empresa não encontrada.');
      return r[0];
    });
  }

  async update(actor: Actor, id: string, input: TenantEdit) {
    return this.db.platform(actor.userId, async (q) => {
      const p: unknown[] = [id];
      const sets: string[] = [];
      const put = (col: string, v: unknown) => { if (v !== undefined) { p.push(v); sets.push(`${col} = $${p.length}`); } };
      put('name', input.name);
      put('contact_name', input.contactName);
      put('contact_email', input.contactEmail);
      put('phone', input.phone);
      put('document', input.document);
      put('notes', input.notes);
      if (sets.length) {
        const r = await q.query(`update tenants set ${sets.join(', ')} where id = $1`, p);
        if (!r.rowCount) throw Problem.notFound('Empresa não encontrada.');
      }
      await this.tenantAudit(q, actor, id, 'tenant.platform_updated', { fields: Object.keys(input) });
      return (await this.rows(q, 't.id = $1', [id]))[0];
    });
  }

  async setStatus(actor: Actor, id: string, status: 'active' | 'suspended' | 'archived') {
    return this.db.platform(actor.userId, async (q) => {
      const r = await q.query<TenantRow>('update tenants set status = $1 where id = $2 returning id', [status, id]);
      if (!r.rows[0]) throw Problem.notFound('Empresa não encontrada.');
      await this.tenantAudit(q, actor, id, `tenant.${status === 'active' ? 'activated' : status}`);
      return (await this.rows(q, 't.id = $1', [id]))[0];
    });
  }

  /** Convida (de novo) o administrador da empresa, no e-mail informado ou no de contato. */
  async inviteAdmin(actor: Actor, id: string, email?: string) {
    const out = await this.db.platform(actor.userId, async (q) => {
      const t = await q.query<{ name: string; contact_email: string | null }>('select name, contact_email from tenants where id = $1', [id]);
      const row = t.rows[0];
      if (!row) throw Problem.notFound('Empresa não encontrada.');
      const to = email ?? row.contact_email;
      if (!to) throw Problem.badRequest('Informe o e-mail.', [{ field: 'email', message: 'Informe o e-mail do administrador.' }]);
      if (email) await q.query('update tenants set contact_email = $2 where id = $1', [id, email]);
      await this.asTenant(q, id, actor.userId);
      const role = await q.query<{ id: string }>("select id from roles where key = 'admin'");
      await q.query('update invitations set revoked_at = now() where email = $1 and accepted_at is null and revoked_at is null', [to]);
      const inv = await this.auth.createInvitation(q, id, to, role.rows[0]!.id, null);
      await audit(q, actor, 'invitation.created', 'invitation', inv.id, { email: to, by: 'platform' }, { tenantId: id, actorType: 'platform' });
      await this.asPlatform(q, actor.userId);
      return { to, name: row.name, token: inv.token };
    });
    await this.auth.sendInvitation(out.to, out.name, actor.name, out.token);
    return { email: out.to };
  }

  /**
   * Exclui a empresa e tudo o que é dela (contatos, negócios, arquivos,
   * usuários vinculados a ela). Exige confirmar digitando o identificador.
   */
  async remove(actor: Actor, id: string, confirmSlug: string) {
    const slug = await this.db.platform(actor.userId, async (q) => {
      const t = await q.query<{ slug: string }>('select slug from tenants where id = $1 for update', [id]);
      const row = t.rows[0];
      if (!row) throw Problem.notFound('Empresa não encontrada.');
      if (row.slug !== confirmSlug) {
        throw Problem.badRequest('Confirmação não confere.', [{ field: 'confirm', message: `Digite ${row.slug} para confirmar.` }]);
      }
      if (row.slug === 'wta') throw Problem.conflict('A empresa da WTA não pode ser excluída.');
      await q.query('delete from tenants where id = $1', [id]);
      return row.slug;
    });
    await this.storage.removeTenant(id).catch((err) => this.log.warn(`arquivos da empresa ${id} não apagados: ${String(err)}`));
    this.log.log(`empresa ${slug} (${id}) excluída por ${actor.email}`);
  }

  // ---- Planos ----------------------------------------------------------------

  async plans(actor: Actor) {
    return this.db.platform(actor.userId, (q) => this.plansIn(q));
  }

  private async plansIn(q: Q, id?: string): Promise<Record<string, unknown>[]> {
    return (await q.query(
        `select p.id, p.name, p.description, p.price_cents as "priceCents", p.currency, p.billing_period as "billingPeriod",
                p.duration_days as "durationDays", p.limits, p.active, p.position,
                (select count(*)::int from tenant_subscriptions s where s.plan_id = p.id) as "tenantCount",
                coalesce((select json_agg(json_build_object('id', o.id, 'externalProduct', o.external_product, 'label', o.label,
                                   'durationDays', o.duration_days) order by o.created_at)
                            from plan_offers o where o.plan_id = p.id), '[]') as offers
           from plans p where ($1::uuid is null or p.id = $1) order by p.active desc, p.position, lower(p.name)`, [id ?? null])).rows;
  }

  async savePlan(actor: Actor, id: string | null, input: PlanInput) {
    return this.db.platform(actor.userId, async (q) => {
      try {
        if (!id) {
          const r = await q.query<{ id: string }>(
            `insert into plans (name, description, price_cents, currency, billing_period, duration_days, limits, active, position)
             values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, true), coalesce($9, (select coalesce(max(position) + 1, 0) from plans)))
             returning id`,
            [input.name, input.description ?? null, input.priceCents ?? 0, input.currency ?? 'BRL', input.billingPeriod ?? 'monthly',
              input.durationDays ?? 30, JSON.stringify(input.limits ?? {}), input.active ?? null, input.position ?? null]);
          id = r.rows[0]!.id;
        } else {
          const r = await q.query(
            `update plans set name = coalesce($2, name), description = case when $3::boolean then $4 else description end,
                    price_cents = coalesce($5, price_cents), currency = coalesce($6, currency), billing_period = coalesce($7, billing_period),
                    duration_days = coalesce($8, duration_days), limits = coalesce($9::jsonb, limits), active = coalesce($10, active),
                    position = coalesce($11, position)
              where id = $1`,
            [id, input.name ?? null, input.description !== undefined, input.description ?? null, input.priceCents ?? null,
              input.currency ?? null, input.billingPeriod ?? null, input.durationDays ?? null,
              input.limits ? JSON.stringify(input.limits) : null, input.active ?? null, input.position ?? null]);
          if (!r.rowCount) throw Problem.notFound('Plano não encontrado.');
        }
      } catch (e) {
        if (pgCode(e) === '23505') throw Problem.conflict('Já existe um plano com esse nome.');
        throw e;
      }
      return (await this.plansIn(q, id))[0];
    });
  }

  async deletePlan(actor: Actor, id: string) {
    await this.db.platform(actor.userId, async (q) => {
      const used = await q.query<{ n: number }>('select count(*)::int as n from tenant_subscriptions where plan_id = $1', [id]);
      if (used.rows[0]!.n > 0) throw Problem.conflict('Há empresas neste plano. Desative o plano em vez de excluir.');
      const r = await q.query('delete from plans where id = $1', [id]);
      if (!r.rowCount) throw Problem.notFound('Plano não encontrado.');
    });
  }

  async saveOffer(actor: Actor, planId: string, input: { externalProduct: string; label?: string | null; durationDays?: number | null }) {
    return this.db.platform(actor.userId, async (q) => {
      try {
        const r = await q.query(
          `insert into plan_offers (plan_id, external_product, label, duration_days) values ($1, $2, $3, $4)
           returning id, external_product as "externalProduct", label, duration_days as "durationDays"`,
          [planId, input.externalProduct, input.label ?? null, input.durationDays ?? null]);
        return r.rows[0];
      } catch (e) {
        if (pgCode(e) === '23505') throw Problem.conflict('Esse produto da Greenn já está ligado a um plano.');
        if (pgCode(e) === '23503') throw Problem.notFound('Plano não encontrado.');
        throw e;
      }
    });
  }

  async deleteOffer(actor: Actor, offerId: string) {
    await this.db.platform(actor.userId, async (q) => {
      const r = await q.query('delete from plan_offers where id = $1', [offerId]);
      if (!r.rowCount) throw Problem.notFound('Oferta não encontrada.');
    });
  }

  // ---- Assinatura de uma empresa ---------------------------------------------------

  async setSubscription(actor: Actor, tenantId: string, input: SubscriptionEdit) {
    return this.db.platform(actor.userId, async (q) => {
      const t = await q.query('select 1 from tenants where id = $1', [tenantId]);
      if (!t.rowCount) throw Problem.notFound('Empresa não encontrada.');
      if (input.planId) {
        const p = await q.query('select 1 from plans where id = $1', [input.planId]);
        if (!p.rowCount) throw Problem.badRequest('Plano inválido.', [{ field: 'planId', message: 'Escolha um plano da lista.' }]);
      }
      await q.query(
        `insert into tenant_subscriptions (tenant_id, plan_id, status, current_period_end, notes, source)
         values ($1, $2, $3, $4, $5, 'manual')
         on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = excluded.status,
           current_period_end = excluded.current_period_end, notes = coalesce(excluded.notes, tenant_subscriptions.notes),
           canceled_at = case when excluded.status in ('canceled', 'inactive') then coalesce(tenant_subscriptions.canceled_at, now()) else null end`,
        [tenantId, input.planId, input.status, input.currentPeriodEnd, input.notes ?? null]);
      // Assinatura em dia reativa a empresa; inativa suspende.
      const active = ['trial', 'active', 'past_due'].includes(input.status) &&
        (!input.currentPeriodEnd || new Date(input.currentPeriodEnd) > new Date());
      if (active) await q.query("update tenants set status = 'active' where id = $1 and status = 'suspended'", [tenantId]);
      if (input.status === 'inactive' || input.status === 'expired') {
        await q.query("update tenants set status = 'suspended' where id = $1 and status = 'active'", [tenantId]);
      }
      await this.tenantAudit(q, actor, tenantId, 'subscription.updated', { planId: input.planId, status: input.status, currentPeriodEnd: input.currentPeriodEnd });
      return (await this.rows(q, 't.id = $1', [tenantId]))[0];
    });
  }

  // ---- Greenn ------------------------------------------------------------------------

  /** Endereço do webhook para cadastrar na Greenn. Só para o superadministrador. */
  greennInfo() {
    return {
      configured: !!this.cfg.GREENN_SECRET,
      url: this.cfg.GREENN_SECRET ? `${this.cfg.APP_URL}/api/v1/webhooks/greenn/${this.cfg.GREENN_SECRET}` : null,
    };
  }

  async billingEvents(actor: Actor, limit = 100) {
    return this.db.platform(actor.userId, async (q) =>
      (await q.query(
        `select e.id, e.received_at as "receivedAt", e.event_type as "eventType", e.status, e.external_product as "externalProduct",
                e.external_sale as "externalSale", e.external_contract as "externalContract", e.customer_email as "customerEmail",
                e.action, e.detail, e.tenant_id as "tenantId", (select name from tenants t where t.id = e.tenant_id) as "tenantName"
           from billing_events e order by e.received_at desc limit $1`, [limit])).rows);
  }

  /**
   * Aviso da Greenn. Segredo errado responde 404. Aviso válido é registrado e
   * aplicado uma única vez: compra paga ativa ou renova (e cria a empresa se o
   * comprador ainda não tem uma), reembolso suspende na hora, cancelamento de
   * assinatura vale até o fim do período pago.
   */
  async handleGreenn(secret: string, body: unknown): Promise<{ action: string }> {
    if (!this.cfg.GREENN_SECRET || !secretMatches(secret, this.cfg.GREENN_SECRET)) throw Problem.notFound();
    const read = readGreennEvent(body);
    let invite: { to: string; name: string; token: string } | null = null;
    const action = await this.db.platform(null, async (q) => {
      if (!read.ok) {
        const fp = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
        await q.query(
          `insert into billing_events (fingerprint, action, detail) values ($1, 'invalid', $2) on conflict (fingerprint) do nothing`,
          [fp, JSON.stringify({ reason: read.reason })]);
        return 'invalid';
      }
      const e = read.event;
      const fp = fingerprint(e);
      const dup = await q.query('select action from billing_events where fingerprint = $1', [fp]);
      if (dup.rowCount) return 'duplicate';
      const decided = greennAction(e);
      const record = async (act: string, tenantId: string | null, detail: Record<string, unknown> = {}) => {
        await q.query(
          `insert into billing_events (fingerprint, event_type, status, external_product, external_sale, external_contract,
                                       customer_email, tenant_id, action, detail)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [fp, e.type, e.status, e.productId, e.saleId, e.contractId, e.customer?.email ?? null, tenantId, act,
            JSON.stringify({ customerName: e.customer?.name ?? null, productName: e.productName, periodEnd: e.periodEnd, ...detail })]);
        return act;
      };
      if (decided === 'none') return record('ignored', null);
      const offer = (await q.query<{ plan_id: string; duration_days: number | null; plan_duration: number }>(
        `select o.plan_id, o.duration_days, p.duration_days as plan_duration
           from plan_offers o join plans p on p.id = o.plan_id
          where o.provider = 'greenn' and o.external_product = $1`, [e.productId])).rows[0];
      if (!offer) return record('unmatched', null, { reason: 'produto sem plano ligado' });
      const sub = (await q.query<{ tenant_id: string; current_period_end: Date | null }>(
        `select tenant_id, current_period_end from tenant_subscriptions
          where ($1::text is not null and external_contract = $1) or customer_email = $2
          order by (external_contract = $1) desc nulls last, updated_at desc limit 1`,
        [e.contractId, e.customer!.email])).rows[0];

      if (decided === 'grant') {
        let tenantId = sub?.tenant_id ?? null;
        let created = false;
        if (!tenantId) {
          const name = e.customer!.name || e.customer!.email.split('@')[0]!;
          let slug = slugify(name);
          if ((await q.query('select 1 from tenants where slug = $1', [slug])).rowCount) slug = `${slug.slice(0, 33)}-${randomBytes(3).toString('hex')}`;
          const out = await this.createIn(q, SYSTEM, { name, slug, adminEmail: e.customer!.email, contactName: e.customer!.name || null }, true);
          tenantId = out.tenant.id;
          created = true;
          invite = { to: e.customer!.email, name, token: out.token };
        }
        const days = offer.duration_days ?? offer.plan_duration;
        const base = sub?.current_period_end && sub.current_period_end > new Date() ? sub.current_period_end : new Date();
        const periodEnd = e.type === 'contract'
          ? parsePeriodEnd(e.periodEnd) ?? new Date(Date.now() + days * 86_400_000)
          : new Date(base.getTime() + days * 86_400_000);
        await q.query(
          `insert into tenant_subscriptions (tenant_id, plan_id, status, current_period_end, source, customer_email, external_contract, external_sale)
           values ($1, $2, 'active', $3, 'greenn', $4, $5, $6)
           on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = 'active', current_period_end = excluded.current_period_end,
             source = 'greenn', customer_email = excluded.customer_email, canceled_at = null,
             external_contract = coalesce(excluded.external_contract, tenant_subscriptions.external_contract),
             external_sale = coalesce(excluded.external_sale, tenant_subscriptions.external_sale)`,
          [tenantId, offer.plan_id, periodEnd, e.customer!.email, e.contractId, e.saleId]);
        await q.query("update tenants set status = 'active' where id = $1 and status = 'suspended'", [tenantId]);
        await this.tenantAudit(q, SYSTEM, tenantId, created ? 'subscription.created' : 'subscription.renewed',
          { provider: 'greenn', periodEnd: periodEnd.toISOString() }, true);
        return record(created ? 'created' : sub ? 'renewed' : 'activated', tenantId, { periodEnd: periodEnd.toISOString() });
      }
      if (!sub) return record('unmatched', null, { reason: 'nenhuma empresa com esse comprador ou contrato' });
      if (decided === 'revoke') {
        await q.query(
          `update tenant_subscriptions set status = 'canceled', canceled_at = now(), current_period_end = now() where tenant_id = $1`, [sub.tenant_id]);
        await q.query("update tenants set status = 'suspended' where id = $1 and status = 'active'", [sub.tenant_id]);
        await this.tenantAudit(q, SYSTEM, sub.tenant_id, 'subscription.revoked', { provider: 'greenn', status: e.status }, true);
        return record('deactivated', sub.tenant_id);
      }
      const end = parsePeriodEnd(e.periodEnd);
      await q.query(
        `update tenant_subscriptions set status = 'canceled', canceled_at = coalesce(canceled_at, now()),
                current_period_end = coalesce($2, current_period_end) where tenant_id = $1`, [sub.tenant_id, end]);
      await this.tenantAudit(q, SYSTEM, sub.tenant_id, 'subscription.canceled', { provider: 'greenn', status: e.status, until: end?.toISOString() ?? null }, true);
      return record('canceled', sub.tenant_id, { until: end?.toISOString() ?? null });
    });
    const inv = invite as { to: string; name: string; token: string } | null;
    if (inv) {
      await this.auth.sendInvitation(inv.to, inv.name, this.cfg.APP_NAME, inv.token)
        .catch((err) => this.log.error(`convite da empresa nova não enviado: ${String(err)}`));
    }
    return { action };
  }
}
