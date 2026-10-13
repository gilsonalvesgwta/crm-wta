import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { Storage } from '../infra/storage.js';
import { memberJson } from './fields.js';
import { REF_COLUMN, RecordsService, type RecordRef } from './records.service.js';

/** Tipos aceitos. HTML, SVG e executáveis ficam de fora: poderiam rodar no navegador ou na máquina de quem baixa. */
const BINARY_TYPES = new Map<string, string>([
  ['application/pdf', 'pdf'], ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/gif', 'gif'], ['image/webp', 'webp'],
  ['image/heic', 'heic'], ['audio/mpeg', 'mp3'], ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'], ['video/mp4', 'mp4'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/x-cfb', 'doc'], ['application/vnd.oasis.opendocument.text', 'odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'], ['application/zip', 'zip'],
]);
const TEXT_TYPES = new Map<string, string>([['csv', 'text/csv'], ['txt', 'text/plain']]);

const URL_TTL_S = 300;

export type FileRow = {
  id: string; originalName: string; contentType: string; sizeBytes: number; createdAt: Date; uploadedBy: { id: string; name: string } | null;
};

@Injectable()
export class FilesService {
  private readonly signKey: Buffer;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(RecordsService) private readonly records: RecordsService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {
    // Chave própria para assinar endereços, derivada da chave mestra atual.
    this.signKey = createHmac('sha256', cfg.masterKeys[cfg.currentKey]!).update('file-url-signing').digest();
  }

  /**
   * Confere o conteúdo pelo começo do arquivo (não pela extensão informada) e
   * devolve o tipo que vale. Texto puro só como .csv ou .txt.
   */
  async detectType(name: string, data: Buffer): Promise<string> {
    const ext = path.extname(name).slice(1).toLowerCase();
    const ft = await fileTypeFromBuffer(data);
    if (ft) {
      if (BINARY_TYPES.has(ft.mime)) return ft.mime;
      throw Problem.badRequest('Tipo de arquivo não aceito.', [{ field: 'file', message: `Arquivos ${ft.ext.toUpperCase()} não são aceitos.` }]);
    }
    const text = TEXT_TYPES.get(ext);
    if (text && !data.subarray(0, 4096).includes(0)) return text;
    throw Problem.badRequest('Tipo de arquivo não aceito.', [{ field: 'file', message: 'Envie PDF, imagem, documento do Office, CSV ou TXT.' }]);
  }

