import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { OPT_OUT_HINT, type Audience, type CampaignInput } from '../domain/campaigns.js';
import { render } from '../domain/automations.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { memberJson } from './fields.js';
import { MessagesService } from './messages.service.js';
import { Params } from './sql.js';

type Channel = 'whatsapp' | 'email';

const STATS = (alias: string) => `(
  select json_build_object(
    'total', count(*),
    'pending', count(*) filter (where r.status in ('pending', 'sending')),
    'sent', count(*) filter (where r.status = 'sent'),
    'failed', count(*) filter (where r.status = 'failed'),
    'skipped', count(*) filter (where r.status = 'skipped'),
    'delivered', count(*) filter (where m.status in ('delivered', 'read')),
    'read', count(*) filter (where m.status = 'read'),
    'replied', count(*) filter (where r.sent_at is not null and exists (
      select 1 from messages i where i.contact_id = r.contact_id and i.channel = ${alias}.channel and i.direction = 'in' and i.created_at > r.sent_at)))
  from campaign_recipients r left join messages m on m.id = r.message_id where r.campaign_id = ${alias}.id)`;

const COLUMNS = `
  k.id, k.name, k.description, k.channel, k.status, k.audience, k.channel_account_id as "accountId",
  (select json_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'address', a.address, 'status', a.status)
     from channel_accounts a where a.id = k.channel_account_id) as account,
  k.subject, k.body, k.per_minute as "perMinute", to_char(k.window_start, 'HH24:MI') as "windowStart",
  to_char(k.window_end, 'HH24:MI') as "windowEnd", k.opt_out_hint as "optOutHint", k.scheduled_at as "scheduledAt",
  k.started_at as "startedAt", k.finished_at as "finishedAt", k.last_error as "lastError",
  ${memberJson('k.created_by')} as "createdBy", ${memberJson('k.started_by')} as "startedBy",
  k.created_at as "createdAt", k.updated_at as "updatedAt", ${STATS('k')} as stats`;

/** Contatos do público, com o endereço do canal e o último consentimento de marketing. */
function audienceSql(p: Params, a: Audience, channel: Channel): string {
  const conds = ['c.anonymized_at is null'];
  if (a.tagIds.length) conds.push(`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = any(${p.add(a.tagIds)}::uuid[]))`);
  if (a.excludeTagIds.length) conds.push(`not exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = any(${p.add(a.excludeTagIds)}::uuid[]))`);
  if (a.ownerIds.length) conds.push(`c.owner_membership_id = any(${p.add(a.ownerIds)}::uuid[])`);
  if (a.teamIds.length) conds.push(`c.team_id = any(${p.add(a.teamIds)}::uuid[])`);
  if (a.pipelineId || a.stageId) {
    const pc = [`d.contact_id = c.id`, `d.status = 'open'`];
    if (a.pipelineId) pc.push(`d.pipeline_id = ${p.add(a.pipelineId)}`);
    if (a.stageId) pc.push(`d.stage_id = ${p.add(a.stageId)}`);
    conds.push(`exists (select 1 from deals d where ${pc.join(' and ')})`);
  }
  if (a.sources.length) {
    conds.push(`exists (select 1 from attribution_touches t where t.contact_id = c.id and lower(t.source) = any(${p.add(a.sources.map((s) => s.toLowerCase()))}::text[]))`);
  }
  if (a.contactIds.length) conds.push(`c.id = any(${p.add(a.contactIds)}::uuid[])`);
  if (a.createdFrom) conds.push(`c.created_at >= (${p.add(a.createdFrom)}::date at time zone (select timezone from tenants where id = app.tenant_id()))`);
  if (a.createdTo) conds.push(`c.created_at < ((${p.add(a.createdTo)}::date + 1) at time zone (select timezone from tenants where id = app.tenant_id()))`);
  const ch = p.add(channel);
  const address = channel === 'whatsapp'
    ? '(select x.e164 from contact_phones x where x.contact_id = c.id order by x.is_primary desc, x.created_at limit 1)'
    : '(select x.email from contact_emails x where x.contact_id = c.id order by x.is_primary desc, x.created_at limit 1)';
  return `select c.id, c.name, ${address} as address,
            (select s.status from consents s where s.contact_id = c.id and s.channel = ${ch} and s.purpose = 'marketing'
              order by s.recorded_at desc limit 1) as consent
          from contacts c where ${conds.join(' and ')}`;
}

