import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { normalizeEmail, normalizePhone } from '../domain/contact-data.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { ContactsService, type Touch } from './contacts.service.js';
import { DealsService } from './deals.service.js';
import { customFor, memberJson } from './fields.js';
import { Params, assertOwnerInReach, assertTeamInReach, likeEscape, pageOf, reachOf, reachSql, timeline, type Page, type Reach } from './sql.js';

export type LeadInput = {
  title: string;
  contactId?: string;
  contact?: { firstName: string; lastName?: string | null; email?: string | null; phone?: string | null; organizationId?: string | null };
  source?: string | null;
  ownerId?: string | null;
  teamId?: string | null;
  custom?: Record<string, unknown>;
  touch?: Touch;
};

export type LeadFilters = {
  status?: 'new' | 'working' | 'qualified' | 'disqualified' | 'active' | 'all'; ownerId?: string; teamId?: string; source?: string; q?: string;
  page: number; pageSize: number;
};

const COLS = `
  l.id, l.title, l.status, l.source, l.created_at as "createdAt", l.updated_at as "updatedAt", l.assigned_at as "assignedAt",
  l.qualified_at as "qualifiedAt", l.last_activity_at as "lastActivityAt", l.disqualify_reason as "disqualifyReason",
  l.deal_id as "dealId", l.team_id as "teamId", l.custom, ${memberJson('l.owner_membership_id')} as owner,
  (select json_build_object('id', tm.id, 'name', tm.name) from teams tm where tm.id = l.team_id) as team,
  (select json_build_object('id', c.id, 'name', c.name,
     'email', (select e.email from contact_emails e where e.contact_id = c.id order by e.is_primary desc limit 1),
     'phone', (select p.e164 from contact_phones p where p.contact_id = c.id order by p.is_primary desc limit 1))
     from contacts c where c.id = l.contact_id) as contact`;

