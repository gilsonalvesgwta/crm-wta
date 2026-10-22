'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { AlarmClock, ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useQueryState } from '@/lib/use-query-state';
import { SalesDashboard } from '@/components/crm/sales-dashboard';
import { KpiDashboard } from '@/components/crm/kpi-dashboard';
import { MyProspectingCard } from '@/components/crm/prospecting';
import { OperationDashboard } from '@/components/crm/operation-dashboard';
import { money, statusBody, type Activity } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory, usePipelines } from '@/components/crm/data';
import { ActivityRow } from '@/components/crm/record-panels';
import { Panel } from '@/components/ui/panel';
import { Alert } from '@/components/ui/alert';
import { Empty, LoadError, Loading } from '@/components/ui/states';

const ADMIN_PERMS = ['users:admin', 'settings:admin', 'integrations:admin', 'channels:admin'];

type Summary = {
  deals?: {
    openCount: number; openValueCents: number; weightedValueCents: number; wonCount: number; wonValueCents: number; lostCount: number;
    createdCount: number; stalledCount: number; winRate: number | null; averageWonCents: number | null;
    byStage: { id: string; name: string; color: string; count: number; valueCents: number }[]; lostReasons: { name: string; count: number }[];
  };
  leads?: { created: number; qualified: number; active: number; unassigned: number; conversionRate: number | null; bySource: { source: string; count: number; qualified: number }[] };
  activities?: { overdue: number; today: number; undated: number };
  contacts?: { created: number; total: number };
};

function period(kind: string): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (kind === '30d') return { from: new Date(now.getTime() - 30 * 86400000), to: new Date(now.getTime() + 60000), label: 'nos últimos 30 dias' };
  if (kind === 'trimestre') {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return { from: new Date(now.getFullYear(), q, 1), to: new Date(now.getFullYear(), q + 3, 1), label: 'neste trimestre' };
  }
  if (kind === 'ano') return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1), label: 'neste ano' };
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1), label: 'neste mês' };
}
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

export default function HomePage() {
  return <Suspense><Home /></Suspense>;
}

