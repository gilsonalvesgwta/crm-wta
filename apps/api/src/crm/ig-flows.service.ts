import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { flowIssues, graphSchema, starterGraph, triggerOf, TRIGGER_NAME, type FlowGraph, type TriggerType } from '../domain/flows.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { IG_FIELDS, Meta, MetaError, type MetaHost } from '../infra/meta.js';
import { FilesService } from './files.service.js';
import { MessagesService } from './messages.service.js';
import { metaWebhook } from './meta.service.js';
import { Params, reachOf, reachSql } from './sql.js';

/** Biblioteca de mídia: limite por empresa e por tipo de arquivo. */
export const MEDIA_QUOTA_BYTES = 3 * 1024 ** 3;
const MEDIA_LIMITS: { re: RegExp; label: string; maxMb: number }[] = [
  { re: /^image\/(jpeg|png)$/, label: 'imagem', maxMb: 8 },
  { re: /^video\/(mp4|quicktime)$/, label: 'vídeo', maxMb: 25 },
  { re: /^audio\/(mp4|x-m4a|aac|wav|mpeg)$/, label: 'áudio', maxMb: 25 },
  { re: /^application\/pdf$/, label: 'PDF', maxMb: 25 },
];

const FLOW_COLUMNS = `f.id, f.name, f.trigger_type as "triggerType", f.status, f.version, f.published_at as "publishedAt",
  f.updated_at as "updatedAt", f.created_at as "createdAt", f.channel_account_id as "accountId",
  (select a.name from channel_accounts a where a.id = f.channel_account_id) as "accountName",
  (f.published is not null and f.published is distinct from f.draft) as "unpublishedChanges"`;

type FlowRow = {
  id: string; name: string; triggerType: TriggerType; status: string; version: number; publishedAt: string | null; accountId: string;
  accountName: string; unpublishedChanges: boolean;
};

/**
 * Fluxos do Instagram: cadastro, rascunho e publicação, resultados, biblioteca
 * de mídia, contatos do Instagram e diagnóstico dos avisos.
 * Ver: "campaigns:view". Criar, mudar, publicar e subir mídia: "campaigns:edit".
 */
