'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, HeartHandshake, MessageCircle, RotateCcw, Settings2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { money, phone, type Page } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { AftersaleSettingsDialog } from '@/components/crm/aftersale-settings';
import { startConversation } from '@/components/crm/new-conversation';
import { PageHeader, Pagination, SearchBox } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Empty, LoadError, Loading } from '@/components/ui/states';

type Item = {
  id: string; title: string; valueCents: number; currency: string; closedAt: string; pipeline: string; days: number; dueAt: string;
  notifiedCount: number; lastNotifiedAt: string | null; doneAt: string | null; doneBy: string | null; note: string | null; message: string;
  contact: { id: string; name: string; firstName: string | null; phone: string | null } | null; owner: { id: string; name: string } | null;
};
type List = Page<Item> & { configured: boolean; enabled: boolean; firstDays: number };

const TABS = [['due', 'Para contatar'], ['upcoming', 'Próximos 30 dias'], ['done', 'Feitos']] as const;
const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function AftersalePage() {
  return <Suspense><Aftersale /></Suspense>;
}

function Aftersale() {
  const { can } = useSession();
  const [f, setF] = useQueryState({ tab: 'due', q: '', page: '1' });
  const q = useDebounced(f.q, 300);
  const [settings, setSettings] = useState(false);
  const [doneFor, setDoneFor] = useState<Item | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const qs = new URLSearchParams({ tab: f.tab, page: f.page, pageSize: '25' });
  if (q) qs.set('q', q);
  const list = useLoad(() => api<List>('GET', `/api/v1/aftersale?${qs}`), [qs.toString()]);
  const admin = can('pipelines:admin');
  if (!can('deals:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;

  async function undo(i: Item) {
    try {
      await api('POST', `/api/v1/aftersale/${i.id}/done`, { done: false });
      setMsg({ tone: 'success', text: `${i.contact?.name ?? i.title} voltou para a lista.` });
      await list.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.title : 'Não foi possível desfazer.' });
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Pós-venda" subtitle="Clientes que fecharam negócio e estão na hora de receber um contato da equipe."
        actions={admin ? <Button variant="secondary" onClick={() => setSettings(true)}><Settings2 size={16} aria-hidden />Configurar avisos</Button> : undefined} />
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {list.data && !list.data.enabled ? (
        <Alert tone="info">
          Os avisos de pós-venda estão desligados{list.data.configured ? '' : ' (nunca configurados)'}. A lista abaixo usa {list.data.firstDays} dias depois do ganho.
          {admin ? <> <button type="button" onClick={() => setSettings(true)} className="font-medium underline">Configurar agora</button>: escolha depois de quantos dias avisar, de quanto em quanto tempo repetir, quem recebe e a mensagem.</> : ' Peça ao administrador para ligar em “Configurar avisos”.'}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Situação" className="flex gap-1 rounded-[8px] border border-line bg-surface p-1">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={f.tab === k} onClick={() => setF({ tab: k, page: '1' })}
              className={`h-9 rounded-[6px] px-3 text-sm font-medium ${f.tab === k ? 'bg-primary text-primary-fg' : 'text-muted hover:text-ink'}`}>
              {l}{f.tab === k && list.data ? ` (${list.data.total})` : ''}
            </button>
          ))}
        </div>
        <SearchBox className="min-w-[220px] flex-1" label="Buscar cliente ou negócio" value={f.q} onChange={(v) => setF({ q: v, page: '1' })} placeholder="Buscar cliente ou negócio" />
      </div>

      {list.error ? <LoadError error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : !list.data.items.length ? (
        <Empty title={f.tab === 'due' ? 'Ninguém para contatar agora' : f.tab === 'upcoming' ? 'Nenhum cliente chegando no prazo nos próximos 30 dias' : 'Nenhum pós-venda feito ainda'}>
          {f.tab === 'due' ? 'Quando um cliente completar o prazo depois do ganho, ele aparece aqui.' : null}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.items.map((i) => <Row key={i.id} item={i} tab={f.tab} onDone={() => setDoneFor(i)} onUndo={() => void undo(i)} onError={(t) => setMsg({ tone: 'error', text: t })} />)}
        </ul>
      )}
      {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setF({ page: String(p) })} /> : null}

      {settings ? <AftersaleSettingsDialog onClose={() => setSettings(false)} onSaved={() => { setSettings(false); setMsg({ tone: 'success', text: 'Pós-venda salvo como padrão da empresa.' }); void list.reload(); }} /> : null}
      {doneFor ? <DoneDialog item={doneFor} onClose={() => setDoneFor(null)} onDone={() => { setDoneFor(null); setMsg({ tone: 'success', text: 'Pós-venda marcado como feito: os lembretes deste cliente param.' }); void list.reload(); }} /> : null}
    </div>
  );
}

