'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { LEAD_STATUS, phone, relative, type Lead, type Page, type Ref } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory } from '@/components/crm/data';
import { EntityPicker, MemberSelect } from '@/components/crm/pickers';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Empty, LoadError, Loading } from '@/components/ui/states';
import { PageHeader, Pagination, SearchBox } from '@/components/ui/misc';

const STATUS_TONE = { new: 'info', working: 'warn', qualified: 'ok', disqualified: 'neutral' } as const;

export default function LeadsPage() {
  return <Suspense><Leads /></Suspense>;
}

const TABS = [['active', 'Em aberto'], ['qualified', 'Qualificados'], ['disqualified', 'Descartados'], ['all', 'Todos']] as const;

function Leads() {
  const { can } = useSession();
  const router = useRouter();
  const { data: dir } = useDirectory();
  const [f, setF] = useQueryState({ status: 'active', ownerId: '', q: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== f.q) setF({ q: dq, page: '1' }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ status: f.status, page: f.page, pageSize: '25' });
  if (f.q) params.set('q', f.q);
  if (f.ownerId) params.set('ownerId', f.ownerId);
  const list = useLoad(() => api<Page<Lead>>('GET', `/api/v1/leads?${params}`), [params.toString()]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader title="Leads" subtitle="Entradas ainda não qualificadas. Ao qualificar, o lead vira negócio."
        actions={<>
          {can('deals:assign') && can('pipelines:admin') ? <Link href="/configuracoes/distribuicao" className="inline-flex h-10 items-center rounded-[6px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Distribuição</Link> : null}
          {can('leads:work') ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Novo lead</Button> : null}
        </>} />
      <nav aria-label="Situação dos leads" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-line px-1">
          {TABS.map(([k, l]) => (
            <li key={k}><button type="button" aria-current={f.status === k ? 'page' : undefined} onClick={() => setF({ status: k, page: '1' })}
              className={`flex h-11 items-center border-b-2 px-3 text-sm ${f.status === k ? 'border-primary font-semibold' : 'border-transparent font-medium text-muted hover:text-ink'}`}>{l}</button></li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-wrap items-end gap-2">
        <SearchBox className="w-full sm:w-80" value={q} onChange={setQ} label="Buscar leads" placeholder="Título ou nome do contato" />
        <select aria-label="Responsável" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">Todos os responsáveis</option>
          {dir?.me ? <option value={dir.me}>Meus leads</option> : null}
          <option value="none">Sem responsável</option>
          {(dir?.members ?? []).filter((m) => m.id !== dir?.me).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <section aria-label="Lista de leads" className="rounded-[10px] border border-line bg-surface">
        {list.error ? <div className="p-5"><LoadError error={list.error} retry={list.reload} /></div>
          : !list.data ? <div className="p-5"><Loading /></div>
          : !list.data.items.length ? <div className="p-5"><Empty title="Nenhum lead aqui">{f.status === 'active' ? 'Leads novos chegam por cadastro, importação ou, na Fase 3, pela API e pelo n8n.' : 'Mude a aba ou os filtros.'}</Empty></div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead><tr className="border-b border-line text-[12px] text-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">Lead</th><th scope="col" className="px-3 py-2.5 font-medium">Contato</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Origem</th><th scope="col" className="px-3 py-2.5 font-medium">Responsável</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Situação</th><th scope="col" className="px-4 py-2.5 font-medium">Entrada</th>
                </tr></thead>
                <tbody>
                  {list.data.items.map((l) => (
                    <tr key={l.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => router.push(`/leads/${l.id}`)}>
                      <td className="px-4 py-3"><Link href={`/leads/${l.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{l.title}</Link></td>
                      <td className="px-3 py-3"><p>{l.contact.name}</p><p className="text-[13px] text-muted">{l.contact.email ?? phone(l.contact.phone)}</p></td>
                      <td className="px-3 py-3">{l.source ?? <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-3">{l.owner?.name ?? <Badge tone="warn">Sem responsável</Badge>}</td>
                      <td className="px-3 py-3"><Badge tone={STATUS_TONE[l.status]}>{LEAD_STATUS[l.status]}</Badge></td>
                      <td className="px-4 py-3 text-[13px] text-muted">{relative(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {list.data ? <div className="px-4 pb-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setF({ page: String(p) })} /></div> : null}
      </section>
      <LeadDialog open={creating} onClose={() => setCreating(false)} onSaved={(l) => { setCreating(false); router.push(`/leads/${l.id}`); }} />
    </div>
  );
}

function LeadDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (l: Lead) => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Novo lead" description="Sem responsável escolhido, o rodízio da distribuição decide.">
      <LeadForm onSaved={onSaved} onCancel={onClose} />
    </Dialog>
  );
}

function LeadForm({ onSaved, onCancel }: { onSaved: (l: Lead) => void; onCancel: () => void }) {
  const { can } = useSession();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existing, setExisting] = useState<Ref | null>(null);
  const [v, setV] = useState({ title: '', firstName: '', lastName: '', email: '', phone: '', source: '' });
  const [owner, setOwner] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = { title: v.title || `${v.firstName || existing?.name || 'Lead'}`, source: v.source || null };
    if (mode === 'existing') body.contactId = existing?.id;
    else body.contact = { firstName: v.firstName, lastName: v.lastName || null, email: v.email || null, phone: v.phone || null };
    if (!auto) body.ownerId = owner;
    if (v.source) body.touch = { source: v.source };
    try {
      onSaved(await api<Lead>('POST', '/api/v1/leads', body));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err.title}</Alert> : null}
      <Field label="Título" value={v.title} onChange={set('title')} placeholder="Ex.: Pedido de orçamento pelo site" error={err?.fieldError('title')} />
      <div role="group" aria-label="Contato" className="flex gap-1 rounded-[6px] border border-line p-0.5">
        <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')} className={`h-9 flex-1 rounded-[5px] text-sm font-medium ${mode === 'new' ? 'bg-surface-2' : 'text-muted'}`}>Pessoa nova</button>
        <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')} className={`h-9 flex-1 rounded-[5px] text-sm font-medium ${mode === 'existing' ? 'bg-surface-2' : 'text-muted'}`}>Contato cadastrado</button>
      </div>
      {mode === 'existing' ? <EntityPicker kind="contact" label="Contato" value={existing} onChange={setExisting} /> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" value={v.firstName} onChange={set('firstName')} error={err?.fieldError('contact.firstName')} required />
          <Field label="Sobrenome" value={v.lastName} onChange={set('lastName')} />
          <Field label="E-mail" type="email" value={v.email} onChange={set('email')} error={err?.fieldError('contact.email')} hint="Se já houver contato com este e-mail ou telefone, ele é reaproveitado." />
          <Field label="Telefone" type="tel" value={v.phone} onChange={set('phone')} error={err?.fieldError('contact.phone')} />
        </div>
      )}
      <Field label="Origem" value={v.source} onChange={set('source')} placeholder="site, instagram, indicação..." hint="A distribuição pode usar a origem para escolher o roteiro." />
      {can('deals:assign') ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Distribuir pelo rodízio</label>
          {!auto ? <MemberSelect value={owner} onChange={setOwner} /> : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={busy} disabled={mode === 'new' ? !v.firstName.trim() : !existing}>Criar lead</Button>
      </div>
    </form>
  );
}
