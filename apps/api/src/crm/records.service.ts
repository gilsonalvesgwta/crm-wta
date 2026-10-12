import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { ContactsService } from './contacts.service.js';
import { DealsService } from './deals.service.js';
import { memberJson } from './fields.js';
import { LeadsService } from './leads.service.js';
import { OrganizationsService } from './organizations.service.js';
import { reachOf } from './sql.js';

export type RecordKind = 'contact' | 'organization' | 'deal' | 'lead';
export type RecordRef = { kind: RecordKind; id: string };

export const REF_COLUMN: Record<RecordKind, string> = {
  contact: 'contact_id', organization: 'organization_id', deal: 'deal_id', lead: 'lead_id',
};

/** Notas e linha do tempo de qualquer registro, respeitando o alcance dele. */
@Injectable()
export class RecordsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(OrganizationsService) private readonly orgs: OrganizationsService,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(LeadsService) private readonly leads: LeadsService,
  ) {}

  /** Confere o acesso ao registro: ver (`edit` falso) ou editar. 404 fora do alcance. */
  async assertAccess(q: Q, actor: Actor, ref: RecordRef, edit: boolean): Promise<void> {
    switch (ref.kind) {
      case 'contact':
        await this.contacts.visible(q, reachOf(actor, edit ? 'contacts:edit' : 'contacts:view'), ref.id);
        return;
      case 'organization':
        await this.orgs.visible(q, reachOf(actor, edit ? 'contacts:edit' : 'contacts:view'), ref.id);
        return;
      case 'deal':
        await this.deals.visible(q, actor, reachOf(actor, edit ? 'deals:edit' : 'deals:view'), ref.id);
        return;
      case 'lead':
        await this.leads.visible(q, reachOf(actor, edit ? 'leads:work' : 'leads:view'), ref.id);
        return;
    }
  }

  async notes(actor: Actor, ref: RecordRef) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.assertAccess(q, actor, ref, false);
      const rows = await q.query(
        `select n.id, n.body, n.pinned, n.created_at as "createdAt", n.updated_at as "updatedAt",
                ${memberJson('n.author_membership_id')} as author, n.author_membership_id = $2 as mine
           from notes n where n.${REF_COLUMN[ref.kind]} = $1 order by n.pinned desc, n.created_at desc limit 200`,
        [ref.id, actor.membershipId]);
      return rows.rows;
    });
  }

  async addNote(actor: Actor, ref: RecordRef, body: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.assertAccess(q, actor, ref, true);
      const col = REF_COLUMN[ref.kind];
      const r = await q.query<{ id: string }>(
        `insert into notes (tenant_id, body, author_membership_id, ${col}) values (app.tenant_id(), $1, $2, $3) returning id`,
        [body, actor.membershipId, ref.id]);
      const table = { contact: 'contacts', organization: 'organizations', deal: 'deals', lead: 'leads' }[ref.kind];
      await q.query(`update ${table} set last_activity_at = now() where id = $1`, [ref.id]);
      await q.query(
        `insert into timeline_entries (tenant_id, kind, actor_membership_id, ${col}, data) values (app.tenant_id(), 'note.added', $1, $2, $3)`,
        [actor.membershipId, ref.id, JSON.stringify({ noteId: r.rows[0]!.id })]);
      return (await q.query(
        `select n.id, n.body, n.pinned, n.created_at as "createdAt", n.updated_at as "updatedAt",
                ${memberJson('n.author_membership_id')} as author, true as mine from notes n where n.id = $1`, [r.rows[0]!.id])).rows[0];
    });
  }

  private async noteRef(q: Q, id: string): Promise<{ ref: RecordRef; author: string | null }> {
    const n = await q.query<{ contact_id: string | null; organization_id: string | null; deal_id: string | null; lead_id: string | null; author_membership_id: string | null }>(
      'select contact_id, organization_id, deal_id, lead_id, author_membership_id from notes where id = $1', [id]);
    const row = n.rows[0];
    if (!row) throw Problem.notFound('Nota não encontrada.');
    const ref: RecordRef = row.deal_id ? { kind: 'deal', id: row.deal_id }
      : row.lead_id ? { kind: 'lead', id: row.lead_id }
        : row.contact_id ? { kind: 'contact', id: row.contact_id } : { kind: 'organization', id: row.organization_id! };
    return { ref, author: row.author_membership_id };
  }

  /** Só o autor edita o texto; quem edita o registro pode fixar. */
  async updateNote(actor: Actor, id: string, input: { body?: string; pinned?: boolean }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const { ref, author } = await this.noteRef(q, id);
      await this.assertAccess(q, actor, ref, true);
      if (input.body !== undefined && author !== actor.membershipId) throw Problem.forbidden('Só quem escreveu a nota pode editá-la.');
      await q.query('update notes set body = coalesce($2, body), pinned = coalesce($3, pinned) where id = $1', [id, input.body ?? null, input.pinned ?? null]);
      return (await q.query(
        `select n.id, n.body, n.pinned, n.created_at as "createdAt", n.updated_at as "updatedAt",
                ${memberJson('n.author_membership_id')} as author, n.author_membership_id = $2 as mine from notes n where n.id = $1`,
        [id, actor.membershipId])).rows[0];
    });
  }

  async deleteNote(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const { ref, author } = await this.noteRef(q, id);
      await this.assertAccess(q, actor, ref, true);
      if (author !== actor.membershipId && actor.permissions.get('contacts:delete') !== 'tenant') {
        throw Problem.forbidden('Só quem escreveu a nota pode apagá-la.');
      }
      await q.query('delete from notes where id = $1', [id]);
    });
  }

  async timeline(actor: Actor, ref: RecordRef, before?: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.assertAccess(q, actor, ref, false);
      const rows = await q.query(
        `select t.id, t.kind, t.occurred_at as "occurredAt", t.data, ${memberJson('t.actor_membership_id')} as actor,
                (select json_build_object('id', d.id, 'title', d.title) from deals d where d.id = t.deal_id) as deal,
                (select json_build_object('id', l.id, 'title', l.title) from leads l where l.id = t.lead_id) as lead,
                (select json_build_object('id', c.id, 'name', c.name) from contacts c where c.id = t.contact_id) as contact
           from timeline_entries t
          where t.${REF_COLUMN[ref.kind]} = $1 and ($2::timestamptz is null or t.occurred_at < $2)
          order by t.occurred_at desc, t.id desc limit 50`, [ref.id, before ?? null]);
      return rows.rows;
    });
  }
}