function Row({ item: i, tab, onDone, onUndo, onError }: { item: Item; tab: string; onDone: () => void; onUndo: () => void; onError: (t: string) => void }) {
  const router = useRouter();
  const [text, setText] = useState(i.message);
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);
  const digits = i.contact?.phone?.replace(/\D/g, '') ?? '';

  async function openChat() {
    if (!i.contact) return;
    setOpening(true);
    try {
      const conv = await startConversation(i.contact.id, 'whatsapp');
      try { sessionStorage.setItem(`crm-draft:${conv.id}`, text); } catch { /* sem armazenamento: abre sem o texto */ }
      router.push(`/conversas?c=${conv.id}&st=all`);
    } catch (e) {
      onError(e instanceof ApiError ? (e.fieldError('channel') ?? e.title) : 'Não foi possível abrir a conversa.');
      setOpening(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* navegador sem permissão */ }
  }

  return (
    <li className="rounded-[10px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {i.contact ? <Link href={`/contatos/${i.contact.id}`} className="hover:underline">{i.contact.name}</Link> : 'Sem contato'}
            {i.contact?.phone ? <span className="font-normal text-muted">{phone(i.contact.phone)}</span> : <Badge tone="warn">sem telefone</Badge>}
          </p>
          <p className="text-[13px] text-muted">
            <Link href={`/negocios/${i.id}`} className="font-medium text-ink hover:underline">{i.title}</Link> · {money(i.valueCents, i.currency)} · {i.pipeline}
            {i.owner ? ` · ${i.owner.name}` : ''}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <Badge tone={tab === 'done' ? 'ok' : tab === 'due' ? 'warn' : 'neutral'}>{tab === 'upcoming' ? `no prazo em ${date.format(new Date(i.dueAt))}` : `fechou há ${i.days} dias`}</Badge>
            <span className="text-muted">ganho em {date.format(new Date(i.closedAt))}</span>
            {i.notifiedCount ? <span className="text-muted">· {i.notifiedCount} aviso(s) enviados à equipe</span> : null}
            {i.doneAt ? <span className="text-muted">· feito em {date.format(new Date(i.doneAt))}{i.doneBy ? ` por ${i.doneBy}` : ''}</span> : null}
          </p>
          {i.note ? <p className="mt-1 text-[13px]">“{i.note}”</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === 'done' ? <Button variant="secondary" onClick={onUndo}><RotateCcw size={15} aria-hidden />Desfazer</Button>
            : <Button onClick={onDone}><Check size={15} aria-hidden />Feito</Button>}
        </div>
      </div>
      {tab !== 'done' ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <Textarea whatsapp label="Mensagem de pós-venda" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={opening} disabled={!i.contact} onClick={() => void openChat()}><MessageCircle size={15} aria-hidden />Abrir conversa com a mensagem</Button>
            <Button variant="ghost" onClick={() => void copy()}><Copy size={15} aria-hidden />{copied ? 'Copiada' : 'Copiar'}</Button>
            {digits ? <a href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-[6px] px-3.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"><HeartHandshake size={15} aria-hidden />Abrir no WhatsApp do celular</a> : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function DoneDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/api/v1/aftersale/${item.id}/done`, { done: true, note: note || null });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível salvar.');
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Pós-venda feito" description={item.contact?.name ?? item.title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={save}><Check size={15} aria-hidden />Marcar como feito</Button></>}>
      <div className="flex flex-col gap-3">
        {err ? <Alert tone="error">{err}</Alert> : null}
        <Textarea label="Como foi o contato? (opcional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: cliente satisfeito, pediu indicação para o irmão." />
        <p className="text-[13px] text-muted">Os lembretes deste cliente param. Fica registrado no histórico do negócio.</p>
      </div>
    </Dialog>
  );
}
