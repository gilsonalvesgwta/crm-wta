import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { Params } from './sql.js';

export type SalesFilter = { from: string; to: string; ownerId?: string; teamId?: string };

type Dim = 'none' | 'who' | 'day';

type Row = {
  key: string | null;
  contacted: number; scheduled: number; held: number; no_show: number; rescheduled: number;
  sales_call: number; sales_follow: number; sales_direct: number;
  value_call: string; value_follow: string; value_direct: string;
  follow_seconds: number | null;
  cohort: number; cohort_same_day: number; cohort_later: number;
};

/** Ligação ou reunião realizada: concluída com resultado "realizada" (ou sem resultado, das antigas). */
const HELD = `a.type in ('call', 'meeting') and a.status = 'done' and coalesce(a.outcome, 'held') = 'held'`;
/** Quando a call aconteceu: o horário marcado; sem horário, quando foi concluída. */
const AT = 'coalesce(a.starts_at, a.done_at, a.created_at)';
/** A call e o negócio são da mesma pessoa: o próprio negócio, o contato ou o lead. */
const LINK = '(a.deal_id = d.id or a.contact_id = d.contact_id or a.lead_id = d.lead_id)';

/**
 * Indicadores comerciais: leads contatados, calls agendadas e realizadas,
 * vendas na call e no follow-up, conversão e tempo até a venda.
 *
 * Regras:
 * - Contatado: pessoa que recebeu mensagem de alguém da equipe (sem campanha
 *   nem automação) ou teve call realizada. Cada pessoa conta uma vez no período.
 * - Call: atividade do tipo ligação ou reunião. Agendada = criada no período;
 *   realizada / não compareceu / remarcada pelo horário da call.
 * - Venda na call: negócio ganho no mesmo dia (fuso da empresa) de uma call
 *   realizada com a mesma pessoa. Follow-up: ganho depois de uma call realizada
 *   em dia anterior. Sem call: ganho sem call realizada antes.
 * - Conversão: das pessoas com call realizada no período (a primeira call de
 *   cada uma), quantas compraram no dia (na call) e, das que não compraram no
 *   dia, quantas compraram depois (follow-up, até hoje).
 * Vale o alcance de "reports:view": empresa toda, equipe ou só a própria pessoa.
 */
@Injectable()
export class SalesService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async summary(actor: Actor, f: SalesFilter) {
    const scope = actor.permissions.get('reports:view');
    if (!scope || !actor.membershipId) throw Problem.forbidden();
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const len = Date.parse(f.to) - Date.parse(f.from);
      const prevFrom = new Date(Date.parse(f.from) - len).toISOString();
      const cur = { from: f.from, to: f.to };

      const [total] = await this.metrics(q, actor, f, tz, 'none', cur);
      const [prev] = await this.metrics(q, actor, f, tz, 'none', { from: prevFrom, to: f.from });
      const sellers = await this.metrics(q, actor, f, tz, 'who', cur);
      const daily = await this.metrics(q, actor, f, tz, 'day', cur);

      const names = sellers.length ? (await q.query<{ id: string; name: string }>(
        'select mb.id, u.name from memberships mb join users u on u.id = mb.user_id where mb.id = any($1::uuid[])',
        [sellers.map((s) => s.key).filter(Boolean)])).rows : [];
      const nameOf = new Map(names.map((n) => [n.id, n.name]));

      const days: string[] = (await q.query<{ day: string }>(
        `select to_char(generate_series(($1::timestamptz at time zone $3::text)::date,
                                        (($2::timestamptz - interval '1 second') at time zone $3::text)::date, interval '1 day'), 'YYYY-MM-DD') as day`,
        [f.from, f.to, tz])).rows.map((r) => r.day);
      const byDay = new Map(daily.map((d) => [d.key, d]));

