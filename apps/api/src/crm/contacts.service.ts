import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { normalizeEmail, normalizePhone, digits } from '../domain/contact-data.js';
import { Problem, type FieldError } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { checkTags, customFor, memberJson } from './fields.js';
import {
  Params, assertOwnerInReach, assertTeamInReach, changedFields, likeEscape, pageOf, reachOf, reachSql, timeline,
  type Page, type Reach,
} from './sql.js';

export type EmailIn = { email: string; label?: 'work' | 'personal' | 'other'; isPrimary?: boolean };
export type PhoneIn = { number: string; label?: 'mobile' | 'whatsapp' | 'work' | 'home' | 'other'; isPrimary?: boolean };
export type Touch = {
  source?: string | null; medium?: string | null; campaign?: string | null; term?: string | null; content?: string | null;
  clickIds?: Record<string, string>; referrer?: string | null; landingPage?: string | null;
};

export type ContactInput = {
  firstName?: string;
  lastName?: string | null;
  jobTitle?: string | null;
  organizationId?: string | null;
  taxId?: string | null;
  birthday?: { day: number; month: number; year?: number | null } | null;
  address?: Record<string, string>;
  ownerId?: string | null;
  teamId?: string | null;
  emails?: EmailIn[];
  phones?: PhoneIn[];
  tagIds?: string[];
  custom?: Record<string, unknown>;
};

export type ContactFilters = {
  q?: string; ownerId?: string; teamId?: string; organizationId?: string; tagId?: string;
  createdFrom?: string; createdTo?: string; birthdayMonth?: number;
  sort: 'name' | 'created' | 'updated' | 'activity'; dir: 'asc' | 'desc'; page: number; pageSize: number;
};

const LIST_COLS = `
  c.id, c.first_name as "firstName", c.last_name as "lastName", c.name, c.job_title as "jobTitle",
  c.created_at as "createdAt", c.updated_at as "updatedAt", c.last_activity_at as "lastActivityAt",
  (select json_build_object('id', o.id, 'name', o.name) from organizations o where o.id = c.organization_id) as organization,
  (select e.email from contact_emails e where e.contact_id = c.id order by e.is_primary desc, e.created_at limit 1) as email,
  (select p.e164 from contact_phones p where p.contact_id = c.id order by p.is_primary desc, p.created_at limit 1) as phone,
  ${memberJson('c.owner_membership_id')} as owner,
  coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by lower(t.name))
            from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = c.id), '[]') as tags`;

/** Além do responsável: contatos dos negócios e leads da pessoa. */
export const contactOwnExtra = (me: string) => `(
  exists (select 1 from deals d where d.contact_id = c.id and (d.owner_membership_id = ${me}
          or exists (select 1 from deal_participants dp where dp.deal_id = d.id and dp.membership_id = ${me})))
  or exists (select 1 from leads l where l.contact_id = c.id and l.owner_membership_id = ${me}))`;

export type DuplicateCandidate = { id: string; name: string; matchedBy: ('email' | 'phone')[]; visible: boolean };

