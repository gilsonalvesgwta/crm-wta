import { Inject, Injectable, Logger } from '@nestjs/common';
import { enrichContact } from './contact-enrich.js';
import {
  checkAnswer, COMMENT_TRIGGERS, graphSchema, keywordScore, nextNode, normalize, parsePayload, payloadFor, postbackButtons, renderText,
  triggerOf, waitMinutes, type FlowButton, type FlowGraph, type FlowNode, type FlowOp, type FlowRule, type TriggerType,
} from '../domain/flows.js';
import { readInstagramActivity, readInstagramWebhook } from '../domain/meta.js';
import { Db, type Q } from '../infra/db.js';
import { Meta, MetaError, type MetaHost } from '../infra/meta.js';
import { FilesService } from './files.service.js';
import { MessagesService } from './messages.service.js';

/** Conta do Instagram como o motor precisa (vinda do aviso). */
export type IgAccount = { id: string; external_id: string; secret: Buffer; config: { host?: string } & Record<string, unknown> };

type RunRow = {
  id: string; flow_id: string; flow_version: number; channel_account_id: string; contact_id: string | null; ig_user_id: string;
  status: string; node_id: string | null; wait_kind: string | null; context: RunContext; vars: Record<string, string>; attempts: number;
};
type RunContext = {
  trigger: TriggerType; commentId?: string | null; mediaId?: string | null; text?: string | null; username?: string | null;
  /** Última vez que a pessoa escreveu ou tocou num botão (abre a conversa por 24 h). */
  lastInboundAt?: string | null;
};
type Step = { go: string } | { wait: 'click' | 'reply' | 'delay'; wakeAt: Date } | { stop: 'done' | 'failed'; error?: string };

/** Quantos blocos uma execução anda de uma vez (proteção contra setas em círculo). */
const MAX_STEPS = 40;
/** Quanto tempo uma execução espera clique ou resposta antes de encerrar. */
const DEFAULT_WAIT_H = 7 * 24;
const WINDOW_MS = 24 * 3600_000;

class StepError extends Error {}

/**
 * Motor dos fluxos do Instagram: recebe os avisos (comentário, direct, story,
 * reação, clique), escolhe o fluxo, cria a execução da pessoa e anda pelos
 * blocos até precisar esperar (clique, resposta ou tempo).
 */
