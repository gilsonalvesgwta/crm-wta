'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, ListTodo, Mail, Megaphone, MessageCircle, Pencil, Plus, XCircle, Zap } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { useSession } from '@/components/shell/session';
import { useDirectory } from '@/components/crm/data';
import { ContactsTabs } from '@/components/crm/contacts-tabs';
import { ScheduleDialog, type ScheduledMessage } from '@/components/crm/schedule-dialog';
import { PageHeader, Pagination, SearchBox } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

type Kind = 'message' | 'automation' | 'campaign' | 'task';
type Item = {
  id: string; kind: Kind; title: string; detail: string | null; channel: string | null; when: string; status: string;
  contact: { id: string; name: string } | null; owner: { id: string; name: string } | null; link: string; error: string | null;
};
type Result = { items: Item[]; total: number; page: number; pageSize: number; counts: Record<Kind, number> };

const KIND: Record<Kind, { label: string; icon: React.ReactNode }> = {
  message: { label: 'Mensagens', icon: <CalendarClock size={15} aria-hidden /> },
  automation: { label: 'Automações', icon: <Zap size={15} aria-hidden /> },
  campaign: { label: 'Campanhas', icon: <Megaphone size={15} aria-hidden /> },
  task: { label: 'Tarefas', icon: <ListTodo size={15} aria-hidden /> },
};
const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  pending: { label: 'Agendada', tone: 'info' }, sending: { label: 'Enviando', tone: 'info' }, sent: { label: 'Enviada', tone: 'ok' },
  failed: { label: 'Não saiu', tone: 'bad' }, canceled: { label: 'Cancelada', tone: 'neutral' }, overdue: { label: 'Atrasada', tone: 'warn' },
  done: { label: 'Concluída', tone: 'ok' }, scheduled: { label: 'Agendada', tone: 'info' }, paused: { label: 'Pausada', tone: 'warn' },
};
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function ScheduledPage() {
  return <Suspense><Scheduled /></Suspense>;
}

