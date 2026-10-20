'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useQueryState } from '@/lib/use-query-state';
import { ACTIVITY_LABEL, fmtTime, statusBody, type Activity, type CallOutcome } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory } from '@/components/crm/data';
import { ActivityDialog } from '@/components/crm/activity-dialog';
import { ActivityRow } from '@/components/crm/record-panels';
import { Button } from '@/components/ui/button';
import { Empty, LoadError, Loading } from '@/components/ui/states';
import { PageHeader } from '@/components/ui/misc';

type View = 'dia' | 'semana' | 'mes' | 'tarefas';
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function range(view: View, day: Date): { from: Date; to: Date } {
  if (view === 'dia') return { from: startOfDay(day), to: addDays(startOfDay(day), 1) };
  if (view === 'semana') {
    const from = addDays(startOfDay(day), -day.getDay());
    return { from, to: addDays(from, 7) };
  }
  const first = new Date(day.getFullYear(), day.getMonth(), 1);
  const from = addDays(first, -first.getDay());
  return { from, to: addDays(from, 42) };
}

export default function AgendaPage() {
  return <Suspense><Agenda /></Suspense>;
}

function Agenda() {
  const { me, can } = useSession();
  const { data: dir } = useDirectory();
  const [f, setF] = useQueryState({ visao: 'semana', dia: iso(new Date()), pessoa: '', prazo: 'overdue', atividade: '' });
  const view = f.visao as View;
  const day = useMemo(() => { const [y, m, d] = f.dia.split('-').map(Number); return new Date(y!, (m ?? 1) - 1, d ?? 1); }, [f.dia]);
  const [dialog, setDialog] = useState<{ activity: Activity | null; start?: Date } | null>(null);
  const owner = f.pessoa || dir?.me || '';
  // Link de lembrete: abre a atividade direto.
  useEffect(() => {
    if (!f.atividade) return;
    api<Activity>('GET', `/api/v1/activities/${f.atividade}`)
      .then((a) => setDialog({ activity: a }))
      .catch(() => undefined)
      .finally(() => setF({ atividade: '' }));
  }, [f.atividade]); // eslint-disable-line react-hooks/exhaustive-deps
  const teamScope = me.permissions['tasks:manage'] !== 'own';

  const { from, to } = range(view, day);
  const qs = view === 'tarefas'
    ? new URLSearchParams({ status: 'open', due: f.prazo, limit: '300', ...(owner ? { ownerId: owner } : {}) })
    : new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), status: 'all', limit: '1000', ...(owner ? { ownerId: owner } : {}) });
  const list = useLoad(() => (owner || view === 'tarefas' ? api<Activity[]>('GET', `/api/v1/activities?${qs}`) : Promise.resolve([] as Activity[])), [qs.toString()]);

  async function toggle(a: Activity, outcome?: CallOutcome) {
    await api('POST', `/api/v1/activities/${a.id}/status`, statusBody(a, outcome)).catch(() => undefined);
    void list.reload();
  }
  const step = (n: number) => {
    const next = view === 'dia' ? addDays(day, n) : view === 'semana' ? addDays(day, 7 * n) : new Date(day.getFullYear(), day.getMonth() + n, 1);
    setF({ dia: iso(next) });
  };
  const title = view === 'mes'
    ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(day)
    : view === 'semana'
      ? `${new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(from)} – ${new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).format(addDays(to, -1))}`
      : new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(day);

  if (!can('tasks:manage')) {
    return <div className="mx-auto max-w-5xl"><PageHeader title="Agenda" /><Empty title="Seu perfil não inclui tarefas e agenda" /></div>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageHeader title="Agenda" actions={<Button onClick={() => setDialog({ activity: null, start: view === 'tarefas' ? undefined : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9) })}><Plus size={16} aria-hidden />Nova atividade</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Visão" className="flex rounded-[6px] border border-line bg-surface p-0.5">
          {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['tarefas', 'Tarefas']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setF({ visao: k })}
              className={`h-9 rounded-[5px] px-3 text-sm font-medium ${view === k ? 'bg-surface-2 text-ink' : 'text-muted'}`}>{l}</button>
          ))}
        </div>
        {view !== 'tarefas' ? (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Anterior" onClick={() => step(-1)} className="flex size-10 items-center justify-center rounded-[6px] border border-line bg-surface"><ChevronLeft size={16} aria-hidden /></button>
            <Button variant="secondary" onClick={() => setF({ dia: iso(new Date()) })}>Hoje</Button>
            <button type="button" aria-label="Próximo" onClick={() => step(1)} className="flex size-10 items-center justify-center rounded-[6px] border border-line bg-surface"><ChevronRight size={16} aria-hidden /></button>
            <h2 className="ml-2 text-base font-semibold first-letter:uppercase" aria-live="polite">{title}</h2>
          </div>
        ) : (
          <div role="group" aria-label="Prazo" className="flex rounded-[6px] border border-line bg-surface p-0.5">
            {([['overdue', 'Atrasadas'], ['today', 'Hoje'], ['week', 'Próximos 7 dias'], ['none', 'Sem data']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={f.prazo === k} onClick={() => setF({ prazo: k })}
                className={`h-9 rounded-[5px] px-3 text-sm font-medium ${f.prazo === k ? 'bg-surface-2 text-ink' : 'text-muted'}`}>{l}</button>
            ))}
          </div>
        )}
        {teamScope ? (
          <select aria-label="Agenda de" value={owner} onChange={(e) => setF({ pessoa: e.target.value })} className="ml-auto h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
            {(dir?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.id === dir?.me ? 'Minha agenda' : m.name}</option>)}
          </select>
        ) : null}
      </div>

      {list.error ? <LoadError error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : view === 'tarefas' ? (
        <section aria-label="Tarefas" className="rounded-[10px] border border-line bg-surface p-4">
          {!list.data.length ? <Empty title={{ overdue: 'Nada atrasado', today: 'Nada para hoje', week: 'Nada nos próximos 7 dias', none: 'Nenhuma tarefa sem data' }[f.prazo] ?? 'Nada aqui'} />
            : <div className="flex flex-col gap-3">{list.data.map((a) => <ActivityRow key={a.id} a={a} onToggle={(o) => toggle(a, o)} onEdit={() => setDialog({ activity: a })} />)}</div>}
        </section>
      ) : view === 'mes' ? (
        <MonthGrid from={from} month={day.getMonth()} items={list.data} onOpen={(a) => setDialog({ activity: a })} onDay={(d) => setF({ visao: 'dia', dia: iso(d) })} />
      ) : (
        <div className={`grid gap-2 ${view === 'semana' ? 'md:grid-cols-7' : ''}`}>
          {Array.from({ length: view === 'semana' ? 7 : 1 }, (_, i) => addDays(from, i)).map((d) => {
            const items = list.data!.filter((a) => a.startsAt && sameDay(new Date(a.startsAt), d));
            const today = sameDay(d, new Date());
            return (
              <section key={d.toISOString()} aria-label={new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d)}
                className={`flex min-h-[160px] flex-col rounded-[10px] border bg-surface ${today ? 'border-primary' : 'border-line'}`}>
                <header className="flex items-baseline justify-between border-b border-line px-3 py-2">
                  <span className="text-[12px] font-medium uppercase text-muted">{WEEK[d.getDay()]}</span>
                  <span className={`text-sm font-semibold ${today ? 'text-accent' : ''}`}>{d.getDate()}</span>
                </header>
                <ul className="flex flex-col gap-1.5 p-2">
                  {items.map((a) => <li key={a.id}><EventChip a={a} onOpen={() => setDialog({ activity: a })} /></li>)}
                  {!items.length ? <li className="px-1 text-[12px] text-muted">Livre</li> : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <ActivityDialog open={!!dialog} activity={dialog?.activity} defaultStart={dialog?.start} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void list.reload(); }} />
    </div>
  );
}

function EventChip({ a, onOpen }: { a: Activity; onOpen: () => void }) {
  const done = a.status === 'done';
  return (
    <button type="button" onClick={onOpen}
      className={`flex w-full flex-col rounded-[6px] border-l-[3px] px-2 py-1.5 text-left text-[12px] hover:bg-surface-2 ${done ? 'border-ok bg-ok-soft/40 text-muted' : a.overdue ? 'border-bad bg-bad-soft/40' : 'border-primary bg-accent-soft/50'}`}>
      <span className="font-medium text-ink">{a.allDay ? 'Dia inteiro' : fmtTime.format(new Date(a.startsAt!))}{a.endsAt && !a.allDay ? `–${fmtTime.format(new Date(a.endsAt))}` : ''}</span>
      <span className={`truncate ${done ? 'line-through' : ''}`}>{a.title}</span>
      <span className="text-muted">{ACTIVITY_LABEL[a.type]}{a.contact ? ` · ${a.contact.name}` : ''}</span>
    </button>
  );
}

function MonthGrid({ from, month, items, onOpen, onDay }: { from: Date; month: number; items: Activity[]; onOpen: (a: Activity) => void; onDay: (d: Date) => void }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-[10px] border border-line bg-line" style={{ gap: 1 }}>
        {WEEK.map((w) => <div key={w} className="bg-surface-2 px-2 py-1.5 text-[12px] font-medium uppercase text-muted">{w}</div>)}
        {days.map((d) => {
          const list = items.filter((a) => a.startsAt && sameDay(new Date(a.startsAt), d));
          const today = sameDay(d, new Date());
          return (
            <div key={d.toISOString()} className={`flex min-h-[104px] flex-col gap-1 p-1.5 ${d.getMonth() === month ? 'bg-surface' : 'bg-surface-2'}`}>
              <button type="button" onClick={() => onDay(d)} aria-label={`Abrir ${d.toLocaleDateString('pt-BR')}`}
                className={`flex size-7 items-center justify-center self-end rounded-full text-[12px] font-medium ${today ? 'bg-primary text-primary-fg' : d.getMonth() === month ? '' : 'text-muted'}`}>{d.getDate()}</button>
              {list.slice(0, 3).map((a) => (
                <button key={a.id} type="button" onClick={() => onOpen(a)}
                  className={`truncate rounded-[4px] px-1.5 py-0.5 text-left text-[11px] ${a.status === 'done' ? 'bg-ok-soft text-muted line-through' : a.overdue ? 'bg-bad-soft' : 'bg-accent-soft'}`}>
                  {a.allDay ? '' : `${fmtTime.format(new Date(a.startsAt!))} `}{a.title}
                </button>
              ))}
              {list.length > 3 ? <button type="button" onClick={() => onDay(d)} className="text-left text-[11px] font-medium text-accent">+{list.length - 3} mais</button> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
