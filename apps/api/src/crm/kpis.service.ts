import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Db, type Q } from '../infra/db.js';
import { AdsService } from './ads.service.js';
import { AT, HELD, LINK } from './sales.service.js';
import { Params } from './sql.js';

export type KpiFilter = { from: string; to: string; step: number };

type Raw = {
  b: number;
  leads: number; prospected: number; scheduled: number; held: number; no_show: number; rescheduled: number;
  sales: number; sales_call: number; sales_follow: number; revenue: string; spend: string;
};

/**
 * KPIs do funil com o investimento em anúncios, por período (planilha) e no
 * total: leads, prospecções, reuniões agendadas e realizadas, no-show,
 * vendas, faturamento, ticket médio, custo por lead, por reunião e por venda,
 * ROAS e conversão da reunião em venda.
 *
 * - Leads: contatos novos e leads novos (uma vez por pessoa no período).
 * - Prospecções: pessoas que receberam mensagem (de alguém, campanha ou
 *   automação) ou tiveram call realizada.
 * - Reunião: ligação ou reunião na agenda (mesmas regras dos indicadores comerciais).
 * - Investimento: lançamentos divididos por igual entre os dias de cada um.
 * Empresa toda; datas no fuso da empresa.
 */
@Injectable()
export class KpisService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async summary(actor: Actor, f: KpiFilter) {
    AdsService.assertCompanyView(actor);
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const totalDays = Math.round((Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000) + 1;
      const rows = await this.raw(q, tz, f.from, f.to, f.step);
      const [total] = await this.raw(q, tz, f.from, f.to, totalDays);
      const byB = new Map(rows.map((r) => [r.b, r]));
      const periods = [];
      for (let b = 0; b * f.step < totalDays; b++) {
        const start = addDays(f.from, b * f.step);
        const end = addDays(f.from, Math.min(totalDays, (b + 1) * f.step) - 1);
        periods.push({ from: start, to: end, days: Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1, ...derive(byB.get(b)) });
      }
      const byPlatform = (await q.query<{ platform: string; cents: string }>(
        `select s.platform, round(sum(s.amount_cents::numeric * (least(s.last_day, $2::date) - greatest(s.first_day, $1::date) + 1)
                 / (s.last_day - s.first_day + 1)))::text as cents
           from ad_spend s where s.first_day <= $2::date and s.last_day >= $1::date group by 1 order by 2 desc`, [f.from, f.to])).rows;
      return {
        period: { from: f.from, to: f.to, step: f.step, days: totalDays, timezone: tz },
        totals: { ...derive(total), spendByPlatform: byPlatform.map((p) => ({ platform: p.platform, spendCents: Number(p.cents) })) },
        periods,
        targets: { noShowRateMax: 0.2 },
      };
    });
  }

  private async raw(q: Q, tz: string, from: string, to: string, step: number): Promise<Raw[]> {
    const p = new Params();
    const d0 = `${p.add(from)}::date`;
    const d1 = `${p.add(to)}::date`;
    const tzp = `${p.add(tz)}::text`;
    const st = `${p.add(step)}::int`;
    const t0 = `(${d0}::timestamp at time zone ${tzp})`;
    const t1 = `((${d1} + 1)::timestamp at time zone ${tzp})`;
    const bt = (col: string) => `((((${col}) at time zone ${tzp})::date - ${d0}) / ${st})`;
    const inT = (col: string) => `${col} >= ${t0} and ${col} < ${t1}`;
    const sql = `
      with leads as (
        select b, count(distinct person)::int as n from (
          select ${bt('k.created_at')} as b, k.id as person from contacts k where ${inT('k.created_at')} and k.anonymized_at is null
          union all
          select ${bt('l.created_at')}, l.contact_id from leads l where ${inT('l.created_at')}) x group by b
      ),
      prosp as (
        select b, count(distinct person)::int as n from (
          select ${bt('m.created_at')} as b, m.contact_id::text as person from messages m
           where m.direction = 'out' and m.status <> 'failed' and ${inT('m.created_at')}
          union all
          select ${bt(AT)}, coalesce(a.contact_id, a.lead_id, a.deal_id)::text from activities a
           where ${HELD} and ${inT(AT)} and coalesce(a.contact_id, a.lead_id, a.deal_id) is not null) x group by b
      ),
      sched as (
        select ${bt('a.created_at')} as b, count(*)::int as n from activities a
         where a.type in ('call', 'meeting') and ${inT('a.created_at')} group by 1
      ),
      calls as (
        select ${bt(AT)} as b,
               count(*) filter (where a.status = 'done' and coalesce(a.outcome, 'held') = 'held')::int as held,
               count(*) filter (where a.status = 'done' and a.outcome = 'no_show')::int as no_show,
               count(*) filter (where a.status = 'done' and a.outcome = 'rescheduled')::int as rescheduled
          from activities a where a.type in ('call', 'meeting') and ${inT(AT)} group by 1
      ),
      won as (
        select ${bt('d.closed_at')} as b, count(*)::int as sales, coalesce(sum(d.value_cents), 0)::text as revenue,
               count(*) filter (where exists (select 1 from activities a where ${HELD} and ${LINK}
                 and ((${AT}) at time zone ${tzp})::date = (d.closed_at at time zone ${tzp})::date))::int as sales_call,
               count(*) filter (where not exists (select 1 from activities a where ${HELD} and ${LINK}
                 and ((${AT}) at time zone ${tzp})::date = (d.closed_at at time zone ${tzp})::date)
                 and exists (select 1 from activities a where ${HELD} and ${LINK} and ${AT} < d.closed_at))::int as sales_follow
          from deals d where d.status = 'won' and ${inT('d.closed_at')} group by 1
      ),
      spend as (
        select ((g.day::date - ${d0}) / ${st}) as b,
               sum(s.amount_cents::numeric / (s.last_day - s.first_day + 1)) as cents
          from ad_spend s
          cross join lateral generate_series(greatest(s.first_day, ${d0}), least(s.last_day, ${d1}), interval '1 day') g(day)
         where s.first_day <= ${d1} and s.last_day >= ${d0}
         group by 1
      ),
      keys as (select b from leads union select b from prosp union select b from sched union select b from calls
               union select b from won union select b from spend)
      select keys.b, coalesce(l.n, 0) as leads, coalesce(pr.n, 0) as prospected, coalesce(sc.n, 0) as scheduled,
             coalesce(c.held, 0) as held, coalesce(c.no_show, 0) as no_show, coalesce(c.rescheduled, 0) as rescheduled,
             coalesce(w.sales, 0) as sales, coalesce(w.sales_call, 0) as sales_call, coalesce(w.sales_follow, 0) as sales_follow,
             coalesce(w.revenue, '0') as revenue, coalesce(round(sp.cents), 0)::text as spend
        from keys
        left join leads l on l.b = keys.b left join prosp pr on pr.b = keys.b left join sched sc on sc.b = keys.b
        left join calls c on c.b = keys.b left join won w on w.b = keys.b left join spend sp on sp.b = keys.b
       order by keys.b`;
    return (await q.query<Raw>(sql, p.values)).rows;
  }
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Números do período e os indicadores calculados a partir deles. */
function derive(r: Raw | undefined) {
  const n = (v: number | undefined) => v ?? 0;
  const spend = Number(r?.spend ?? 0), revenue = Number(r?.revenue ?? 0);
  const leads = n(r?.leads), prospected = n(r?.prospected), scheduled = n(r?.scheduled);
  const held = n(r?.held), noShow = n(r?.no_show), sales = n(r?.sales), salesOnCall = n(r?.sales_call);
  const div = (a: number, b: number) => (b ? a / b : null);
  const money = (a: number, b: number) => (b ? Math.round(a / b) : null);
  return {
    spendCents: spend,
    leads, prospected, scheduled, held, noShow, rescheduled: n(r?.rescheduled),
    sales, salesOnCall, salesFollowUp: n(r?.sales_follow), revenueCents: revenue,
    noShowRate: div(noShow, held + noShow),
    scheduledPerLead: div(scheduled, leads),
    prospectedPerScheduled: div(prospected, scheduled),
    onCallConversion: div(salesOnCall, held),
    salesConversion: div(sales, held),
    meetingsPerSale: div(held, salesOnCall),
    averageTicketCents: money(revenue, sales),
    costPerLeadCents: money(spend, leads),
    costPerScheduledCents: money(spend, scheduled),
    costPerHeldCents: money(spend, held),
    costPerSaleCents: money(spend, sales),
    roas: div(revenue, spend),
  };
}
