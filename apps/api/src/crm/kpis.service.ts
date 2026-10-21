import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { AdsService } from './ads.service.js';
import { AT, HELD, LINK } from './sales.service.js';
import { Params } from './sql.js';

export type KpiFilter = { from: string; to: string; step: number; funnelId?: string };

/** Funil de KPI: as etiquetas dizem quem é dele; só um recebe o investimento em anúncios. */
export type Funnel = { id: string; name: string; tagIds: string[]; receivesAdSpend: boolean; manualProspecting: boolean; position: number };
export type FunnelInput = { name: string; tagIds: string[]; receivesAdSpend: boolean; manualProspecting: boolean };
/** Sem funil cadastrado: a empresa toda, como antes. */
type Scope = { tags: string[]; spend: boolean; funnelId: string | null };

const FUNNEL_COLUMNS = `f.id, f.name, f.tag_ids as "tagIds", f.receives_ad_spend as "receivesAdSpend",
  f.manual_prospecting as "manualProspecting", f.position`;

type Raw = {
  b: number;
  leads: number; prospected: number; prospected_manual: number; scheduled: number; held: number; no_show: number; rescheduled: number;
  sales: number; sales_call: number; sales_follow: number; revenue: string; spend: string;
};

/**
 * KPIs do funil com o investimento em anúncios, por período (planilha) e no
 * total: leads, prospecções, reuniões agendadas e realizadas, no-show,
 * vendas, faturamento, ticket médio, custo por lead, por reunião e por venda,
 * ROAS e conversão da reunião em venda.
 *
 * - Leads: contatos novos e leads novos (uma vez por pessoa no período).
 * - Prospecções: pessoas que receberam mensagem (de alguém, campanha ou
 *   automação) ou tiveram call realizada.
 * - Reunião: ligação ou reunião na agenda (mesmas regras dos indicadores comerciais).
 * - Investimento: lançamentos divididos por igual entre os dias de cada um.
 * Empresa toda; datas no fuso da empresa.
 */
