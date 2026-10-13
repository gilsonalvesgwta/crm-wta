'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { ACTIVITY_LABEL, type Activity, type ActivityType, type Ref } from '@/lib/crm';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { EntityPicker, MemberSelect } from './pickers';
import { useDirectory } from './data';

export type ActivityLinks = { contact?: Ref | null; organization?: Ref | null; deal?: Ref | null; lead?: Ref | null };

/** Data e hora local do navegador no formato do campo datetime-local. */
export function toLocalInput(iso: string | null | undefined, dateOnly = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dateOnly ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string, dateOnly: boolean): string | null {
  if (!v) return null;
  const d = dateOnly ? new Date(`${v}T00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const REMINDERS: [string, string][] = [['', 'Sem lembrete'], ['0', 'Na hora'], ['10', '10 minutos antes'], ['30', '30 minutos antes'], ['60', '1 hora antes'], ['1440', '1 dia antes']];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Criar ou editar tarefa, ligação, reunião... com repetição e lembrete. */
export function ActivityDialog({ open, onClose, onSaved, activity, links, defaultStart }: {
  open: boolean; onClose: () => void; onSaved: (a: Activity) => void; activity?: Activity | null; links?: ActivityLinks; defaultStart?: Date;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={activity ? 'Editar atividade' : 'Nova atividade'} width={620}>
      <ActivityForm activity={activity ?? null} links={links} defaultStart={defaultStart} onSaved={onSaved} onCancel={onClose} />
    </Dialog>
  );
}

function ActivityForm({ activity, links, defaultStart, onSaved, onCancel }: {
  activity: Activity | null; links?: ActivityLinks; defaultStart?: Date; onSaved: (a: Activity) => void; onCancel: () => void;
}) {
  const { data: dir } = useDirectory();
  const [type, setType] = useState<ActivityType>(activity?.type ?? 'task');
  const [title, setTitle] = useState(activity?.title ?? '');
  const [description, setDescription] = useState(activity?.description ?? '');
  const [allDay, setAllDay] = useState(activity?.allDay ?? false);
  const [start, setStart] = useState(toLocalInput(activity?.startsAt ?? defaultStart?.toISOString(), activity?.allDay ?? false));
  const [end, setEnd] = useState(toLocalInput(activity?.endsAt));
  const [priority, setPriority] = useState(activity?.priority ?? 'normal');
  const [owner, setOwner] = useState<string | null>(activity?.owner?.id ?? null);
  const [reminder, setReminder] = useState(activity?.reminderMinutes != null ? String(activity.reminderMinutes) : '');
  const [contact, setContact] = useState<Ref | null>(activity?.contact ?? links?.contact ?? null);
  const [organization, setOrganization] = useState<Ref | null>(activity?.organization ?? links?.organization ?? null);
  const [deal, setDeal] = useState<Ref | null>(activity?.deal ? { id: activity.deal.id, name: activity.deal.title } : links?.deal ?? null);
  const lead = activity?.lead ? { id: activity.lead.id, name: activity.lead.title } : links?.lead ?? null;
  const [repeat, setRepeat] = useState<'' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('');
  const [interval, setInterval] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endMode, setEndMode] = useState<'never' | 'count' | 'until'>('never');
  const [count, setCount] = useState('10');
  const [until, setUntil] = useState('');
  const [scope, setScope] = useState<'this' | 'following'>('this');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const ownerValue = owner ?? dir?.me ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const startsAt = fromLocalInput(start, allDay);
    const body: Record<string, unknown> = {
      type, title, description: description || null, allDay, priority, startsAt,
      endsAt: allDay ? null : fromLocalInput(end, false),
      reminderMinutes: reminder === '' || !startsAt ? null : Number(reminder),
      contactId: contact?.id ?? null, organizationId: organization?.id ?? null, dealId: deal?.id ?? null, leadId: lead?.id ?? null,
      ...(ownerValue ? { ownerId: ownerValue } : {}),
    };
    if (!activity && repeat) {
      body.recurrence = {
        freq: repeat, interval: Number(interval) || 1,
        ...(repeat === 'weekly' && weekdays.length ? { byWeekday: weekdays } : {}),
        ...(endMode === 'count' ? { count: Number(count) || 1 } : {}),
        ...(endMode === 'until' && until ? { until } : {}),
      };
    }
    if (activity) body.scope = scope;
    try {
      const a = activity
        ? await api<Activity>('PATCH', `/api/v1/activities/${activity.id}`, body)
        : await api<Activity>('POST', '/api/v1/activities', body);
      onSaved(a);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Select label="Tipo" value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
          {Object.entries(ACTIVITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Field label="Título" value={title} onChange={(e) => setTitle(e.target.value)} error={err?.fieldError('title')} required />
      </div>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allDay}
          onChange={(e) => { setAllDay(e.target.checked); setStart(start ? (e.target.checked ? start.slice(0, 10) : `${start.slice(0, 10)}T09:00`) : ''); }} />
        Dia inteiro
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={type === 'task' ? 'Prazo' : 'Início'} type={allDay ? 'date' : 'datetime-local'} value={start}
          onChange={(e) => setStart(e.target.value)} error={err?.fieldError('startsAt')} hint={type === 'task' ? 'Opcional para tarefas.' : undefined} />
        {!allDay ? <Field label="Fim" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} error={err?.fieldError('endsAt')} /> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <MemberSelect value={ownerValue} onChange={setOwner} allowNone={false} />
        <Select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value as Activity['priority'])}>
          <option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option>
        </Select>
        <Select label="Lembrete" value={reminder} onChange={(e) => setReminder(e.target.value)} error={err?.fieldError('reminderMinutes')} disabled={!start}>
          {REMINDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      {!activity ? (
        <fieldset className="flex flex-col gap-3 rounded-[8px] border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">Repetição</legend>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Select label="Repetir" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)} disabled={!start}>
              <option value="">Não repete</option><option value="daily">Todo dia</option><option value="weekly">Toda semana</option>
              <option value="monthly">Todo mês</option><option value="yearly">Todo ano</option>
            </Select>
            {repeat ? <Field label="A cada" type="number" min={1} max={99} value={interval} onChange={(e) => setInterval(e.target.value)} /> : null}
          </div>
          {repeat === 'weekly' ? (
            <div role="group" aria-label="Dias da semana" className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w, i) => (
                <button key={w} type="button" aria-pressed={weekdays.includes(i)}
                  onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i])}
                  className={`h-9 min-w-11 rounded-[6px] border px-2 text-sm font-medium ${weekdays.includes(i) ? 'border-primary bg-accent-soft' : 'border-line'}`}>{w}</button>
              ))}
            </div>
          ) : null}
          {repeat ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Termina" value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)}>
                <option value="never">Nunca</option><option value="count">Depois de algumas vezes</option><option value="until">Em uma data</option>
              </Select>
              {endMode === 'count' ? <Field label="Quantas vezes" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} /> : null}
              {endMode === 'until' ? <Field label="Até" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /> : null}
            </div>
          ) : null}
          {err?.fieldError('recurrence') ? <p className="text-[13px] text-bad">{err.fieldError('recurrence')}</p> : null}
        </fieldset>
      ) : activity.seriesId ? (
        <Select label="Aplicar a" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="this">Só esta ocorrência</option><option value="following">Esta e as seguintes</option>
        </Select>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <EntityPicker kind="contact" label="Contato" value={contact} onChange={setContact} />
        <EntityPicker kind="organization" label="Organização" value={organization} onChange={setOrganization} />
        <EntityPicker kind="deal" label="Negócio" value={deal} onChange={setDeal} />
      </div>
      <Textarea label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={busy} disabled={!title.trim()}>{activity ? 'Salvar' : 'Criar atividade'}</Button>
      </div>
    </form>
  );
}
