import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { domainOf, normalizeEmail, normalizePhone } from '../domain/contact-data.js';
import { Problem, type FieldError } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { checkTags, customFor, memberJson } from './fields.js';
import {
  Params, assertOwnerInReach, assertTeamInReach, changedFields, likeEscape, pageOf, reachOf, reachSql, timeline,
  type Page, type Reach,
} from './sql.js';

export type OrganizationInput = {
  name?: string;
  legalName?: string | null;
  taxId?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  industry?: string | null;
  address?: Record<string, string>;
  ownerId?: string | null;
  teamId?: string | null;
  tagIds?: string[];
  custom?: Record<string, unknown>;
};

export type OrganizationFilters = {
  q?: string; ownerId?: string; tagId?: string;
  sort: 'name' | 'created' | 'activity'; dir: 'asc' | 'desc'; page: number; pageSize: number;
};

/** Além do responsável: organizações dos negócios e contatos da pessoa. */
export const orgOwnExtra = (me: string) => `(
  exists (select 1 from deals d where d.organization_id = o.id and (d.owner_membership_id = ${me}
          or exists (select 1 from deal_participants dp where dp.deal_id = d.id and dp.membership_id = ${me})))
  or exists (select 1 from contacts c2 where c2.organization_id = o.id and c2.owner_membership_id = ${me}))`;

const COLS = `
  o.id, o.name, o.legal_name as "legalName", o.tax_id as "taxId", o.domain, o.website, o.email, o.phone, o.industry,
  o.address, o.custom, o.team_id as "teamId", o.created_at as "createdAt", o.updated_at as "updatedAt",
  o.last_activity_at as "lastActivityAt", ${memberJson('o.owner_membership_id')} as owner,
  (select count(*)::int from contacts c where c.organization_id = o.id) as "contactCount",
  coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by lower(t.name))
            from organization_tags ot join tags t on t.id = ot.tag_id where ot.organization_id = o.id), '[]') as tags`;