function Home() {
  const { me, can } = useSession();
  const [view, setView] = useQueryState({ visao: '' });
  const operation = view.visao === 'operacao' && can('reports:view');
  const salesView = view.visao === 'indicadores' && can('reports:view');
  // KPIs: números da empresa toda, para quem vê relatórios da empresa inteira.
  const kpiAccess = me.permissions['reports:view'] === 'tenant';
  const kpiView = view.visao === 'kpis' && kpiAccess;
  const { data: dir } = useDirectory();
  const { data: pipelines } = usePipelines();
  const [range, setRange] = useState('mes');
  const [pipelineId, setPipelineId] = useState('');
  const [owner, setOwner] = useState('');
  const first = me.user.name.split(/\s+/)[0];
  const tenant = me.tenants.find((t) => t.id === me.tenantId);
  const isAdmin = ADMIN_PERMS.some(can) || me.user.isPlatformAdmin;
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const p = period(range);
  const activePipes = (pipelines ?? []).filter((x) => !x.archived);
  const pipe = pipelineId || activePipes[0]?.id || '';
  const qs = new URLSearchParams({ from: p.from.toISOString(), to: p.to.toISOString(), ...(pipe ? { pipelineId: pipe } : {}), ...(owner ? { ownerId: owner } : {}) });
  const summary = useLoad(() => (me.tenantId ? api<Summary>('GET', `/api/v1/dashboard?${qs}`) : Promise.resolve(null)), [qs.toString()]);
  const todayList = useLoad(() => (can('tasks:manage') && me.tenantId && dir?.me ? api<Activity[]>('GET', `/api/v1/activities?status=open&due=today&limit=8&ownerId=${dir?.me ?? ''}`) : Promise.resolve([])), [dir?.me]);
  const s = summary.data;
  const teamView = Object.values(me.permissions).some((x) => x !== 'own');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Olá, {first}</h1>
          <p className="text-muted first-letter:uppercase">{tenant ? `${tenant.name} · ` : ''}{today}</p>
        </div>
        {me.tenantId && !operation && !salesView && !kpiView ? (
          <div className="flex flex-wrap gap-2">
            <select aria-label="Período" value={range} onChange={(e) => setRange(e.target.value)} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
              <option value="mes">Este mês</option><option value="30d">Últimos 30 dias</option><option value="trimestre">Este trimestre</option><option value="ano">Este ano</option>
            </select>
            {activePipes.length > 1 ? (
              <select aria-label="Funil" value={pipe} onChange={(e) => setPipelineId(e.target.value)} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
                {activePipes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            ) : null}
            {teamView ? (
              <select aria-label="Pessoa" value={owner} onChange={(e) => setOwner(e.target.value)} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
                <option value="">Todas as pessoas</option>
                {(dir?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.id === dir?.me ? 'Só eu' : m.name}</option>)}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>

      {isAdmin && me.mfa.adminRequired && !me.mfa.enabled ? (
        <Alert tone="warning">
          <span className="inline-flex items-center gap-1.5"><ShieldAlert size={16} aria-hidden />Você administra esta empresa. Ative a verificação em duas etapas para abrir as configurações.</span>{' '}
          <Link href="/conta#dois-fatores" className="font-semibold underline">Ativar agora</Link>
        </Alert>
      ) : null}

      {me.tenantId && can('reports:view') ? (
        <div role="group" aria-label="Visão do painel" className="flex gap-1 overflow-x-auto border-b border-line">
          {([['', 'Visão comercial'], ['indicadores', 'Indicadores comerciais'], ['operacao', 'Operação de atendimento'], ...(kpiAccess ? [['kpis', 'KPIs']] as const : [])] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view.visao === v} onClick={() => setView({ visao: v })}
              className={`h-11 border-b-2 px-3 text-sm ${view.visao === v ? 'border-primary font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      ) : null}

      {operation ? <OperationDashboard />
        : salesView ? <SalesDashboard />
        : kpiView ? <KpiDashboard />
        : !me.tenantId ? <Empty title="Escolha uma empresa">Entre numa empresa para ver os números.</Empty>
        : summary.error ? <LoadError error={summary.error} retry={summary.reload} />
        : !s ? <Loading />
        : (
          <>
            <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {s.deals ? <>
                <Kpi label="Em negociação" value={money(s.deals.openValueCents, 'BRL', true)} detail={`${s.deals.openCount} negócios · ponderado ${money(s.deals.weightedValueCents, 'BRL', true)}`} href="/negocios" />
                <Kpi label={`Ganho ${p.label}`} value={money(s.deals.wonValueCents, 'BRL', true)} detail={`${s.deals.wonCount} negócios · ticket ${s.deals.averageWonCents ? money(s.deals.averageWonCents, 'BRL', true) : '—'}`} tone="ok" />
                <Kpi label="Taxa de ganho" value={pct(s.deals.winRate)} detail={`${s.deals.wonCount} ganhos e ${s.deals.lostCount} perdidos ${p.label}`} />
              </> : null}
              {s.leads ? <Kpi label={`Leads ${p.label}`} value={String(s.leads.created)} detail={`${s.leads.qualified} qualificados · conversão ${pct(s.leads.conversionRate)}`} href="/leads" />
                : s.contacts ? <Kpi label={`Contatos novos ${p.label}`} value={String(s.contacts.created)} detail={`${s.contacts.total.toLocaleString('pt-BR')} no total`} href="/contatos" /> : null}
            </section>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="flex flex-col gap-5">
                {s.deals ? (
                  <Panel title="Funil em aberto" description="Valor e quantidade por etapa, hoje.">
                    {!s.deals.byStage.length ? <p className="text-[13px] text-muted">Sem etapas.</p> : (
                      <ul className="flex flex-col gap-2.5">
                        {s.deals.byStage.map((st) => {
                          const max = Math.max(...s.deals!.byStage.map((x) => x.valueCents), 1);
                          return (
                            <li key={st.id} className="grid grid-cols-[minmax(90px,140px)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                              <span className="truncate">{st.name}</span>
                              <span className="h-6 overflow-hidden rounded-[4px] bg-surface-2" aria-hidden>
                                <span className="block h-full rounded-[4px]" style={{ width: `${Math.max((st.valueCents / max) * 100, st.count ? 2 : 0)}%`, background: st.color }} />
                              </span>
                              <span className="w-32 text-right tabular-nums"><span className="font-medium">{money(st.valueCents, 'BRL', true)}</span> <span className="text-muted">· {st.count}</span></span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {s.deals.stalledCount ? (
                      <p className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-warn"><AlarmClock size={14} aria-hidden />{s.deals.stalledCount} {s.deals.stalledCount === 1 ? 'negócio parado' : 'negócios parados'} além do prazo da etapa</p>
                    ) : null}
                  </Panel>
                ) : null}
                <div className="grid gap-5 md:grid-cols-2">
                  {s.leads ? (
                    <Panel title="Leads por origem" description={p.label.replace(/^n/, 'N')}>
                      {!s.leads.bySource.length ? <p className="text-[13px] text-muted">Nenhum lead no período.</p> : (
                        <table className="w-full text-sm">
                          <thead><tr className="text-[12px] text-muted"><th scope="col" className="pb-1.5 text-left font-medium">Origem</th><th scope="col" className="pb-1.5 text-right font-medium">Leads</th><th scope="col" className="pb-1.5 text-right font-medium">Qualificados</th></tr></thead>
                          <tbody>{s.leads.bySource.map((x) => <tr key={x.source} className="border-t border-line"><td className="py-1.5">{x.source}</td><td className="py-1.5 text-right tabular-nums">{x.count}</td><td className="py-1.5 text-right tabular-nums">{x.qualified}</td></tr>)}</tbody>
                        </table>
                      )}
                      {s.leads.unassigned ? <Link href="/leads?ownerId=none" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">{s.leads.unassigned} sem responsável<ArrowRight size={14} aria-hidden /></Link> : null}
                    </Panel>
                  ) : null}
                  {s.deals ? (
                    <Panel title="Motivos de perda" description={p.label.replace(/^n/, 'N')}>
                      {!s.deals.lostReasons.length ? <p className="text-[13px] text-muted">Nenhuma perda no período.</p> : (
                        <ul className="flex flex-col gap-1.5 text-sm">{s.deals.lostReasons.map((r) => <li key={r.name} className="flex justify-between gap-2"><span>{r.name}</span><span className="tabular-nums text-muted">{r.count}</span></li>)}</ul>
                      )}
                    </Panel>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-5">
                {s.activities ? (
                  <Panel title="Sua agenda hoje" actions={<Link href="/agenda?visao=dia" className="text-[13px] font-medium text-accent hover:underline">Abrir agenda</Link>}>
                    <div className="mb-3 flex gap-2 text-[13px]">
                      <Link href="/agenda?visao=tarefas&prazo=overdue" className={`rounded-full px-2.5 py-1 font-medium ${s.activities.overdue ? 'bg-bad-soft text-bad' : 'bg-surface-2 text-muted'}`}>{s.activities.overdue} atrasadas</Link>
                      <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-muted">{s.activities.today} hoje</span>
                    </div>
                    {!todayList.data?.length ? <p className="text-[13px] text-muted">Nada agendado para hoje.</p>
                      : <div className="flex flex-col gap-3">{todayList.data.map((a) => <ActivityRow key={a.id} a={a} onToggle={async (o) => { await api('POST', `/api/v1/activities/${a.id}/status`, statusBody(a, o)); void todayList.reload(); void summary.reload(); }} />)}</div>}
                  </Panel>
                ) : null}
                {can('tasks:manage') ? <MyProspectingCard /> : null}
                <Panel title="Segurança da conta">
                  <div className="flex items-start gap-3">
                    {me.mfa.enabled ? <ShieldCheck size={20} className="mt-0.5 shrink-0 text-ok" aria-hidden /> : <ShieldAlert size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />}
                    <div>
                      <p className="font-medium">{me.mfa.enabled ? 'Verificação em duas etapas ativa' : 'Verificação em duas etapas desligada'}</p>
                      <Link href="/conta" className="text-[13px] font-medium text-accent hover:underline">Abrir conta e segurança</Link>
                    </div>
                  </div>
                </Panel>
                {s.contacts ? (
                  <Panel title="Base de contatos">
                    <p className="text-2xl font-semibold tabular-nums">{s.contacts.total.toLocaleString('pt-BR')}</p>
                    <p className="text-[13px] text-muted">{s.contacts.created} novos {p.label}</p>
                  </Panel>
                ) : null}
              </div>
            </div>
          </>
        )}
    </div>
  );
}

function Kpi({ label, value, detail, href, tone }: { label: string; value: string; detail: string; href?: string; tone?: 'ok' }) {
  const body = (
    <>
      <p className="text-[13px] text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums ${tone === 'ok' ? 'text-ok' : ''}`}>{value}</p>
      <p className="mt-0.5 text-[12px] text-muted">{detail}</p>
    </>
  );
  return href
    ? <Link href={href} className="rounded-[10px] border border-line bg-surface p-4 hover:border-line-strong">{body}</Link>
    : <div className="rounded-[10px] border border-line bg-surface p-4">{body}</div>;
}
