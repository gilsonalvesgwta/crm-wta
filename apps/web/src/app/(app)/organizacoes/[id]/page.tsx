'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { fmtDate, money, phone, type ContactItem, type DealCard, type Organization, type Page } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useFields } from '@/components/crm/data';
import { OrganizationDialog } from '@/components/crm/org-form';
import { ContactDialog } from '@/components/crm/contact-form';
import { DealDialog } from '@/components/crm/deal-form';
import { CustomFieldValues } from '@/components/crm/custom-fields';
import { ActivitiesPanel, FilesPanel, NotesPanel, TimelinePanel } from '@/components/crm/record-panels';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';
import { Avatar, Detail, PageHeader, TagChip } from '@/components/ui/misc';

export default function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const router = useRouter();
  const org = useLoad(() => api<Organization>('GET', `/api/v1/organizations/${id}`), [id]);
  const contacts = useLoad(() => api<Page<ContactItem>>('GET', `/api/v1/contacts?organizationId=${id}&pageSize=50&sort=name&dir=asc`), [id]);
  const deals = useLoad(() => api<Page<DealCard>>('GET', `/api/v1/deals?organizationId=${id}&status=all&pageSize=20`).catch(() => null), [id]);
  const { data: defs } = useFields('organization');
  const [editing, setEditing] = useState(false);
  const [newContact, setNewContact] = useState(false);
  const [newDeal, setNewDeal] = useState(false);
  const [del, setDel] = useState(false);
  const [tick, setTick] = useState(0);

  if (org.error) return <div className="mx-auto max-w-6xl"><LoadError error={org.error} retry={org.reload} /></div>;
  const o = org.data;
  if (!o) return <div className="mx-auto max-w-6xl"><Loading /></div>;
  const canEdit = can('contacts:edit');
  const ref = { id: o.id, name: o.name };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader back={{ href: '/organizacoes', label: 'Organizações' }} title={o.name}
        subtitle={[o.industry, o.domain].filter(Boolean).join(' · ') || undefined}
        actions={<>
          {canEdit ? <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden />Editar</Button> : null}
          {can('deals:edit') ? <Button onClick={() => setNewDeal(true)}><Plus size={16} aria-hidden />Novo negócio</Button> : null}
          {can('contacts:delete') ? <Button variant="ghost" aria-label="Excluir organização" onClick={() => setDel(true)}><Trash2 size={16} aria-hidden /></Button> : null}
        </>} />
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Dados">
            <dl>
              <Detail label="Razão social">{o.legalName}</Detail>
              <Detail label="CNPJ">{o.taxId}</Detail>
              <Detail label="Site">{o.website ? <a href={o.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{o.domain ?? o.website}</a> : null}</Detail>
              <Detail label="E-mail">{o.email}</Detail>
              <Detail label="Telefone">{phone(o.phone)}</Detail>
              <Detail label="Cidade">{[o.address.city, o.address.state].filter(Boolean).join(' / ')}</Detail>
              <Detail label="Responsável">{o.owner?.name}</Detail>
              <Detail label="Etiquetas">{o.tags.length ? <div className="flex flex-wrap gap-1">{o.tags.map((t) => <TagChip key={t.id} tag={t} />)}</div> : null}</Detail>
              <Detail label="Em aberto">{o.counts ? `${o.counts.openDeals} negócios · ${money(o.counts.openValueCents)}` : null}</Detail>
              <Detail label="Criada em">{fmtDate.format(new Date(o.createdAt))}</Detail>
            </dl>
            {defs?.length ? <div className="mt-2 border-t border-line pt-2"><CustomFieldValues defs={defs} value={o.custom} /></div> : null}
          </Panel>
          <Panel title={`Pessoas (${contacts.data?.total ?? 0})`} actions={canEdit ? <Button variant="ghost" onClick={() => setNewContact(true)}><Plus size={16} aria-hidden />Pessoa</Button> : undefined}>
            {!contacts.data?.items.length ? <p className="text-[13px] text-muted">Nenhum contato ligado.</p> : (
              <ul className="flex flex-col gap-2.5">
                {contacts.data.items.map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5">
                    <Avatar name={c.name} size={28} />
                    <div className="min-w-0"><Link href={`/contatos/${c.id}`} className="font-medium hover:underline">{c.name}</Link><p className="truncate text-[12px] text-muted">{c.jobTitle ?? c.email ?? ''}</p></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-5">
          {deals.data ? (
            <Panel title={`Negócios (${deals.data.total})`}>
              {!deals.data.items.length ? <p className="text-[13px] text-muted">Nenhum negócio com esta organização.</p> : (
                <ul className="flex flex-col">
                  {deals.data.items.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                      <div className="min-w-0"><Link href={`/negocios/${d.id}`} className="font-medium hover:underline">{d.title}</Link><p className="text-[13px] text-muted">{d.stage?.name} · {d.owner?.name ?? ''}</p></div>
                      <div className="flex shrink-0 items-center gap-2"><span className="font-medium tabular-nums">{money(d.valueCents, d.currency)}</span>
                        {d.status === 'won' ? <Badge tone="ok">Ganho</Badge> : d.status === 'lost' ? <Badge tone="bad">Perdido</Badge> : null}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
          <ActivitiesPanel filter={`organizationId=${id}`} links={{ organization: ref }} canEdit={can('tasks:manage')} onChange={() => setTick((t) => t + 1)} />
          <NotesPanel kind="organization" id={id} canEdit={canEdit} />
          <FilesPanel kind="organization" id={id} canEdit={canEdit} onChange={() => setTick((t) => t + 1)} />
          <TimelinePanel kind="organization" id={id} refreshKey={tick} />
        </div>
      </div>
      <OrganizationDialog open={editing} org={o} onClose={() => setEditing(false)} onSaved={(x) => { setEditing(false); org.setData({ ...o, ...x }); setTick((t) => t + 1); }} />
      <ContactDialog open={newContact} organization={ref} onClose={() => setNewContact(false)} onSaved={() => { setNewContact(false); void contacts.reload(); }} />
      <DealDialog open={newDeal} organization={ref} onClose={() => setNewDeal(false)} onSaved={(d) => router.push(`/negocios/${d.id}`)} />
      <Confirm open={del} title={`Excluir ${o.name}?`} confirmLabel="Excluir" onConfirm={async () => { await api('DELETE', `/api/v1/organizations/${id}`).catch(() => undefined); router.replace('/organizacoes'); }} onCancel={() => setDel(false)}>
        Os contatos e negócios continuam, sem a organização. Notas, arquivos e histórico dela são apagados.
      </Confirm>
    </div>
  );
}
