import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { Problem } from '../http/problem.js';
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
      const tags = await this.leadTags(q);
      const rows = await this.raw(q, tz, f.from, f.to, f.step, tags);
      const [total] = await this.raw(q, tz, f.from, f.to, totalDays, tags);
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
        leadRule: tags.length ? 'tag' : 'new-contacts',
        leadTagIds: tags,
      };
    });
  }

  /** Etiquetas que marcam o lead (vazio: todo contato novo conta). */
  private async leadTags(q: Q): Promise<string[]> {
    return (await q.query<{ lead_tag_ids: string[] }>('select lead_tag_ids from kpi_settings')).rows[0]?.lead_tag_ids ?? [];
  }

  /**
   * As fontes de cada número, linha a linha: "at" (quando conta) e o registro.
   * São as mesmas para os totais e para a lista de conferência.
   */
  private sources(p: Params, tz: string, from: string, to: string, tags: string[]) {
    const d0 = `${p.add(from)}::date`;
    const d1 = `${p.add(to)}::date`;
    const tzp = `${p.add(tz)}::text`;
    const t0 = `(${d0}::timestamp at time zone ${tzp})`;
    const t1 = `((${d1} + 1)::timestamp at time zone ${tzp})`;
    const inT = (col: string) => `${col} >= ${t0} and ${col} < ${t1}`;
    const out = (kind: string, col: string) => `not exists (select 1 from kpi_exclusions x where x.kind = '${kind}' and x.record_id = ${col})`;
    const localDay = (col: string) => `((${col}) at time zone ${tzp})::date`;
    // Pessoa da call: o contato, o do lead ou o do negócio.
    const person = `coalesce(a.contact_id, (select l.contact_id from leads l where l.id = a.lead_id), (select dd.contact_id from deals dd where dd.id = a.deal_id))`;
    const leads = tags.length
      ? `select ct.created_at as at, ct.contact_id as id from contact_tags ct join contacts k on k.id = ct.contact_id
          where ct.tag_id = any(${p.add(tags)}::uuid[]) and k.anonymized_at is null and ${inT('ct.created_at')} and ${out('contact', 'ct.contact_id')}`
      : `select k.created_at as at, k.id from contacts k where ${inT('k.created_at')} and k.anonymized_at is null and ${out('contact', 'k.id')}
         union all
         select l.created_at, l.contact_id from leads l where ${inT('l.created_at')} and ${out('contact', 'l.contact_id')}`;
    const prospected = `
      select m.created_at as at, m.contact_id as id from messages m
       where m.direction = 'out' and m.status <> 'failed' and ${inT('m.created_at')} and ${out('contact', 'm.contact_id')}
      union all
      select ${AT}, ${person} from activities a
       where ${HELD} and ${inT(AT)} and ${person} is not null and ${out('activity', 'a.id')} and ${out('contact', person)}`;
    const scheduled = `select a.created_at as at, a.id from activities a
       where a.type in ('call', 'meeting') and ${inT('a.created_at')} and ${out('activity', 'a.id')}`;
    const calls = `select ${AT} as at, a.id, case when coalesce(a.outcome, 'held') = 'held' then 'held' else a.outcome end as outcome from activities a
       where a.type in ('call', 'meeting') and a.status = 'done' and ${inT(AT)} and ${out('activity', 'a.id')}`;
    // Venda: negócio ganho; "na reunião" no mesmo dia de reunião realizada, "follow-up" depois de uma.
    const heldLinked = `select 1 from activities a where ${HELD} and ${LINK} and ${out('activity', 'a.id')}`;
    const won = `select d.closed_at as at, d.id, d.value_cents,
         case when exists (${heldLinked} and ${localDay(AT)} = ${localDay('d.closed_at')}) then 'call'
              when exists (${heldLinked} and ${AT} < d.closed_at) then 'follow' else 'direct' end as how
       from deals d where d.status = 'won' and ${inT('d.closed_at')} and ${out('deal', 'd.id')}`;
    const spend = `select g.day::date as day, s.amount_cents::numeric / (s.last_day - s.first_day + 1) as cents
       from ad_spend s cross join lateral generate_series(greatest(s.first_day, ${d0}), least(s.last_day, ${d1}), interval '1 day') g(day)
       where s.first_day <= ${d1} and s.last_day >= ${d0}`;
    return { d0, tzp, localDay, leads, prospected, scheduled, calls, won, spend };
  }

  private async raw(q: Q, tz: string, from: string, to: string, step: number, tags: string[]): Promise<Raw[]> {
    const p = new Params();
    const src = this.sources(p, tz, from, to, tags);
    const st = `${p.add(step)}::int`;
    const bt = (col: string) => `((${src.localDay(col)} - ${src.d0}) / ${st})`;
    const sql = `
      with k_leads as (select ${bt('x.at')} as b, count(distinct x.id)::int as n from (${src.leads}) x group by 1),
      k_prosp as (select ${bt('x.at')} as b, count(distinct x.id)::int as n from (${src.prospected}) x group by 1),
      k_sched as (select ${bt('x.at')} as b, count(*)::int as n from (${src.scheduled}) x group by 1),
      k_calls as (
        select ${bt('x.at')} as b, count(*) filter (where x.outcome = 'held')::int as held,
               count(*) filter (where x.outcome = 'no_show')::int as no_show,
               count(*) filter (where x.outcome = 'rescheduled')::int as rescheduled
          from (${src.calls}) x group by 1),
      k_won as (
        select ${bt('x.at')} as b, count(*)::int as sales, coalesce(sum(x.value_cents), 0)::text as revenue,
               count(*) filter (where x.how = 'call')::int as sales_call, count(*) filter (where x.how = 'follow')::int as sales_follow
          from (${src.won}) x group by 1),
      k_spend as (select ((x.day - ${src.d0}) / ${st}) as b, sum(x.cents) as cents from (${src.spend}) x group by 1),
      keys as (select b from k_leads union select b from k_prosp union select b from k_sched union select b from k_calls
               union select b from k_won union select b from k_spend)
      select keys.b, coalesce(l.n, 0) as leads, coalesce(pr.n, 0) as prospected, coalesce(sc.n, 0) as scheduled,
             coalesce(c.held, 0) as held, coalesce(c.no_show, 0) as no_show, coalesce(c.rescheduled, 0) as rescheduled,
             coalesce(w.sales, 0) as sales, coalesce(w.sales_call, 0) as sales_call, coalesce(w.sales_follow, 0) as sales_follow,
             coalesce(w.revenue, '0') as revenue, coalesce(round(sp.cents), 0)::text as spend
        from keys
        left join k_leads l on l.b = keys.b left join k_prosp pr on pr.b = keys.b left join k_sched sc on sc.b = keys.b
        left join k_calls c on c.b = keys.b left join k_won w on w.b = keys.b left join k_spend sp on sp.b = keys.b
       order by keys.b`;
    return (await q.query<Raw>(sql, p.values)).rows;
  }

  /**
   * Conferência: os registros que formam um número no período, com os que
   * foram tirados dos KPIs (marcados), para corrigir ou tirar da conta.
   */
  async details(actor: Actor, f: { from: string; to: string; metric: KpiMetric }) {
    AdsService.assertCompanyView(actor);
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const tags = await this.leadTags(q);
      // Os excluídos aparecem também: a fonte é refeita sem o filtro de exclusão.
      const p = new Params();
      // A etiqueta só entra na consulta dos leads (parâmetro sem uso quebra a consulta).
      const src = this.sources(p, tz, f.from, f.to, f.metric === 'leads' ? tags : []);
      const kind = METRIC_KIND[f.metric];
      const base = f.metric === 'leads' ? src.leads : f.metric === 'prospected' ? src.prospected : f.metric === 'scheduled' ? src.scheduled
        : f.metric === 'sales' ? src.won : src.calls;
      const filter = f.metric === 'held' || f.metric === 'no_show' || f.metric === 'rescheduled' ? `where x.outcome = ${p.add(f.metric)}` : '';
      const included = (await q.query<{ id: string; at: Date }>(
        `select x.id, min(x.at) as at from (${base}) x ${filter} group by x.id`, p.values)).rows;
      const excluded = (await q.query<{ record_id: string }>('select record_id from kpi_exclusions where kind = $1', [kind])).rows.map((r) => r.record_id);
      const ids = [...new Set([...included.map((r) => r.id), ...excluded])];
      const when = new Map(included.map((r) => [r.id, r.at]));
      const items = await this.describe(q, kind, ids, tz, f);
      return {
        metric: f.metric, kind, leadTagIds: tags,
        items: items
          // Contados no período, mais os tirados da conta que cairiam nele (para poder voltar).
          .filter((i) => when.has(i.id) || (i.inPeriod && (!['held', 'no_show', 'rescheduled'].includes(f.metric)
            || ((i as { outcome?: string | null }).outcome ?? 'held') === f.metric)))
          .map((i) => ({ ...i, at: when.get(i.id) ?? i.at, excluded: excluded.includes(i.id) }))
          .sort((a, b) => Number(a.excluded) - Number(b.excluded) || new Date(b.at).getTime() - new Date(a.at).getTime())
          .slice(0, 1000),
      };
    });
  }

  /** Nome, data e valor de cada registro, e se ele cairia no período (para mostrar os tirados da conta). */
  private async describe(q: Q, kind: 'contact' | 'activity' | 'deal', ids: string[], tz: string, f: { from: string; to: string; metric: KpiMetric }) {
    if (!ids.length) return [];
    const range = `>= ($2::date::timestamp at time zone $4::text) and %s < (($3::date + 1)::timestamp at time zone $4::text)`;
    if (kind === 'contact') {
      return (await q.query<{ id: string; title: string; detail: string | null; at: Date; inPeriod: boolean; valueCents: null }>(
        `select k.id, k.name as title,
                (select string_agg(t.name, ', ' order by t.name) from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = k.id) as detail,
                k.created_at as at, (k.created_at ${range.replace('%s', 'k.created_at')}) as "inPeriod", null as "valueCents"
           from contacts k where k.id = any($1::uuid[])`, [ids, f.from, f.to, tz])).rows;
    }
    if (kind === 'activity') {
      return (await q.query(
        `select a.id, a.title, concat_ws(' · ', (select c.name from contacts c where c.id = a.contact_id), (select u.name from memberships mb join users u on u.id = mb.user_id where mb.id = a.owner_membership_id)) as detail,
                ${AT} as at, (${AT} ${range.replace('%s', AT)}) as "inPeriod", null as "valueCents", a.outcome, a.status, a.type
           from activities a where a.id = any($1::uuid[])`, [ids, f.from, f.to, tz])).rows as { id: string; title: string; detail: string | null; at: Date; inPeriod: boolean; valueCents: null }[];
    }
    return (await q.query(
      `select d.id, d.title, concat_ws(' · ', (select c.name from contacts c where c.id = d.contact_id), (select u.name from memberships mb join users u on u.id = mb.user_id where mb.id = d.owner_membership_id)) as detail,
              coalesce(d.closed_at, d.created_at) as at, (d.status = 'won' and d.closed_at ${range.replace('%s', 'd.closed_at')}) as "inPeriod", d.value_cents::text as "valueCents"
         from deals d where d.id = any($1::uuid[])`, [ids, f.from, f.to, tz])).rows
      .map((r) => ({ ...r, valueCents: Number(r.valueCents) })) as unknown as { id: string; title: string; detail: string | null; at: Date; inPeriod: boolean; valueCents: null }[];
  }

  async setExcluded(actor: Actor, kind: 'contact' | 'activity' | 'deal', id: string, excluded: boolean): Promise<void> {
    AdsService.assertCompanyView(actor);
    await this.db.app(tenantCtx(actor), async (q) => {
      if (excluded) {
        const table = kind === 'contact' ? 'contacts' : kind === 'activity' ? 'activities' : 'deals';
        if (!(await q.query(`select 1 from ${table} where id = $1`, [id])).rowCount) throw Problem.notFound('Registro não encontrado.');
        await q.query(
          `insert into kpi_exclusions (tenant_id, kind, record_id, created_by) values (app.tenant_id(), $1, $2, $3) on conflict do nothing`,
          [kind, id, actor.membershipId]);
      } else {
        await q.query('delete from kpi_exclusions where kind = $1 and record_id = $2', [kind, id]);
      }
      await audit(q, actor, excluded ? 'kpi.exclude' : 'kpi.include', kind, id, {});
    });
  }

  async settings(actor: Actor) {
    AdsService.assertCompanyView(actor);
    return this.db.app(tenantCtx(actor), async (q) => ({ leadTagIds: await this.leadTags(q) }));
  }

  async saveSettings(actor: Actor, leadTagIds: string[]) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const ids = [...new Set(leadTagIds)];
      const found = (await q.query('select id from tags where id = any($1::uuid[])', [ids])).rowCount ?? 0;
      if (found !== ids.length) throw Problem.badRequest('Etiqueta não encontrada.', [{ field: 'leadTagIds', message: 'Escolha etiquetas que existem.' }]);
      await q.query(
        `insert into kpi_settings (tenant_id, lead_tag_ids, updated_by) values (app.tenant_id(), $1, $2)
         on conflict (tenant_id) do update set lead_tag_ids = excluded.lead_tag_ids, updated_by = excluded.updated_by`,
        [ids, actor.membershipId]);
      await audit(q, actor, 'kpi.settings', 'kpi_settings', null, { leadTagIds: ids });
      return { leadTagIds: ids };
    });
  }
}

export type KpiMetric = 'leads' | 'prospected' | 'scheduled' | 'held' | 'no_show' | 'rescheduled' | 'sales';
const METRIC_KIND: Record<KpiMetric, 'contact' | 'activity' | 'deal'> = {
  leads: 'contact', prospected: 'contact', scheduled: 'activity', held: 'activity', no_show: 'activity', rescheduled: 'activity', sales: 'deal',
};

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
