'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { phone, relative, type Organization, type Page } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory, useTags } from '@/components/crm/data';
import { OrganizationDialog } from '@/components/crm/org-form';
import { Button } from '@/components/ui/button';
import { Empty, LoadError, Loading } from '@/components/ui/states';
import { PageHeader, Pagination, SearchBox, TagChip } from '@/components/ui/misc';

export default function OrganizationsPage() {
  return <Suspense><Organizations /></Suspense>;
}

function Organizations() {
  const { can } = useSession();
  const router = useRouter();
  const { data: dir } = useDirectory();
  const { data: tags } = useTags();
  const [f, setF] = useQueryState({ q: '', ownerId: '', tagId: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== f.q) setF({ q: dq, page: '1' }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ page: f.page, pageSize: '25' });
  if (f.q) params.set('q', f.q);
  if (f.ownerId) params.set('ownerId', f.ownerId);
  if (f.tagId) params.set('tagId', f.tagId);
  const list = useLoad(() => api<Page<Organization>>('GET', `/api/v1/organizations?${params}`), [params.toString()]);
  const filtered = !!(f.q || f.ownerId || f.tagId);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader title="Organizações" subtitle={list.data ? `${list.data.total.toLocaleString('pt-BR')} ${list.data.total === 1 ? 'organização' : 'organizações'}` : ' '}
        actions={<>
          {can('contacts:import_export') ? <a href="/api/v1/organizations/export.csv" className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2"><Download size={16} aria-hidden />Exportar</a> : null}
          {can('contacts:edit') ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Nova organização</Button> : null}
        </>} />
      <div className="flex flex-wrap items-end gap-2">
        <SearchBox className="w-full sm:w-80" value={q} onChange={setQ} label="Buscar organizações" placeholder="Nome, site ou CNPJ" />
        <select aria-label="Responsável" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">Todos os responsáveis</option>
          {(dir?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select aria-label="Etiqueta" value={f.tagId} onChange={(e) => setF({ tagId: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">Todas as etiquetas</option>
          {(tags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <section aria-label="Lista de organizações" className="rounded-[10px] border border-line bg-surface">
        {list.error ? <div className="p-5"><LoadError error={list.error} retry={list.reload} /></div>
          : !list.data ? <div className="p-5"><Loading /></div>
          : !list.data.items.length ? <div className="p-5"><Empty title={filtered ? 'Nenhuma organização com estes filtros' : 'Nenhuma organização ainda'}>{filtered ? 'Mude a busca ou os filtros.' : 'Organizações agrupam os contatos e negócios de uma mesma empresa.'}</Empty></div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead><tr className="border-b border-line text-[12px] text-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">Nome</th><th scope="col" className="px-3 py-2.5 font-medium">Contato</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Pessoas</th><th scope="col" className="px-3 py-2.5 font-medium">Responsável</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Etiquetas</th><th scope="col" className="px-4 py-2.5 font-medium">Última atividade</th>
                </tr></thead>
                <tbody>
                  {list.data.items.map((o) => (
                    <tr key={o.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => router.push(`/organizacoes/${o.id}`)}>
                      <td className="px-4 py-3"><Link href={`/organizacoes/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{o.name}</Link><p className="text-[13px] text-muted">{o.domain ?? o.industry ?? ''}</p></td>
                      <td className="px-3 py-3"><p>{o.email ?? ''}</p><p className="text-[13px] text-muted">{phone(o.phone)}</p></td>
                      <td className="px-3 py-3 tabular-nums">{o.contactCount}</td>
                      <td className="px-3 py-3">{o.owner?.name ?? <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{o.tags.slice(0, 3).map((t) => <TagChip key={t.id} tag={t} />)}</div></td>
                      <td className="px-4 py-3 text-[13px] text-muted">{o.lastActivityAt ? relative(o.lastActivityAt) : 'Sem atividade'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {list.data ? <div className="px-4 pb-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setF({ page: String(p) })} /></div> : null}
      </section>
      <OrganizationDialog open={creating} onClose={() => setCreating(false)} onSaved={(o) => { setCreating(false); router.push(`/organizacoes/${o.id}`); }} />
    </div>
  );
}
