'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Plus, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { phone, relative, type ContactItem, type Page } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory, useTags } from '@/components/crm/data';
import { ContactDialog } from '@/components/crm/contact-form';
import { Button } from '@/components/ui/button';
import { Empty, LoadError, Loading } from '@/components/ui/states';
import { ContactsTabs } from '@/components/crm/contacts-tabs';
import { Avatar, PageHeader, Pagination, SearchBox, TagChip } from '@/components/ui/misc';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export default function ContactsPage() {
  return <Suspense><Contacts /></Suspense>;
}

function Contacts() {
  const { can } = useSession();
  const router = useRouter();
  const { data: dir } = useDirectory();
  const { data: tags } = useTags();
  const [f, setF] = useQueryState({ q: '', ownerId: '', tagId: '', birthdayMonth: '', sort: 'created', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== f.q) setF({ q: dq, page: '1' }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams({ pageSize: '25', page: f.page, sort: f.sort, dir: f.sort === 'name' ? 'asc' : 'desc' });
  if (f.q) params.set('q', f.q);
  if (f.ownerId) params.set('ownerId', f.ownerId);
  if (f.tagId) params.set('tagId', f.tagId);
  if (f.birthdayMonth) params.set('birthdayMonth', f.birthdayMonth);
  const list = useLoad(() => api<Page<ContactItem>>('GET', `/api/v1/contacts?${params}`), [params.toString()]);
  const filtered = !!(f.q || f.ownerId || f.tagId || f.birthdayMonth);

  const exportHref = `/api/v1/contacts/export.csv?${new URLSearchParams(Object.fromEntries(Object.entries({ ownerId: f.ownerId, tagId: f.tagId }).filter(([, v]) => v)))}`;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader title="Contatos" subtitle={list.data ? `${list.data.total.toLocaleString('pt-BR')} ${list.data.total === 1 ? 'contato' : 'contatos'}${filtered ? ' encontrados' : ''}` : ' '}
        actions={<>
          {can('contacts:import_export') ? <>
            <Link href="/contatos/importar" className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2"><Upload size={16} aria-hidden />Importar</Link>
            <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2"><Download size={16} aria-hidden />Exportar</a>
          </> : null}
          {can('contacts:edit') ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Novo contato</Button> : null}
        </>} />
      <ContactsTabs />

      <div className="flex flex-wrap items-end gap-2">
        <SearchBox className="w-full sm:w-80" value={q} onChange={setQ} label="Buscar contatos" placeholder="Nome, e-mail, telefone ou CPF" />
        <select aria-label="Responsável" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">Todos os responsáveis</option>
          {dir?.me ? <option value={dir.me}>Meus contatos</option> : null}
          <option value="none">Sem responsável</option>
          {(dir?.members ?? []).filter((m) => m.id !== dir?.me).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select aria-label="Etiqueta" value={f.tagId} onChange={(e) => setF({ tagId: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">Todas as etiquetas</option>
          {(tags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Aniversariantes do mês" value={f.birthdayMonth} onChange={(e) => setF({ birthdayMonth: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">Aniversário: todos</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>Aniversário em {m}</option>)}
        </select>
        <select aria-label="Ordenar" value={f.sort} onChange={(e) => setF({ sort: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="created">Mais recentes</option><option value="name">Nome (A–Z)</option>
          <option value="activity">Última atividade</option><option value="updated">Alterados por último</option>
        </select>
        {filtered ? <Button variant="ghost" onClick={() => { setQ(''); setF({ q: '', ownerId: '', tagId: '', birthdayMonth: '', page: '1' }); }}>Limpar filtros</Button> : null}
      </div>

      <section aria-label="Lista de contatos" className="rounded-[10px] border border-line bg-surface">
        {list.error ? <div className="p-5"><LoadError error={list.error} retry={list.reload} /></div>
          : !list.data ? <div className="p-5"><Loading /></div>
          : list.data.items.length === 0 ? (
            <div className="p-5">
              <Empty title={filtered ? 'Nenhum contato com estes filtros' : 'Nenhum contato ainda'}
                action={!filtered && can('contacts:edit') ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Criar o primeiro</Button> : undefined}>
                {filtered ? 'Mude a busca ou limpe os filtros.' : 'Cadastre um contato ou importe uma planilha.'}
              </Empty>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm" aria-busy={list.loading}>
                <thead>
                  <tr className="border-b border-line text-[12px] text-muted">
                    <th scope="col" className="px-4 py-2.5 font-medium">Nome</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Organização</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Contato</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Responsável</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Etiquetas</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Última atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((c) => (
                    <tr key={c.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => router.push(`/contatos/${c.id}`)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <div className="min-w-0">
                            <Link href={`/contatos/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{c.name}</Link>
                            {c.jobTitle ? <p className="truncate text-[13px] text-muted">{c.jobTitle}</p> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">{c.organization ? <Link href={`/organizacoes/${c.organization.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{c.organization.name}</Link> : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-3">
                        <p className="truncate">{c.email ?? ''}</p>
                        <p className="text-[13px] text-muted">{phone(c.phone)}</p>
                      </td>
                      <td className="px-3 py-3">{c.owner?.name ?? <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{c.tags.slice(0, 3).map((t) => <TagChip key={t.id} tag={t} />)}{c.tags.length > 3 ? <span className="text-[12px] text-muted">+{c.tags.length - 3}</span> : null}</div></td>
                      <td className="px-4 py-3 text-[13px] text-muted">{c.lastActivityAt ? relative(c.lastActivityAt) : 'Sem atividade'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {list.data ? <div className="px-4 pb-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setF({ page: String(p) })} /></div> : null}
      </section>

      <ContactDialog open={creating} onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); router.push(`/contatos/${c.id}`); }} />
    </div>
  );
}
