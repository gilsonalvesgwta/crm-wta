'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CircleCheck, Clock, Inbox, ListTodo, Mail, MessageCircle, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { money } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory, usePipelines } from './data';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { LoadError, Loading } from '@/components/ui/states';

type Operation = {
  period: { from: string; to: string; timezone: string };
  thresholds: { okSeconds: number; warnSeconds: number };
  now: { active: number; unassigned: number; awaitingReply: number };
  messages: { received: number; sent: number };
  response: { averageSeconds: number | null; answered: number; unanswered: number };
  closed: number;
  followUps: { open: number; overdue: number };
  daily: { day: string; conversations: number; averageResponseSeconds: number | null }[];
  heatmap: { day: string; hour: number; n: number }[];
  channels: { channel: 'whatsapp' | 'email'; conversations: number; received: number; sent: number; averageResponseSeconds: number | null; openDealValueCents: number }[];
  agents: { id: string; name: string; active: number; sent: number; answered: number; averageResponseSeconds: number | null; closed: number }[];
  funnel: { conversations: number; withOpenDeal: number; rate: number | null; openDeals: number; openValueCents: number; averageTicketCents: number | null };
};
type StageSummary = { deals?: { byStage: { id: string; name: string; color: string; count: number; valueCents: number }[] } };

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const dShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const dFull = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function duration(s: number | null): string {
  if (s === null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
const dayLabel = (d: string) => dShort.format(new Date(`${d}T00:00:00Z`));

export function Card({ title, help, icon, badge, value, detail, tone }: {
  title: string; help: string; icon: ReactNode; badge: ReactNode; value: string; detail: string; tone?: 'warn' | 'bad';
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-[12px] border p-4 ${tone === 'bad' ? 'border-bad/40 bg-bad-soft/40' : tone === 'warn' ? 'border-warn/40 bg-warn-soft/40' : 'border-line bg-surface'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-muted" title={help}>{title}</p>
          <div>{badge}</div>
        </div>
        <span aria-hidden className="flex size-9 items-center justify-center rounded-[8px] bg-surface-2 text-muted">{icon}</span>
      </div>
      <div>
        <p className="text-3xl font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
        <p className="text-[13px] text-muted">{detail}</p>
      </div>
      <p className="sr-only">{help}</p>
    </div>
  );
}

/** Linha simples, uma série, com cruz e dica ao passar o mouse e tabela para leitor de tela. */
export function LineChart({ label, points, format, minMax = 4, unit = 1 }: { label: string; points: { x: string; y: number | null }[]; format: (v: number) => string; minMax?: number; unit?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const h = 200;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const ys = points.map((p) => p.y ?? 0);
  const max = Math.max(...ys, minMax);
  // Escala "redonda" com metade inteira (na unidade do eixo: 1 ou 60 para minutos).
  const nice = (() => {
    const v = max / unit;
    const e = 10 ** Math.floor(Math.log10(v));
    const m = v / e;
    return ([1, 2, 4, 6, 8, 10].find((x) => m <= x) ?? 10) * e * unit;
  })();
  const x = (i: number) => pad.l + (points.length <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / nice);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y ?? 0).toFixed(1)}`).join(' ');
  const ticks = [0, nice / 2, nice];
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((w - pad.l) / 64))));
  return (
    <div ref={box} className="relative">
      <svg width={w} height={h} role="img" aria-label={label} className="block"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - pad.l) / Math.max(1, w - pad.l - pad.r)) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, i)));
        }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="3 4" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{format(t)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1 ? (
          <text key={p.x} x={x(i)} y={h - 6} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{dayLabel(p.x)}</text>
        ) : null))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke="var(--border-strong)" />
            <circle cx={x(hover)} cy={y(points[hover]!.y ?? 0)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute top-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-md"
          style={{ left: Math.min(Math.max(x(hover) - 60, 0), w - 130) }}>
          <p className="text-muted">{dayLabel(points[hover]!.x)}</p>
          <p className="font-semibold tabular-nums">{points[hover]!.y === null ? 'Sem dados' : format(points[hover]!.y!)}</p>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">Dia</th><th scope="col">Valor</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.x}><td>{dayLabel(p.x)}</td><td>{p.y === null ? 'sem dados' : format(p.y)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Heatmap({ data, from, to }: { data: Operation['heatmap']; from: string; to: string }) {
  const [all, setAll] = useState(false);
  const days = useMemo(() => {
    const out: string[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10));
    return out;
  }, [from, to]);
  const map = new Map(data.map((c) => [`${c.day}|${c.hour}`, c.n]));
  const max = Math.max(1, ...data.map((c) => c.n));
  const shown = all ? days : days.slice(-15);
  const step = (n: number) => (n === 0 ? 'var(--surface-2)' : `color-mix(in oklab, var(--accent) ${Math.round(18 + (n / max) * 82)}%, var(--surface))`);
  // Destaques.
  const byHour = Array.from({ length: 24 }, (_, h) => data.filter((c) => c.hour === h).reduce((s, c) => s + c.n, 0));
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byDay = new Map<string, number>();
  for (const c of data) {
    byWeekday[new Date(`${c.day}T12:00:00Z`).getUTCDay()]! += c.n;
    byDay.set(c.day, (byDay.get(c.day) ?? 0) + c.n);
  }
  const top = data.reduce<Operation['heatmap'][number] | null>((b, c) => (!b || c.n > b.n ? c : b), null);
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakWeekday = byWeekday.indexOf(Math.max(...byWeekday));
  const peakDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Mapa de calor por dia e hora">
        <div className="grid min-w-[720px] gap-1" style={{ gridTemplateColumns: '56px repeat(24, minmax(0, 1fr))' }} aria-hidden>
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[10px] text-muted">{h % 2 === 0 ? `${String(h).padStart(2, '0')}h` : ''}</span>)}
          {shown.map((d) => (
            <div key={d} className="contents">
              <span className="text-[11px] leading-5 text-muted">{dayLabel(d)}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const n = map.get(`${d}|${h}`) ?? 0;
                return <span key={h} title={`${dayLabel(d)} ${String(h).padStart(2, '0')}h: ${n} mensagem(ns)`} className="h-5 rounded-[4px]" style={{ background: step(n) }} />;
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">Mostrando {shown.length} de {days.length} dias · mais escuro = mais mensagens recebidas</p>
        {days.length > 15 ? <button type="button" onClick={() => setAll((v) => !v)} className="h-9 rounded-[6px] border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">{all ? 'Mostrar só os últimos 15 dias' : 'Expandir período completo'}</button> : null}
      </div>
      <ul className="flex flex-wrap gap-2 text-[12px]">
        <li className="rounded-full border border-line px-2.5 py-1">Pico: {top ? `${dayLabel(top.day)} ${String(top.hour).padStart(2, '0')}h (${top.n})` : '—'}</li>
        <li className="rounded-full border border-line px-2.5 py-1">Dia mais forte: {data.length ? `${WEEKDAYS[peakWeekday]} (${byWeekday[peakWeekday]})` : '—'}</li>
        <li className="rounded-full border border-line px-2.5 py-1">Hora de pico: {data.length ? `${String(peakHour).padStart(2, '0')}h (${byHour[peakHour]})` : '—'}</li>
        <li className="rounded-full border border-line px-2.5 py-1">Dia de pico: {peakDay ? `${dayLabel(peakDay[0])} (${peakDay[1]})` : '—'}</li>
      </ul>
    </div>
  );
}

export function OperationDashboard() {
  const { can } = useSession();
  const dir = useDirectory();
  const pipelines = usePipelines();
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState('');
  const [assignee, setAssignee] = useState('');
  const [team, setTeam] = useState('');
  const range = useMemo(() => {
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date(to.getTime() - days * 86_400_000 + 1);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }, [days]);
  const qs = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), ...(channel ? { channel } : {}), ...(assignee ? { assigneeId: assignee } : {}), ...(team ? { teamId: team } : {}) });
  const op = useLoad(() => api<Operation>('GET', `/api/v1/dashboard/operation?${qs}`), [qs.toString()]);
  const pipe = (pipelines.data ?? []).find((p) => !p.archived);
  const stages = useLoad(() => (can('deals:view') && pipe ? api<StageSummary>('GET', `/api/v1/dashboard?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}&pipelineId=${pipe.id}`) : Promise.resolve(null)), [pipe?.id]);
  const o = op.data;

  const sel = 'h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm';
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Período" value={days} onChange={(e) => setDays(Number(e.target.value))} className={sel}>
        <option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option>
      </select>
      <select aria-label="Canal" value={channel} onChange={(e) => setChannel(e.target.value)} className={sel}>
        <option value="">Todos os canais</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option>
      </select>
      <select aria-label="Responsável" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={sel}>
        <option value="">Todos os atendentes</option>
        {(dir.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {(dir.data?.teams ?? []).length ? (
        <select aria-label="Equipe" value={team} onChange={(e) => setTeam(e.target.value)} className={sel}>
          <option value="">Todas as equipes</option>
          {(dir.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : null}
      <span className="ml-auto rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium">
        {dFull.format(range.from)} – {dFull.format(range.to)} ({days} dias)
      </span>
    </div>
  );

  if (op.error) return <div className="flex flex-col gap-5">{filters}<LoadError error={op.error} retry={op.reload} /></div>;
  if (!o) return <div className="flex flex-col gap-5">{filters}<Loading /></div>;

  const resp = o.response.averageSeconds;
  const respTone = resp === null ? null : resp <= o.thresholds.okSeconds ? 'ok' : resp <= o.thresholds.warnSeconds ? 'warn' : 'bad';
  const respBadge = respTone === null ? <Badge>Sem base</Badge>
    : <Badge tone={respTone}>{respTone === 'ok' ? 'Dentro do esperado' : respTone === 'warn' ? 'Atenção' : 'Acima do esperado'}</Badge>;
  const unTone = o.now.unassigned === 0 ? 'ok' : o.now.unassigned > 5 ? 'bad' : 'warn';
  const maxValue = Math.max(1, ...o.channels.map((c) => c.openDealValueCents));
  const byStage = stages.data?.deals?.byStage ?? [];
  const maxStage = Math.max(1, ...byStage.map((s) => s.count));
  const dayFrom = o.daily[0]?.day ?? '';
  const dayTo = o.daily.at(-1)?.day ?? '';

  return (
    <div className="flex flex-col gap-6">
      {filters}

      <section aria-labelledby="op-agora" className="flex flex-col gap-3">
        <div><h2 id="op-agora" className="text-lg font-semibold">Status da operação agora</h2><p className="text-[13px] text-muted">Indicadores-chave para leitura rápida da saúde do atendimento.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card title="Mensagens recebidas" help="Mensagens que chegaram no período, em todas as conversas que você vê." icon={<MessageCircle size={18} />}
            badge={<Badge>Volume no período</Badge>} value={o.messages.received.toLocaleString('pt-BR')} detail={`${o.messages.sent.toLocaleString('pt-BR')} enviadas`} />
          <Card title="Tempo médio de resposta" help="Da primeira mensagem do cliente até a resposta de uma pessoa da empresa. Até 15 min está dentro do esperado." icon={<Clock size={18} />}
            badge={respBadge} value={duration(resp)} detail={`${o.response.answered} respondidas · ${o.response.unanswered} sem resposta`} tone={respTone === 'bad' ? 'bad' : undefined} />
          <Card title="Conversas encerradas" help="Conversas encerradas no período." icon={<CircleCheck size={18} />}
            badge={<Badge tone="ok">No período</Badge>} value={o.closed.toLocaleString('pt-BR')} detail="encerradas pelos atendentes" />
          <Card title="Follow-ups pendentes" help="Tarefas em aberto (ligações, retornos, reuniões) no seu alcance." icon={<ListTodo size={18} />}
            badge={o.followUps.overdue ? <Badge tone="warn">Com atraso</Badge> : <Badge tone="ok">Dentro do esperado</Badge>}
            value={o.followUps.open.toLocaleString('pt-BR')} detail={`${o.followUps.overdue} em atraso`} tone={o.followUps.overdue ? 'warn' : undefined} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Conversas ativas agora" help="Abertas ou aguardando o cliente: a fila atual do atendimento." icon={<Inbox size={18} />}
            badge={o.now.awaitingReply ? <Badge tone="warn">Monitorar</Badge> : <Badge tone="ok">Em dia</Badge>}
            value={o.now.active.toLocaleString('pt-BR')} detail={`${o.now.awaitingReply} esperando resposta da empresa`} tone={o.now.awaitingReply ? 'warn' : undefined} />
          <Card title="Conversas sem responsável" help="Conversas ativas que ninguém assumiu." icon={<UserX size={18} />}
            badge={<Badge tone={unTone}>{unTone === 'ok' ? 'Em dia' : unTone === 'bad' ? 'Crítico' : 'Atenção'}</Badge>}
            value={o.now.unassigned.toLocaleString('pt-BR')} detail={o.now.unassigned ? 'Distribua em Conversas › Filtros › Sem responsável' : 'Todas as conversas têm responsável'} tone={unTone === 'ok' ? undefined : unTone} />
        </div>
        {o.now.unassigned ? <Link href="/conversas?who=none&st=open" className="self-start text-[13px] font-medium text-accent hover:underline">Ver conversas sem responsável</Link> : null}
      </section>

      <section aria-labelledby="op-tendencias" className="flex flex-col gap-3">
        <div><h2 id="op-tendencias" className="text-lg font-semibold">Tendências no tempo</h2><p className="text-[13px] text-muted">Evolução do atendimento no período filtrado.</p></div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Conversas por dia" description="Conversas com alguma mensagem em cada dia.">
            <LineChart label="Conversas por dia" points={o.daily.map((d) => ({ x: d.day, y: d.conversations }))} format={(v) => String(Math.round(v))} />
          </Panel>
          <Panel title="Tempo de 1ª resposta por dia" description="Média do tempo até a primeira resposta de uma pessoa.">
            <LineChart label="Tempo de primeira resposta por dia" points={o.daily.map((d) => ({ x: d.day, y: d.averageResponseSeconds }))} format={(v) => duration(Math.round(v))} minMax={120} unit={60} />
          </Panel>
        </div>
      </section>

      <section aria-labelledby="op-diagnostico" className="flex flex-col gap-3">
        <div><h2 id="op-diagnostico" className="text-lg font-semibold">Diagnóstico e otimização</h2><p className="text-[13px] text-muted">Onde estão os picos e as oportunidades do atendimento.</p></div>
        <Panel title="Mapa de calor da operação" description={`Mensagens recebidas por dia e hora (fuso ${o.period.timezone}).`}>
          {dayFrom ? <Heatmap data={o.heatmap} from={dayFrom} to={dayTo} /> : null}
        </Panel>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Panel title="Resumo do funil" description="Contatos que conversaram no período.">
            <dl className="flex flex-col gap-2">
              {[
                ['Conversas com negócio aberto', o.funnel.rate === null ? '—' : `${Math.round(o.funnel.rate * 100)}%`, `${o.funnel.withOpenDeal} de ${o.funnel.conversations}`],
                ['Ticket médio no funil', o.funnel.averageTicketCents === null ? '—' : money(o.funnel.averageTicketCents, 'BRL', true), `${o.funnel.openDeals} negócios abertos`],
                ['Valor total no funil', money(o.funnel.openValueCents, 'BRL', true), 'negócios abertos desses contatos'],
              ].map(([k, v, d]) => (
                <div key={k} className="rounded-[10px] border border-line p-3"><dt className="text-[13px] text-muted">{k}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd><dd className="text-[12px] text-muted">{d}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel title="Desempenho por canal" description="Conversas, mensagens e valor em negociação por canal.">
            {!o.channels.length ? <p className="text-[13px] text-muted">Sem dados de canal no período.</p> : (
              <div className="flex flex-col gap-4">
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Desempenho por canal">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="border-b border-line text-left text-[12px] text-muted">
                      <th scope="col" className="py-1.5 font-medium">Canal</th><th scope="col" className="py-1.5 text-right font-medium">Conversas</th>
                      <th scope="col" className="py-1.5 text-right font-medium">Recebidas</th><th scope="col" className="py-1.5 text-right font-medium">Enviadas</th>
                      <th scope="col" className="py-1.5 text-right font-medium">Resposta</th><th scope="col" className="py-1.5 text-right font-medium">Em negociação</th>
                    </tr></thead>
                    <tbody>{o.channels.map((c) => (
                      <tr key={c.channel} className="border-b border-line last:border-0">
                        <td className="py-2"><span className="inline-flex items-center gap-1.5">{c.channel === 'email' ? <Mail size={14} aria-hidden /> : <MessageCircle size={14} aria-hidden />}{c.channel === 'email' ? 'E-mail' : 'WhatsApp'}</span></td>
                        <td className="py-2 text-right tabular-nums">{c.conversations}</td><td className="py-2 text-right tabular-nums">{c.received}</td>
                        <td className="py-2 text-right tabular-nums">{c.sent}</td><td className="py-2 text-right tabular-nums">{duration(c.averageResponseSeconds)}</td>
                        <td className="py-2 text-right tabular-nums">{money(c.openDealValueCents, 'BRL', true)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div>
                  <p className="mb-2 text-[13px] font-medium">Canais com maior valor</p>
                  <ul className="flex flex-col gap-2">
                    {[...o.channels].sort((a, b) => b.openDealValueCents - a.openDealValueCents).map((c) => (
                      <li key={c.channel} className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                        <span>{c.channel === 'email' ? 'E-mail' : 'WhatsApp'}</span>
                        <span className="h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden><span className="block h-full rounded-full bg-accent" style={{ width: `${c.openDealValueCents ? Math.max(2, (c.openDealValueCents / maxValue) * 100) : 0}%` }} /></span>
                        <span className="tabular-nums">{money(c.openDealValueCents, 'BRL', true)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Panel>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Desempenho dos atendentes" description="Quem atendeu no período.">
            {!o.agents.length ? <p className="text-[13px] text-muted">Sem dados de atendentes no período.</p> : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Desempenho dos atendentes">
                <table className="w-full min-w-[480px] text-sm">
                  <thead><tr className="border-b border-line text-left text-[12px] text-muted">
                    <th scope="col" className="py-1.5 font-medium">Atendente</th><th scope="col" className="py-1.5 text-right font-medium">Ativas</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Respondidas</th><th scope="col" className="py-1.5 text-right font-medium">Tempo médio</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Encerradas</th>
                  </tr></thead>
                  <tbody>{o.agents.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="py-2">{a.name}</td><td className="py-2 text-right tabular-nums">{a.active}</td>
                      <td className="py-2 text-right tabular-nums">{a.answered}</td><td className="py-2 text-right tabular-nums">{duration(a.averageResponseSeconds)}</td>
                      <td className="py-2 text-right tabular-nums">{a.closed}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Funil por etapa" description={pipe ? `Negócios abertos em ${pipe.name}.` : undefined}
            actions={byStage.length ? <Badge>{byStage.reduce((s, x) => s + x.count, 0)} total</Badge> : undefined}>
            {!byStage.length ? <p className="text-[13px] text-muted">Funil sem negócios abertos.</p> : (
              <ul className="flex flex-col gap-2">
                {byStage.map((s) => (
                  <li key={s.id} className="grid grid-cols-[minmax(80px,130px)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                    <span className="truncate">{s.name}</span>
                    <span className="h-5 overflow-hidden rounded-[4px] bg-surface-2" aria-hidden><span className="block h-full rounded-[4px]" style={{ width: `${Math.max((s.count / maxStage) * 100, s.count ? 3 : 0)}%`, background: s.color }} /></span>
                    <span className="tabular-nums">{s.count} <span className="text-muted">· {money(s.valueCents, 'BRL', true)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </section>
      <p className="text-[12px] text-muted">CSAT (nota de satisfação) entra quando a pesquisa de satisfação for ligada.</p>
    </div>
  );
}
