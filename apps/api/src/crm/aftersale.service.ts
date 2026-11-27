import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { ALERT_DEFAULT, CUSTOMER_DEFAULT, type AftersaleInput } from '../domain/aftersale.js';
import { render } from '../domain/automations.js';
import { normalizePhone } from '../domain/contact-data.js';
import { cleanFirstName, cleanName } from '../domain/names.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { DealsService } from './deals.service.js';
import { MessagesService } from './messages.service.js';
import { Params, likeEscape, pageOf, reachOf } from './sql.js';

/** Quantos clientes aparecem por nome num aviso; o resto vira "e mais N". */
const TOP = 8;
const GAP_MS = 1500;

type Settings = {
  enabled: boolean; first_days: number; repeat_days: number | null; max_times: number; send_at: string; pipeline_ids: string[]; since: string | null;
  notify_owner: boolean; member_ids: string[]; extra_phones: string[]; whatsapp: boolean; account_id: string | null; in_app: boolean;
  alert_text: string; customer_text: string; updated_at: Date | null;
};

type DueRow = {
  deal_id: string; title: string; value_cents: string; currency: string; closed_at: Date; pipeline: string; days: number; count: number;
  contact_id: string | null; contact: string | null; first_name: string | null; phone: string | null; owner_id: string | null; owner: string | null;
};

const DEFAULTS: Settings = {
  enabled: false, first_days: 30, repeat_days: 30, max_times: 3, send_at: '09:00', pipeline_ids: [], since: null, notify_owner: true,
  member_ids: [], extra_phones: [], whatsapp: true, account_id: null, in_app: true, alert_text: ALERT_DEFAULT, customer_text: CUSTOMER_DEFAULT, updated_at: null,
};

