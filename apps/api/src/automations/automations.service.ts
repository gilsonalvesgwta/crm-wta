import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { dealActionsAllowed, render, type Action, type Filters, type RuleInput, type Trigger } from '../domain/automations.js';
import { resolvePublicHost } from '../domain/net-guard.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { assertWithin } from '../crm/limits.js';
import { MessagesService } from '../crm/messages.service.js';
import { memberJson } from '../crm/fields.js';

type RuleRow = {
  id: string; name: string; active: boolean; trigger: Trigger; filters: Filters; actions: Action[];
  created_by: string | null; created_at: Date; updated_at: Date;
};
type RunRow = {
  id: string; rule_id: string; source_key: string; contact_id: string | null; deal_id: string | null; lead_id: string | null;
  status: string; step: number; log: LogEntry[];
};
type LogEntry = { at: string; step: number; action: string; ok: boolean; detail: string };
type Ctx = {
  tenantName: string;
  contact: { id: string; name: string; first_name: string; owner: string | null; owner_name: string | null } | null;
  deal: { id: string; title: string; pipeline_id: string; stage_id: string; stage: string; value_cents: number; currency: string; owner: string | null; owner_name: string | null } | null;
  lead: { id: string; source: string | null; owner: string | null } | null;
  event: { kind: string; data: Record<string, unknown> } | null;
};

const MESSAGE_THROTTLE_HOURS = 12;

/** Erro de uma ação: a execução para e o motivo fica registrado. */
class ActionError extends Error {}

@Injectable()
export class AutomationsService {
  private readonly log = new Logger('automacoes');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  // ---- Regras (tela) -----------------------------------------------------------

  private view(r: RuleRow & { runs_total?: number; runs_failed?: number; last_run_at?: Date | null; created_by_json?: unknown }) {
    return {
      id: r.id, name: r.name, active: r.active, trigger: r.trigger, filters: r.filters, actions: r.actions,
      createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by_json ?? null,
      stats: { total: r.runs_total ?? 0, failed: r.runs_failed ?? 0, lastRunAt: r.last_run_at ?? null },
    };
  }

