import { Inject, Injectable, Logger } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { digits, normalizeEmail, normalizePhone, validBirthday } from '../domain/contact-data.js';
import { applyCustomFields } from '../domain/custom-fields.js';
import { Problem, type FieldError } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { ContactsService, contactOwnExtra } from './contacts.service.js';
import { DealsService, dealOwnExtra } from './deals.service.js';
import { fieldDefs } from './fields.js';
import { FilesService } from './files.service.js';
import { OrganizationsService, orgOwnExtra } from './organizations.service.js';
import { pipelineAccessSql } from './pipelines.service.js';
import { Params, reachOf, reachSql } from './sql.js';
import { actorForMembership } from './system-actor.js';

export const MAX_IMPORT_ROWS = 50_000;
const BATCH = 500;

export const CONTACT_TARGETS = [
  'firstName', 'lastName', 'fullName', 'email', 'email2', 'phone', 'phone2', 'jobTitle', 'organization', 'taxId', 'birthday',
  'tags', 'ownerEmail', 'source', 'medium', 'campaign', 'city', 'state',
] as const;
export const ORG_TARGETS = ['name', 'legalName', 'taxId', 'website', 'email', 'phone', 'industry', 'tags', 'ownerEmail', 'city', 'state'] as const;

export type ImportOptions = { duplicate: 'skip' | 'update' | 'create'; ownerId?: string | null; tagIds?: string[]; consentSource?: string | null };

/** Decodifica o CSV: UTF-8, ou Windows-1252 (o padrão do Excel no Brasil) se não for UTF-8 válido. */
export function decodeCsv(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

export function parseCsvText(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const semi = (firstLine.match(/;/g) ?? []).length;
  const comma = (firstLine.match(/,/g) ?? []).length;
  const tab = (firstLine.match(/\t/g) ?? []).length;
  const delimiter = tab > semi && tab > comma ? '\t' : semi > comma ? ';' : ',';
  return parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true }) as string[][];
}

const ALIASES: Record<string, string> = {
  nome: 'fullName', 'nome completo': 'fullName', name: 'fullName', 'full name': 'fullName', 'primeiro nome': 'firstName',
  'first name': 'firstName', sobrenome: 'lastName', 'last name': 'lastName', email: 'email', 'e-mail': 'email', telefone: 'phone',
  celular: 'phone', whatsapp: 'phone', phone: 'phone', fone: 'phone', cargo: 'jobTitle', 'job title': 'jobTitle', empresa: 'organization',
  organização: 'organization', organizacao: 'organization', company: 'organization', cpf: 'taxId', cnpj: 'taxId', documento: 'taxId',
  aniversário: 'birthday', aniversario: 'birthday', nascimento: 'birthday', 'data de nascimento': 'birthday', tags: 'tags', etiquetas: 'tags',
  responsável: 'ownerEmail', responsavel: 'ownerEmail', origem: 'source', utm_source: 'source', utm_medium: 'medium', utm_campaign: 'campaign',
  cidade: 'city', estado: 'state', uf: 'state', 'razão social': 'legalName', 'razao social': 'legalName', site: 'website', website: 'website',
  segmento: 'industry', setor: 'industry',
};

function norm(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

/** Sugere o destino de cada coluna pelo cabeçalho. */
export function suggestMapping(headers: string[], entity: 'contacts' | 'organizations', customKeys: { key: string; label: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const allowed = new Set<string>(entity === 'contacts' ? CONTACT_TARGETS : ORG_TARGETS);
  const aliases = Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [norm(k), v]));
  for (const h of headers) {
    let t = aliases[norm(h)];
    if (entity === 'organizations' && (t === 'fullName' || t === 'organization')) t = 'name';
    if (t && allowed.has(t) && !Object.values(out).includes(t)) out[h] = t;
    else {
      const c = customKeys.find((k) => norm(k.label) === norm(h) || k.key === norm(h));
      if (c) out[h] = `custom.${c.key}`;
    }
  }
  return out;
}