@Injectable()
export class LeadsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(DealsService) private readonly deals: DealsService,
  ) {}

  async visible(q: Q, r: Reach, id: string, lock = false) {
    const p = new Params();
    const row = await q.query<{ id: string; contact_id: string; status: string; owner_membership_id: string | null; team_id: string | null; custom: Record<string, unknown>; title: string }>(
      `select l.id, l.contact_id, l.status, l.owner_membership_id, l.team_id, l.custom, l.title from leads l
        where l.id = ${p.add(id)} and ${reachSql(p, 'l', r)} ${lock ? 'for update of l' : ''}`, p.values);
    if (!row.rows[0]) throw Problem.notFound('Lead não encontrado.');
    return row.rows[0];
  }

  async list(actor: Actor, f: LeadFilters): Promise<Page<Record<string, unknown>>> {
    const r = reachOf(actor, 'leads:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const where = [reachSql(p, 'l', r)];
      const status = f.status ?? 'active';
      if (status === 'active') where.push(`l.status in ('new', 'working')`);
      else if (status !== 'all') where.push(`l.status = ${p.add(status)}`);
      if (f.ownerId) where.push(f.ownerId === 'none' ? 'l.owner_membership_id is null' : `l.owner_membership_id = ${p.add(f.ownerId)}`);
      if (f.teamId) where.push(`l.team_id = ${p.add(f.teamId)}`);
      if (f.source) where.push(`lower(l.source) = lower(${p.add(f.source)})`);
      if (f.q) {
        const like = p.add(`%${likeEscape(f.q.trim().toLowerCase())}%`);
        where.push(`(app.norm(l.title) like app.norm(${like}) or exists (select 1 from contacts c where c.id = l.contact_id
                      and app.norm(c.first_name || ' ' || coalesce(c.last_name, '')) like app.norm(${like})))`);
      }
      const whereSql = where.join(' and ');
      const { limit, offset } = pageOf(f.page, f.pageSize);
      const total = await q.query<{ n: number }>(`select count(*)::int as n from leads l where ${whereSql}`, p.values);
      const rows = await q.query(`select ${COLS} from leads l where ${whereSql} order by l.created_at desc, l.id limit ${p.add(limit)} offset ${p.add(offset)}`, p.values);
      return { items: rows.rows, total: total.rows[0]!.n, page: f.page, pageSize: f.pageSize };
    });
  }

  async detail(q: Q, id: string) {
    return (await q.query(`select ${COLS} from leads l where l.id = $1`, [id])).rows[0];
  }

  async get(actor: Actor, id: string) {
    const r = reachOf(actor, 'leads:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      return this.detail(q, id);
    });
  }

  /**
   * Escolhe o responsável pelo rodízio. O roteiro é travado durante a escolha:
   * entradas simultâneas esperam a vez e pegam o membro seguinte.
   */
  async pickByRules(q: Q, source: string | null): Promise<{ ruleId: string; membershipId: string; teamId: string | null } | null> {
    const rules = await q.query<{ id: string; team_id: string | null; last_position: number }>(
      `select id, team_id, last_position from assignment_rules
        where active and (source_filter is null or lower(source_filter) = lower(coalesce($1, '')))
        order by position, created_at`, [source]);
    for (const rule of rules.rows) {
      const locked = await q.query<{ last_position: number }>('select last_position from assignment_rules where id = $1 for update', [rule.id]);
      const last = locked.rows[0]!.last_position;
      const next = await q.query<{ membership_id: string; position: number }>(
        `select rm.membership_id, rm.position from assignment_rule_members rm
           join memberships m on m.id = rm.membership_id and m.status = 'active'
          where rm.rule_id = $1
          order by (rm.position <= $2), rm.position limit 1`, [rule.id, last]);
      const pick = next.rows[0];
      if (!pick) continue;
      await q.query('update assignment_rules set last_position = $2 where id = $1', [rule.id, pick.position]);
      return { ruleId: rule.id, membershipId: pick.membership_id, teamId: rule.team_id };
    }
    return null;
  }

  async createIn(q: Q, actor: Actor, r: Reach, input: LeadInput, via: 'manual' | 'import' | 'form' | 'api' = 'manual'): Promise<string> {
    let contactId = input.contactId;
    const touch = input.touch ? { ...input.touch, via } : undefined;
    if (contactId) {
      const cr = reachOf(actor, 'contacts:view');
      await this.contacts.visible(q, cr, contactId);
      if (touch && Object.values(input.touch!).some((v) => v)) await this.contacts.recordTouch(q, contactId, touch);
    } else if (input.contact) {
      // Contato já cadastrado com o mesmo e-mail ou telefone é reaproveitado.
      const email = input.contact.email ? normalizeEmail(input.contact.email) : null;
      const phone = input.contact.phone ? normalizePhone(input.contact.phone) : null;
      if (input.contact.email && !email) throw Problem.badRequest('E-mail inválido.', [{ field: 'contact.email', message: 'E-mail inválido.' }]);
      if (input.contact.phone && !phone) throw Problem.badRequest('Telefone inválido.', [{ field: 'contact.phone', message: 'Telefone inválido. Inclua o DDD.' }]);
      const existing = await q.query<{ id: string }>(
        `select c.id from contacts c
          where c.anonymized_at is null and (
            c.id in (select contact_id from contact_emails where email = $1)
            or c.id in (select contact_id from contact_phones where e164 = $2))
          order by c.created_at limit 1`, [email, phone]);
      if (existing.rows[0]) {
        contactId = existing.rows[0].id;
        if (touch) await this.contacts.recordTouch(q, contactId, touch);
      } else {
        const cr = reachOf(actor, 'contacts:edit');
        contactId = await this.contacts.createIn(q, actor, { ...cr, scope: 'tenant' }, {
          firstName: input.contact.firstName, lastName: input.contact.lastName ?? null,
          organizationId: input.contact.organizationId ?? null,
          emails: email ? [{ email, isPrimary: true }] : [], phones: phone ? [{ number: phone, isPrimary: true }] : [],
          ownerId: null,
        }, { allowDuplicate: true, touch });
      }
    } else {
      throw Problem.badRequest('Informe o contato.', [{ field: 'contact', message: 'Escolha um contato ou informe os dados.' }]);
    }

    let owner = input.ownerId;
    let teamId = input.teamId ?? null;
    let ruleId: string | null = null;
    if (owner === undefined) {
      const pick = await this.pickByRules(q, input.source ?? null);
      if (pick) {
        owner = pick.membershipId;
        teamId = teamId ?? pick.teamId;
        ruleId = pick.ruleId;
      } else {
        owner = r.scope === 'own' ? r.me : null;
      }
    } else {
      await assertOwnerInReach(q, r, owner);
    }
    if (input.teamId) await assertTeamInReach(q, r, input.teamId);
    if (r.scope === 'own' && owner !== r.me && !ruleId) {
      throw Problem.badRequest('Responsável fora do seu alcance.', [{ field: 'ownerId', message: 'Você só pode criar leads seus.' }]);
    }
    const custom = await customFor(q, 'lead', input.custom, {}, false);
    const row = await q.query<{ id: string }>(
      `insert into leads (tenant_id, contact_id, title, source, owner_membership_id, team_id, assigned_at, custom, created_by)
       values (app.tenant_id(), $1, $2, $3, $4, $5, case when $4::uuid is null then null else now() end, $6, $7) returning id`,
      [contactId, input.title, input.source ?? null, owner ?? null, teamId, JSON.stringify(custom), actor.membershipId]);
    const id = row.rows[0]!.id;
    // Os contatos do lead passam a seguir o responsável, se não tinham um.
    if (owner) await q.query('update contacts set owner_membership_id = $2 where id = $1 and owner_membership_id is null', [contactId, owner]);
    await timeline(q, actor, 'lead.created', { leadId: id, contactId }, { source: input.source ?? null, via });
    if (owner) {
      await timeline(q, actor, 'lead.assigned', { leadId: id, contactId }, { to: owner, ruleId });
      await q.query(
        `insert into notifications (tenant_id, membership_id, kind, title, body, link)
         values (app.tenant_id(), $1, 'lead.assigned', 'Novo lead para você', $2, $3)`,
        [owner, input.title, `/leads/${id}`]);
    }
    return id;
  }

  async create(actor: Actor, input: LeadInput) {
    const r = reachOf(actor, 'leads:work');
    return this.db.app(tenantCtx(actor), async (q) => this.detail(q, await this.createIn(q, actor, r, input)));
  }

  async update(actor: Actor, id: string, input: { title?: string; source?: string | null; status?: 'new' | 'working'; custom?: Record<string, unknown> }) {
    const r = reachOf(actor, 'leads:work');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id, true);
      if (cur.status === 'qualified' || cur.status === 'disqualified') {
        if (input.status) throw Problem.conflict('O lead já foi encerrado. Reabra-o antes de mudar o estado.');
      }
      const custom = input.custom ? await customFor(q, 'lead', input.custom, cur.custom, true) : undefined;
      await q.query(
        `update leads set title = coalesce($2, title), source = case when $3::boolean then $4 else source end,
                status = coalesce($5, status), custom = coalesce($6::jsonb, custom) where id = $1`,
        [id, input.title ?? null, input.source !== undefined, input.source ?? null, input.status ?? null, custom ? JSON.stringify(custom) : null]);
      await timeline(q, actor, 'lead.updated', { leadId: id, contactId: cur.contact_id }, { fields: Object.keys(input) });
      return this.detail(q, id);
    });
  }

  async assign(actor: Actor, id: string, input: { ownerId: string | null; teamId?: string | null }) {
    const r = reachOf(actor, 'deals:assign');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, reachOf(actor, 'leads:view'), id, true);
      await assertOwnerInReach(q, r, input.ownerId);
      if (input.teamId !== undefined) await assertTeamInReach(q, r, input.teamId);
      await q.query(
        `update leads set owner_membership_id = $2, team_id = case when $3::boolean then $4::uuid else team_id end,
                assigned_at = case when $2::uuid is null then null else now() end where id = $1`,
        [id, input.ownerId, input.teamId !== undefined, input.teamId ?? null]);
      await timeline(q, actor, 'lead.assigned', { leadId: id, contactId: cur.contact_id }, { from: cur.owner_membership_id, to: input.ownerId });
      await audit(q, actor, 'lead.assigned', 'lead', id, { from: cur.owner_membership_id, to: input.ownerId });
      if (input.ownerId && input.ownerId !== actor.membershipId) {
        await q.query(
          `insert into notifications (tenant_id, membership_id, kind, title, body, link)
           values (app.tenant_id(), $1, 'lead.assigned', 'Lead atribuído a você', $2, $3)`, [input.ownerId, cur.title, `/leads/${id}`]);
      }
      return this.detail(q, id);
    });
  }

  /** Qualifica: cria o negócio no funil escolhido, ligado ao lead e ao contato. */
  async qualify(actor: Actor, id: string, input: { pipelineId: string; stageId?: string; title?: string; valueCents?: number; organizationId?: string | null }) {
    const r = reachOf(actor, 'leads:work');
    const dr = reachOf(actor, 'deals:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id, true);
      if (cur.status === 'qualified' || cur.status === 'disqualified') throw Problem.conflict('Este lead já foi encerrado.');
      const contact = await q.query<{ organization_id: string | null }>('select organization_id from contacts where id = $1', [cur.contact_id]);
      const dealId = await this.deals.createIn(q, actor, dr, {
        pipelineId: input.pipelineId, stageId: input.stageId, title: input.title ?? cur.title, valueCents: input.valueCents,
        contactId: cur.contact_id, organizationId: input.organizationId ?? contact.rows[0]?.organization_id ?? null,
        ownerId: cur.owner_membership_id ?? dr.me, teamId: cur.team_id,
      }, id);
      await q.query(
        "update leads set status = 'qualified', qualified_at = now(), deal_id = $2 where id = $1", [id, dealId]);
      await timeline(q, actor, 'lead.qualified', { leadId: id, contactId: cur.contact_id, dealId });
      return { lead: await this.detail(q, id), dealId };
    });
  }

  async disqualify(actor: Actor, id: string, reason: string) {
    const r = reachOf(actor, 'leads:work');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id, true);
      if (cur.status === 'qualified') throw Problem.conflict('Este lead já virou negócio.');
      await q.query("update leads set status = 'disqualified', disqualify_reason = $2 where id = $1", [id, reason]);
      await timeline(q, actor, 'lead.disqualified', { leadId: id, contactId: cur.contact_id }, {});
      return this.detail(q, id);
    });
  }

  async reopen(actor: Actor, id: string) {
    const r = reachOf(actor, 'leads:work');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id, true);
      if (cur.status !== 'disqualified') throw Problem.conflict('Só um lead descartado pode ser reaberto.');
      await q.query("update leads set status = 'working', disqualify_reason = null where id = $1", [id]);
      await timeline(q, actor, 'lead.reopened', { leadId: id, contactId: cur.contact_id });
      return this.detail(q, id);
    });
  }

  // ---- Roteiros de distribuição ------------------------------------------------------

  async rules(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) =>
      (await q.query(
        `select r.id, r.name, r.active, r.position, r.source_filter as "sourceFilter", r.team_id as "teamId",
                coalesce((select json_agg(json_build_object('id', m.id, 'name', u.name) order by rm.position)
                            from assignment_rule_members rm join memberships m on m.id = rm.membership_id join users u on u.id = m.user_id
                           where rm.rule_id = r.id), '[]') as members,
                (select rm.membership_id from assignment_rule_members rm where rm.rule_id = r.id and rm.position > r.last_position
                  order by rm.position limit 1) as "nextMembershipId"
           from assignment_rules r order by r.position, r.created_at`)).rows);
  }

  async saveRule(actor: Actor, id: string | null, input: { name?: string; active?: boolean; position?: number; sourceFilter?: string | null; teamId?: string | null; memberIds?: string[] }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      let ruleId = id;
      if (!ruleId) {
        const r = await q.query<{ id: string }>(
          `insert into assignment_rules (tenant_id, name, active, position, source_filter, team_id)
           values (app.tenant_id(), $1, coalesce($2, true), coalesce($3, (select coalesce(max(position) + 1, 0) from assignment_rules)), $4, $5)
           returning id`,
          [input.name, input.active ?? null, input.position ?? null, input.sourceFilter ?? null, input.teamId ?? null]);
        ruleId = r.rows[0]!.id;
      } else {
        const r = await q.query(
          `update assignment_rules set name = coalesce($2, name), active = coalesce($3, active), position = coalesce($4, position),
                  source_filter = case when $5::boolean then $6 else source_filter end,
                  team_id = case when $7::boolean then $8::uuid else team_id end
            where id = $1`,
          [ruleId, input.name ?? null, input.active ?? null, input.position ?? null, input.sourceFilter !== undefined,
            input.sourceFilter ?? null, input.teamId !== undefined, input.teamId ?? null]);
        if (!r.rowCount) throw Problem.notFound('Roteiro não encontrado.');
      }
      if (input.memberIds) {
        await q.query('delete from assignment_rule_members where rule_id = $1', [ruleId]);
        for (const [i, m] of [...new Set(input.memberIds)].entries()) {
          const ok = await q.query("select 1 from memberships where id = $1 and status = 'active'", [m]);
          if (!ok.rowCount) throw Problem.badRequest('Pessoa inválida.', [{ field: 'memberIds', message: 'Escolha pessoas ativas da empresa.' }]);
          await q.query(
            'insert into assignment_rule_members (tenant_id, rule_id, membership_id, position) values (app.tenant_id(), $1, $2, $3)',
            [ruleId, m, i]);
        }
        await q.query('update assignment_rules set last_position = -1 where id = $1', [ruleId]);
      }
      await audit(q, actor, id ? 'assignment_rule.updated' : 'assignment_rule.created', 'assignment_rule', ruleId, { fields: Object.keys(input) });
      return (await q.query('select id from assignment_rules where id = $1', [ruleId])).rows[0];
    });
  }

  async deleteRule(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query('delete from assignment_rules where id = $1', [id]);
      if (!r.rowCount) throw Problem.notFound('Roteiro não encontrado.');
      await audit(q, actor, 'assignment_rule.deleted', 'assignment_rule', id);
    });
  }
}
