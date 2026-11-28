import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { render } from '../domain/automations.js';
import type { ExtraWhen, KeyAction, VoiceSettings } from '../domain/campaigns.js';
import { normalizePhone } from '../domain/contact-data.js';
import { cleanFirstName, cleanName } from '../domain/names.js';
import { SecretBox } from '../domain/secrets.js';
import type { VoiceProviderInput } from '../domain/voice.js';
import { Problem } from '../http/problem.js';
import { AudioError, convertForPhone } from '../infra/audio.js';
import { Db, type Q } from '../infra/db.js';
import {
  HANGUP_XML, PROVIDER_FIELDS, VoiceError, answerXml, checkAccount, parseEvent, placeCall, pollCall, sendSms, velipAudios, velipUploadAudio, velipVoices,
  type CallEvent, type CallStatus, type VoiceAccount, type VoiceOptions, type VoiceProviderKind,
} from '../infra/voice.js';
import { memberJson } from './fields.js';
import { FilesService } from './files.service.js';
import { IgFlowsService } from './ig-flows.service.js';
import { MessagesService } from './messages.service.js';

const COLUMNS = `v.id, v.name, v.provider, v.config, v.secret_hint as "secretHint", v.status, v.last_error as "lastError",
  v.tested_at as "testedAt", v.created_at as "createdAt", v.updated_at as "updatedAt", ${memberJson('v.created_by')} as "createdBy"`;