@Injectable()
export class IgFlowEngine {
  private readonly log = new Logger('fluxos-instagram');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Meta) private readonly meta: Meta,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  // ---- Avisos -------------------------------------------------------------------------

  /** Trata um aviso do Instagram já validado (assinatura). Devolve quantos eventos rodaram um fluxo. */
  async onWebhook(tenantId: string, acc: IgAccount, body: unknown): Promise<number> {
    let n = 0;
    const ctx = { tenantId, userId: null };
    for (const ev of readInstagramWebhook(body)) {
      if (ev.igUserId !== acc.external_id || ev.fromMe) continue;
      const kind = ev.quickReply ? 'quick_reply' : ev.replyToStory ? 'story_reply' : ev.storyMention !== null && ev.storyMention !== undefined ? 'story_mention' : 'message';
      const summary = ev.text ?? (kind === 'story_mention' ? 'menção no story' : ev.kind);
      if (!(await this.logEvent(ctx, acc.id, `msg:${ev.id}`, kind, summary))) continue;
      try {
        let outcome: string;
        if (ev.quickReply && parsePayload(ev.quickReply)) outcome = await this.click(tenantId, acc, ev.sender, ev.quickReply);
        else if (await this.answer(tenantId, acc, ev.sender, ev.text ?? '')) outcome = 'resposta da pergunta';
        else if (kind === 'story_reply') outcome = await this.trigger(tenantId, acc, 'story_reply', { igsid: ev.sender, text: ev.text, dm: true });
        else if (kind === 'story_mention') outcome = await this.trigger(tenantId, acc, 'story_mention', { igsid: ev.sender, text: null, dm: true });
        else outcome = await this.trigger(tenantId, acc, 'dm_keyword', { igsid: ev.sender, text: ev.text, dm: true });
        await this.logOutcome(ctx, acc.id, `msg:${ev.id}`, outcome);
        if (!outcome.startsWith('nenhum')) n++;
      } catch (err) {
        this.log.error(`aviso do Instagram (direct) não processado: ${String(err)}`);
        await this.logOutcome(ctx, acc.id, `msg:${ev.id}`, 'erro ao processar');
      }
    }
    for (const ev of readInstagramActivity(body)) {
      if (ev.igUserId !== acc.external_id) continue;
      try {
        if (ev.type === 'comment') {
          // Comentários da própria conta (inclusive as respostas do fluxo) não disparam nada.
          if (ev.from.id === acc.external_id) continue;
          const key = `comment:${ev.id}`;
          if (!(await this.logEvent(ctx, acc.id, key, ev.live ? 'live_comment' : 'comment', `@${ev.from.username ?? ev.from.id}: ${ev.text}`.slice(0, 300)))) continue;
          const outcome = await this.trigger(tenantId, acc, ev.live ? 'live_comment' : 'comment', {
            igsid: ev.from.id, username: ev.from.username, text: ev.text, commentId: ev.id, mediaId: ev.mediaId, dm: false,
          });
          await this.logOutcome(ctx, acc.id, key, outcome);
          if (!outcome.startsWith('nenhum')) n++;
        } else if (ev.type === 'postback') {
          const key = `postback:${ev.mid ?? `${ev.sender}:${ev.payload}:${ev.at.getTime()}`}`;
          if (!(await this.logEvent(ctx, acc.id, key, 'postback', ev.title ?? 'botão'))) continue;
          const outcome = await this.click(tenantId, acc, ev.sender, ev.payload);
          await this.logOutcome(ctx, acc.id, key, outcome);
          if (!outcome.startsWith('nenhum')) n++;
        } else if (ev.type === 'reaction' && ev.action === 'react') {
          const key = `reaction:${ev.mid}:${ev.sender}`;
          if (!(await this.logEvent(ctx, acc.id, key, 'reaction', ev.emoji ?? 'reação'))) continue;
          const outcome = await this.trigger(tenantId, acc, 'reaction', { igsid: ev.sender, text: ev.emoji, dm: true });
          await this.logOutcome(ctx, acc.id, key, outcome);
          if (!outcome.startsWith('nenhum')) n++;
        }
      } catch (err) {
        this.log.error(`aviso do Instagram não processado: ${String(err)}`);
      }
    }
    return n;
  }

  /** Registra o aviso; falso se já foi tratado (a Meta pode mandar o mesmo aviso de novo). */
  private async logEvent(ctx: { tenantId: string; userId: null }, accountId: string, key: string, kind: string, summary: string | null): Promise<boolean> {
    return this.db.app(ctx, async (q) => {
      const r = await q.query(
        `insert into ig_webhook_log (tenant_id, channel_account_id, event_key, kind, summary) values (app.tenant_id(), $1, $2, $3, $4)
         on conflict (channel_account_id, event_key) do nothing`, [accountId, key.slice(0, 200), kind, summary?.slice(0, 300) ?? null]);
      // Guarda os últimos 300 avisos de cada conta.
      if (r.rowCount && Math.random() < 0.05) {
        await q.query(
          `delete from ig_webhook_log where channel_account_id = $1 and id < (select id from ig_webhook_log where channel_account_id = $1 order by id desc offset 300 limit 1)`,
          [accountId]);
      }
      return (r.rowCount ?? 0) > 0;
    });
  }

  private async logOutcome(ctx: { tenantId: string; userId: null }, accountId: string, key: string, outcome: string, flowId?: string | null) {
    await this.db.app(ctx, (q) => q.query(
      'update ig_webhook_log set outcome = $3, flow_id = coalesce($4, flow_id) where channel_account_id = $1 and event_key = $2',
      [accountId, key.slice(0, 200), outcome.slice(0, 300), flowId ?? null]));
  }

  // ---- Gatilhos -----------------------------------------------------------------------

  /** Escolhe o fluxo do gatilho e começa a execução da pessoa. Devolve o que aconteceu (para o diagnóstico). */
  private async trigger(tenantId: string, acc: IgAccount, type: TriggerType, ev: {
    igsid: string; username?: string | null; text: string | null; commentId?: string | null; mediaId?: string | null; dm: boolean;
  }): Promise<string> {
    if (!/^[0-9]{3,40}$/.test(ev.igsid)) return 'nenhum fluxo: pessoa sem identificação';
    const ctx = { tenantId, userId: null };
    // Nome do perfil (quando a Meta deixa ver) para completar o contato.
    let profile: { name?: string; username?: string } | null = null;
    try {
      const c = this.creds(acc);
      profile = await this.meta.igProfile(ev.igsid, c.token, c.host).catch(() => null);
    } catch { /* conta sem token: segue sem o nome */ }
    const picked = await this.db.app(ctx, async (q) => {
      const flows = (await q.query<{ id: string; name: string; published: unknown; version: number }>(
        `select id, name, published, version from ig_flows where channel_account_id = $1 and trigger_type = $2 and status = 'active'
          order by published_at desc`, [acc.id, type])).rows;
      let best: { id: string; name: string; graph: FlowGraph; version: number; score: number } | null = null;
      for (const f of flows) {
        const parsed = graphSchema.safeParse(f.published);
        if (!parsed.success) continue;
        const t = triggerOf(parsed.data);
        if (type === 'comment' && t.posts === 'chosen' && (!ev.mediaId || !t.postIds.includes(ev.mediaId))) continue;
        const score = type === 'story_mention' || type === 'reaction' ? 1 : keywordScore(t, ev.text);
        if (score > 0 && (!best || score > best.score)) best = { id: f.id, name: f.name, graph: parsed.data, version: f.version, score };
      }
      if (!best) return null;
      // Frequência: uma vez por pessoa, por publicação ou sempre.
      const t = triggerOf(best.graph);
      if (t.frequency !== 'every') {
        const scope = t.frequency === 'once_per_post' ? (ev.mediaId ?? '') : '';
        const r = await q.query(
          `insert into ig_trigger_log (tenant_id, flow_id, ig_user_id, scope) values (app.tenant_id(), $1, $2, $3) on conflict do nothing`,
          [best.id, ev.igsid, scope]);
        if (!r.rowCount) return { ...best, repeated: true as const };
      }
      // Uma execução por vez para a mesma pessoa no mesmo fluxo.
      await q.query(
        `update ig_flow_runs set status = 'canceled', finished_at = now(), last_error = 'Recomeçou pelo gatilho'
          where flow_id = $1 and ig_user_id = $2 and status in ('waiting', 'running')`, [best.id, ev.igsid]);
      const contactId = await this.ensureContact(q, ev.igsid, ev.username ?? null);
      await enrichContact(q, contactId, { name: profile?.name ?? null, text: ev.dm ? ev.text : null });
      const context: RunContext = {
        trigger: type, commentId: ev.commentId ?? null, mediaId: ev.mediaId ?? null, text: ev.text ?? null, username: ev.username ?? null,
        lastInboundAt: ev.dm ? new Date().toISOString() : null,
      };
      const run = (await q.query<{ id: string }>(
        `insert into ig_flow_runs (tenant_id, flow_id, flow_version, channel_account_id, contact_id, ig_user_id, status, node_id, context)
         values (app.tenant_id(), $1, $2, $3, $4, $5, 'running', $6, $7) returning id`,
        [best.id, best.version, acc.id, contactId, ev.igsid, best.graph.nodes.find((n) => n.type === 'trigger')!.id, JSON.stringify(context)])).rows[0]!;
      await this.event(q, best.id, run.id, null, 'triggered', { text: ev.text?.slice(0, 200) ?? null, mediaId: ev.mediaId ?? null });
      return { ...best, runId: run.id, repeated: false as const };
    });
    if (!picked) return 'nenhum fluxo para este gatilho';
    if (picked.repeated) return `fluxo "${picked.name}": a pessoa já passou por ele`;
    await this.advance(tenantId, acc, picked.runId!, 'next');
    return `fluxo "${picked.name}"`;
  }

  /** Contato da pessoa no Instagram (cria se for a primeira vez). */
  private async ensureContact(q: Q, igsid: string, username: string | null): Promise<string> {
    const found = (await q.query<{ contact_id: string }>(
      `select h.contact_id from contact_handles h join contacts c on c.id = h.contact_id
        where h.kind = 'instagram' and h.value = $1 and c.anonymized_at is null`, [igsid])).rows[0];
    const user = username && /^[A-Za-z0-9._]{1,60}$/.test(username) ? username : null;
    if (found) {
      if (user) await q.query(`update contact_handles set username = $2 where kind = 'instagram' and value = $1 and username is distinct from $2`, [igsid, user]);
      return found.contact_id;
    }
    const name = (user ? `@${user}` : `Instagram ${igsid.slice(-6)}`).slice(0, 120);
    const id = (await q.query<{ id: string }>('insert into contacts (tenant_id, first_name) values (app.tenant_id(), $1) returning id', [name])).rows[0]!.id;
    await q.query(
      `insert into contact_handles (tenant_id, contact_id, kind, value, username) values (app.tenant_id(), $1, 'instagram', $2, $3)
       on conflict (tenant_id, kind, value) do nothing`, [id, igsid, user]);
    await q.query(`insert into attribution_touches (tenant_id, contact_id, recorded_via, source, medium) values (app.tenant_id(), $1, 'channel', 'instagram', 'social')`, [id]);
    await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, data) values (app.tenant_id(), 'contact.created', $1, $2)`,
      [id, JSON.stringify({ via: 'instagram-fluxo' })]);
    return id;
  }

  // ---- Clique e resposta -------------------------------------------------------------

  /** Toque num botão (postback ou resposta rápida): continua a execução pela seta do botão. */
  private async click(tenantId: string, acc: IgAccount, igsid: string, payload: string): Promise<string> {
    const p = parsePayload(payload);
    if (!p) return 'nenhum fluxo: botão sem fluxo';
    const ctx = { tenantId, userId: null };
    const ok = await this.db.app(ctx, async (q) => {
      const run = (await q.query<RunRow & { published: unknown }>(
        `select r.*, f.published from ig_flow_runs r join ig_flows f on f.id = r.flow_id
          where r.id = $1 and r.channel_account_id = $2 for update of r`, [p.runId, acc.id])).rows[0];
      if (!run || run.status !== 'waiting' || run.wait_kind !== 'click') return null;
      const graph = graphSchema.safeParse(run.published);
      const node = graph.success ? graph.data.nodes.find((n) => n.id === run.node_id) : null;
      const btn = node && (node.type === 'text' || node.type === 'private_reply') ? node.data.buttons.find((b) => b.id === p.buttonId) : null;
      if (!btn) return null;
      // A pessoa tocou: a conversa está aberta (e o id dela é o que tocou).
      const context = { ...run.context, lastInboundAt: new Date().toISOString() };
      await q.query(
        `update ig_flow_runs set status = 'running', wait_kind = null, wake_at = null, ig_user_id = $2, context = $3 where id = $1`,
        [run.id, /^[0-9]{3,40}$/.test(igsid) ? igsid : run.ig_user_id, JSON.stringify(context)]);
      await this.event(q, run.flow_id, run.id, run.node_id, 'clicked', { button: btn.title });
      return { runId: run.id, handle: `btn:${btn.id}` };
    });
    if (!ok) return 'nenhum fluxo: clique repetido ou execução encerrada';
    await this.advance(tenantId, acc, ok.runId, ok.handle);
    return 'clique no botão';
  }

  /** Mensagem da pessoa que responde a uma pergunta em aberto. Falso se não havia pergunta esperando. */
  private async answer(tenantId: string, acc: IgAccount, igsid: string, text: string): Promise<boolean> {
    const ctx = { tenantId, userId: null };
    const r = await this.db.app(ctx, async (q) => {
      const run = (await q.query<RunRow & { published: unknown }>(
        `select r.*, f.published from ig_flow_runs r join ig_flows f on f.id = r.flow_id
          where r.channel_account_id = $1 and r.ig_user_id = $2 and r.status = 'waiting' and r.wait_kind = 'reply'
          order by r.updated_at desc limit 1 for update of r`, [acc.id, igsid])).rows[0];
      if (!run) return null;
      const graph = graphSchema.safeParse(run.published);
      const node = graph.success ? graph.data.nodes.find((n) => n.id === run.node_id) : null;
      if (!node || node.type !== 'question') return null;
      const context = { ...run.context, lastInboundAt: new Date().toISOString() };
      const value = checkAnswer(node.data.validate, text);
      if (value === null && run.attempts < 2) {
        await q.query('update ig_flow_runs set attempts = attempts + 1, context = $2 where id = $1', [run.id, JSON.stringify(context)]);
        return { run, node, retry: true as const };
      }
      const vars = { ...run.vars };
      if (value !== null) {
        // A resposta sempre fica disponível como {{chave}} (ou {{email}}/{{telefone}}) nas mensagens seguintes.
        vars[node.data.key || (node.data.saveTo === 'phone' ? 'telefone' : node.data.saveTo)] = value;
        if (run.contact_id) await this.saveAnswer(q, run.contact_id, node.data.saveTo, node.data.key, value);
        await this.event(q, run.flow_id, run.id, node.id, 'answered', { value: value.slice(0, 200) });
      } else {
        await this.event(q, run.flow_id, run.id, node.id, 'skipped', { reason: 'resposta inválida' });
      }
      await q.query(
        `update ig_flow_runs set status = 'running', wait_kind = null, wake_at = null, attempts = 0, vars = $2, context = $3 where id = $1`,
        [run.id, JSON.stringify(vars), JSON.stringify(context)]);
      return { run, node, retry: false as const };
    });
    if (!r) return false;
    if (r.retry) {
      const runCtx = { ...r.run, context: { ...r.run.context, lastInboundAt: new Date().toISOString() } };
      await this.sendDm(tenantId, acc, runCtx, r.node.id, r.node.data.retryText ? await this.render(tenantId, runCtx, r.node.data.retryText) : 'Pode mandar de novo?', [])
        .catch((err) => this.log.warn(`pergunta: não reenviada (${String(err)})`));
      return true;
    }
    await this.advance(tenantId, acc, r.run.id, 'next');
    return true;
  }

  private async saveAnswer(q: Q, contactId: string, to: 'var' | 'field' | 'email' | 'phone', key: string, value: string) {
    if (to === 'field' && /^[a-z0-9_]{1,40}$/.test(key)) {
      await q.query(`update contacts set custom = custom || jsonb_build_object($2::text, $3::text) where id = $1`, [contactId, key, value]);
    } else if (to === 'email') {
      await q.query(
        `insert into contact_emails (tenant_id, contact_id, email, is_primary)
         select app.tenant_id(), $1, $2, not exists (select 1 from contact_emails where contact_id = $1)
          where not exists (select 1 from contact_emails where contact_id = $1 and email = $2)`, [contactId, value]);
    } else if (to === 'phone') {
      const e164 = value.length <= 11 ? `+55${value}` : `+${value}`;
      if (/^\+[1-9][0-9]{6,14}$/.test(e164)) {
        await q.query(
          `insert into contact_phones (tenant_id, contact_id, e164, label, is_primary)
           select app.tenant_id(), $1, $2, 'mobile', not exists (select 1 from contact_phones where contact_id = $1)
            where not exists (select 1 from contact_phones where contact_id = $1 and e164 = $2)`, [contactId, e164]);
      }
    }
  }

  // ---- Despachante --------------------------------------------------------------------

  /** Execuções com tempo vencido: passo "Esperar" e esperas de clique ou resposta que expiraram. */
  async dispatch(): Promise<number> {
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; run_id: string }>('select tenant_id, run_id from app.ig_runs_due(50)')).rows);
    for (const d of due) {
      try {
        await this.wake(d.tenant_id, d.run_id);
      } catch (err) {
        this.log.error(`execução ${d.run_id}: ${String(err)}`);
      }
    }
    return due.length;
  }

  private async wake(tenantId: string, runId: string) {
    const ctx = { tenantId, userId: null };
    const r = await this.db.app(ctx, async (q) => {
      const run = (await q.query<RunRow>('select * from ig_flow_runs where id = $1 for update', [runId])).rows[0];
      if (!run || run.status !== 'waiting') return null;
      const acc = (await q.query<IgAccount>('select id, external_id, secret, config from channel_accounts where id = $1', [run.channel_account_id])).rows[0];
      await q.query(`update ig_flow_runs set status = 'running', wait_kind = null, wake_at = null, locked_until = null where id = $1`, [runId]);
      return acc ? { acc, handle: run.wait_kind === 'delay' ? 'next' : 'timeout' } : null;
    });
    if (r) await this.advance(tenantId, r.acc, runId, r.handle, true);
  }

  // ---- Andar pelos blocos --------------------------------------------------------------

  /** Segue pela seta "handle" do bloco atual e roda os blocos até precisar esperar ou acabar. */
  async advance(tenantId: string, acc: IgAccount, runId: string, handle: string, fromTimeout = false): Promise<void> {
    const ctx = { tenantId, userId: null };
    let h = handle;
    for (let i = 0; i < MAX_STEPS; i++) {
      const loaded = await this.db.app(ctx, async (q) => {
        const run = (await q.query<RunRow & { published: unknown; flow_status: string }>(
          `select r.*, f.published, f.status as flow_status from ig_flow_runs r join ig_flows f on f.id = r.flow_id where r.id = $1`, [runId])).rows[0];
        return run;
      });
      if (!loaded || loaded.status !== 'running') return;
      const graph = graphSchema.safeParse(loaded.published);
      if (!graph.success) return this.finish(tenantId, loaded, 'failed', 'O fluxo publicado está inválido.');
      const node = loaded.node_id ? nextNode(graph.data, loaded.node_id, h) : null;
      if (!node) {
        // Espera expirada sem seta "se não responder": encerra sem erro.
        return this.finish(tenantId, loaded, 'done', fromTimeout && h === 'timeout' ? 'Tempo de espera encerrado' : null);
      }
      let step: Step;
      try {
        step = await this.run(tenantId, acc, loaded, graph.data, node);
      } catch (err) {
        const msg = err instanceof MetaError || err instanceof StepError ? err.message : 'Falha inesperada neste passo.';
        if (!(err instanceof MetaError || err instanceof StepError)) this.log.error(`passo ${node.type}: ${String(err)}`);
        await this.db.app(ctx, (q) => this.event(q, loaded.flow_id, loaded.id, node.id, 'failed', { error: msg.slice(0, 300) }));
        // Responder no comentário que falhou não impede o resto (a resposta privada ainda pode ir).
        if (node.type === 'comment_reply') step = { go: 'next' };
        else return this.finish(tenantId, { ...loaded, node_id: node.id }, 'failed', msg);
      }
      if ('stop' in step) return this.finish(tenantId, { ...loaded, node_id: node.id }, step.stop, step.error ?? null);
      if ('wait' in step) {
        await this.db.app(ctx, (q) => q.query(
          `update ig_flow_runs set status = 'waiting', node_id = $2, wait_kind = $3, wake_at = $4, attempts = 0 where id = $1`,
          [runId, node.id, step.wait, step.wakeAt]));
        return;
      }
      await this.db.app(ctx, (q) => q.query('update ig_flow_runs set node_id = $2 where id = $1', [runId, node.id]));
      h = step.go;
      fromTimeout = false;
    }
    await this.db.app(ctx, (q) => q.query(
      `update ig_flow_runs set status = 'failed', finished_at = now(), last_error = 'O fluxo passou de ${MAX_STEPS} passos seguidos (setas em círculo?)' where id = $1`, [runId]));
  }

  private async finish(tenantId: string, run: RunRow, status: 'done' | 'failed', error: string | null) {
    await this.db.app({ tenantId, userId: null }, async (q) => {
      await q.query(
        `update ig_flow_runs set status = $2, finished_at = now(), wait_kind = null, wake_at = null, last_error = $3, node_id = coalesce($4, node_id) where id = $1`,
        [run.id, status, error?.slice(0, 1000) ?? null, run.node_id]);
      await this.event(q, run.flow_id, run.id, null, status === 'done' ? 'completed' : 'failed', error ? { error: error.slice(0, 300) } : {});
    });
  }

  /** Roda um bloco. */
  private async run(tenantId: string, acc: IgAccount, run: RunRow, g: FlowGraph, node: FlowNode): Promise<Step> {
    const ctx = { tenantId, userId: null };
    const sent = (data: Record<string, unknown> = {}) => this.db.app(ctx, (q) => this.event(q, run.flow_id, run.id, node.id, 'sent', data));
    switch (node.type) {
      case 'trigger':
        return { go: 'next' };
      case 'comment_reply': {
        if (!run.context.commentId) throw new StepError('Sem comentário para responder.');
        const options = node.data.variants.map((v) => v.trim()).filter(Boolean);
        if (!options.length) return { go: 'next' };
        const text = await this.render(tenantId, run, options[Math.floor(Math.random() * options.length)]!);
        const { token, host } = this.creds(acc);
        await this.meta.igReplyComment(run.context.commentId, token, host, text);
        await sent({ text: text.slice(0, 200) });
        return { go: 'next' };
      }
      case 'private_reply': {
        if (!run.context.commentId) throw new StepError('Sem comentário para responder no privado.');
        const text = await this.render(tenantId, run, node.data.text);
        const { recipientId } = await this.deliver(tenantId, acc, run, node.id, { comment_id: run.context.commentId }, text, node.data.buttons);
        if (recipientId && recipientId !== run.ig_user_id && /^[0-9]{3,40}$/.test(recipientId)) {
          // A Meta devolve o id da pessoa no direct: é por ele que os próximos passos seguem.
          await this.db.app(ctx, async (q) => {
            await q.query('update ig_flow_runs set ig_user_id = $2 where id = $1', [run.id, recipientId]);
            if (run.contact_id) {
              await q.query(
                `insert into contact_handles (tenant_id, contact_id, kind, value, username) values (app.tenant_id(), $1, 'instagram', $2, $3)
                 on conflict (tenant_id, kind, value) do nothing`, [run.contact_id, recipientId, run.context.username ?? null]);
            }
          });
          run.ig_user_id = recipientId;
        }
        await sent({ text: text.slice(0, 200) });
        return postbackButtons(node.data.buttons).length ? { wait: 'click', wakeAt: hoursFromNow(DEFAULT_WAIT_H) } : { go: 'next' };
      }
      case 'text': {
        this.requireWindow(run);
        const text = await this.render(tenantId, run, node.data.text);
        await this.sendDm(tenantId, acc, run, node.id, text, node.data.buttons);
        await sent({ text: text.slice(0, 200) });
        return postbackButtons(node.data.buttons).length ? { wait: 'click', wakeAt: hoursFromNow(DEFAULT_WAIT_H) } : { go: 'next' };
      }
      case 'media': {
        this.requireWindow(run);
        if (!node.data.fileId) throw new StepError('Escolha o arquivo do bloco de mídia.');
        const file = await this.db.app(ctx, async (q) => (await q.query<{ content_type: string; original_name: string }>(
          `select content_type, original_name from files where id = $1 and purpose = 'media' and deleted_at is null`, [node.data.fileId])).rows[0]);
        if (!file) throw new StepError('O arquivo saiu da biblioteca de mídia.');
        const type = file.content_type.startsWith('image/') ? 'image' : file.content_type.startsWith('video/') ? 'video' : file.content_type.startsWith('audio/') ? 'audio' : 'file';
        const url = this.files.publicUrl(tenantId, node.data.fileId, 3600);
        const { token, host } = this.creds(acc);
        const r = await this.meta.igSendMessage(acc.external_id, token, host, { id: run.ig_user_id }, { attachment: { type, payload: { url } } });
        await this.record(tenantId, acc, run, r.messageId, `[${file.original_name}]`, type === 'file' ? 'document' : type);
        await sent({ file: file.original_name });
        return { go: 'next' };
      }
      case 'wait':
        return { wait: 'delay', wakeAt: new Date(Date.now() + waitMinutes(node.data) * 60_000) };
      case 'question': {
        this.requireWindow(run);
        const text = await this.render(tenantId, run, node.data.text);
        await this.sendDm(tenantId, acc, run, node.id, text, []);
        await sent({ text: text.slice(0, 200) });
        return { wait: 'reply', wakeAt: hoursFromNow(node.data.timeoutHours ?? DEFAULT_WAIT_H) };
      }
      case 'condition':
        return { go: (await this.check(tenantId, acc, run, node.data.match, node.data.rules)) ? 'yes' : 'no' };
      case 'action': {
        const done: string[] = [];
        for (const op of node.data.ops) done.push(await this.perform(tenantId, run, op, g));
        await sent({ done });
        return { go: 'next' };
      }
    }
  }

  /** No comentário, o direct só abre quando a pessoa toca no botão ou escreve: sem isso, a Meta recusa. */
  private requireWindow(run: RunRow) {
    const at = run.context.lastInboundAt ? Date.parse(run.context.lastInboundAt) : 0;
    if (Date.now() - at > WINDOW_MS) {
      throw new StepError(COMMENT_TRIGGERS.includes(run.context.trigger) && !run.context.lastInboundAt
        ? 'A conversa ainda não estava aberta: no comentário, o direct só abre pela resposta no privado com o clique no botão.'
        : 'A conversa fechou: o Instagram só deixa mandar mensagem até 24 h depois da última mensagem da pessoa.');
    }
  }

  private creds(acc: IgAccount): { token: string; host: MetaHost } {
    return { token: this.messages.metaCreds(acc.id, acc.secret).token, host: (acc.config.host as MetaHost) ?? 'instagram' };
  }

  /** Manda no direct (para a pessoa). */
  private async sendDm(tenantId: string, acc: IgAccount, run: RunRow, nodeId: string, text: string, buttons: FlowButton[]) {
    return this.deliver(tenantId, acc, run, nodeId, { id: run.ig_user_id }, text, buttons);
  }

  /**
   * Manda texto com botões: modelo de botões (postback e link); se a Meta não
   * aceitar, respostas rápidas; por fim, só o texto (com os links no fim).
   */
  private async deliver(tenantId: string, acc: IgAccount, run: RunRow, _nodeId: string, recipient: { id: string } | { comment_id: string }, text: string, buttons: FlowButton[]) {
    const { token, host } = this.creds(acc);
    const pb = postbackButtons(buttons);
    const links = buttons.filter((b) => b.url && b.title.trim());
    const withLinks = links.length ? `${text}\n\n${links.map((l) => `${l.title}: ${l.url}`).join('\n')}` : text;
    const attempts: Record<string, unknown>[] = [];
    if (pb.length || links.length) {
      attempts.push({
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button', text: text.slice(0, 640),
            buttons: [...pb.map((b) => ({ type: 'postback', title: b.title.slice(0, 20), payload: payloadFor(run.id, b.id) })),
              ...links.map((b) => ({ type: 'web_url', title: b.title.slice(0, 20), url: b.url }))].slice(0, 3),
          },
        },
      });
    }
    if (pb.length) attempts.push({ text: withLinks.slice(0, 1000), quick_replies: pb.map((b) => ({ content_type: 'text', title: b.title.slice(0, 20), payload: payloadFor(run.id, b.id) })) });
    attempts.push({ text: withLinks.slice(0, 1000) });
    let last: unknown = null;
    for (const message of attempts) {
      try {
        const r = await this.meta.igSendMessage(acc.external_id, token, host, recipient, message);
        await this.record(tenantId, acc, { ...run, ig_user_id: r.recipientId ?? run.ig_user_id }, r.messageId,
          pb.length ? `${text}\n${pb.map((b) => `[${b.title}]`).join(' ')}` : withLinks, 'text');
        return r;
      } catch (err) {
        last = err;
        // Só tenta o formato seguinte se a Meta recusou o formato (parâmetro inválido).
        if (!(err instanceof MetaError) || (err.code !== 100 && err.httpStatus !== 400)) throw err;
      }
    }
    throw last;
  }

  /** Guarda a mensagem enviada pelo fluxo no histórico (aparece em Conversas). */
  private async record(tenantId: string, acc: IgAccount, run: RunRow, messageId: string, body: string, kind: string) {
    if (!run.contact_id) return;
    await this.db.app({ tenantId, userId: null }, async (q) => {
      await q.query(
        `insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, external_id, remote, body, kind, ig_flow_id, sent_at)
         values (app.tenant_id(), $1, 'instagram', 'out', 'sent', $2, $3, $4, $5, $6, $7, now())
         on conflict (channel_account_id, external_id) where external_id is not null and channel_account_id is not null do nothing`,
        [acc.id, run.contact_id, messageId, run.ig_user_id, body.slice(0, 20000), kind, run.flow_id]);
    });
  }

  /** Variáveis do texto: dados do contato, do comentário e respostas guardadas. */
  private async render(tenantId: string, run: RunRow, tpl: string): Promise<string> {
    const c = run.contact_id ? await this.db.app({ tenantId, userId: null }, async (q) => (await q.query<{ first_name: string; name: string; custom: Record<string, unknown>; username: string | null }>(
      `select c.first_name, c.name, c.custom, (select h.username from contact_handles h where h.contact_id = c.id and h.kind = 'instagram' and h.username is not null limit 1) as username
         from contacts c where c.id = $1`, [run.contact_id])).rows[0]) : undefined;
    const first = c?.first_name?.startsWith('@') || c?.first_name?.startsWith('Instagram ') ? '' : (c?.first_name ?? '').split(/\s+/)[0] ?? '';
    const custom = Object.fromEntries(Object.entries(c?.custom ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]));
    const username = c?.username ?? run.context.username ?? null;
    return renderText(tpl, {
      ...custom, ...run.vars,
      nome: first, primeiro_nome: first, nome_completo: c?.name ?? '', usuario: username ? `@${username}` : '', comentario: run.context.text ?? '',
    }).trim();
  }

  /** Regras da condição. */
  private async check(tenantId: string, acc: IgAccount, run: RunRow, match: 'all' | 'any', rules: FlowRule[]): Promise<boolean> {
    if (!rules.length) return true;
    const results: boolean[] = [];
    for (const r of rules) {
      let ok = false;
      if (r.kind === 'has_tag' || r.kind === 'not_tag') {
        const has = run.contact_id ? await this.db.app({ tenantId, userId: null }, async (q) =>
          ((await q.query('select 1 from contact_tags where contact_id = $1 and tag_id::text = $2', [run.contact_id, r.tagId])).rowCount ?? 0) > 0) : false;
        ok = r.kind === 'has_tag' ? has : !has;
      } else if (r.kind === 'follows' || r.kind === 'not_follows') {
        const { token, host } = this.creds(acc);
        const follows = await this.meta.igFollows(run.ig_user_id, token, host).catch(() => null);
        ok = r.kind === 'follows' ? follows === true : follows === false;
      } else if (r.kind === 'var_set') {
        ok = !!(run.vars[r.key] ?? '').trim();
      } else if (r.kind === 'var_equals') {
        ok = normalize(run.vars[r.key] ?? '') === normalize(r.value);
      }
      results.push(ok);
    }
    return match === 'all' ? results.every(Boolean) : results.some(Boolean);
  }

  /** Ações no CRM. */
  private async perform(tenantId: string, run: RunRow, op: FlowOp, _g: FlowGraph): Promise<string> {
    if (!run.contact_id) throw new StepError('Sem contato para a ação.');
    const contactId = run.contact_id;
    return this.db.app({ tenantId, userId: null }, async (q) => {
      const flow = (await q.query<{ name: string; created_by: string | null }>('select name, created_by from ig_flows where id = $1', [run.flow_id])).rows[0]!;
      switch (op.kind) {
        case 'add_tag': {
          const tag = (await q.query<{ name: string }>('select name from tags where id::text = $1', [op.tagId])).rows[0];
          if (!tag) throw new StepError('A etiqueta não existe mais.');
          await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2) on conflict do nothing', [contactId, op.tagId]);
          return `etiqueta "${tag.name}"`;
        }
        case 'remove_tag':
          await q.query('delete from contact_tags where contact_id = $1 and tag_id::text = $2', [contactId, op.tagId]);
          return 'etiqueta removida';
        case 'set_field': {
          if (!/^[a-z0-9_]{1,40}$/.test(op.key)) throw new StepError('Campo inválido.');
          const value = await this.render(tenantId, run, op.value);
          await q.query(`update contacts set custom = custom || jsonb_build_object($2::text, $3::text) where id = $1`, [contactId, op.key, value]);
          return `campo ${op.key}`;
        }
        case 'create_lead': {
          const title = (await this.render(tenantId, run, op.title || `Lead do Instagram (${flow.name})`)).slice(0, 200) || 'Lead do Instagram';
          const id = (await q.query<{ id: string }>(
            `insert into leads (tenant_id, contact_id, title, source, owner_membership_id) values (app.tenant_id(), $1, $2, 'Instagram', $3) returning id`,
            [contactId, title, flow.created_by])).rows[0]!.id;
          await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, lead_id, data) values (app.tenant_id(), 'lead.created', $1, $2, $3)`,
            [contactId, id, JSON.stringify({ title, via: 'instagram-fluxo', flow: flow.name })]);
          return `lead "${title}"`;
        }
        case 'create_deal': {
          const stage = (await q.query<{ id: string }>(
            `select s.id from pipeline_stages s join pipelines p on p.id = s.pipeline_id where p.id::text = $1 and s.kind = 'open' order by s.position limit 1`,
            [op.pipelineId])).rows[0];
          if (!stage) throw new StepError('O funil de negócios não existe mais.');
          const title = (await this.render(tenantId, run, op.title || `Instagram: {{nome_completo}}`)).slice(0, 200) || 'Negócio do Instagram';
          const id = (await q.query<{ id: string }>(
            `insert into deals (tenant_id, pipeline_id, stage_id, title, contact_id, owner_membership_id) values (app.tenant_id(), $1, $2, $3, $4, $5) returning id`,
            [op.pipelineId, stage.id, title, contactId, flow.created_by])).rows[0]!.id;
          await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, deal_id, data) values (app.tenant_id(), 'deal.created', $1, $2, $3)`,
            [contactId, id, JSON.stringify({ title, via: 'instagram-fluxo', flow: flow.name })]);
          return `negócio "${title}"`;
        }
        case 'notify': {
          const to = op.membershipId || flow.created_by;
          if (!to) throw new StepError('Ninguém para avisar.');
          const text = await this.render(tenantId, run, op.text || 'Uma pessoa passou pelo fluxo {{usuario}}');
          await q.query(
            `insert into notifications (tenant_id, membership_id, kind, title, body, link) values (app.tenant_id(), $1, 'instagram.flow', $2, $3, $4)`,
            [to, `Fluxo "${flow.name}"`.slice(0, 200), text.slice(0, 1000), `/contatos/${contactId}`]);
          return 'aviso para a equipe';
        }
        case 'assign': {
          await q.query(
            `insert into conversations (tenant_id, contact_id, channel, assignee_membership_id) values (app.tenant_id(), $1, 'instagram', $2)
             on conflict (tenant_id, contact_id, channel) do update set assignee_membership_id = excluded.assignee_membership_id`,
            [contactId, op.membershipId]);
          return 'conversa atribuída';
        }
      }
    });
  }

  private async event(q: Q, flowId: string, runId: string | null, nodeId: string | null, kind: string, data: Record<string, unknown>) {
    await q.query(
      `insert into ig_flow_events (tenant_id, flow_id, run_id, node_id, kind, data) values (app.tenant_id(), $1, $2, $3, $4, $5)`,
      [flowId, runId, nodeId, kind, JSON.stringify(data)]);
  }
}

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 3600_000);
}
