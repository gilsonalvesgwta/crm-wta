import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { occurrences, validateRecurrence, type Recurrence } from '../domain/recurrence.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { memberJson } from './fields.js';
import { Params, assertOwnerInReach, assertTeamInReach, reachOf, reachSql, timeline, type Reach } from './sql.js';

export type ActivityInput = {
  type?: 'task' | 'call' | 'meeting' | 'email' | 'visit' | 'other';
  title?: string;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  allDay?: boolean;
  priority?: 'low' | 'normal' | 'high';
  ownerId?: string;
  teamId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  reminderMinutes?: number | null;
};

export type CallOutcome = 'held' | 'no_show' | 'rescheduled';

/** Quanto à frente as ocorrências de uma série ficam criadas. */
const HORIZON_DAYS = 366;

const COLS = `
  a.id, a.type, a.title, a.description, a.starts_at as "startsAt", a.ends_at as "endsAt", a.all_day as "allDay", a.status,
  a.done_at as "doneAt", a.outcome, a.priority, a.reminder_minutes as "reminderMinutes", a.series_id as "seriesId",
  a.series_index as "seriesIndex", a.created_at as "createdAt", a.team_id as "teamId",
  (a.status = 'open' and a.starts_at is not null and coalesce(a.ends_at, a.starts_at) < now()) as overdue,
  ${memberJson('a.owner_membership_id')} as owner,
  (select json_build_object('id', c.id, 'name', c.name) from contacts c where c.id = a.contact_id) as contact,
  (select json_build_object('id', o.id, 'name', o.name) from organizations o where o.id = a.organization_id) as organization,
  (select json_build_object('id', d.id, 'title', d.title) from deals d where d.id = a.deal_id) as deal,
  (select json_build_object('id', l.id, 'title', l.title) from leads l where l.id = a.lead_id) as lead,
  (select s.rule from activity_series s where s.id = a.series_id) as recurrence`;

type ActivityRow = {
  id: string; owner_membership_id: string; team_id: string | null; series_id: string | null; series_index: number | null;
  starts_at: Date | null; ends_at: Date | null; status: string; contact_id: string | null; organization_id: string | null;
  deal_id: string | null; lead_id: string | null; title: string;
};

