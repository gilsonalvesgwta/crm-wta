import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { Problem } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Params } from './sql.js';

export type StageInput = {
  id?: string;
  name: string;
  color?: string;
  probability?: number;
  kind: 'open' | 'won' | 'lost';
  requiredFields?: string[];
  rottingDays?: number | null;
};

const REQUIRED_FIXED = new Set(['value', 'expected_close_date', 'contact', 'organization', 'products']);

export const DEFAULT_STAGES: StageInput[] = [
  { name: 'Qualificação', color: '#64748B', probability: 10, kind: 'open' },
  { name: 'Contato feito', color: '#0EA5E9', probability: 25, kind: 'open' },
  { name: 'Proposta', color: '#8B5CF6', probability: 50, kind: 'open', requiredFields: ['value'] },
  { name: 'Negociação', color: '#F59E0B', probability: 75, kind: 'open', requiredFields: ['value'] },
  { name: 'Ganho', color: '#16A34A', probability: 100, kind: 'won', requiredFields: ['value'] },
  { name: 'Perdido', color: '#DC2626', probability: 0, kind: 'lost' },
];

/**
 * Condição SQL: o funil `alias` está acessível ao ator. Funil restrito só
 * aparece para quem está na lista (pessoa ou equipe) ou administra funis.
 */
export function pipelineAccessSql(p: Params, actor: Actor, alias: string): string {
  if (actor.permissions.get('pipelines:admin') === 'tenant') return 'true';
  const me = p.add(actor.membershipId);
  const teams = p.add(actor.teamIds);
  return `(not ${alias}.restricted or exists (
    select 1 from pipeline_access pa where pa.pipeline_id = ${alias}.id
      and (pa.membership_id = ${me} or pa.team_id = any(${teams}::uuid[]))))`;
}