function Scheduled() {
  const { can } = useSession();
  const dir = useDirectory();
  const [f, setF] = useQueryState({ tipo: '', status: 'pending', periodo: '30', pessoa: '', q: '', pagina: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  const [data, setData] = useState<Result | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [canceling, setCanceling] = useState<Item | null>(null);

  useEffect(() => { if (dq !== f.q) setF({ q: dq, pagina: '1' }); }, [dq, f.q, setF]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status: f.status, page: f.pagina, pageSize: '30' });
    if (f.tipo) qs.set('kind', f.tipo);
    if (f.pessoa) qs.set('ownerId', f.pessoa);
    if (f.q) qs.set('q', f.q);
    if (f.periodo && f.status === 'pending') {
      qs.set('to', new Date(Date.now() + Number(f.periodo) * 86_400_000).toISOString());
    }
    if (f.periodo && f.status === 'done') qs.set('from', new Date(Date.now() - Number(f.periodo) * 86_400_000).toISOString());
    try {
      setData(await api<Result>('GET', `/api/v1/scheduled?${qs}`));
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível carregar.'));
    }
  }, [f.status, f.pagina, f.tipo, f.pessoa, f.q, f.periodo]);
  useEffect(() => { void load(); }, [load]);

  async function openEdit(i: Item) {
    try {
      setEditing(await api<ScheduledMessage>('GET', `/api/v1/scheduled-messages/${i.id}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível abrir.'));
    }
  }

  // Agrupa por dia.
  const groups: [string, Item[]][] = [];
  for (const i of data?.items ?? []) {
    const k = dayFmt.format(new Date(i.when));
    const g = groups.at(-1);
    if (g && g[0] === k) g[1].push(i); else groups.push([k, [i]]);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Contatos" subtitle="Mensagens agendadas, próximos passos de automações, campanhas e tarefas."
        actions={can('scheduled:manage') ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Agendar mensagem</Button> : undefined} />
      <ContactsTabs />
      {msg ? <Alert tone="success">{msg}</Alert> : null}

      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Tipo" className="flex flex-wrap gap-1">
          {([['', 'Todas'], ...Object.entries(KIND).map(([k, v]) => [k, v.label])] as [string, string][]).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={f.tipo === v} onClick={() => setF({ tipo: v, pagina: '1' })}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${f.tipo === v ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>
              {label}{v && data ? <span className="text-[12px] opacity-80">{data.counts[v as Kind]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} label="Buscar nas ações agendadas" placeholder="Buscar por contato ou texto" className="min-w-[220px] flex-1" />
          <select aria-label="Situação" value={f.status} onChange={(e) => setF({ status: e.target.value, pagina: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
            <option value="pending">Pendentes</option><option value="done">Concluídas</option><option value="all">Todas</option>
          </select>
          <select aria-label="Período" value={f.periodo} onChange={(e) => setF({ periodo: e.target.value, pagina: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
            <option value="7">{f.status === 'done' ? 'Últimos' : 'Próximos'} 7 dias</option>
            <option value="30">{f.status === 'done' ? 'Últimos' : 'Próximos'} 30 dias</option>
            <option value="">Qualquer data</option>
          </select>
          <select aria-label="Pessoa" value={f.pessoa} onChange={(e) => setF({ pessoa: e.target.value, pagina: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
            <option value="">Todas as pessoas</option>
            {(dir.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.id === dir.data?.me ? 'Só eu' : m.name}</option>)}
          </select>
        </div>
      </div>

      <Panel title="Agenda de ações">
        {err ? <LoadError error={err} retry={load} /> : !data ? <Loading /> : data.items.length === 0 ? (
          <p className="text-[13px] text-muted">Nada {f.status === 'done' ? 'concluído' : 'agendado'} com esse filtro.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map(([day, items]) => (
              <section key={day} aria-label={day}>
                <h3 className="mb-2 text-[13px] font-semibold capitalize text-muted">{day}</h3>
                <ul className="flex flex-col">
                  {items.map((i) => {
                    const st = STATUS[i.status] ?? { label: i.status, tone: 'neutral' as const };
                    return (
                      <li key={`${i.kind}-${i.id}`} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-3 border-t border-line py-3 first:border-t-0">
                        <span className="pt-0.5 text-sm font-semibold tabular-nums">{timeFmt.format(new Date(i.when))}</span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-muted" title={KIND[i.kind].label}>{KIND[i.kind].icon}{i.channel === 'email' ? <Mail size={13} aria-label="E-mail" /> : i.channel === 'whatsapp' ? <MessageCircle size={13} aria-label="WhatsApp" /> : null}</span>
                            <Link href={i.link} className="font-medium hover:underline">{i.title}</Link>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </p>
                          <p className="text-[13px] text-muted">
                            {i.contact ? <Link href={`/contatos/${i.contact.id}`} className="text-accent underline underline-offset-2">{i.contact.name}</Link> : null}
                            {i.contact && (i.owner || i.detail) ? ' · ' : ''}{i.owner ? `por ${i.owner.name}` : ''}
                          </p>
                          {i.detail ? <p className="mt-0.5 line-clamp-2 text-[13px]">{i.detail}</p> : null}
                          {i.error ? <p className="text-[13px] text-bad">{i.error}</p> : null}
                        </div>
                        {i.kind === 'message' && i.status === 'pending' && can('scheduled:manage') ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" aria-label={`Mudar a mensagem para ${i.contact?.name}`} onClick={() => void openEdit(i)}><Pencil size={16} aria-hidden /></Button>
                            <Button variant="ghost" aria-label={`Cancelar a mensagem para ${i.contact?.name}`} onClick={() => setCanceling(i)}><XCircle size={16} aria-hidden /></Button>
                          </div>
                        ) : <span />}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ pagina: String(p) })} />
          </div>
        )}
      </Panel>

      {creating ? <ScheduleDialog open onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setMsg('Mensagem agendada.'); void load(); }} /> : null}
      {editing ? <ScheduleDialog open initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMsg('Agendamento atualizado.'); void load(); }} /> : null}
      <Confirm open={!!canceling} title="Cancelar esta mensagem agendada?" confirmLabel="Cancelar mensagem"
        onConfirm={async () => {
          const i = canceling!;
          setCanceling(null);
          try { await api('POST', `/api/v1/scheduled-messages/${i.id}/cancel`); setMsg('Mensagem cancelada.'); await load(); } catch (e) { setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível cancelar.')); }
        }}
        onCancel={() => setCanceling(null)}>
        Ela não será enviada.
      </Confirm>
    </div>
  );
}
