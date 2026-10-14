import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { Problem, type FieldError } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { checkTags, customFor, memberJson } from './fields.js';
import { PipelinesService, pipelineAccessSql } from './pipelines.service.js';
import {
  Params, assertOwnerInReach, assertTeamInReach, changedFields, likeEscape, pageOf, reachOf, reachSql, timeline,
  type Page, type Reach,
} from './sql.js';

export type DealInput = {
  pipelineId?: string;
  stageId?: string;
  title?: string;
  valueCents?: number;
  currency?: string;
  contactId?: string | null;
  organizationId?: string | null;
  ownerId?: string | null;
  teamId?: string | null;
  expectedCloseDate?: string | null;
  tagIds?: string[];
  participantIds?: string[];
  custom?: Record<string, unknown>;
};

export type ItemInput = { productId?: string | null; name?: string; quantity: number; unitPriceCents?: number; discountCents?: number };

export type DealFilters = {
  pipelineId?: string; stageId?: string; status?: 'open' | 'won' | 'lost' | 'all'; ownerId?: string; tagId?: string; q?: string;
  contactId?: string; organizationId?: string; closeFrom?: string; closeTo?: string;
  sort: 'created' | 'value' | 'close' | 'activity' | 'title'; dir: 'asc' | 'desc'; page: number; pageSize: number;
};

/** Além do responsável: negócios em que a pessoa participa. */
export const dealOwnExtra = (me: string) =>
  `exists (select 1 from deal_participants dp where dp.deal_id = d.id and dp.membership_id = ${me})`;

const CARD = `
  d.id, d.title, d.value_cents as "valueCents", d.currency, d.status, d.pipeline_id as "pipelineId", d.stage_id as "stageId",
  d.expected_close_date as "expectedCloseDate", d.stage_entered_at as "stageEnteredAt", d.closed_at as "closedAt",
  d.last_activity_at as "lastActivityAt", d.created_at as "createdAt", d.updated_at as "updatedAt",
  ${memberJson('d.owner_membership_id')} as owner,
  (select json_build_object('id', c.id, 'name', c.name) from contacts c where c.id = d.contact_id) as contact,
  (select json_build_object('id', o.id, 'name', o.name) from organizations o where o.id = d.organization_id) as organization,
  coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by lower(t.name))
            from deal_tags dt join tags t on t.id = dt.tag_id where dt.deal_id = d.id), '[]') as tags,
  (select count(*)::int from activities a where a.deal_id = d.id and a.status = 'open') as "openActivities",
  (select min(a.starts_at) from activities a where a.deal_id = d.id and a.status = 'open' and a.starts_at is not null) as "nextActivityAt",
  (s.rotting_days is not null and d.status = 'open'
     and greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at)) < now() - make_interval(days => s.rotting_days)) as rotting`;

type DealRow = {
  id: string; pipeline_id: string; stage_id: string; status: string; title: string; value_cents: string; contact_id: string | null;
  organization_id: string | null; owner_membership_id: string | null; team_id: string | null; expected_close_date: string | null;
  custom: Record<string, unknown>; lead_id: string | null;
};