@Injectable()
export class ContactsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---- Leitura ---------------------------------------------------------------

  async list(actor: Actor, f: ContactFilters): Promise<Page<Record<string, unknown>>> {
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const where = [reachSql(p, 'c', r, contactOwnExtra)];
      if (f.q) {
        const term = f.q.trim();
        const like = p.add(`%${likeEscape(term.toLowerCase())}%`);
        const conds = [`app.norm(c.first_name || ' ' || coalesce(c.last_name, '')) like app.norm(${like})`,
          `exists (select 1 from contact_emails e where e.contact_id = c.id and e.email like ${like})`];
        const ph = digits(term);
        if (ph.length >= 4) conds.push(`exists (select 1 from contact_phones ph where ph.contact_id = c.id and ph.e164 like ${p.add(`%${ph}%`)})`);
        if (digits(term).length >= 11) conds.push(`regexp_replace(coalesce(c.tax_id, ''), '\\D', '', 'g') = ${p.add(digits(term))}`);
        where.push(`(${conds.join(' or ')})`);
      }
      if (f.ownerId) where.push(f.ownerId === 'none' ? 'c.owner_membership_id is null' : `c.owner_membership_id = ${p.add(f.ownerId)}`);
      if (f.teamId) where.push(`c.team_id = ${p.add(f.teamId)}`);
      if (f.organizationId) where.push(`c.organization_id = ${p.add(f.organizationId)}`);
      if (f.tagId) where.push(`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${p.add(f.tagId)})`);
      if (f.createdFrom) where.push(`c.created_at >= ${p.add(f.createdFrom)}`);
      if (f.createdTo) where.push(`c.created_at < ${p.add(f.createdTo)}`);
      if (f.birthdayMonth) where.push(`c.birth_month = ${p.add(f.birthdayMonth)}`);
      const dir = f.dir === 'asc' ? 'asc' : 'desc';
      const order = {
        name: `lower(c.first_name) ${dir}, lower(coalesce(c.last_name, '')) ${dir}`,
        created: `c.created_at ${dir}`,
        updated: `c.updated_at ${dir}`,
        activity: `c.last_activity_at ${dir} nulls last`,
      }[f.sort];
      const { limit, offset } = pageOf(f.page, f.pageSize);
      const whereSql = where.join(' and ');
      const total = await q.query<{ n: number }>(`select count(*)::int as n from contacts c where ${whereSql}`, p.values);
      const rows = await q.query(
        `select ${LIST_COLS} from contacts c where ${whereSql} order by ${order}, c.id limit ${p.add(limit)} offset ${p.add(offset)}`,
        p.values);
      return { items: rows.rows, total: total.rows[0]!.n, page: f.page, pageSize: f.pageSize };
    });
  }

  /** Carrega o contato se estiver no alcance; senão, 404. */
  async visible(q: Q, r: Reach, id: string): Promise<{ id: string; organization_id: string | null; owner_membership_id: string | null; team_id: string | null; custom: Record<string, unknown> }> {
    const p = new Params();
    const row = await q.query<{ id: string; organization_id: string | null; owner_membership_id: string | null; team_id: string | null; custom: Record<string, unknown> }>(
      `select c.id, c.organization_id, c.owner_membership_id, c.team_id, c.custom from contacts c
        where c.id = ${p.add(id)} and ${reachSql(p, 'c', r, contactOwnExtra)}`, p.values);
    if (!row.rows[0]) throw Problem.notFound('Contato não encontrado.');
    return row.rows[0];
  }

  async get(actor: Actor, id: string) {
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      return this.detail(q, id);
    });
  }

  async detail(q: Q, id: string) {
    const c = await q.query(
      `select ${LIST_COLS}, c.tax_id as "taxId", c.address, c.custom, c.team_id as "teamId",
              (select json_build_object('id', tm.id, 'name', tm.name) from teams tm where tm.id = c.team_id) as team,
              case when c.birth_day is null then null
                   else json_build_object('day', c.birth_day, 'month', c.birth_month, 'year', c.birth_year) end as birthday,
              c.anonymized_at as "anonymizedAt"
         from contacts c where c.id = $1`, [id]);
    const row = c.rows[0] as Record<string, unknown>;
    const [emails, phones, touches, consents, counts] = await Promise.all([
      q.query('select id, email, label, is_primary as "isPrimary" from contact_emails where contact_id = $1 order by is_primary desc, created_at', [id]),
      q.query('select id, e164 as number, label, is_primary as "isPrimary" from contact_phones where contact_id = $1 order by is_primary desc, created_at', [id]),
      q.query(
        `(select 'first' as which, occurred_at as "occurredAt", recorded_via as via, source, medium, campaign, term, content,
                 click_ids as "clickIds", referrer, landing_page as "landingPage"
            from attribution_touches where contact_id = $1 order by occurred_at, id limit 1)
         union all
         (select 'last', occurred_at, recorded_via, source, medium, campaign, term, content, click_ids, referrer, landing_page
            from attribution_touches where contact_id = $1 order by occurred_at desc, id desc limit 1)
         union all
         (select 'count', null, null, count(*)::text, null, null, null, null, null, null, null
            from attribution_touches where contact_id = $1)`, [id]),
      q.query(
        `select distinct on (channel, purpose) channel, purpose, status, source, recorded_at as "recordedAt"
           from consents where contact_id = $1 order by channel, purpose, recorded_at desc`, [id]),
      q.query<{ deals: number; open_deals: number; leads: number; open_activities: number; files: number }>(
        `select (select count(*)::int from deals where contact_id = $1) as deals,
                (select count(*)::int from deals where contact_id = $1 and status = 'open') as open_deals,
                (select count(*)::int from leads where contact_id = $1) as leads,
                (select count(*)::int from activities where contact_id = $1 and status = 'open') as open_activities,
                (select count(*)::int from files where contact_id = $1 and deleted_at is null) as files`, [id]),
    ]);
    const t = touches.rows as Record<string, unknown>[];
    const strip = (x: Record<string, unknown> | undefined) => {
      if (!x) return null;
      const { which: _w, ...rest } = x;
      return rest;
    };
    const touchCount = Number(t.find((x) => x.which === 'count')?.source ?? 0);
    const k = counts.rows[0]!;
    return {
      ...row,
      emails: emails.rows,
      phones: phones.rows,
      attribution: touchCount === 0 ? null : {
        first: strip(t.find((x) => x.which === 'first')),
        last: strip(t.find((x) => x.which === 'last')),
        touches: touchCount,
      },
      consents: consents.rows,
      counts: { deals: k.deals, openDeals: k.open_deals, leads: k.leads, openActivities: k.open_activities, files: k.files },
    };
  }

  // ---- Duplicados ------------------------------------------------------------

  /** Contatos com o mesmo e-mail ou telefone normalizado. */
  async findDuplicates(q: Q, r: Reach, emails: string[], phones: string[], excludeId?: string): Promise<DuplicateCandidate[]> {
    if (!emails.length && !phones.length) return [];
    const p = new Params();
    const vis = reachSql(p, 'c', r, contactOwnExtra);
    const rows = await q.query<{ id: string; name: string; by_email: boolean; by_phone: boolean; visible: boolean }>(
      `select c.id, c.name,
              exists (select 1 from contact_emails e where e.contact_id = c.id and e.email = any(${p.add(emails)}::text[])) as by_email,
              exists (select 1 from contact_phones ph where ph.contact_id = c.id and ph.e164 = any(${p.add(phones)}::text[])) as by_phone,
              ${vis} as visible
         from contacts c
        where (c.id in (select contact_id from contact_emails where email = any(${p.add(emails)}::text[]))
            or c.id in (select contact_id from contact_phones where e164 = any(${p.add(phones)}::text[])))
          and c.id is distinct from ${p.add(excludeId ?? null)}::uuid
          and c.anonymized_at is null
        order by c.created_at limit 20`, p.values);
    return rows.rows.map((x) => ({
      id: x.id,
      // Fora do alcance, o nome não é revelado: só que existe um cadastro.
      name: x.visible ? x.name : 'Contato de outro responsável',
      matchedBy: [...(x.by_email ? ['email' as const] : []), ...(x.by_phone ? ['phone' as const] : [])],
      visible: x.visible,
    }));
  }

  async duplicatesOf(actor: Actor, id: string) {
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      const e = await q.query<{ email: string }>('select email from contact_emails where contact_id = $1', [id]);
      const ph = await q.query<{ e164: string }>('select e164 from contact_phones where contact_id = $1', [id]);
      const all = await this.findDuplicates(q, r, e.rows.map((x) => x.email), ph.rows.map((x) => x.e164), id);
      return all.filter((d) => d.visible);
    });
  }

  // ---- Escrita ----------------------------------------------------------------

  private normalizeContacts(input: ContactInput): { emails?: EmailIn[]; phones?: PhoneIn[]; errors: FieldError[] } {
    const errors: FieldError[] = [];
    let emails: EmailIn[] | undefined;
    let phones: PhoneIn[] | undefined;
    if (input.emails) {
      emails = [];
      input.emails.forEach((e, i) => {
        const n = normalizeEmail(e.email);
        if (!n) errors.push({ field: `emails.${i}.email`, message: 'E-mail inválido.' });
        else if (!emails!.some((x) => x.email === n)) emails!.push({ ...e, email: n });
      });
    }
    if (input.phones) {
      phones = [];
      input.phones.forEach((ph, i) => {
        const n = normalizePhone(ph.number);
        if (!n) errors.push({ field: `phones.${i}.number`, message: 'Telefone inválido. Inclua o DDD.' });
        else if (!phones!.some((x) => x.number === n)) phones!.push({ ...ph, number: n });
      });
    }
    return { emails, phones, errors };
  }

  private async writeChannels(q: Q, contactId: string, emails?: EmailIn[], phones?: PhoneIn[]): Promise<void> {
    if (emails) {
      await q.query('delete from contact_emails where contact_id = $1', [contactId]);
      const primary = emails.findIndex((e) => e.isPrimary);
      for (const [i, e] of emails.entries()) {
        await q.query(
          'insert into contact_emails (tenant_id, contact_id, email, label, is_primary) values (app.tenant_id(), $1, $2, $3, $4)',
          [contactId, e.email, e.label ?? 'work', i === (primary === -1 ? 0 : primary)]);
      }
    }
    if (phones) {
      await q.query('delete from contact_phones where contact_id = $1', [contactId]);
      const primary = phones.findIndex((x) => x.isPrimary);
      for (const [i, ph] of phones.entries()) {
        await q.query(
          'insert into contact_phones (tenant_id, contact_id, e164, label, is_primary) values (app.tenant_id(), $1, $2, $3, $4)',
          [contactId, ph.number, ph.label ?? 'mobile', i === (primary === -1 ? 0 : primary)]);
      }
    }
  }

  private async checkOrganization(q: Q, actor: Actor, orgId: string | null | undefined): Promise<void> {
    if (!orgId) return;
    const r = await q.query('select 1 from organizations where id = $1', [orgId]);
    if (!r.rowCount) throw Problem.badRequest('Organização inválida.', [{ field: 'organizationId', message: 'Escolha uma organização da lista.' }]);
  }

  /**
   * Cria um contato dentro de uma transação existente. Usado também pela
   * importação e pela criação de leads.
   */
  async createIn(q: Q, actor: Actor, r: Reach, input: ContactInput & { firstName: string },
    opts: { allowDuplicate: boolean; touch?: Touch & { via: 'manual' | 'import' | 'form' | 'api' } }): Promise<string> {
    const n = this.normalizeContacts(input);
    if (n.errors.length) throw Problem.badRequest('Confira os campos destacados.', n.errors);
    if (!opts.allowDuplicate) {
      const dup = await this.findDuplicates(q, r, (n.emails ?? []).map((e) => e.email), (n.phones ?? []).map((x) => x.number));
      if (dup.length) {
        throw new Problem(409, 'Já existe um contato com este e-mail ou telefone.', 'duplicate', undefined, undefined, undefined,
          { duplicates: dup });
      }
    }
    // Sem responsável informado, quem cria é o responsável.
    const owner = input.ownerId === undefined ? r.me : input.ownerId;
    await assertOwnerInReach(q, r, owner);
    await assertTeamInReach(q, r, input.teamId);
    if (r.scope === 'own' && owner !== r.me) {
      throw Problem.badRequest('Responsável fora do seu alcance.', [{ field: 'ownerId', message: 'Você só pode criar contatos seus.' }]);
    }
    await this.checkOrganization(q, actor, input.organizationId);
    await checkTags(q, input.tagIds);
    const custom = await customFor(q, 'contact', input.custom, {}, false);
    const b = input.birthday ?? null;
    let id: string;
    try {
      const row = await q.query<{ id: string }>(
        `insert into contacts (tenant_id, first_name, last_name, job_title, organization_id, tax_id, birth_day, birth_month, birth_year,
                               address, owner_membership_id, team_id, custom, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
        [input.firstName, input.lastName ?? null, input.jobTitle ?? null, input.organizationId ?? null, input.taxId ?? null,
          b?.day ?? null, b?.month ?? null, b?.year ?? null, JSON.stringify(input.address ?? {}), owner, input.teamId ?? null,
          JSON.stringify(custom), actor.membershipId]);
      id = row.rows[0]!.id;
    } catch (err) {
      if (pgCode(err) === '22008') throw Problem.badRequest('Data inválida.', [{ field: 'birthday', message: 'Esta data não existe.' }]);
      throw err;
    }
    await this.writeChannels(q, id, n.emails, n.phones);
    for (const t of new Set(input.tagIds ?? [])) {
      await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2)', [id, t]);
    }
    if (opts.touch) await this.recordTouch(q, id, opts.touch);
    await timeline(q, actor, 'contact.created', { contactId: id, organizationId: input.organizationId }, { via: opts.touch?.via ?? 'manual' });
    return id;
  }

  async create(actor: Actor, input: ContactInput & { firstName: string }, opts: { allowDuplicate: boolean; touch?: Touch }) {
    const r = reachOf(actor, 'contacts:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      const touch = opts.touch && Object.values(opts.touch).some((v) => v !== null && v !== undefined && v !== '')
        ? { ...opts.touch, via: 'manual' as const } : undefined;
      const id = await this.createIn(q, actor, r, input, { allowDuplicate: opts.allowDuplicate, touch });
      return this.detail(q, id);
    });
  }

  async recordTouch(q: Q, contactId: string, t: Touch & { via: string }, refs: { leadId?: string; dealId?: string } = {}): Promise<void> {
    await q.query(
      `insert into attribution_touches (tenant_id, contact_id, lead_id, deal_id, recorded_via, source, medium, campaign, term, content,
                                        click_ids, referrer, landing_page)
       values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [contactId, refs.leadId ?? null, refs.dealId ?? null, t.via, t.source || null, t.medium || null, t.campaign || null,
        t.term || null, t.content || null, JSON.stringify(t.clickIds ?? {}), t.referrer || null, t.landingPage || null]);
  }

  async addTouch(actor: Actor, id: string, t: Touch) {
    const r = reachOf(actor, 'contacts:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      await this.recordTouch(q, id, { ...t, via: 'manual' });
      await timeline(q, actor, 'attribution.recorded', { contactId: id }, { source: t.source ?? null, medium: t.medium ?? null });
      return this.detail(q, id);
    });
  }

  async update(actor: Actor, id: string, input: ContactInput) {
    const r = reachOf(actor, 'contacts:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.visible(q, r, id);
      const anon = await q.query('select 1 from contacts where id = $1 and anonymized_at is not null', [id]);
      if (anon.rowCount) throw Problem.conflict('Este contato foi anonimizado e não pode ser editado.');
      const n = this.normalizeContacts(input);
      if (n.errors.length) throw Problem.badRequest('Confira os campos destacados.', n.errors);
      if (input.ownerId !== undefined && input.ownerId !== cur.owner_membership_id) {
        await assertOwnerInReach(q, r, input.ownerId);
      }
      if (input.teamId !== undefined) await assertTeamInReach(q, r, input.teamId);
      if (input.organizationId !== undefined) await this.checkOrganization(q, actor, input.organizationId);
      if (input.tagIds) await checkTags(q, input.tagIds);
      const custom = input.custom ? await customFor(q, 'contact', input.custom, cur.custom, true) : undefined;
      const before = (await q.query('select first_name, last_name, job_title, organization_id, tax_id, birth_day, birth_month, birth_year, address, owner_membership_id, team_id, custom from contacts where id = $1', [id])).rows[0] as Record<string, unknown>;
      const b = input.birthday;
      try {
        await q.query(
          `update contacts set
             first_name = coalesce($2, first_name),
             last_name = case when $3::boolean then $4 else last_name end,
             job_title = case when $5::boolean then $6 else job_title end,
             organization_id = case when $7::boolean then $8::uuid else organization_id end,
             tax_id = case when $9::boolean then $10 else tax_id end,
             birth_day = case when $11::boolean then $12::smallint else birth_day end,
             birth_month = case when $11::boolean then $13::smallint else birth_month end,
             birth_year = case when $11::boolean then $14::smallint else birth_year end,
             address = coalesce($15::jsonb, address),
             owner_membership_id = case when $16::boolean then $17::uuid else owner_membership_id end,
             team_id = case when $18::boolean then $19::uuid else team_id end,
             custom = coalesce($20::jsonb, custom)
           where id = $1`,
          [id, input.firstName ?? null,
            input.lastName !== undefined, input.lastName ?? null,
            input.jobTitle !== undefined, input.jobTitle ?? null,
            input.organizationId !== undefined, input.organizationId ?? null,
            input.taxId !== undefined, input.taxId ?? null,
            b !== undefined, b?.day ?? null, b?.month ?? null, b?.year ?? null,
            input.address ? JSON.stringify(input.address) : null,
            input.ownerId !== undefined, input.ownerId ?? null,
            input.teamId !== undefined, input.teamId ?? null,
            custom ? JSON.stringify(custom) : null]);
      } catch (err) {
        if (pgCode(err) === '22008' || pgCode(err) === '23514') {
          throw Problem.badRequest('Data inválida.', [{ field: 'birthday', message: 'Esta data não existe.' }]);
        }
        throw err;
      }
      await this.writeChannels(q, id, n.emails, n.phones);
      if (input.tagIds) {
        await q.query('delete from contact_tags where contact_id = $1', [id]);
        for (const t of new Set(input.tagIds)) {
          await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2)', [id, t]);
        }
      }
      const after = (await q.query('select first_name, last_name, job_title, organization_id, tax_id, birth_day, birth_month, birth_year, address, owner_membership_id, team_id, custom from contacts where id = $1', [id])).rows[0] as Record<string, unknown>;
      const fields = changedFields(before, after);
      if (n.emails) fields.push('emails');
      if (n.phones) fields.push('phones');
      if (input.tagIds) fields.push('tags');
      if (fields.length) await timeline(q, actor, 'contact.updated', { contactId: id }, { fields });
      if (before.owner_membership_id !== after.owner_membership_id) {
        await timeline(q, actor, 'contact.owner_changed', { contactId: id }, { from: before.owner_membership_id, to: after.owner_membership_id });
      }
      return this.detail(q, id);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const r = reachOf(actor, 'contacts:delete');
    await this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      const c = (await q.query<{ name: string }>('select name from contacts where id = $1', [id])).rows[0]!;
      await q.query('delete from contacts where id = $1', [id]);
      await audit(q, actor, 'contact.deleted', 'contact', id, { name: c.name });
    });
  }

  /**
   * Mescla `mergedId` em `keepId`. O contato mantido conserva seus dados e
   * recebe o que faltava; tudo o que apontava para o outro passa a apontar para
   * ele. O outro é apagado, e uma cópia dele fica no registro da mesclagem.
   */
  async merge(actor: Actor, keepId: string, mergedId: string) {
    if (keepId === mergedId) throw Problem.badRequest('Escolha dois contatos diferentes.');
    const r = reachOf(actor, 'contacts:delete');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, keepId);
      await this.visible(q, r, mergedId);
      // Trava os dois na mesma ordem, para mesclagens simultâneas não se cruzarem.
      await q.query('select id from contacts where id = any($1::uuid[]) order by id for update', [[keepId, mergedId]]);
      const snap = await q.query(
        `select row_to_json(c)::jsonb
                || jsonb_build_object(
                     'emails', (select coalesce(jsonb_agg(e.email), '[]') from contact_emails e where e.contact_id = c.id),
                     'phones', (select coalesce(jsonb_agg(p.e164), '[]') from contact_phones p where p.contact_id = c.id),
                     'tags', (select coalesce(jsonb_agg(t.tag_id), '[]') from contact_tags t where t.contact_id = c.id)) as s
           from contacts c where c.id = $1`, [mergedId]);
      await q.query(
        `update contacts k set
           last_name = coalesce(k.last_name, m.last_name),
           job_title = coalesce(k.job_title, m.job_title),
           organization_id = coalesce(k.organization_id, m.organization_id),
           tax_id = coalesce(k.tax_id, m.tax_id),
           birth_day = case when k.birth_day is null then m.birth_day else k.birth_day end,
           birth_month = case when k.birth_day is null then m.birth_month else k.birth_month end,
           birth_year = case when k.birth_day is null then m.birth_year else k.birth_year end,
           address = case when k.address = '{}'::jsonb then m.address else k.address end,
           owner_membership_id = coalesce(k.owner_membership_id, m.owner_membership_id),
           team_id = coalesce(k.team_id, m.team_id),
           custom = m.custom || k.custom,
           last_activity_at = greatest(k.last_activity_at, m.last_activity_at),
           created_at = least(k.created_at, m.created_at)
         from contacts m where k.id = $1 and m.id = $2`, [keepId, mergedId]);
      await q.query(
        `insert into contact_emails (tenant_id, contact_id, email, label, is_primary)
         select tenant_id, $1, email, label, false from contact_emails where contact_id = $2
         on conflict (contact_id, email) do nothing`, [keepId, mergedId]);
      await q.query(
        `insert into contact_phones (tenant_id, contact_id, e164, label, is_primary)
         select tenant_id, $1, e164, label, false from contact_phones where contact_id = $2
         on conflict (contact_id, e164) do nothing`, [keepId, mergedId]);
      await q.query(
        `insert into contact_tags (tenant_id, contact_id, tag_id)
         select tenant_id, $1, tag_id from contact_tags where contact_id = $2 on conflict do nothing`, [keepId, mergedId]);
      for (const table of ['deals', 'leads', 'notes', 'activities', 'files', 'messages']) {
        await q.query(`update ${table} set contact_id = $1 where contact_id = $2`, [keepId, mergedId]);
      }
      // Registros só de inserção são copiados para o contato mantido.
      await q.query(
        `insert into timeline_entries (tenant_id, occurred_at, kind, actor_membership_id, contact_id, organization_id, deal_id, lead_id, data)
         select tenant_id, occurred_at, kind, actor_membership_id, $1, organization_id, deal_id, lead_id, data || '{"mergedFrom":true}'
           from timeline_entries where contact_id = $2`, [keepId, mergedId]);
      await q.query(
        `insert into attribution_touches (tenant_id, contact_id, lead_id, deal_id, occurred_at, recorded_via, source, medium, campaign,
                                          term, content, click_ids, referrer, landing_page)
         select tenant_id, $1, lead_id, deal_id, occurred_at, recorded_via, source, medium, campaign, term, content, click_ids,
                referrer, landing_page from attribution_touches where contact_id = $2`, [keepId, mergedId]);
      await q.query(
        `insert into consents (tenant_id, contact_id, channel, purpose, status, source, evidence, recorded_by, recorded_at)
         select tenant_id, $1, channel, purpose, status, source, evidence, recorded_by, recorded_at
           from consents where contact_id = $2`, [keepId, mergedId]);
      await q.query(
        `insert into contact_merges (tenant_id, kept_contact_id, merged_contact_id, snapshot, merged_by)
         values (app.tenant_id(), $1, $2, $3, $4)`, [keepId, mergedId, JSON.stringify(snap.rows[0]!.s), actor.membershipId]);
      await q.query('delete from contacts where id = $1', [mergedId]);
      await timeline(q, actor, 'contact.merged', { contactId: keepId }, { mergedContactId: mergedId });
      await audit(q, actor, 'contact.merged', 'contact', keepId, { mergedContactId: mergedId });
      return this.detail(q, keepId);
    });
  }

  // ---- Consentimento -----------------------------------------------------------

  async recordConsent(actor: Actor, id: string, c: { channel: string; purpose: string; status: 'granted' | 'revoked'; source: string; evidence?: string | null }) {
    const r = reachOf(actor, 'contacts:edit');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      await q.query(
        `insert into consents (tenant_id, contact_id, channel, purpose, status, source, evidence, recorded_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [id, c.channel, c.purpose, c.status, c.source, c.evidence ?? null, actor.membershipId]);
      if (c.status === 'revoked' && c.purpose === 'marketing') {
        // Opt-out: os endereços do contato entram na lista de supressão do canal.
        const values = c.channel === 'email'
          ? (await q.query<{ v: string }>('select email as v from contact_emails where contact_id = $1', [id])).rows
          : ['whatsapp', 'sms', 'phone'].includes(c.channel)
            ? (await q.query<{ v: string }>('select e164 as v from contact_phones where contact_id = $1', [id])).rows
            : [];
        for (const v of values) {
          await q.query(
            `insert into suppression_list (tenant_id, channel, value, reason, created_by) values (app.tenant_id(), $1, $2, 'opt_out', $3)
             on conflict (tenant_id, channel, value) do nothing`, [c.channel, v.v, actor.membershipId]);
        }
      } else if (c.status === 'granted' && c.purpose === 'marketing') {
        await q.query(
          `delete from suppression_list where channel = $1 and reason in ('opt_out', 'manual') and value in (
             select email from contact_emails where contact_id = $2 union select e164 from contact_phones where contact_id = $2)`,
          [c.channel, id]);
      }
      await timeline(q, actor, 'consent.recorded', { contactId: id }, { channel: c.channel, purpose: c.purpose, status: c.status });
      return this.detail(q, id);
    });
  }

  async consentHistory(actor: Actor, id: string) {
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, r, id);
      const rows = await q.query(
        `select id, channel, purpose, status, source, evidence, recorded_at as "recordedAt", ${memberJson('recorded_by')} as "recordedBy"
           from consents where contact_id = $1 order by recorded_at desc`, [id]);
      return rows.rows;
    });
  }
}
