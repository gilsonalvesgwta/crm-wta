import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { contactOwnExtra } from './contacts.service.js';
import { memberJson } from './fields.js';
import { MessagesService } from './messages.service.js';
import { RecordsService } from './records.service.js';
import { Params, reachOf, reachSql, tryReach } from './sql.js';

export type ScheduleInput = { contactId: string; accountId: string; to?: string | null; subject?: string | null; text: string; sendAt: string };
export type ScheduledKind = 'message' | 'automation' | 'campaign' | 'task';
export type ScheduledFilter = {
  kind?: ScheduledKind; status: 'pending' | 'done' | 'all'; from?: string; to?: string; ownerId?: string; contactId?: string; q?: string;
  page: number; pageSize: number;
};

type Item = {
  id: string; kind: ScheduledKind; title: string; detail: string | null; channel: string | null; when: string; status: string;
  contact: { id: string; name: string } | null; owner: { id: string; name: string } | null; link: string; error: string | null;
};

const MSG = `s.id, s.channel, s.remote, s.subject, s.body, s.send_at as "sendAt", s.status, s.error, s.sent_at as "sentAt",
  s.channel_account_id as "accountId", ${memberJson('s.owner_membership_id')} as owner,
  json_build_object('id', c.id, 'name', c.name) as contact,
  (select json_build_object('id', a.id, 'name', a.name, 'kind', a.kind) from channel_accounts a where a.id = s.channel_account_id) as account`;

/**
 * Ações agendadas: mensagens agendadas por pessoas (este serviço envia) e, na
 * mesma lista, os próximos passos de automações, campanhas agendadas e tarefas.
 */
