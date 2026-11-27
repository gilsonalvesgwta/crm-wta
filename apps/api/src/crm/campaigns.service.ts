import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { CONFIG, type Config } from '../config.js';
import { OPT_OUT_HINT, type Audience, type CampaignInput, type DealGroup, type VoiceSettings } from '../domain/campaigns.js';
import { render } from '../domain/automations.js';
import { templateVariables } from '../domain/meta.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { memberJson } from './fields.js';
import { MessagesService } from './messages.service.js';
import { IgFlowEngine } from './ig-flows.engine.js';
import { graphSchema, nextNode, triggerOf } from '../domain/flows.js';
import { Params } from './sql.js';
import { VoiceService } from './voice.service.js';
import { PROVIDER_FIELDS, VoiceError, type VoiceProviderKind } from '../infra/voice.js';

type Channel = 'whatsapp' | 'email' | 'voice';
/** Consentimento e lista de supressão: ligação vale como "phone". */
const consentChannel = (c: Channel) => (c === 'voice' ? 'phone' : c);

/** Campanha com fluxo pelo WhatsApp por QR code: envios por minuto, no máximo. */
export const QR_FLOW_MAX_PER_MINUTE = 15;

const STATS = (alias: string) => `(
  select json_build_object(
    'total', count(*),
    'pending', count(*) filter (where r.status in ('pending', 'sending')),
    'sent', count(*) filter (where r.status = 'sent'),
    'failed', count(*) filter (where r.status = 'failed'),
    'skipped', count(*) filter (where r.status = 'skipped'),
    'delivered', count(*) filter (where m.status in ('delivered', 'read')),
    'read', count(*) filter (where m.status = 'read'),
    'answered', count(*) filter (where r.call_status = 'answered'),
    'pressed', count(*) filter (where coalesce(r.call_digits, '') <> ''),
    'noAnswer', count(*) filter (where r.call_status in ('no_answer', 'busy', 'failed', 'canceled')),
    'machine', count(*) filter (where r.call_status = 'machine'),
    'replied', count(*) filter (where r.sent_at is not null and exists (
      select 1 from messages i where i.contact_id = r.contact_id and i.channel = ${alias}.channel and i.direction = 'in' and i.created_at > r.sent_at)))
  from campaign_recipients r left join messages m on m.id = r.message_id where r.campaign_id = ${alias}.id)`;

const COLUMNS = `
  k.id, k.name, k.description, k.channel, k.status, k.audience, k.channel_account_id as "accountId",
  (select json_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'address', a.address, 'status', a.status)
     from channel_accounts a where a.id = k.channel_account_id) as account,
  k.subject, k.body, k.per_minute as "perMinute", to_char(k.window_start, 'HH24:MI') as "windowStart",
  to_char(k.window_end, 'HH24:MI') as "windowEnd", k.window_days as "windowDays", k.max_per_hour as "maxPerHour", k.max_per_day as "maxPerDay",
  k.pause_at as "pauseAt", k.success_tag_id as "successTagId",
  (select json_build_object('id', g.id, 'name', g.name, 'color', g.color) from tags g where g.id = k.success_tag_id) as "successTag", k.opt_out_hint as "optOutHint", k.scheduled_at as "scheduledAt",
  k.started_at as "startedAt", k.finished_at as "finishedAt", k.last_error as "lastError",
  ${memberJson('k.created_by')} as "createdBy", ${memberJson('k.started_by')} as "startedBy",
  k.created_at as "createdAt", k.updated_at as "updatedAt", ${STATS('k')} as stats,
  k.template_id as "templateId", k.template_params as "templateParams",
  (select json_build_object('id', t.id, 'name', t.name, 'language', t.language, 'body', t.body, 'header', t.header, 'headerFormat', t.header_format, 'status', t.status)
     from whatsapp_templates t where t.id = k.template_id) as template,
  k.voice_provider_id as "voiceProviderId", k.voice, k.file_id as "audioFileId",
  (select json_build_object('id', v.id, 'name', v.name, 'provider', v.provider, 'status', v.status) from voice_providers v where v.id = k.voice_provider_id) as "voiceProvider",
  (select json_build_object('id', f.id, 'name', f.original_name, 'contentType', f.content_type) from files f where f.id = k.file_id and f.deleted_at is null) as audio,
  k.flow_id as "flowId",
  (select json_build_object('id', f.id, 'name', f.name, 'status', f.status) from ig_flows f where f.id = k.flow_id) as flow,
  (select json_build_object('clicked', count(distinct e.run_id) filter (where e.kind = 'clicked'), 'completed', count(distinct e.run_id) filter (where e.kind = 'completed'),
                            'waiting', (select count(*) from ig_flow_runs w where w.campaign_id = k.id and w.status = 'waiting'))
     from ig_flow_events e join ig_flow_runs r on r.id = e.run_id where r.campaign_id = k.id) as "flowStats"`;