/** Ligação de teste (fora de campanha): "t-<áudio>". */
const TEST_RID = /^t-([0-9a-f-]{36})$/;
const KINDS = new Set(['atender', 'tecla', 'status', 'infobip', 'sip', 'http', 'zenvia', 'velip']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Recipient = {
  id: string; contact_id: string; address: string; campaign_id: string; call_status: CallStatus | null; call_digits: string | null;
  call_ended_at: Date | null; call_extras: Record<string, string>; voice: VoiceSettings; file_id: string | null; voice_provider_id: string | null;
  success_tag_id: string | null; tenant_name: string; name: string; first_name: string | null; owner_membership_id: string | null; owner_name: string | null;
};

/**
 * Campanhas de voz: cadastro das operadoras, áudio público para a ligação,
 * a ligação em si e os avisos de resultado (tecla, atendeu, não atendeu),
 * com o WhatsApp e o SMS que saem junto.
 */
@Injectable()
export class VoiceService {
  private readonly log = new Logger('voz');
  private readonly box: SecretBox;
  private readonly signKey: Buffer;
  private readonly cache = new Map<string, Buffer>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(IgFlowsService) private readonly media: IgFlowsService,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {
    this.box = new SecretBox(cfg.masterKeys, cfg.currentKey);
    this.signKey = createHmac('sha256', cfg.masterKeys[cfg.currentKey]!).update('voice-url-signing').digest();
  }

  private get opts(): VoiceOptions {
    return { baseOverride: this.cfg.VOICE_PROVIDER_BASE_URL, allowPrivate: this.cfg.CHANNEL_ALLOW_PRIVATE_HOSTS };
  }

  private get base(): string {
    return this.cfg.APP_URL.replace(/\/+$/, '');
  }

  private sign(v: string): string {
    return createHmac('sha256', this.signKey).update(v).digest('base64url').slice(0, 32);
  }

  private verify(v: string, sig: string): boolean {
    const a = Buffer.from(this.sign(v));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ---- Operadoras ------------------------------------------------------------------------------

  /** Endereço dos avisos desta operadora (vai no cadastro da central/API própria). */
  callbackBase(providerId: string, rid: string): string {
    return `${this.base}/api/v1/public/voz/${providerId}.${this.sign(`voz:${providerId}`)}/${rid}`;
  }

  private view(row: Record<string, unknown> & { id: string; provider: VoiceProviderKind }) {
    return {
      ...row, sms: PROVIDER_FIELDS[row.provider].sms, callbackUrl: this.callbackBase(row.id, '{destinatario}'),
      // Endereço único (sem o destinatário) para telas de retorno da operadora, ex.: "URL atendimento" da Velip.
      accountUrl: `${this.callbackBase(row.id, 'conta')}/${row.provider === 'velip' ? 'velip' : 'http'}`,
    };
  }

  async list(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query(`select ${COLUMNS} from voice_providers v order by v.created_at`);
      return { items: r.rows.map((x) => this.view(x as never)) };
    });
  }

  private async row(q: Q, id: string) {
    const r = await q.query(`select ${COLUMNS} from voice_providers v where v.id = $1`, [id]);
    if (!r.rows[0]) throw Problem.notFound('Operadora não encontrada.');
    return this.view(r.rows[0] as never);
  }

  private clean(b: VoiceProviderInput) {
    const f = PROVIDER_FIELDS[b.provider];
    const config = Object.fromEntries(f.config.filter((k) => b.config[k]).map((k) => [k, b.config[k]!]));
    const secret = b.secret ? Object.fromEntries(f.secret.filter((k) => b.secret![k]).map((k) => [k, b.secret![k]!])) : null;
    return { config, secret };
  }

  private missing(provider: VoiceProviderKind, config: Record<string, string>, hasSecret: boolean) {
    const f = PROVIDER_FIELDS[provider];
    const errors = f.required.filter((k) => !config[k]).map((k) => ({ field: `config.${k}`, message: 'Preencha este campo.' }));
    if (!hasSecret && f.secret.length && provider !== 'http') errors.push({ field: `secret.${f.secret[0]}`, message: 'Preencha este campo.' });
    for (const k of ['ariUrl', 'callUrl', 'smsUrl', 'apiBase'] as const) {
      if (config[k] && !/^https?:\/\/[^\s]+$/.test(config[k]!)) errors.push({ field: `config.${k}`, message: 'Use um endereço que começa com http:// ou https://.' });
    }
    if (config.from && !/^\+?[\d\s()-]{8,20}$/.test(config.from) && provider !== 'infobip') errors.push({ field: 'config.from', message: 'Informe o número com DDD (ex.: +55 11 3333-4444).' });
    if (errors.length) throw Problem.badRequest('Falta completar a operadora.', errors);
  }

  private seal(tenantId: string, id: string, secret: Record<string, string>): Buffer {
    return this.box.seal(Buffer.from(JSON.stringify(secret), 'utf8'), `voz:${tenantId}:${id}`);
  }

  private hint(secret: Record<string, string>): string | null {
    const v = Object.values(secret)[0];
    return v ? v.slice(-4) : null;
  }

  async create(actor: Actor, b: VoiceProviderInput) {
    const { config, secret } = this.clean(b);
    this.missing(b.provider, config, !!secret && Object.keys(secret).length > 0);
    return this.db.app(tenantCtx(actor), async (q) => {
      const id = randomUUID();
      await q.query(
        `insert into voice_providers (id, tenant_id, name, provider, config, secret, secret_hint, created_by)
         values ($1, app.tenant_id(), $2, $3, $4, $5, $6, $7)`,
        [id, b.name, b.provider, JSON.stringify(config), secret && Object.keys(secret).length ? this.seal(actor.tenantId!, id, secret) : null,
          secret ? this.hint(secret) : null, actor.membershipId]);
      await audit(q, actor, 'voice_provider.create', 'voice_provider', id, { name: b.name, provider: b.provider });
      return this.row(q, id);
    });
  }

  async update(actor: Actor, id: string, b: VoiceProviderInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = (await q.query<{ provider: string; secret: Buffer | null }>('select provider, secret from voice_providers where id = $1', [id])).rows[0];
      if (!cur) throw Problem.notFound('Operadora não encontrada.');
      const { config, secret } = this.clean(b);
      // Trocou de operadora: os segredos antigos não valem.
      const keep = !secret && cur.provider === b.provider ? cur.secret : null;
      this.missing(b.provider, config, !!keep || (!!secret && Object.keys(secret).length > 0));
      await q.query(
        `update voice_providers set name = $2, provider = $3, config = $4, status = 'untested', last_error = null,
                secret = coalesce($5, case when $7 then secret end), secret_hint = case when $5::bytea is not null then $6 when $7 then secret_hint end
          where id = $1`,
        [id, b.name, b.provider, JSON.stringify(config), secret && Object.keys(secret).length ? this.seal(actor.tenantId!, id, secret) : null,
          secret ? this.hint(secret) : null, !!keep]);
      await audit(q, actor, 'voice_provider.update', 'voice_provider', id, { name: b.name, provider: b.provider, secretChanged: !!secret });
      return this.row(q, id);
    });
  }

  async remove(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      const busy = await q.query(`select 1 from campaigns where voice_provider_id = $1 and status in ('scheduled', 'sending', 'paused') limit 1`, [id]);
      if (busy.rowCount) throw Problem.conflict('Há campanha de voz usando esta operadora. Cancele ou termine a campanha antes.');
      const r = await q.query('delete from voice_providers where id = $1', [id]);
      if (!r.rowCount) throw Problem.notFound('Operadora não encontrada.');
      await audit(q, actor, 'voice_provider.delete', 'voice_provider', id, {});
    });
  }

  /** Conta com os segredos abertos (só dentro do servidor). */
  private async account(q: Q, tenantId: string, id: string): Promise<VoiceAccount & { id: string; name: string }> {
    const r = (await q.query<{ id: string; name: string; provider: VoiceProviderKind; config: Record<string, string>; secret: Buffer | null }>(
      'select id, name, provider, config, secret from voice_providers where id = $1', [id])).rows[0];
    if (!r) throw new VoiceError('Operadora não encontrada.');
    const secret = r.secret ? JSON.parse(this.box.open(r.secret, `voz:${tenantId}:${id}`).toString('utf8')) as Record<string, string> : {};
    return { id: r.id, name: r.name, provider: r.provider, config: r.config ?? {}, secret };
  }

  /**
   * Velip: o áudio da biblioteca vai uma vez para a conta da Velip; o
   * identificador dela fica guardado (próximas ligações usam o mesmo).
   */
  private async providerAudio(tenantId: string, acc: VoiceAccount & { id: string }, fileId: string): Promise<string> {
    const ctx = { tenantId, userId: null };
    const cached = await this.db.app(ctx, async (q) => (await q.query<{ id: string | null }>(
      'select audio_cache ->> $2 as id from voice_providers where id = $1', [acc.id, fileId])).rows[0]?.id ?? null);
    if (cached) return cached;
    const { raw, name } = await this.db.app(ctx, async (q) => {
      const f = (await q.query<{ original_name: string; content_type: string }>('select original_name, content_type from files where id = $1 and deleted_at is null', [fileId])).rows[0];
      if (!f?.content_type.startsWith('audio/')) throw new VoiceError('O áudio da campanha não existe mais na biblioteca.');
      return { raw: await this.files.readIn(q, fileId), name: f.original_name };
    });
    const mp3 = await convertForPhone(raw, 'mp3').catch(() => { throw new VoiceError('Não foi possível preparar o áudio.'); });
    const id = await velipUploadAudio(acc, mp3, `CRM - ${name}`, this.opts);
    await this.db.app(ctx, (q) => q.query(`update voice_providers set audio_cache = audio_cache || jsonb_build_object($2::text, $3::text) where id = $1`, [acc.id, fileId, id]));
    return id;
  }

  /** Velip: vozes sintéticas e áudios já cadastrados na conta (para escolher na campanha). */
  async velipCatalog(actor: Actor, id: string) {
    const tenantId = actor.tenantId!;
    const acc = await this.db.app(tenantCtx(actor), (q) => this.account(q, tenantId, id).catch(() => { throw Problem.notFound('Operadora não encontrada.'); }));
    if (acc.provider !== 'velip') throw Problem.notFound('Operadora não encontrada.');
    try {
      const [voices, audios] = await Promise.all([velipVoices(acc, this.opts), velipAudios(acc, this.opts)]);
      return { voices, audios };
    } catch (e) {
      throw Problem.badRequest(e instanceof VoiceError ? e.message : 'Não foi possível falar com a Velip.');
    }
  }

  /**
   * Teste: confere as credenciais e, com um telefone, faz uma ligação de verdade
   * tocando o áudio. A operadora só fica "testada" quando a ligação é atendida.
   */
  async test(actor: Actor, id: string, b: { to: string | null; audioFileId?: string | null }) {
    const tenantId = actor.tenantId!;
    const acc = await this.db.app(tenantCtx(actor), (q) => this.account(q, tenantId, id).catch(() => { throw Problem.notFound('Operadora não encontrada.'); }));
    const fail = async (msg: string) => {
      await this.db.app(tenantCtx(actor), (q) => q.query(`update voice_providers set status = 'error', last_error = $2, tested_at = now() where id = $1`, [id, msg.slice(0, 500)]));
      throw Problem.badRequest(msg);
    };
    try {
      await checkAccount(acc, this.opts);
    } catch (e) {
      return fail(e instanceof VoiceError ? e.message : 'Não foi possível falar com a operadora.');
    }
    if (!b.to) {
      await this.db.app(tenantCtx(actor), (q) => q.query('update voice_providers set last_error = null where id = $1', [id]));
      return { ...(await this.db.app(tenantCtx(actor), (q) => this.row(q, id))), checked: true, called: false };
    }
    const to = normalizePhone(b.to);
    if (!to) throw Problem.badRequest('Telefone inválido.', [{ field: 'to', message: 'Informe o telefone com DDD.' }]);
    if (!b.audioFileId) throw Problem.badRequest('Escolha o áudio do teste.', [{ field: 'audioFileId', message: 'Escolha ou grave um áudio.' }]);
    await this.db.app(tenantCtx(actor), (q) => this.assertAudio(q, b.audioFileId!));
    try {
      const rid = `t-${b.audioFileId}`;
      const providerAudioId = acc.provider === 'velip' ? await this.providerAudio(tenantId, acc, b.audioFileId) : null;
      const r = await placeCall(acc, {
        providerAudioId, keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        to, audioUrl: this.audioUrl(tenantId, b.audioFileId, 'mp3'), audioWavUrl: this.audioUrl(tenantId, b.audioFileId, 'wav'),
        callbackBase: this.callbackBase(id, rid), digits: true, ringSeconds: 30, machineDetection: false, reference: rid,
      }, this.opts);
      await this.db.app(tenantCtx(actor), async (q) => {
        await q.query(`update voice_providers set last_error = null, tested_at = now() where id = $1`, [id]);
        await audit(q, actor, 'voice_provider.test_call', 'voice_provider', id, { ref: r.ref });
      });
      return { ...(await this.db.app(tenantCtx(actor), (q) => this.row(q, id))), checked: true, called: true, ref: r.ref };
    } catch (e) {
      return fail(e instanceof VoiceError ? e.message : 'Não foi possível fazer a ligação.');
    }
  }

  // ---- Áudio -------------------------------------------------------------------------------------

  /** Áudios da biblioteca de mídia (para escolher na campanha). */
  async audios(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => ({
      items: (await q.query(
        `select f.id, f.original_name as name, f.content_type as "contentType", f.size_bytes::int as size, f.created_at as "createdAt"
           from files f where f.purpose = 'media' and f.deleted_at is null and f.content_type like 'audio/%' order by f.created_at desc limit 200`)).rows,
    }));
  }

  /** Áudio gravado na hora ou enviado (qualquer formato): vira MP3 e entra na biblioteca de mídia. */
  async uploadAudio(actor: Actor, name: string, data: Buffer) {
    let mp3: Buffer;
    try {
      mp3 = await convertForPhone(data, 'mp3');
    } catch (e) {
      throw Problem.badRequest(e instanceof AudioError ? e.message : 'Não foi possível ler o áudio.', [{ field: 'file', message: 'Envie um áudio (MP3, WAV, M4A, OGG) ou grave de novo.' }]);
    }
    const base = path.basename(name, path.extname(name)).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 80) || 'Áudio da ligação';
    return this.media.uploadMedia(actor, `${base}.mp3`, mp3);
  }

  private async assertAudio(q: Q, fileId: string) {
    const f = await q.query<{ content_type: string }>(`select content_type from files where id = $1 and deleted_at is null`, [fileId]);
    if (!f.rows[0] || !f.rows[0].content_type.startsWith('audio/')) throw Problem.badRequest('Áudio inválido.', [{ field: 'audioFileId', message: 'Escolha um áudio da biblioteca.' }]);
  }

  /** Endereço público assinado do áudio, no formato da ligação (vale 2 dias). */
  audioUrl(tenantId: string, fileId: string, fmt: 'mp3' | 'wav'): string {
    const exp = Math.floor(Date.now() / 1000) + 2 * 86400;
    const payload = Buffer.from(`${tenantId}.${fileId}.${exp}`).toString('base64url');
    return `${this.base}/api/v1/public/voz/audio/${payload}.${this.sign(`audio:${payload}:${fmt}`)}.${fmt}`;
  }

  /** Abre o áudio assinado, convertido (com cache em memória). */
  async openAudio(token: string): Promise<{ data: Buffer; contentType: string }> {
    const m = /^([A-Za-z0-9_-]{20,200})\.([A-Za-z0-9_-]{32})\.(mp3|wav)$/.exec(token);
    if (!m || !this.verify(`audio:${m[1]}:${m[3]}`, m[2]!)) throw Problem.notFound();
    const [tenantId, fileId, exp] = Buffer.from(m[1]!, 'base64url').toString().split('.');
    if (!tenantId || !fileId || !UUID.test(fileId) || Number(exp) * 1000 < Date.now()) throw Problem.notFound();
    const fmt = m[3] as 'mp3' | 'wav';
    const key = `${fileId}.${fmt}`;
    let data = this.cache.get(key);
    if (!data) {
      const raw = await this.db.app({ tenantId, userId: null }, async (q) => {
        const f = await q.query<{ content_type: string }>('select content_type from files where id = $1 and deleted_at is null', [fileId]);
        if (!f.rows[0]?.content_type.startsWith('audio/')) throw Problem.notFound();
        return this.files.readIn(q, fileId);
      });
      data = await convertForPhone(raw, fmt).catch(() => { throw Problem.notFound(); });
      this.cache.set(key, data);
      // Guarda só os mais recentes.
      while (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value!);
    }
    return { data, contentType: fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav' };
  }

  // ---- Ligação da campanha ----------------------------------------------------------------------

  private async recipient(q: Q, rid: string): Promise<Recipient | null> {
    return (await q.query<Recipient>(
      `select r.id, r.contact_id, r.address, r.campaign_id, r.call_status, r.call_digits, r.call_ended_at, r.call_extras,
              k.voice, k.file_id, k.voice_provider_id, k.success_tag_id, t.name as tenant_name, c.name, c.first_name, c.owner_membership_id,
              (select u.name from memberships m join users u on u.id = m.user_id where m.id = c.owner_membership_id) as owner_name
         from campaign_recipients r join campaigns k on k.id = r.campaign_id join tenants t on t.id = r.tenant_id join contacts c on c.id = r.contact_id
        where r.id = $1`, [rid])).rows[0] ?? null;
  }

  /** Liga para um destinatário da campanha. Erro: VoiceError (a campanha marca a falha). */
  async placeForCampaign(tenantId: string, recipientId: string): Promise<{ ref: string | null }> {
    const ctx = { tenantId, userId: null };
    const { rec, acc } = await this.db.app(ctx, async (q) => {
      const rec = await this.recipient(q, recipientId);
      const v0 = rec?.voice ?? ({} as VoiceSettings);
      const velipOwn = !!(v0.tts?.text || v0.providerAudioId);
      if (!rec?.voice_provider_id || (!rec.file_id && !velipOwn)) throw new VoiceError('Campanha sem operadora ou sem áudio.');
      return { rec, acc: await this.account(q, tenantId, rec.voice_provider_id) };
    });
    const v = rec.voice ?? ({} as VoiceSettings);
    const velipMode = acc.provider === 'velip';
    const providerAudioId = velipMode
      ? v.providerAudioId ?? (v.tts?.text || !rec.file_id ? null : await this.providerAudio(tenantId, acc, rec.file_id))
      : null;
    const fileId = rec.file_id ?? '00000000-0000-4000-8000-000000000000';
    const r = await placeCall(acc, {
      to: rec.address, audioUrl: this.audioUrl(tenantId, fileId, 'mp3'), audioWavUrl: this.audioUrl(tenantId, fileId, 'wav'),
      callbackBase: this.callbackBase(acc.id, rec.id), digits: !!v.digits, ringSeconds: v.ringSeconds ?? 30, machineDetection: !!v.machineDetection,
      reference: rec.id, providerAudioId, keys: Object.keys(v.keys ?? {}).sort(),
      extras: velipMode ? { tts: v.tts ?? null, transfer: v.transfer ?? null, retries: v.retries ?? null, dddHours: !!v.dddHours, name: rec.first_name ?? rec.name } : undefined,
    }, this.opts);
    await this.db.app(ctx, (q) => q.query(`update campaign_recipients set call_ref = $2, call_status = 'queued' where id = $1`, [rec.id, r.ref?.slice(0, 120) ?? null]));
    // WhatsApp e SMS "junto da ligação".
    await this.extras(tenantId, rec, acc, (w) => w === 'with_call');
    return r;
  }

  /** Manda o WhatsApp e o SMS cuja condição bate (cada um uma vez por destinatário). */
  private async extras(tenantId: string, rec: Recipient, acc: VoiceAccount, match: (w: ExtraWhen) => boolean, key?: KeyAction) {
    const v = rec.voice ?? ({} as VoiceSettings);
    const vars = { nome: cleanName(rec.name), primeiro_nome: cleanFirstName(rec.first_name, rec.name), empresa: rec.tenant_name, responsavel: rec.owner_name };
    const done: Record<string, string> = {};
    const fresh = (await this.db.app({ tenantId, userId: null }, (q) => q.query<{ call_extras: Record<string, string> }>(
      'select call_extras from campaign_recipients where id = $1', [rec.id]))).rows[0]?.call_extras ?? {};
    if (v.whatsapp && !fresh.whatsapp && (v.whatsapp.when === 'key' ? !!key?.whatsapp : match(v.whatsapp.when))) {
      try {
        const m = await this.messages.sendByCampaign(tenantId, rec.campaign_id, rec.contact_id, { accountId: v.whatsapp.accountId, to: rec.address, text: render(v.whatsapp.text, vars) }) as { status: string };
        done.whatsapp = m.status === 'failed' ? 'failed' : 'sent';
      } catch (e) {
        this.log.warn(`whatsapp da campanha de voz ${rec.campaign_id}: ${e instanceof Problem ? e.title : String(e)}`);
        done.whatsapp = 'failed';
      }
    }
    if (v.sms && !fresh.sms && (v.sms.when === 'key' ? !!key?.sms : match(v.sms.when))) {
      try {
        await sendSms(acc, rec.address, render(v.sms.text, vars), this.opts);
        done.sms = 'sent';
      } catch (e) {
        this.log.warn(`sms da campanha de voz ${rec.campaign_id}: ${String(e instanceof Error ? e.message : e)}`);
        done.sms = 'failed';
      }
    }
    if (Object.keys(done).length) {
      await this.db.app({ tenantId, userId: null }, (q) => q.query('update campaign_recipients set call_extras = call_extras || $2::jsonb where id = $1', [rec.id, JSON.stringify(done)]));
    }
  }

  // ---- Avisos da operadora ------------------------------------------------------------------------

  /**
   * Aviso da operadora sobre uma ligação. Devolve o que responder: XML (quando a
   * operadora pergunta o que tocar) ou um "ok".
   */
  async handle(token: string, ridIn: string, kind: string, body: unknown): Promise<{ type: 'xml' | 'json'; body: string }> {
    const ok = { type: 'json' as const, body: '{"ok":true}' };
    if (!KINDS.has(kind)) throw Problem.notFound();
    let rid = ridIn;
    const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(token);
    if (!m || !UUID.test(m[1]!) || !this.verify(`voz:${m[1]}`, m[2]!)) throw Problem.notFound();
    const providerId = m[1]!;
    const tenantId = await this.db.auth(async (q) =>
      (await q.query<{ t: string | null }>('select app.voice_provider_tenant($1) as t', [providerId])).rows[0]?.t ?? null);
    if (!tenantId) throw Problem.notFound();
    const ctx = { tenantId, userId: null };
    const acc = await this.db.app(ctx, (q) => this.account(q, tenantId, providerId));
    const ev = parseEvent(acc.provider, kind, body);

    // Endereço único da conta (ex.: "URL atendimento" da Velip): a ligação vem pelo nosso identificador (ctid) ou pelo da operadora.
    if (rid === 'conta') {
      if (ev.reference && (TEST_RID.test(ev.reference) || UUID.test(ev.reference))) rid = ev.reference;
      else if (ev.ref) {
        const found = await this.db.app(ctx, (q) => q.query<{ id: string }>(
          `select r.id from campaign_recipients r join campaigns k on k.id = r.campaign_id where r.call_ref = $1 and k.voice_provider_id = $2 limit 1`, [ev.ref, providerId]));
        if (!found.rows[0]) return ok;
        rid = found.rows[0].id;
      } else return ok;
    }

    // Ligação de teste: atendeu = operadora testada.
    const t = TEST_RID.exec(rid);
    if (t) {
      if (kind === 'atender') return { type: 'xml', body: answerXml(acc.provider, this.audioUrl(tenantId, t[1]!, 'mp3'), true, `${this.callbackBase(providerId, rid)}/tecla`) };
      if (kind === 'tecla') return { type: 'xml', body: HANGUP_XML };
      if (ev.status === 'answered' || ev.status === 'machine' || ev.digits) {
        await this.db.app(ctx, (q) => q.query(`update voice_providers set status = 'ok', last_error = null, tested_at = now() where id = $1`, [providerId]));
      } else if (ev.final) {
        const why: Record<string, string> = { no_answer: 'A ligação de teste não foi atendida.', busy: 'O telefone do teste estava ocupado.', failed: 'A ligação de teste falhou.', canceled: 'A ligação de teste foi cancelada.' };
        await this.db.app(ctx, (q) => q.query(`update voice_providers set last_error = $2, tested_at = now() where id = $1 and status <> 'ok'`, [providerId, why[ev.status!] ?? 'A ligação de teste falhou.']));
      }
      return ok;
    }
    if (!UUID.test(rid)) throw Problem.notFound();
    const rec = await this.db.app(ctx, (q) => this.recipient(q, rid));
    if (!rec || rec.voice_provider_id !== providerId) throw Problem.notFound();
    if (kind === 'atender') {
      await this.apply(tenantId, rec, acc, { status: ev.status });
      const fresh = await this.db.app(ctx, (q) => q.query<{ file_id: string | null }>('select file_id from campaigns where id = $1', [rec.campaign_id]));
      const fileId = fresh.rows[0]?.file_id ?? rec.file_id;
      if (!fileId) return { type: 'xml', body: HANGUP_XML };
      return { type: 'xml', body: answerXml(acc.provider, this.audioUrl(tenantId, fileId, 'mp3'), !!rec.voice?.digits, `${this.callbackBase(providerId, rid)}/tecla`) };
    }
    await this.apply(tenantId, rec, acc, ev);
    return kind === 'tecla' ? { type: 'xml', body: HANGUP_XML } : ok;
  }

  /** Aplica o que o aviso diz (cada efeito uma vez só, mesmo com aviso repetido). */
  private async apply(tenantId: string, rec: Recipient, acc: VoiceAccount, ev: CallEvent) {
    const ctx = { tenantId, userId: null };
    const r = await this.db.app(ctx, async (q) => {
      const cur = (await q.query<{ call_status: CallStatus | null; call_digits: string | null; call_ended_at: Date | null }>(
        'select call_status, call_digits, call_ended_at from campaign_recipients where id = $1 for update', [rec.id])).rows[0];
      if (!cur) return null;
      const digit = ev.digits && !cur.call_digits ? ev.digits : null;
      const finish = !!ev.final && !cur.call_ended_at;
      // Atendeu (ou apertou tecla) vale mais que um "não atendeu" que chegue depois.
      let status = ev.status ?? cur.call_status ?? 'queued';
      if ((digit || cur.call_digits) && status !== 'machine') status = 'answered';
      if (cur.call_status === 'answered' && (status === 'no_answer' || status === 'failed' || status === 'canceled')) status = 'answered';
      if (cur.call_ended_at && cur.call_status) status = cur.call_status;
      if (ev.recordingUrl) await q.query('update campaign_recipients set call_recording_url = $2 where id = $1', [rec.id, ev.recordingUrl.slice(0, 1000)]);
      await q.query(
        `update campaign_recipients set call_status = $2, call_digits = coalesce(call_digits, $3),
                call_seconds = case when $4::int is not null then $4 else call_seconds end,
                call_ended_at = case when $5 then now() else call_ended_at end where id = $1`,
        [rec.id, status, digit, finish ? ev.seconds ?? null : null, finish]);
      const key = digit ? rec.voice?.keys?.[digit[0]!] : undefined;
      if (key) await this.keyActions(q, rec, digit![0]!, key);
      if (finish && status === 'answered' && rec.success_tag_id) {
        await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2) on conflict do nothing', [rec.contact_id, rec.success_tag_id]);
      }
      return { finish, status, key };
    });
    if (!r) return;
    if (r.key) await this.extras(tenantId, rec, acc, () => false, r.key);
    if (r.finish) await this.extras(tenantId, rec, acc, (w) => (w === 'answered' ? r.status === 'answered' : w === 'not_answered' ? r.status !== 'answered' : false));
  }

  /** Tecla apertada: etiqueta, sair da lista e avisar o responsável. */
  private async keyActions(q: Q, rec: Recipient, digit: string, key: KeyAction) {
    if (key.tagId) {
      await q.query(`insert into contact_tags (tenant_id, contact_id, tag_id) select app.tenant_id(), $1, id from tags where id = $2 on conflict do nothing`, [rec.contact_id, key.tagId]);
    }
    if (key.optOut) {
      await q.query(`insert into suppression_list (tenant_id, channel, value, reason) values (app.tenant_id(), 'phone', $1, 'opt_out') on conflict do nothing`, [rec.address]);
    }
    if (key.notifyOwner && rec.owner_membership_id) {
      await q.query(
        `insert into notifications (tenant_id, membership_id, kind, title, body, link) values (app.tenant_id(), $1, 'campaign.voice_key', $2, $3, $4)`,
        [rec.owner_membership_id, `${rec.name} apertou ${digit} na ligação`, key.label || null, `/contatos/${rec.contact_id}`]);
    }
  }

  // ---- Despachante ------------------------------------------------------------------------------

  /**
   * Ligações sem resultado final: pergunta à operadora (Zenvia) e encerra as
   * que ficaram 30 minutos sem aviso (endereço do CRM fora do ar, por exemplo);
   * na central própria, 5 minutos sem aviso é ligação não atendida.
   */
  async poll(): Promise<number> {
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; recipient_id: string }>('select tenant_id, recipient_id from app.voice_pending_calls(100)')).rows);
    let n = 0;
    for (const d of due) {
      try {
        const ctx = { tenantId: d.tenant_id, userId: null };
        const x = await this.db.app(ctx, async (q) => {
          const rec = await this.recipient(q, d.recipient_id);
          if (!rec?.voice_provider_id) return null;
          const sent = (await q.query<{ call_ref: string | null; age: number }>(
            `select call_ref, extract(epoch from now() - sent_at)::int as age from campaign_recipients where id = $1`, [rec.id])).rows[0]!;
          return { rec, sent, acc: await this.account(q, d.tenant_id, rec.voice_provider_id) };
        });
        if (!x) continue;
        let ev: CallEvent | null = null;
        if (x.sent.call_ref) ev = await pollCall(x.acc, x.sent.call_ref, this.opts).catch(() => null);
        // Central própria só avisa ligação atendida: sem aviso em 5 minutos, não atendeu.
        const sip = x.acc.provider === 'sip';
        if (!ev?.final && x.sent.age > (sip ? 5 : 30) * 60) {
          ev = { status: x.rec.call_status === 'answered' ? 'answered' : sip ? 'no_answer' : 'failed', final: true };
          if (ev.status === 'failed') {
            await this.db.app(ctx, (q) => q.query(`update campaign_recipients set reason = 'A operadora não avisou o resultado da ligação.' where id = $1`, [x.rec.id]));
          }
        }
        if (ev && (ev.final || ev.digits)) {
          await this.apply(d.tenant_id, x.rec, x.acc, ev);
          n++;
        }
      } catch (err) {
        this.log.error(`ligação ${d.recipient_id}: ${String(err)}`);
      }
    }
    return n;
  }
}
