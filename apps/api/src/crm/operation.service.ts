import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Db } from '../infra/db.js';
import { ConversationsService } from './conversations.service.js';
import { Params, reachSql, tryReach } from './sql.js';

export type OperationFilter = { from: string; to: string; channel?: 'whatsapp' | 'email'; assigneeId?: string; teamId?: string };

/** Tempo de resposta esperado (segundos): até 15 min está bom; até 1 h, atenção. */
export const RESPONSE_OK_S = 15 * 60;
export const RESPONSE_WARN_S = 60 * 60;

/**
 * Status da operação de atendimento: volume, tempo de resposta, fila, mapa de
 * calor, funil das conversas, canais e atendentes. Vale o alcance de quem vê
 * as conversas; sem permissão de conversa, só quem vê relatórios da empresa toda.
 */
@Injectable()
export class OperationService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
  ) {}

  /** Conversas visíveis com os filtros: "v" (conversa) e "c" (contato). */
  private scope(p: Params, actor: Actor, f: OperationFilter): string {
    const conds = ['c.anonymized_at is null'];
    if (actor.permissions.has('conversations:reply')) conds.push(this.conversations.visibleSql(p, actor));
    else if (actor.permissions.get('reports:view') !== 'tenant') conds.push('false');
    if (f.channel) conds.push(`v.channel = ${p.add(f.channel)}`);
    if (f.assigneeId) conds.push(`v.assignee_membership_id = ${p.add(f.assigneeId)}`);
    if (f.teamId) conds.push(`v.team_id = ${p.add(f.teamId)}`);
    return `select v.* from conversations v join contacts c on c.id = v.contact_id where ${conds.join(' and ')}`;
  }

  async summary(actor: Actor, f: OperationFilter) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;

      // Volume e tempo de resposta no período. "Vez do cliente": mensagem recebida que não segue
      // outra recebida; respondida pela primeira mensagem enviada por uma pessoa depois dela.
      const p = new Params();
      const from = `${p.add(f.from)}::timestamptz`;
      const to = `${p.add(f.to)}::timestamptz`;
      const tzp = `${p.add(tz)}::text`;
      const base = `with v as (${this.scope(p, actor, f)}),
        m as (select m.*, (m.created_at at time zone ${tzp}) as local_at, lag(m.direction) over (partition by m.contact_id, m.channel order by m.created_at) as prev
                from messages m join v on v.contact_id = m.contact_id and v.channel = m.channel
               where m.created_at >= ${from} - interval '1 day' and m.created_at < ${to}),
        turns as (
          select t.contact_id, t.channel, t.created_at, a.created_at as answered_at, a.sent_by
            from m t
            left join lateral (select o.created_at, o.sent_by from messages o
                                where o.contact_id = t.contact_id and o.channel = t.channel and o.direction = 'out'
                                  and o.sent_by is not null and o.created_at > t.created_at
                                order by o.created_at limit 1) a on true
           where t.direction = 'in' and t.prev is distinct from 'in' and t.created_at >= ${from} and t.created_at < ${to})`;

      const k = (await q.query<Record<string, string | null>>(
        `${base}
         select (select count(*) from m where m.direction = 'in' and m.created_at >= ${from}) as received,
                (select count(*) from m where m.direction = 'out' and m.created_at >= ${from}) as sent,
                (select avg(extract(epoch from answered_at - created_at)) from turns where answered_at is not null) as avg_response,
                (select count(*) from turns where answered_at is not null) as answered,
                (select count(*) from turns where answered_at is null) as unanswered,
                (select count(*) from v where v.status in ('open', 'waiting')) as active,
                (select count(*) from v where v.status in ('open', 'waiting') and v.assignee_membership_id is null) as unassigned,
                (select count(*) from v where v.status = 'open' and v.last_in_at is not null
                    and (v.last_out_at is null or v.last_out_at < v.last_in_at)) as awaiting_reply,
                (select count(*) from v where v.status = 'closed' and v.closed_at >= ${from} and v.closed_at < ${to}) as closed`,
        p.values)).rows[0]!;

      // Séries por dia (no fuso da empresa).
      const daily = (await q.query<{ day: string; conversations: number; avg_response: number | null }>(
        `${base}, days as (
           select generate_series((${from}::timestamptz at time zone ${tzp})::date, ((${to}::timestamptz - interval '1 second') at time zone ${tzp})::date, interval '1 day')::date as day)
         select to_char(d.day, 'YYYY-MM-DD') as day,
                (select count(distinct (m.contact_id, m.channel)) from m where m.created_at >= ${from} and m.local_at::date = d.day)::int as conversations,
                (select round(avg(extract(epoch from answered_at - created_at)))::int from turns where answered_at is not null and (created_at at time zone ${tzp})::date = d.day) as avg_response
           from days d order by d.day`, p.values)).rows;

      // Mapa de calor: mensagens recebidas por dia e hora.
      const heat = (await q.query<{ day: string; hour: number; n: number }>(
        `${base}
         select to_char(m.local_at::date, 'YYYY-MM-DD') as day, extract(hour from m.local_at)::int as hour, count(*)::int as n
           from m where m.direction = 'in' and m.created_at >= ${from} group by 1, 2`, p.values)).rows;

      // Canais.
      const channels = (await q.query<{ channel: string; conversations: number; received: number; sent: number; avg_response: number | null; deal_value: string }>(
        `${base}
         select x.channel,
                (select count(distinct m.contact_id) from m where m.channel = x.channel and m.created_at >= ${from})::int as conversations,
                (select count(*) from m where m.channel = x.channel and m.direction = 'in' and m.created_at >= ${from})::int as received,
                (select count(*) from m where m.channel = x.channel and m.direction = 'out' and m.created_at >= ${from})::int as sent,
                (select round(avg(extract(epoch from answered_at - created_at)))::int from turns where turns.channel = x.channel and answered_at is not null) as avg_response,
                coalesce((select sum(d.value_cents) from deals d where d.status = 'open' and d.contact_id in
                  (select distinct m.contact_id from m where m.channel = x.channel and m.created_at >= ${from})), 0)::text as deal_value
           from (values ('whatsapp'), ('email')) x(channel)`, p.values)).rows.filter((r) => r.conversations > 0);

      // Atendentes.
      const agents = (await q.query<{ id: string; name: string; active: number; sent: number; answered: number; avg_response: number | null; closed: number }>(
        `${base}
         select mb.id, u.name,
                (select count(*) from v where v.assignee_membership_id = mb.id and v.status in ('open', 'waiting'))::int as active,
                (select count(*) from m where m.sent_by = mb.id and m.direction = 'out' and m.created_at >= ${from})::int as sent,
                (select count(*) from turns where turns.sent_by = mb.id)::int as answered,
                (select round(avg(extract(epoch from answered_at - created_at)))::int from turns where turns.sent_by = mb.id) as avg_response,
                (select count(*) from v where v.assignee_membership_id = mb.id and v.status = 'closed' and v.closed_at >= ${from} and v.closed_at < ${to})::int as closed
           from memberships mb join users u on u.id = mb.user_id
          where mb.status = 'active'
            and (exists (select 1 from v where v.assignee_membership_id = mb.id) or exists (select 1 from m where m.sent_by = mb.id and m.created_at >= ${from}))
          order by answered desc, sent desc, u.name`, p.values)).rows;

      // Funil das conversas: contatos com conversa no período e negócio aberto.
      const funnel = (await q.query<{ total: number; with_deal: number; deals: number; value: string }>(
        `${base}, cs as (select distinct m.contact_id from m where m.created_at >= ${from})
         select (select count(*) from cs)::int as total,
                (select count(*) from cs where exists (select 1 from deals d where d.contact_id = cs.contact_id and d.status = 'open'))::int as with_deal,
                (select count(*) from deals d where d.status = 'open' and d.contact_id in (select contact_id from cs))::int as deals,
                coalesce((select sum(d.value_cents) from deals d where d.status = 'open' and d.contact_id in (select contact_id from cs)), 0)::text as value`,
        p.values)).rows[0]!;

      // Follow-ups: tarefas em aberto (no alcance de tarefas).
      let followUps = { open: 0, overdue: 0 };
      const ar = tryReach(actor, 'tasks:manage');
      if (ar) {
        const pa = new Params();
        const w = [reachSql(pa, 'a', ar), `a.status = 'open'`];
        if (f.assigneeId) w.push(`a.owner_membership_id = ${pa.add(f.assigneeId)}`);
        const r = (await q.query<{ open: number; overdue: number }>(
          `select count(*)::int as open, count(*) filter (where coalesce(a.ends_at, a.starts_at) < now())::int as overdue
             from activities a where ${w.join(' and ')}`, pa.values)).rows[0]!;
        followUps = r;
      }

      const num = (v: string | null | undefined) => Number(v ?? 0);
      const avg = k.avg_response === null ? null : Math.round(Number(k.avg_response));
      return {
        period: { from: f.from, to: f.to, timezone: tz },
        thresholds: { okSeconds: RESPONSE_OK_S, warnSeconds: RESPONSE_WARN_S },
        now: { active: num(k.active), unassigned: num(k.unassigned), awaitingReply: num(k.awaiting_reply) },
        messages: { received: num(k.received), sent: num(k.sent) },
        response: { averageSeconds: avg, answered: num(k.answered), unanswered: num(k.unanswered) },
        closed: num(k.closed),
        followUps,
        daily: daily.map((d) => ({ day: d.day, conversations: d.conversations, averageResponseSeconds: d.avg_response })),
        heatmap: heat,
        channels: channels.map((c) => ({ channel: c.channel, conversations: c.conversations, received: c.received, sent: c.sent, averageResponseSeconds: c.avg_response, openDealValueCents: Number(c.deal_value) })),
        agents: agents.map((a) => ({ id: a.id, name: a.name, active: a.active, sent: a.sent, answered: a.answered, averageResponseSeconds: a.avg_response, closed: a.closed })),
        funnel: {
          conversations: funnel.total, withOpenDeal: funnel.with_deal, rate: funnel.total ? funnel.with_deal / funnel.total : null,
          openDeals: funnel.deals, openValueCents: Number(funnel.value), averageTicketCents: funnel.deals ? Math.round(Number(funnel.value) / funnel.deals) : null,
        },
      };
    });
  }
}
