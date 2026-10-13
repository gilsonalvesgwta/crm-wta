import type { Q } from '../infra/db.js';
import { Problem } from '../http/problem.js';
import { LIMIT_LABELS, allows, within, type FeatureLimit, type NumericLimit, type PlanLimits } from '../domain/plans.js';

/**
 * Limites do plano da empresa do contexto. Sem assinatura ou sem plano, não
 * há limite (uso interno). Roda numa transação já no contexto da empresa.
 */
export async function tenantLimits(q: Q): Promise<PlanLimits | null> {
  const r = await q.query<{ limits: PlanLimits | null }>(
    'select p.limits from tenant_subscriptions s left join plans p on p.id = s.plan_id');
  const row = r.rows[0];
  return row?.limits ?? null;
}

export async function assertFeature(q: Q, feature: FeatureLimit): Promise<void> {
  if (!allows(await tenantLimits(q), feature)) {
    throw new Problem(403, `O plano da empresa não inclui: ${LIMIT_LABELS[feature]}.`, 'plan-limit');
  }
}

export async function assertWithin(q: Q, key: NumericLimit, wouldHave: number): Promise<void> {
  const limits = await tenantLimits(q);
  if (!within(limits, key, wouldHave)) {
    throw new Problem(403, `O plano da empresa permite até ${limits![key]} em "${LIMIT_LABELS[key]}". Fale com a WTA para mudar de plano.`, 'plan-limit');
  }
}

/** Pessoas que ocupam vaga: vínculos ativos ou convidados e convites pendentes de quem ainda não tem vínculo. */
export async function seatsInUse(q: Q): Promise<number> {
  const r = await q.query<{ n: number }>(
    `select (select count(*) from memberships where status in ('active', 'invited'))::int
          + (select count(distinct i.email) from invitations i
              where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
                and not exists (select 1 from memberships m join users u on u.id = m.user_id
                                 where u.email = i.email and m.status in ('active', 'invited')))::int as n`);
  return r.rows[0]!.n;
}

/** Endereço da empresa para links de e-mail: o domínio próprio, se já funciona; senão, o padrão. */
export async function tenantBaseUrl(q: Q, fallback: string): Promise<string> {
  const r = await q.query<{ domain: string }>(
    "select domain from tenant_domains where kind = 'custom' and dns_ok and routing_ok and verified_at is not null limit 1");
  return r.rows[0] ? `https://${r.rows[0].domain}` : fallback;
}
