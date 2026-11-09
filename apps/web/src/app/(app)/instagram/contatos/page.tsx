'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import type { TagRef } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { InstagramTabs } from '@/components/instagram/tabs';
import { Avatar, PageHeader, Pagination, SearchBox, TagChip } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Empty, LoadError, Loading } from '@/components/ui/states';

type Person = { id: string; name: string; username: string | null; igUserId: string; lastInboundAt: string | null; windowOpen: boolean | null; tags: TagRef[] };

export default function InstagramContactsPage() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const data = useLoad(() => api<{ items: Person[]; total: number; page: number; pageSize: number }>('GET',
    `/api/v1/instagram/contacts?page=${page}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`), [page, query]);
  if (!can('contacts:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Instagram" subtitle="As mesmas pessoas de Contatos, com o que importa no Instagram." />
      <InstagramTabs />
      <Panel title="Quem conversou com você" description="Janela aberta: a pessoa mandou mensagem nas últimas 24 horas, então dá para responder no direct.">
        <div className="flex flex-col gap-3">
          <SearchBox className="max-w-sm" label="Buscar por nome ou @" value={q} onChange={setQ} />
          {data.error ? <LoadError error={data.error} retry={data.reload} /> : !data.data ? <Loading /> : !data.data.items.length ? (
            <Empty title={query ? 'Ninguém encontrado' : 'Ninguém ainda'}>{query ? 'Tente outro nome ou @.' : 'Quem comentar, mandar direct ou passar por um fluxo aparece aqui.'}</Empty>
          ) : (
            <>
              <ul className="-mx-5 divide-y divide-line">
                {data.data.items.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <Avatar name={p.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/contatos/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <p className="text-[13px] text-muted">{p.username ? `@${p.username}` : 'Sem @'}{p.lastInboundAt ? ` · última mensagem ${dateTime.format(new Date(p.lastInboundAt))}` : ''}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">{p.tags.slice(0, 3).map((t) => <TagChip key={t.id} tag={t} />)}</div>
                    {p.windowOpen ? <Badge tone="ok">JANELA ABERTA</Badge> : <Badge>Janela fechada</Badge>}
                  </li>
                ))}
              </ul>
              <Pagination page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} />
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