@Injectable()
export class IgFlowsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(Meta) private readonly meta: Meta,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  // ---- Contas -------------------------------------------------------------------------

  async accounts(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(
      `select a.id, a.name, a.status, a.external_id as "igUserId", a.config->>'username' as username
         from channel_accounts a where a.kind = 'instagram' order by a.created_at`)).rows);
  }

  private async account(q: Q, id: string) {
    const a = (await q.query<{ id: string; name: string; external_id: string; secret: Buffer | null; config: Record<string, unknown>; kind: string }>(
      'select id, name, external_id, secret, config, kind from channel_accounts where id = $1', [id])).rows[0];
    if (!a || a.kind !== 'instagram') throw Problem.badRequest('Conta do Instagram não encontrada.', [{ field: 'accountId', message: 'Escolha uma conta do Instagram (Configurações › Canais).' }]);
    return a;
  }

  private creds(a: { id: string; secret: Buffer | null; config: Record<string, unknown> }) {
    return { token: this.messages.metaCreds(a.id, a.secret).token, host: (a.config.host as MetaHost) ?? 'instagram' };
  }

  // ---- Fluxos -------------------------------------------------------------------------

  async list(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(
      `select ${FLOW_COLUMNS},
              (select count(*)::int from ig_flow_events e where e.flow_id = f.id and e.kind = 'triggered' and e.created_at > now() - interval '7 days') as "triggered7d",
              (select count(*)::int from ig_flow_events e where e.flow_id = f.id and e.kind = 'triggered') as "triggeredTotal",
              (select count(*)::int from ig_flow_runs r where r.flow_id = f.id and r.status = 'waiting') as waiting
         from ig_flows f order by f.updated_at desc`)).rows);
  }

  async get(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), (q) => this.one(q, id));
  }

  private async one(q: Q, id: string) {
    const f = (await q.query<FlowRow & { draft: unknown; published: unknown }>(
      `select ${FLOW_COLUMNS}, f.draft, f.published from ig_flows f where f.id = $1`, [id])).rows[0];
    if (!f) throw Problem.notFound('Fluxo não encontrado.');
    const parsed = graphSchema.safeParse(f.draft);
    return { ...f, issues: parsed.success ? flowIssues(parsed.data) : [{ nodeId: null, level: 'error', message: 'O desenho está inválido.' }] };
  }

  async create(actor: Actor, b: { accountId: string; name: string; triggerType: TriggerType }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.account(q, b.accountId);
      const id = (await q.query<{ id: string }>(
        `insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft, created_by, updated_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $5) returning id`,
        [b.accountId, b.name.trim() || TRIGGER_NAME[b.triggerType], b.triggerType, JSON.stringify(starterGraph(b.triggerType)), actor.membershipId])).rows[0]!.id;
      await audit(q, actor, 'ig_flow.create', 'ig_flow', id, { name: b.name, trigger: b.triggerType });
      return this.one(q, id);
    });
  }

  /** Salva o rascunho (o que está na tela) e/ou o nome. Não mexe no que está publicado. */
  async save(actor: Actor, id: string, b: { name?: string; draft?: unknown; accountId?: string }) {
    let graph: FlowGraph | null = null;
    if (b.draft !== undefined) {
      const p = graphSchema.safeParse(b.draft);
      if (!p.success) throw Problem.badRequest('Desenho inválido.', [{ field: 'draft', message: p.error.issues[0]?.message ?? 'Confira os blocos.' }]);
      graph = p.data;
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = (await q.query<{ id: string }>('select id from ig_flows where id = $1 for update', [id])).rows[0];
      if (!cur) throw Problem.notFound('Fluxo não encontrado.');
      if (b.accountId) await this.account(q, b.accountId);
      await q.query(
        `update ig_flows set name = coalesce($2, name), draft = coalesce($3, draft), trigger_type = coalesce($4, trigger_type),
                channel_account_id = coalesce($5, channel_account_id), updated_by = $6 where id = $1`,
        [id, b.name?.trim() || null, graph ? JSON.stringify(graph) : null, graph ? triggerOf(graph).type : null, b.accountId ?? null, actor.membershipId]);
      return this.one(q, id);
    });
  }

  /** Publica o rascunho: passa a rodar. Erros (não avisos) impedem. */
  async publish(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const f = (await q.query<{ draft: unknown; name: string }>('select draft, name from ig_flows where id = $1 for update', [id])).rows[0];
      if (!f) throw Problem.notFound('Fluxo não encontrado.');
      const p = graphSchema.safeParse(f.draft);
      if (!p.success) throw Problem.badRequest('Desenho inválido.', [{ field: 'draft', message: 'Confira os blocos.' }]);
      const errors = flowIssues(p.data).filter((i) => i.level === 'error');
      if (errors.length) {
        throw new Problem(422, 'Corrija os erros antes de publicar.', 'flow-errors', undefined, errors.map((e) => ({ field: e.nodeId ?? 'flow', message: e.message })));
      }
      await q.query(
        `update ig_flows set published = draft, version = version + 1, status = 'active', published_at = now(), updated_by = $2,
                trigger_type = $3 where id = $1`, [id, actor.membershipId, triggerOf(p.data).type]);
      await audit(q, actor, 'ig_flow.publish', 'ig_flow', id, { name: f.name });
      return this.one(q, id);
    });
  }

  async setStatus(actor: Actor, id: string, status: 'active' | 'paused') {
    return this.db.app(tenantCtx(actor), async (q) => {
      const f = (await q.query<{ published: unknown }>('select published from ig_flows where id = $1 for update', [id])).rows[0];
      if (!f) throw Problem.notFound('Fluxo não encontrado.');
      if (!f.published) throw Problem.badRequest('Publique o fluxo primeiro.', [{ field: 'status', message: 'Publique o fluxo primeiro.' }]);
      await q.query('update ig_flows set status = $2, updated_by = $3 where id = $1', [id, status, actor.membershipId]);
      // Pausar encerra quem estava esperando no fluxo.
      if (status === 'paused') {
        await q.query(`update ig_flow_runs set status = 'canceled', finished_at = now(), last_error = 'Fluxo pausado' where flow_id = $1 and status in ('waiting', 'running')`, [id]);
      }
      await audit(q, actor, status === 'paused' ? 'ig_flow.pause' : 'ig_flow.resume', 'ig_flow', id, {});
      return this.one(q, id);
    });
  }

  async duplicate(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const f = (await q.query<{ name: string; draft: unknown; trigger_type: string; channel_account_id: string }>(
        'select name, draft, trigger_type, channel_account_id from ig_flows where id = $1', [id])).rows[0];
      if (!f) throw Problem.notFound('Fluxo não encontrado.');
      const nid = (await q.query<{ id: string }>(
        `insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft, created_by, updated_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $5) returning id`,
        [f.channel_account_id, `${f.name} (cópia)`.slice(0, 80), f.trigger_type, JSON.stringify(f.draft), actor.membershipId])).rows[0]!.id;
      await audit(q, actor, 'ig_flow.duplicate', 'ig_flow', nid, { from: id });
      return this.one(q, nid);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ name: string }>('delete from ig_flows where id = $1 returning name', [id]);
      if (!r.rowCount) throw Problem.notFound('Fluxo não encontrado.');
      await audit(q, actor, 'ig_flow.delete', 'ig_flow', id, { name: r.rows[0]!.name });
    });
  }

  // ---- Resultados ---------------------------------------------------------------------

  async results(actor: Actor, id: string, f: { from: string; to: string }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const flow = await this.one(q, id);
      const range = [id, f.from, f.to];
      const totals = (await q.query<{ triggered: number; people: number; completed: number; failed: number }>(
        `select count(*) filter (where e.kind = 'triggered')::int as triggered,
                count(distinct r.ig_user_id) filter (where e.kind = 'triggered')::int as people,
                count(*) filter (where e.kind = 'completed')::int as completed,
                count(*) filter (where e.kind = 'failed' and e.node_id is null)::int as failed
           from ig_flow_events e left join ig_flow_runs r on r.id = e.run_id
          where e.flow_id = $1 and e.created_at >= $2::timestamptz and e.created_at < $3::timestamptz`, range)).rows[0]!;
      const waiting = (await q.query<{ n: number }>(`select count(*)::int as n from ig_flow_runs where flow_id = $1 and status = 'waiting'`, [id])).rows[0]!.n;
      const nodes = (await q.query<{ nodeId: string; sent: number; failed: number; answered: number; clicked: number; skipped: number }>(
        `select e.node_id as "nodeId",
                count(*) filter (where e.kind = 'sent')::int as sent, count(*) filter (where e.kind = 'failed')::int as failed,
                count(*) filter (where e.kind = 'answered')::int as answered, count(*) filter (where e.kind = 'clicked')::int as clicked,
                count(*) filter (where e.kind = 'skipped')::int as skipped
           from ig_flow_events e where e.flow_id = $1 and e.node_id is not null and e.created_at >= $2::timestamptz and e.created_at < $3::timestamptz
          group by e.node_id`, range)).rows;
      const buttons = (await q.query<{ nodeId: string; button: string; clicks: number }>(
        `select e.node_id as "nodeId", e.data->>'button' as button, count(*)::int as clicks
           from ig_flow_events e where e.flow_id = $1 and e.kind = 'clicked' and e.created_at >= $2::timestamptz and e.created_at < $3::timestamptz
          group by 1, 2 order by 3 desc`, range)).rows;
      const errors = (await q.query<{ nodeId: string | null; error: string; n: number }>(
        `select e.node_id as "nodeId", e.data->>'error' as error, count(*)::int as n
           from ig_flow_events e where e.flow_id = $1 and e.kind = 'failed' and e.node_id is not null and e.created_at >= $2::timestamptz and e.created_at < $3::timestamptz
          group by 1, 2 order by 3 desc limit 10`, range)).rows;
      const daily = (await q.query<{ day: string; triggered: number }>(
        `select to_char((e.created_at at time zone t.timezone)::date, 'YYYY-MM-DD') as day, count(*)::int as triggered
           from ig_flow_events e cross join (select timezone from tenants where id = app.tenant_id()) t
          where e.flow_id = $1 and e.kind = 'triggered' and e.created_at >= $2::timestamptz and e.created_at < $3::timestamptz
          group by 1 order by 1`, range)).rows;
      const runs = (await q.query(
        `select r.id, r.status, r.node_id as "nodeId", r.wait_kind as "waitKind", r.started_at as "startedAt", r.finished_at as "finishedAt",
                r.last_error as "lastError", r.context->>'text' as text,
                (select json_build_object('id', c.id, 'name', c.name) from contacts c where c.id = r.contact_id) as contact
           from ig_flow_runs r where r.flow_id = $1 order by r.started_at desc limit 30`, [id])).rows;
      return { flow: { id: flow.id, name: flow.name, triggerType: flow.triggerType, status: flow.status }, totals: { ...totals, waiting }, nodes, buttons, errors, daily, runs };
    });
  }

  // ---- Publicações --------------------------------------------------------------------

  async posts(actor: Actor, accountId: string) {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, accountId));
    const { token, host } = this.creds(a);
    try {
      return (await this.meta.igMedia(token, host)).map((m) => ({
        id: m.id, caption: m.caption ?? '', type: m.media_product_type === 'REELS' ? 'reels' : m.media_product_type === 'STORY' ? 'story' : 'post',
        thumbnail: m.thumbnail_url ?? m.media_url ?? null, permalink: m.permalink ?? null, at: m.timestamp ?? null,
      }));
    } catch (err) {
      throw new Problem(502, err instanceof MetaError ? `O Instagram não devolveu as publicações: ${err.message}` : 'Não foi possível buscar as publicações.', 'meta-error');
    }
  }

  // ---- Biblioteca de mídia --------------------------------------------------------------

  async media(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const items = (await q.query(
        `select f.id, f.original_name as name, f.content_type as "contentType", f.size_bytes::int as size, f.created_at as "createdAt",
                (select u.name from memberships m join users u on u.id = m.user_id where m.id = f.uploaded_by) as "uploadedBy"
           from files f where f.purpose = 'media' and f.deleted_at is null order by f.created_at desc limit 500`)).rows;
      const used = (await q.query<{ n: string }>(`select coalesce(sum(size_bytes), 0)::text as n from files where purpose = 'media' and deleted_at is null`)).rows[0]!.n;
      return { items, usedBytes: Number(used), quotaBytes: MEDIA_QUOTA_BYTES };
    });
  }

  async uploadMedia(actor: Actor, name: string, data: Buffer) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const used = Number((await q.query<{ n: string }>(`select coalesce(sum(size_bytes), 0)::text as n from files where purpose = 'media' and deleted_at is null`)).rows[0]!.n);
      if (used + data.length > MEDIA_QUOTA_BYTES) throw new Problem(413, 'A biblioteca de mídia está cheia (3 GB). Apague arquivos que não usa mais.');
      const id = await this.files.storeIn(q, actor, { name, data, purpose: 'media' });
      const f = (await q.query<{ content_type: string }>('select content_type from files where id = $1', [id])).rows[0]!;
      const rule = MEDIA_LIMITS.find((l) => l.re.test(f.content_type));
      if (!rule) throw Problem.badRequest('Tipo de arquivo não aceito.', [{ field: 'file', message: 'Use JPG ou PNG, MP4 ou MOV, M4A, AAC ou WAV, ou PDF.' }]);
      if (data.length > rule.maxMb * 1024 * 1024) throw new Problem(413, `A ${rule.label} passa de ${rule.maxMb} MB.`);
      await audit(q, actor, 'media.upload', 'file', id, { name });
      return (await q.query(
        `select f.id, f.original_name as name, f.content_type as "contentType", f.size_bytes::int as size, f.created_at as "createdAt" from files f where f.id = $1`, [id])).rows[0];
    });
  }

  async removeMedia(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query(`update files set deleted_at = now() where id = $1 and purpose = 'media' and deleted_at is null`, [id]);
      if (!r.rowCount) throw Problem.notFound('Arquivo não encontrado.');
      await audit(q, actor, 'media.delete', 'file', id, {});
    });
  }

  /** Endereço para ver o arquivo na tela (curto). */
  async mediaUrl(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      if (!(await q.query(`select 1 from files where id = $1 and purpose = 'media' and deleted_at is null`, [id])).rowCount) throw Problem.notFound('Arquivo não encontrado.');
    });
    return { url: this.files.publicUrl(actor.tenantId!, id, 600).replace(/^https?:\/\/[^/]+/, '') };
  }

  // ---- Contatos do Instagram ----------------------------------------------------------

  async contacts(actor: Actor, f: { q?: string; tagId?: string; page: number }) {
    const r = reachOf(actor, 'contacts:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const conds = [reachSql(p, 'c', r), 'c.anonymized_at is null'];
      if (f.q) {
        const like = p.add(`%${f.q.trim().replace(/^@/, '').replace(/[%_\\]/g, '\\$&')}%`);
        conds.push(`(c.name ilike ${like} or h.username ilike ${like})`);
      }
      if (f.tagId) conds.push(`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${p.add(f.tagId)}::uuid)`);
      const where = conds.join(' and ');
      const total = (await q.query<{ n: number }>(
        `select count(distinct c.id)::int as n from contacts c join contact_handles h on h.contact_id = c.id and h.kind = 'instagram' where ${where}`, p.values)).rows[0]!.n;
      const lim = p.add(30);
      const off = p.add((f.page - 1) * 30);
      const items = (await q.query(
        `select c.id, c.name, h.username, h.value as "igUserId", m.last_in as "lastInboundAt",
                (m.last_in > now() - interval '24 hours') as "windowOpen",
                (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name), '[]'::json)
                   from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = c.id) as tags
           from contacts c
           join lateral (select hh.username, hh.value from contact_handles hh where hh.contact_id = c.id and hh.kind = 'instagram' order by hh.username nulls last limit 1) h on true
           left join lateral (select max(x.created_at) as last_in from messages x where x.contact_id = c.id and x.channel = 'instagram' and x.direction = 'in') m on true
          where ${where}
          order by m.last_in desc nulls last, c.created_at desc limit ${lim} offset ${off}`, p.values)).rows;
      return { items, total, page: f.page, pageSize: 30 };
    });
  }

  // ---- Diagnóstico --------------------------------------------------------------------

  async diagnostics(actor: Actor, accountId: string) {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, accountId));
    let subscribed: string[] | null = null;
    let error: string | null = null;
    try {
      const { token, host } = this.creds(a);
      subscribed = await this.meta.igSubscriptions(token, host);
    } catch (err) {
      error = err instanceof MetaError ? err.message : 'Não foi possível consultar a Meta.';
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const events = (await q.query(
        `select l.id, l.kind, l.summary, l.outcome, l.created_at as "createdAt",
                (select json_build_object('id', f.id, 'name', f.name) from ig_flows f where f.id = l.flow_id) as flow
           from ig_webhook_log l where l.channel_account_id = $1 order by l.id desc limit 50`, [accountId])).rows;
      const flows = (await q.query<{ trigger: string; n: number }>(
        `select trigger_type as trigger, count(*)::int as n from ig_flows where channel_account_id = $1 and status = 'active' group by 1`, [accountId])).rows;
      return {
        account: { id: a.id, name: a.name, igUserId: a.external_id },
        webhook: metaWebhook(this.cfg, a.id),
        subscribed, missing: subscribed ? IG_FIELDS.filter((x) => !subscribed!.includes(x)) : [...IG_FIELDS], error,
        events, activeFlows: flows,
      };
    });
  }

  /** Ativa os avisos que os fluxos usam (comentários, live, menções, reações, cliques e mensagens). */
  async subscribe(actor: Actor, accountId: string) {
    const a = await this.db.app(tenantCtx(actor), (q) => this.account(q, accountId));
    const { token, host } = this.creds(a);
    try {
      await this.meta.igSubscribe(token, host);
    } catch (err) {
      throw new Problem(502, err instanceof MetaError ? `A Meta não ativou os avisos: ${err.message}` : 'Não foi possível falar com a Meta.', 'meta-error');
    }
    await this.db.app(tenantCtx(actor), (q) => audit(q, actor, 'ig.subscribe', 'channel_account', accountId, {}));
    return this.diagnostics(actor, accountId);
  }
}