@Injectable()
export class ScheduledService {
  private readonly log = new Logger('agendadas');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(RecordsService) private readonly records: RecordsService,
  ) {}

  private async message(q: Q, actor: Actor, id: string) {
    const p = new Params();
    const r = await q.query(
      `select ${MSG} from scheduled_messages s join contacts c on c.id = s.contact_id
        where s.id = ${p.add(id)} and ${reachSql(p, 's', reachOf(actor, 'scheduled:manage'))}`, p.values);
    if (!r.rows[0]) throw Problem.notFound('Agendamento não encontrado.');
    return r.rows[0] as { id: string; status: string; channel: 'whatsapp' | 'email'; accountId: string | null; sendAt: string; subject: string | null };
  }

  private async validate(q: Q, channel: 'whatsapp' | 'email' | null, accountId: string, b: { subject?: string | null; sendAt: string }) {
    const a = (await q.query<{ kind: string; name: string }>('select kind, name from channel_accounts where id = $1', [accountId])).rows[0];
    if (!a) throw Problem.badRequest('Conta inválida.', [{ field: 'accountId', message: 'Escolha um WhatsApp ou e-mail da empresa.' }]);
    const ch = a.kind === 'email_smtp' ? 'email' : 'whatsapp';
    if (channel && ch !== channel) throw Problem.badRequest('Conta de outro canal.', [{ field: 'accountId', message: 'Escolha uma conta do mesmo canal.' }]);
    if (ch === 'email' && !b.subject?.trim()) throw Problem.badRequest('Falta o assunto.', [{ field: 'subject', message: 'Escreva o assunto do e-mail.' }]);
    if (Date.parse(b.sendAt) < Date.now() - 60_000) throw Problem.badRequest('Data no passado.', [{ field: 'sendAt', message: 'Escolha uma data e hora futuras.' }]);
    return ch;
  }

  async create(actor: Actor, b: ScheduleInput) {
    reachOf(actor, 'scheduled:manage');
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.records.assertAccess(q, actor, { kind: 'contact', id: b.contactId }, false);
      const channel = await this.validate(q, null, b.accountId, b);
      const has = channel === 'whatsapp'
        ? await q.query('select 1 from contact_phones where contact_id = $1', [b.contactId])
        : await q.query('select 1 from contact_emails where contact_id = $1', [b.contactId]);
      if (!has.rowCount) throw Problem.badRequest(channel === 'whatsapp' ? 'O contato não tem telefone.' : 'O contato não tem e-mail.', [{ field: 'accountId', message: 'O contato não tem endereço neste canal.' }]);
      const r = await q.query<{ id: string }>(
        `insert into scheduled_messages (tenant_id, contact_id, channel_account_id, channel, remote, subject, body, send_at, owner_membership_id, team_id)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [b.contactId, b.accountId, channel, b.to ?? null, channel === 'email' ? b.subject : null, b.text, b.sendAt, actor.membershipId, actor.teamIds[0] ?? null]);
      return this.message(q, actor, r.rows[0]!.id);
    });
  }

  async update(actor: Actor, id: string, b: { text?: string; subject?: string | null; sendAt?: string; accountId?: string }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.message(q, actor, id);
      if (cur.status !== 'pending') throw Problem.conflict('Só dá para mudar o que ainda não saiu.');
      const accountId = b.accountId ?? cur.accountId;
      if (!accountId) throw Problem.badRequest('Conta inválida.', [{ field: 'accountId', message: 'Escolha a conta que envia.' }]);
      await this.validate(q, cur.channel, accountId, { subject: b.subject !== undefined ? b.subject : cur.subject, sendAt: b.sendAt ?? new Date(Date.now() + 120_000).toISOString() });
      await q.query(
        `update scheduled_messages set body = coalesce($2, body), subject = case when $3::boolean then $4 else subject end,
                send_at = coalesce($5, send_at), channel_account_id = $6 where id = $1`,
        [id, b.text ?? null, b.subject !== undefined, b.subject ?? null, b.sendAt ?? null, accountId]);
      return this.message(q, actor, id);
    });
  }

  get(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), (q) => this.message(q, actor, id));
  }

  async cancel(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.message(q, actor, id);
      if (cur.status !== 'pending') throw Problem.conflict('Só dá para cancelar o que ainda não saiu.');
      await q.query(`update scheduled_messages set status = 'canceled' where id = $1`, [id]);
      return this.message(q, actor, id);
    });
  }

  /** Tudo o que está agendado, no alcance de cada permissão, mais recente primeiro dentro do filtro. */
  async list(actor: Actor, f: ScheduledFilter) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const items: Item[] = [];
      const want = (k: ScheduledKind) => !f.kind || f.kind === k;
      const range = (p: Params, col: string) => {
        const w: string[] = [];
        if (f.from) w.push(`${col} >= ${p.add(f.from)}`);
        if (f.to) w.push(`${col} < ${p.add(f.to)}`);
        return w;
      };
      const text = (p: Params, cols: string) => (f.q ? [`app.norm(${cols}) like '%' || app.norm(${p.add(f.q)}) || '%'`] : []);

      const sr = tryReach(actor, 'scheduled:manage');
      if (sr && want('message')) {
        const p = new Params();
        const w = [reachSql(p, 's', sr), 'c.anonymized_at is null', ...range(p, 's.send_at'), ...text(p, "c.name || ' ' || s.body")];
        if (f.status === 'pending') w.push(`s.status in ('pending', 'sending')`);
        if (f.status === 'done') w.push(`s.status in ('sent', 'failed', 'canceled')`);
        if (f.ownerId) w.push(`s.owner_membership_id = ${p.add(f.ownerId)}`);
        if (f.contactId) w.push(`s.contact_id = ${p.add(f.contactId)}`);
        const r = await q.query<{ id: string; channel: string; subject: string | null; body: string; sendAt: Date; status: string; error: string | null; owner: Item['owner']; contact: Item['contact'] }>(
          `select ${MSG} from scheduled_messages s join contacts c on c.id = s.contact_id where ${w.join(' and ')} order by s.send_at limit 500`, p.values);
        for (const x of r.rows) {
          items.push({ id: x.id, kind: 'message', title: x.channel === 'email' ? `E-mail: ${x.subject ?? ''}` : 'Mensagem de WhatsApp', detail: x.body.slice(0, 200),
            channel: x.channel, when: new Date(x.sendAt).toISOString(), status: x.status, contact: x.contact, owner: x.owner, link: `/contatos/${x.contact!.id}`, error: x.error });
        }
      }

      if (actor.permissions.has('automations:view') && want('automation') && f.status !== 'done' && !f.ownerId) {
        const p = new Params();
        const w = [`r.status in ('pending', 'waiting')`, ...range(p, 'r.next_at'), ...text(p, "coalesce(c.name, '') || ' ' || a.name")];
        if (f.contactId) w.push(`r.contact_id = ${p.add(f.contactId)}`);
        const r = await q.query<{ id: string; rule: string; rule_id: string; next_at: Date; status: string; contact: Item['contact']; step: number }>(
          `select r.id, a.name as rule, a.id as rule_id, r.next_at, r.status, r.step,
                  case when c.id is null then null else json_build_object('id', c.id, 'name', c.name) end as contact
             from automation_runs r join automation_rules a on a.id = r.rule_id left join contacts c on c.id = r.contact_id and c.anonymized_at is null
            where ${w.join(' and ')} order by r.next_at limit 300`, p.values);
        for (const x of r.rows) {
          items.push({ id: x.id, kind: 'automation', title: `Automação: ${x.rule}`, detail: `Próximo passo (${x.step + 1})`, channel: null,
            when: new Date(x.next_at).toISOString(), status: 'pending', contact: x.contact, owner: null, link: '/automacoes', error: null });
        }
      }

      if (actor.permissions.has('campaigns:view') && want('campaign') && !f.contactId && !f.ownerId) {
        const p = new Params();
        const w = [...range(p, 'coalesce(k.next_at, k.scheduled_at)'), ...text(p, 'k.name')];
        w.push(f.status === 'done' ? `k.status in ('done', 'canceled')` : f.status === 'pending' ? `k.status in ('scheduled', 'sending', 'paused')` : `k.status <> 'draft'`);
        const r = await q.query<{ id: string; name: string; channel: string; status: string; when: Date; total: number; sent: number }>(
          `select k.id, k.name, k.channel, k.status, coalesce(k.finished_at, k.scheduled_at, k.created_at) as when,
                  (select count(*) from campaign_recipients x where x.campaign_id = k.id)::int as total,
                  (select count(*) from campaign_recipients x where x.campaign_id = k.id and x.status = 'sent')::int as sent
             from campaigns k where ${w.join(' and ')} order by 5 limit 200`, p.values);
        for (const x of r.rows) {
          items.push({ id: x.id, kind: 'campaign', title: `Campanha: ${x.name}`, detail: x.total ? `${x.sent} de ${x.total} enviadas` : null, channel: x.channel,
            when: new Date(x.when).toISOString(), status: x.status, contact: null, owner: null, link: `/campanhas/${x.id}`, error: null });
        }
      }

      const tr = tryReach(actor, 'tasks:manage');
      if (tr && want('task')) {
        const p = new Params();
        const w = [reachSql(p, 'a', tr), 'a.starts_at is not null', ...range(p, 'a.starts_at'), ...text(p, "a.title || ' ' || coalesce(c.name, '')")];
        if (f.status === 'pending') w.push(`a.status = 'open'`);
        if (f.status === 'done') w.push(`a.status <> 'open'`);
        if (!f.from && f.status !== 'done') w.push(`a.starts_at >= now() - interval '30 days'`);
        if (f.ownerId) w.push(`a.owner_membership_id = ${p.add(f.ownerId)}`);
        if (f.contactId) w.push(`a.contact_id = ${p.add(f.contactId)}`);
        const r = await q.query<{ id: string; title: string; type: string; starts_at: Date; status: string; owner: Item['owner']; contact: Item['contact'] }>(
          `select a.id, a.title, a.type, a.starts_at, a.status, ${memberJson('a.owner_membership_id')} as owner,
                  case when c.id is null then null else json_build_object('id', c.id, 'name', c.name) end as contact
             from activities a left join contacts c on c.id = a.contact_id and c.anonymized_at is null
            where ${w.join(' and ')} order by a.starts_at limit 300`, p.values);
        for (const x of r.rows) {
          items.push({ id: x.id, kind: 'task', title: x.title, detail: null, channel: null, when: new Date(x.starts_at).toISOString(),
            status: x.status === 'open' ? (x.starts_at.getTime() < Date.now() ? 'overdue' : 'pending') : x.status,
            contact: x.contact, owner: x.owner, link: `/agenda?atividade=${x.id}`, error: null });
        }
      }

      items.sort((a, b) => (f.status === 'done' ? b.when.localeCompare(a.when) : a.when.localeCompare(b.when)));
      const start = (f.page - 1) * f.pageSize;
      const counts = { message: 0, automation: 0, campaign: 0, task: 0 } as Record<ScheduledKind, number>;
      for (const i of items) counts[i.kind]++;
      return { items: items.slice(start, start + f.pageSize), total: items.length, page: f.page, pageSize: f.pageSize, counts };
    });
  }

  // ---- Envio (despachante) ------------------------------------------------------------

  async dispatch(budgetMs = 5000): Promise<number> {
    const started = Date.now();
    let n = 0;
    while (Date.now() - started < budgetMs) {
      const due = await this.db.dispatch(async (q) =>
        (await q.query<{ tenant_id: string; scheduled_id: string }>('select tenant_id, scheduled_id from app.scheduled_claim(20)')).rows);
      if (!due.length) break;
      for (const d of due) {
        await this.sendOne(d.tenant_id, d.scheduled_id).catch((err) => this.log.error(`agendada ${d.scheduled_id}: ${String(err)}`));
        n++;
      }
    }
    return n;
  }

  private async sendOne(tenantId: string, id: string) {
    const ctx = { tenantId, userId: null };
    const s = await this.db.app(ctx, async (q) => (await q.query<{ contact_id: string; channel_account_id: string | null; remote: string | null; subject: string | null; body: string; owner_membership_id: string | null; status: string }>(
      'select contact_id, channel_account_id, remote, subject, body, owner_membership_id, status from scheduled_messages where id = $1', [id])).rows[0]);
    if (!s || s.status !== 'sending') return;
    let status = 'failed';
    let error: string | null = null;
    let messageId: string | null = null;
    if (!s.channel_account_id) error = 'A conta que enviaria foi removida.';
    else {
      try {
        const m = await this.messages.sendScheduled(tenantId, s.owner_membership_id, s.contact_id, {
          accountId: s.channel_account_id, to: s.remote, text: s.body, subject: s.subject,
        }) as { id: string; status: string; error: string | null };
        messageId = m.id;
        status = m.status === 'failed' ? 'failed' : 'sent';
        error = m.status === 'failed' ? m.error : null;
      } catch (err) {
        error = err instanceof Problem ? err.title : 'Falha inesperada no envio.';
      }
    }
    await this.db.app(ctx, (q) => q.query(
      `update scheduled_messages set status = $2, error = $3, message_id = $4, sent_at = case when $2 = 'sent' then now() end, locked_until = null where id = $1`,
      [id, status, error?.slice(0, 1000) ?? null, messageId]));
    // Avisa quem agendou se não saiu.
    if (status === 'failed' && s.owner_membership_id) {
      await this.db.app(ctx, (q) => q.query(
        `insert into notifications (tenant_id, membership_id, kind, title, body, link)
         values (app.tenant_id(), $1, 'scheduled.failed', 'Mensagem agendada não saiu', $2, $3)`,
        [s.owner_membership_id, error ?? 'Falha no envio.', `/contatos/${s.contact_id}`])).catch((e) => this.log.warn(String(e)));
    }
  }
}
