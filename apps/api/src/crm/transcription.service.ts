import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { CONFIG, type Config } from '../config.js';
import { SecretBox } from '../domain/secrets.js';
import { Problem } from '../http/problem.js';
import { Db } from '../infra/db.js';
import { Storage } from '../infra/storage.js';
import {
  TranscribeError, checkOpenAiKey, defaultThreads, transcribeAudio, transcribeOpenAi, whisperAvailable, type WhisperOptions,
} from '../infra/transcribe.js';

export type TranscriptionModel = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
type Settings = { provider: 'local' | 'openai'; key: Buffer | null; hint: string | null; model: TranscriptionModel };

/**
 * Transcreve as notas de áudio em segundo plano, uma de cada vez: a nota
 * aparece na hora com "Transcrevendo…" e o texto chega quando fica pronto.
 * Por padrão no próprio servidor (whisper.cpp, sem custo); a empresa pode
 * preferir a OpenAI com a própria chave (mais rápido e preciso).
 */
@Injectable()
export class TranscriptionService {
  private readonly log = new Logger('Transcricao');
  private readonly opts: WhisperOptions;
  private readonly box: SecretBox;
  private queue: Promise<void> = Promise.resolve();
  private ready: Promise<boolean> | null = null;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {
    this.opts = { bin: cfg.WHISPER_BIN, model: cfg.WHISPER_MODEL, lang: cfg.WHISPER_LANG, threads: cfg.WHISPER_THREADS || defaultThreads() };
    this.box = new SecretBox(cfg.masterKeys, cfg.currentKey);
  }

  /** O servidor tem o transcritor local? */
  localAvailable(): Promise<boolean> {
    this.ready ??= whisperAvailable(this.opts);
    return this.ready;
  }

  private async settings(tenantId: string): Promise<Settings> {
    const r = await this.db.app({ tenantId, userId: null }, async (q) => (await q.query<{ provider: 'local' | 'openai'; openai_key: Buffer | null; openai_hint: string | null; openai_model: TranscriptionModel }>(
      'select provider, openai_key, openai_hint, openai_model from transcription_settings')).rows[0]);
    return r ? { provider: r.provider, key: r.openai_key, hint: r.openai_hint, model: r.openai_model }
      : { provider: 'local', key: null, hint: null, model: 'gpt-4o-mini-transcribe' };
  }

  private openKey(tenantId: string, sealed: Buffer): string {
    return this.box.open(sealed, `openai:${tenantId}`).toString('utf8');
  }

  /** Configuração para a tela (a chave nunca volta, só os últimos caracteres). */
  async read(actor: Actor) {
    const s = await this.settings(actor.tenantId!);
    return {
      provider: s.provider,
      localAvailable: await this.localAvailable(),
      openai: { configured: !!s.key, hint: s.hint, model: s.model },
    };
  }

  /** Muda o modo; uma chave nova é conferida na OpenAI antes de salvar. */
  async update(actor: Actor, input: { provider: 'local' | 'openai'; openaiKey?: string | null; model?: TranscriptionModel }) {
    const tenantId = actor.tenantId!;
    const cur = await this.settings(tenantId);
    let key = cur.key;
    let hint = cur.hint;
    if (input.openaiKey === null) { key = null; hint = null; }
    if (input.openaiKey) {
      const k = input.openaiKey.trim();
      try {
        await checkOpenAiKey(this.cfg.OPENAI_BASE_URL, k);
      } catch (err) {
        throw Problem.badRequest(err instanceof TranscribeError ? err.message : 'Não foi possível conferir a chave.',
          [{ field: 'openaiKey', message: 'Confira a chave da OpenAI.' }]);
      }
      key = this.box.seal(Buffer.from(k, 'utf8'), `openai:${tenantId}`);
      hint = k.slice(-4);
    }
    if (input.provider === 'openai' && !key) {
      throw Problem.badRequest('Informe a chave da OpenAI.', [{ field: 'openaiKey', message: 'Cole a chave da API da OpenAI.' }]);
    }
    const model = input.model ?? cur.model;
    await this.db.app(tenantCtx(actor), (q) => q.query(
      `insert into transcription_settings (tenant_id, provider, openai_key, openai_hint, openai_model, updated_by)
       values (app.tenant_id(), $1, $2, $3, $4, $5)
       on conflict (tenant_id) do update set provider = excluded.provider, openai_key = excluded.openai_key,
         openai_hint = excluded.openai_hint, openai_model = excluded.openai_model, updated_by = excluded.updated_by`,
      [input.provider, key, hint, model, actor.membershipId]));
    return this.read(actor);
  }

  /** A empresa consegue transcrever (pela OpenAI ou no servidor)? */
  async available(tenantId: string): Promise<boolean> {
    const s = await this.settings(tenantId);
    return (s.provider === 'openai' && !!s.key) || this.localAvailable();
  }

  /** Marca a nota como "transcrevendo" e põe na fila. Devolve false se não há como transcrever. */
  async enqueue(tenantId: string, noteId: string): Promise<boolean> {
    if (!(await this.available(tenantId))) return false;
    const ok = await this.db.app({ tenantId, userId: null }, async (q) => (await q.query(
      // Uma transcrição "pendente" há mais de 15 min (o servidor reiniciou no meio) pode ser pedida de novo.
      `update notes set transcript_status = 'pending', transcript_at = now()
        where id = $1 and file_id is not null
          and (coalesce(transcript_status, '') <> 'pending' or transcript_at is null or transcript_at < now() - interval '15 minutes')
        returning id`,
      [noteId])).rowCount);
    if (!ok) return true;
    this.queue = this.queue.then(() => this.process(tenantId, noteId)).catch(() => undefined);
    return true;
  }

  /** Espera a fila acabar (testes). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async process(tenantId: string, noteId: string): Promise<void> {
    const ctx = { tenantId, userId: null };
    try {
      const row = await this.db.app(ctx, async (q) => (await q.query<{ storage_key: string }>(
        `select f.storage_key from notes n join files f on f.id = n.file_id and f.deleted_at is null where n.id = $1`, [noteId])).rows[0]);
      if (!row) {
        await this.db.app(ctx, (q) => q.query(`update notes set transcript_status = 'failed' where id = $1`, [noteId]));
        return;
      }
      const opened = await this.storage.open(row.storage_key);
      if (!opened) throw new Error('arquivo do áudio não encontrado');
      const data = await toBuffer(opened.stream);
      const s = await this.settings(tenantId);
      const started = Date.now();
      const viaOpenAi = s.provider === 'openai' && !!s.key;
      const text = viaOpenAi
        ? await transcribeOpenAi(data, { baseUrl: this.cfg.OPENAI_BASE_URL, key: this.openKey(tenantId, s.key!), model: s.model, lang: this.cfg.WHISPER_LANG })
        : await transcribeAudio(data, this.opts);
      await this.db.app(ctx, (q) => q.query(
        `update notes set transcript = $2, transcript_status = 'done', transcript_at = now(), transcript_by = $3 where id = $1`,
        [noteId, text, viaOpenAi ? 'openai' : 'local']));
      this.log.log(`nota de áudio transcrita (${viaOpenAi ? 'OpenAI' : 'servidor'}) em ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (err) {
      this.log.error(`transcrição da nota de áudio: ${err instanceof Error ? err.message : String(err)}`);
      await this.db.app(ctx, (q) => q.query(`update notes set transcript_status = 'failed' where id = $1`, [noteId])).catch(() => undefined);
    }
  }
}

async function toBuffer(s: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(parts);
}