/** Contatos do público, com o endereço do canal e o último consentimento de marketing. */
function audienceSql(p: Params, a: Audience, channel: Channel): string {
  const conds = ['c.anonymized_at is null'];
  if (a.tagIds.length) {
    conds.push((a.tagMode ?? 'any') === 'all'
      // Todas as etiquetas escolhidas.
      ? `(select count(distinct ct.tag_id) from contact_tags ct where ct.contact_id = c.id and ct.tag_id = any(${p.add(a.tagIds)}::uuid[])) = ${p.add(new Set(a.tagIds).size)}`
      : `exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = any(${p.add(a.tagIds)}::uuid[]))`);
  }
  if (a.excludeTagIds.length) conds.push(`not exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = any(${p.add(a.excludeTagIds)}::uuid[]))`);
  if (a.ownerIds.length) conds.push(`c.owner_membership_id = any(${p.add(a.ownerIds)}::uuid[])`);
  if (a.teamIds.length) conds.push(`c.team_id = any(${p.add(a.teamIds)}::uuid[])`);
  // Negócios: inclui quem tem negócio em algum dos grupos (funil + etapas + situação) e tira quem tem em algum dos excluídos.
  const include: DealGroup[] = [...(a.deals ?? [])];
  if (a.pipelineId) include.push({ pipelineId: a.pipelineId, stageIds: a.stageId ? [a.stageId] : [], status: 'open' });
  const dealCond = (g: DealGroup) => {
    const pc = [`d.pipeline_id = ${p.add(g.pipelineId)}`];
    if (g.stageIds?.length) pc.push(`d.stage_id = any(${p.add(g.stageIds)}::uuid[])`);
    if ((g.status ?? 'open') !== 'any') pc.push(`d.status = ${p.add(g.status ?? 'open')}`);
    return `(${pc.join(' and ')})`;
  };
  if (include.length) conds.push(`exists (select 1 from deals d where d.contact_id = c.id and (${include.map(dealCond).join(' or ')}))`);
  if (a.excludeDeals?.length) conds.push(`not exists (select 1 from deals d where d.contact_id = c.id and (${a.excludeDeals.map(dealCond).join(' or ')}))`);
  if (a.sources.length) {
    conds.push(`exists (select 1 from attribution_touches t where t.contact_id = c.id and lower(t.source) = any(${p.add(a.sources.map((s) => s.toLowerCase()))}::text[]))`);
  }
  if (a.contactIds.length) conds.push(`c.id = any(${p.add(a.contactIds)}::uuid[])`);
  if (a.createdFrom) conds.push(`c.created_at >= (${p.add(a.createdFrom)}::date at time zone (select timezone from tenants where id = app.tenant_id()))`);
  if (a.createdTo) conds.push(`c.created_at < ((${p.add(a.createdTo)}::date + 1) at time zone (select timezone from tenants where id = app.tenant_id()))`);
  const ch = p.add(consentChannel(channel));
  // WhatsApp e voz: qualquer telefone do contato (celular, WhatsApp, trabalho, casa ou fixo; o tipo não importa),
  // o principal primeiro; sem telefone no contato, o da organização dele.
  const own = channel !== 'email'
    ? '(select x.e164 from contact_phones x where x.contact_id = c.id order by x.is_primary desc, x.created_at limit 1)'
    : '(select x.email from contact_emails x where x.contact_id = c.id order by x.is_primary desc, x.created_at limit 1)';
  const org = channel !== 'email'
    ? '(select o.phone from organizations o where o.id = c.organization_id)'
    : '(select o.email from organizations o where o.id = c.organization_id)';
  return `select c.id, c.name, coalesce(${own}, ${org}) as address, (${own} is null and ${org} is not null) as from_org,
            (select s.status from consents s where s.contact_id = c.id and s.channel = ${ch} and s.purpose = 'marketing'
              order by s.recorded_at desc limit 1) as consent
          from contacts c where ${conds.join(' and ')}`;
}

/** Quem do público recebe: tem endereço, não revogou, não está na supressão e (se pedido) consentiu. */
function eligibleSql(p: Params, consentOnly: boolean, channel: Channel): string {
  return `a.address is not null and coalesce(a.consent, '') <> 'revoked'
    ${consentOnly ? `and a.consent = 'granted'` : ''}
    and not exists (select 1 from suppression_list s where s.channel = ${p.add(consentChannel(channel))} and s.value = a.address)`;
}

