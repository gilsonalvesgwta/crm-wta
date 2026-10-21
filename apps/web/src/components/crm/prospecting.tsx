'use client';
import { useState, type FormEvent } from 'react';
import { Target } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useDirectory } from './data';
import { fmtDay } from './ad-spend';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';

type Mine = { today: string; funnels: { id: string; name: string; entries: { day: string; count: number }[] }[] };

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const dayName = (d: string, today: string) => (d === today ? 'Hoje' : d === addDays(today, -1) ? 'Ontem' : `${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]}, ${fmtDay(d).slice(0, 5)}`);

/** Um funil: o vendedor lança quantos prospectou num dia (hoje ou até 7 dias atrás). */
function FunnelEntry({ f, today, onSaved }: { f: Mine['funnels'][number]; today: string; onSaved: () => void }) {
  const [day, setDay] = useState(today);
  const saved = f.entries.find((e) => e.day === day)?.count;
  const [count, setCount] = useState(saved === undefined ? '' : String(saved));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) { setMsg({ ok: false, text: 'Informe um número inteiro (0 ou mais).' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      await api('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: f.id, day, count: n });
      setMsg({ ok: true, text: `Salvo: ${n} em ${dayName(day, today).toLowerCase()}.` });
      onSaved();
    } catch (e2) {
      setMsg({ ok: false, text: e2 instanceof ApiError ? (e2.errors[0]?.message ?? e2.title) : 'Não foi possível salvar.' });
    } finally {
      setBusy(false);
    }
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
      <p className="text-sm font-medium">{f.name}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-end gap-2">
        <Select label="Dia" value={day} onChange={(e) => { setDay(e.target.value); const v = f.entries.find((x) => x.day === e.target.value)?.count; setCount(v === undefined ? '' : String(v)); setMsg(null); }}>
          {days.map((d) => <option key={d} value={d}>{dayName(d, today)}</option>)}
        </Select>
        <Field label="Prospecções" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} placeholder="0" aria-label={`Prospecções em ${f.name}`} />
        <Button type="submit" loading={busy}>Salvar</Button>
      </div>
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={`text-[12px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p> : null}
      {f.entries.length ? (
        <p className="text-[12px] text-muted">Últimos dias: {f.entries.slice().sort((a, b) => b.day.localeCompare(a.day)).map((e) => `${dayName(e.day, today)} ${e.count}`).join(' · ')}</p>
      ) : null}
    </form>
  );
}

/** Cartão do Início: o vendedor lança a prospecção do dia nos funis que pedem isso. */
export function MyProspectingCard() {
  const mine = useLoad(() => api<Mine>('GET', '/api/v1/dashboard/kpis/prospecting/mine').catch(() => null), []);
  const m = mine.data;
  if (!m || !m.funnels.length) return null;
  return (
    <Panel title="Prospecção do dia" description="Quantas pessoas você abordou (ligação, mensagem, visita) em cada funil. Entra nos KPIs do funil.">
      <div className="flex flex-col gap-3">
        {m.funnels.map((f) => <FunnelEntry key={f.id} f={f} today={m.today} onSaved={() => void mine.reload()} />)}
      </div>
    </Panel>
  );
}

/** No painel do funil: o gestor lança ou corrige a prospecção de qualquer vendedor, em qualquer dia. */
export function ProspectingPanel({ funnelId, from, to, onChange }: { funnelId: string; from: string; to: string; onChange: () => void }) {
  const dir = useDirectory();
  const [who, setWho] = useState('');
  const [day, setDay] = useState(to);
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId, day, count: Number(count || 0), membershipId: who || undefined });
      setMsg({ ok: true, text: 'Salvo.' });
      setCount('');
      onChange();
    } catch (e2) {
      setMsg({ ok: false, text: e2 instanceof ApiError ? (e2.errors[0]?.message ?? e2.title) : 'Não foi possível salvar.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Prospecção lançada" description={`Cada vendedor lança a própria no Início (cartão "Prospecção do dia"). Aqui você lança ou corrige a de qualquer pessoa. Período de ${fmtDay(from)} a ${fmtDay(to)}; a lista por dia fica em Conferir › Prospecções.`}>
      <form onSubmit={submit} noValidate className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_auto] sm:items-end">
        <Select label="Vendedor" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Eu mesmo</option>
          {(dir.data?.members ?? []).filter((x) => x.id !== dir.data?.me).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Field label="Dia" type="date" value={day} max={to} onChange={(e) => setDay(e.target.value)} />
        <Field label="Quantidade" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} placeholder="0" />
        <Button type="submit" loading={busy}><Target size={15} aria-hidden />Lançar</Button>
      </form>
      {msg ? <div className="mt-2">{msg.ok ? <p role="status" className="text-[12px] text-ok">{msg.text}</p> : <Alert tone="error">{msg.text}</Alert>}</div> : null}
    </Panel>
  );
}
