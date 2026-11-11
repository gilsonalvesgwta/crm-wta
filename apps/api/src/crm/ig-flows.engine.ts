import { Inject, Injectable, Logger } from '@nestjs/common';
import { enrichContact } from './contact-enrich.js';
import {
  checkAnswer, COMMENT_TRIGGERS, graphSchema, keywordScore, nextNode, normalize, parsePayload, payloadFor, postbackButtons, renderText,
  TEMPLATE_BUTTON_RE, triggerOf, waitMinutes, type FlowButton, type FlowGraph, type FlowNode, type FlowOp, type FlowRule, type TriggerType,
} from '../domain/flows.js';
import { readInstagramActivity, readInstagramWebhook } from '../domain/meta.js';
import { phoneVariants } from '../domain/whatsapp.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { Meta, MetaError, type MetaHost } from '../infra/meta.js';
import { FilesService } from './files.service.js';
import { MessagesService, type FlowSendExtras, type SendInput } from './messages.service.js';

/** Conta do Instagram (ou do WhatsApp oficial) como o motor precisa (vinda do aviso). */
export type IgAccount = { id: string; external_id: string; secret: Buffer; config: { host?: string } & Record<string, unknown> };

type RunRow = {
  id: string; flow_id: string; flow_version: number; channel_account_id: string; contact_id: string | null; ig_user_id: string;
  status: string; node_id: string | null; wait_kind: string | null; context: RunContext; vars: Record<string, string>; attempts: number;
  /** WhatsApp: ig_user_id guarda o número (só dígitos). */
  channel: 'instagram' | 'whatsapp'; campaign_id: string | null;
};
type RunContext = {
  trigger: TriggerType; commentId?: string | null; mediaId?: string | null; text?: string | null; username?: string | null;
  /** Última vez que a pessoa escreveu ou tocou num botão (abre a conversa por 24 h). */
  lastInboundAt?: string | null;
  /** WhatsApp: última mensagem mandada pelo fluxo (a transmissão guarda no destinatário da campanha). */
  lastMessageId?: string | null;
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

  // ---- WhatsApp oficial --------------------------------------------------------------

  /**
   * Mensagem recebida no WhatsApp oficial (já guardada no histórico): clique num
   * botão, resposta de uma pergunta ou palavra-chave de um fluxo.
   */
  async onWhatsapp(tenantId: string, acc: IgAccount, ev: { id: string; from: string; text: string | null; payload?: string | null }): Promise<string> {
    const ctx = { tenantId, userId: null };
    const wa = ev.from.replace(/\D/g, '');
    if (!/^[0-9]{8,15}$/.test(wa)) return 'nenhum fluxo: número inválido';
    const key = `wa:${ev.id}`;
    if (!(await this.logEvent(ctx, acc.id, key, ev.payload ? 'button' : 'message', ev.text ?? (ev.payload ? 'botão' : 'mensagem')))) return 'nenhum fluxo: aviso repetido';
    // A pessoa pode aparecer com ou sem o nono dígito.
    const ids = phoneVariants(`+${wa}`).map((v) => v.replace(/\D/g, ''));
    try {
      let outcome: string;
      if (ev.payload && parsePayload(ev.payload)) outcome = await this.click(tenantId, acc, wa, ev.payload);
      else if (ev.text && await this.clickByText(tenantId, acc, ids, ev.text)) outcome = 'clique no botão (texto)';
      else if (await this.answer(tenantId, acc, wa, ev.text ?? '', ids)) outcome = 'resposta da pergunta';
      else if (ev.text) outcome = await this.triggerWa(tenantId, acc, wa, ev.text);
      else outcome = 'nenhum fluxo para este gatilho';
      await this.logOutcome(ctx, acc.id, key, outcome);
      return outcome;
    } catch (err) {
      this.log.error(`aviso do WhatsApp (fluxo) não processado: ${String(err)}`);
      await this.logOutcome(ctx, acc.id, key, 'erro ao processar');
      return 'erro ao processar';
    }
  }

  /** A pessoa escreveu exatamente o nome de um botão que está esperando o clique: vale como clique. */
  private async clickByText(tenantId: string, acc: IgAccount, ids: string[], text: string): Promise<boolean> {
    const want = normalize(text);
    if (!want) return false;
    const hit = await this.db.app({ tenantId, userId: null }, async (q) => {
      const runs = (await q.query<RunRow & { published: unknown }>(
        `select r.*, f.published, f.channel from ig_flow_runs r join ig_flows f on f.id = r.flow_id
          where r.channel_account_id = $1 and r.ig_user_id = any($2::text[]) and r.status = 'waiting' and r.wait_kind = 'click'
          order by r.updated_at desc limit 5`, [acc.id, ids])).rows;
      for (const run of runs) {
        const g = graphSchema.safeParse(run.published);
        const node = g.success ? g.data.nodes.find((n) => n.id === run.node_id) : null;
        const btn = node && (node.type === 'text' || node.type === 'template') ? postbackButtons(node.data.buttons).find((b) => normalize(b.title) === want) : null;
        if (btn) return payloadFor(run.id, btn.id);
      }
      return null;
    });
    if (!hit) return false;
    return !(await this.click(tenantId, acc, ids[0]!, hit)).startsWith('nenhum');
  }

  /** Palavra-chave numa mensagem do WhatsApp: começa o fluxo para a pessoa. */
  private async triggerWa(tenantId: string, acc: IgAccount, wa: string, text: string): Promise<string> {
    const ctx = { tenantId, userId: null };
    const picked = await this.db.app(ctx, async (q) => {
      const flows = (await q.query<{ id: string; name: string; published: unknown; version: number }>(
        `select id, name, published, version from ig_flows where channel_account_id = $1 and trigger_type = 'wa_keyword' and status = 'active'
          order by published_at desc`, [acc.id])).rows;
      let best: { id: string; name: string; graph: FlowGraph; version: number; score: number } | null = null;
      for (const f of flows) {
        const parsed = graphSchema.safeParse(f.published);
        if (!parsed.success) continue;
        const score = keywordScore(triggerOf(parsed.data), text);
        if (score > 0 && (!best || score > best.score)) best = { id: f.id, name: f.name, graph: parsed.data, version: f.version, score };
      }
      if (!best) return null;
      if (triggerOf(best.graph).frequency !== 'every') {
        const r = await q.query(
          `insert into ig_trigger_log (tenant_id, flow_id, ig_user_id, scope) values (app.tenant_id(), $1, $2, '') on conflict do nothing`, [best.id, wa]);
        if (!r.rowCount) return { ...best, repeated: true as const };
      }
      const contactId = (await q.query<{ contact_id: string }>(
        `select p.contact_id from contact_phones p join contacts c on c.id = p.contact_id
          where p.e164 = any($1::text[]) and c.anonymized_at is null order by p.is_primary desc, c.created_at limit 1`, [phoneVariants(`+${wa}`)])).rows[0]?.contact_id ?? null;
      if (!contactId) return null;
      await q.query(
        `update ig_flow_runs set status = 'canceled', finished_at = now(), last_error = 'Recomeçou pelo gatilho'
          where flow_id = $1 and ig_user_id = $2 and status in ('waiting', 'running')`, [best.id, wa]);
      const context: RunContext = { trigger: 'wa_keyword', text: text.slice(0, 1000), lastInboundAt: new Date().toISOString() };
      const run = (await q.query<{ id: string }>(
        `insert into ig_flow_runs (tenant_id, flow_id, flow_version, channel_account_id, contact_id, ig_user_id, status, node_id, context)
         values (app.tenant_id(), $1, $2, $3, $4, $5, 'running', $6, $7) returning id`,
        [best.id, best.version, acc.id, contactId, wa, best.graph.nodes.find((n) => n.type === 'trigger')!.id, JSON.stringify(context)])).rows[0]!;
      await this.event(q, best.id, run.id, null, 'triggered', { text: text.slice(0, 200) });
      return { ...best, runId: run.id, repeated: false as const };
    });
    if (!picked) return 'nenhum fluxo para este gatilho';
    if (picked.repeated) return `fluxo "${picked.name}": a pessoa já passou por ele`;
    await this.advance(tenantId, acc, picked.runId!, 'next');
    return `fluxo "${picked.name}"`;
  }

  /**
   * Transmissão: a campanha começa o fluxo para um destinatário. O primeiro
   * passo manda o modelo aprovado; o clique num botão continua a conversa.
   * Devolve a mensagem mandada (para os números da campanha) e se falhou.
   */
  async startBroadcast(tenantId: string, b: { campaignId: string; flowId: string; contactId: string; to: string }): Promise<{ id: string | null; status: 'sent' | 'failed'; error: string | null }> {
    const ctx = { tenantId, userId: null };
    const wa = b.to.replace(/\D/g, '');
    const start = await this.db.app(ctx, async (q) => {
      const f = (await q.query<{ published: unknown; version: number; status: string; channel: string; channel_account_id: string }>(
        'select published, version, status, channel, channel_account_id from ig_flows where id = $1', [b.flowId])).rows[0];
      if (!f || f.channel !== 'whatsapp' || f.status !== 'active') throw new Problem(409, 'O fluxo da transmissão não está ativo.', 'flow-inactive');
      const acc = (await q.query<IgAccount & { status: string; name: string }>(
        'select id, external_id, secret, config, status, name from channel_accounts where id = $1', [f.channel_account_id])).rows[0];
      if (!acc || acc.status !== 'connected') throw Problem.conflict(`O WhatsApp "${acc?.name ?? ''}" não está conectado.`);
      const graph = graphSchema.safeParse(f.published);
      if (!graph.success) throw new Problem(409, 'O fluxo da transmissão está inválido.', 'flow-invalid');
      await q.query(
        `update ig_flow_runs set status = 'canceled', finished_at = now(), last_error = 'Nova transmissão'
          where flow_id = $1 and ig_user_id = $2 and status in ('waiting', 'running')`, [b.flowId, wa]);
      const context: RunContext = { trigger: 'wa_broadcast', lastInboundAt: null };
      const run = (await q.query<{ id: string }>(
        `insert into ig_flow_runs (tenant_id, flow_id, flow_version, channel_account_id, contact_id, ig_user_id, status, node_id, context, campaign_id)
         values (app.tenant_id(), $1, $2, $3, $4, $5, 'running', $6, $7, $8) returning id`,
        [b.flowId, f.version, acc.id, b.contactId, wa, graph.data.nodes.find((n) => n.type === 'trigger')!.id, JSON.stringify(context), b.campaignId])).rows[0]!;
      await this.event(q, b.flowId, run.id, null, 'triggered', { campaignId: b.campaignId });
      return { acc, runId: run.id };
    });
    await this.advance(tenantId, start.acc, start.runId, 'next');
    const r = await this.db.app(ctx, async (q) => (await q.query<{ status: string; last_error: string | null; message_id: string | null }>(
      `select status, last_error, context->>'lastMessageId' as message_id from ig_flow_runs where id = $1`, [start.runId])).rows[0]!);
    return r.status === 'failed' ? { id: r.message_id, status: 'failed', error: r.last_error ?? 'Falha no fluxo.' } : { id: r.message_id, status: 'sent', error: null };
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
        `select r.*, f.published, f.channel from ig_flow_runs r join ig_flows f on f.id = r.flow_id
          where r.id = $1 and r.channel_account_id = $2 for update of r`, [p.runId, acc.id])).rows[0];
      if (!run || run.status !== 'waiting' || run.wait_kind !== 'click') return null;
      const graph = graphSchema.safeParse(run.published);
      const node = graph.success ? graph.data.nodes.find((n) => n.id === run.node_id) : null;
      const btn = node && (node.type === 'text' || node.type === 'private_reply' || node.type === 'template') ? node.data.buttons.find((b) => b.id === p.buttonId) : null;
      if (!btn) return null;
      // A pessoa tocou: a conversa está aberta (e o id dela é o que tocou; no WhatsApp, o número continua o do contato).
      const context = { ...run.context, lastInboundAt: new Date().toISOString() };
      await q.query(
        `update ig_flow_runs set status = 'running', wait_kind = null, wake_at = null, ig_user_id = $2, context = $3 where id = $1`,
        [run.id, run.channel === 'instagram' && /^[0-9]{3,40}$/.test(igsid) ? igsid : run.ig_user_id, JSON.stringify(context)]);
      await this.event(q, run.flow_id, run.id, run.node_id, 'clicked', { button: btn.title });
      return { runId: run.id, handle: `btn:${btn.id}` };
    });
    if (!ok) return 'nenhum fluxo: clique repetido ou execução encerrada';
    await this.advance(tenantId, acc, ok.runId, ok.handle);
    return 'clique no botão';
  }

  /** Mensagem da pessoa que responde a uma pergunta em aberto. Falso se não havia pergunta esperando. */
  private async answer(tenantId: string, acc: IgAccount, igsid: string, text: string, ids: string[] = [igsid]): Promise<boolean> {
    const ctx = { tenantId, userId: null };
    const r = await this.db.app(ctx, async (q) => {
      const run = (await q.query<RunRow & { published: unknown }>(
        `select r.*, f.published, f.channel from ig_flow_runs r join ig_flows f on f.id = r.flow_id
          where r.channel_account_id = $1 and r.ig_user_id = any($2::text[]) and r.status = 'waiting' and r.wait_kind = 'reply'
          order by r.updated_at desc limit 1 for update of r`, [acc.id, ids])).rows[0];
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
          `select r.*, f.published, f.status as flow_status, f.channel from ig_flow_runs r join ig_flows f on f.id = r.flow_id where r.id = $1`, [runId])).rows[0];
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
        const msg = err instanceof MetaError || err instanceof StepError ? err.message : err instanceof Problem ? err.title : 'Falha inesperada neste passo.';
        if (!(err instanceof MetaError || err instanceof StepError || err instanceof Problem)) this.log.error(`passo ${node.type}: ${String(err)}`);
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
      case 'template': {
        if (run.channel !== 'whatsapp') throw new StepError('Modelo aprovado só existe no WhatsApp oficial.');
        if (!node.data.templateId) throw new StepError('Escolha o modelo aprovado.');
        const params: string[] = [];
        for (const v of node.data.params) params.push((await this.render(tenantId, run, v)) || '-');
        const buttonPayloads = node.data.buttons
          .map((b) => ({ m: TEMPLATE_BUTTON_RE.exec(b.id), b }))
          .filter((x) => x.m)
          .map((x) => ({ index: Number(x.m![1]), payload: payloadFor(run.id, x.b.id) }));
        await this.waSend(tenantId, run, { templateId: node.data.templateId, templateParams: params }, { buttonPayloads });
        await sent({ template: node.data.name });
        return node.data.buttons.length ? { wait: 'click', wakeAt: hoursFromNow(DEFAULT_WAIT_H) } : { go: 'next' };
      }
      case 'comment_reply': {
        if (run.channel === 'whatsapp') throw new StepError('Responder no comentário só existe no Instagram.');
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
        if (run.channel === 'whatsapp') throw new StepError('Responder no privado só existe no Instagram.');
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
        if (run.channel === 'whatsapp') {
          if (!node.data.fileId) throw new StepError('Escolha o arquivo do bloco de mídia.');
          await this.waSend(tenantId, run, {}, { mediaFileId: node.data.fileId });
          await sent({ file: node.data.name });
          return { go: 'next' };
        }
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
    // WhatsApp: quem confere as 24 h é o envio (pela última mensagem recebida no histórico).
    if (run.channel === 'whatsapp') return;
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

  /** Manda no direct (para a pessoa). No WhatsApp, mensagem com botões de resposta. */
  private async sendDm(tenantId: string, acc: IgAccount, run: RunRow, nodeId: string, text: string, buttons: FlowButton[]) {
    if (run.channel === 'whatsapp') {
      const pb = postbackButtons(buttons);
      const links = buttons.filter((b) => b.url && b.title.trim());
      const body = links.length ? `${text}\n\n${links.map((l) => `${l.title}: ${l.url}`).join('\n')}` : text;
      await this.waSend(tenantId, run, { text: body }, { replyButtons: pb.map((b) => ({ id: payloadFor(run.id, b.id), title: b.title })) });
      return { messageId: run.context.lastMessageId ?? '', recipientId: null };
    }
    return this.deliver(tenantId, acc, run, nodeId, { id: run.ig_user_id }, text, buttons);
  }

  /**
   * Envio pelo WhatsApp oficial (fica no histórico, com a campanha e o fluxo).
   * A mensagem livre só sai até 24 h depois da última mensagem da pessoa: fora disso, o envio recusa.
   */
  private async waSend(tenantId: string, run: RunRow, input: Omit<SendInput, 'accountId'>, extras: FlowSendExtras = {}) {
    if (!run.contact_id) throw new StepError('Sem contato para mandar a mensagem.');
    const ctx = { tenantId, userId: null };
    // O número do contato que corresponde à pessoa (com ou sem o nono dígito).
    const to = await this.db.app(ctx, async (q) => (await q.query<{ e164: string }>(
      'select e164 from contact_phones where contact_id = $1 and e164 = any($2::text[]) order by is_primary desc limit 1',
      [run.contact_id, phoneVariants(`+${run.ig_user_id}`)])).rows[0]?.e164 ?? null);
    let m: { id: string; status: string; error: string | null };
    try {
      m = await this.messages.sendByFlow(tenantId, run.flow_id, run.campaign_id, run.contact_id, { ...input, accountId: run.channel_account_id, to }, extras) as typeof m;
    } catch (err) {
      if (err instanceof Problem) throw new StepError(err.title);
      throw err;
    }
    run.context = { ...run.context, lastMessageId: m.id };
    await this.db.app(ctx, (q) => q.query(
      `update ig_flow_runs set context = context || jsonb_build_object('lastMessageId', $2::text) where id = $1`, [run.id, m.id]));
    if (m.status === 'failed') throw new StepError(m.error ?? 'O WhatsApp não aceitou a mensagem.');
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
    const first = c?.first_name?.startsWith('@') || c?.first_name?.startsWith('Instagram ') || c?.first_name?.startsWith('+') ? '' : (c?.first_name ?? '').split(/\s+/)[0] ?? '';
    const custom = Object.fromEntries(Object.entries(c?.custom ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]));
    const username = c?.username ?? run.context.username ?? null;
    return renderText(tpl, {
      ...custom, ...run.vars,
      nome: first, primeiro_nome: first, nome_completo: c?.name ?? '', usuario: username ? `@${username}` : '', comentario: run.context.text ?? '',
      ...(run.channel === 'whatsapp' ? { telefone: `+${run.ig_user_id}`, mensagem: run.context.text ?? '' } : {}),
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
      } else if ((r.kind === 'follows' || r.kind === 'not_follows') && run.channel === 'whatsapp') {
        ok = false;
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
      const wa = run.channel === 'whatsapp';
      const label = wa ? 'WhatsApp' : 'Instagram';
      const via = wa ? 'whatsapp-fluxo' : 'instagram-fluxo';
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
          const title = (await this.render(tenantId, run, op.title || `Lead do ${label} (${flow.name})`)).slice(0, 200) || `Lead do ${label}`;
          const id = (await q.query<{ id: string }>(
            `insert into leads (tenant_id, contact_id, title, source, owner_membership_id) values (app.tenant_id(), $1, $2, $3, $4) returning id`,
            [contactId, title, label, flow.created_by])).rows[0]!.id;
          await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, lead_id, data) values (app.tenant_id(), 'lead.created', $1, $2, $3)`,
            [contactId, id, JSON.stringify({ title, via, flow: flow.name })]);
          return `lead "${title}"`;
        }
        case 'create_deal': {
          const stage = (await q.query<{ id: string }>(
            `select s.id from pipeline_stages s join pipelines p on p.id = s.pipeline_id where p.id::text = $1 and s.kind = 'open' order by s.position limit 1`,
            [op.pipelineId])).rows[0];
          if (!stage) throw new StepError('O funil de negócios não existe mais.');
          const title = (await this.render(tenantId, run, op.title || `${label}: {{nome_completo}}`)).slice(0, 200) || `Negócio do ${label}`;
          const id = (await q.query<{ id: string }>(
            `insert into deals (tenant_id, pipeline_id, stage_id, title, contact_id, owner_membership_id) values (app.tenant_id(), $1, $2, $3, $4, $5) returning id`,
            [op.pipelineId, stage.id, title, contactId, flow.created_by])).rows[0]!.id;
          await q.query(`insert into timeline_entries (tenant_id, kind, contact_id, deal_id, data) values (app.tenant_id(), 'deal.created', $1, $2, $3)`,
            [contactId, id, JSON.stringify({ title, via, flow: flow.name })]);
          return `negócio "${title}"`;
        }
        case 'notify': {
          const to = op.membershipId || flow.created_by;
          if (!to) throw new StepError('Ninguém para avisar.');
          const text = await this.render(tenantId, run, op.text || (wa ? '{{nome_completo}} passou pelo fluxo' : 'Uma pessoa passou pelo fluxo {{usuario}}'));
          await q.query(
            `insert into notifications (tenant_id, membership_id, kind, title, body, link) values (app.tenant_id(), $1, ${wa ? `'whatsapp.flow'` : `'instagram.flow'`}, $2, $3, $4)`,
            [to, `Fluxo "${flow.name}"`.slice(0, 200), text.slice(0, 1000), `/contatos/${contactId}`]);
          return 'aviso para a equipe';
        }
        case 'assign': {
          await q.query(
            `insert into conversations (tenant_id, contact_id, channel, assignee_membership_id) values (app.tenant_id(), $1, $3, $2)
             on conflict (tenant_id, contact_id, channel) do update set assignee_membership_id = excluded.assignee_membership_id`,
            [contactId, op.membershipId, wa ? 'whatsapp' : 'instagram']);
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