      return {
        period: { from: f.from, to: f.to, timezone: tz, previousFrom: prevFrom },
        totals: view(total),
        previous: view(prev),
        daily: days.map((day) => {
          const d = byDay.get(day);
          return { day, contacted: d?.contacted ?? 0, scheduled: d?.scheduled ?? 0, held: d?.held ?? 0,
                   salesOnCall: d?.sales_call ?? 0, salesFollowUp: d?.sales_follow ?? 0 };
        }),
        sellers: sellers.filter((s) => s.key).map((s) => ({ id: s.key!, name: nameOf.get(s.key!) ?? '—', ...view(s) }))
          .sort((a, b) => b.sales.total - a.sales.total || b.calls.held - a.calls.held || a.name.localeCompare(b.name)),
      };
    });
  }

  /** Pessoas da equipe cujos números entram: alcance de quem vê, mais os filtros de vendedor e equipe. */
  private who(p: Params, actor: Actor, f: SalesFilter, col: string): string {
    const scope = actor.permissions.get('reports:view')!;
    const conds: string[] = [];
    if (scope === 'own') conds.push(`${col} = ${p.add(actor.membershipId)}::uuid`);
    else if (scope === 'team') {
      conds.push(`(${col} = ${p.add(actor.membershipId)}::uuid or ${col} in
        (select tm.membership_id from team_members tm where tm.team_id = any(${p.add(actor.teamIds)}::uuid[])))`);
    }
    if (f.ownerId) conds.push(`${col} = ${p.add(f.ownerId)}::uuid`);
    if (f.teamId) conds.push(`${col} in (select tm.membership_id from team_members tm where tm.team_id = ${p.add(f.teamId)}::uuid)`);
    return conds.length ? conds.join(' and ') : 'true';
  }

  private async metrics(q: Q, actor: Actor, f: SalesFilter, tz: string, dim: Dim, range: { from: string; to: string }): Promise<Row[]> {
    const p = new Params();
    const from = `${p.add(range.from)}::timestamptz`;
    const to = `${p.add(range.to)}::timestamptz`;
    const tzp = `${p.add(tz)}::text`;
    const day = (col: string) => `(${col} at time zone ${tzp})::date`;
    // Chave do agrupamento em cada fonte.
    const g = (whoCol: string, atCol: string) => dim === 'who' ? `${whoCol}::text` : dim === 'day' ? `to_char(${day(atCol)}, 'YYYY-MM-DD')` : 'null::text';

    const sql = `
      with touch as (
        select ${g('m.sent_by', 'm.created_at')} as k, m.contact_id::text as person
          from messages m
         where m.direction = 'out' and m.sent_by is not null and m.automation_rule_id is null and m.campaign_id is null
           and m.status <> 'failed' and m.created_at >= ${from} and m.created_at < ${to} and ${this.who(p, actor, f, 'm.sent_by')}
        union all
        select ${g('a.owner_membership_id', AT)}, coalesce(a.contact_id, a.lead_id, a.deal_id)::text
          from activities a
         where ${HELD} and ${AT} >= ${from} and ${AT} < ${to} and coalesce(a.contact_id, a.lead_id, a.deal_id) is not null
           and ${this.who(p, actor, f, 'a.owner_membership_id')}
      ),
      contacted as (select k, count(distinct person)::int as n from touch group by k),
      calls as (
        select ${g('a.owner_membership_id', AT)} as k,
               count(*) filter (where a.status = 'done' and coalesce(a.outcome, 'held') = 'held' and ${AT} >= ${from} and ${AT} < ${to})::int as held,
               count(*) filter (where a.status = 'done' and a.outcome = 'no_show' and ${AT} >= ${from} and ${AT} < ${to})::int as no_show,
               count(*) filter (where a.status = 'done' and a.outcome = 'rescheduled' and ${AT} >= ${from} and ${AT} < ${to})::int as rescheduled
          from activities a
         where a.type in ('call', 'meeting') and ${AT} >= ${from} and ${AT} < ${to} and ${this.who(p, actor, f, 'a.owner_membership_id')}
         group by 1
      ),
      scheduled as (
        select ${g('a.owner_membership_id', 'a.created_at')} as k, count(*)::int as n
          from activities a
         where a.type in ('call', 'meeting') and a.created_at >= ${from} and a.created_at < ${to}
           and ${this.who(p, actor, f, 'a.owner_membership_id')}
         group by 1
      ),
      won as (
        select ${g('d.owner_membership_id', 'd.closed_at')} as k, d.value_cents, d.closed_at,
               case when exists (select 1 from activities a where ${HELD} and ${LINK} and ${day(AT)} = ${day('d.closed_at')}) then 'call'
                    when exists (select 1 from activities a where ${HELD} and ${LINK} and ${AT} < d.closed_at) then 'follow'
                    else 'direct' end as how,
               (select min(${AT}) from activities a where ${HELD} and ${LINK} and ${AT} < d.closed_at) as first_call
          from deals d
         where d.status = 'won' and d.closed_at >= ${from} and d.closed_at < ${to} and ${this.who(p, actor, f, 'd.owner_membership_id')}
      ),
      sales as (
        select k, count(*) filter (where how = 'call')::int as sales_call, count(*) filter (where how = 'follow')::int as sales_follow,
               count(*) filter (where how = 'direct')::int as sales_direct,
               coalesce(sum(value_cents) filter (where how = 'call'), 0)::text as value_call,
               coalesce(sum(value_cents) filter (where how = 'follow'), 0)::text as value_follow,
               coalesce(sum(value_cents) filter (where how = 'direct'), 0)::text as value_direct,
               round(avg(extract(epoch from closed_at - first_call)) filter (where how = 'follow'))::int as follow_seconds
          from won group by k
      ),
      firsts as (
        select ${g('a.owner_membership_id', AT)} as k, a.deal_id, a.contact_id, a.lead_id, ${AT} as at,
               row_number() over (partition by ${g('a.owner_membership_id', AT)}, coalesce(a.contact_id, a.lead_id, a.deal_id) order by ${AT}) as rn
          from activities a
         where ${HELD} and ${AT} >= ${from} and ${AT} < ${to} and ${this.who(p, actor, f, 'a.owner_membership_id')}
      ),
      cohort as (
        select c.k, count(*)::int as cohort,
               count(*) filter (where c.same_day)::int as cohort_same_day,
               count(*) filter (where not c.same_day and c.later)::int as cohort_later
          from (select a.k,
                       exists (select 1 from deals d where d.status = 'won' and ${LINK} and ${day('d.closed_at')} = ${day('a.at')}) as same_day,
                       exists (select 1 from deals d where d.status = 'won' and ${LINK} and ${day('d.closed_at')} > ${day('a.at')}) as later
                  from firsts a where a.rn = 1) c
         group by c.k
      ),
      keys as (select k from contacted union select k from calls union select k from scheduled union select k from sales union select k from cohort)
      select keys.k as key,
             coalesce(ct.n, 0) as contacted, coalesce(sc.n, 0) as scheduled,
             coalesce(cl.held, 0) as held, coalesce(cl.no_show, 0) as no_show, coalesce(cl.rescheduled, 0) as rescheduled,
             coalesce(s.sales_call, 0) as sales_call, coalesce(s.sales_follow, 0) as sales_follow, coalesce(s.sales_direct, 0) as sales_direct,
             coalesce(s.value_call, '0') as value_call, coalesce(s.value_follow, '0') as value_follow, coalesce(s.value_direct, '0') as value_direct,
             s.follow_seconds,
             coalesce(co.cohort, 0) as cohort, coalesce(co.cohort_same_day, 0) as cohort_same_day, coalesce(co.cohort_later, 0) as cohort_later
        from keys
        left join contacted ct on ct.k is not distinct from keys.k
        left join scheduled sc on sc.k is not distinct from keys.k
        left join calls cl on cl.k is not distinct from keys.k
        left join sales s on s.k is not distinct from keys.k
        left join cohort co on co.k is not distinct from keys.k`;
    const rows = (await q.query<Row>(sql, p.values)).rows;
    // Sem nenhum dado, a visão geral ainda tem uma linha (zerada).
    return dim === 'none' && rows.length === 0 ? [] : rows;
  }
}

