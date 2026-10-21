'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarCheck, Copy, Download, Gauge, HandCoins, Megaphone, Receipt, Tag, UserPlus, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { money, moneyInput, parseMoney } from '@/lib/crm';
import { Card } from './operation-dashboard';
import { AdSpendPanel, PLATFORM_NAME, fmtDay } from './ad-spend';
import { FunnelDialog, KpiDetailsDialog, METRIC_NAME, type KpiFunnel, type KpiMetric } from './kpi-check';
import { ProspectingPanel } from './prospecting';
import { useSession } from '@/components/shell/session';
import { Alert } from '@/components/ui/alert';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { LoadError, Loading } from '@/components/ui/states';

type Numbers = {
  spendCents: number; leads: number; prospected: number; prospectedManual: number; scheduled: number; held: number; noShow: number; rescheduled: number;
  sales: number; salesOnCall: number; salesFollowUp: number; revenueCents: number;
  noShowRate: number | null; scheduledPerLead: number | null; prospectedPerScheduled: number | null;
  onCallConversion: number | null; salesConversion: number | null; meetingsPerSale: number | null;
  averageTicketCents: number | null; costPerLeadCents: number | null; costPerScheduledCents: number | null;
  costPerHeldCents: number | null; costPerSaleCents: number | null; roas: number | null;
};
type Kpis = {
  period: { from: string; to: string; step: number; days: number; timezone: string };
  totals: Numbers & { spendByPlatform: { platform: string; spendCents: number }[] };
  periods: (Numbers & { from: string; to: string; days: number })[];
  targets: { noShowRateMax: number };
  leadRule: 'tag' | 'new-contacts';
  funnel: KpiFunnel | null;
  funnels: KpiFunnel[];
};

