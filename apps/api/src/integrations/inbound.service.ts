import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { normalizeEmail, normalizePhone } from '../domain/contact-data.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { ContactsService } from '../crm/contacts.service.js';
import { DealsService } from '../crm/deals.service.js';
import { LeadsService } from '../crm/leads.service.js';
import { reachOf, timeline } from '../crm/sql.js';

export type InboundInput = {
  contact: {
    name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null;
    jobTitle?: string | null; birthday?: { day: number; month: number; year?: number | null } | null;
    custom?: Record<string, unknown>; tags?: string[]; ownerEmail?: string | null;
  };
  organization?: { name: string } | null;
  deal?: {
    title: string; value?: number | null; pipelineId?: string | null; pipeline?: string | null; stageId?: string | null; stage?: string | null;
    ownerEmail?: string | null; custom?: Record<string, unknown>; tags?: string[];
  } | null;
  lead?: { title: string; source?: string | null; ownerEmail?: string | null } | null;
  note?: string | null;
  touch?: { source?: string | null; medium?: string | null; campaign?: string | null; term?: string | null; content?: string | null; referrer?: string | null; landingPage?: string | null } | null;
};

/**
 * Entrada de dados pelo n8n (ou qualquer sistema com chave de API): acha ou
 * cria o contato (pelo e-mail ou telefone), a organização, as etiquetas, e
 * cria o negócio no funil e na etapa pedidos, ou um lead.
 */