@Injectable()
export class PipelinesService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Garante que o funil existe e está acessível; senão, 404. */
  async accessible(q: Q, actor: Actor, id: string): Promise<{ id: string; currency: string; archived: boolean }> {
    const p = new Params();
    const r = await q.query<{ id: string; currency: string; archived: boolean }>(
      `select pl.id, pl.currency, pl.archived_at is not null as archived from pipelines pl
        where pl.id = ${p.add(id)} and ${pipelineAccessSql(p, actor, 'pl')}`, p.values);
    if (!r.rows[0]) throw Problem.notFound('Funil não encontrado.');
    return r.rows[0];
  }

  private async read(q: Q, actor: Actor, where: string, p: Params) {
    const admin = actor.permissions.get('pipelines:admin') === 'tenant';
    const rows = await q.query(
      `select pl.id, pl.name, pl.position, pl.currency, pl.restricted, pl.archived_at is not null as archived,
              coalesce((select json_agg(json_build_object(
                  'id', s.id, 'name', s.name, 'position', s.position, 'color', s.color, 'probability', s.probability,
                  'kind', s.kind, 'requiredFields', s.required_fields, 'rottingDays', s.rotting_days,
                  'allowedTargets', (select coalesce(json_agg(r.to_stage_id), '[]') from stage_transition_rules r where r.from_stage_id = s.id))
                order by s.position, s.created_at) from pipeline_stages s where s.pipeline_id = pl.id), '[]') as stages
              ${admin ? `, json_build_object(
                  'teamIds', coalesce((select json_agg(pa.team_id) from pipeline_access pa where pa.pipeline_id = pl.id and pa.team_id is not null), '[]'),
                  'membershipIds', coalesce((select json_agg(pa.membership_id) from pipeline_access pa where pa.pipeline_id = pl.id and pa.membership_id is not null), '[]')
                ) as access` : ''}
         from pipelines pl where ${where} and ${pipelineAccessSql(p, actor, 'pl')}
        order by pl.archived_at nulls first, pl.position, lower(pl.name)`, p.values);
    return rows.rows as Record<string, unknown>[];
  }

  async list(actor: Actor, includeArchived: boolean) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      return this.read(q, actor, includeArchived ? 'true' : 'pl.archived_at is null', p);
    });
  }

  async get(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => this.getIn(q, actor, id));
  }

  async getIn(q: Q, actor: Actor, id: string) {
    const p = new Params();
    const rows = await this.read(q, actor, `pl.id = ${p.add(id)}`, p);
    if (!rows[0]) throw Problem.notFound('Funil não encontrado.');
    return rows[0];
  }

  private validateStages(stages: StageInput[], customKeys: Set<string>): void {
    const errors: { field: string; message: string }[] = [];
    if (!stages.some((s) => s.kind === 'open')) errors.push({ field: 'stages', message: 'O funil precisa de ao menos uma etapa em andamento.' });
    if (stages.filter((s) => s.kind === 'won').length !== 1) errors.push({ field: 'stages', message: 'O funil precisa de exatamente uma etapa de ganho.' });
    if (stages.filter((s) => s.kind === 'lost').length !== 1) errors.push({ field: 'stages', message: 'O funil precisa de exatamente uma etapa de perda.' });
    const names = stages.map((s) => s.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) errors.push({ field: 'stages', message: 'Os nomes das etapas precisam ser diferentes.' });
    stages.forEach((s, i) => {
      for (const f of s.requiredFields ?? []) {
        if (REQUIRED_FIXED.has(f)) continue;
        if (f.startsWith('custom.') && customKeys.has(f.slice(7))) continue;
        errors.push({ field: `stages.${i}.requiredFields`, message: `Campo desconhecido: ${f}.` });
      }
      if (s.color && !/^#[0-9A-F]{6}$/.test(s.color.toUpperCase())) errors.push({ field: `stages.${i}.color`, message: 'Use #RRGGBB.' });
    });
    if (errors.length) throw Problem.badRequest('Ajuste as etapas.', errors);
  }

  private async customKeys(q: Q): Promise<Set<string>> {
    const r = await q.query<{ key: string }>("select key from custom_field_definitions where entity = 'deal' and archived_at is null");
    return new Set(r.rows.map((x) => x.key));
  }

  async create(actor: Actor, input: { name: string; currency?: string; stages?: StageInput[] }) {
    const stages = input.stages?.length ? input.stages : DEFAULT_STAGES;
    return this.db.app(tenantCtx(actor), async (q) => {
      this.validateStages(stages, await this.customKeys(q));
      let id: string;
      try {
        const r = await q.query<{ id: string }>(
          `insert into pipelines (tenant_id, name, currency, position)
           values (app.tenant_id(), $1, $2, (select coalesce(max(position) + 1, 0) from pipelines)) returning id`,
          [input.name, input.currency ?? 'BRL']);
        id = r.rows[0]!.id;
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Já existe um funil com esse nome.');
        throw err;
      }
      for (const [i, s] of stages.entries()) await this.insertStage(q, id, s, i);
      await audit(q, actor, 'pipeline.created', 'pipeline', id, { name: input.name });
      return this.getIn(q, actor, id);
    });
  }

  private async insertStage(q: Q, pipelineId: string, s: StageInput, position: number): Promise<string> {
    const r = await q.query<{ id: string }>(
      `insert into pipeline_stages (tenant_id, pipeline_id, name, position, color, probability, kind, required_fields, rotting_days)
       values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [pipelineId, s.name.trim(), position, (s.color ?? '#64748B').toUpperCase(),
        s.probability ?? (s.kind === 'won' ? 100 : 0), s.kind, s.requiredFields ?? [], s.rottingDays ?? null]);
    return r.rows[0]!.id;
  }

  async update(actor: Actor, id: string, input: {
    name?: string; position?: number; restricted?: boolean; archived?: boolean;
    access?: { teamIds: string[]; membershipIds: string[] };
  }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.accessible(q, actor, id);
      try {
        await q.query(
          `update pipelines set name = coalesce($2, name), position = coalesce($3, position), restricted = coalesce($4, restricted),
                  archived_at = case when $5::boolean is null then archived_at when $5 then coalesce(archived_at, now()) else null end
            where id = $1`,
          [id, input.name ?? null, input.position ?? null, input.restricted ?? null, input.archived ?? null]);
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Já existe um funil com esse nome.');
        throw err;
      }
      if (input.access) {
        await q.query('delete from pipeline_access where pipeline_id = $1', [id]);
        for (const t of new Set(input.access.teamIds)) {
          await q.query('insert into pipeline_access (tenant_id, pipeline_id, team_id) values (app.tenant_id(), $1, $2)', [id, t])
            .catch((err: unknown) => {
              if (pgCode(err) === '23503') throw Problem.badRequest('Equipe inválida.', [{ field: 'access.teamIds', message: 'Escolha equipes da empresa.' }]);
              throw err;
            });
        }
        for (const m of new Set(input.access.membershipIds)) {
          await q.query('insert into pipeline_access (tenant_id, pipeline_id, membership_id) values (app.tenant_id(), $1, $2)', [id, m])
            .catch((err: unknown) => {
              if (pgCode(err) === '23503') throw Problem.badRequest('Pessoa inválida.', [{ field: 'access.membershipIds', message: 'Escolha pessoas da empresa.' }]);
              throw err;
            });
        }
      }
      await audit(q, actor, 'pipeline.updated', 'pipeline', id, { fields: Object.keys(input) });
      return this.getIn(q, actor, id);
    });
  }

  /**
   * Substitui as etapas, na ordem recebida. Etapa sem id é criada; etapa que
   * sumiu da lista é removida, desde que não tenha negócios.
   */
  async saveStages(actor: Actor, id: string, stages: StageInput[]) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.accessible(q, actor, id);
      this.validateStages(stages, await this.customKeys(q));
      await q.query('select id from pipelines where id = $1 for update', [id]);
      const cur = await q.query<{ id: string; kind: string; deals: number }>(
        `select s.id, s.kind, (select count(*)::int from deals d where d.stage_id = s.id) as deals
           from pipeline_stages s where s.pipeline_id = $1`, [id]);
      const known = new Map(cur.rows.map((r) => [r.id, r]));
      for (const s of stages) {
        if (s.id && !known.has(s.id)) throw Problem.badRequest('Etapa inválida.', [{ field: 'stages', message: 'Uma das etapas não é deste funil.' }]);
        const k = s.id ? known.get(s.id) : undefined;
        if (k && k.kind !== s.kind && k.deals > 0) {
          throw Problem.conflict(`A etapa "${s.name}" tem negócios e não pode mudar de tipo.`);
        }
      }
      const keep = new Set(stages.filter((s) => s.id).map((s) => s.id!));
      for (const r of cur.rows) {
        if (keep.has(r.id)) continue;
        if (r.deals > 0) throw Problem.conflict('Uma etapa removida ainda tem negócios. Mova-os antes de remover a etapa.');
        await q.query('delete from pipeline_stages where id = $1', [r.id]);
      }
      // Posições provisórias, para não colidir durante a renumeração.
      await q.query('update pipeline_stages set position = position + 100000 where pipeline_id = $1', [id]);
      for (const [i, s] of stages.entries()) {
        if (s.id) {
          await q.query(
            `update pipeline_stages set name = $2, position = $3, color = $4, probability = $5, kind = $6,
                    required_fields = $7, rotting_days = $8 where id = $1`,
            [s.id, s.name.trim(), i, (s.color ?? '#64748B').toUpperCase(), s.probability ?? (s.kind === 'won' ? 100 : 0), s.kind,
              s.requiredFields ?? [], s.rottingDays ?? null]);
        } else {
          await this.insertStage(q, id, s, i);
        }
      }
      await audit(q, actor, 'pipeline.stages_updated', 'pipeline', id, { stages: stages.length });
      return this.getIn(q, actor, id);
    });
  }

  /** Substitui as regras de transição do funil. */
  async saveTransitions(actor: Actor, id: string, rules: { fromStageId: string; toStageId: string }[]) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.accessible(q, actor, id);
      await q.query('delete from stage_transition_rules where pipeline_id = $1', [id]);
      for (const r of rules) {
        if (r.fromStageId === r.toStageId) continue;
        try {
          await q.query(
            `insert into stage_transition_rules (tenant_id, pipeline_id, from_stage_id, to_stage_id)
             values (app.tenant_id(), $1, $2, $3) on conflict do nothing`, [id, r.fromStageId, r.toStageId]);
        } catch (err) {
          if (pgCode(err) === '23503') throw Problem.badRequest('Etapa inválida.', [{ field: 'rules', message: 'As etapas precisam ser deste funil.' }]);
          throw err;
        }
      }
      await audit(q, actor, 'pipeline.transitions_updated', 'pipeline', id, { rules: rules.length });
      return this.getIn(q, actor, id);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      await this.accessible(q, actor, id);
      const n = await q.query<{ n: number }>('select count(*)::int as n from deals where pipeline_id = $1', [id]);
      if (n.rows[0]!.n > 0) throw Problem.conflict('O funil tem negócios. Arquive-o em vez de excluir.');
      const r = await q.query<{ name: string }>('delete from pipelines where id = $1 returning name', [id]);
      await audit(q, actor, 'pipeline.deleted', 'pipeline', id, { name: r.rows[0]?.name });
    });
  }
}
