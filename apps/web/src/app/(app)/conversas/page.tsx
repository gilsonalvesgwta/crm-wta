'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, MessageCircle } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { phone, relative, type Contact } from '@/lib/crm';
import { preview, type Conversation } from '@/lib/messages';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { useSession } from '@/components/shell/session';
import { MessageThread } from '@/components/crm/message-thread';
import { Avatar, PageHeader, SearchBox } from '@/components/ui/misc';
import { Alert } from '@/components/ui/alert';
import { LoadError, Loading } from '@/components/ui/states';

export default function ConversationsPage() {
  return <Suspense><Conversations /></Suspense>;
}

function Conversations() {
  const { can } = useSession();
  const [f, setF] = useQueryState({ c: '', unread: '', q: '' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq, f.q, setF]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ pageSize: '50' });
      if (f.unread) qs.set('unread', '1');
      if (f.q) qs.set('q', f.q);
      const r = await api<{ items: Conversation[] }>('GET', `/api/v1/conversations?${qs}`);
      setItems(r.items);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível carregar as conversas.'));
    }
  }, [f.unread, f.q]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10000);
    window.addEventListener('crm-unread', load);
    return () => { clearInterval(t); window.removeEventListener('crm-unread', load); };
  }, [load]);

  if (!can('conversations:reply')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader title="Conversas" subtitle="WhatsApp e e-mail dos contatos que você atende, da mais recente para a mais antiga." />
      <div className="grid min-h-[620px] overflow-hidden rounded-[10px] border border-line bg-surface lg:grid-cols-[340px_minmax(0,1fr)]">
        <section aria-label="Lista de conversas" className={`flex min-w-0 flex-col border-line lg:border-r ${f.c ? 'max-lg:hidden' : ''}`}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <SearchBox value={q} onChange={setQ} label="Buscar conversa pelo nome" placeholder="Buscar pelo nome" />
            <div role="group" aria-label="Filtro" className="flex gap-1">
              {[['', 'Todas'], ['1', 'Não lidas']].map(([v, label]) => (
                <button key={v} type="button" aria-pressed={f.unread === v} onClick={() => setF({ unread: v })}
                  className={`h-8 rounded-full px-3 text-[13px] font-medium ${f.unread === v ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {err ? <div className="p-3"><Alert tone="error">{err.title}</Alert></div> : null}
          {!items ? <Loading /> : items.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-muted">
              {f.unread || f.q ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa ainda. As mensagens recebidas pelo WhatsApp e os e-mails enviados aparecem aqui.'}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {items.map((c) => {
                const active = c.id === f.c;
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setF({ c: c.id })} aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left ${active ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
                      <Avatar name={c.name} size={36} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.name}</span>
                          <span className="shrink-0 text-[12px] text-muted">{relative(c.last.createdAt)}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-[13px] text-muted">
                          {c.last.channel === 'email' ? <Mail size={13} aria-hidden className="shrink-0" /> : <MessageCircle size={13} aria-hidden className="shrink-0" />}
                          <span className="truncate">{c.last.direction === 'out' ? 'Você: ' : ''}{preview(c.last)}</span>
                          {c.unread ? <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-fg">{c.unread}<span className="sr-only"> não lidas</span></span> : null}
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
          {f.c ? <Thread key={f.c} contactId={f.c} onBack={() => setF({ c: '' })} onActivity={load} />
            : <p className="m-auto p-6 text-center text-[13px] text-muted">Escolha uma conversa na lista.</p>}
        </section>
      </div>
    </div>
  );
}

function Thread({ contactId, onBack, onActivity }: { contactId: string; onBack: () => void; onActivity: () => void }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    api<Contact>('GET', `/api/v1/contacts/${contactId}`).then(setContact).catch((e) => setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível abrir.')));
  }, [contactId]);
  if (err) return <div className="p-4"><LoadError error={err} /></div>;
  if (!contact) return <Loading />;
  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Voltar para a lista" className="lg:hidden"><ArrowLeft size={18} aria-hidden /></button>
        <Avatar name={contact.name} size={36} />
        <div className="min-w-0">
          <Link href={`/contatos/${contact.id}`} className="font-semibold hover:underline">{contact.name}</Link>
          <p className="truncate text-[13px] text-muted">{[contact.phones[0] ? phone(contact.phones[0].number) : null, contact.emails[0]?.email].filter(Boolean).join(' · ')}</p>
        </div>
      </header>
      <MessageThread contactId={contactId} canSend onActivity={onActivity} height="h-[calc(100dvh-320px)] min-h-[360px]"
        target={{ phones: contact.phones.map((p) => p.number), emails: contact.emails.map((e) => e.email) }} />
    </>
  );
}