function parseBirthday(s: string): { day: number; month: number; year: number | null } | null {
  let m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(s);
  if (m) {
    const r = { day: Number(m[1]), month: Number(m[2]), year: m[3] ? Number(m[3]) : null };
    return validBirthday(r.day, r.month, r.year) ? r : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const r = { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
    return validBirthday(r.day, r.month, r.year) ? r : null;
  }
  return null;
}

@Injectable()
export class ImportExportService {
  private readonly log = new Logger('importacao');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(OrganizationsService) private readonly orgs: OrganizationsService,
    @Inject(DealsService) private readonly deals: DealsService,
  ) {}

  // ---- Importação: envio e conferência ------------------------------------------

  async upload(actor: Actor, entity: 'contacts' | 'organizations', name: string, data: Buffer) {
    reachOf(actor, 'contacts:import_export');
    if (!/\.(csv|txt)$/i.test(name)) throw Problem.badRequest('Envie um arquivo CSV.', [{ field: 'file', message: 'Salve a planilha como CSV.' }]);
    const rows = parseCsvText(decodeCsv(data));
    if (rows.length < 2) throw Problem.badRequest('O arquivo não tem linhas.', [{ field: 'file', message: 'A primeira linha precisa ser o cabeçalho, seguida dos dados.' }]);
    if (rows.length - 1 > MAX_IMPORT_ROWS) {
      throw Problem.badRequest('Arquivo grande demais.', [{ field: 'file', message: `Até ${MAX_IMPORT_ROWS.toLocaleString('pt-BR')} linhas por importação.` }]);
    }
    const headers = rows[0]!.map((h, i) => h || `Coluna ${i + 1}`);
    if (new Set(headers).size !== headers.length) {
      throw Problem.badRequest('Cabeçalhos repetidos.', [{ field: 'file', message: 'Cada coluna precisa de um nome diferente.' }]);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const fileId = await this.files.storeIn(q, actor, { name, data, purpose: 'import' });
      const defs = await fieldDefs(q, entity === 'contacts' ? 'contact' : 'organization');
      return {
        fileId, headers, totalRows: rows.length - 1, sample: rows.slice(1, 6),
        suggestedMapping: suggestMapping(headers, entity, defs.filter((d) => !d.archived)),
        targets: [...(entity === 'contacts' ? CONTACT_TARGETS : ORG_TARGETS), ...defs.filter((d) => !d.archived).map((d) => `custom.${d.key}`)],
      };
    });
  }

  async start(actor: Actor, input: { fileId: string; entity: 'contacts' | 'organizations'; mapping: Record<string, string>; options: ImportOptions }) {
    reachOf(actor, 'contacts:import_export');
    const targets = Object.values(input.mapping).filter(Boolean);
    if (new Set(targets).size !== targets.length) throw Problem.badRequest('Destino repetido.', [{ field: 'mapping', message: 'Cada campo pode receber só uma coluna.' }]);
    const allowed = new Set<string>(input.entity === 'contacts' ? CONTACT_TARGETS : ORG_TARGETS);
    const required = input.entity === 'contacts' ? ['firstName', 'fullName'] : ['name'];
    if (!targets.some((t) => required.includes(t))) {
      throw Problem.badRequest('Falta o nome.', [{ field: 'mapping', message: 'Escolha a coluna do nome.' }]);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const defs = await fieldDefs(q, input.entity === 'contacts' ? 'contact' : 'organization');
      for (const t of targets) {
        if (allowed.has(t)) continue;
        if (t.startsWith('custom.') && defs.some((d) => d.key === t.slice(7) && !d.archived)) continue;
        throw Problem.badRequest('Destino desconhecido.', [{ field: 'mapping', message: `Campo desconhecido: ${t}.` }]);
      }
      const f = await q.query<{ uploaded_by: string | null }>("select uploaded_by from files where id = $1 and purpose = 'import' and deleted_at is null", [input.fileId]);
      if (!f.rows[0] || f.rows[0].uploaded_by !== actor.membershipId) throw Problem.notFound('Arquivo não encontrado.');
      const used = await q.query('select 1 from imports where file_id = $1', [input.fileId]);
      if (used.rowCount) throw Problem.conflict('Este arquivo já foi importado. Envie-o de novo para outra importação.');
      const rows = parseCsvText(decodeCsv(await this.files.readIn(q, input.fileId)));
      const r = await q.query<{ id: string }>(
        `insert into imports (tenant_id, entity, file_id, mapping, options, total_rows, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6) returning id`,
        [input.entity, input.fileId, JSON.stringify(input.mapping), JSON.stringify(input.options), rows.length - 1, actor.membershipId]);
      await audit(q, actor, 'import.started', 'import', r.rows[0]!.id, { entity: input.entity, rows: rows.length - 1 });
      return this.detailIn(q, r.rows[0]!.id);
    });
  }

  private async detailIn(q: Q, id: string) {
    return (await q.query(
      `select id, entity, status, total_rows as "totalRows", processed_rows as "processedRows", created_count as "createdCount",
              updated_count as "updatedCount", skipped_count as "skippedCount", error_count as "errorCount", error,
              created_at as "createdAt", started_at as "startedAt", finished_at as "finishedAt", options, mapping,
              (select original_name from files f where f.id = i.file_id) as "fileName",
              (select u.name from memberships m join users u on u.id = m.user_id where m.id = i.created_by) as "createdBy"
         from imports i where i.id = $1`, [id])).rows[0];
  }

  async list(actor: Actor) {
    reachOf(actor, 'contacts:import_export');
    return this.db.app(tenantCtx(actor), async (q) => {
      const ids = await q.query<{ id: string }>('select id from imports order by created_at desc limit 50');
      return Promise.all(ids.rows.map((r) => this.detailIn(q, r.id)));
    });
  }

  async get(actor: Actor, id: string) {
    reachOf(actor, 'contacts:import_export');
    return this.db.app(tenantCtx(actor), async (q) => {
      const d = await this.detailIn(q, id);
      if (!d) throw Problem.notFound('Importação não encontrada.');
      return d;
    });
  }

  async errors(actor: Actor, id: string) {
    reachOf(actor, 'contacts:import_export');
    return this.db.app(tenantCtx(actor), async (q) => {
      const d = await this.detailIn(q, id);
      if (!d) throw Problem.notFound('Importação não encontrada.');
      return (await q.query(
        `select row_number as "row", status, errors from import_rows where import_id = $1 and (status in ('error', 'skipped') or jsonb_array_length(errors) > 0)
          order by row_number limit 5000`, [id])).rows;
    });
  }

  async cancel(actor: Actor, id: string) {
    reachOf(actor, 'contacts:import_export');
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query("update imports set status = 'canceled', finished_at = now() where id = $1 and status in ('pending', 'processing') returning id", [id]);
      if (!r.rowCount) throw Problem.conflict('A importação já terminou.');
      return this.detailIn(q, id);
    });
  }

  // ---- Importação: processamento em lotes ----------------------------------------------

  /**
   * Processa o próximo lote de uma importação já reservada pelo despachante.
   * Cada lote é uma transação; o progresso fica no banco, então um processo que
   * cai no meio é retomado do último lote gravado, sem repetir linhas.
   * Devolve true quando a importação terminou.
   */
  async processBatch(tenantId: string, importId: string): Promise<boolean> {
    const head = await this.db.app({ tenantId, userId: null }, async (q) =>
      (await q.query<{ status: string; created_by: string | null; file_id: string; processed_rows: number }>(
        'select status, created_by, file_id, processed_rows from imports where id = $1', [importId])).rows[0]);
    if (!head || head.status !== 'processing') return true;
    const userId = head.created_by
      ? await this.db.app({ tenantId, userId: null }, async (q) =>
        (await q.query<{ user_id: string }>('select user_id from memberships where id = $1', [head.created_by])).rows[0]?.user_id ?? null)
      : null;
    try {
      return await this.db.app({ tenantId, userId }, async (q) => {
        const imp = (await q.query<{ status: string; entity: 'contacts' | 'organizations'; mapping: Record<string, string>; options: ImportOptions; processed_rows: number; total_rows: number; created_by: string | null; file_id: string }>(
          'select status, entity, mapping, options, processed_rows, total_rows, created_by, file_id from imports where id = $1 for update', [importId])).rows[0]!;
        if (imp.status !== 'processing') return true;
        const actor = imp.created_by ? await actorForMembership(q, tenantId, imp.created_by) : null;
        if (!actor || actor.permissions.get('contacts:import_export') !== 'tenant') {
          await q.query("update imports set status = 'failed', error = $2, finished_at = now(), locked_until = null where id = $1",
            [importId, 'Quem iniciou a importação não tem mais permissão para importar.']);
          return true;
        }
        const rows = parseCsvText(decodeCsv(await this.files.readIn(q, imp.file_id)));
        const headers = rows[0]!;
        const start = imp.processed_rows;
        const batch = rows.slice(1 + start, 1 + start + BATCH);
        const counts = { created: 0, updated: 0, skipped: 0, error: 0 };
        for (const [i, cells] of batch.entries()) {
          const rowNumber = start + i + 2; // linha da planilha, contando o cabeçalho
          const record: Record<string, string> = {};
          headers.forEach((h, k) => {
            const target = imp.mapping[h];
            const v = (cells[k] ?? '').trim();
            if (target && v) record[target] = v;
          });
          await q.query('savepoint linha');
          try {
            const r = imp.entity === 'contacts'
              ? await this.importContact(q, actor, record, imp.options)
              : await this.importOrganization(q, actor, record, imp.options);
            await q.query('release savepoint linha');
            counts[r.status]++;
            await q.query(
              `insert into import_rows (tenant_id, import_id, row_number, status, record_id, errors)
               values (app.tenant_id(), $1, $2, $3, $4, $5) on conflict do nothing`,
              [importId, rowNumber, r.status, r.id ?? null, JSON.stringify(r.errors ?? [])]);
          } catch (err) {
            await q.query('rollback to savepoint linha');
            const errors: FieldError[] = err instanceof Problem
              ? (err.errors?.length ? err.errors : [{ field: '(linha)', message: err.title }])
              : [{ field: '(linha)', message: 'Erro inesperado nesta linha.' }];
            if (!(err instanceof Problem)) this.log.warn(`linha ${rowNumber} da importação ${importId}: ${String(err)}`);
            counts.error++;
            await q.query(
              `insert into import_rows (tenant_id, import_id, row_number, status, errors) values (app.tenant_id(), $1, $2, 'error', $3)
               on conflict do nothing`, [importId, rowNumber, JSON.stringify(errors)]);
          }
        }
        const processed = start + batch.length;
        const done = processed >= rows.length - 1;
        await q.query(
          `update imports set processed_rows = $2, created_count = created_count + $3, updated_count = updated_count + $4,
                  skipped_count = skipped_count + $5, error_count = error_count + $6,
                  status = case when $7 then 'done' else status end,
                  finished_at = case when $7 then now() else finished_at end,
                  locked_until = case when $7 then null else now() + interval '2 minutes' end
            where id = $1`,
          [importId, processed, counts.created, counts.updated, counts.skipped, counts.error, done]);
        if (done) {
          await q.query(
            `insert into notifications (tenant_id, membership_id, kind, title, body, link)
             values (app.tenant_id(), $1, 'import.done', 'Importação concluída', $2, $3)`,
            [imp.created_by, `${processed.toLocaleString('pt-BR')} linhas processadas`, '/contatos/importar']);
        }
        return done;
      });
    } catch (err) {
      this.log.error(`importação ${importId} falhou: ${err instanceof Error ? err.stack : String(err)}`);
      await this.db.app({ tenantId, userId: null }, (q) =>
        q.query("update imports set status = 'failed', error = 'Erro inesperado durante o processamento.', finished_at = now(), locked_until = null where id = $1", [importId]));
      return true;
    }
  }

  private async ownerFromEmail(q: Q, email: string | undefined, fallback: string | null | undefined): Promise<{ id: string | null; error?: FieldError }> {
    if (!email) return { id: fallback ?? null };
    const r = await q.query<{ id: string }>(
      `select m.id from memberships m join users u on u.id = m.user_id where u.email = lower($1) and m.status = 'active'`, [email.trim()]);
    if (!r.rows[0]) return { id: null, error: { field: 'ownerEmail', message: `Responsável "${email}" não encontrado.` } };
    return { id: r.rows[0].id };
  }

  private async tagIds(q: Q, names: string | undefined, fixed: string[] | undefined): Promise<string[]> {
    const ids = [...(fixed ?? [])];
    for (const name of (names ?? '').split(/[;,|]/).map((s) => s.trim()).filter(Boolean)) {
      if (name.length > 60) continue;
      const r = await q.query<{ id: string }>(
        `insert into tags (tenant_id, name) values (app.tenant_id(), $1)
         on conflict (tenant_id, lower(name)) do update set name = tags.name returning id`, [name]);
      ids.push(r.rows[0]!.id);
    }
    return [...new Set(ids)];
  }

  private async orgByName(q: Q, actor: Actor, name: string | undefined, owner: string | null): Promise<string | null> {
    if (!name) return null;
    const found = await q.query<{ id: string }>('select id from organizations where lower(name) = lower($1) order by created_at limit 1', [name]);
    if (found.rows[0]) return found.rows[0].id;
    return this.orgs.createIn(q, actor, { ...reachOf(actor, 'contacts:edit'), scope: 'tenant' }, { name, ownerId: owner });
  }

  private customFrom(record: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(record)) if (k.startsWith('custom.')) out[k.slice(7)] = v;
    return out;
  }

  private async importContact(q: Q, actor: Actor, rec: Record<string, string>, opts: ImportOptions)
    : Promise<{ status: 'created' | 'updated' | 'skipped'; id?: string; errors?: FieldError[] }> {
    const errors: FieldError[] = [];
    let first = rec.firstName;
    let last = rec.lastName;
    if (!first && rec.fullName) {
      const parts = rec.fullName.split(/\s+/);
      first = parts.shift();
      last = last ?? (parts.join(' ') || undefined);
    }
    if (!first) throw Problem.badRequest('Sem nome.', [{ field: 'firstName', message: 'O nome está vazio.' }]);
    const emails: string[] = [];
    for (const key of ['email', 'email2'] as const) {
      if (!rec[key]) continue;
      const e = normalizeEmail(rec[key]);
      if (e) emails.push(e);
      else errors.push({ field: key, message: `E-mail inválido: ${rec[key]}` });
    }
    const phones: string[] = [];
    for (const key of ['phone', 'phone2'] as const) {
      if (!rec[key]) continue;
      const p = normalizePhone(rec[key]);
      if (p) phones.push(p);
      else errors.push({ field: key, message: `Telefone inválido: ${rec[key]}` });
    }
    let birthday: { day: number; month: number; year: number | null } | null = null;
    if (rec.birthday) {
      birthday = parseBirthday(rec.birthday);
      if (!birthday) errors.push({ field: 'birthday', message: `Data inválida: ${rec.birthday}` });
    }
    const defs = await fieldDefs(q, 'contact');
    const custom = applyCustomFields(defs, this.customFrom(rec), {}, { partial: true });
    errors.push(...custom.errors);
    const owner = await this.ownerFromEmail(q, rec.ownerEmail, opts.ownerId ?? actor.membershipId);
    if (owner.error) errors.push(owner.error);
    // Erro em campo obrigatório para identificar a pessoa barra a linha; os
    // demais ficam registrados e o restante é importado.
    if (errors.length && !emails.length && !phones.length && (rec.email || rec.phone)) {
      throw Problem.badRequest('Linha inválida.', errors);
    }

    const r = { ...reachOf(actor, 'contacts:edit'), scope: 'tenant' as const };
    const dup = emails.length || phones.length
      ? (await q.query<{ id: string }>(
        `select c.id from contacts c where c.anonymized_at is null and (
           c.id in (select contact_id from contact_emails where email = any($1::text[]))
           or c.id in (select contact_id from contact_phones where e164 = any($2::text[])))
         order by c.created_at limit 1`, [emails, phones])).rows[0]
      : undefined;
    const tagIds = await this.tagIds(q, rec.tags, opts.tagIds);
    const address = Object.fromEntries(Object.entries({ city: rec.city, state: rec.state }).filter(([, v]) => v)) as Record<string, string>;
    const touch = rec.source || rec.medium || rec.campaign
      ? { source: rec.source ?? null, medium: rec.medium ?? null, campaign: rec.campaign ?? null, via: 'import' as const } : undefined;

    if (dup && opts.duplicate === 'skip') {
      return { status: 'skipped', id: dup.id, errors: [...errors, { field: 'email', message: 'Contato já cadastrado (mesmo e-mail ou telefone).' }] };
    }
    if (dup && opts.duplicate === 'update') {
      // Completa o cadastro existente sem apagar o que já havia.
      await q.query(
        `update contacts set last_name = coalesce(last_name, $2), job_title = coalesce(job_title, $3), tax_id = coalesce(tax_id, $4),
                birth_day = coalesce(birth_day, $5), birth_month = case when birth_day is null then $6 else birth_month end,
                birth_year = case when birth_day is null then $7 else birth_year end,
                custom = $8::jsonb || custom, address = case when address = '{}'::jsonb then $9::jsonb else address end
          where id = $1`,
        [dup.id, last ?? null, rec.jobTitle ?? null, rec.taxId ? digits(rec.taxId) || rec.taxId : null,
          birthday?.day ?? null, birthday?.month ?? null, birthday?.year ?? null, JSON.stringify(custom.value), JSON.stringify(address)]);
      for (const e of emails) {
        await q.query(`insert into contact_emails (tenant_id, contact_id, email) values (app.tenant_id(), $1, $2) on conflict do nothing`, [dup.id, e]);
      }
      for (const p of phones) {
        await q.query(`insert into contact_phones (tenant_id, contact_id, e164) values (app.tenant_id(), $1, $2) on conflict do nothing`, [dup.id, p]);
      }
      for (const t of tagIds) {
        await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2) on conflict do nothing', [dup.id, t]);
      }
      if (touch) await this.contacts.recordTouch(q, dup.id, touch);
      await q.query(
        `insert into timeline_entries (tenant_id, kind, actor_membership_id, contact_id, data)
         values (app.tenant_id(), 'contact.updated', $1, $2, '{"via":"import"}')`, [actor.membershipId, dup.id]);
      return { status: 'updated', id: dup.id, errors };
    }
    const orgId = await this.orgByName(q, actor, rec.organization, owner.id);
    const id = await this.contacts.createIn(q, actor, r, {
      firstName: first, lastName: last ?? null, jobTitle: rec.jobTitle ?? null, organizationId: orgId,
      taxId: rec.taxId && /^[0-9A-Za-z./-]{1,30}$/.test(rec.taxId) ? rec.taxId : null,
      birthday, address, ownerId: owner.id, tagIds,
      emails: emails.map((email, i) => ({ email, isPrimary: i === 0 })), phones: phones.map((number, i) => ({ number, isPrimary: i === 0 })),
      custom: custom.value,
    }, { allowDuplicate: true, touch });
    if (opts.consentSource && emails.length) {
      await q.query(
        `insert into consents (tenant_id, contact_id, channel, purpose, status, source, recorded_by)
         values (app.tenant_id(), $1, 'email', 'marketing', 'granted', $2, $3)`, [id, opts.consentSource, actor.membershipId]);
    }
    return { status: 'created', id, errors };
  }

  private async importOrganization(q: Q, actor: Actor, rec: Record<string, string>, opts: ImportOptions)
    : Promise<{ status: 'created' | 'updated' | 'skipped'; id?: string; errors?: FieldError[] }> {
    if (!rec.name) throw Problem.badRequest('Sem nome.', [{ field: 'name', message: 'O nome está vazio.' }]);
    const errors: FieldError[] = [];
    const defs = await fieldDefs(q, 'organization');
    const custom = applyCustomFields(defs, this.customFrom(rec), {}, { partial: true });
    errors.push(...custom.errors);
    const owner = await this.ownerFromEmail(q, rec.ownerEmail, opts.ownerId ?? actor.membershipId);
    if (owner.error) errors.push(owner.error);
    const dup = (await q.query<{ id: string }>(
      `select id from organizations where lower(name) = lower($1)
          or ($2::text is not null and regexp_replace(coalesce(tax_id, ''), '\\D', '', 'g') = $2)
        order by created_at limit 1`, [rec.name, rec.taxId && digits(rec.taxId).length >= 8 ? digits(rec.taxId) : null])).rows[0];
    if (dup && opts.duplicate === 'skip') return { status: 'skipped', id: dup.id, errors: [...errors, { field: 'name', message: 'Organização já cadastrada.' }] };
    const email = rec.email ? normalizeEmail(rec.email) : null;
    if (rec.email && !email) errors.push({ field: 'email', message: `E-mail inválido: ${rec.email}` });
    const phone = rec.phone ? normalizePhone(rec.phone) : null;
    if (rec.phone && !phone) errors.push({ field: 'phone', message: `Telefone inválido: ${rec.phone}` });
    const tagIds = await this.tagIds(q, rec.tags, opts.tagIds);
    const address = Object.fromEntries(Object.entries({ city: rec.city, state: rec.state }).filter(([, v]) => v)) as Record<string, string>;
    if (dup && opts.duplicate === 'update') {
      await q.query(
        `update organizations set legal_name = coalesce(legal_name, $2), tax_id = coalesce(tax_id, $3), email = coalesce(email, $4),
                phone = coalesce(phone, $5), industry = coalesce(industry, $6), custom = $7::jsonb || custom,
                address = case when address = '{}'::jsonb then $8::jsonb else address end
          where id = $1`,
        [dup.id, rec.legalName ?? null, rec.taxId ?? null, email, phone, rec.industry ?? null, JSON.stringify(custom.value), JSON.stringify(address)]);
      for (const t of tagIds) {
        await q.query('insert into organization_tags (tenant_id, organization_id, tag_id) values (app.tenant_id(), $1, $2) on conflict do nothing', [dup.id, t]);
      }
      return { status: 'updated', id: dup.id, errors };
    }
    const id = await this.orgs.createIn(q, actor, { ...reachOf(actor, 'contacts:edit'), scope: 'tenant' }, {
      name: rec.name, legalName: rec.legalName ?? null, taxId: rec.taxId && /^[0-9A-Za-z./-]{1,30}$/.test(rec.taxId) ? rec.taxId : null,
      website: rec.website ?? null, email, phone, industry: rec.industry ?? null, address, ownerId: owner.id, tagIds, custom: custom.value,
    });
    return { status: 'created', id, errors };
  }

  // ---- Exportação ------------------------------------------------------------------------

  private csv(header: string[], rows: unknown[][]): Buffer {
    // Ponto e vírgula e BOM: o Excel em português abre direto, com acentos.
    const body = stringify([header, ...rows], { delimiter: ';', record_delimiter: '\r\n' });
    return Buffer.concat([Buffer.from('﻿'), Buffer.from(body)]);
  }

  async exportContacts(actor: Actor, filters: { ownerId?: string; tagId?: string; organizationId?: string }): Promise<{ data: Buffer; rows: number }> {
    reachOf(actor, 'contacts:import_export');
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const where = [reachSql(p, 'c', r, contactOwnExtra), 'c.anonymized_at is null'];
      if (filters.ownerId) where.push(`c.owner_membership_id = ${p.add(filters.ownerId)}`);
      if (filters.tagId) where.push(`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${p.add(filters.tagId)})`);
      if (filters.organizationId) where.push(`c.organization_id = ${p.add(filters.organizationId)}`);
      const defs = (await fieldDefs(q, 'contact')).filter((d) => !d.archived);
      const rows = await q.query<Record<string, unknown>>(
        `select c.id, c.first_name, c.last_name, c.job_title, c.tax_id,
                case when c.birth_day is null then null
                     else lpad(c.birth_day::text, 2, '0') || '/' || lpad(c.birth_month::text, 2, '0') || coalesce('/' || c.birth_year, '') end as birthday,
                (select o.name from organizations o where o.id = c.organization_id) as organization,
                (select string_agg(e.email, ', ' order by e.is_primary desc) from contact_emails e where e.contact_id = c.id) as emails,
                (select string_agg(p.e164, ', ' order by p.is_primary desc) from contact_phones p where p.contact_id = c.id) as phones,
                (select string_agg(t.name, ', ' order by lower(t.name)) from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = c.id) as tags,
                (select u.email from memberships m join users u on u.id = m.user_id where m.id = c.owner_membership_id) as owner,
                c.address->>'city' as city, c.address->>'state' as state, c.custom, c.created_at
           from contacts c where ${where.join(' and ')} order by c.created_at, c.id`, p.values);
      const header = ['ID', 'Nome', 'Sobrenome', 'Cargo', 'Documento', 'Aniversário', 'Organização', 'E-mails', 'Telefones', 'Etiquetas',
        'Responsável', 'Cidade', 'Estado', 'Criado em', ...defs.map((d) => d.label)];
      const data = this.csv(header, rows.rows.map((x) => [
        x.id, x.first_name, x.last_name, x.job_title, x.tax_id, x.birthday, x.organization, x.emails, x.phones, x.tags, x.owner, x.city,
        x.state, (x.created_at as Date).toISOString(),
        ...defs.map((d) => { const v = (x.custom as Record<string, unknown>)[d.key]; return Array.isArray(v) ? v.join(', ') : v ?? ''; }),
      ]));
      await q.query(`insert into exports (tenant_id, entity, filters, row_count, created_by) values (app.tenant_id(), 'contacts', $1, $2, $3)`,
        [JSON.stringify(filters), rows.rowCount, actor.membershipId]);
      await audit(q, actor, 'export.contacts', null, null, { rows: rows.rowCount, filters });
      return { data, rows: rows.rowCount ?? 0 };
    });
  }

  async exportOrganizations(actor: Actor): Promise<{ data: Buffer; rows: number }> {
    reachOf(actor, 'contacts:import_export');
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const defs = (await fieldDefs(q, 'organization')).filter((d) => !d.archived);
      const rows = await q.query<Record<string, unknown>>(
        `select o.id, o.name, o.legal_name, o.tax_id, o.website, o.email, o.phone, o.industry, o.address->>'city' as city,
                o.address->>'state' as state, o.custom, o.created_at,
                (select string_agg(t.name, ', ' order by lower(t.name)) from organization_tags ot join tags t on t.id = ot.tag_id where ot.organization_id = o.id) as tags,
                (select u.email from memberships m join users u on u.id = m.user_id where m.id = o.owner_membership_id) as owner
           from organizations o where ${reachSql(p, 'o', r, orgOwnExtra)} order by o.created_at, o.id`, p.values);
      const header = ['ID', 'Nome', 'Razão social', 'CNPJ', 'Site', 'E-mail', 'Telefone', 'Segmento', 'Cidade', 'Estado', 'Etiquetas', 'Responsável',
        'Criado em', ...defs.map((d) => d.label)];
      const data = this.csv(header, rows.rows.map((x) => [
        x.id, x.name, x.legal_name, x.tax_id, x.website, x.email, x.phone, x.industry, x.city, x.state, x.tags, x.owner,
        (x.created_at as Date).toISOString(),
        ...defs.map((d) => { const v = (x.custom as Record<string, unknown>)[d.key]; return Array.isArray(v) ? v.join(', ') : v ?? ''; }),
      ]));
      await q.query(`insert into exports (tenant_id, entity, row_count, created_by) values (app.tenant_id(), 'organizations', $1, $2)`, [rows.rowCount, actor.membershipId]);
      await audit(q, actor, 'export.organizations', null, null, { rows: rows.rowCount });
      return { data, rows: rows.rowCount ?? 0 };
    });
  }

  /** Exporta negócios. Funil fora do acesso não entra, nem pedido pelo filtro. */
  async exportDeals(actor: Actor, filters: { pipelineId?: string; status?: string }): Promise<{ data: Buffer; rows: number }> {
    reachOf(actor, 'deals:export');
    const r = reachOf(actor, 'deals:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const where = [reachSql(p, 'd', r, dealOwnExtra),
        `exists (select 1 from pipelines pl where pl.id = d.pipeline_id and ${pipelineAccessSql(p, actor, 'pl')})`];
      if (filters.pipelineId) where.push(`d.pipeline_id = ${p.add(filters.pipelineId)}`);
      if (filters.status && filters.status !== 'all') where.push(`d.status = ${p.add(filters.status)}`);
      const defs = (await fieldDefs(q, 'deal')).filter((d) => !d.archived);
      const rows = await q.query<Record<string, unknown>>(
        `select d.id, d.title, (d.value_cents / 100.0)::numeric(14,2)::text as value, d.currency, d.status,
                pl.name as pipeline, s.name as stage, d.expected_close_date::text as close_date, d.closed_at,
                (select r.name from outcome_reasons r where r.id = d.outcome_reason_id) as reason,
                (select c.name from contacts c where c.id = d.contact_id) as contact,
                (select o.name from organizations o where o.id = d.organization_id) as organization,
                (select u.email from memberships m join users u on u.id = m.user_id where m.id = d.owner_membership_id) as owner,
                d.custom, d.created_at
           from deals d join pipelines pl on pl.id = d.pipeline_id join pipeline_stages s on s.id = d.stage_id
          where ${where.join(' and ')} order by d.created_at, d.id`, p.values);
      const header = ['ID', 'Título', 'Valor', 'Moeda', 'Situação', 'Funil', 'Etapa', 'Previsão', 'Fechado em', 'Motivo', 'Contato', 'Organização',
        'Responsável', 'Criado em', ...defs.map((d) => d.label)];
      const status: Record<string, string> = { open: 'Em andamento', won: 'Ganho', lost: 'Perdido' };
      const data = this.csv(header, rows.rows.map((x) => [
        x.id, x.title, String(x.value).replace('.', ','), x.currency, status[String(x.status)], x.pipeline, x.stage, x.close_date,
        x.closed_at ? (x.closed_at as Date).toISOString() : '', x.reason, x.contact, x.organization, x.owner, (x.created_at as Date).toISOString(),
        ...defs.map((d) => { const v = (x.custom as Record<string, unknown>)[d.key]; return Array.isArray(v) ? v.join(', ') : v ?? ''; }),
      ]));
      await q.query(`insert into exports (tenant_id, entity, filters, row_count, created_by) values (app.tenant_id(), 'deals', $1, $2, $3)`,
        [JSON.stringify(filters), rows.rowCount, actor.membershipId]);
      await audit(q, actor, 'export.deals', null, null, { rows: rows.rowCount, filters });
      return { data, rows: rows.rowCount ?? 0 };
    });
  }
}
