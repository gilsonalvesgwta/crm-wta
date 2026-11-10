import type { Q } from '../infra/db.js';
import { extractContactInfo, isPlaceholderName, splitName } from '../domain/contact-info.js';

/**
 * Completa o contato que veio do Instagram: o nome do perfil no lugar do
 * provisório e os e-mails e telefones que a pessoa escreveu. Nunca apaga nem
 * troca o que já foi preenchido à mão.
 */
export async function enrichContact(q: Q, contactId: string, data: { name?: string | null; text?: string | null }): Promise<string[]> {
  // Ponto de retorno: um dado recusado pelo banco não derruba o recebimento da mensagem.
  await q.query('savepoint enriquecer');
  try {
    const changed = await enrich(q, contactId, data);
    await q.query('release savepoint enriquecer');
    return changed;
  } catch {
    await q.query('rollback to savepoint enriquecer');
    return [];
  }
}

async function enrich(q: Q, contactId: string, data: { name?: string | null; text?: string | null }): Promise<string[]> {
  const changed: string[] = [];
  const name = data.name?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name && name.length >= 2 && !/^@/.test(name)) {
    const c = (await q.query<{ first_name: string | null; last_name: string | null }>('select first_name, last_name from contacts where id = $1', [contactId])).rows[0];
    if (c && isPlaceholderName(c.first_name, c.last_name)) {
      const { first, last } = splitName(name);
      await q.query('update contacts set first_name = $2, last_name = $3, updated_at = now() where id = $1', [contactId, first, last]);
      changed.push('nome');
    }
  }
  const { emails, phones } = extractContactInfo(data.text);
  for (const email of emails) {
    const r = await q.query(
      `insert into contact_emails (tenant_id, contact_id, email, is_primary)
       select app.tenant_id(), $1, $2, not exists (select 1 from contact_emails where contact_id = $1)
        where not exists (select 1 from contact_emails where contact_id = $1 and lower(email) = $2)`, [contactId, email]);
    if (r.rowCount) changed.push('e-mail');
  }
  for (const e164 of phones) {
    const r = await q.query(
      `insert into contact_phones (tenant_id, contact_id, e164, label, is_primary)
       select app.tenant_id(), $1, $2, 'mobile', not exists (select 1 from contact_phones where contact_id = $1)
        where not exists (select 1 from contact_phones where contact_id = $1 and e164 = $2)`, [contactId, e164]);
    if (r.rowCount) changed.push('telefone');
  }
  if (changed.length) {
    await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, data) values (app.tenant_id(), 'contact.updated', $1, $2)`,
      [contactId, JSON.stringify({ via: 'instagram', fields: [...new Set(changed)] })]);
  }
  return changed;
}
