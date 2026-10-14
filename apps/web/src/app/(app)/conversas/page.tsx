'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Filter, Mail, MessageCircle, MessageSquareText, Plus, UserCheck } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { phone, relative, type Contact } from '@/lib/crm';
import { CONVERSATION_STATUS, preview, type Channel, type Conversation, type ConversationStatus } from '@/lib/messages';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { useSession } from '@/components/shell/session';
import { useDirectory, usePipelines, useTags } from '@/components/crm/data';
import { MessageThread } from '@/components/crm/message-thread';
import { NewConversationDialog } from '@/components/crm/new-conversation';
import { Avatar, PageHeader, SearchBox } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LoadError, Loading } from '@/components/ui/states';

type Inbox = { items: Conversation[]; total: number; counts: Record<ConversationStatus, number> };

const DEFAULTS = { c: '', q: '', ch: '', st: 'open', who: '', team: '', tag: '', deal: '', unread: '' };

export default function ConversationsPage() {
  return <Suspense><Conversations /></Suspense>;
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${pressed ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

function Conversations() {
  const { can } = useSession();
  const router = useRouter();
  const [f, setF] = useQueryState(DEFAULTS);
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  const [data, setData] = useState<Inbox | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [showFilters, setShowFilters] = useState(!!(f.who || f.team || f.tag || f.deal || f.unread));
  const [creating, setCreating] = useState(false);
  const dir = useDirectory();
  const tags = useTags();
  const pipelines = usePipelines();

  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq, f.q, setF]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ pageSize: '50', status: f.st || 'all' });
      if (f.ch) qs.set('channel', f.ch);
      if (f.q) qs.set('q', f.q);
      if (f.who) qs.set('assignee', f.who);
      if (f.team) qs.set('teamId', f.team);
      if (f.tag) qs.set('tagId', f.tag);
      if (f.deal) qs.set('deal', f.deal);
      if (f.unread) qs.set('unread', '1');
      setData(await api<Inbox>('GET', `/api/v1/conversations?${qs}`));
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível carregar as conversas.'));
    }
  }, [f.st, f.ch, f.q, f.who, f.team, f.tag, f.deal, f.unread]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10000);
    window.addEventListener('crm-unread', load);
    return () => { clearInterval(t); window.removeEventListener('crm-unread', load); };
  }, [load]);

  if (!can('conversations:reply')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;

  const filters = [f.who, f.team, f.tag, f.deal, f.unread].filter(Boolean).length;
  const items = data?.items;
  const counts = data?.counts ?? { open: 0, waiting: 0, closed: 0 };
  const statusTabs: [string, string, number | null][] = [
    ['open', 'Abertas', counts.open], ['waiting', 'Aguardando', counts.waiting], ['closed', 'Encerradas', counts.closed],
    ['all', 'Todas', counts.open + counts.waiting + counts.closed],
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader title="Conversas" subtitle="WhatsApp e e-mail dos contatos que você atende."
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/conversas/respostas" className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2">
            <MessageSquareText size={16} aria-hidden />Respostas prontas
          </Link>
          <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Nova conversa</Button>
        </div>} />
      <div className="grid min-h-[620px] overflow-hidden rounded-[10px] border border-line bg-surface lg:grid-cols-[360px_minmax(0,1fr)]">
        <section aria-label="Lista de conversas" className={`flex min-w-0 flex-col border-line lg:border-r ${f.c ? 'max-lg:hidden' : ''}`}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <SearchBox value={q} onChange={setQ} label="Buscar conversa pelo nome" placeholder="Buscar pelo nome" />
            <div role="group" aria-label="Canal" className="flex flex-wrap gap-1">
              <Chip pressed={!f.ch} onClick={() => setF({ ch: '' })}>Todos</Chip>
              <Chip pressed={f.ch === 'whatsapp'} onClick={() => setF({ ch: 'whatsapp' })}><MessageCircle size={14} aria-hidden />WhatsApp</Chip>
              <Chip pressed={f.ch === 'email'} onClick={() => setF({ ch: 'email' })}><Mail size={14} aria-hidden />E-mail</Chip>
              <button type="button" aria-expanded={showFilters} aria-controls="filtros-conversas" onClick={() => setShowFilters((v) => !v)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-muted hover:text-ink">
                <Filter size={14} aria-hidden />Filtros{filters ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-fg">{filters}</span> : null}
              </button>
            </div>
            {showFilters ? (
              <div id="filtros-conversas" className="grid grid-cols-2 gap-2 rounded-[8px] bg-surface-2 p-2">
                <Select label="Responsável" value={f.who} onChange={(e) => setF({ who: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="me">Minhas</option>
                  <option value="none">Sem responsável</option>
                  {(dir.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
                <Select label="Equipe" value={f.team} onChange={(e) => setF({ team: e.target.value })}>
                  <option value="">Todas</option>
                  {(dir.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Select label="Etiqueta" value={f.tag} onChange={(e) => setF({ tag: e.target.value })}>
                  <option value="">Todas</option>
                  {(tags.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Select label="Negócio" value={f.deal} onChange={(e) => setF({ deal: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="open">Com negócio aberto</option>
                  <option value="none">Sem negócio aberto</option>
                  {(pipelines.data ?? []).map((p) => <option key={p.id} value={p.id}>Funil: {p.name}</option>)}
                </Select>
                <label className="col-span-2 flex min-h-9 items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={!!f.unread} onChange={(e) => setF({ unread: e.target.checked ? '1' : '' })} className="size-[18px] accent-[var(--primary)]" />
                  Só não lidas
                </label>
                {filters ? <button type="button" onClick={() => setF({ who: '', team: '', tag: '', deal: '', unread: '' })} className="col-span-2 justify-self-start text-[13px] font-medium text-accent hover:underline">Limpar filtros</button> : null}
              </div>
            ) : null}
          </div>
          <div role="group" aria-label="Filtrar por estado" className="flex border-b border-line">
            {statusTabs.map(([v, label, n]) => (
              <button key={v} type="button" aria-pressed={(f.st || 'all') === v} onClick={() => setF({ st: v })}
                className={`flex h-10 flex-1 items-center justify-center gap-1 border-b-2 text-[13px] ${(f.st || 'all') === v ? 'border-primary font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'}`}>
                {label}{n !== null ? <span className="text-[12px] text-muted">{n}</span> : null}
              </button>
            ))}
          </div>
          {err ? <div className="p-3"><Alert tone="error">{err.title}</Alert></div> : null}
          {!items ? <Loading /> : items.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-muted">
              {f.q || filters || f.ch || f.st !== 'all' ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa ainda. Use "Nova conversa" para mandar a primeira mensagem.'}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {items.map((c) => {
                const active = c.id === f.c;
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setF({ c: c.id })} aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left ${active ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
                      <Avatar name={c.contact.name} size={36} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`flex min-w-0 items-center gap-1.5 truncate ${c.unread ? 'font-semibold' : 'font-medium'}`}>
                            {c.channel === 'email' ? <Mail size={14} aria-label="E-mail" className="shrink-0 text-muted" /> : <MessageCircle size={14} aria-label="WhatsApp" className="shrink-0 text-muted" />}
                            <span className="truncate">{c.contact.name}</span>
                          </span>
                          <span className="shrink-0 text-[12px] text-muted">{relative(c.lastMessageAt)}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-[13px] text-muted">
                          <span className="truncate">{c.last ? `${c.last.direction === 'out' ? 'Você: ' : ''}${preview({ ...c.last, channel: c.channel })}` : 'Sem mensagens ainda'}</span>
                          {c.unread ? <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-fg">{c.unread}<span className="sr-only"> não lidas</span></span> : null}
                        </span>
                        <span className="flex items-center gap-1.5 text-[12px] text-muted">
                          <span className="truncate">{c.assignee ? c.assignee.name : 'Sem responsável'}{c.team ? ` · ${c.team.name}` : ''}</span>
                          {f.st === 'all' ? <span className="ml-auto shrink-0">{CONVERSATION_STATUS[c.status].label}</span> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-label="Conversa" className={`flex min-w-0 flex-col ${f.c ? '' : 'max-lg:hidden'}`}>
          {f.c ? <Thread key={f.c} id={f.c} onBack={() => setF({ c: '' })} onActivity={load} />
            : <p className="m-auto p-6 text-center text-[13px] text-muted">Escolha uma conversa na lista ou comece uma nova.</p>}
        </section>
      </div>
      <NewConversationDialog open={creating} onClose={() => setCreating(false)}
        onStarted={(c) => { setCreating(false); router.push(`/conversas?c=${c.id}&st=all`); void load(); }} />
    </div>
  );
}

function Thread({ id, onBack, onActivity }: { id: string; onBack: () => void; onActivity: () => void }) {
  const { can, me } = useSession();
  const dir = useDirectory();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const canAssign = can('conversations:assign');
  const canTake = can('conversations:take') || canAssign;
  const myId = dir.data?.me ?? '';

  useEffect(() => {
    api<Conversation>('GET', `/api/v1/conversations/${id}`).then((c) => {
      setConv(c);
      // Os dados completos do contato só aparecem para quem tem o contato no alcance.
      api<Contact>('GET', `/api/v1/contacts/${c.contactId}`).then(setContact).catch(() => setContact(null));
    }).catch((e) => setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível abrir.')));
  }, [id]);

  async function save(patch: { status?: ConversationStatus; assigneeId?: string | null; teamId?: string | null }) {
    setSaveErr(null);
    try {
      setConv(await api<Conversation>('PATCH', `/api/v1/conversations/${id}`, patch));
      onActivity();
    } catch (e) {
      setSaveErr(e instanceof ApiError ? e.fieldError('assigneeId') ?? e.fieldError('teamId') ?? e.title : 'Não foi possível salvar.');
    }
  }

  if (err) return <div className="p-4"><LoadError error={err} /></div>;
  if (!conv) return <Loading />;
  const c = conv.contact;
  const channel: Channel = conv.channel;
  const target = contact
    ? { phones: contact.phones.map((p) => p.number), emails: contact.emails.map((e) => e.email) }
    : { phones: c.phone ? [c.phone] : [], emails: c.email ? [c.email] : [] };
  return (
    <>
      <header className="flex flex-col gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Voltar para a lista" className="lg:hidden"><ArrowLeft size={18} aria-hidden /></button>
          <Avatar name={c.name} size={36} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              {contact ? <Link href={`/contatos/${c.id}`} className="font-semibold hover:underline">{c.name}</Link> : <span className="font-semibold">{c.name}</span>}
              <Badge tone={channel === 'email' ? 'neutral' : 'ok'}>{channel === 'email' ? 'E-mail' : 'WhatsApp'}</Badge>
              <Badge tone={CONVERSATION_STATUS[conv.status].tone}>{CONVERSATION_STATUS[conv.status].label}</Badge>
            </p>
            <p className="truncate text-[13px] text-muted">{channel === 'email' ? c.email : c.phone ? phone(c.phone) : ''}</p>
          </div>
          {!conv.assignee && canTake && myId ? (
            <Button variant="secondary" onClick={() => void save({ assigneeId: myId })}><UserCheck size={16} aria-hidden />Assumir</Button>
          ) : null}
        </div>
        {saveErr ? <Alert tone="error">{saveErr}</Alert> : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <Select label="Estado" value={conv.status} onChange={(e) => void save({ status: e.target.value as ConversationStatus })}>
            <option value="open">Aberta</option>
            <option value="waiting">Aguardando cliente</option>
            <option value="closed">Encerrada</option>
          </Select>
          {canAssign ? (
            <Select label="Responsável" value={conv.assignee?.id ?? ''} onChange={(e) => void save({ assigneeId: e.target.value || null })}>
              <option value="">Sem responsável</option>
              {(dir.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.id === myId ? `${m.name} (você)` : m.name}</option>)}
            </Select>
          ) : (
            <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Responsável</span><span className="flex h-11 items-center text-sm">{conv.assignee?.name ?? 'Sem responsável'}</span></div>
          )}
          {canAssign ? (
            <Select label="Equipe" value={conv.team?.id ?? ''} onChange={(e) => void save({ teamId: e.target.value || null })}>
              <option value="">Sem equipe</option>
              {(dir.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          ) : (
            <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Equipe</span><span className="flex h-11 items-center text-sm">{conv.team?.name ?? 'Sem equipe'}</span></div>
          )}
        </div>
        {me.user && conv.assignee && conv.assignee.id !== myId && !canAssign ? (
          <p className="text-[12px] text-muted">Esta conversa é de {conv.assignee.name}.</p>
        ) : null}
      </header>
      <MessageThread contactId={c.id} contactName={c.name} conversation={{ id: conv.id, channel }} canSend onActivity={onActivity}
        height="h-[calc(100dvh-420px)] min-h-[340px]" target={target} />
    </>
  );
}