@Injectable()
export class OrganizationsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async list(actor: Actor, f: OrganizationFilters): Promise<Page<Record<string, unknown>>> {
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const where = [reachSql(p, 'o', r, orgOwnExtra)];
      if (f.q) {
        const like = p.add(`%${likeEscape(f.q.trim().toLowerCase())}%`);
        where.push(`(app.norm(o.name) like app.norm(${like}) or o.domain like ${like} or regexp_replace(coalesce(o.tax_id, ''), '\\D', '', 'g') like ${like})`);
      }
      if (f.ownerId) where.push(f.ownerId === 'none' ? 'o.owner_membership_id is null' : `o.owner_membership_id = ${p.add(f.ownerId)}`);
      if (f.tagId) where.push(`exists (select 1 from organization_tags ot where ot.organization_id = o.id and ot.tag_id = ${p.add(f.tagId)})`);
      const dir = f.dir === 'asc' ? 'asc' : 'desc';
      const order = { name: `lower(o.name) ${dir}`, created: `o.created_at ${dir}`, activity: `o.last_activity_at ${dir} nulls last` }[f.sort];
      const whereSql = where.join(' and ');
      const { limit, offset } = pageOf(f.page, f.pageSize);
      const total = await q.query<{ n: number }>(`select count(*)::int as n from organizations o where ${whereSql}`, p.values);
      const rows = await q.query(`select ${COLS} from organizations o where ${whereSql} order by ${order}, o.id limit ${p.add(limit)} offset ${p.add(offset)}`, p.values);
      return { items: rows.rows, total: total.rows[0]!.n, page: f.page, pageSize: f.pageSize };
    });
  }

  async visible(q: Q, r: Reach, id: string): Promise<{ id: string; owner_membership_id: string | null; custom: Record<string, unknown> }> {
    const p = new Params();
    const row = await q.query<{ id: string; owner_membership_id: string | null; custom: Record<string, unknown> }>(
      `select o.id, o.owner_membership_id, o.custom from organizations o where o.id = ${p.add(id)} and ${reachSql(p, 'o', r, orgOwnExtra)}`, p.values);
    if (!row.rows[0]) throw Problem.notFound('Organização não encontrada.');
    return row.rows[0];
  }

  async detail(q: Q, id: string) {
    const o = await q.query(`select ${COLS} from organizations o where o.id = $1`, [id]);
    const counts = await q.query<{ deals: number; open_deals: number; open_value: string }>(
      `select count(*)::int as deals, count(*) filter (where status = 'open')::int as open_deals,
              coalesce(sum(value_cents) filter (where status = 'open'), 0)::text as open_value
         from deals where organization_id = $1`, [id]);
    const k = counts.rows[0]!;
    return { ...(o.rows[0] as Record<string, unknown>), counts: { deals: k.deals, openDeals: k.open_deals, openValueCents: Number(k.open_value) } };
  }

  async get(actor: Actor, id: string) {
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      return this.detail(q, id);
    });
  }

  private normalize(input: OrganizationInput): { values: OrganizationInput & { domain?: string | null }; errors: FieldError[] } {
    const errors: FieldError[] = [];
    const v: OrganizationInput & { domain?: string | null } = { ...input };
    if (input.email) {
      const e = normalizeEmail(input.email);
      if (!e) errors.push({ field: 'email', message: 'E-mail inválido.' });
      v.email = e;
    }
    if (input.phone) {
      const ph = normalizePhone(input.phone);
      if (!ph) errors.push({ field: 'phone', message: 'Telefone inválido. Inclua o DDD.' });
      v.phone = ph;
    }
    if (input.website !== undefined) {
      if (input.website) {
        const d = domainOf(input.website);
        if (!d) errors.push({ field: 'website', message: 'Endereço inválido.' });
        v.domain = d;
        v.website = /^https?:\/\//i.test(input.website) ? input.website.trim() : `https://${input.website.trim()}`;
      } else {
        v.domain = null;
        v.website = null;
      }
    }
    return { values: v, errors };
  }

  async createIn(q: Q, actor: Actor, r: Reach, input: OrganizationInput & { name: string }): Promise<string> {
    const { values: v, errors } = this.normalize(input);
    if (errors.length) throw Problem.badRequest('Confira os campos destacados.', errors);
    const owner = input.ownerId === undefined ? r.me : input.ownerId;
    await assertOwnerInReach(q, r, owner);
    if (r.scope === 'own' && owner !== r.me) {
      throw Problem.badRequest('Responsável fora do seu alcance.', [{ field: 'ownerId', message: 'Você só pode criar organizações suas.' }]);
    }
    await assertTeamInReach(q, r, input.teamId);
    await checkTags(q, input.tagIds);
    const custom = await customFor(q, 'organization', input.custom, {}, false);
    const row = await q.query<{ id: string }>(
      `insert into organizations (tenant_id, name, legal_name, tax_id, domain, website, email, phone, industry, address,
                                  owner_membership_id, team_id, custom, created_by)
       values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [v.name, v.legalName ?? null, v.taxId ?? null, v.domain ?? null, v.website ?? null, v.email ?? null, v.phone ?? null,
        v.industry ?? null, JSON.stringify(v.address ?? {}), owner, v.teamId ?? null, JSON.stringify(custom), actor.membershipId]);
    const id = row.rows[0]!.id;
    for (const t of new Set(input.tagIds ?? [])) {
      await q.query('insert into organization_tags (tenant_id, organization_id, tag_id) values (app.tenant_id(), $1, $2)', [id, t]);
    }
    await timeline(q, actor, 'organization.created', { organizationId: id });
    return id;
  }

  async create(actor: Actor, input: OrganizationInput & { name: string }) {
    const r = reachOf(actor, 'contacts:edit');
    return this.db.app(tenantCtx(actor), async (q) => this.detail(q, await this.createIn(q, actor, r, input)));
  }

  async update(actor: Actor, id: string, input: OrganizationInput) {
    const r = reachOf(actor, 'contacts:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id);
      const { values: v, errors } = this.normalize(input);
      if (errors.length) throw Problem.badRequest('Confira os campos destacados.', errors);
      if (input.ownerId !== undefined && input.ownerId !== cur.owner_membership_id) await assertOwnerInReach(q, r, input.ownerId);
      if (input.teamId !== undefined) await assertTeamInReach(q, r, input.teamId);
      if (input.tagIds) await checkTags(q, input.tagIds);
      const custom = input.custom ? await customFor(q, 'organization', input.custom, cur.custom, true) : undefined;
      const sel = 'select name, legal_name, tax_id, domain, website, email, phone, industry, address, owner_membership_id, team_id, custom from organizations where id = $1';
      const before = (await q.query(sel, [id])).rows[0] as Record<string, unknown>;
      const set = (col: string, key: keyof typeof v, p: Params) =>
        v[key] === undefined ? `${col} = ${col}` : `${col} = ${p.add(v[key] ?? null)}`;
      const p = new Params();
      const idParam = p.add(id);
      await q.query(
        `update organizations set
           ${input.name ? `name = ${p.add(input.name)}` : 'name = name'},
           ${set('legal_name', 'legalName', p)}, ${set('tax_id', 'taxId', p)}, ${set('domain', 'domain', p)},
           ${set('website', 'website', p)}, ${set('email', 'email', p)}, ${set('phone', 'phone', p)},
           ${set('industry', 'industry', p)},
           ${input.address ? `address = ${p.add(JSON.stringify(input.address))}::jsonb` : 'address = address'},
           ${input.ownerId === undefined ? 'owner_membership_id = owner_membership_id' : `owner_membership_id = ${p.add(input.ownerId)}::uuid`},
           ${input.teamId === undefined ? 'team_id = team_id' : `team_id = ${p.add(input.teamId)}::uuid`},
           ${custom ? `custom = ${p.add(JSON.stringify(custom))}::jsonb` : 'custom = custom'}
         where id = ${idParam}`, p.values);
      if (input.tagIds) {
        await q.query('delete from organization_tags where organization_id = $1', [id]);
        for (const t of new Set(input.tagIds)) {
          await q.query('insert into organization_tags (tenant_id, organization_id, tag_id) values (app.tenant_id(), $1, $2)', [id, t]);
        }
      }
      const after = (await q.query(sel, [id])).rows[0] as Record<string, unknown>;
      const fields = changedFields(before, after);
      if (input.tagIds) fields.push('tags');
      if (fields.length) await timeline(q, actor, 'organization.updated', { organizationId: id }, { fields });
      return this.detail(q, id);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const r = reachOf(actor, 'contacts:delete');
    await this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      const o = (await q.query<{ name: string }>('select name from organizations where id = $1', [id])).rows[0]!;
      await q.query('delete from organizations where id = $1', [id]);
      await audit(q, actor, 'organization.deleted', 'organization', id, { name: o.name });
    });
  }
}
