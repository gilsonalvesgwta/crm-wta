import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Db } from '../infra/db.js';
import { contactOwnExtra } from './contacts.service.js';
import { dealOwnExtra } from './deals.service.js';
import { pipelineAccessSql } from './pipelines.service.js';
import { Params, reachSql, tryReach } from './sql.js';

/**
 * Indicadores iniciais. Cada bloco usa o alcance da permissão correspondente:
 * quem vê só os próprios negócios vê os números dos próprios negócios. Bloco
 * sem permissão não aparece.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async summary(actor: Actor, f: { from: string; to: string; pipelineId?: string; ownerId?: string }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const out: Record<string, unknown> = { period: { from: f.from, to: f.to } };

      const dr = tryReach(actor, 'deals:view');
      if (dr) {
        const p = new Params();
        const where = [reachSql(p, 'd', dr, dealOwnExtra), `exists (select 1 from pipelines pl where pl.id = d.pipeline_id and ${pipelineAccessSql(p, actor, 'pl')})`];
        if (f.pipelineId) where.push(`d.pipeline_id = ${p.add(f.pipelineId)}`);
        if (f.ownerId) where.push(`d.owner_membership_id = ${p.add(f.ownerId)}`);
        const from = p.add(f.from);
        const to = p.add(f.to);
        const w = where.join(' and ');
        const k = (await q.query<Record<string, string>>(
          `select count(*) filter (where d.status = 'open') as open_count,
                  coalesce(sum(d.value_cents) filter (where d.status = 'open'), 0) as open_value,
                  coalesce(sum(d.value_cents * s.probability / 100.0) filter (where d.status = 'open'), 0)::bigint as weighted_value,
                  count(*) filter (where d.status = 'won' and d.closed_at >= ${from} and d.closed_at < ${to}) as won_count,
                  coalesce(sum(d.value_cents) filter (where d.status = 'won' and d.closed_at >= ${from} and d.closed_at < ${to}), 0) as won_value,
                  count(*) filter (where d.status = 'lost' and d.closed_at >= ${from} and d.closed_at < ${to}) as lost_count,
                  count(*) filter (where d.created_at >= ${from} and d.created_at < ${to}) as created_count,
                  count(*) filter (where d.status = 'open' and s.rotting_days is not null
                    and greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at)) < now() - make_interval(days => s.rotting_days)) as stalled_count
             from deals d join pipeline_stages s on s.id = d.stage_id where ${w}`, p.values)).rows[0]!;
        const won = Number(k.won_count);
        const lost = Number(k.lost_count);
        const byStage = f.pipelineId
          ? (await q.query(
            `select s.id, s.name, s.color, s.kind, count(d.id)::int as count, coalesce(sum(d.value_cents), 0)::bigint::text as "valueCents"
               from pipeline_stages s left join deals d on d.stage_id = s.id and d.status = 'open' and ${w}
              where s.pipeline_id = ${p.add(f.pipelineId)} and s.kind = 'open' group by s.id order by s.position`, p.values)).rows
          : [];
        const lostReasons = (await q.query(
          `select coalesce(r.name, 'Sem motivo') as name, count(*)::int as count
             from deals d left join outcome_reasons r on r.id = d.outcome_reason_id
            where ${w} and d.status = 'lost' and d.closed_at >= ${from} and d.closed_at < ${to}
            group by 1 order by 2 desc limit 6`, p.values)).rows;
        out.deals = {
          openCount: Number(k.open_count), openValueCents: Number(k.open_value), weightedValueCents: Number(k.weighted_value),
          wonCount: won, wonValueCents: Number(k.won_value), lostCount: lost, createdCount: Number(k.created_count),
          stalledCount: Number(k.stalled_count),
          winRate: won + lost > 0 ? won / (won + lost) : null,
          averageWonCents: won > 0 ? Math.round(Number(k.won_value) / won) : null,
          byStage: byStage.map((x) => ({ ...(x as Record<string, unknown>), valueCents: Number((x as { valueCents: string }).valueCents) })),
          lostReasons,
        };
      }

      const lr = tryReach(actor, 'leads:view');
      if (lr) {
        const p = new Params();
        const where = [reachSql(p, 'l', lr)];
        if (f.ownerId) where.push(`l.owner_membership_id = ${p.add(f.ownerId)}`);
        const from = p.add(f.from);
        const to = p.add(f.to);
        const w = where.join(' and ');
        const k = (await q.query<Record<string, string>>(
          `select count(*) filter (where l.created_at >= ${from} and l.created_at < ${to}) as created,
                  count(*) filter (where l.qualified_at >= ${from} and l.qualified_at < ${to}) as qualified,
                  count(*) filter (where l.status in ('new', 'working')) as active,
                  count(*) filter (where l.status = 'new' and l.owner_membership_id is null) as unassigned
             from leads l where ${w}`, p.values)).rows[0]!;
        const bySource = (await q.query(
          `select coalesce(nullif(l.source, ''), 'Sem origem') as source, count(*)::int as count,
                  count(*) filter (where l.status = 'qualified')::int as qualified
             from leads l where ${w} and l.created_at >= ${from} and l.created_at < ${to}
            group by 1 order by 2 desc limit 8`, p.values)).rows;
        const created = Number(k.created);
        out.leads = {
          created, qualified: Number(k.qualified), active: Number(k.active), unassigned: Number(k.unassigned),
          conversionRate: created > 0 ? Number(k.qualified) / created : null, bySource,
        };
      }

      const ar = tryReach(actor, 'tasks:manage');
      if (ar) {
        const p = new Params();
        const where = [reachSql(p, 'a', ar), `a.status = 'open'`];
        if (f.ownerId) where.push(`a.owner_membership_id = ${p.add(f.ownerId)}`);
        const tz = p.add((await q.query<{ timezone: string }>('select timezone from tenants')).rows[0]!.timezone);
        const k = (await q.query<Record<string, string>>(
          `select count(*) filter (where coalesce(a.ends_at, a.starts_at) < now()) as overdue,
                  count(*) filter (where (a.starts_at at time zone ${tz})::date = (now() at time zone ${tz})::date) as today,
                  count(*) filter (where a.starts_at is null) as undated
             from activities a where ${where.join(' and ')}`, p.values)).rows[0]!;
        out.activities = { overdue: Number(k.overdue), today: Number(k.today), undated: Number(k.undated) };
      }

      const cr = tryReach(actor, 'contacts:view');
      if (cr) {
        const p = new Params();
        const w = reachSql(p, 'c', cr, contactOwnExtra);
        const k = (await q.query<{ n: string; total: string }>(
          `select count(*) filter (where c.created_at >= ${p.add(f.from)} and c.created_at < ${p.add(f.to)}) as n, count(*) as total
             from contacts c where ${w} and c.anonymized_at is null`, p.values)).rows[0]!;
        out.contacts = { created: Number(k.n), total: Number(k.total) };
      }
      return out;
    });
  }
}
