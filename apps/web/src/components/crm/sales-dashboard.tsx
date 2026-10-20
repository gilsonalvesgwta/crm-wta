'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { CalendarCheck, CalendarPlus, HandCoins, PhoneCall, Repeat, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { money } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory } from './data';
import { Card, LineChart, duration } from './operation-dashboard';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { LoadError, Loading } from '@/components/ui/states';

type Numbers = {
  contacted: number;
  calls: { scheduled: number; held: number; noShow: number; rescheduled: number; attendanceRate: number | null };
  sales: {
    onCall: number; followUp: number; withoutCall: number; total: number;
    valueOnCallCents: number; valueFollowUpCents: number; valueWithoutCallCents: number; valueCents: number;
    averageFollowUpSeconds: number | null;
  };
  conversion: { people: number; onCall: number; followUp: number; onCallRate: number | null; followUpRate: number | null };
};
type Sales = {
  period: { from: string; to: string; timezone: string; previousFrom: string };
  totals: Numbers;
  previous: Numbers;
  daily: { day: string; contacted: number; scheduled: number; held: number; salesOnCall: number; salesFollowUp: number }[];
  sellers: (Numbers & { id: string; name: string })[];
};

const PRESETS = [['1', 'Hoje'], ['7', 'Últimos 7 dias'], ['14', 'Últimos 14 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['custom', 'Personalizado']] as const;
const dFull = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const int = (n: number) => n.toLocaleString('pt-BR');
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Tempo até a venda em dias (ou horas, se for menos de um dia). */
function days(s: number | null): string {
  if (s === null) return '—';
  if (s < 86_400) return duration(s);
  const d = s / 86_400;
  return `${d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} dias`;
}

/** Variação contra o período anterior, do mesmo tamanho. */
function Change({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <Badge>Sem movimento</Badge>;
  if (!before) return <Badge tone="info">Novo no período</Badge>;
  const d = (now - before) / before;
  const label = `${d > 0 ? '+' : ''}${Math.round(d * 100)}% vs. anterior`;
  return <Badge tone={d > 0 ? 'ok' : d < 0 ? 'warn' : 'neutral'}>{label}</Badge>;
}

/** Barra do funil: largura relativa ao primeiro passo, com a passagem do passo anterior. */
function Step({ label, value, max, rate, detail }: { label: string; value: number; max: number; rate?: string; detail?: ReactNode }) {
  return (
    <li className="grid grid-cols-[minmax(110px,170px)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
      <span>{label}</span>
      <span className="h-6 overflow-hidden rounded-[4px] bg-surface-2" aria-hidden>
        <span className="block h-full rounded-[4px] bg-accent" style={{ width: `${value ? Math.max(2, (value / Math.max(1, max)) * 100) : 0}%` }} />
      </span>
      <span className="whitespace-nowrap tabular-nums"><strong>{int(value)}</strong>{rate ? <span className="text-muted"> · {rate}</span> : null}{detail}</span>
    </li>
  );
}

export function SalesDashboard() {
  const { me } = useSession();
  const dir = useDirectory();
  const [preset, setPreset] = useState<string>('7');
  const today = isoDay(new Date());
  const [custom, setCustom] = useState({ from: isoDay(new Date(Date.now() - 6 * 86_400_000)), to: today });
  const [owner, setOwner] = useState('');
  const [team, setTeam] = useState('');
  const range = useMemo(() => {
    if (preset === 'custom') {
      const from = new Date(`${custom.from}T00:00:00`);
      const to = new Date(`${custom.to}T23:59:59.999`);
      return to > from ? { from, to } : null;
    }
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date();
    from.setDate(from.getDate() - (Number(preset) - 1));
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }, [preset, custom.from, custom.to]);
  const qs = range ? new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), ...(owner ? { ownerId: owner } : {}), ...(team ? { teamId: team } : {}) }).toString() : '';
  const data = useLoad(() => (qs ? api<Sales>('GET', `/api/v1/dashboard/sales?${qs}`) : Promise.resolve(null)), [qs]);
  const broad = me.permissions['reports:view'] !== 'own';

  const sel = 'h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm';
  const nDays = range ? Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) : 0;
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Período" value={preset} onChange={(e) => setPreset(e.target.value)} className={sel}>
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {preset === 'custom' ? (
        <>
          <input type="date" aria-label="Data inicial" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={sel} />
          <input type="date" aria-label="Data final" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={sel} />
        </>
      ) : null}
      {broad ? (
        <select aria-label="Vendedor" value={owner} onChange={(e) => setOwner(e.target.value)} className={sel}>
          <option value="">Todos os vendedores</option>
          {(dir.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      ) : null}
      {broad && (dir.data?.teams ?? []).length ? (
        <select aria-label="Equipe" value={team} onChange={(e) => setTeam(e.target.value)} className={sel}>
          <option value="">Todas as equipes</option>
          {(dir.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : null}
      {range ? (
        <span className="ml-auto rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium">
          {dFull.format(range.from)} – {dFull.format(range.to)} ({nDays} {nDays === 1 ? 'dia' : 'dias'})
        </span>
      ) : <span className="text-[13px] text-bad">A data final precisa ser depois da inicial.</span>}
    </div>
  );

  if (data.error) return <div className="flex flex-col gap-5">{filters}<LoadError error={data.error} retry={data.reload} /></div>;
  const s = data.data;
  if (!s) return <div className="flex flex-col gap-5">{filters}{range ? <Loading /> : null}</div>;
  const t = s.totals, p = s.previous;
  const afterCall = t.conversion.people - t.conversion.onCall;
  const funnelMax = Math.max(t.contacted, t.calls.scheduled, t.calls.held, 1);
  // Passagem de uma etapa para outra; acima de 100% (mais calls que pessoas) não diz nada.
  const pass = (n: number, of: number, what: string) => (of && n <= of ? `${pct(n / of)} ${what}` : undefined);
  const plural = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`;

  return (
    <div className="flex flex-col gap-6">
      {filters}

      <section aria-labelledby="ind-resumo" className="flex flex-col gap-3">
        <div>
          <h2 id="ind-resumo" className="text-lg font-semibold">Números do período</h2>
          <p className="text-[13px] text-muted">Comparados com os {nDays} {nDays === 1 ? 'dia' : 'dias'} anteriores.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card title="Leads contatados" help="Pessoas que receberam mensagem de alguém da equipe (sem campanha nem automação) ou tiveram call realizada. Cada pessoa conta uma vez."
            icon={<UserCheck size={18} />} badge={<Change now={t.contacted} before={p.contacted} />} value={int(t.contacted)} detail={`${int(p.contacted)} no período anterior`} />
          <Card title="Calls agendadas" help="Ligações e reuniões criadas na agenda no período."
            icon={<CalendarPlus size={18} />} badge={<Change now={t.calls.scheduled} before={p.calls.scheduled} />} value={int(t.calls.scheduled)} detail={`${int(p.calls.scheduled)} no período anterior`} />
          <Card title="Calls realizadas" help="Ligações e reuniões marcadas para o período e concluídas como realizadas. Comparecimento = realizadas ÷ (realizadas + não compareceu)."
            icon={<CalendarCheck size={18} />} badge={<Badge tone={t.calls.attendanceRate === null ? 'neutral' : t.calls.attendanceRate >= 0.7 ? 'ok' : 'warn'}>Comparecimento {pct(t.calls.attendanceRate)}</Badge>}
            value={int(t.calls.held)} detail={`${plural(t.calls.noShow, 'não compareceu', 'não compareceram')} · ${plural(t.calls.rescheduled, 'remarcada', 'remarcadas')}`} />
          <Card title="Vendas na call" help="Negócios ganhos no mesmo dia de uma call realizada com a pessoa. Conversão: das pessoas com call realizada no período, quantas compraram no dia."
            icon={<PhoneCall size={18} />} badge={<Badge tone="info">Conversão na call {pct(t.conversion.onCallRate)}</Badge>}
            value={int(t.sales.onCall)} detail={`${money(t.sales.valueOnCallCents, 'BRL', true)} · ${t.conversion.onCall} de ${t.conversion.people} com call no período`} />
          <Card title="Vendas no follow-up" help="Negócios ganhos depois do dia da call realizada. Conversão: das pessoas que não compraram na call, quantas compraram depois. Tempo médio: da primeira call até a venda."
            icon={<Repeat size={18} />} badge={<Badge tone="info">Conversão no follow-up {pct(t.conversion.followUpRate)}</Badge>}
            value={int(t.sales.followUp)} detail={`${money(t.sales.valueFollowUpCents, 'BRL', true)} · tempo médio até a venda: ${days(t.sales.averageFollowUpSeconds)}`} />
          <Card title="Vendas no total" help="Todos os negócios ganhos no período, com e sem call."
            icon={<HandCoins size={18} />} badge={<Change now={t.sales.valueCents} before={p.sales.valueCents} />}
            value={money(t.sales.valueCents, 'BRL', true)} detail={`${plural(t.sales.total, 'venda', 'vendas')} · ${int(t.sales.withoutCall)} sem call`} />
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Funil do período" description="Do primeiro contato à venda, com a passagem de cada etapa.">
          <ul className="flex flex-col gap-2.5">
            <Step label="Leads contatados" value={t.contacted} max={funnelMax} />
            <Step label="Calls agendadas" value={t.calls.scheduled} max={funnelMax} rate={pass(t.calls.scheduled, t.contacted, 'dos contatados')} />
            <Step label="Calls realizadas" value={t.calls.held} max={funnelMax} rate={pass(t.calls.held, t.calls.scheduled, 'das agendadas')} />
            <Step label="Vendas (call + follow-up)" value={t.sales.onCall + t.sales.followUp} max={funnelMax}
              rate={pass(t.sales.onCall + t.sales.followUp, t.calls.held, 'das realizadas')} />
          </ul>
        </Panel>
        <Panel title="Conversão de quem fez call" description="Pessoas com call realizada no período (a primeira call de cada uma) e o que aconteceu depois.">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ['Compraram na call', pct(t.conversion.onCallRate), `${t.conversion.onCall} de ${t.conversion.people}`],
              ['Compraram no follow-up', pct(t.conversion.followUpRate), `${t.conversion.followUp} de ${afterCall} que não compraram na call`],
              ['Tempo médio no follow-up', days(t.sales.averageFollowUpSeconds), 'da primeira call até a venda'],
            ].map(([k, v, d]) => (
              <div key={k} className="rounded-[10px] border border-line p-3"><dt className="text-[13px] text-muted">{k}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd><dd className="text-[12px] text-muted">{d}</dd></div>
            ))}
          </dl>
        </Panel>
      </div>

      {s.daily.length > 1 ? (
        <section aria-labelledby="ind-dias" className="flex flex-col gap-3">
          <h2 id="ind-dias" className="text-lg font-semibold">Dia a dia</h2>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Leads contatados por dia">
              <LineChart label="Leads contatados por dia" points={s.daily.map((d) => ({ x: d.day, y: d.contacted }))} format={(v) => String(Math.round(v))} />
            </Panel>
            <Panel title="Calls realizadas por dia">
              <LineChart label="Calls realizadas por dia" points={s.daily.map((d) => ({ x: d.day, y: d.held }))} format={(v) => String(Math.round(v))} />
            </Panel>
            <Panel title="Vendas por dia" description="Na call e no follow-up.">
              <LineChart label="Vendas por dia" points={s.daily.map((d) => ({ x: d.day, y: d.salesOnCall + d.salesFollowUp }))} format={(v) => String(Math.round(v))} />
            </Panel>
          </div>
        </section>
      ) : null}

      <Panel title="Por vendedor" description="Quem fez o contato, é dono da call ou do negócio ganho.">
        {!s.sellers.length ? <p className="text-[13px] text-muted">Sem movimento no período.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Indicadores por vendedor">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-line text-right text-[12px] text-muted">
                <th scope="col" className="py-1.5 text-left font-medium">Vendedor</th>
                <th scope="col" className="py-1.5 font-medium">Contatados</th>
                <th scope="col" className="py-1.5 font-medium">Agendadas</th>
                <th scope="col" className="py-1.5 font-medium">Realizadas</th>
                <th scope="col" className="py-1.5 font-medium">Comparec.</th>
                <th scope="col" className="py-1.5 font-medium">Vendas na call</th>
                <th scope="col" className="py-1.5 font-medium">Conv. call</th>
                <th scope="col" className="py-1.5 font-medium">Follow-up</th>
                <th scope="col" className="py-1.5 font-medium">Conv. follow-up</th>
                <th scope="col" className="py-1.5 font-medium">Faturamento</th>
              </tr></thead>
              <tbody>{s.sellers.map((v) => (
                <tr key={v.id} className="border-b border-line text-right tabular-nums last:border-0">
                  <th scope="row" className="py-2 text-left font-normal">{v.name}</th>
                  <td className="py-2">{int(v.contacted)}</td>
                  <td className="py-2">{int(v.calls.scheduled)}</td>
                  <td className="py-2">{int(v.calls.held)}</td>
                  <td className="py-2">{pct(v.calls.attendanceRate)}</td>
                  <td className="py-2">{int(v.sales.onCall)}</td>
                  <td className="py-2">{pct(v.conversion.onCallRate)}</td>
                  <td className="py-2">{int(v.sales.followUp)}</td>
                  <td className="py-2">{pct(v.conversion.followUpRate)}</td>
                  <td className="py-2">{money(v.sales.valueCents, 'BRL', true)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <details className="rounded-[10px] border border-line bg-surface p-4 text-[13px]">
        <summary className="cursor-pointer font-medium">Como os números são calculados</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted">
          <li><strong className="text-ink">Call</strong> é uma atividade do tipo Ligação ou Reunião na agenda. Ao concluir, o CRM pergunta como foi: realizada, não compareceu ou remarcada.</li>
          <li><strong className="text-ink">Agendada</strong>: criada no período. <strong className="text-ink">Realizada</strong>: marcada para o período e concluída como realizada.</li>
          <li><strong className="text-ink">Venda na call</strong>: negócio ganho no mesmo dia de uma call realizada com a pessoa (o próprio negócio, o contato ou o lead). <strong className="text-ink">Follow-up</strong>: ganho em dia posterior a uma call realizada. Sem call: ganho sem call antes.</li>
          <li><strong className="text-ink">Conversão</strong>: das pessoas com call realizada no período, quantas compraram no dia; e, das que não compraram no dia, quantas compraram depois (até hoje).</li>
          <li>Para os números saírem certos, a call precisa estar ligada ao contato, lead ou negócio, e o negócio precisa ser marcado como ganho.</li>
          <li>Os dias seguem o fuso da empresa ({s.period.timezone}).</li>
        </ul>
      </details>
    </div>
  );
}