/** Quem do público recebe: tem endereço, não revogou, não está na supressão e (se pedido) consentiu. */
function eligibleSql(p: Params, consentOnly: boolean, channel: Channel): string {
  return `a.address is not null and coalesce(a.consent, '') <> 'revoked'
    ${consentOnly ? `and a.consent = 'granted'` : ''}
    and not exists (select 1 from suppression_list s where s.channel = ${p.add(channel)} and s.value = a.address)`;
}

@Injectable()
export class CampaignsService {
  private readonly log = new Logger('campanhas');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  private async row(q: Q, id: string) {
    const r = await q.query(`select ${COLUMNS} from campaigns k where k.id = $1`, [id]);
    if (!r.rows[0]) throw Problem.notFound('Campanha não encontrada.');
    return r.rows[0] as Record<string, unknown> & { status: string; channel: Channel };
  }

  async list(actor: Actor, f: { status?: string; q?: string }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query(
        `select ${COLUMNS} from campaigns k
          where ($1::text is null or k.status = $1) and ($2::text is null or app.norm(k.name) like '%' || app.norm($2) || '%')
          order by k.created_at desc limit 200`, [f.status ?? null, f.q ?? null]);
      return { items: r.rows };
    });
  }

  get(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), (q) => this.row(q, id));
  }

  async recipients(actor: Actor, id: string, f: { status?: string; page: number; pageSize: number }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.row(q, id);
      const r = await q.query(
        `select r.id, r.status, r.reason, r.address, r.sent_at as "sentAt", c.id as "contactId", c.name,
                m.status as "messageStatus", count(*) over ()::int as total
           from campaign_recipients r join contacts c on c.id = r.contact_id left join messages m on m.id = r.message_id
          where r.campaign_id = $1 and ($2::text is null or r.status = $2)
          order by r.sent_at desc nulls last, c.name limit $3 offset $4`,
        [id, f.status ?? null, f.pageSize, (f.page - 1) * f.pageSize]);
      return { items: r.rows.map(({ total: _t, ...x }) => x), total: (r.rows[0] as { total?: number } | undefined)?.total ?? 0, page: f.page, pageSize: f.pageSize };
    });
  }

  /** Quantos o público alcança agora, e por que alguns ficam de fora. */
  async preview(actor: Actor, channel: Channel, a: Audience) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const base = audienceSql(p, a, channel);
      const ok = eligibleSql(p, a.consentOnly, channel);
      const r = await q.query<{ total: number; eligible: number; no_address: number; revoked: number; no_consent: number; suppressed: number; sample: string[] | null }>(
        `with a as (${base})
         select count(*)::int as total,
                count(*) filter (where ${ok})::int as eligible,
                count(*) filter (where a.address is null)::int as no_address,
                count(*) filter (where a.address is not null and a.consent = 'revoked')::int as revoked,
                count(*) filter (where a.address is not null and coalesce(a.consent, '') <> 'revoked' and ${a.consentOnly ? `a.consent is distinct from 'granted'` : 'false'})::int as no_consent,
                count(*) filter (where a.address is not null and exists (select 1 from suppression_list s where s.channel = ${p.add(channel)} and s.value = a.address))::int as suppressed,
                (array_agg(a.name order by a.name) filter (where ${ok}))[1:5] as sample
           from a`, p.values);
      const x = r.rows[0]!;
      return { total: x.total, eligible: x.eligible, noAddress: x.no_address, revoked: x.revoked, noConsent: x.no_consent, suppressed: x.suppressed, sample: x.sample ?? [] };
    });
  }

  private async checkAccount(q: Q, channel: Channel, accountId: string | null | undefined) {
    if (!accountId) return;
    const a = await q.query<{ kind: string }>('select kind from channel_accounts where id = $1', [accountId]);
    if (!a.rows[0]) throw Problem.badRequest('Conta inválida.', [{ field: 'accountId', message: 'Escolha uma conta da empresa.' }]);
    if ((a.rows[0].kind === 'email_smtp') !== (channel === 'email')) {
      throw Problem.badRequest('Conta de outro canal.', [{ field: 'accountId', message: channel === 'email' ? 'Escolha uma conta de e-mail.' : 'Escolha um WhatsApp.' }]);
    }
  }

  private values(b: CampaignInput) {
    return [b.name, b.description, b.channel, JSON.stringify(b.audience), b.accountId ?? null, b.channel === 'email' ? b.subject : null,
      b.body, b.perMinute, b.windowStart ?? null, b.windowEnd ?? null, b.optOutHint];
  }

  async create(actor: Actor, b: CampaignInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.checkAccount(q, b.channel, b.accountId);
      const r = await q.query<{ id: string }>(
        `insert into campaigns (tenant_id, name, description, channel, audience, channel_account_id, subject, body, per_minute,
                                window_start, window_end, opt_out_hint, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [...this.values(b), actor.membershipId]);
      return this.row(q, r.rows[0]!.id);
    });
  }

  async update(actor: Actor, id: string, b: CampaignInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.row(q, id);
      if (cur.status !== 'draft' && cur.status !== 'scheduled') throw Problem.conflict('Só dá para editar a campanha antes de o envio começar.');
      await this.checkAccount(q, b.channel, b.accountId);
      await q.query(
        `update campaigns set name = $2, description = $3, channel = $4, audience = $5, channel_account_id = $6, subject = $7, body = $8,
                per_minute = $9, window_start = $10, window_end = $11, opt_out_hint = $12 where id = $1`, [id, ...this.values(b)]);
      return this.row(q, id);
    });
  }

  async duplicate(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.row(q, id);
      const r = await q.query<{ id: string }>(
        `insert into campaigns (tenant_id, name, description, channel, audience, channel_account_id, subject, body, per_minute,
                                window_start, window_end, opt_out_hint, created_by)
         select tenant_id, left(name || ' (cópia)', 120), description, channel, audience, channel_account_id, subject, body, per_minute,
                window_start, window_end, opt_out_hint, $2 from campaigns where id = $1 returning id`, [id, actor.membershipId]);
      return this.row(q, r.rows[0]!.id);
    });
  }

  async remove(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.row(q, id);
      if (cur.status === 'sending' || cur.status === 'paused' || cur.status === 'scheduled') {
        throw Problem.conflict('Cancele a campanha antes de excluir.');
      }
      await q.query('delete from campaigns where id = $1', [id]);
    });
  }

  /** Aprova o envio: agora ou na data marcada. Confere conta, conteúdo e público. */
  async start(actor: Actor, id: string, scheduledAt: string | null | undefined) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const k = (await q.query<{ status: string; channel: Channel; audience: Audience; channel_account_id: string | null; subject: string | null; body: string | null }>(
        'select status, channel, audience, channel_account_id, subject, body from campaigns where id = $1 for update', [id])).rows[0];
      if (!k) throw Problem.notFound('Campanha não encontrada.');
      if (k.status !== 'draft' && k.status !== 'scheduled') throw Problem.conflict('Esta campanha já foi enviada ou cancelada.');
      const errors: { field: string; message: string }[] = [];
      if (!k.channel_account_id) errors.push({ field: 'accountId', message: k.channel === 'email' ? 'Escolha a conta de e-mail que envia.' : 'Escolha o WhatsApp que envia.' });
      if (!k.body) errors.push({ field: 'body', message: 'Escreva a mensagem.' });
      if (k.channel === 'email' && !k.subject) errors.push({ field: 'subject', message: 'Escreva o assunto do e-mail.' });
      if (errors.length) throw Problem.badRequest('Falta completar a campanha.', errors);
      const acc = (await q.query<{ status: string; name: string }>('select status, name from channel_accounts where id = $1', [k.channel_account_id])).rows[0]!;
      if (k.channel === 'whatsapp' && acc.status !== 'connected') throw Problem.conflict(`O WhatsApp "${acc.name}" não está conectado.`);
      const p = new Params();
      const audience = { ...k.audience, tagIds: k.audience.tagIds ?? [], excludeTagIds: k.audience.excludeTagIds ?? [], ownerIds: k.audience.ownerIds ?? [],
        teamIds: k.audience.teamIds ?? [], sources: k.audience.sources ?? [], contactIds: k.audience.contactIds ?? [], consentOnly: !!k.audience.consentOnly };
      const n = await q.query<{ n: number }>(
        `with a as (${audienceSql(p, audience, k.channel)}) select count(*)::int as n from a where ${eligibleSql(p, audience.consentOnly, k.channel)}`, p.values);
      if (!n.rows[0]!.n) throw Problem.badRequest('Público vazio.', [{ field: 'audience', message: 'Nenhum contato do público pode receber por este canal.' }]);
      const when = scheduledAt ? new Date(scheduledAt) : new Date();
      if (scheduledAt && when.getTime() < Date.now() - 60_000) {
        throw Problem.badRequest('Data no passado.', [{ field: 'scheduledAt', message: 'Escolha uma data e hora futuras.' }]);
      }
      await q.query(
        `update campaigns set status = 'scheduled', scheduled_at = $2, started_by = $3, last_error = null where id = $1`,
        [id, when.toISOString(), actor.membershipId]);
      await audit(q, actor, 'campaign.approved', 'campaign', id, { scheduledAt: when.toISOString(), recipients: n.rows[0]!.n });
      return this.row(q, id);
    });
  }

  async setStatus(actor: Actor, id: string, action: 'pause' | 'resume' | 'cancel') {
    return this.db.app(tenantCtx(actor), async (q) => {
      const k = await this.row(q, id);
      const from: Record<typeof action, string[]> = { pause: ['sending', 'scheduled'], resume: ['paused'], cancel: ['draft', 'scheduled', 'sending', 'paused'] };
      if (!from[action].includes(k.status)) throw Problem.conflict('A campanha não está num estado que permita isso.');
      if (action === 'pause') await q.query(`update campaigns set status = 'paused' where id = $1`, [id]);
      if (action === 'resume') await q.query(`update campaigns set status = 'sending', next_at = now(), last_error = null where id = $1`, [id]);
      await audit(q, actor, `campaign.${action}`, 'campaign', id);
      if (action === 'cancel') {
        await q.query(`update campaigns set status = 'canceled', finished_at = now() where id = $1`, [id]);
        await q.query(`update campaign_recipients set status = 'skipped', reason = 'Campanha cancelada.' where campaign_id = $1 and status = 'pending'`, [id]);
      }
      return this.row(q, id);
    });
  }

  // ---- Envio (despachante) ------------------------------------------------------------

  async dispatch(budgetMs = 8000): Promise<{ sent: number }> {
    const started = Date.now();
    let sent = 0;
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; campaign_id: string }>('select tenant_id, campaign_id from app.campaign_claim(10)')).rows);
    for (const d of due) {
      if (Date.now() - started > budgetMs) {
        // Sem tempo: devolve a vez para a próxima rodada.
        await this.db.app({ tenantId: d.tenant_id, userId: null }, (q) => q.query('update campaigns set next_at = now() where id = $1', [d.campaign_id]));
        continue;
      }
      sent += await this.batch(d.tenant_id, d.campaign_id).catch((err) => {
        this.log.error(`campanha ${d.campaign_id}: ${String(err)}`);
        return 0;
      });
    }
    return { sent };
  }

  /** Um lote da campanha: monta o público na primeira vez e envia algumas mensagens no ritmo escolhido. */
  private async batch(tenantId: string, campaignId: string): Promise<number> {
    const ctx = { tenantId, userId: null };
    const k = await this.db.app(ctx, async (q) => {
      const c = (await q.query<{ status: string; channel: Channel; audience: Audience; channel_account_id: string | null; subject: string | null;
        body: string | null; per_minute: number; prepared_at: Date | null; opt_out_hint: boolean; tenant_name: string }>(
        `select k.status, k.channel, k.audience, k.channel_account_id, k.subject, k.body, k.per_minute, k.prepared_at, k.opt_out_hint,
                t.name as tenant_name from campaigns k join tenants t on t.id = k.tenant_id where k.id = $1`, [campaignId])).rows[0];
      if (!c || c.status !== 'sending') return null;
      if (!c.prepared_at) {
        const p = new Params();
        const a = { ...c.audience, tagIds: c.audience.tagIds ?? [], excludeTagIds: c.audience.excludeTagIds ?? [], ownerIds: c.audience.ownerIds ?? [],
          teamIds: c.audience.teamIds ?? [], sources: c.audience.sources ?? [], contactIds: c.audience.contactIds ?? [], consentOnly: !!c.audience.consentOnly };
        const cid = p.add(campaignId);
        const r = await q.query(
          `with a as (${audienceSql(p, a, c.channel)})
           insert into campaign_recipients (tenant_id, campaign_id, contact_id, address)
           select app.tenant_id(), ${cid}, a.id, a.address from a where ${eligibleSql(p, a.consentOnly, c.channel)}
           on conflict (campaign_id, contact_id) do nothing`, p.values);
        await q.query('update campaigns set prepared_at = now() where id = $1', [campaignId]);
        this.log.log(`campanha ${campaignId}: ${r.rowCount ?? 0} destinatário(s)`);
      }
      return c;
    });
    if (!k) return 0;

    const tick = Math.max(this.cfg.DISPATCH_INTERVAL_S, 1);
    const size = Math.max(1, Math.min(50, Math.round((k.per_minute * tick) / 60)));
    const picked = await this.db.app(ctx, async (q) => (await q.query<{ id: string; contact_id: string; address: string; name: string; first_name: string; owner_name: string | null }>(
      `update campaign_recipients r set status = 'sending'
        from contacts c
       where r.id in (select id from campaign_recipients where campaign_id = $1 and status = 'pending' order by created_at, id limit $2 for update skip locked)
         and c.id = r.contact_id
       returning r.id, r.contact_id, r.address, c.name, c.first_name,
                 (select u.name from memberships m join users u on u.id = m.user_id where m.id = c.owner_membership_id) as owner_name`,
      [campaignId, size])).rows);

    if (!picked.length) {
      await this.db.app(ctx, (q) => q.query(
        `update campaigns set status = 'done', finished_at = now(), next_at = null
          where id = $1 and status = 'sending' and not exists (select 1 from campaign_recipients where campaign_id = $1 and status in ('pending', 'sending'))`,
        [campaignId]));
      return 0;
    }

    let sent = 0;
    for (const r of picked) {
      const vars = { nome: r.name, primeiro_nome: r.first_name, empresa: k.tenant_name, responsavel: r.owner_name };
      const text = render(k.body ?? '', vars) + (k.channel === 'whatsapp' && k.opt_out_hint ? OPT_OUT_HINT : '');
      try {
        const m = await this.messages.sendByCampaign(tenantId, campaignId, r.contact_id, {
          accountId: k.channel_account_id!, to: r.address, text, subject: k.subject ? render(k.subject, vars) : null,
        }) as { id: string; status: string; error: string | null };
        await this.db.app(ctx, (q) => q.query(
          `update campaign_recipients set status = $2, reason = $3, message_id = $4, sent_at = case when $2 = 'sent' then now() end where id = $1`,
          [r.id, m.status === 'failed' ? 'failed' : 'sent', m.status === 'failed' ? m.error : null, m.id]));
        if (m.status !== 'failed') sent++;
      } catch (err) {
        const p = err instanceof Problem ? err : null;
        const msg = p?.title ?? 'Falha inesperada no envio.';
        // Conta desconectada ou com erro: pausa a campanha e devolve o contato para a fila.
        if (p && p.status === 409 && /conectad|com erro/.test(msg)) {
          await this.db.app(ctx, async (q) => {
            await q.query(`update campaign_recipients set status = 'pending' where campaign_id = $1 and status = 'sending'`, [campaignId]);
            await q.query(`update campaigns set status = 'paused', last_error = $2 where id = $1`, [campaignId, msg]);
          });
          this.log.warn(`campanha ${campaignId} pausada: ${msg}`);
          return sent;
        }
        await this.db.app(ctx, (q) => q.query(`update campaign_recipients set status = 'skipped', reason = $2 where id = $1`, [r.id, msg.slice(0, 500)]));
      }
    }
    // Próximo lote no ritmo escolhido, com uma pequena variação para não parecer robô.
    const seconds = (picked.length * 60) / k.per_minute * (1 + Math.random() * 0.3);
    await this.db.app(ctx, (q) => q.query(
      `update campaigns set next_at = now() + make_interval(secs => $2) where id = $1 and status = 'sending'`, [campaignId, seconds]));
    return sent;
  }
}