const STEPS = [[1, 'Diário'], [3, 'A cada 3 dias'], [7, 'Semanal'], [14, 'Quinzenal'], [30, 'A cada 30 dias']] as const;
const RANGES = [['7', 'Últimos 7 dias'], ['14', 'Últimos 14 dias'], ['30', 'Últimos 30 dias'], ['60', 'Últimos 60 dias'], ['90', 'Últimos 90 dias'],
  ['mes', 'Este mês'], ['mes-passado', 'Mês passado'], ['custom', 'Personalizado']] as const;
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const local = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (s: string, n: number) => { const d = local(s); d.setDate(d.getDate() + n); return iso(d); };
const pct = (n: number | null, digits = 0) => (n === null ? '—' : `${(n * 100).toFixed(digits).replace('.', ',')}%`);
const int = (n: number) => n.toLocaleString('pt-BR');
const ratio = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const cents = (n: number | null) => (n === null ? '—' : money(n));
const short = (s: string) => fmtDay(s).slice(0, 5);
const pl = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`;

function periodLabel(p: { from: string; to: string }, step: number): string {
  if (step === 1) return `${short(p.from)} (${WEEKDAY[local(p.from).getDay()]})`;
  return `${short(p.from)} a ${short(p.to)}`;
}

/** Colunas da planilha: rótulo, valor para a tela e valor para exportar. */
type Col = { key: string; label: string; help?: string; show: (r: Numbers) => string; raw: (r: Numbers) => number | null; warn?: (r: Numbers) => boolean };
const num = (n: number | null, d = 2) => (n === null ? '' : n.toFixed(d).replace('.', ','));
const COLS: Col[] = [
  { key: 'spend', label: 'Investimento', show: (r) => money(r.spendCents), raw: (r) => r.spendCents / 100 },
  { key: 'leads', label: 'Leads', show: (r) => int(r.leads), raw: (r) => r.leads },
  { key: 'cpl', label: 'Custo/lead', show: (r) => cents(r.costPerLeadCents), raw: (r) => (r.costPerLeadCents === null ? null : r.costPerLeadCents / 100) },
  { key: 'prospected', label: 'Prospecções', show: (r) => int(r.prospected), raw: (r) => r.prospected },
  { key: 'scheduled', label: 'Agendadas', show: (r) => int(r.scheduled), raw: (r) => r.scheduled },
  { key: 'cps', label: 'Custo/agendada', show: (r) => cents(r.costPerScheduledCents), raw: (r) => (r.costPerScheduledCents === null ? null : r.costPerScheduledCents / 100) },
  { key: 'held', label: 'Realizadas', show: (r) => int(r.held), raw: (r) => r.held },
  { key: 'noshow', label: 'No-show', show: (r) => (r.noShowRate === null ? '—' : `${int(r.noShow)} (${pct(r.noShowRate)})`), raw: (r) => r.noShowRate, warn: (r) => (r.noShowRate ?? 0) > 0.2 },
  { key: 'cph', label: 'Custo/realizada', show: (r) => cents(r.costPerHeldCents), raw: (r) => (r.costPerHeldCents === null ? null : r.costPerHeldCents / 100) },
  { key: 'sales', label: 'Vendas', show: (r) => int(r.sales), raw: (r) => r.sales },
  { key: 'oncall', label: 'Na reunião', show: (r) => int(r.salesOnCall), raw: (r) => r.salesOnCall },
  { key: 'conv', label: 'Conv. reunião', show: (r) => pct(r.onCallConversion), raw: (r) => r.onCallConversion },
  { key: 'revenue', label: 'Faturamento', show: (r) => money(r.revenueCents), raw: (r) => r.revenueCents / 100 },
  { key: 'ticket', label: 'Ticket médio', show: (r) => cents(r.averageTicketCents), raw: (r) => (r.averageTicketCents === null ? null : r.averageTicketCents / 100) },
  { key: 'cac', label: 'Custo/venda', show: (r) => cents(r.costPerSaleCents), raw: (r) => (r.costPerSaleCents === null ? null : r.costPerSaleCents / 100) },
  { key: 'roas', label: 'ROAS', show: (r) => (r.roas === null ? '—' : `${ratio(r.roas)}x`), raw: (r) => r.roas },
];

function sheet(k: Kpis, sep: string): string {
  const head = ['Início', 'Fim', ...COLS.map((c) => c.label)];
  const row = (from: string, to: string, r: Numbers) => [fmtDay(from), fmtDay(to), ...COLS.map((c) => num(c.raw(r), c.key === 'noshow' || c.key === 'conv' ? 4 : 2))];
  const lines = [head, ...k.periods.map((p) => row(p.from, p.to, p)), row(k.period.from, k.period.to, k.totals)];
  return lines.map((l) => l.map((v) => (/[;\t"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(sep)).join('\n');
}

function Step({ label, value, note, onCheck }: { label: string; value: string; note?: ReactNode; onCheck?: () => void }) {
  return (
    <li className="flex min-w-[120px] flex-1 flex-col gap-0.5 rounded-[10px] border border-line bg-surface p-3">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {note ? <span className="text-[12px] text-muted">{note}</span> : null}
      {onCheck ? <button type="button" onClick={onCheck} className="mt-1 self-start text-[12px] font-medium text-accent underline" aria-label={`Conferir ${label}`}>Conferir</button> : null}
    </li>
  );
}

/** Calculadora do fator de escala: meta → vendas → reuniões → investimento. */
function ScaleCalculator({ t, days }: { t: Kpis['totals']; days: number }) {
  const defaults = useMemo(() => ({
    ticket: moneyInput(t.averageTicketCents ?? null),
    conv: t.onCallConversion !== null ? String(Math.round(t.onCallConversion * 1000) / 10).replace('.', ',') : '',
    cost: moneyInput(t.costPerHeldCents ?? null),
    noShow: t.noShowRate !== null ? String(Math.round(t.noShowRate * 1000) / 10).replace('.', ',') : '20',
  }), [t]);
  const [goal, setGoal] = useState('');
  const [deadline, setDeadline] = useState('30');
  const [ticket, setTicket] = useState(defaults.ticket);
  const [conv, setConv] = useState(defaults.conv);
  const [cost, setCost] = useState(defaults.cost);
  const [noShow, setNoShow] = useState(defaults.noShow);
  useEffect(() => { setTicket(defaults.ticket); setConv(defaults.conv); setCost(defaults.cost); setNoShow(defaults.noShow); }, [defaults]);

  const n = (s: string) => { const v = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : null; };
  const goalC = parseMoney(goal), ticketC = parseMoney(ticket), costC = parseMoney(cost);
  const convP = n(conv), noShowP = n(noShow), dl = n(deadline);
  const ok = goalC && ticketC && convP && convP > 0 && costC !== null && noShowP !== null && noShowP < 100 && dl && dl > 0;
  const sales = ok ? Math.ceil(goalC / ticketC) : null;
  const held = ok && sales ? Math.ceil(sales / (convP / 100)) : null;
  const scheduled = ok && held ? Math.ceil(held / (1 - noShowP / 100)) : null;
  const invest = ok && held !== null ? held * costC : null;
  const perDay = (v: number | null) => (v === null || !dl ? null : v / dl);
  // Ritmo atual: investimento médio por dia no período e o que ele rende com as mesmas taxas.
  const spendPerDay = days ? t.spendCents / days : 0;
  const projectedSales = ok && costC ? (spendPerDay * dl / costC) * (convP / 100) : null;

  return (
    <Panel title="Fator de escala" description="Quanto investir para chegar à meta, com as taxas do período (pode mudar qualquer número).">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Meta de faturamento (R$)" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex.: 100.000,00" />
          <Field label="Prazo (dias)" inputMode="numeric" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <Field label="Ticket médio (R$)" inputMode="decimal" value={ticket} onChange={(e) => setTicket(e.target.value)} hint="Do período" />
          <Field label="Conversão na reunião (%)" inputMode="decimal" value={conv} onChange={(e) => setConv(e.target.value)} hint="Vendas na reunião ÷ realizadas" />
          <Field label="Custo por reunião realizada (R$)" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} hint="Investimento ÷ realizadas" />
          <Field label="No-show (%)" inputMode="decimal" value={noShow} onChange={(e) => setNoShow(e.target.value)} hint="Meta: até 20%" />
        </div>
        <div className="flex flex-col gap-3" aria-live="polite">
          {!ok ? (
            <p className="rounded-[10px] border border-dashed border-line-strong p-4 text-[13px] text-muted">
              Informe a meta de faturamento. Ticket, conversão e custo por reunião vêm do período; se o período ainda não tem vendas ou investimento, preencha com os números que vocês usam.
            </p>
          ) : (
            <>
              <ol className="grid gap-2 sm:grid-cols-2">
                <li className="rounded-[10px] border border-line p-3"><p className="text-[12px] text-muted">1. Vendas necessárias</p><p className="text-xl font-semibold tabular-nums">{int(sales!)}</p><p className="text-[12px] text-muted">{money(goalC)} ÷ ticket de {money(ticketC)}</p></li>
                <li className="rounded-[10px] border border-line p-3"><p className="text-[12px] text-muted">2. Reuniões realizadas</p><p className="text-xl font-semibold tabular-nums">{int(held!)}</p><p className="text-[12px] text-muted">convertendo {conv}% · {ratio(100 / convP!)} reuniões por venda</p></li>
                <li className="rounded-[10px] border border-line p-3"><p className="text-[12px] text-muted">3. Reuniões a agendar</p><p className="text-xl font-semibold tabular-nums">{int(scheduled!)}</p><p className="text-[12px] text-muted">com {noShow}% de no-show</p></li>
                <li className="rounded-[10px] border border-accent bg-accent-soft p-3"><p className="text-[12px] font-medium">4. Investimento necessário</p><p className="text-xl font-semibold tabular-nums">{money(invest!)}</p><p className="text-[12px]">{money(costC!)} por reunião realizada</p></li>
              </ol>
              <p className="text-sm">
                Por dia: <strong>{money(Math.round(perDay(invest)!))}</strong> de investimento, <strong>{ratio(perDay(held))}</strong> reuniões realizadas
                e <strong>{ratio(perDay(sales))}</strong> vendas, durante {int(dl!)} dias.
              </p>
              {spendPerDay > 0 && projectedSales !== null ? (
                <p className="text-[13px] text-muted">
                  No ritmo atual ({money(Math.round(spendPerDay))} por dia), o prazo rende cerca de {ratio(projectedSales)} vendas
                  ({money(Math.round(projectedSales * ticketC!))}).
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function KpiDashboard() {
  const today = iso(new Date());
  const [range, setRange] = useState<string>('30');
  const [step, setStep] = useState(7);
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<KpiMetric | null>(null);
  const [funnelId, setFunnelId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ funnel: KpiFunnel | null } | null>(null);
  const { can } = useSession();

  const dates = useMemo(() => {
    let from: string, to = today;
    if (range === 'mes') from = `${today.slice(0, 8)}01`;
    else if (range === 'mes-passado') {
      const first = local(`${today.slice(0, 8)}01`);
      first.setMonth(first.getMonth() - 1);
      from = iso(first);
      to = addDays(`${today.slice(0, 8)}01`, -1);
    } else if (range === 'custom') { from = custom.from; to = custom.to; }
    else from = addDays(today, -(Number(range) - 1));
    // Semanal: semanas de segunda a domingo.
    if (step === 7) from = addDays(from, -((local(from).getDay() + 6) % 7));
    return from <= to ? { from, to } : null;
  }, [range, step, custom.from, custom.to, today]);

  const qs = dates ? `from=${dates.from}&to=${dates.to}&step=${step}${funnelId ? `&funnelId=${funnelId}` : ''}` : '';
  const data = useLoad(() => (qs ? api<Kpis>('GET', `/api/v1/dashboard/kpis?${qs}`) : Promise.resolve(null)), [qs]);

  const sel = 'h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm';
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Período dos KPIs" value={range} onChange={(e) => setRange(e.target.value)} className={sel}>
        {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {range === 'custom' ? (
        <>
          <input type="date" aria-label="Data inicial" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={sel} />
          <input type="date" aria-label="Data final" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={sel} />
        </>
      ) : null}
      <select aria-label="Agrupar a planilha" value={step} onChange={(e) => setStep(Number(e.target.value))} className={sel}>
        {STEPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {dates ? <span className="ml-auto rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium">{fmtDay(dates.from)} – {fmtDay(dates.to)}</span>
        : <span className="text-[13px] text-bad">A data final precisa ser depois da inicial.</span>}
    </div>
  );

  const dialogs = (
    <>
      {check && dates ? <KpiDetailsDialog metric={check} from={dates.from} to={dates.to} funnelId={data.data?.funnel?.id ?? null} onClose={() => setCheck(null)} onChanged={() => void data.reload()} /> : null}
      {editing ? (
        <FunnelDialog funnel={editing.funnel} onClose={() => setEditing(null)}
          onSaved={(f) => { setEditing(null); setFunnelId(f?.id ?? null); void data.reload(); }} />
      ) : null}
    </>
  );

  const funnels = data.data?.funnels ?? [];
  const current = data.data?.funnel ?? null;
  const tabs = funnels.length || can('reports:export') ? (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Painel do funil" className="flex flex-wrap gap-1.5">
        {funnels.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={current?.id === f.id} onClick={() => setFunnelId(f.id)}
            className={`h-9 rounded-full px-3.5 text-sm font-medium ${current?.id === f.id ? 'bg-primary text-primary-fg' : 'border border-line-strong hover:bg-surface-2'}`}>
            {f.name}{f.receivesAdSpend ? <span className="sr-only"> (recebe o investimento)</span> : null}
          </button>
        ))}
      </div>
      {can('reports:export') ? (
        <span className="flex gap-1.5">
          {current ? <button type="button" onClick={() => setEditing({ funnel: current })} className="inline-flex h-9 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink"><Tag size={14} aria-hidden />Editar funil</button> : null}
          <button type="button" onClick={() => setEditing({ funnel: null })} className="inline-flex h-9 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-medium text-accent hover:bg-surface-2">+ Novo funil</button>
        </span>
      ) : null}
    </div>
  ) : null;

  if (data.error) return <div className="flex flex-col gap-5">{tabs}{filters}<LoadError error={data.error} retry={data.reload} /></div>;
  const k = data.data;
  if (!k || !dates) return <div className="flex flex-col gap-5">{tabs}{filters}{dates ? <Loading /> : null}</div>;
  const t = k.totals;
  const noShowBad = (t.noShowRate ?? 0) > k.targets.noShowRateMax;

  function download() {
    const blob = new Blob([`﻿${sheet(k!, ';')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kpis-${k!.period.from}-a-${k!.period.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(sheet(k!, '\t'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* sem permissão de área de transferência */ }
  }

  return (
    <div className="flex flex-col gap-6">
      {tabs}
      {filters}
      {dialogs}
      {k.leadRule === 'new-contacts' ? (
        <Alert tone="warning">
          Sem funil, os números misturam tudo: os leads contam <strong>todo contato novo</strong>.{' '}
          {can('reports:export') ? <button type="button" onClick={() => setEditing({ funnel: null })} className="font-semibold underline">Crie o primeiro funil</button> : 'Peça a quem administra para criar os funis.'}
          {' '}(ex.: "Tráfego pago", com a etiqueta dos leads de anúncio).
        </Alert>
      ) : null}

      <section aria-labelledby="kpi-chave" className="flex flex-col gap-3">
        <div>
          <h2 id="kpi-chave" className="text-lg font-semibold">Os números da escala</h2>
          <p className="text-[13px] text-muted">Custo por reunião realizada, reuniões por venda e ticket médio: com eles, a meta vira investimento.</p>
        </div>
        <div role="group" aria-label="Conferir os números" className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-muted">Conferir o que foi contado:</span>
          {(['leads', 'prospected', 'scheduled', 'held', 'no_show', 'sales'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setCheck(m)} className="h-8 rounded-full border border-line-strong px-3 font-medium hover:bg-surface-2">{METRIC_NAME[m]}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card title="Custo por reunião realizada" help="Investimento em anúncios do período ÷ reuniões realizadas (sem no-show)." icon={<CalendarCheck size={18} />}
            badge={<Badge tone="info">{pl(t.held, 'realizada', 'realizadas')}</Badge>} value={cents(t.costPerHeldCents)} detail={`custo por agendada: ${cents(t.costPerScheduledCents)}`} />
          <Card title="Conversão na reunião" help="Vendas fechadas no dia da reunião ÷ reuniões realizadas." icon={<Gauge size={18} />}
            badge={<Badge tone="info">{t.meetingsPerSale === null ? 'Sem venda na reunião' : `${ratio(t.meetingsPerSale)} reuniões por venda`}</Badge>}
            value={pct(t.onCallConversion, 1)} detail={`${pl(t.salesOnCall, 'venda', 'vendas')} na reunião · ${pct(t.salesConversion)} contando o follow-up`} />
          <Card title="Ticket médio" help="Faturamento ÷ vendas do período." icon={<Receipt size={18} />}
            badge={<Badge>{pl(t.sales, 'venda', 'vendas')}</Badge>} value={cents(t.averageTicketCents)} detail={`faturamento ${money(t.revenueCents)}`} />
          <Card title="Taxa de no-show" help="Não compareceu ÷ (realizadas + não compareceu). Meta: até 20%." icon={<UserX size={18} />}
            badge={t.noShowRate === null ? <Badge>Sem reuniões</Badge> : noShowBad ? <Badge tone="bad">Acima da meta de 20%</Badge> : <Badge tone="ok">Dentro da meta</Badge>}
            value={pct(t.noShowRate, 1)} detail={`${pl(t.noShow, 'não compareceu', 'não compareceram')} · ${pl(t.rescheduled, 'remarcada', 'remarcadas')}`} tone={noShowBad ? 'bad' : undefined} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card title="Investimento" help="Gasto em anúncios lançado ou importado, dividido pelos dias de cada lançamento." icon={<Megaphone size={18} />}
            badge={<Badge>{t.spendByPlatform.length ? t.spendByPlatform.map((p) => PLATFORM_NAME[p.platform] ?? p.platform).join(' + ') : 'Sem lançamento'}</Badge>}
            value={money(t.spendCents)} detail={t.spendByPlatform.map((p) => `${PLATFORM_NAME[p.platform] ?? p.platform} ${money(p.spendCents, 'BRL', true)}`).join(' · ') || 'Lance o gasto abaixo'} />
          <Card title="Leads" help={k.leadRule === 'tag' ? 'Contatos que receberam a etiqueta do funil no período (cada pessoa uma vez).' : 'Contatos e leads novos no período (cada pessoa uma vez). Crie um funil para contar só os leads dele.'} icon={<UserPlus size={18} />}
            badge={<Badge tone="info">Custo por lead {cents(t.costPerLeadCents)}</Badge>} value={int(t.leads)} detail={`${int(t.prospected)} prospecções${t.prospectedManual ? ` (${int(t.prospectedManual)} lançadas pelos vendedores)` : ' (pessoas abordadas)'}`} />
          <Card title="Custo por venda" help="Investimento ÷ vendas do período (CAC de mídia)." icon={<HandCoins size={18} />}
            badge={<Badge>{pl(t.sales, 'venda', 'vendas')}</Badge>} value={cents(t.costPerSaleCents)} detail={`${int(t.salesOnCall)} na reunião · ${int(t.salesFollowUp)} no follow-up`} />
          <Card title="ROAS" help="Faturamento ÷ investimento em anúncios." icon={<Gauge size={18} />}
            badge={t.roas === null ? <Badge>Sem investimento</Badge> : <Badge tone={t.roas >= 1 ? 'ok' : 'warn'}>{t.roas >= 1 ? 'Retorno acima do gasto' : 'Retorno abaixo do gasto'}</Badge>}
            value={t.roas === null ? '—' : `${ratio(t.roas)}x`} detail={`${money(t.revenueCents)} de ${money(t.spendCents)}`} />
        </div>
      </section>

      <Panel title="Funil do período" description="Quanto cada etapa pede da anterior.">
        <ol className="flex flex-wrap gap-2">
          <Step label="Leads" value={int(t.leads)} note={`custo ${cents(t.costPerLeadCents)}`} onCheck={() => setCheck('leads')} />
          <Step label="Prospecções" value={int(t.prospected)} note={t.prospectedManual ? `${int(t.prospectedManual)} lançadas pelos vendedores` : 'pessoas abordadas'} onCheck={() => setCheck('prospected')} />
          <Step label="Reuniões agendadas" value={int(t.scheduled)} onCheck={() => setCheck('scheduled')}
            note={t.scheduledPerLead === null ? '—' : `${pct(t.scheduledPerLead)} dos leads${t.prospectedPerScheduled !== null ? ` · ${ratio(t.prospectedPerScheduled)} prospecções por agendada` : ''}`} />
          <Step label="Reuniões realizadas" value={int(t.held)} note={`no-show ${pct(t.noShowRate)} (meta até 20%)`} onCheck={() => setCheck('held')} />
          <Step label="Vendas" value={int(t.sales)} note={`${pct(t.salesConversion)} das realizadas`} onCheck={() => setCheck('sales')} />
        </ol>
      </Panel>

      <ScaleCalculator t={t} days={k.period.days} />

      <Panel title="Planilha por período" description={`${STEPS.find(([v]) => v === step)?.[1] ?? ''}: uma linha por período, com o total no fim. Fuso ${k.period.timezone}.`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">
              <Copy size={15} aria-hidden />{copied ? 'Copiado!' : 'Copiar para planilha'}
            </button>
            <button type="button" onClick={download} className="inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">
              <Download size={15} aria-hidden />Baixar CSV
            </button>
          </div>
        )}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Planilha de KPIs por período">
          <table className="w-full min-w-[1400px] text-[13px]">
            <thead><tr className="border-b border-line text-right text-[12px] text-muted">
              <th scope="col" className="sticky left-0 bg-surface py-1.5 pr-3 text-left font-medium">Período</th>
              {COLS.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">{c.label}</th>)}
            </tr></thead>
            <tbody>
              {k.periods.map((p) => (
                <tr key={p.from} className="border-b border-line text-right tabular-nums">
                  <th scope="row" className="sticky left-0 whitespace-nowrap bg-surface py-1.5 pr-3 text-left font-normal">{periodLabel(p, step)}</th>
                  {COLS.map((c) => <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${c.warn?.(p) ? 'font-semibold text-bad' : ''}`}>{c.show(p)}</td>)}
                </tr>
              ))}
              <tr className="text-right font-semibold tabular-nums">
                <th scope="row" className="sticky left-0 bg-surface py-2 pr-3 text-left">Total</th>
                {COLS.map((c) => <td key={c.key} className={`whitespace-nowrap px-2 py-2 ${c.warn?.(t) ? 'text-bad' : ''}`}>{c.show(t)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {k.funnel?.manualProspecting ? <ProspectingPanel funnelId={k.funnel.id} from={k.period.from} to={k.period.to} onChange={() => void data.reload()} /> : null}

      {!k.funnel || k.funnel.receivesAdSpend ? <AdSpendPanel from={k.period.from} to={k.period.to} onChange={() => void data.reload()} /> : (
        <p className="rounded-[10px] border border-line bg-surface p-4 text-[13px] text-muted">
          Este funil não recebe o investimento em anúncios{funnels.find((f) => f.receivesAdSpend) ? ` (vai para "${funnels.find((f) => f.receivesAdSpend)!.name}")` : ''}: os custos ficam em branco.
        </p>
      )}

      <details className="rounded-[10px] border border-line bg-surface p-4 text-[13px]">
        <summary className="cursor-pointer font-medium">Como os KPIs são calculados</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted">
          <li>Cada número tem a lista do que foi contado (botões "Conferir"). Dali dá para abrir o registro e corrigir (por exemplo, o valor de um negócio) ou tirar da conta o que não é pertinente, sem apagar nada do CRM.</li>
          <li><strong className="text-ink">Investimento</strong>: lançamentos à mão (valor e período) e o gasto importado da Meta Ads. Um lançamento de vários dias é dividido por igual entre os dias.</li>
          <li><strong className="text-ink">Leads</strong>: contatos que receberam a etiqueta de lead no período, cada pessoa uma vez (sem etiqueta escolhida, todo contato e lead novo). <strong className="text-ink">Prospecções</strong>: pessoas que receberam mensagem (de alguém da equipe, campanha ou automação) ou tiveram reunião realizada.</li>
          <li><strong className="text-ink">Reunião</strong>: atividade do tipo Ligação ou Reunião. Agendada = criada no período; realizada e no-show pelo resultado informado ao concluir.</li>
          <li><strong className="text-ink">Venda na reunião</strong>: negócio ganho no mesmo dia de uma reunião realizada com a pessoa. As outras vendas com reunião antes são de follow-up.</li>
          <li>Custos = investimento ÷ etapa. ROAS = faturamento ÷ investimento. Os KPIs são da empresa toda.</li>
        </ul>
      </details>
    </div>
  );
}