function view(r: Row | undefined) {
  const n = (v: number | undefined) => v ?? 0;
  const valueCall = Number(r?.value_call ?? 0), valueFollow = Number(r?.value_follow ?? 0), valueDirect = Number(r?.value_direct ?? 0);
  const held = n(r?.held), noShow = n(r?.no_show);
  const cohort = n(r?.cohort), sameDay = n(r?.cohort_same_day), later = n(r?.cohort_later);
  return {
    contacted: n(r?.contacted),
    calls: { scheduled: n(r?.scheduled), held, noShow, rescheduled: n(r?.rescheduled),
             attendanceRate: held + noShow ? held / (held + noShow) : null },
    sales: {
      onCall: n(r?.sales_call), followUp: n(r?.sales_follow), withoutCall: n(r?.sales_direct),
      total: n(r?.sales_call) + n(r?.sales_follow) + n(r?.sales_direct),
      valueOnCallCents: valueCall, valueFollowUpCents: valueFollow, valueWithoutCallCents: valueDirect,
      valueCents: valueCall + valueFollow + valueDirect,
      averageFollowUpSeconds: r?.follow_seconds ?? null,
    },
    conversion: {
      people: cohort, onCall: sameDay, followUp: later,
      onCallRate: cohort ? sameDay / cohort : null,
      followUpRate: cohort - sameDay ? later / (cohort - sameDay) : null,
    },
  };
}