@Injectable()
export class DealsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(PipelinesService) private readonly pipelines: PipelinesService,
  ) {}

  private scope(p: Params, actor: Actor, r: Reach): string {
    return `${reachSql(p, 'd', r, dealOwnExtra)} and exists (select 1 from pipelines pl where pl.id = d.pipeline_id and ${pipelineAccessSql(p, actor, 'pl')})`;
  }

  async visible(q: Q, actor: Actor, r: Reach, id: string, lock = false): Promise<DealRow> {
    const p = new Params();
    const row = await q.query<DealRow>(
      `select d.id, d.pipeline_id, d.stage_id, d.status, d.title, d.value_cents, d.contact_id, d.organization_id,
              d.owner_membership_id, d.team_id, d.expected_close_date::text, d.custom, d.lead_id
         from deals d where d.id = ${p.add(id)} and ${this.scope(p, actor, r)} ${lock ? 'for update of d' : ''}`, p.values);
    if (!row.rows[0]) throw Problem.notFound('Negócio não encontrado.');
    return row.rows[0];
  }

  // ---- Leitura ----------------------------------------------------------------

  /** Quadro do funil: etapas com totais e os cartões (até 100 por etapa). */
  async board(actor: Actor, pipelineId: string, f: { ownerId?: string; tagId?: string; q?: string; status?: 'open' | 'all' }) {
    const r = reachOf(actor, 'deals:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const pipeline = await this.pipelines.getIn(q, actor, pipelineId);
      const p = new Params();
      const where = [`d.pipeline_id = ${p.add(pipelineId)}`, this.scope(p, actor, r)];
      if (f.ownerId) where.push(f.ownerId === 'none' ? 'd.owner_membership_id is null' : `d.owner_membership_id = ${p.add(f.ownerId)}`);
      if (f.tagId) where.push(`exists (select 1 from deal_tags dt where dt.deal_id = d.id and dt.tag_id = ${p.add(f.tagId)})`);
      if (f.q) where.push(`app.norm(d.title) like app.norm(${p.add(`%${likeEscape(f.q.trim().toLowerCase())}%`)})`);
      // Ganhos e perdidos aparecem só dos últimos 30 dias, para o quadro não crescer sem fim.
      if (f.status !== 'all') where.push(`(d.status = 'open' or d.closed_at > now() - interval '30 days')`);
      const whereSql = where.join(' and ');
      const totals = await q.query<{ stage_id: string; n: number; total: string; weighted: string }>(
        `select d.stage_id, count(*)::int as n, coalesce(sum(d.value_cents), 0)::text as total,
                coalesce(sum(d.value_cents * s.probability / 100.0), 0)::bigint::text as weighted
           from deals d join pipeline_stages s on s.id = d.stage_id where ${whereSql} group by d.stage_id`, p.values);
      const cards = await q.query<{ stageId: string }>(
        `select * from (
           select ${CARD}, row_number() over (partition by d.stage_id order by d.stage_entered_at desc, d.id) as rn
             from deals d join pipeline_stages s on s.id = d.stage_id where ${whereSql}) x
          where rn <= 100`, p.values);
      const byStage = new Map<string, unknown[]>();
      for (const c of cards.rows) {
        const { rn: _rn, ...card } = c as Record<string, unknown> & { stageId: string };
        if (!byStage.has(c.stageId)) byStage.set(c.stageId, []);
        byStage.get(c.stageId)!.push({ ...card, valueCents: Number(card.valueCents) });
      }
      const t = new Map(totals.rows.map((x) => [x.stage_id, x]));
      const stages = (pipeline.stages as { id: string }[]).map((s) => ({
        ...s,
        count: t.get(s.id)?.n ?? 0,
        totalCents: Number(t.get(s.id)?.total ?? 0),
        weightedCents: Number(t.get(s.id)?.weighted ?? 0),
        deals: byStage.get(s.id) ?? [],
      }));
      return { pipeline: { ...pipeline, stages: undefined }, stages };
    });
  }

  async list(actor: Actor, f: DealFilters): Promise<Page<Record<string, unknown>>> {
    const r = reachOf(actor, 'deals:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const where = [this.scope(p, actor, r)];
      if (f.pipelineId) where.push(`d.pipeline_id = ${p.add(f.pipelineId)}`);
      if (f.stageId) where.push(`d.stage_id = ${p.add(f.stageId)}`);
      if (f.status && f.status !== 'all') where.push(`d.status = ${p.add(f.status)}`);
      if (f.ownerId) where.push(f.ownerId === 'none' ? 'd.owner_membership_id is null' : `d.owner_membership_id = ${p.add(f.ownerId)}`);
      if (f.tagId) where.push(`exists (select 1 from deal_tags dt where dt.deal_id = d.id and dt.tag_id = ${p.add(f.tagId)})`);
      if (f.contactId) where.push(`d.contact_id = ${p.add(f.contactId)}`);
      if (f.organizationId) where.push(`d.organization_id = ${p.add(f.organizationId)}`);
      if (f.closeFrom) where.push(`d.expected_close_date >= ${p.add(f.closeFrom)}::date`);
      if (f.closeTo) where.push(`d.expected_close_date <= ${p.add(f.closeTo)}::date`);
      if (f.q) where.push(`app.norm(d.title) like app.norm(${p.add(`%${likeEscape(f.q.trim().toLowerCase())}%`)})`);
      const dir = f.dir === 'asc' ? 'asc' : 'desc';
      const order = {
        created: `d.created_at ${dir}`, value: `d.value_cents ${dir}`, close: `d.expected_close_date ${dir} nulls last`,
        activity: `d.last_activity_at ${dir} nulls last`, title: `lower(d.title) ${dir}`,
      }[f.sort];
      const whereSql = where.join(' and ');
      const { limit, offset } = pageOf(f.page, f.pageSize);
      const total = await q.query<{ n: number; sum: string }>(
        `select count(*)::int as n, coalesce(sum(d.value_cents), 0)::text as sum from deals d where ${whereSql}`, p.values);
      const rows = await q.query(
        `select ${CARD},
                (select json_build_object('id', s2.id, 'name', s2.name, 'color', s2.color, 'kind', s2.kind) from pipeline_stages s2 where s2.id = d.stage_id) as stage,
                (select json_build_object('id', pl.id, 'name', pl.name) from pipelines pl where pl.id = d.pipeline_id) as pipeline
           from deals d join pipeline_stages s on s.id = d.stage_id
          where ${whereSql} order by ${order}, d.id limit ${p.add(limit)} offset ${p.add(offset)}`, p.values);
      return {
        items: rows.rows.map((x) => ({ ...(x as Record<string, unknown>), valueCents: Number((x as { valueCents: string }).valueCents) })),
        total: total.rows[0]!.n, totalValueCents: Number(total.rows[0]!.sum), page: f.page, pageSize: f.pageSize,
      } as Page<Record<string, unknown>>;
    });
  }

  async detail(q: Q, id: string) {
    const d = await q.query(
      `select ${CARD}, d.custom, d.team_id as "teamId", d.lead_id as "leadId", d.outcome_note as "outcomeNote",
              (select json_build_object('id', r.id, 'name', r.name, 'kind', r.kind) from outcome_reasons r where r.id = d.outcome_reason_id) as "outcomeReason",
              (select json_build_object('id', s2.id, 'name', s2.name, 'color', s2.color, 'kind', s2.kind, 'probability', s2.probability)
                 from pipeline_stages s2 where s2.id = d.stage_id) as stage,
              (select json_build_object('id', pl.id, 'name', pl.name) from pipelines pl where pl.id = d.pipeline_id) as pipeline,
              coalesce((select json_agg(json_build_object('id', m.id, 'name', u.name) order by lower(u.name))
                          from deal_participants dp join memberships m on m.id = dp.membership_id join users u on u.id = m.user_id
                         where dp.deal_id = d.id), '[]') as participants
         from deals d join pipeline_stages s on s.id = d.stage_id where d.id = $1`, [id]);
    const items = await q.query(
      `select id, product_id as "productId", name, quantity::float8 as quantity, unit_price_cents as "unitPriceCents",
              discount_cents as "discountCents", position
         from deal_items where deal_id = $1 order by position, created_at`, [id]);
    const history = await q.query(
      `select h.moved_at as "movedAt", h.seconds_in_previous as "secondsInPrevious",
              (select json_build_object('id', s.id, 'name', s.name) from pipeline_stages s where s.id = h.from_stage_id) as "from",
              (select json_build_object('id', s.id, 'name', s.name) from pipeline_stages s where s.id = h.to_stage_id) as "to",
              (select u.name from users u where u.id = h.moved_by) as "movedBy"
         from deal_stage_history h where h.deal_id = $1 order by h.moved_at desc, h.id limit 100`, [id]);
    const row = d.rows[0] as Record<string, unknown>;
    return {
      ...row,
      valueCents: Number(row.valueCents),
      items: (items.rows as { unitPriceCents: string; discountCents: string }[]).map((i) => ({
        ...i, unitPriceCents: Number(i.unitPriceCents), discountCents: Number(i.discountCents),
      })),
      history: history.rows,
    };
  }

  async get(actor: Actor, id: string) {
    const r = reachOf(actor, 'deals:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, actor, r, id);
      return this.detail(q, id);
    });
  }

  // ---- Regras de etapa ---------------------------------------------------------------

  /** Campos exigidos pela etapa que o negócio ainda não tem. */
  private async missingFor(q: Q, dealId: string, stageId: string): Promise<FieldError[]> {
    const s = await q.query<{ required_fields: string[] }>('select required_fields from pipeline_stages where id = $1', [stageId]);
    const required = s.rows[0]?.required_fields ?? [];
    if (!required.length) return [];
    const d = await q.query<{ value_cents: string; expected_close_date: string | null; contact_id: string | null; organization_id: string | null; custom: Record<string, unknown>; items: number }>(
      `select value_cents, expected_close_date, contact_id, organization_id, custom,
              (select count(*)::int from deal_items i where i.deal_id = d.id) as items
         from deals d where id = $1`, [dealId]);
    const deal = d.rows[0]!;
    const labels = await q.query<{ key: string; label: string }>("select key, label from custom_field_definitions where entity = 'deal'");
    const label = new Map(labels.rows.map((x) => [x.key, x.label]));
    const out: FieldError[] = [];
    for (const f of required) {
      if (f === 'value' && Number(deal.value_cents) <= 0) out.push({ field: 'valueCents', message: 'Informe o valor.' });
      else if (f === 'expected_close_date' && !deal.expected_close_date) out.push({ field: 'expectedCloseDate', message: 'Informe a previsão de fechamento.' });
      else if (f === 'contact' && !deal.contact_id) out.push({ field: 'contactId', message: 'Vincule um contato.' });
      else if (f === 'organization' && !deal.organization_id) out.push({ field: 'organizationId', message: 'Vincule uma organização.' });
      else if (f === 'products' && deal.items === 0) out.push({ field: 'items', message: 'Inclua ao menos um produto.' });
      else if (f.startsWith('custom.')) {
        const k = f.slice(7);
        const v = deal.custom[k];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
          out.push({ field: `custom.${k}`, message: `Preencha ${label.get(k) ?? k}.` });
        }
      }
    }
    return out;
  }

  private async stageOf(q: Q, pipelineId: string, stageId: string): Promise<{ id: string; kind: 'open' | 'won' | 'lost'; name: string }> {
    const r = await q.query<{ id: string; kind: 'open' | 'won' | 'lost'; name: string }>(
      'select id, kind, name from pipeline_stages where id = $1 and pipeline_id = $2', [stageId, pipelineId]);
    if (!r.rows[0]) throw Problem.badRequest('Etapa inválida.', [{ field: 'stageId', message: 'Escolha uma etapa deste funil.' }]);
    return r.rows[0];
  }

  // ---- Escrita ----------------------------------------------------------------------

  private async checkLinks(q: Q, input: DealInput): Promise<void> {
    if (input.contactId) {
      const c = await q.query('select 1 from contacts where id = $1', [input.contactId]);
      if (!c.rowCount) throw Problem.badRequest('Contato inválido.', [{ field: 'contactId', message: 'Escolha um contato da lista.' }]);
    }
    if (input.organizationId) {
      const o = await q.query('select 1 from organizations where id = $1', [input.organizationId]);
      if (!o.rowCount) throw Problem.badRequest('Organização inválida.', [{ field: 'organizationId', message: 'Escolha uma organização da lista.' }]);
    }
    for (const m of input.participantIds ?? []) {
      const r = await q.query("select 1 from memberships where id = $1 and status = 'active'", [m]);
      if (!r.rowCount) throw Problem.badRequest('Participante inválido.', [{ field: 'participantIds', message: 'Escolha pessoas ativas da empresa.' }]);
    }
  }

  async createIn(q: Q, actor: Actor, r: Reach, input: DealInput & { pipelineId: string; title: string }, leadId?: string): Promise<string> {
    const pipe = await this.pipelines.accessible(q, actor, input.pipelineId);
    if (pipe.archived) throw Problem.badRequest('Funil arquivado.', [{ field: 'pipelineId', message: 'Escolha um funil ativo.' }]);
    let stageId = input.stageId;
    if (!stageId) {
      const first = await q.query<{ id: string }>(
        "select id from pipeline_stages where pipeline_id = $1 and kind = 'open' order by position limit 1", [input.pipelineId]);
      stageId = first.rows[0]!.id;
    }
    const stage = await this.stageOf(q, input.pipelineId, stageId);
    if (stage.kind !== 'open') throw Problem.badRequest('Etapa inválida.', [{ field: 'stageId', message: 'Um negócio novo começa numa etapa em andamento.' }]);
    const owner = input.ownerId === undefined ? r.me : input.ownerId;
    await assertOwnerInReach(q, r, owner);
    if (r.scope === 'own' && owner !== r.me) {
      throw Problem.badRequest('Responsável fora do seu alcance.', [{ field: 'ownerId', message: 'Você só pode criar negócios seus.' }]);
    }
    await assertTeamInReach(q, r, input.teamId);
    await this.checkLinks(q, input);
    await checkTags(q, input.tagIds);
    const custom = await customFor(q, 'deal', input.custom, {}, false);
    const row = await q.query<{ id: string }>(
      `insert into deals (tenant_id, pipeline_id, stage_id, title, value_cents, currency, contact_id, organization_id, lead_id,
                          owner_membership_id, team_id, expected_close_date, custom, created_by)
       values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [input.pipelineId, stageId, input.title, input.valueCents ?? 0, input.currency ?? pipe.currency, input.contactId ?? null,
        input.organizationId ?? null, leadId ?? null, owner, input.teamId ?? null, input.expectedCloseDate ?? null,
        JSON.stringify(custom), actor.membershipId]);
    const id = row.rows[0]!.id;
    for (const t of new Set(input.tagIds ?? [])) {
      await q.query('insert into deal_tags (tenant_id, deal_id, tag_id) values (app.tenant_id(), $1, $2)', [id, t]);
    }
    for (const m of new Set(input.participantIds ?? [])) {
      await q.query('insert into deal_participants (tenant_id, deal_id, membership_id) values (app.tenant_id(), $1, $2)', [id, m]);
    }
    const missing = await this.missingFor(q, id, stageId);
    if (missing.length) throw Problem.badRequest(`A etapa "${stage.name}" exige campos que faltam.`, missing);
    await timeline(q, actor, 'deal.created', { dealId: id, contactId: input.contactId, organizationId: input.organizationId, leadId },
      { stageId, pipelineId: input.pipelineId, title: input.title });
    return id;
  }

  async create(actor: Actor, input: DealInput & { pipelineId: string; title: string }) {
    const r = reachOf(actor, 'deals:edit');
    return this.db.app(tenantCtx(actor), async (q) => this.detail(q, await this.createIn(q, actor, r, input)));
  }

  async update(actor: Actor, id: string, input: DealInput) {
    const r = reachOf(actor, 'deals:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, actor, r, id, true);
      if (input.ownerId !== undefined && input.ownerId !== cur.owner_membership_id) {
        if (!actor.permissions.get('deals:assign') && r.scope === 'own') {
          throw Problem.forbidden('Você não pode trocar o responsável deste negócio.');
        }
        await assertOwnerInReach(q, actor.permissions.get('deals:assign') ? reachOf(actor, 'deals:assign') : r, input.ownerId);
      }
      if (input.teamId !== undefined) await assertTeamInReach(q, r, input.teamId);
      await this.checkLinks(q, input);
      if (input.tagIds) await checkTags(q, input.tagIds);
      const custom = input.custom ? await customFor(q, 'deal', input.custom, cur.custom, true) : undefined;
      const sel = 'select title, value_cents, currency, contact_id, organization_id, owner_membership_id, team_id, expected_close_date, custom from deals where id = $1';
      const before = (await q.query(sel, [id])).rows[0] as Record<string, unknown>;
      const p = new Params();
      const sets: string[] = [];
      const put = (col: string, v: unknown, cast = '') => { if (v !== undefined) sets.push(`${col} = ${p.add(v)}${cast}`); };
      put('title', input.title);
      put('value_cents', input.valueCents);
      put('currency', input.currency);
      put('contact_id', input.contactId, '::uuid');
      put('organization_id', input.organizationId, '::uuid');
      put('owner_membership_id', input.ownerId, '::uuid');
      put('team_id', input.teamId, '::uuid');
      put('expected_close_date', input.expectedCloseDate, '::date');
      if (custom) put('custom', JSON.stringify(custom), '::jsonb');
      if (sets.length) await q.query(`update deals set ${sets.join(', ')} where id = ${p.add(id)}`, p.values);
      if (input.tagIds) {
        await q.query('delete from deal_tags where deal_id = $1', [id]);
        for (const t of new Set(input.tagIds)) await q.query('insert into deal_tags (tenant_id, deal_id, tag_id) values (app.tenant_id(), $1, $2)', [id, t]);
      }
      if (input.participantIds) {
        await q.query('delete from deal_participants where deal_id = $1', [id]);
        for (const m of new Set(input.participantIds)) {
          await q.query('insert into deal_participants (tenant_id, deal_id, membership_id) values (app.tenant_id(), $1, $2)', [id, m]);
        }
      }
      // A etapa atual continua exigindo os seus campos.
      const missing = await this.missingFor(q, id, cur.stage_id);
      if (missing.length) throw Problem.badRequest('A etapa atual exige este campo.', missing);
      const after = (await q.query(sel, [id])).rows[0] as Record<string, unknown>;
      const fields = changedFields(before, after);
      if (input.tagIds) fields.push('tags');
      if (input.participantIds) fields.push('participants');
      if (fields.length) await timeline(q, actor, 'deal.updated', { dealId: id, contactId: cur.contact_id }, { fields });
      if (before.owner_membership_id !== after.owner_membership_id) {
        await audit(q, actor, 'deal.assigned', 'deal', id, { from: before.owner_membership_id, to: after.owner_membership_id });
      }
      return this.detail(q, id);
    });
  }

  /**
   * Move o negócio de etapa (ou de funil). Confere a regra de transição, os
   * campos exigidos pela etapa de destino e o motivo de ganho ou perda.
   */
  async move(actor: Actor, id: string, input: { stageId: string; pipelineId?: string; reasonId?: string | null; note?: string | null }) {
    const r = reachOf(actor, 'deals:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, actor, r, id, true);
      const pipelineId = input.pipelineId ?? cur.pipeline_id;
      if (pipelineId !== cur.pipeline_id) {
        const pipe = await this.pipelines.accessible(q, actor, pipelineId);
        if (pipe.archived) throw Problem.badRequest('Funil arquivado.', [{ field: 'pipelineId', message: 'Escolha um funil ativo.' }]);
      }
      const to = await this.stageOf(q, pipelineId, input.stageId);
      if (to.id === cur.stage_id) return this.detail(q, id);
      if (pipelineId === cur.pipeline_id) {
        const rules = await q.query<{ to_stage_id: string }>('select to_stage_id from stage_transition_rules where from_stage_id = $1', [cur.stage_id]);
        if (rules.rowCount && !rules.rows.some((x) => x.to_stage_id === to.id)) {
          throw new Problem(422, 'Esta mudança de etapa não é permitida pelo funil.', 'transition-not-allowed');
        }
      }
      if (to.kind !== 'open') {
        if (input.reasonId) {
          const reason = await q.query('select 1 from outcome_reasons where id = $1 and kind = $2 and active', [input.reasonId, to.kind]);
          if (!reason.rowCount) throw Problem.badRequest('Motivo inválido.', [{ field: 'reasonId', message: 'Escolha um motivo da lista.' }]);
        } else if (to.kind === 'lost') {
          const any = await q.query("select 1 from outcome_reasons where kind = 'lost' and active limit 1");
          if (any.rowCount) throw Problem.badRequest('Informe o motivo da perda.', [{ field: 'reasonId', message: 'Escolha o motivo.' }]);
        }
      }
      const from = await q.query<{ name: string }>('select name from pipeline_stages where id = $1', [cur.stage_id]);
      try {
        await q.query(
          `update deals set pipeline_id = $2, stage_id = $3,
                  outcome_reason_id = case when $5 then $4::uuid else null end,
                  outcome_note = case when $5 then $6 else null end
            where id = $1`,
          [id, pipelineId, to.id, input.reasonId ?? null, to.kind !== 'open', input.note ?? null]);
      } catch (err) {
        if (pgCode(err) === '23503') throw Problem.badRequest('Etapa inválida.', [{ field: 'stageId', message: 'Escolha uma etapa deste funil.' }]);
        throw err;
      }
      const missing = await this.missingFor(q, id, to.id);
      if (missing.length) {
        throw new Problem(422, `A etapa "${to.name}" exige campos que faltam.`, 'stage-requirements', undefined, missing);
      }
      const kind = to.kind === 'won' ? 'deal.won' : to.kind === 'lost' ? 'deal.lost' : 'deal.stage_changed';
      await timeline(q, actor, kind, { dealId: id, contactId: cur.contact_id, organizationId: cur.organization_id },
        { fromStage: from.rows[0]?.name, toStage: to.name, toStageId: to.id, pipelineId, reasonId: input.reasonId ?? null });
      return this.detail(q, id);
    });
  }

  /** Substitui os itens; com itens, o valor do negócio passa a ser a soma deles. */
  async setItems(actor: Actor, id: string, items: ItemInput[]) {
    const r = reachOf(actor, 'deals:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, actor, r, id, true);
      await q.query('delete from deal_items where deal_id = $1', [id]);
      let total = 0;
      for (const [i, it] of items.entries()) {
        let name = it.name;
        let price = it.unitPriceCents;
        if (it.productId) {
          const pr = await q.query<{ name: string; price_cents: string }>('select name, price_cents from products where id = $1', [it.productId]);
          if (!pr.rows[0]) throw Problem.badRequest('Produto inválido.', [{ field: `items.${i}.productId`, message: 'Escolha um produto da lista.' }]);
          name ??= pr.rows[0].name;
          price ??= Number(pr.rows[0].price_cents);
        }
        if (!name) throw Problem.badRequest('Informe o item.', [{ field: `items.${i}.name`, message: 'Informe o nome do item.' }]);
        const discount = it.discountCents ?? 0;
        const line = Math.round(it.quantity * (price ?? 0)) - discount;
        if (line < 0) throw Problem.badRequest('Desconto maior que o item.', [{ field: `items.${i}.discountCents`, message: 'O desconto passa do valor do item.' }]);
        total += line;
        await q.query(
          `insert into deal_items (tenant_id, deal_id, product_id, name, quantity, unit_price_cents, discount_cents, position)
           values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7)`,
          [id, it.productId ?? null, name, it.quantity, price ?? 0, discount, i]);
      }
      if (items.length) await q.query('update deals set value_cents = $2 where id = $1', [id, total]);
      const missing = await this.missingFor(q, id, cur.stage_id);
      if (missing.length) throw Problem.badRequest('A etapa atual exige este campo.', missing);
      await timeline(q, actor, 'deal.items_updated', { dealId: id }, { items: items.length });
      return this.detail(q, id);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const r = reachOf(actor, 'deals:delete');
    await this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, actor, r, id);
      await q.query('delete from deals where id = $1', [id]);
      await audit(q, actor, 'deal.deleted', 'deal', id, { title: cur.title });
    });
  }
}
