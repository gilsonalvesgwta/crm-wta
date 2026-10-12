import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { Problem } from '../http/problem.js';
import { Db } from '../infra/db.js';
import { Storage } from '../infra/storage.js';

/**
 * Direitos do titular (LGPD): exportar tudo o que a empresa guarda sobre um
 * contato, e anonimizar. Exige privacy:execute, com 2FA confirmado.
 */
@Injectable()
export class PrivacyService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(Storage) private readonly storage: Storage) {}

  async exportSubject(actor: Actor, contactId: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const c = await q.query(
        `select id, first_name as "firstName", last_name as "lastName", job_title as "jobTitle", tax_id as "taxId",
                birth_day as "birthDay", birth_month as "birthMonth", birth_year as "birthYear", address, custom,
                created_at as "createdAt", updated_at as "updatedAt", anonymized_at as "anonymizedAt",
                (select name from organizations o where o.id = contacts.organization_id) as organization
           from contacts where id = $1`, [contactId]);
      if (!c.rows[0]) throw Problem.notFound('Contato não encontrado.');
      const [emails, phones, notes, activities, deals, leads, consents, touches, files, timelineRows] = await Promise.all([
        q.query('select email, label, created_at as "createdAt" from contact_emails where contact_id = $1', [contactId]),
        q.query('select e164 as number, label, created_at as "createdAt" from contact_phones where contact_id = $1', [contactId]),
        q.query('select body, created_at as "createdAt" from notes where contact_id = $1 order by created_at', [contactId]),
        q.query('select type, title, description, starts_at as "startsAt", status from activities where contact_id = $1 order by starts_at', [contactId]),
        q.query('select title, value_cents as "valueCents", currency, status, created_at as "createdAt", closed_at as "closedAt" from deals where contact_id = $1', [contactId]),
        q.query('select title, status, source, created_at as "createdAt" from leads where contact_id = $1', [contactId]),
        q.query('select channel, purpose, status, source, evidence, recorded_at as "recordedAt" from consents where contact_id = $1 order by recorded_at', [contactId]),
        q.query('select occurred_at as "occurredAt", source, medium, campaign, term, content, click_ids as "clickIds", referrer, landing_page as "landingPage" from attribution_touches where contact_id = $1 order by occurred_at', [contactId]),
        q.query('select original_name as "name", content_type as "contentType", size_bytes as "sizeBytes", created_at as "createdAt" from files where contact_id = $1 and deleted_at is null', [contactId]),
        q.query('select kind, occurred_at as "occurredAt" from timeline_entries where contact_id = $1 order by occurred_at', [contactId]),
      ]);
      const out = {
        generatedAt: new Date().toISOString(),
        contact: c.rows[0], emails: emails.rows, phones: phones.rows, notes: notes.rows, activities: activities.rows, deals: deals.rows,
        leads: leads.rows, consents: consents.rows, attribution: touches.rows, files: files.rows, history: timelineRows.rows,
      };
      await q.query(`insert into exports (tenant_id, entity, filters, row_count, created_by) values (app.tenant_id(), 'privacy', $1, 1, $2)`,
        [JSON.stringify({ contactId }), actor.membershipId]);
      await audit(q, actor, 'privacy.exported', 'contact', contactId);
      return out;
    });
  }

  /**
   * Anonimiza o titular. O registro continua existindo, sem nada que o
   * identifique, para que negócios e números históricos não se percam.
   * Apaga: e-mails, telefones, notas, arquivos, histórico, etiquetas e campos.
   * Mantém: negócios e leads (sem o nome), o registro de consentimento e a
   * origem sem endereço de página.
   */
  async anonymize(actor: Actor, contactId: string) {
    const keys = await this.db.app(tenantCtx(actor), async (q) => {
      const c = await q.query<{ anonymized_at: Date | null }>('select anonymized_at from contacts where id = $1 for update', [contactId]);
      if (!c.rows[0]) throw Problem.notFound('Contato não encontrado.');
      if (c.rows[0].anonymized_at) throw Problem.conflict('Este contato já foi anonimizado.');
      const files = await q.query<{ storage_key: string }>('update files set deleted_at = now() where contact_id = $1 and deleted_at is null returning storage_key', [contactId]);
      await q.query('delete from contact_emails where contact_id = $1', [contactId]);
      await q.query('delete from contact_phones where contact_id = $1', [contactId]);
      await q.query('delete from contact_tags where contact_id = $1', [contactId]);
      await q.query('delete from notes where contact_id = $1', [contactId]);
      await q.query('delete from timeline_entries where contact_id = $1', [contactId]);
      const touches = await q.query<{ id: string }>(
        `insert into attribution_touches (tenant_id, contact_id, lead_id, deal_id, occurred_at, recorded_via, source, medium, campaign)
         select tenant_id, contact_id, lead_id, deal_id, occurred_at, recorded_via, source, medium, campaign
           from attribution_touches where contact_id = $1 returning id`, [contactId]);
      await q.query('delete from attribution_touches where contact_id = $1 and not (id = any($2::uuid[]))', [contactId, touches.rows.map((t) => t.id)]);
      await q.query(
        `update contacts set first_name = 'Titular anonimizado', last_name = null, job_title = null, tax_id = null,
                birth_day = null, birth_month = null, birth_year = null, address = '{}', custom = '{}', organization_id = null,
                anonymized_at = now()
          where id = $1`, [contactId]);
      await q.query(
        `update activities set title = 'Atividade de titular anonimizado', description = null where contact_id = $1`, [contactId]);
      await audit(q, actor, 'privacy.anonymized', 'contact', contactId);
      return files.rows.map((f) => f.storage_key);
    });
    for (const k of keys) await this.storage.remove(k).catch(() => undefined);
    return { anonymized: true, filesRemoved: keys.length };
  }
}