@Injectable()
export class KpisService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async summary(actor: Actor, f: KpiFilter) {
    AdsService.assertCompanyView(actor);
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const totalDays = Math.round((Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000) + 1;
      const funnels = await this.funnelList(q);
      const funnel = f.funnelId ? funnels.find((x) => x.id === f.funnelId) : funnels[0];
      if (f.funnelId && !funnel) throw Problem.notFound('Funil não encontrado.');
      const scope: Scope = funnel ? { tags: funnel.tagIds, spend: funnel.receivesAdSpend, funnelId: funnel.id } : { tags: [], spend: true, funnelId: null };
      const rows = await this.raw(q, tz, f.from, f.to, f.step, scope);
      const [total] = await this.raw(q, tz, f.from, f.to, totalDays, scope);
      const byB = new Map(rows.map((r) => [r.b, r]));
      const periods = [];
      for (let b = 0; b * f.step < totalDays; b++) {
        const start = addDays(f.from, b * f.step);
        const end = addDays(f.from, Math.min(totalDays, (b + 1) * f.step) - 1);
        periods.push({ from: start, to: end, days: Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1, ...derive(byB.get(b)) });
      }
      const byPlatform = (await q.query<{ platform: string; cents: string }>(
        `select s.platform, round(sum(s.amount_cents::numeric * (least(s.last_day, $2::date) - greatest(s.first_day, $1::date) + 1)
                 / (s.last_day - s.first_day + 1)))::text as cents
           from ad_spend s where $3 and s.first_day <= $2::date and s.last_day >= $1::date group by 1 order by 2 desc`, [f.from, f.to, scope.spend])).rows;
      return {
        period: { from: f.from, to: f.to, step: f.step, days: totalDays, timezone: tz },
        totals: { ...derive(total), spendByPlatform: byPlatform.map((p) => ({ platform: p.platform, spendCents: Number(p.cents) })) },
        periods,
        targets: { noShowRateMax: 0.2 },
        leadRule: funnel ? 'tag' : 'new-contacts',
        funnel: funnel ?? null,
        funnels,
      };
    });
  }

  private async funnelList(q: Q): Promise<Funnel[]> {
    return (await q.query<Funnel>(`select ${FUNNEL_COLUMNS} from kpi_funnels f order by f.receives_ad_spend desc, f.position, f.created_at`)).rows;
  }

  /**
   * As fontes de cada número, linha a linha: "at" (quando conta) e o registro.
   * São as mesmas para os totais e para a lista de conferência.
   */
  private sources(p: Params, tz: string, from: string, to: string, scope: Scope) {
    const tags = scope.tags;
    const d0 = `${p.add(from)}::date`;
    const d1 = `${p.add(to)}::date`;
    const tzp = `${p.add(tz)}::text`;
    const t0 = `(${d0}::timestamp at time zone ${tzp})`;
    const t1 = `((${d1} + 1)::timestamp at time zone ${tzp})`;
    const inT = (col: string) => `${col} >= ${t0} and ${col} < ${t1}`;
    const out = (kind: string, col: string) => `not exists (select 1 from kpi_exclusions x where x.kind = '${kind}' and x.record_id = ${col})`;
    const localDay = (col: string) => `((${col}) at time zone ${tzp})::date`;
    // Pessoa da call: o contato, o do lead ou o do negócio.
    const person = `coalesce(a.contact_id, (select l.contact_id from leads l where l.id = a.lead_id), (select dd.contact_id from deals dd where dd.id = a.deal_id))`;
    // Funil: a pessoa tem uma das etiquetas dele. Sem funil, todo mundo.
    const tagParam = tags.length ? p.add(tags) : null;
    const inFunnel = (col: string) => (tagParam ? `exists (select 1 from contact_tags ft where ft.contact_id = ${col} and ft.tag_id = any(${tagParam}::uuid[]))` : 'true');
    const dealPerson = `coalesce(d.contact_id, (select l.contact_id from leads l where l.id = d.lead_id))`;
    const leads = tags.length
      ? `select ct.created_at as at, ct.contact_id as id from contact_tags ct join contacts k on k.id = ct.contact_id
          where ct.tag_id = any(${tagParam}::uuid[]) and k.anonymized_at is null and ${inT('ct.created_at')} and ${out('contact', 'ct.contact_id')}`
      : `select k.created_at as at, k.id from contacts k where ${inT('k.created_at')} and k.anonymized_at is null and ${out('contact', 'k.id')}
         union all
         select l.created_at, l.contact_id from leads l where ${inT('l.created_at')} and ${out('contact', 'l.contact_id')}`;
    const prospected = `
      select m.created_at as at, m.contact_id as id from messages m
       where m.direction = 'out' and m.status <> 'failed' and ${inT('m.created_at')} and ${out('contact', 'm.contact_id')} and ${inFunnel('m.contact_id')}
      union all
      select ${AT}, ${person} from activities a
       where ${HELD} and ${inT(AT)} and ${person} is not null and ${out('activity', 'a.id')} and ${out('contact', person)} and ${inFunnel(person)}`;
    const scheduled = `select a.created_at as at, a.id from activities a
       where a.type in ('call', 'meeting') and ${inT('a.created_at')} and ${out('activity', 'a.id')} and ${inFunnel(person)}`;
    const calls = `select ${AT} as at, a.id, case when coalesce(a.outcome, 'held') = 'held' then 'held' else a.outcome end as outcome from activities a
       where a.type in ('call', 'meeting') and a.status = 'done' and ${inT(AT)} and ${out('activity', 'a.id')} and ${inFunnel(person)}`;
    // Venda: negócio ganho; "na reunião" no mesmo dia de reunião realizada, "follow-up" depois de uma.
    const heldLinked = `select 1 from activities a where ${HELD} and ${LINK} and ${out('activity', 'a.id')}`;
    const won = `select d.closed_at as at, d.id, d.value_cents,
         case when exists (${heldLinked} and ${localDay(AT)} = ${localDay('d.closed_at')}) then 'call'
              when exists (${heldLinked} and ${AT} < d.closed_at) then 'follow' else 'direct' end as how
       from deals d where d.status = 'won' and ${inT('d.closed_at')} and ${out('deal', 'd.id')} and ${inFunnel(dealPerson)}`;
    const spend = `select g.day::date as day, s.amount_cents::numeric / (s.last_day - s.first_day + 1) as cents
       from ad_spend s cross join lateral generate_series(greatest(s.first_day, ${d0}), least(s.last_day, ${d1}), interval '1 day') g(day)
       where ${scope.spend ? 'true' : 'false'} and s.first_day <= ${d1} and s.last_day >= ${d0}`;
    // Prospecção lançada à mão pelo vendedor (só no funil).
    // Função: o parâmetro do funil só entra na consulta que usa (parâmetro sem uso quebra a consulta).
    const manual = () => (scope.funnelId
      ? `select k.day, k.count, k.membership_id from kpi_prospecting k where k.funnel_id = ${p.add(scope.funnelId)}::uuid and k.day between ${d0} and ${d1}`
      : `select null::date as day, 0 as count, null::uuid as membership_id where false`);
    return { d0, tzp, localDay, leads, prospected, scheduled, calls, won, spend, manual };
  }

  private async raw(q: Q, tz: string, from: string, to: string, step: number, scope: Scope): Promise<Raw[]> {
    const p = new Params();
    const src = this.sources(p, tz, from, to, scope);
    const st = `${p.add(step)}::int`;
    const bt = (col: string) => `((${src.localDay(col)} - ${src.d0}) / ${st})`;
    const sql = `
      with k_leads as (select ${bt('x.at')} as b, count(distinct x.id)::int as n from (${src.leads}) x group by 1),
      k_prosp as (select ${bt('x.at')} as b, count(distinct x.id)::int as n from (${src.prospected}) x group by 1),
      k_sched as (select ${bt('x.at')} as b, count(*)::int as n from (${src.scheduled}) x group by 1),
      k_calls as (
        select ${bt('x.at')} as b, count(*) filter (where x.outcome = 'held')::int as held,
               count(*) filter (where x.outcome = 'no_show')::int as no_show,
               count(*) filter (where x.outcome = 'rescheduled')::int as rescheduled
          from (${src.calls}) x group by 1),
      k_won as (
        select ${bt('x.at')} as b, count(*)::int as sales, coalesce(sum(x.value_cents), 0)::text as revenue,
               count(*) filter (where x.how = 'call')::int as sales_call, count(*) filter (where x.how = 'follow')::int as sales_follow
          from (${src.won}) x group by 1),
      k_spend as (select ((x.day - ${src.d0}) / ${st}) as b, sum(x.cents) as cents from (${src.spend}) x group by 1),
      k_manual as (select ((x.day - ${src.d0}) / ${st}) as b, sum(x.count)::int as n from (${src.manual()}) x group by 1),
      keys as (select b from k_leads union select b from k_prosp union select b from k_sched union select b from k_calls
               union select b from k_won union select b from k_spend union select b from k_manual)
      select keys.b, coalesce(l.n, 0) as leads, coalesce(pr.n, 0) + coalesce(mn.n, 0) as prospected, coalesce(mn.n, 0) as prospected_manual,
             coalesce(sc.n, 0) as scheduled,
             coalesce(c.held, 0) as held, coalesce(c.no_show, 0) as no_show, coalesce(c.rescheduled, 0) as rescheduled,
             coalesce(w.sales, 0) as sales, coalesce(w.sales_call, 0) as sales_call, coalesce(w.sales_follow, 0) as sales_follow,
             coalesce(w.revenue, '0') as revenue, coalesce(round(sp.cents), 0)::text as spend
        from keys
        left join k_leads l on l.b = keys.b left join k_prosp pr on pr.b = keys.b left join k_sched sc on sc.b = keys.b
        left join k_calls c on c.b = keys.b left join k_won w on w.b = keys.b left join k_spend sp on sp.b = keys.b
        left join k_manual mn on mn.b = keys.b
       order by keys.b`;
    return (await q.query<Raw>(sql, p.values)).rows;
  }

  /**
   * Conferência: os registros que formam um número no período, com os que
   * foram tirados dos KPIs (marcados), para corrigir ou tirar da conta.
   */
  async details(actor: Actor, f: { from: string; to: string; metric: KpiMetric; funnelId?: string }) {
    AdsService.assertCompanyView(actor);
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const funnels = await this.funnelList(q);
      const funnel = f.funnelId ? funnels.find((x) => x.id === f.funnelId) : funnels[0];
      if (f.funnelId && !funnel) throw Problem.notFound('Funil não encontrado.');
      const scope: Scope = funnel ? { tags: funnel.tagIds, spend: funnel.receivesAdSpend, funnelId: funnel.id } : { tags: [], spend: true, funnelId: null };
      const p = new Params();
      const src = this.sources(p, tz, f.from, f.to, scope);
      const kind = METRIC_KIND[f.metric];
      const base = f.metric === 'leads' ? src.leads : f.metric === 'prospected' ? src.prospected : f.metric === 'scheduled' ? src.scheduled
        : f.metric === 'sales' ? src.won : src.calls;
      const filter = f.metric === 'held' || f.metric === 'no_show' || f.metric === 'rescheduled' ? `where x.outcome = ${p.add(f.metric)}` : '';
      const included = (await q.query<{ id: string; at: Date }>(
        `select x.id, min(x.at) as at from (${base}) x ${filter} group by x.id`, p.values)).rows;
      // Tirados da conta que seriam do funil (para poder voltar).
      const excluded = (await q.query<{ record_id: string }>('select record_id from kpi_exclusions where kind = $1', [kind])).rows.map((r) => r.record_id);
      const ids = [...new Set([...included.map((r) => r.id), ...excluded])];
      const when = new Map(included.map((r) => [r.id, r.at]));
      const items = await this.describe(q, kind, ids, tz, f, scope.tags);
      // Prospecção lançada à mão: por vendedor e dia.
      const manual = f.metric === 'prospected' && scope.funnelId ? (await q.query<{ day: string; count: number; name: string; membershipId: string }>(
        `select to_char(k.day, 'YYYY-MM-DD') as day, k.count, u.name, k.membership_id as "membershipId"
           from kpi_prospecting k join memberships mb on mb.id = k.membership_id join users u on u.id = mb.user_id
          where k.funnel_id = $1 and k.day between $2::date and $3::date and k.count > 0 order by k.day desc, u.name`,
        [scope.funnelId, f.from, f.to])).rows : [];
      return {
        metric: f.metric, kind, funnel: funnel ?? null, manual,
        items: items
          // Contados no período, mais os tirados da conta que cairiam nele (para poder voltar).
          .filter((i) => when.has(i.id) || (i.inPeriod && i.inFunnel && (!['held', 'no_show', 'rescheduled'].includes(f.metric)
            || ((i as { outcome?: string | null }).outcome ?? 'held') === f.metric)))
          .map(({ inFunnel: _f, ...i }) => ({ ...i, at: when.get(i.id) ?? i.at, excluded: excluded.includes(i.id) }))
          .sort((a, b) => Number(a.excluded) - Number(b.excluded) || new Date(b.at).getTime() - new Date(a.at).getTime())
          .slice(0, 1000),
      };
    });
  }

  /** Nome, data e valor de cada registro, se ele cairia no período e se é do funil (para mostrar os tirados da conta). */
  private async describe(q: Q, kind: 'contact' | 'activity' | 'deal', ids: string[], tz: string, f: { from: string; to: string }, tags: string[]) {
    type Row = { id: string; title: string; detail: string | null; at: Date; inPeriod: boolean; inFunnel: boolean; valueCents: number | null; outcome?: string | null };
    if (!ids.length) return [] as Row[];
    const range = `>= ($2::date::timestamp at time zone $4::text) and %s < (($3::date + 1)::timestamp at time zone $4::text)`;
    const fun = (col: string) => `(cardinality($5::uuid[]) = 0 or exists (select 1 from contact_tags ft where ft.contact_id = ${col} and ft.tag_id = any($5::uuid[])))`;
    const args = [ids, f.from, f.to, tz, tags];
    if (kind === 'contact') {
      return (await q.query<Row>(
        `select k.id, k.name as title,
                (select string_agg(t.name, ', ' order by t.name) from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = k.id) as detail,
                k.created_at as at, (k.created_at ${range.replace('%s', 'k.created_at')}) as "inPeriod", ${fun('k.id')} as "inFunnel", null as "valueCents"
           from contacts k where k.id = any($1::uuid[])`, args)).rows;
    }
    if (kind === 'activity') {
      const person = `coalesce(a.contact_id, (select l.contact_id from leads l where l.id = a.lead_id), (select dd.contact_id from deals dd where dd.id = a.deal_id))`;
      return (await q.query<Row>(
        `select a.id, a.title, concat_ws(' · ', (select c.name from contacts c where c.id = ${person}), (select u.name from memberships mb join users u on u.id = mb.user_id where mb.id = a.owner_membership_id)) as detail,
                ${AT} as at, (${AT} ${range.replace('%s', AT)}) as "inPeriod", ${fun(person)} as "inFunnel", null as "valueCents", a.outcome
           from activities a where a.id = any($1::uuid[])`, args)).rows;
    }
    const dealPerson = `coalesce(d.contact_id, (select l.contact_id from leads l where l.id = d.lead_id))`;
    return (await q.query<Row & { valueCents: string }>(
      `select d.id, d.title, concat_ws(' · ', (select c.name from contacts c where c.id = ${dealPerson}), (select u.name from memberships mb join users u on u.id = mb.user_id where mb.id = d.owner_membership_id)) as detail,
              coalesce(d.closed_at, d.created_at) as at, (d.status = 'won' and d.closed_at ${range.replace('%s', 'd.closed_at')}) as "inPeriod",
              ${fun(dealPerson)} as "inFunnel", d.value_cents::text as "valueCents"
         from deals d where d.id = any($1::uuid[])`, args)).rows.map((r) => ({ ...r, valueCents: Number(r.valueCents) }));
  }

  async setExcluded(actor: Actor, kind: 'contact' | 'activity' | 'deal', id: string, excluded: boolean): Promise<void> {
    AdsService.assertCompanyView(actor);
    await this.db.app(tenantCtx(actor), async (q) => {
      if (excluded) {
        const table = kind === 'contact' ? 'contacts' : kind === 'activity' ? 'activities' : 'deals';
        if (!(await q.query(`select 1 from ${table} where id = $1`, [id])).rowCount) throw Problem.notFound('Registro não encontrado.');
        await q.query(
          `insert into kpi_exclusions (tenant_id, kind, record_id, created_by) values (app.tenant_id(), $1, $2, $3) on conflict do nothing`,
          [kind, id, actor.membershipId]);
      } else {
        await q.query('delete from kpi_exclusions where kind = $1 and record_id = $2', [kind, id]);
      }
      await audit(q, actor, excluded ? 'kpi.exclude' : 'kpi.include', kind, id, {});
    });
  }

  // ---- Funis ---------------------------------------------------------------------------

  async funnels(actor: Actor) {
    return this.db.app(tenantCtx(actor), (q) => this.funnelList(q));
  }

  async saveFunnel(actor: Actor, id: string | null, b: FunnelInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const tags = [...new Set(b.tagIds)];
      const found = (await q.query('select id from tags where id = any($1::uuid[])', [tags])).rowCount ?? 0;
      if (!tags.length || found !== tags.length) throw Problem.badRequest('Confira as etiquetas.', [{ field: 'tagIds', message: 'Escolha ao menos uma etiqueta que exista.' }]);
      const name = b.name.trim();
      const dup = await q.query('select 1 from kpi_funnels where lower(name) = lower($1) and id is distinct from $2::uuid', [name, id]);
      if (dup.rowCount) throw Problem.badRequest('Nome repetido.', [{ field: 'name', message: 'Já existe um funil com este nome.' }]);
      // Só um funil recebe o investimento em anúncios: marcar este tira do outro.
      if (b.receivesAdSpend) await q.query('update kpi_funnels set receives_ad_spend = false where receives_ad_spend and id is distinct from $1::uuid', [id]);
      let fid = id;
      if (id) {
        const r = await q.query(
          `update kpi_funnels set name = $2, tag_ids = $3, receives_ad_spend = $4, manual_prospecting = $5 where id = $1`,
          [id, name, tags, b.receivesAdSpend, b.manualProspecting]);
        if (!r.rowCount) throw Problem.notFound('Funil não encontrado.');
      } else {
        fid = (await q.query<{ id: string }>(
          `insert into kpi_funnels (tenant_id, name, tag_ids, receives_ad_spend, manual_prospecting, position, created_by)
           values (app.tenant_id(), $1, $2, $3, $4, (select coalesce(max(position), -1) + 1 from kpi_funnels), $5) returning id`,
          [name, tags, b.receivesAdSpend, b.manualProspecting, actor.membershipId])).rows[0]!.id;
      }
      await audit(q, actor, id ? 'kpi.funnel_update' : 'kpi.funnel_create', 'kpi_funnel', fid, { name, tagIds: tags, receivesAdSpend: b.receivesAdSpend });
      return (await q.query<Funnel>(`select ${FUNNEL_COLUMNS} from kpi_funnels f where f.id = $1`, [fid])).rows[0]!;
    });
  }

  /** Apaga o funil e as prospecções lançadas nele. Os contatos e negócios ficam. */
  async removeFunnel(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query('delete from kpi_funnels where id = $1', [id]);
      if (!r.rowCount) throw Problem.notFound('Funil não encontrado.');
      await audit(q, actor, 'kpi.funnel_delete', 'kpi_funnel', id, {});
    });
  }

  // ---- Prospecção lançada pelo vendedor -----------------------------------------------------

  /** Funis com prospecção manual e o que a pessoa lançou nos últimos dias (hoje primeiro). */
  async myProspecting(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      const funnels = (await q.query<{ id: string; name: string }>(
        'select f.id, f.name from kpi_funnels f where f.manual_prospecting order by f.receives_ad_spend desc, f.position, f.created_at')).rows;
      const entries = (await q.query<{ funnelId: string; day: string; count: number }>(
        `select k.funnel_id as "funnelId", to_char(k.day, 'YYYY-MM-DD') as day, k.count from kpi_prospecting k
          where k.membership_id = $1 and k.day >= $2::date - 6`, [actor.membershipId, today])).rows;
      return { today, funnels: funnels.map((f) => ({ ...f, entries: entries.filter((e) => e.funnelId === f.id).map(({ day, count }) => ({ day, count })) })) };
    });
  }

  /**
   * Lança quantas prospecções foram feitas no dia. A própria pessoa lança as
   * suas (até 7 dias para trás); quem gerencia relatórios lança de qualquer um.
   */
  async setProspecting(actor: Actor, b: { funnelId: string; day: string; count: number; membershipId?: string }) {
    const who = b.membershipId ?? actor.membershipId!;
    const manager = actor.permissions.get('reports:export') === 'tenant';
    if (who !== actor.membershipId && !manager) throw Problem.forbidden('Só quem gerencia os relatórios lança a prospecção de outra pessoa.');
    return this.db.app(tenantCtx(actor), async (q) => {
      const tz = (await q.query<{ timezone: string }>('select timezone from tenants where id = app.tenant_id()')).rows[0]!.timezone;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      if (b.day > today) throw Problem.badRequest('Data no futuro.', [{ field: 'day', message: 'Lance só dias que já passaram ou hoje.' }]);
      if (!manager && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${b.day}T00:00:00Z`) > 6 * 86_400_000) {
        throw Problem.badRequest('Data antiga.', [{ field: 'day', message: 'Você pode lançar até 7 dias para trás. Peça ao gestor para mudar dias anteriores.' }]);
      }
      const f = (await q.query<{ manual_prospecting: boolean }>('select manual_prospecting from kpi_funnels where id = $1', [b.funnelId])).rows[0];
      if (!f) throw Problem.notFound('Funil não encontrado.');
      if (!f.manual_prospecting) throw Problem.badRequest('Este funil não tem prospecção lançada à mão.', [{ field: 'funnelId', message: 'Ligue "Prospecção lançada pelo vendedor" no funil.' }]);
      if (!(await q.query("select 1 from memberships where id = $1 and status = 'active'", [who])).rowCount) throw Problem.notFound('Pessoa não encontrada.');
      await q.query(
        `insert into kpi_prospecting (tenant_id, funnel_id, membership_id, day, count, updated_by) values (app.tenant_id(), $1, $2, $3, $4, $5)
         on conflict (funnel_id, membership_id, day) do update set count = excluded.count, updated_by = excluded.updated_by`,
        [b.funnelId, who, b.day, b.count, actor.membershipId]);
      return { funnelId: b.funnelId, membershipId: who, day: b.day, count: b.count };
    });
  }
}

export type KpiMetric = 'leads' | 'prospected' | 'scheduled' | 'held' | 'no_show' | 'rescheduled' | 'sales';
const METRIC_KIND: Record<KpiMetric, 'contact' | 'activity' | 'deal'> = {
  leads: 'contact', prospected: 'contact', scheduled: 'activity', held: 'activity', no_show: 'activity', rescheduled: 'activity', sales: 'deal',
};

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Números do período e os indicadores calculados a partir deles. */
function derive(r: Raw | undefined) {
  const n = (v: number | undefined) => v ?? 0;
  const spend = Number(r?.spend ?? 0), revenue = Number(r?.revenue ?? 0);
  const leads = n(r?.leads), prospected = n(r?.prospected), scheduled = n(r?.scheduled);
  const held = n(r?.held), noShow = n(r?.no_show), sales = n(r?.sales), salesOnCall = n(r?.sales_call);
  const div = (a: number, b: number) => (b ? a / b : null);
  const money = (a: number, b: number) => (b ? Math.round(a / b) : null);
  return {
    spendCents: spend,
    leads, prospected, prospectedManual: n(r?.prospected_manual), scheduled, held, noShow, rescheduled: n(r?.rescheduled),
    sales, salesOnCall, salesFollowUp: n(r?.sales_follow), revenueCents: revenue,
    noShowRate: div(noShow, held + noShow),
    scheduledPerLead: div(scheduled, leads),
    prospectedPerScheduled: div(prospected, scheduled),
    onCallConversion: div(salesOnCall, held),
    salesConversion: div(sales, held),
    meetingsPerSale: div(held, salesOnCall),
    averageTicketCents: money(revenue, sales),
    costPerLeadCents: money(spend, leads),
    costPerScheduledCents: money(spend, scheduled),
    costPerHeldCents: money(spend, held),
    costPerSaleCents: money(spend, sales),
    roas: div(revenue, spend),
  };
}