  async list(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<RuleRow & { runs_total: number; runs_failed: number; last_run_at: Date | null; created_by_json: unknown }>(
        `select a.*, ${memberJson('a.created_by')} as created_by_json,
                (select count(*)::int from automation_runs x where x.rule_id = a.id and x.created_at > now() - interval '30 days') as runs_total,
                (select count(*)::int from automation_runs x where x.rule_id = a.id and x.status = 'failed' and x.created_at > now() - interval '30 days') as runs_failed,
                (select max(x.created_at) from automation_runs x where x.rule_id = a.id) as last_run_at
           from automation_rules a order by a.created_at`);
      return { items: r.rows.map((x) => this.view(x)) };
    });
  }

  /** Confere se os itens escolhidos (contas, etiquetas, etapas) são da empresa e combinam com o gatilho. */
  private async check(q: Q, input: RuleInput): Promise<void> {
    const errors: { field: string; message: string }[] = [];
    const exists = async (sql: string, id: string) => ((await q.query(sql, [id])).rowCount ?? 0) > 0;
    const t = input.trigger;
    if (t.type === 'deal.stage_changed' && t.stageId && !(await exists('select 1 from pipeline_stages where id = $1', t.stageId))) {
      errors.push({ field: 'trigger.stageId', message: 'Etapa não encontrada.' });
    }
    const f = input.filters;
    if (f.pipelineId && !(await exists('select 1 from pipelines where id = $1', f.pipelineId))) errors.push({ field: 'filters.pipelineId', message: 'Funil não encontrado.' });
    if (f.stageId && !(await exists('select 1 from pipeline_stages where id = $1', f.stageId))) errors.push({ field: 'filters.stageId', message: 'Etapa não encontrada.' });
    if (f.tagId && !(await exists('select 1 from tags where id = $1', f.tagId))) errors.push({ field: 'filters.tagId', message: 'Etiqueta não encontrada.' });
    for (const [i, a] of input.actions.entries()) {
      const field = `actions.${i}`;
      if (a.type === 'send_whatsapp' && !(await exists("select 1 from channel_accounts where id = $1 and kind = 'whatsapp_evolution'", a.accountId))) {
        errors.push({ field, message: 'Escolha um número de WhatsApp conectado.' });
      }
      if (a.type === 'send_email' && !(await exists("select 1 from channel_accounts where id = $1 and kind = 'email_smtp'", a.accountId))) {
        errors.push({ field, message: 'Escolha uma caixa de e-mail.' });
      }
      if (a.type === 'add_tag' && !(await exists('select 1 from tags where id = $1', a.tagId))) errors.push({ field, message: 'Etiqueta não encontrada.' });
      if (a.type === 'move_stage') {
        if (!dealActionsAllowed(input.trigger)) errors.push({ field, message: 'Mover etapa só vale para gatilhos de negócio.' });
        else if (!(await exists("select 1 from pipeline_stages where id = $1 and kind = 'open'", a.stageId))) errors.push({ field, message: 'Escolha uma etapa em andamento.' });
      }
      if (a.type === 'webhook' && !/^https?:\/\//.test(a.url)) errors.push({ field, message: 'Use um endereço http(s).' });
    }
    if (input.actions.every((a) => a.type === 'wait')) errors.push({ field: 'actions', message: 'Inclua uma ação além de esperar.' });
    if (errors.length) throw Problem.badRequest('Confira a automação.', errors);
  }

  private async activeCount(q: Q, exceptId?: string): Promise<number> {
    return (await q.query<{ n: number }>('select count(*)::int as n from automation_rules where active and id is distinct from $1', [exceptId ?? null])).rows[0]!.n;
  }

  async create(actor: Actor, input: RuleInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.check(q, input);
      if (input.active) await assertWithin(q, 'max_automations', (await this.activeCount(q)) + 1);
      const r = await q.query<RuleRow>(
        `insert into automation_rules (tenant_id, name, active, trigger, filters, actions, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6) returning *`,
        [input.name, input.active, JSON.stringify(input.trigger), JSON.stringify(input.filters), JSON.stringify(input.actions), actor.membershipId]);
      await audit(q, actor, 'automation.created', 'automation', r.rows[0]!.id, { name: input.name, trigger: input.trigger.type });
      return this.view(r.rows[0]!);
    });
  }

  async update(actor: Actor, id: string, input: RuleInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await q.query<{ active: boolean }>('select active from automation_rules where id = $1 for update', [id]);
      if (!cur.rows[0]) throw Problem.notFound('Automação não encontrada.');
      await this.check(q, input);
      if (input.active && !cur.rows[0].active) await assertWithin(q, 'max_automations', (await this.activeCount(q, id)) + 1);
      // Ao religar, a regra não age sobre o que aconteceu enquanto esteve desligada.
      const r = await q.query<RuleRow>(
        `update automation_rules set name = $2, active = $3, trigger = $4, filters = $5, actions = $6,
                last_event_at = case when $3 and not active then now() else last_event_at end
          where id = $1 returning *`,
        [id, input.name, input.active, JSON.stringify(input.trigger), JSON.stringify(input.filters), JSON.stringify(input.actions)]);
      await audit(q, actor, 'automation.updated', 'automation', id, { name: input.name, active: input.active });
      return this.view(r.rows[0]!);
    });
  }

  async setActive(actor: Actor, id: string, active: boolean) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await q.query<RuleRow>('select * from automation_rules where id = $1 for update', [id]);
      if (!cur.rows[0]) throw Problem.notFound('Automação não encontrada.');
      if (active && !cur.rows[0].active) await assertWithin(q, 'max_automations', (await this.activeCount(q, id)) + 1);
      const r = await q.query<RuleRow>(
        `update automation_rules set active = $2, last_event_at = case when $2 and not active then now() else last_event_at end
          where id = $1 returning *`, [id, active]);
      // Execuções esperando de uma regra desligada não continuam.
      if (!active) await q.query("update automation_runs set status = 'skipped', error = 'Automação desligada.', finished_at = now() where rule_id = $1 and status in ('pending', 'waiting')", [id]);
      await audit(q, actor, active ? 'automation.activated' : 'automation.deactivated', 'automation', id);
      return this.view(r.rows[0]!);
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ name: string }>('delete from automation_rules where id = $1 returning name', [id]);
      if (!r.rows[0]) throw Problem.notFound('Automação não encontrada.');
      await audit(q, actor, 'automation.deleted', 'automation', id, { name: r.rows[0].name });
    });
  }

  async runs(actor: Actor, ruleId?: string) {
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(
      `select r.id, r.rule_id as "ruleId", a.name as "ruleName", r.status, r.step, r.log, r.error,
              r.created_at as "createdAt", r.finished_at as "finishedAt", r.next_at as "nextAt",
              (select json_build_object('id', c.id, 'name', c.name) from contacts c where c.id = r.contact_id) as contact,
              (select json_build_object('id', d.id, 'title', d.title) from deals d where d.id = r.deal_id) as deal
         from automation_runs r join automation_rules a on a.id = r.rule_id
        where ($1::uuid is null or r.rule_id = $1)
        order by r.created_at desc limit 100`, [ruleId ?? null])).rows);
  }

  // ---- Execução (despachante) ------------------------------------------------------

  /** Eventos e agendamentos viram execuções; as vencidas são executadas. */
  async dispatch(budgetMs = 8000): Promise<{ created: number; executed: number }> {
    const started = Date.now();
    const created = await this.db.dispatch(async (q) => {
      const e = (await q.query<{ n: number }>('select app.automation_scan_events() as n')).rows[0]!.n;
      const s = (await q.query<{ n: number }>('select app.automation_scan_schedules() as n')).rows[0]!.n;
      return e + s;
    });
    let executed = 0;
    while (Date.now() - started < budgetMs) {
      const due = await this.db.dispatch(async (q) =>
        (await q.query<{ tenant_id: string; run_id: string }>('select tenant_id, run_id from app.automation_claim(20)')).rows);
      if (!due.length) break;
      for (const d of due) {
        await this.execute(d.tenant_id, d.run_id).catch((err) => this.log.error(`execução ${d.run_id}: ${String(err)}`));
        executed++;
      }
    }
    return { created, executed };
  }

  private async context(q: Q, run: RunRow): Promise<Ctx> {
    const tenantName = (await q.query<{ name: string }>('select name from tenants where id = app.tenant_id()')).rows[0]!.name;
    const deal = run.deal_id ? (await q.query<NonNullable<Ctx['deal']>>(
      `select d.id, d.title, d.pipeline_id, d.stage_id, s.name as stage, d.value_cents::int as value_cents, d.currency,
              d.owner_membership_id as owner, (select u.name from memberships m join users u on u.id = m.user_id where m.id = d.owner_membership_id) as owner_name
         from deals d join pipeline_stages s on s.id = d.stage_id where d.id = $1`, [run.deal_id])).rows[0] ?? null : null;
    let contactId = run.contact_id ?? null;
    const lead = run.lead_id ? (await q.query<NonNullable<Ctx['lead']> & { contact_id: string }>(
      'select id, source, owner_membership_id as owner, contact_id from leads where id = $1', [run.lead_id])).rows[0] ?? null : null;
    if (!contactId && lead) contactId = lead.contact_id;
    if (!contactId && run.deal_id) contactId = (await q.query<{ contact_id: string | null }>('select contact_id from deals where id = $1', [run.deal_id])).rows[0]?.contact_id ?? null;
    const contact = contactId ? (await q.query<NonNullable<Ctx['contact']>>(
      `select c.id, c.name, c.first_name, c.owner_membership_id as owner,
              (select u.name from memberships m join users u on u.id = m.user_id where m.id = c.owner_membership_id) as owner_name
         from contacts c where c.id = $1 and c.anonymized_at is null`, [contactId])).rows[0] ?? null : null;
    const evId = /^evento:([0-9a-f-]{36})$/.exec(run.source_key)?.[1];
    const event = evId ? (await q.query<{ kind: string; data: Record<string, unknown> }>('select kind, data from timeline_entries where id = $1', [evId])).rows[0] ?? null : null;
    return { tenantName, contact, deal, lead, event };
  }

  /** Motivo para não executar, ou null se os filtros da regra aceitam. */
  private async rejects(q: Q, rule: RuleRow, run: RunRow, ctx: Ctx): Promise<string | null> {
    const t = rule.trigger;
    if (t.type === 'deal.stage_changed' && t.stageId && ctx.event?.data.toStageId !== t.stageId) return 'o negócio foi para outra etapa';
    const f = rule.filters;
    if ((f.pipelineId || f.stageId) && !ctx.deal) return 'sem negócio para conferir o funil';
    if (f.pipelineId && ctx.deal!.pipeline_id !== f.pipelineId) return 'negócio de outro funil';
    if (f.stageId && ctx.deal!.stage_id !== f.stageId) return 'negócio em outra etapa';
    if (f.tagId) {
      if (!ctx.contact) return 'sem contato para conferir a etiqueta';
      const has = await q.query('select 1 from contact_tags where contact_id = $1 and tag_id = $2', [ctx.contact.id, f.tagId]);
      if (!has.rowCount) return 'contato sem a etiqueta';
    }
    if (f.source) {
      const src = ctx.lead?.source ?? (ctx.contact ? (await q.query<{ source: string | null }>(
        'select source from attribution_touches where contact_id = $1 order by occurred_at, id limit 1', [ctx.contact.id])).rows[0]?.source : null);
      if ((src ?? '').trim().toLowerCase() !== f.source.trim().toLowerCase()) return 'origem diferente';
    }
    if (t.type === 'message.received' && ctx.contact) {
      // Resposta automática a uma conversa: uma vez a cada 12 horas por contato.
      const recent = await q.query(
        `select 1 from automation_runs where rule_id = $1 and contact_id = $2 and id <> $3 and status in ('done', 'running', 'waiting')
            and created_at > now() - make_interval(hours => $4)`, [rule.id, ctx.contact.id, run.id, MESSAGE_THROTTLE_HOURS]);
      if (recent.rowCount) return `já respondeu este contato nas últimas ${MESSAGE_THROTTLE_HOURS} horas`;
    }
    return null;
  }

  private vars(ctx: Ctx): Record<string, string> {
    return {
      nome: ctx.contact?.name ?? '',
      primeiro_nome: ctx.contact?.first_name ?? '',
      empresa: ctx.tenantName,
      negocio: ctx.deal?.title ?? '',
      etapa: ctx.deal?.stage ?? '',
      valor: ctx.deal ? (ctx.deal.value_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: ctx.deal.currency || 'BRL' }) : '',
      responsavel: ctx.deal?.owner_name ?? ctx.contact?.owner_name ?? '',
    };
  }

  private async finish(tenantId: string, runId: string, status: 'done' | 'failed' | 'skipped', log: LogEntry[], error: string | null) {
    await this.db.app({ tenantId, userId: null }, (q) => q.query(
      'update automation_runs set status = $2, log = $3, error = $4, finished_at = now() where id = $1',
      [runId, status, JSON.stringify(log), error?.slice(0, 1000) ?? null]));
  }

  async execute(tenantId: string, runId: string): Promise<void> {
    const loaded = await this.db.app({ tenantId, userId: null }, async (q) => {
      const run = (await q.query<RunRow>('select * from automation_runs where id = $1', [runId])).rows[0];
      if (!run) return null;
      const rule = (await q.query<RuleRow>('select * from automation_rules where id = $1', [run.rule_id])).rows[0];
      if (!rule) return null;
      const ctx = await this.context(q, run);
      const reason = run.step === 0 && rule.active ? await this.rejects(q, rule, run, ctx) : null;
      return { run, rule, ctx, reason };
    });
    if (!loaded) return;
    const { run, rule, ctx } = loaded;
    const log: LogEntry[] = Array.isArray(run.log) ? run.log : [];
    if (!rule.active) return this.finish(tenantId, runId, 'skipped', log, 'Automação desligada.');
    if (loaded.reason) return this.finish(tenantId, runId, 'skipped', log, `Não se aplica: ${loaded.reason}.`);

    for (let i = run.step; i < rule.actions.length; i++) {
      const a = rule.actions[i]!;
      const entry = (ok: boolean, detail: string) => log.push({ at: new Date().toISOString(), step: i, action: a.type, ok, detail });
      if (a.type === 'wait') {
        entry(true, `esperando ${a.minutes} min`);
        await this.db.app({ tenantId, userId: null }, (q) => q.query(
          `update automation_runs set status = 'waiting', step = $2, next_at = now() + make_interval(mins => $3), log = $4 where id = $1`,
          [runId, i + 1, a.minutes, JSON.stringify(log)]));
        return;
      }
      try {
        entry(true, await this.perform(tenantId, rule, ctx, a));
      } catch (err) {
        const msg = err instanceof Problem || err instanceof ActionError ? err.message : `falha inesperada (${String(err).slice(0, 200)})`;
        entry(false, msg);
        if (!(err instanceof Problem || err instanceof ActionError)) this.log.error(`automação ${rule.id}: ${String(err)}`);
        return this.finish(tenantId, runId, 'failed', log, msg);
      }
      // Grava o passo feito: se o processo cair, a execução continua do próximo.
      await this.db.app({ tenantId, userId: null }, (q) => q.query(
        'update automation_runs set step = $2, log = $3 where id = $1', [runId, i + 1, JSON.stringify(log)]));
    }
    return this.finish(tenantId, runId, 'done', log, null);
  }

  private async perform(tenantId: string, rule: RuleRow, ctx: Ctx, a: Action): Promise<string> {
    const vars = this.vars(ctx);
    switch (a.type) {
      case 'send_whatsapp':
      case 'send_email': {
        if (!ctx.contact) throw new ActionError('sem contato para enviar');
        const m = await this.messages.sendByAutomation(tenantId, rule.id, ctx.contact.id, {
          accountId: a.accountId, text: render(a.text, vars), subject: a.type === 'send_email' ? render(a.subject, vars) : null,
        });
        const sent = m as { status: string; error: string | null; remote: string };
        if (sent.status === 'failed') throw new ActionError(sent.error ?? 'não enviada');
        return `${a.type === 'send_email' ? 'e-mail' : 'WhatsApp'} enviado para ${sent.remote}`;
      }
      case 'create_task':
        return this.db.app({ tenantId, userId: null }, async (q) => {
          const owner = ctx.deal?.owner ?? ctx.lead?.owner ?? ctx.contact?.owner ?? rule.created_by;
          if (!owner) throw new ActionError('ninguém para receber a tarefa (sem responsável)');
          const title = render(a.title, vars).slice(0, 200) || a.title;
          const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
          const r = await q.query<{ id: string }>(
            `insert into activities (tenant_id, type, title, description, starts_at, all_day, owner_membership_id, contact_id, deal_id, lead_id, created_by)
             values (app.tenant_id(), $1, $2, $3, ((now() at time zone $4)::date + $5::int + time '09:00') at time zone $4, false, $6, $7, $8, $9, null)
             returning id`,
            [a.activityType, title, `Criada pela automação "${rule.name}".`, tz, a.dueInDays, owner, ctx.contact?.id ?? null, ctx.deal?.id ?? null, ctx.lead?.id ?? null]);
          await q.query(
            `insert into timeline_entries (tenant_id, kind, contact_id, deal_id, lead_id, data) values (app.tenant_id(), 'activity.created', $1, $2, $3, $4)`,
            [ctx.contact?.id ?? null, ctx.deal?.id ?? null, ctx.lead?.id ?? null, JSON.stringify({ title, activityId: r.rows[0]!.id, automation: rule.id })]);
          return `tarefa "${title}" criada`;
        });
      case 'add_tag':
        if (!ctx.contact) throw new ActionError('sem contato para etiquetar');
        return this.db.app({ tenantId, userId: null }, async (q) => {
          const tag = (await q.query<{ name: string }>('select name from tags where id = $1', [a.tagId])).rows[0];
          if (!tag) throw new ActionError('a etiqueta não existe mais');
          await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2) on conflict do nothing', [ctx.contact!.id, a.tagId]);
          return `etiqueta "${tag.name}"`;
        });
      case 'move_stage':
        if (!ctx.deal) throw new ActionError('sem negócio para mover');
        return this.db.app({ tenantId, userId: null }, async (q) => {
          const to = (await q.query<{ id: string; name: string; pipeline_id: string; kind: string }>(
            'select id, name, pipeline_id, kind from pipeline_stages where id = $1', [a.stageId])).rows[0];
          if (!to || to.kind !== 'open') throw new ActionError('a etapa não existe mais ou não está em andamento');
          if (to.pipeline_id !== ctx.deal!.pipeline_id) throw new ActionError('a etapa é de outro funil');
          const cur = (await q.query<{ stage_id: string; status: string }>('select stage_id, status from deals where id = $1 for update', [ctx.deal!.id])).rows[0];
          if (!cur || cur.status !== 'open') throw new ActionError('o negócio não está em andamento');
          if (cur.stage_id === to.id) return `já estava em "${to.name}"`;
          await q.query('update deals set stage_id = $2 where id = $1', [ctx.deal!.id, to.id]);
          await q.query(
            `insert into timeline_entries (tenant_id, kind, contact_id, deal_id, data) values (app.tenant_id(), 'deal.stage_changed', $1, $2, $3)`,
            [ctx.contact?.id ?? null, ctx.deal!.id, JSON.stringify({ fromStage: ctx.deal!.stage, toStage: to.name, toStageId: to.id, pipelineId: to.pipeline_id, automation: rule.id })]);
          return `movido para "${to.name}"`;
        });
      case 'webhook': {
        const url = new URL(a.url);
        try {
          await resolvePublicHost(url.hostname, this.cfg.CHANNEL_ALLOW_PRIVATE_HOSTS);
        } catch {
          throw new ActionError('endereço do webhook interno ou inexistente');
        }
        const body = {
          event: ctx.event?.kind ?? rule.trigger.type,
          automation: { id: rule.id, name: rule.name },
          company: ctx.tenantName,
          contact: ctx.contact ? { id: ctx.contact.id, name: ctx.contact.name } : null,
          deal: ctx.deal ? { id: ctx.deal.id, title: ctx.deal.title, stage: ctx.deal.stage, value: ctx.deal.value_cents / 100 } : null,
          leadId: ctx.lead?.id ?? null,
          sentAt: new Date().toISOString(),
        };
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'CRM-WTA/1' }, body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000), redirect: 'error',
          });
        } catch {
          throw new ActionError('o endereço do webhook não respondeu');
        }
        if (!res.ok) throw new ActionError(`o webhook respondeu ${res.status}`);
        return `webhook respondeu ${res.status}`;
      }
      default:
        throw new ActionError('ação desconhecida');
    }
  }
}
