import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { Problem } from '../http/problem.js';
import { Db, pgCode } from '../infra/db.js';
import type { CustomFieldType } from '../domain/custom-fields.js';
import type { Entity } from './fields.js';

const COLOR = /^#[0-9A-F]{6}$/;

/**
 * Cadastros de apoio: etiquetas, campos personalizados, produtos, motivos de
 * ganho e perda, e o diretório de pessoas e equipes para os seletores.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---- Diretório ----------------------------------------------------------------

  /** Pessoas ativas e equipes da empresa, para escolher responsável. */
  async directory(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const members = await q.query(
        `select m.id, u.name, u.email,
                coalesce((select array_agg(tm.team_id) from team_members tm where tm.membership_id = m.id), '{}') as "teamIds"
           from memberships m join users u on u.id = m.user_id
          where m.status = 'active' order by lower(u.name)`);
      const teams = await q.query('select id, name from teams order by lower(name)');
      return { me: actor.membershipId, members: members.rows, teams: teams.rows };
    });
  }

  // ---- Etiquetas --------------------------------------------------------------------

  async tags(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) =>
      (await q.query(
        `select t.id, t.name, t.color,
                (select count(*)::int from contact_tags ct where ct.tag_id = t.id)
                + (select count(*)::int from organization_tags ot where ot.tag_id = t.id)
                + (select count(*)::int from deal_tags dt where dt.tag_id = t.id) as uses
           from tags t order by lower(t.name)`)).rows);
  }

  async createTag(actor: Actor, input: { name: string; color?: string }) {
    const color = (input.color ?? '#64748B').toUpperCase();
    if (!COLOR.test(color)) throw Problem.badRequest('Cor inválida.', [{ field: 'color', message: 'Use #RRGGBB.' }]);
    return this.db.app(tenantCtx(actor), async (q) => {
      try {
        const r = await q.query('insert into tags (tenant_id, name, color) values (app.tenant_id(), $1, $2) returning id, name, color', [input.name, color]);
        return r.rows[0];
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Já existe uma etiqueta com esse nome.');
        throw err;
      }
    });
  }

  async updateTag(actor: Actor, id: string, input: { name?: string; color?: string }) {
    const color = input.color?.toUpperCase();
    if (color && !COLOR.test(color)) throw Problem.badRequest('Cor inválida.', [{ field: 'color', message: 'Use #RRGGBB.' }]);
    return this.db.app(tenantCtx(actor), async (q) => {
      try {
        const r = await q.query('update tags set name = coalesce($2, name), color = coalesce($3, color) where id = $1 returning id, name, color',
          [id, input.name ?? null, color ?? null]);
        if (!r.rows[0]) throw Problem.notFound('Etiqueta não encontrada.');
        return r.rows[0];
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Já existe uma etiqueta com esse nome.');
        throw err;
      }
    });
  }

  async deleteTag(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ name: string }>('delete from tags where id = $1 returning name', [id]);
      if (!r.rows[0]) throw Problem.notFound('Etiqueta não encontrada.');
      await audit(q, actor, 'tag.deleted', 'tag', id, { name: r.rows[0].name });
    });
  }

  // ---- Campos personalizados ------------------------------------------------------------

  async fields(actor: Actor, entity?: Entity) {
    return this.db.app(tenantCtx(actor), async (q) =>
      (await q.query(
        `select id, entity, key, label, type, options, required, position, archived_at is not null as archived
           from custom_field_definitions where ($1::text is null or entity = $1)
          order by entity, archived_at nulls first, position, lower(label)`, [entity ?? null])).rows);
  }

  private checkOptions(type: CustomFieldType, options: { value: string; label: string }[] | undefined): void {
    const needs = type === 'select' || type === 'multi_select';
    if (needs && (!options || options.length === 0)) {
      throw Problem.badRequest('Informe as opções.', [{ field: 'options', message: 'Listas precisam de ao menos uma opção.' }]);
    }
    if (options) {
      const values = options.map((o) => o.value);
      if (new Set(values).size !== values.length) {
        throw Problem.badRequest('Opções repetidas.', [{ field: 'options', message: 'Cada opção precisa ser única.' }]);
      }
    }
  }

  async createField(actor: Actor, input: { entity: Entity; key: string; label: string; type: CustomFieldType; options?: { value: string; label: string }[]; required?: boolean }) {
    this.checkOptions(input.type, input.options);
    return this.db.app(tenantCtx(actor), async (q) => {
      try {
        const pos = await q.query<{ n: number }>('select coalesce(max(position) + 1, 0)::int as n from custom_field_definitions where entity = $1', [input.entity]);
        const r = await q.query(
          `insert into custom_field_definitions (tenant_id, entity, key, label, type, options, required, position)
           values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7)
           returning id, entity, key, label, type, options, required, position, false as archived`,
          [input.entity, input.key, input.label, input.type,
            JSON.stringify(input.type === 'select' || input.type === 'multi_select' ? input.options ?? [] : []),
            input.required ?? false, pos.rows[0]!.n]);
        await audit(q, actor, 'custom_field.created', 'custom_field', (r.rows[0] as { id: string }).id, { entity: input.entity, key: input.key });
        return r.rows[0];
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Já existe um campo com essa chave.');
        throw err;
      }
    });
  }

  /** O tipo e a chave não mudam depois de criados: os valores gravados dependem deles. */
  async updateField(actor: Actor, id: string, input: { label?: string; options?: { value: string; label: string }[]; required?: boolean; archived?: boolean; position?: number }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await q.query<{ type: CustomFieldType; options: { value: string; label: string }[] }>(
        'select type, options from custom_field_definitions where id = $1', [id]);
      const def = cur.rows[0];
      if (!def) throw Problem.notFound('Campo não encontrado.');
      if (input.options) {
        this.checkOptions(def.type, input.options);
        if (def.type !== 'select' && def.type !== 'multi_select') {
          throw Problem.badRequest('Este tipo de campo não tem opções.', [{ field: 'options', message: 'Só listas têm opções.' }]);
        }
        const removed = def.options.filter((o) => !input.options!.some((n) => n.value === o.value));
        if (removed.length) {
          throw Problem.badRequest('Opções em uso não podem ser removidas.', [{ field: 'options', message: 'Renomeie a opção em vez de removê-la.' }]);
        }
      }
      const r = await q.query(
        `update custom_field_definitions set
           label = coalesce($2, label), options = coalesce($3::jsonb, options), required = coalesce($4, required),
           position = coalesce($5, position),
           archived_at = case when $6::boolean is null then archived_at when $6 then coalesce(archived_at, now()) else null end
         where id = $1
         returning id, entity, key, label, type, options, required, position, archived_at is not null as archived`,
        [id, input.label ?? null, input.options ? JSON.stringify(input.options) : null, input.required ?? null,
          input.position ?? null, input.archived ?? null]);
      await audit(q, actor, 'custom_field.updated', 'custom_field', id, { fields: Object.keys(input) });
      return r.rows[0];
    });
  }

  // ---- Produtos -------------------------------------------------------------------------

  async products(actor: Actor, opts: { q?: string; includeInactive?: boolean }) {
    return this.db.app(tenantCtx(actor), async (q) =>
      (await q.query(
        `select id, name, sku, description, price_cents as "priceCents", currency, active
           from products
          where ($1::text is null or app.norm(name) like '%' || app.norm($1) || '%' or lower(sku) = lower($1))
            and ($2 or active)
          order by active desc, lower(name) limit 200`, [opts.q || null, opts.includeInactive ?? false])).rows);
  }

  async saveProduct(actor: Actor, id: string | null, input: { name?: string; sku?: string | null; description?: string | null; priceCents?: number; currency?: string; active?: boolean }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      try {
        let row;
        if (!id) {
          row = await q.query(
            `insert into products (tenant_id, name, sku, description, price_cents, currency, active)
             values (app.tenant_id(), $1, $2, $3, $4, $5, $6)
             returning id, name, sku, description, price_cents as "priceCents", currency, active`,
            [input.name, input.sku ?? null, input.description ?? null, input.priceCents ?? 0, input.currency ?? 'BRL', input.active ?? true]);
        } else {
          row = await q.query(
            `update products set name = coalesce($2, name),
                    sku = case when $3::boolean then $4 else sku end,
                    description = case when $5::boolean then $6 else description end,
                    price_cents = coalesce($7, price_cents), currency = coalesce($8, currency), active = coalesce($9, active)
              where id = $1
             returning id, name, sku, description, price_cents as "priceCents", currency, active`,
            [id, input.name ?? null, input.sku !== undefined, input.sku ?? null, input.description !== undefined,
              input.description ?? null, input.priceCents ?? null, input.currency ?? null, input.active ?? null]);
          if (!row.rows[0]) throw Problem.notFound('Produto não encontrado.');
        }
        const p = row.rows[0] as { id: string };
        await audit(q, actor, id ? 'product.updated' : 'product.created', 'product', p.id, { fields: Object.keys(input) });
        return p;
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Já existe um produto com esse código.');
        throw err;
      }
    });
  }

  // ---- Motivos de ganho e perda -------------------------------------------------------------

  async reasons(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) =>
      (await q.query('select id, kind, name, position, active from outcome_reasons order by kind, active desc, position, lower(name)')).rows);
  }

  async saveReason(actor: Actor, id: string | null, input: { kind?: 'won' | 'lost'; name?: string; active?: boolean; position?: number }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      try {
        const r = id
          ? await q.query(
            `update outcome_reasons set name = coalesce($2, name), active = coalesce($3, active), position = coalesce($4, position)
              where id = $1 returning id, kind, name, position, active`,
            [id, input.name ?? null, input.active ?? null, input.position ?? null])
          : await q.query(
            `insert into outcome_reasons (tenant_id, kind, name, position)
             values (app.tenant_id(), $1, $2, coalesce($3, (select coalesce(max(position) + 1, 0) from outcome_reasons where kind = $1)))
             returning id, kind, name, position, active`,
            [input.kind, input.name, input.position ?? null]);
        if (!r.rows[0]) throw Problem.notFound('Motivo não encontrado.');
        return r.rows[0];
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Já existe um motivo com esse nome.');
        throw err;
      }
    });
  }

  // ---- Visões salvas ------------------------------------------------------------------------

  async views(actor: Actor, entity: string) {
    return this.db.app(tenantCtx(actor), async (q) =>
      (await q.query(
        `select id, entity, name, filters, shared, membership_id = $2 as mine from saved_views
          where entity = $1 order by (membership_id = $2) desc, lower(name)`, [entity, actor.membershipId])).rows);
  }

  async createView(actor: Actor, input: { entity: string; name: string; filters: Record<string, unknown>; shared: boolean }) {
    return this.db.app(tenantCtx(actor), async (q) =>
      (await q.query(
        `insert into saved_views (tenant_id, membership_id, entity, name, filters, shared)
         values (app.tenant_id(), $1, $2, $3, $4, $5) returning id, entity, name, filters, shared, true as mine`,
        [actor.membershipId, input.entity, input.name, JSON.stringify(input.filters), input.shared])).rows[0]);
  }

  async deleteView(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query('delete from saved_views where id = $1', [id]);
      if (!r.rowCount) throw Problem.notFound('Visão não encontrada.');
    });
  }
}