  /** Grava o arquivo e o registro. Usado por anexos e pela importação. */
  async storeIn(q: Q, actor: Actor, input: { name: string; data: Buffer; purpose: 'attachment' | 'import'; ref?: RecordRef }): Promise<string> {
    const maxBytes = this.cfg.UPLOAD_MAX_MB * 1024 * 1024;
    if (input.data.length === 0) throw Problem.badRequest('Arquivo vazio.', [{ field: 'file', message: 'O arquivo está vazio.' }]);
    if (input.data.length > maxBytes) throw new Problem(413, `O arquivo passa de ${this.cfg.UPLOAD_MAX_MB} MB.`);
    const contentType = await this.detectType(input.name, input.data);
    const id = randomUUID();
    const now = new Date();
    const key = `${actor.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
    const safeName = input.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(-255) || 'arquivo';
    await this.storage.put(key, input.data);
    try {
      const col = input.ref ? REF_COLUMN[input.ref.kind] : null;
      await q.query(
        `insert into files (id, tenant_id, storage_key, purpose, original_name, content_type, size_bytes, sha256, uploaded_by ${col ? `, ${col}` : ''})
         values ($1, app.tenant_id(), $2, $3, $4, $5, $6, $7, $8 ${col ? ', $9' : ''})`,
        [id, key, input.purpose, safeName, contentType, input.data.length, createHash('sha256').update(input.data).digest(), actor.membershipId,
          ...(input.ref ? [input.ref.id] : [])]);
    } catch (err) {
      await this.storage.remove(key).catch(() => undefined);
      throw err;
    }
    return id;
  }

  async upload(actor: Actor, ref: RecordRef, name: string, data: Buffer): Promise<FileRow> {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.records.assertAccess(q, actor, ref, true);
      const id = await this.storeIn(q, actor, { name, data, purpose: 'attachment', ref });
      await q.query(
        `insert into timeline_entries (tenant_id, kind, actor_membership_id, ${REF_COLUMN[ref.kind]}, data)
         values (app.tenant_id(), 'file.added', $1, $2, $3)`, [actor.membershipId, ref.id, JSON.stringify({ fileId: id })]);
      return this.row(q, id);
    });
  }

  private async row(q: Q, id: string): Promise<FileRow> {
    const r = await q.query<FileRow>(
      `select id, original_name as "originalName", content_type as "contentType", size_bytes::int as "sizeBytes",
              created_at as "createdAt", ${memberJson('uploaded_by')} as "uploadedBy"
         from files where id = $1`, [id]);
    return r.rows[0]!;
  }

  async list(actor: Actor, ref: RecordRef): Promise<FileRow[]> {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.records.assertAccess(q, actor, ref, false);
      const r = await q.query<FileRow>(
        `select id, original_name as "originalName", content_type as "contentType", size_bytes::int as "sizeBytes",
                created_at as "createdAt", ${memberJson('uploaded_by')} as "uploadedBy"
           from files where ${REF_COLUMN[ref.kind]} = $1 and deleted_at is null and purpose = 'attachment'
          order by created_at desc`, [ref.id]);
      return r.rows;
    });
  }

  /** Registro e acesso: o arquivo só existe para quem enxerga o registro ao qual pertence. */
  private async accessible(q: Q, actor: Actor, id: string, edit: boolean) {
    const f = await q.query<{ id: string; contact_id: string | null; organization_id: string | null; deal_id: string | null; lead_id: string | null; uploaded_by: string | null; storage_key: string; original_name: string; purpose: string }>(
      'select id, contact_id, organization_id, deal_id, lead_id, uploaded_by, storage_key, original_name, purpose from files where id = $1 and deleted_at is null', [id]);
    const row = f.rows[0];
    if (!row) throw Problem.notFound('Arquivo não encontrado.');
    const ref: RecordRef | null = row.deal_id ? { kind: 'deal', id: row.deal_id } : row.lead_id ? { kind: 'lead', id: row.lead_id }
      : row.contact_id ? { kind: 'contact', id: row.contact_id } : row.organization_id ? { kind: 'organization', id: row.organization_id } : null;
    if (ref) {
      try {
        await this.records.assertAccess(q, actor, ref, edit);
      } catch {
        throw Problem.notFound('Arquivo não encontrado.');
      }
    } else if (row.uploaded_by !== actor.membershipId && actor.permissions.get('contacts:import_export') !== 'tenant') {
      throw Problem.notFound('Arquivo não encontrado.');
    }
    return { ...row, ref };
  }

  /** Endereço assinado de curta duração para baixar o arquivo. */
  async signedUrl(actor: Actor, id: string): Promise<{ url: string; expiresAt: string }> {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.accessible(q, actor, id, false);
      const exp = Math.floor(Date.now() / 1000) + URL_TTL_S;
      const payload = `${actor.tenantId}.${id}.${exp}`;
      const sig = createHmac('sha256', this.signKey).update(payload).digest('base64url');
      return { url: `/api/v1/files/download/${Buffer.from(payload).toString('base64url')}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
    });
  }

  /** Valida o endereço assinado e abre o arquivo. Endereço inválido ou vencido: 404. */
  async openSigned(token: string): Promise<{ stream: import('node:stream').Readable; size: number; name: string; contentType: string }> {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig || token.length > 400) throw Problem.notFound();
    const payload = Buffer.from(b64, 'base64url').toString();
    const expected = createHmac('sha256', this.signKey).update(payload).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw Problem.notFound();
    const [tenantId, id, exp] = payload.split('.');
    if (!tenantId || !id || !exp || Number(exp) * 1000 < Date.now()) throw Problem.notFound('Este endereço venceu. Abra o arquivo de novo.');
    const row = await this.db.app({ tenantId, userId: null }, async (q) =>
      (await q.query<{ storage_key: string; original_name: string; content_type: string }>(
        'select storage_key, original_name, content_type from files where id = $1 and deleted_at is null', [id])).rows[0]);
    if (!row) throw Problem.notFound();
    const opened = await this.storage.open(row.storage_key);
    if (!opened) throw Problem.notFound();
    return { ...opened, name: row.original_name, contentType: row.content_type };
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const key = await this.db.app(tenantCtx(actor), async (q) => {
      const f = await this.accessible(q, actor, id, true);
      await q.query('update files set deleted_at = now() where id = $1', [id]);
      if (f.ref) {
        await q.query(
          `insert into timeline_entries (tenant_id, kind, actor_membership_id, ${REF_COLUMN[f.ref.kind]}, data)
           values (app.tenant_id(), 'file.removed', $1, $2, $3)`, [actor.membershipId, f.ref.id, JSON.stringify({ fileId: id })]);
      }
      await audit(q, actor, 'file.deleted', 'file', id, { name: f.original_name });
      return f.storage_key;
    });
    await this.storage.remove(key);
  }

  /** Lê o conteúdo de um arquivo já registrado (importação). */
  async readIn(q: Q, id: string): Promise<Buffer> {
    const r = await q.query<{ storage_key: string }>('select storage_key from files where id = $1 and deleted_at is null', [id]);
    if (!r.rows[0]) throw Problem.notFound('Arquivo não encontrado.');
    const opened = await this.storage.open(r.rows[0].storage_key);
    if (!opened) throw Problem.notFound('Arquivo não encontrado.');
    const chunks: Buffer[] = [];
    for await (const c of opened.stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
}