@Injectable()
export class ActivitiesService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async visible(q: Q, r: Reach, id: string, lock = false): Promise<ActivityRow> {
    const p = new Params();
    const row = await q.query<ActivityRow>(
      `select a.id, a.owner_membership_id, a.team_id, a.series_id, a.series_index, a.starts_at, a.ends_at, a.status,
              a.contact_id, a.organization_id, a.deal_id, a.lead_id, a.title
         from activities a where a.id = ${p.add(id)} and ${reachSql(p, 'a', r)} ${lock ? 'for update of a' : ''}`, p.values);
    if (!row.rows[0]) throw Problem.notFound('Atividade não encontrada.');
    return row.rows[0];
  }

  /**
   * Atividades no intervalo [from, to), para a agenda; ou, sem intervalo, as
   * pendentes (com e sem data), para a lista de tarefas.
   */
  async list(actor: Actor, f: {
    from?: string; to?: string; ownerId?: string; teamId?: string; status?: 'open' | 'done' | 'all'; type?: string;
    contactId?: string; dealId?: string; leadId?: string; organizationId?: string; due?: 'overdue' | 'today' | 'week' | 'none'; limit: number;
  }) {
    const r = reachOf(actor, 'tasks:manage');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const where = [reachSql(p, 'a', r)];
      if (f.from) where.push(`coalesce(a.ends_at, a.starts_at) >= ${p.add(f.from)}`);
      if (f.to) where.push(`a.starts_at < ${p.add(f.to)}`);
      if (f.ownerId) where.push(`a.owner_membership_id = ${p.add(f.ownerId)}`);
      if (f.teamId) where.push(`a.team_id = ${p.add(f.teamId)}`);
      if (f.status && f.status !== 'all') where.push(`a.status = ${p.add(f.status)}`);
      if (f.type) where.push(`a.type = ${p.add(f.type)}`);
      if (f.contactId) where.push(`a.contact_id = ${p.add(f.contactId)}`);
      if (f.dealId) where.push(`a.deal_id = ${p.add(f.dealId)}`);
      if (f.leadId) where.push(`a.lead_id = ${p.add(f.leadId)}`);
      if (f.organizationId) where.push(`a.organization_id = ${p.add(f.organizationId)}`);
      if (f.due) {
        const tz = await this.tz(q);
        const tzp = p.add(tz);
        const today = `(now() at time zone ${tzp})::date`;
        if (f.due === 'overdue') where.push(`a.starts_at < now()`);
        if (f.due === 'today') where.push(`(a.starts_at at time zone ${tzp})::date = ${today}`);
        if (f.due === 'week') where.push(`(a.starts_at at time zone ${tzp})::date between ${today} and ${today} + 6`);
        if (f.due === 'none') where.push('a.starts_at is null');
      }
      const order = f.from ? 'a.starts_at, a.id' : 'a.starts_at nulls last, a.priority desc, a.created_at';
      const rows = await q.query(`select ${COLS} from activities a where ${where.join(' and ')} order by ${order} limit ${p.add(f.limit)}`, p.values);
      return rows.rows;
    });
  }

  async get(actor: Actor, id: string) {
    const r = reachOf(actor, 'tasks:manage');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      return this.detail(q, id);
    });
  }

  async detail(q: Q, id: string) {
    return (await q.query(`select ${COLS} from activities a where a.id = $1`, [id])).rows[0];
  }

  private async tz(q: Q): Promise<string> {
    return (await q.query<{ timezone: string }>('select timezone from tenants')).rows[0]!.timezone;
  }

  private async checkLinks(q: Q, input: ActivityInput): Promise<void> {
    const checks: [string | null | undefined, string, string][] = [
      [input.contactId, 'contacts', 'contactId'], [input.organizationId, 'organizations', 'organizationId'],
      [input.dealId, 'deals', 'dealId'], [input.leadId, 'leads', 'leadId'],
    ];
    for (const [id, table, field] of checks) {
      if (!id) continue;
      const r = await q.query(`select 1 from ${table} where id = $1`, [id]);
      if (!r.rowCount) throw Problem.badRequest('Vínculo inválido.', [{ field, message: 'Registro não encontrado.' }]);
    }
  }

  private checkTimes(input: ActivityInput): void {
    if (input.endsAt && !input.startsAt) throw Problem.badRequest('Informe o início.', [{ field: 'startsAt', message: 'Informe o início.' }]);
    if (input.startsAt && input.endsAt && new Date(input.endsAt) < new Date(input.startsAt)) {
      throw Problem.badRequest('O fim é antes do início.', [{ field: 'endsAt', message: 'O fim precisa ser depois do início.' }]);
    }
    if (input.reminderMinutes != null && !input.startsAt) {
      throw Problem.badRequest('Lembrete sem data.', [{ field: 'reminderMinutes', message: 'Defina a data para ter lembrete.' }]);
    }
  }

  private async insert(q: Q, actor: Actor, a: ActivityInput & { title: string; ownerId: string }, series?: { id: string; index: number }): Promise<string> {
    const r = await q.query<{ id: string }>(
      `insert into activities (tenant_id, type, title, description, starts_at, ends_at, all_day, priority, owner_membership_id, team_id,
                               contact_id, organization_id, deal_id, lead_id, series_id, series_index, reminder_minutes, created_by)
       values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
      [a.type ?? 'task', a.title, a.description ?? null, a.startsAt ?? null, a.endsAt ?? null, a.allDay ?? false, a.priority ?? 'normal',
        a.ownerId, a.teamId ?? null, a.contactId ?? null, a.organizationId ?? null, a.dealId ?? null, a.leadId ?? null,
        series?.id ?? null, series?.index ?? null, a.reminderMinutes ?? null, actor.membershipId]);
    return r.rows[0]!.id;
  }

  async create(actor: Actor, input: ActivityInput & { title: string }, recurrence?: Recurrence) {
    const r = reachOf(actor, 'tasks:manage');
    this.checkTimes(input);
    if (recurrence) {
      const err = validateRecurrence(recurrence);
      if (err) throw Problem.badRequest(err, [{ field: 'recurrence', message: err }]);
      if (!input.startsAt) throw Problem.badRequest('Defina a data para repetir.', [{ field: 'startsAt', message: 'Atividade recorrente precisa de data.' }]);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const ownerId = input.ownerId ?? r.me;
      await assertOwnerInReach(q, r, ownerId);
      await assertTeamInReach(q, r, input.teamId);
      await this.checkLinks(q, input);
      const base = { ...input, ownerId };
      let id: string;
      if (!recurrence) {
        id = await this.insert(q, actor, base);
      } else {
        const tz = await this.tz(q);
        const start = new Date(input.startsAt!);
        const durationMs = input.endsAt ? new Date(input.endsAt).getTime() - start.getTime() : null;
        // Cria as ocorrências do próximo ano (contado do início, se for no futuro).
        const horizon = new Date(Math.max(Date.now(), start.getTime()) + HORIZON_DAYS * 86_400_000);
        const occ = occurrences(start, tz, recurrence, horizon);
        const s = await q.query<{ id: string }>(
          `insert into activity_series (tenant_id, rule, timezone, horizon_until, ended)
           values (app.tenant_id(), $1, $2, $3, $4) returning id`,
          [JSON.stringify({ ...recurrence, dtstart: start.toISOString(), durationMs }), tz,
            occ.starts.at(-1) ?? start, occ.ended]);
        const seriesId = s.rows[0]!.id;
        id = '';
        for (const [i, at] of occ.starts.entries()) {
          const oid = await this.insert(q, actor, {
            ...base, startsAt: at.toISOString(), endsAt: durationMs === null ? null : new Date(at.getTime() + durationMs).toISOString(),
          }, { id: seriesId, index: i });
          if (i === 0) id = oid;
        }
      }
      await timeline(q, actor, 'activity.created', { contactId: input.contactId, organizationId: input.organizationId, dealId: input.dealId, leadId: input.leadId },
        { activityId: id, type: input.type ?? 'task', title: input.title });
      return this.detail(q, id);
    });
  }

  /**
   * Edita uma atividade. Numa série, `scope = 'following'` aplica a esta e às
   * seguintes; mudar o horário desloca todas pelo mesmo intervalo.
   */
  async update(actor: Actor, id: string, input: ActivityInput, scope: 'this' | 'following' = 'this') {
    const r = reachOf(actor, 'tasks:manage');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id, true);
      if (input.ownerId !== undefined && input.ownerId !== cur.owner_membership_id) await assertOwnerInReach(q, r, input.ownerId);
      if (input.teamId !== undefined) await assertTeamInReach(q, r, input.teamId);
      await this.checkLinks(q, input);
      const shift = input.startsAt !== undefined && cur.starts_at && input.startsAt
        ? new Date(input.startsAt).getTime() - cur.starts_at.getTime() : null;
      // Mudar só o início desloca o fim junto: a duração se mantém.
      const endsAt = input.endsAt !== undefined ? input.endsAt
        : cur.ends_at ? (shift !== null ? new Date(cur.ends_at.getTime() + shift).toISOString() : cur.ends_at.toISOString()) : null;
      const startsAt = input.startsAt !== undefined ? input.startsAt : cur.starts_at?.toISOString() ?? null;
      this.checkTimes({ startsAt, endsAt, reminderMinutes: input.reminderMinutes ?? undefined });
      if (input.startsAt === null && endsAt) {
        throw Problem.badRequest('Informe o início.', [{ field: 'startsAt', message: 'Atividade com fim precisa de início.' }]);
      }
      const targets = scope === 'following' && cur.series_id
        ? (await q.query<{ id: string }>(
          `select id from activities where series_id = $1 and series_index >= $2 and status = 'open' for update`,
          [cur.series_id, cur.series_index])).rows.map((x) => x.id)
        : [id];
      const p = new Params();
      const sets: string[] = [];
      const put = (col: string, v: unknown, cast = '') => { if (v !== undefined) sets.push(`${col} = ${p.add(v)}${cast}`); };
      put('type', input.type);
      put('title', input.title);
      put('description', input.description);
      put('all_day', input.allDay);
      put('priority', input.priority);
      put('owner_membership_id', input.ownerId, '::uuid');
      put('team_id', input.teamId, '::uuid');
      put('contact_id', input.contactId, '::uuid');
      put('organization_id', input.organizationId, '::uuid');
      put('deal_id', input.dealId, '::uuid');
      put('lead_id', input.leadId, '::uuid');
      put('reminder_minutes', input.reminderMinutes, '::int');
      if (targets.length > 1 && shift !== null) {
        const ms = p.add(shift);
        sets.push(`starts_at = starts_at + make_interval(secs => ${ms}::float8 / 1000)`);
        if (input.endsAt !== undefined) {
          const dur = input.endsAt && input.startsAt ? new Date(input.endsAt).getTime() - new Date(input.startsAt).getTime() : null;
          sets.push(`ends_at = ${dur === null ? 'null' : `starts_at + make_interval(secs => (${ms}::float8 + ${p.add(dur)}::float8) / 1000)`}`);
        } else {
          sets.push(`ends_at = ends_at + make_interval(secs => ${ms}::float8 / 1000)`);
        }
      } else {
        put('starts_at', input.startsAt, '::timestamptz');
        if (input.endsAt !== undefined || shift !== null) put('ends_at', endsAt, '::timestamptz');
      }
      if (sets.length) {
        const res = await q.query(`update activities set ${sets.join(', ')} where id = any(${p.add(targets)}::uuid[])`, p.values)
          .catch((err: unknown) => {
            if ((err as { code?: string }).code === '23514') {
              throw Problem.badRequest('Datas inválidas.', [{ field: 'endsAt', message: 'Confira o início e o fim.' }]);
            }
            throw err;
          });
        void res;
      }
      return this.detail(q, id);
    });
  }

  /**
   * Conclui, reabre ou cancela. Ligação e reunião concluídas guardam o resultado
   * (realizada, não compareceu, remarcada); sem resultado informado, conta como realizada.
   */
  async setStatus(actor: Actor, id: string, status: 'open' | 'done' | 'canceled', outcome?: CallOutcome) {
    const r = reachOf(actor, 'tasks:manage');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id, true);
      await q.query(
        `update activities set status = $2, done_at = case when $2 = 'done' then coalesce(done_at, now()) else null end,
                outcome = case when $2 = 'done' and type in ('call', 'meeting') then coalesce($3, outcome, 'held') end
          where id = $1`,
        [id, status, outcome ?? null]);
      if (status === 'done' && cur.status !== 'done') {
        // A última atividade concluída marca o "último contato" dos registros ligados.
        if (cur.contact_id) await q.query('update contacts set last_activity_at = now() where id = $1', [cur.contact_id]);
        if (cur.organization_id) await q.query('update organizations set last_activity_at = now() where id = $1', [cur.organization_id]);
        if (cur.deal_id) await q.query('update deals set last_activity_at = now() where id = $1', [cur.deal_id]);
        if (cur.lead_id) {
          await q.query(`update leads set last_activity_at = now(), status = case when status = 'new' then 'working' else status end where id = $1`, [cur.lead_id]);
        }
        await timeline(q, actor, 'activity.done', { contactId: cur.contact_id, organizationId: cur.organization_id, dealId: cur.deal_id, leadId: cur.lead_id },
          { activityId: id, title: cur.title });
      }
      return this.detail(q, id);
    });
  }

  async remove(actor: Actor, id: string, scope: 'this' | 'following' = 'this'): Promise<void> {
    const r = reachOf(actor, 'tasks:manage');
    await this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id, true);
      if (scope === 'following' && cur.series_id) {
        await q.query('delete from activities where series_id = $1 and series_index >= $2', [cur.series_id, cur.series_index]);
        // A série termina aqui: o despachante não cria mais ocorrências.
        await q.query('update activity_series set ended = true where id = $1', [cur.series_id]);
      } else {
        await q.query('delete from activities where id = $1', [id]);
      }
    });
  }

  /**
   * Estende uma série até o horizonte. Chamado pelo despachante, no contexto
   * da empresa. Copia os dados da última ocorrência.
   */
  async extendSeries(q: Q, seriesId: string): Promise<number> {
    const s = await q.query<{ rule: Recurrence & { dtstart: string; durationMs: number | null }; timezone: string; ended: boolean }>(
      'select rule, timezone, ended from activity_series where id = $1 for update', [seriesId]);
    const series = s.rows[0];
    if (!series || series.ended) return 0;
    const last = await q.query<{
      series_index: number; type: string; title: string; description: string | null; all_day: boolean; priority: string;
      owner_membership_id: string; team_id: string | null; contact_id: string | null; organization_id: string | null;
      deal_id: string | null; lead_id: string | null; reminder_minutes: number | null; created_by: string | null;
    }>('select * from activities where series_id = $1 order by series_index desc limit 1', [seriesId]);
    const tpl = last.rows[0];
    if (!tpl) {
      await q.query('update activity_series set ended = true where id = $1', [seriesId]);
      return 0;
    }
    const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000);
    const occ = occurrences(new Date(series.rule.dtstart), series.timezone, series.rule, horizon, { skip: tpl.series_index + 1 });
    for (const [i, at] of occ.starts.entries()) {
      await q.query(
        `insert into activities (tenant_id, type, title, description, starts_at, ends_at, all_day, priority, owner_membership_id, team_id,
                                 contact_id, organization_id, deal_id, lead_id, series_id, series_index, reminder_minutes, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [tpl.type, tpl.title, tpl.description, at, series.rule.durationMs == null ? null : new Date(at.getTime() + series.rule.durationMs),
          tpl.all_day, tpl.priority, tpl.owner_membership_id, tpl.team_id, tpl.contact_id, tpl.organization_id, tpl.deal_id, tpl.lead_id,
          seriesId, tpl.series_index + 1 + i, tpl.reminder_minutes, tpl.created_by]);
    }
    await q.query('update activity_series set horizon_until = $2, ended = $3 where id = $1', [seriesId, horizon, occ.ended]);
    return occ.starts.length;
  }

  // ---- Notificações -------------------------------------------------------------------

  async notifications(actor: Actor, unreadOnly: boolean) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const rows = await q.query(
        `select id, kind, title, body, link, created_at as "createdAt", read_at as "readAt"
           from notifications where membership_id = $1 and ($2 = false or read_at is null)
          order by created_at desc limit 50`, [actor.membershipId, unreadOnly]);
      const unread = await q.query<{ n: number }>('select count(*)::int as n from notifications where membership_id = $1 and read_at is null', [actor.membershipId]);
      return { items: rows.rows, unread: unread.rows[0]!.n };
    });
  }

  async markRead(actor: Actor, ids: string[] | 'all'): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      if (ids === 'all') await q.query('update notifications set read_at = now() where membership_id = $1 and read_at is null', [actor.membershipId]);
      else await q.query('update notifications set read_at = now() where id = any($1::uuid[]) and read_at is null', [ids]);
    });
  }
}