const money = (cents: string | number, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(cents) / 100);
const day = (d: Date, tz: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const phoneText = (e164: string | null) => {
  if (!e164) return 'sem telefone';
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
};

/**
 * Pós-venda: depois de X dias do negócio ganho, avisa a equipe (WhatsApp e/ou
 * sininho) para falar com o cliente, de Y em Y dias, até marcarem "Feito" ou
 * acabarem os lembretes. A tela lista quem está na hora de receber contato.
 */
@Injectable()
export class AftersaleService {
  private readonly log = new Logger('PosVenda');
  gapMs: number;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(DealsService) private readonly deals: DealsService,
  ) {
    this.gapMs = cfg.NODE_ENV === 'test' ? 0 : GAP_MS;
  }

  private async settingsIn(q: Q): Promise<Settings> {
    const r = await q.query<Settings>(
      `select enabled, first_days, repeat_days, max_times, to_char(send_at, 'HH24:MI') as send_at, pipeline_ids, since::text as since, notify_owner,
              member_ids, extra_phones, whatsapp, account_id, in_app, alert_text, customer_text, updated_at from aftersale_settings`);
    return r.rows[0] ?? DEFAULTS;
  }

  private view(s: Settings) {
    return {
      enabled: s.enabled, firstDays: s.first_days, repeatDays: s.repeat_days, maxTimes: s.max_times, sendAt: s.send_at, pipelineIds: s.pipeline_ids,
      since: s.since, notifyOwner: s.notify_owner, memberIds: s.member_ids, extraPhones: s.extra_phones, whatsapp: s.whatsapp, accountId: s.account_id,
      inApp: s.in_app, alertText: s.alert_text, customerText: s.customer_text, updatedAt: s.updated_at, saved: !!s.updated_at,
    };
  }

  async settings(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => this.view(await this.settingsIn(q)));
  }

  async save(actor: Actor, b: AftersaleInput) {
    const errors: { field: string; message: string }[] = [];
    const phones: string[] = [];
    b.extraPhones.forEach((raw, i) => {
      const p = normalizePhone(raw);
      if (!p) errors.push({ field: `extraPhones.${i}`, message: 'Telefone inválido.' });
      else if (!phones.includes(p)) phones.push(p);
    });
    if (b.enabled && !b.inApp && !b.whatsapp) errors.push({ field: 'whatsapp', message: 'Escolha WhatsApp, aviso no CRM ou os dois.' });
    if (b.enabled && b.whatsapp && !b.accountId) errors.push({ field: 'accountId', message: 'Escolha o WhatsApp que manda os avisos.' });
    if (b.enabled && !b.notifyOwner && !b.memberIds.length && !phones.length) errors.push({ field: 'memberIds', message: 'Escolha quem recebe os avisos.' });
    if (errors.length) throw Problem.badRequest('Confira o pós-venda.', errors);
    return this.db.app(tenantCtx(actor), async (q) => {
      if (b.accountId) {
        const a = (await q.query<{ kind: string }>('select kind from channel_accounts where id = $1', [b.accountId])).rows[0];
        if (!a?.kind.startsWith('whatsapp')) throw Problem.badRequest('WhatsApp inválido.', [{ field: 'accountId', message: 'Escolha um WhatsApp da empresa.' }]);
      }
      if (b.memberIds.length && (await q.query<{ n: number }>(`select count(*)::int as n from memberships where id = any($1::uuid[]) and status = 'active'`, [b.memberIds])).rows[0]!.n !== new Set(b.memberIds).size) {
        throw Problem.badRequest('Pessoa inválida.', [{ field: 'memberIds', message: 'Escolha pessoas ativas da equipe.' }]);
      }
      if (b.pipelineIds.length && (await q.query<{ n: number }>('select count(*)::int as n from pipelines where id = any($1::uuid[])', [b.pipelineIds])).rows[0]!.n !== new Set(b.pipelineIds).size) {
        throw Problem.badRequest('Funil inválido.', [{ field: 'pipelineIds', message: 'Escolha funis da empresa.' }]);
      }
      await q.query(
        `insert into aftersale_settings (tenant_id, enabled, first_days, repeat_days, max_times, send_at, pipeline_ids, since, notify_owner, member_ids,
                                         extra_phones, whatsapp, account_id, in_app, alert_text, customer_text, updated_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5::time, $6, $7::date, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (tenant_id) do update set enabled = excluded.enabled, first_days = excluded.first_days, repeat_days = excluded.repeat_days,
           max_times = excluded.max_times, send_at = excluded.send_at, pipeline_ids = excluded.pipeline_ids, since = excluded.since,
           notify_owner = excluded.notify_owner, member_ids = excluded.member_ids, extra_phones = excluded.extra_phones, whatsapp = excluded.whatsapp,
           account_id = excluded.account_id, in_app = excluded.in_app, alert_text = excluded.alert_text, customer_text = excluded.customer_text,
           updated_by = excluded.updated_by`,
        [b.enabled, b.firstDays, b.repeatDays, b.maxTimes, b.sendAt, [...new Set(b.pipelineIds)], b.since, b.notifyOwner, [...new Set(b.memberIds)],
          phones, b.whatsapp, b.accountId, b.inApp, b.alertText, b.customerText, actor.membershipId]);
      await audit(q, actor, 'aftersale.settings', 'tenant', actor.tenantId!, { enabled: b.enabled, firstDays: b.firstDays, repeatDays: b.repeatDays });
      return this.view(await this.settingsIn(q));
    });
  }

  /**
   * Lista do pós-venda: "Para contatar" (já passou de X dias e não foi feito),
   * "Próximos" (chegam em X dias nos próximos 30 dias) e "Feitos".
   */
  async list(actor: Actor, f: { tab: 'due' | 'upcoming' | 'done'; q?: string; page: number; pageSize: number }) {
    const r = reachOf(actor, 'deals:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const s = await this.settingsIn(q);
      const tz = (await q.query<{ timezone: string; name: string }>('select timezone, name from tenants where id = app.tenant_id()')).rows[0]!;
      const p = new Params();
      const where = [`d.status = 'won'`, `d.closed_at is not null`, this.deals.scope(p, actor, r)];
      if (s.pipeline_ids.length) where.push(`d.pipeline_id = any(${p.add(s.pipeline_ids)}::uuid[])`);
      if (s.since) where.push(`d.closed_at >= ${p.add(s.since)}::timestamp at time zone ${p.add(tz.timezone)}`);
      const first = p.add(s.first_days);
      if (f.tab === 'due') where.push('a.done_at is null', `d.closed_at <= now() - make_interval(days => ${first})`);
      else if (f.tab === 'upcoming') where.push('a.done_at is null', `d.closed_at > now() - make_interval(days => ${first})`, `d.closed_at <= now() - make_interval(days => ${first}) + interval '30 days'`);
      else where.push('a.done_at is not null', `${first}::int > 0`);
      if (f.q) where.push(`(d.title ilike ${p.add(`%${likeEscape(f.q)}%`)} or c.name ilike ${p.add(`%${likeEscape(f.q)}%`)})`);
      const { limit, offset } = pageOf(f.page, f.pageSize);
      const order = f.tab === 'done' ? 'a.done_at desc' : 'd.closed_at asc';
      const sql = `from deals d
        left join deal_aftersale a on a.deal_id = d.id
        left join contacts c on c.id = d.contact_id
        join pipelines pl on pl.id = d.pipeline_id
        where ${where.join(' and ')}`;
      const total = (await q.query<{ n: number }>(`select count(*)::int as n ${sql}`, p.values)).rows[0]!.n;
      const rows = (await q.query(
        `select d.id, d.title, d.value_cents::bigint as "valueCents", d.currency, d.closed_at as "closedAt", pl.name as pipeline,
                floor(extract(epoch from now() - d.closed_at) / 86400)::int as days,
                (d.closed_at + make_interval(days => ${first})) as "dueAt",
                coalesce(a.notified_count, 0) as "notifiedCount", a.last_notified_at as "lastNotifiedAt", a.done_at as "doneAt", a.note,
                (select u.name from memberships m join users u on u.id = m.user_id where m.id = a.done_by) as "doneBy",
                case when c.id is null then null else json_build_object('id', c.id, 'name', c.name, 'firstName', c.first_name,
                  'phone', (select ph.e164 from contact_phones ph where ph.contact_id = c.id order by ph.is_primary desc, ph.created_at limit 1)) end as contact,
                (select json_build_object('id', m.id, 'name', u.name) from memberships m join users u on u.id = m.user_id where m.id = d.owner_membership_id) as owner
           ${sql} order by ${order}, d.id limit ${p.add(limit)} offset ${p.add(offset)}`, p.values)).rows as {
        days: number; title: string; contact: { name: string; firstName: string | null } | null; owner: { name: string } | null;
      }[];
      // Mensagem pronta para o cliente, já com as variáveis.
      const items = rows.map((x) => ({
        ...x,
        message: render(s.customer_text, {
          nome: cleanName(x.contact?.name), primeiro_nome: cleanFirstName(x.contact?.firstName, x.contact?.name), negocio: x.title,
          dias: String(x.days), responsavel: (x.owner?.name ?? '').split(/\s+/)[0] ?? '', empresa: tz.name,
        }),
      }));
      return { items, total, page: f.page, pageSize: f.pageSize, configured: !!s.updated_at, enabled: s.enabled, firstDays: s.first_days };
    });
  }

  /** "Feito": para os lembretes deste cliente (com observação opcional). Desfazer volta a lembrar. */
  async setDone(actor: Actor, dealId: string, done: boolean, note: string | null) {
    const r = reachOf(actor, 'deals:view');
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const did = p.add(dealId);
      const ok = await q.query(`select d.contact_id from deals d where d.id = ${did} and d.status = 'won' and ${this.deals.scope(p, actor, r)}`, p.values);
      if (!ok.rows[0]) throw Problem.notFound('Negócio ganho não encontrado.');
      await q.query(
        `insert into deal_aftersale as x (tenant_id, deal_id, done_at, done_by, note) values (app.tenant_id(), $1, case when $2 then now() end, case when $2 then $3::uuid end, $4)
         on conflict (deal_id) do update set done_at = case when $2 then now() end, done_by = case when $2 then $3::uuid end, note = coalesce($4, x.note)`,
        [dealId, done, actor.membershipId, note]);
      await q.query(
        `insert into timeline_entries (tenant_id, kind, actor_membership_id, deal_id, contact_id, data) values (app.tenant_id(), $1, $2, $3, $4, $5)`,
        [done ? 'deal.aftersale_done' : 'deal.aftersale_reopened', actor.membershipId, dealId, ok.rows[0].contact_id, JSON.stringify({ note })]);
      return { ok: true };
    });
  }

  // ---- Despachante -------------------------------------------------------------------------------

  async dispatch(): Promise<number> {
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; deal_id: string; notified_count: number }>('select tenant_id, deal_id, notified_count from app.claim_aftersale(2000)')).rows);
    const byTenant = new Map<string, string[]>();
    for (const d of due) {
      if (!byTenant.has(d.tenant_id)) byTenant.set(d.tenant_id, []);
      byTenant.get(d.tenant_id)!.push(d.deal_id);
    }
    let sent = 0;
    for (const [tenantId, ids] of byTenant) {
      try {
        sent += await this.notifyTenant(tenantId, ids);
      } catch (err) {
        this.log.error(`pós-venda: ${String(err)}`);
      }
    }
    return sent;
  }

  /** Um aviso por pessoa (WhatsApp e/ou sininho), com todos os clientes da vez. */
  private async notifyTenant(tenantId: string, dealIds: string[]): Promise<number> {
    const ctx = { tenantId, userId: null };
    const { s, tz, rows, members } = await this.db.app(ctx, async (q) => {
      const s = await this.settingsIn(q);
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const rows = (await q.query<DueRow>(
        `select d.id as deal_id, d.title, d.value_cents::text, d.currency, d.closed_at, pl.name as pipeline,
                floor(extract(epoch from now() - d.closed_at) / 86400)::int as days, coalesce(a.notified_count, 1) as count,
                c.id as contact_id, c.name as contact, c.first_name,
                (select ph.e164 from contact_phones ph where ph.contact_id = c.id order by ph.is_primary desc, ph.created_at limit 1) as phone,
                d.owner_membership_id as owner_id, (select u.name from memberships m join users u on u.id = m.user_id where m.id = d.owner_membership_id) as owner
           from deals d join pipelines pl on pl.id = d.pipeline_id left join contacts c on c.id = d.contact_id
           left join deal_aftersale a on a.deal_id = d.id
          where d.id = any($1::uuid[]) order by d.closed_at`, [dealIds])).rows;
      const ids = [...new Set([...s.member_ids, ...(s.notify_owner ? rows.map((r) => r.owner_id).filter((x): x is string => !!x) : [])])];
      const members = (await q.query<{ id: string; phone: string | null; name: string | null }>(
        `select m.id, m.notify_phone as phone, u.name from memberships m left join users u on u.id = m.user_id where m.id = any($1::uuid[]) and m.status = 'active'`,
        [ids])).rows;
      return { s, tz, rows, members };
    });
    const byId = new Map(members.map((m) => [m.id, m]));
    // Quem recebe o quê: as pessoas fixas recebem todos; o responsável, os dele.
    const targets = new Map<string, { member: { id: string; phone: string | null; name: string | null } | null; phone: string | null; items: DueRow[] }>();
    const add = (key: string, member: { id: string; phone: string | null; name: string | null } | null, phone: string | null, row: DueRow) => {
      if (!targets.has(key)) targets.set(key, { member, phone, items: [] });
      const t = targets.get(key)!;
      if (!t.items.includes(row)) t.items.push(row);
    };
    for (const row of rows) {
      for (const id of s.member_ids) { const m = byId.get(id); if (m) add(`m:${m.id}`, m, m.phone, row); }
      if (s.notify_owner && row.owner_id) { const m = byId.get(row.owner_id); if (m) add(`m:${m.id}`, m, m.phone, row); }
      for (const ph of s.extra_phones) add(`p:${ph}`, null, ph, row);
    }

    const line = (r: DueRow) => render(s.alert_text, {
      cliente: r.contact ?? r.title, telefone: phoneText(r.phone), dias: String(r.days), negocio: r.title, valor: money(r.value_cents, r.currency),
      data_fechamento: day(r.closed_at, tz), responsavel: r.owner ?? 'sem responsável', funil: r.pipeline, vez: `${r.count}º`,
      link: `${this.cfg.APP_URL}/pos-venda`,
    });
    let sent = 0;
    const phonesDone = new Set<string>();
    if (s.whatsapp && s.account_id) {
      for (const t of targets.values()) {
        if (!t.phone || phonesDone.has(t.phone)) continue;
        phonesDone.add(t.phone);
        const list = t.items.slice(0, TOP).map(line);
        const more = t.items.length > TOP ? `\n\n… e mais ${t.items.length - TOP} cliente(s): ${this.cfg.APP_URL}/pos-venda` : '';
        try {
          if (sent > 0 && this.gapMs) await new Promise((res) => setTimeout(res, this.gapMs));
          await this.messages.sendNotice(tenantId, s.account_id, t.phone, { text: list.join('\n\n———\n\n') + more, files: [] });
          sent++;
        } catch (err) {
          this.log.error(`pós-venda por WhatsApp: ${String(err)}`);
        }
      }
    }
    await this.db.app(ctx, async (q) => {
      if (s.in_app) {
        for (const t of targets.values()) {
          if (!t.member) continue;
          const one = t.items.length === 1 ? t.items[0]! : null;
          await q.query(
            `insert into notifications (tenant_id, membership_id, kind, title, body, link) values (app.tenant_id(), $1, 'deal.aftersale', $2, $3, '/pos-venda')`,
            [t.member.id, one ? `Pós-venda: falar com ${one.contact ?? one.title}` : `Pós-venda: ${t.items.length} clientes para contatar`,
              (one ? `Fechou "${one.title}" há ${one.days} dias. ${phoneText(one.phone)}` : t.items.slice(0, 3).map((i) => `${i.contact ?? i.title} (${i.days} dias)`).join(', ')
                + (t.items.length > 3 ? ` e mais ${t.items.length - 3}.` : '.')).slice(0, 1000)]);
          sent++;
        }
      }
      if (rows.length) {
        await q.query(
          `insert into timeline_entries (tenant_id, kind, deal_id, contact_id, data)
           select app.tenant_id(), 'deal.aftersale_notified', x.id, x.contact, x.data from unnest($1::uuid[], $2::uuid[], $3::jsonb[]) as x(id, contact, data)`,
          [rows.map((r) => r.deal_id), rows.map((r) => r.contact_id), rows.map((r) => JSON.stringify({ days: r.days, count: r.count }))]);
      }
    });
    return sent;
  }
}