@Injectable()
export class InboundService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(LeadsService) private readonly leads: LeadsService,
  ) {}

  private async memberByEmail(q: Q, email: string | null | undefined, field: string): Promise<string | undefined> {
    if (!email) return undefined;
    const r = await q.query<{ id: string }>(
      `select m.id from memberships m join users u on u.id = m.user_id where lower(u.email) = lower($1) and m.status = 'active'`, [email]);
    if (!r.rows[0]) throw Problem.badRequest('Responsável não encontrado.', [{ field, message: `Nenhuma pessoa ativa da empresa com o e-mail ${email}.` }]);
    return r.rows[0].id;
  }

  private async tagIds(q: Q, names: string[] | undefined): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of new Set((names ?? []).map((n) => n.trim()).filter(Boolean))) {
      const name = raw.slice(0, 60);
      const found = await q.query<{ id: string }>('select id from tags where lower(name) = lower($1)', [name]);
      ids.push(found.rows[0]?.id ?? (await q.query<{ id: string }>(
        'insert into tags (tenant_id, name) values (app.tenant_id(), $1) on conflict do nothing returning id', [name])).rows[0]?.id
        ?? (await q.query<{ id: string }>('select id from tags where lower(name) = lower($1)', [name])).rows[0]!.id);
    }
    return ids;
  }

  /** Funil e etapa pelo identificador ou pelo nome (sem diferença de maiúsculas e acentos). */
  private async place(q: Q, d: NonNullable<InboundInput['deal']>): Promise<{ pipelineId: string; stageId?: string }> {
    let pipelineId = d.pipelineId ?? undefined;
    if (!pipelineId && d.pipeline) {
      const p = await q.query<{ id: string }>('select id from pipelines where app.norm(name) = app.norm($1) and archived_at is null', [d.pipeline]);
      if (!p.rows[0]) throw Problem.badRequest('Funil não encontrado.', [{ field: 'deal.pipeline', message: `Não há funil chamado "${d.pipeline}".` }]);
      pipelineId = p.rows[0].id;
    }
    if (!pipelineId) {
      const p = await q.query<{ id: string }>('select id from pipelines where archived_at is null order by position, created_at limit 1');
      if (!p.rows[0]) throw Problem.badRequest('Nenhum funil.', [{ field: 'deal.pipeline', message: 'Crie um funil antes.' }]);
      pipelineId = p.rows[0].id;
    }
    let stageId = d.stageId ?? undefined;
    if (!stageId && d.stage) {
      const s = await q.query<{ id: string }>('select id from pipeline_stages where pipeline_id = $1 and app.norm(name) = app.norm($2)', [pipelineId, d.stage]);
      if (!s.rows[0]) throw Problem.badRequest('Etapa não encontrada.', [{ field: 'deal.stage', message: `O funil não tem a etapa "${d.stage}".` }]);
      stageId = s.rows[0].id;
    }
    return { pipelineId, stageId };
  }

  async receive(actor: Actor, input: InboundInput) {
    const email = input.contact.email ? normalizeEmail(input.contact.email) : null;
    if (input.contact.email && !email) throw Problem.badRequest('E-mail inválido.', [{ field: 'contact.email', message: 'Informe um e-mail válido.' }]);
    const phone = input.contact.phone ? normalizePhone(input.contact.phone) : null;
    if (input.contact.phone && !phone) throw Problem.badRequest('Telefone inválido.', [{ field: 'contact.phone', message: 'Informe o telefone com DDD.' }]);
    const [first, ...rest] = (input.contact.firstName ?? input.contact.name ?? '').trim().split(/\s+/);
    const firstName = input.contact.firstName?.trim() || first || email?.split('@')[0] || phone || '';
    const lastName = input.contact.firstName ? input.contact.lastName ?? null : input.contact.lastName ?? (rest.join(' ') || null);
    if (!firstName && !email && !phone) {
      throw Problem.badRequest('Informe o contato.', [{ field: 'contact', message: 'Informe ao menos nome, e-mail ou telefone.' }]);
    }

    return this.db.app(tenantCtx(actor), async (q) => {
      const r = reachOf(actor, 'contacts:edit');
      const tenantReach = { ...r, scope: 'tenant' as const };
      const contactOwner = await this.memberByEmail(q, input.contact.ownerEmail, 'contact.ownerEmail');

      // Organização pelo nome.
      let organizationId: string | null = null;
      if (input.organization?.name?.trim()) {
        const name = input.organization.name.trim().slice(0, 200);
        organizationId = (await q.query<{ id: string }>('select id from organizations where app.norm(name) = app.norm($1) limit 1', [name])).rows[0]?.id
          ?? (await q.query<{ id: string }>(
            'insert into organizations (tenant_id, name, owner_membership_id, created_by) values (app.tenant_id(), $1, $2, $2) returning id',
            [name, contactOwner ?? actor.membershipId])).rows[0]!.id;
      }

      // Contato: o mesmo e-mail ou telefone, em qualquer cadastro da empresa.
      const dup = await this.contacts.findDuplicates(q, tenantReach, email ? [email] : [], phone ? [phone] : []);
      let contactId = dup[0]?.id;
      const created = !contactId;
      const touch = input.touch && Object.values(input.touch).some((v) => v) ? { ...input.touch, via: 'api' as const } : undefined;
      if (!contactId) {
        contactId = await this.contacts.createIn(q, actor, tenantReach, {
          firstName, lastName, jobTitle: input.contact.jobTitle ?? null, organizationId,
          emails: email ? [{ email, isPrimary: true }] : [], phones: phone ? [{ number: phone, isPrimary: true }] : [],
          birthday: input.contact.birthday ?? null, custom: input.contact.custom, ownerId: contactOwner,
        }, { allowDuplicate: true, touch: touch ?? { via: 'api' } });
      } else {
        // Já existe: completa o que falta, sem apagar nada.
        if (email) await q.query('insert into contact_emails (tenant_id, contact_id, email) values (app.tenant_id(), $1, $2) on conflict do nothing', [contactId, email]);
        if (phone) await q.query('insert into contact_phones (tenant_id, contact_id, e164) values (app.tenant_id(), $1, $2) on conflict do nothing', [contactId, phone]);
        if (organizationId) await q.query('update contacts set organization_id = coalesce(organization_id, $2) where id = $1', [contactId, organizationId]);
        if (touch) await this.contacts.recordTouch(q, contactId, touch);
        await timeline(q, actor, 'contact.updated', { contactId }, { via: 'api', fields: ['integração'] });
      }
      for (const t of await this.tagIds(q, input.contact.tags)) {
        await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2) on conflict do nothing', [contactId, t]);
      }

      let dealId: string | null = null;
      if (input.deal) {
        const where = await this.place(q, input.deal);
        const owner = await this.memberByEmail(q, input.deal.ownerEmail, 'deal.ownerEmail') ?? contactOwner;
        dealId = await this.deals.createIn(q, actor, { ...reachOf(actor, 'deals:edit'), scope: 'tenant' }, {
          ...where, title: input.deal.title, valueCents: input.deal.value != null ? Math.round(input.deal.value * 100) : undefined,
          contactId, organizationId, ownerId: owner, custom: input.deal.custom, tagIds: await this.tagIds(q, input.deal.tags),
        });
      }

      let leadId: string | null = null;
      if (input.lead) {
        const owner = await this.memberByEmail(q, input.lead.ownerEmail, 'lead.ownerEmail') ?? contactOwner;
        leadId = await this.leads.createIn(q, actor, { ...reachOf(actor, 'leads:work'), scope: 'tenant' }, {
          title: input.lead.title, contactId, source: input.lead.source ?? null, ownerId: owner,
        }, 'api');
      }

      if (input.note?.trim()) {
        const col = dealId ? 'deal_id' : 'contact_id';
        await q.query(`insert into notes (tenant_id, body, author_membership_id, ${col}) values (app.tenant_id(), $1, $2, $3)`,
          [input.note.trim().slice(0, 10000), actor.membershipId, dealId ?? contactId]);
      }
      return { contactId, created, organizationId, dealId, leadId };
    });
  }
}