@Injectable()
export class CampaignsService {
  private readonly log = new Logger('campanhas');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(IgFlowEngine) private readonly flows: IgFlowEngine,
    @Inject(VoiceService) private readonly voice: VoiceService,
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
                r.call_status as "callStatus", r.call_seconds as "callSeconds", r.call_digits as "callDigits", r.call_extras as "callExtras",
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
      const r = await q.query<{ total: number; eligible: number; no_address: number; revoked: number; no_consent: number; suppressed: number; sample: string[] | null;
        from_org: number; duplicates: number; missing: { id: string; name: string; twin: string | null }[] | null }>(
        `with a as (${base})
         select count(*)::int as total,
                count(*) filter (where ${ok})::int as eligible,
                count(*) filter (where a.address is null)::int as no_address,
                count(*) filter (where a.address is not null and a.consent = 'revoked')::int as revoked,
                count(*) filter (where a.address is not null and coalesce(a.consent, '') <> 'revoked' and ${a.consentOnly ? `a.consent is distinct from 'granted'` : 'false'})::int as no_consent,
                count(*) filter (where a.address is not null and exists (select 1 from suppression_list s where s.channel = ${p.add(consentChannel(channel))} and s.value = a.address))::int as suppressed,
                (array_agg(a.name order by a.name) filter (where ${ok}))[1:5] as sample,
                count(*) filter (where ${ok} and a.from_org)::int as from_org,
                count(*) filter (where a.address is null and a.twin is not null)::int as duplicates,
                (array_agg(json_build_object('id', a.id, 'name', a.name, 'twin', a.twin) order by a.twin is null, a.name) filter (where a.address is null))[1:50] as missing
           from (select a.*,
                        -- Sem telefone, mas há outro contato com o mesmo nome que tem: provável cadastro duplicado (ex.: importação).
                        case when a.address is null then (select t.id from contacts t where t.id <> a.id and t.anonymized_at is null
                            and app.norm(t.name) = app.norm(a.name)
                            and exists (select 1 from ${channel !== 'email' ? 'contact_phones' : 'contact_emails'} x where x.contact_id = t.id) limit 1) end as twin
                   from a) a`, p.values);
      const x = r.rows[0]!;
      return {
        total: x.total, eligible: x.eligible, noAddress: x.no_address, revoked: x.revoked, noConsent: x.no_consent, suppressed: x.suppressed, sample: x.sample ?? [],
        fromOrganization: x.from_org, duplicates: x.duplicates, missing: x.missing ?? [],
      };
    });
  }

  private async checkAccount(q: Q, channel: Channel, accountId: string | null | undefined) {
    if (!accountId || channel === 'voice') return;
    const a = await q.query<{ kind: string }>('select kind from channel_accounts where id = $1', [accountId]);
    if (!a.rows[0]) throw Problem.badRequest('Conta inválida.', [{ field: 'accountId', message: 'Escolha uma conta da empresa.' }]);
    if ((a.rows[0].kind === 'email_smtp') !== (channel === 'email')) {
      throw Problem.badRequest('Conta de outro canal.', [{ field: 'accountId', message: channel === 'email' ? 'Escolha uma conta de e-mail.' : 'Escolha um WhatsApp.' }]);
    }
  }

  private values(b: CampaignInput) {
    const flow = b.channel === 'whatsapp' ? b.flowId ?? null : null;
    const voice = b.channel === 'voice';
    return [b.name, b.description, b.channel, JSON.stringify(b.audience), b.accountId ?? null, b.channel === 'email' ? b.subject : null,
      b.body, b.perMinute, b.windowStart ?? null, b.windowEnd ?? null, b.optOutHint, flow ? null : b.templateId ?? null, JSON.stringify(flow ? [] : b.templateParams), flow,
      [...new Set(b.windowDays ?? [])].sort(), b.maxPerHour ?? null, b.maxPerDay ?? null, b.pauseAt ?? null, b.successTagId ?? null,
      voice ? b.voiceProviderId ?? null : null, voice ? b.audioFileId ?? null : null, JSON.stringify(voice ? b.voice : {})];
  }

  /** Fluxo de campanha: do mesmo número de WhatsApp e com gatilho "campanha" (transmissão). */
  private async checkFlow(q: Q, b: CampaignInput) {
    if (b.channel !== 'whatsapp' || !b.flowId) return;
    const f = (await q.query<{ channel: string; trigger_type: string; channel_account_id: string }>(
      'select channel, trigger_type, channel_account_id from ig_flows where id = $1', [b.flowId])).rows[0];
    if (!f || f.channel !== 'whatsapp' || f.trigger_type !== 'wa_broadcast') {
      throw Problem.badRequest('Fluxo inválido.', [{ field: 'flowId', message: 'Escolha um fluxo de transmissão do WhatsApp.' }]);
    }
    if (b.accountId && f.channel_account_id !== b.accountId) throw Problem.badRequest('Fluxo de outro número.', [{ field: 'flowId', message: 'O fluxo é de outro número de WhatsApp.' }]);
  }

  /** Voz: operadora, áudio, etiquetas das teclas e o WhatsApp do envio junto precisam ser da empresa. */
  private async checkVoice(q: Q, b: CampaignInput) {
    if (b.channel !== 'voice') return;
    if (b.accountId) throw Problem.badRequest('Conta de outro canal.', [{ field: 'accountId', message: 'Na campanha de voz, escolha a operadora.' }]);
    if (b.voiceProviderId && !(await q.query('select 1 from voice_providers where id = $1', [b.voiceProviderId])).rowCount) {
      throw Problem.badRequest('Operadora inválida.', [{ field: 'voiceProviderId', message: 'Escolha uma operadora da empresa.' }]);
    }
    if (b.audioFileId && !(await q.query(`select 1 from files where id = $1 and deleted_at is null and content_type like 'audio/%'`, [b.audioFileId])).rowCount) {
      throw Problem.badRequest('Áudio inválido.', [{ field: 'audioFileId', message: 'Escolha um áudio da biblioteca.' }]);
    }
    const tags = Object.values(b.voice.keys).map((k) => k.tagId).filter((x): x is string => !!x);
    if (tags.length && (await q.query<{ n: number }>('select count(*)::int as n from tags where id = any($1::uuid[])', [[...new Set(tags)]])).rows[0]!.n !== new Set(tags).size) {
      throw Problem.badRequest('Etiqueta inválida.', [{ field: 'voice.keys', message: 'Escolha etiquetas da empresa.' }]);
    }
    if (b.voice.whatsapp) {
      const a = (await q.query<{ kind: string }>('select kind from channel_accounts where id = $1', [b.voice.whatsapp.accountId])).rows[0];
      if (!a || !a.kind.startsWith('whatsapp')) throw Problem.badRequest('WhatsApp inválido.', [{ field: 'voice.whatsapp.accountId', message: 'Escolha um WhatsApp da empresa.' }]);
    }
  }

  async create(actor: Actor, b: CampaignInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.checkAccount(q, b.channel, b.accountId);
      await this.checkVoice(q, b);
      await this.checkFlow(q, b);
      if (b.successTagId && !(await q.query('select 1 from tags where id = $1', [b.successTagId])).rowCount) {
        throw Problem.badRequest('Etiqueta inválida.', [{ field: 'successTagId', message: 'Escolha uma etiqueta da empresa.' }]);
      }
      const r = await q.query<{ id: string }>(
        `insert into campaigns (tenant_id, name, description, channel, audience, channel_account_id, subject, body, per_minute,
                                window_start, window_end, opt_out_hint, template_id, template_params, flow_id,
                                window_days, max_per_hour, max_per_day, pause_at, success_tag_id, voice_provider_id, file_id, voice, created_by)
         values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) returning id`,
        [...this.values(b), actor.membershipId]);
      return this.row(q, r.rows[0]!.id);
    });
  }

  async update(actor: Actor, id: string, b: CampaignInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.row(q, id);
      if (cur.status !== 'draft' && cur.status !== 'scheduled') throw Problem.conflict('Só dá para editar a campanha antes de o envio começar.');
      await this.checkAccount(q, b.channel, b.accountId);
      await this.checkVoice(q, b);
      await this.checkFlow(q, b);
      if (b.successTagId && !(await q.query('select 1 from tags where id = $1', [b.successTagId])).rowCount) {
        throw Problem.badRequest('Etiqueta inválida.', [{ field: 'successTagId', message: 'Escolha uma etiqueta da empresa.' }]);
      }
      await q.query(
        `update campaigns set name = $2, description = $3, channel = $4, audience = $5, channel_account_id = $6, subject = $7, body = $8,
                per_minute = $9, window_start = $10, window_end = $11, opt_out_hint = $12, template_id = $13, template_params = $14, flow_id = $15,
                window_days = $16, max_per_hour = $17, max_per_day = $18, pause_at = $19, success_tag_id = $20,
                voice_provider_id = $21, file_id = $22, voice = $23 where id = $1`, [id, ...this.values(b)]);
      return this.row(q, id);
    });
  }

  /**
   * Ritmo e limites a qualquer momento (também durante o envio): por minuto,
   * horário, dias, limite por hora e por dia e pausa automática. O envio segue
   * de onde parou com as regras novas.
   */
  async setPace(actor: Actor, id: string, b: { perMinute: number; windowStart: string | null; windowEnd: string | null; windowDays: number[];
    maxPerHour: number | null; maxPerDay: number | null; pauseAt: string | null }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.row(q, id);
      if (cur.status === 'done' || cur.status === 'canceled') throw Problem.conflict('A campanha já terminou.');
      await q.query(
        `update campaigns set per_minute = $2, window_start = $3, window_end = $4, window_days = $5, max_per_hour = $6, max_per_day = $7, pause_at = $8,
                next_at = case when status = 'sending' then now() else next_at end where id = $1`,
        [id, b.perMinute, b.windowStart, b.windowEnd, [...new Set(b.windowDays)].sort(), b.maxPerHour, b.maxPerDay, b.pauseAt]);
      await audit(q, actor, 'campaign.pace', 'campaign', id, { perMinute: b.perMinute, maxPerHour: b.maxPerHour, maxPerDay: b.maxPerDay, pauseAt: b.pauseAt });
      return this.row(q, id);
    });
  }

  /**
   * Etiqueta de quem recebeu com sucesso: muda a qualquer momento e já marca
   * quem recebeu até agora (os próximos envios com sucesso também ganham).
   */
  async setSuccessTag(actor: Actor, id: string, tagId: string | null) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.row(q, id);
      if (tagId && !(await q.query('select 1 from tags where id = $1', [tagId])).rowCount) {
        throw Problem.badRequest('Etiqueta inválida.', [{ field: 'tagId', message: 'Escolha uma etiqueta da empresa.' }]);
      }
      await q.query('update campaigns set success_tag_id = $2 where id = $1', [id, tagId]);
      let tagged = 0;
      if (tagId) {
        tagged = (await q.query(
          `insert into contact_tags (tenant_id, contact_id, tag_id)
           select app.tenant_id(), r.contact_id, $2 from campaign_recipients r
            where r.campaign_id = $1 and r.status = 'sent' and (r.call_status is null or r.call_status = 'answered')
           on conflict do nothing`, [id, tagId])).rowCount ?? 0;
      }
      await audit(q, actor, 'campaign.success_tag', 'campaign', id, { tagId, tagged });
      return { ...(await this.row(q, id)), tagged };
    });
  }

  async duplicate(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.row(q, id);
      const r = await q.query<{ id: string }>(
        `insert into campaigns (tenant_id, name, description, channel, audience, channel_account_id, subject, body, per_minute,
                                window_start, window_end, opt_out_hint, window_days, max_per_hour, max_per_day, success_tag_id, created_by)
         select tenant_id, left(name || ' (cópia)', 120), description, channel, audience, channel_account_id, subject, body, per_minute,
                window_start, window_end, opt_out_hint, window_days, max_per_hour, max_per_day, success_tag_id, $2 from campaigns where id = $1 returning id`, [id, actor.membershipId]);
      await q.query(`update campaigns k set template_id = o.template_id, template_params = o.template_params, flow_id = o.flow_id,
                            voice_provider_id = o.voice_provider_id, file_id = o.file_id, voice = o.voice from campaigns o where k.id = $1 and o.id = $2`,
        [r.rows[0]!.id, id]);
      return this.row(q, r.rows[0]!.id);
    });
  }

  /** Exclui rascunho, agendada (ainda não começou), concluída ou cancelada. Em andamento ou pausada: cancele antes. */
  async remove(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      const cur = await this.row(q, id);
      if (cur.status === 'sending' || cur.status === 'paused') throw Problem.conflict('Cancele a campanha antes de excluir.');
      await q.query('delete from campaigns where id = $1', [id]);
      await audit(q, actor, 'campaign.delete', 'campaign', id, { name: cur.name, status: cur.status });
    });
  }

  /** Exclui várias de uma vez (limpar testes); as em andamento ou pausadas ficam e voltam na resposta. */
  async removeMany(actor: Actor, ids: string[]) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ id: string; name: string; status: string }>(
        `delete from campaigns where id = any($1::uuid[]) and status not in ('sending', 'paused') returning id, name, status`, [ids]);
      for (const x of r.rows) await audit(q, actor, 'campaign.delete', 'campaign', x.id, { name: x.name, status: x.status });
      const kept = (await q.query<{ id: string }>('select id from campaigns where id = any($1::uuid[])', [ids])).rows.map((x) => x.id);
      return { deleted: r.rowCount ?? 0, kept };
    });
  }

  /** Aprova o envio: agora ou na data marcada. Confere conta, conteúdo e público. */
  async start(actor: Actor, id: string, scheduledAt: string | null | undefined) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const k = (await q.query<{ status: string; channel: Channel; audience: Audience; channel_account_id: string | null; subject: string | null; body: string | null;
        template_id: string | null; template_params: string[]; flow_id: string | null; voice_provider_id: string | null; file_id: string | null; voice: VoiceSettings }>(
        `select status, channel, audience, channel_account_id, subject, body, template_id, template_params, flow_id, voice_provider_id, file_id, voice
           from campaigns where id = $1 for update`, [id])).rows[0];
      if (!k) throw Problem.notFound('Campanha não encontrada.');
      if (k.status !== 'draft' && k.status !== 'scheduled') throw Problem.conflict('Esta campanha já foi enviada ou cancelada.');
      const errors: { field: string; message: string }[] = [];
      if (k.channel === 'voice') await this.startVoice(q, k, errors);
      else if (!k.channel_account_id) errors.push({ field: 'accountId', message: k.channel === 'email' ? 'Escolha a conta de e-mail que envia.' : 'Escolha o WhatsApp que envia.' });
      const kind = k.channel_account_id ? (await q.query<{ kind: string }>('select kind from channel_accounts where id = $1', [k.channel_account_id])).rows[0]?.kind : null;
      if (kind === 'whatsapp_evolution' && k.flow_id) {
        // WhatsApp por QR code com fluxo: o fluxo precisa estar ativo e ser deste número (começa por qualquer mensagem).
        const f = (await q.query<{ status: string; channel_account_id: string; published: unknown; trigger_type: string }>(
          'select status, channel_account_id, published, trigger_type from ig_flows where id = $1', [k.flow_id])).rows[0];
        if (!f || f.trigger_type !== 'wa_broadcast' || f.channel_account_id !== k.channel_account_id) errors.push({ field: 'flowId', message: 'Escolha um fluxo de campanha deste número.' });
        else if (f.status !== 'active' || !graphSchema.safeParse(f.published).success) errors.push({ field: 'flowId', message: 'Publique o fluxo (e deixe ativo) antes de enviar.' });
      } else if (kind === 'whatsapp_cloud' && k.flow_id) {
        // Transmissão com fluxo: o fluxo precisa estar ativo, ser deste número e começar por um modelo aprovado.
        const f = (await q.query<{ status: string; channel_account_id: string; published: unknown; trigger_type: string }>(
          'select status, channel_account_id, published, trigger_type from ig_flows where id = $1', [k.flow_id])).rows[0];
        const g = f ? graphSchema.safeParse(f.published) : null;
        if (!f || f.trigger_type !== 'wa_broadcast' || f.channel_account_id !== k.channel_account_id) errors.push({ field: 'flowId', message: 'Escolha um fluxo de transmissão deste número.' });
        else if (f.status !== 'active' || !g?.success) errors.push({ field: 'flowId', message: 'Publique o fluxo (e deixe ativo) antes de enviar.' });
        else {
          const first = nextNode(g.data, g.data.nodes.find((n) => n.type === 'trigger')!.id, 'next');
          if (first?.type !== 'template' || !first.data.templateId || triggerOf(g.data).type !== 'wa_broadcast') errors.push({ field: 'flowId', message: 'O fluxo precisa começar por um modelo aprovado.' });
        }
      } else if (kind === 'whatsapp_cloud') {
        // WhatsApp oficial: campanha só com modelo aprovado deste número.
        const t = k.template_id ? (await q.query<{ body: string; status: string; channel_account_id: string }>(
          'select body, status, channel_account_id from whatsapp_templates where id = $1', [k.template_id])).rows[0] : null;
        if (!t || t.channel_account_id !== k.channel_account_id) errors.push({ field: 'templateId', message: 'No WhatsApp oficial, escolha um modelo deste número.' });
        else if (t.status !== 'APPROVED') errors.push({ field: 'templateId', message: 'O modelo ainda não foi aprovado pela Meta.' });
        else if ((k.template_params ?? []).filter((v) => v.trim()).length < templateVariables(t.body)) {
          errors.push({ field: 'templateParams', message: 'Preencha todas as variáveis do modelo.' });
        }
      } else if (!k.body && k.channel !== 'voice') errors.push({ field: 'body', message: 'Escreva a mensagem.' });
      if (k.channel === 'email' && !k.subject) errors.push({ field: 'subject', message: 'Escreva o assunto do e-mail.' });
      if (errors.length) throw Problem.badRequest('Falta completar a campanha.', errors);
      if (k.channel !== 'voice') {
        const acc = (await q.query<{ status: string; name: string }>('select status, name from channel_accounts where id = $1', [k.channel_account_id])).rows[0]!;
        if (k.channel === 'whatsapp' && acc.status !== 'connected') throw Problem.conflict(`O WhatsApp "${acc.name}" não está conectado.`);
      }
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

  /** Voz: operadora, áudio e, se houver, o WhatsApp conectado e uma operadora que mande SMS. */
  private async startVoice(q: Q, k: { voice_provider_id: string | null; file_id: string | null; voice: VoiceSettings }, errors: { field: string; message: string }[]) {
    const v = (k.voice_provider_id ? (await q.query<{ provider: VoiceProviderKind; name: string }>('select provider, name from voice_providers where id = $1', [k.voice_provider_id])).rows[0] : null);
    if (!v) errors.push({ field: 'voiceProviderId', message: 'Escolha a operadora que faz as ligações.' });
    if (!k.file_id || !(await q.query(`select 1 from files where id = $1 and deleted_at is null and content_type like 'audio/%'`, [k.file_id])).rowCount) {
      errors.push({ field: 'audioFileId', message: 'Escolha ou grave o áudio da ligação.' });
    }
    if (k.voice?.sms && v && !PROVIDER_FIELDS[v.provider].sms) errors.push({ field: 'voice.sms', message: `A operadora "${v.name}" não manda SMS.` });
    if (k.voice?.whatsapp) {
      const a = (await q.query<{ status: string; name: string }>('select status, name from channel_accounts where id = $1', [k.voice.whatsapp.accountId])).rows[0];
      if (!a) errors.push({ field: 'voice.whatsapp.accountId', message: 'Escolha o WhatsApp que manda a mensagem.' });
      else if (a.status !== 'connected') errors.push({ field: 'voice.whatsapp.accountId', message: `O WhatsApp "${a.name}" não está conectado.` });
    }
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
        body: string | null; per_minute: number; prepared_at: Date | null; opt_out_hint: boolean; tenant_name: string;
        template_id: string | null; template_params: string[]; flow_id: string | null; account_kind: string | null;
        max_per_hour: number | null; max_per_day: number | null; pause_at: Date | null; timezone: string; success_tag_id: string | null }>(
        `select k.status, k.channel, k.audience, k.channel_account_id, k.subject, k.body, k.per_minute, k.prepared_at, k.opt_out_hint,
                k.template_id, k.template_params, k.flow_id, t.name as tenant_name, k.max_per_hour, k.max_per_day, k.pause_at, t.timezone, k.success_tag_id,
                (select a.kind from channel_accounts a where a.id = k.channel_account_id) as account_kind
           from campaigns k join tenants t on t.id = k.tenant_id where k.id = $1`, [campaignId])).rows[0];
      if (!c || c.status !== 'sending') return null;
      // Pausa programada: para aqui; "Retomar" continua de onde parou.
      if (c.pause_at && c.pause_at.getTime() <= Date.now()) {
        await q.query(`update campaigns set status = 'paused', pause_at = null, last_error = 'Pausa programada' where id = $1`, [campaignId]);
        return null;
      }
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

    // Fluxo no WhatsApp por QR code: no máximo 15 por minuto (o WhatsApp bloqueia número que dispara rápido demais).
    if (k.flow_id && k.account_kind === 'whatsapp_evolution') k.per_minute = Math.min(k.per_minute, QR_FLOW_MAX_PER_MINUTE);
    const tick = Math.max(this.cfg.DISPATCH_INTERVAL_S, 1);
    let size = Math.max(1, Math.min(50, Math.round((k.per_minute * tick) / 60)));
    // Limite por hora e por dia (no fuso da empresa): chegou no limite, espera a próxima hora ou o próximo dia e continua de onde parou.
    if (k.max_per_hour || k.max_per_day) {
      const used = await this.db.app(ctx, async (q) => (await q.query<{ hour: number; day: number; next_hour: Date; next_day: Date }>(
        `select count(*) filter (where sent_at >= date_trunc('hour', now() at time zone $2) at time zone $2)::int as hour,
                count(*) filter (where sent_at >= date_trunc('day', now() at time zone $2) at time zone $2)::int as day,
                (date_trunc('hour', now() at time zone $2) + interval '1 hour') at time zone $2 as next_hour,
                (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2 as next_day
           from campaign_recipients where campaign_id = $1 and (status in ('sent', 'sending') or sent_at is not null)`,
        [campaignId, k.timezone])).rows[0]!);
      const leftHour = k.max_per_hour ? k.max_per_hour - used.hour : Infinity;
      const leftDay = k.max_per_day ? k.max_per_day - used.day : Infinity;
      if (leftHour <= 0 || leftDay <= 0) {
        const until = leftDay <= 0 ? used.next_day : used.next_hour;
        await this.db.app(ctx, (q) => q.query(
          `update campaigns set next_at = $2, last_error = $3 where id = $1 and status = 'sending'`,
          [campaignId, until, leftDay <= 0 ? `Limite de ${k.max_per_day} por dia atingido: continua amanhã.` : `Limite de ${k.max_per_hour} por hora atingido: continua na próxima hora.`]));
        return 0;
      }
      size = Math.max(1, Math.min(size, leftHour, leftDay));
    }
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
      if (k.channel === 'voice') {
        // Ligação: o resultado (atendeu, tecla) chega depois pelos avisos da operadora.
        try {
          await this.voice.placeForCampaign(tenantId, r.id);
          await this.db.app(ctx, (q) => q.query(`update campaign_recipients set status = 'sent', reason = null, sent_at = now() where id = $1`, [r.id]));
          sent++;
        } catch (err) {
          const msg = err instanceof VoiceError ? err.message : 'Falha inesperada na ligação.';
          // Credenciais recusadas ou operadora sumiu: pausa a campanha e devolve o contato para a fila.
          if (/credenciais|Operadora não encontrada|sem operadora/.test(msg)) {
            await this.db.app(ctx, async (q) => {
              await q.query(`update campaign_recipients set status = 'pending', call_status = null, call_ref = null where campaign_id = $1 and status = 'sending'`, [campaignId]);
              await q.query(`update campaigns set status = 'paused', last_error = $2 where id = $1`, [campaignId, msg.slice(0, 1000)]);
            });
            this.log.warn(`campanha ${campaignId} pausada: ${msg}`);
            return sent;
          }
          await this.db.app(ctx, (q) => q.query(`update campaign_recipients set status = 'failed', reason = $2, call_status = coalesce(call_status, 'failed'), call_ended_at = coalesce(call_ended_at, now()) where id = $1`, [r.id, msg.slice(0, 500)]));
        }
        continue;
      }
      const vars = { nome: r.name, primeiro_nome: r.first_name, empresa: k.tenant_name, responsavel: r.owner_name };
      const text = k.template_id ? null : render(k.body ?? '', vars) + (k.channel === 'whatsapp' && k.opt_out_hint ? OPT_OUT_HINT : '');
      try {
        const m = k.flow_id
          // Campanha com fluxo: o fluxo manda a primeira mensagem (modelo no oficial; texto com opções no QR code) e segue com a resposta.
          ? await this.flows.startBroadcast(tenantId, { campaignId, flowId: k.flow_id, contactId: r.contact_id, to: r.address })
          : await this.messages.sendByCampaign(tenantId, campaignId, r.contact_id, {
            accountId: k.channel_account_id!, to: r.address, text, subject: k.subject ? render(k.subject, vars) : null,
            templateId: k.template_id, templateParams: k.template_id ? (k.template_params ?? []).map((v) => render(v, vars) || '-') : null,
          }) as { id: string | null; status: string; error: string | null };
        await this.db.app(ctx, async (q) => {
          await q.query(
            `update campaign_recipients set status = $2, reason = $3, message_id = $4, sent_at = case when $2 = 'sent' then now() end where id = $1`,
            [r.id, m.status === 'failed' ? 'failed' : 'sent', m.status === 'failed' ? m.error : null, m.id]);
          // Etiqueta de quem recebeu com sucesso (para filtrar depois).
          if (m.status !== 'failed' && k.success_tag_id) {
            await q.query('insert into contact_tags (tenant_id, contact_id, tag_id) values (app.tenant_id(), $1, $2) on conflict do nothing', [r.contact_id, k.success_tag_id]);
          }
        });
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
      `update campaigns set next_at = now() + make_interval(secs => $2), last_error = case when last_error like 'Limite de %' then null else last_error end
        where id = $1 and status = 'sending'`, [campaignId, seconds]));
    return sent;
  }
}
