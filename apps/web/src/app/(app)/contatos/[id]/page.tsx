'use client';
import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Merge, Pencil, Plus, ShieldOff, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import {
  CHANNEL_LABEL, fmtDate, fmtDateTime, money, phone, type Contact, type DealCard, type Duplicate, type Page,
} from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useFields } from '@/components/crm/data';
import { ContactDialog } from '@/components/crm/contact-form';
import { CustomFieldValues } from '@/components/crm/custom-fields';
import { ActivitiesPanel, FilesPanel, NotesPanel, TimelinePanel } from '@/components/crm/record-panels';
import { DealDialog } from '@/components/crm/deal-form';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { LoadError, Loading } from '@/components/ui/states';
import { Avatar, Detail, PageHeader, TagChip } from '@/components/ui/misc';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LABEL: Record<string, string> = { work: 'trabalho', personal: 'pessoal', other: 'outro', mobile: 'celular', whatsapp: 'WhatsApp', home: 'casa' };

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const router = useRouter();
  const contact = useLoad(() => api<Contact>('GET', `/api/v1/contacts/${id}`), [id]);
  const dups = useLoad(() => api<Duplicate[]>('GET', `/api/v1/contacts/${id}/duplicates`), [id]);
  const deals = useLoad(() => api<Page<DealCard>>('GET', `/api/v1/deals?contactId=${id}&status=all&pageSize=20`).catch(() => null), [id]);
  const { data: defs } = useFields('contact');
  const [editing, setEditing] = useState(false);
  const [newDeal, setNewDeal] = useState(false);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Depois de mesclar, as listas do contato são recarregadas do zero.
  const [version, setVersion] = useState(0);
  const refresh = () => { void contact.reload(); setTick((t) => t + 1); };

  if (contact.error) return <div className="mx-auto max-w-6xl"><LoadError error={contact.error} retry={contact.reload} /></div>;
  const c = contact.data;
  if (!c) return <div className="mx-auto max-w-6xl"><Loading /></div>;
  const canEdit = can('contacts:edit') && !c.anonymizedAt;

  async function remove() {
    setBusy(true);
    try {
      await api('DELETE', `/api/v1/contacts/${id}`);
      router.replace('/contatos');
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.');
      setBusy(false);
      setDel(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader back={{ href: '/contatos', label: 'Contatos' }}
        title={<span className="flex items-center gap-3"><Avatar name={c.name} size={40} />{c.name}</span>}
        subtitle={[c.jobTitle, c.organization?.name].filter(Boolean).join(' · ') || undefined}
        actions={<>
          {canEdit ? <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden />Editar</Button> : null}
          {can('deals:edit') && !c.anonymizedAt ? <Button onClick={() => setNewDeal(true)}><Plus size={16} aria-hidden />Novo negócio</Button> : null}
          {can('contacts:delete') ? <Button variant="danger" onClick={() => setDel(true)}><Trash2 size={16} aria-hidden />Excluir</Button> : null}
        </>} />
      {c.anonymizedAt ? <Alert tone="info">Os dados pessoais deste contato foram anonimizados em {fmtDate.format(new Date(c.anonymizedAt))}. Negócios e números continuam.</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}
      {dups.data?.length && can('contacts:delete') ? <DuplicatesBanner contact={c} dups={dups.data} onMerged={() => { void dups.reload(); void deals.reload(); setVersion((v) => v + 1); refresh(); }} /> : null}

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Dados">
            <dl>
              <Detail label="E-mails">
                {c.emails.length ? <ul>{c.emails.map((e) => <li key={e.id}><a href={`mailto:${e.email}`} className="text-accent hover:underline">{e.email}</a> <span className="text-[12px] text-muted">{LABEL[e.label]}</span></li>)}</ul> : null}
              </Detail>
              <Detail label="Telefones">
                {c.phones.length ? <ul>{c.phones.map((p) => <li key={p.id}><a href={`tel:${p.number}`} className="hover:underline">{phone(p.number)}</a> <span className="text-[12px] text-muted">{LABEL[p.label]}</span></li>)}</ul> : null}
              </Detail>
              <Detail label="Organização">{c.organization ? <Link href={`/organizacoes/${c.organization.id}`} className="text-accent hover:underline">{c.organization.name}</Link> : null}</Detail>
              <Detail label="Responsável">{c.owner?.name}</Detail>
              <Detail label="Equipe">{c.team?.name}</Detail>
              <Detail label="Aniversário">{c.birthday ? `${c.birthday.day} de ${MONTHS[c.birthday.month - 1]}${c.birthday.year ? ` de ${c.birthday.year}` : ''}` : null}</Detail>
              <Detail label="Documento">{c.taxId}</Detail>
              <Detail label="Cidade">{[c.address.city, c.address.state].filter(Boolean).join(' / ')}</Detail>
              <Detail label="Etiquetas">{c.tags.length ? <div className="flex flex-wrap gap-1">{c.tags.map((t) => <TagChip key={t.id} tag={t} />)}</div> : null}</Detail>
              <Detail label="Criado em">{fmtDate.format(new Date(c.createdAt))}</Detail>
            </dl>
            {defs?.length ? <div className="mt-2 border-t border-line pt-2"><CustomFieldValues defs={defs} value={c.custom} /></div> : null}
          </Panel>
          <OriginPanel contact={c} canEdit={canEdit} onChange={refresh} />
          <ConsentPanel contact={c} canEdit={canEdit} onChange={refresh} />
          {can('privacy:execute') && !c.anonymizedAt ? <PrivacyPanel contact={c} onDone={refresh} /> : null}
        </div>
        <div className="flex flex-col gap-5">
          <ActivitiesPanel key={`a${version}`} filter={`contactId=${id}`} links={{ contact: { id: c.id, name: c.name }, organization: c.organization }} canEdit={can('tasks:manage') && !c.anonymizedAt} onChange={() => setTick((t) => t + 1)} />
          {deals.data ? (
            <Panel title={`Negócios (${deals.data.total})`}>
              {deals.data.items.length === 0 ? <p className="text-[13px] text-muted">Nenhum negócio com este contato.</p> : (
                <ul className="flex flex-col">
                  {deals.data.items.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                      <div className="min-w-0">
                        <Link href={`/negocios/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
                        <p className="text-[13px] text-muted">{d.pipeline?.name} · {d.stage?.name}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-medium tabular-nums">{money(d.valueCents, d.currency)}</span>
                        {d.status === 'won' ? <Badge tone="ok">Ganho</Badge> : d.status === 'lost' ? <Badge tone="bad">Perdido</Badge> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
          <NotesPanel key={`n${version}`} kind="contact" id={id} canEdit={canEdit} />
          <FilesPanel key={`f${version}`} kind="contact" id={id} canEdit={canEdit} onChange={() => setTick((t) => t + 1)} />
          <TimelinePanel kind="contact" id={id} refreshKey={tick} />
        </div>
      </div>

      <ContactDialog open={editing} contact={c} onClose={() => setEditing(false)} onSaved={(x) => { setEditing(false); contact.setData(x); setTick((t) => t + 1); }} />
      <DealDialog open={newDeal} onClose={() => setNewDeal(false)} contact={{ id: c.id, name: c.name }} organization={c.organization}
        onSaved={(d) => { setNewDeal(false); router.push(`/negocios/${d.id}`); }} />
      <Confirm open={del} title={`Excluir ${c.name}?`} confirmLabel="Excluir contato" loading={busy} onConfirm={remove} onCancel={() => setDel(false)}>
        Notas, atividades, arquivos e histórico deste contato são apagados. Os negócios continuam, sem o contato. Isso não pode ser desfeito.
      </Confirm>
    </div>
  );
}

function DuplicatesBanner({ contact, dups, onMerged }: { contact: Contact; dups: Duplicate[]; onMerged: () => void }) {
  const [merge, setMerge] = useState<Duplicate | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!merge) return;
    setBusy(true);
    try {
      await api('POST', `/api/v1/contacts/${contact.id}/merge`, { mergeId: merge.id });
      setMerge(null);
      onMerged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível mesclar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Alert tone="warning">
      <div className="flex flex-col gap-2">
        <p className="font-medium">Possível cadastro duplicado</p>
        {dups.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/contatos/${d.id}`} className="font-medium underline">{d.name}</Link>
            <span>tem o mesmo {d.matchedBy.map((m) => (m === 'email' ? 'e-mail' : 'telefone')).join(' e ')}.</span>
            <button type="button" onClick={() => setMerge(d)} className="inline-flex items-center gap-1 font-semibold underline"><Merge size={14} aria-hidden />Mesclar aqui</button>
          </div>
        ))}
        {err ? <p className="text-bad">{err}</p> : null}
      </div>
      <Confirm open={!!merge} title={`Mesclar ${merge?.name} em ${contact.name}?`} confirmLabel="Mesclar" danger={false} loading={busy} onConfirm={go} onCancel={() => setMerge(null)}>
        {contact.name} fica com os próprios dados e recebe o que faltava: e-mails, telefones, etiquetas, negócios, notas, atividades, arquivos e histórico.
        O outro cadastro deixa de existir; uma cópia dele fica registrada na auditoria.
      </Confirm>
    </Alert>
  );
}

function OriginPanel({ contact, canEdit, onChange }: { contact: Contact; canEdit: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ source: '', medium: '', campaign: '' });
  const [busy, setBusy] = useState(false);
  const a = contact.attribution;
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api('POST', `/api/v1/contacts/${contact.id}/attribution`, v).catch(() => undefined);
    setBusy(false);
    setOpen(false);
    setV({ source: '', medium: '', campaign: '' });
    onChange();
  }
  const show = (t: NonNullable<Contact['attribution']>['first']) =>
    [t.source, t.medium, t.campaign].filter(Boolean).join(' / ') || 'Sem detalhes registrados';
  return (
    <Panel title="Origem" actions={canEdit ? <Button variant="ghost" onClick={() => setOpen(true)}>Registrar</Button> : undefined}>
      {a ? (
        <dl>
          <Detail label="Primeira">{show(a.first)}<p className="text-[12px] text-muted">{fmtDateTime.format(new Date(a.first.occurredAt))}</p></Detail>
          {a.touches > 1 ? <Detail label="Última">{show(a.last)}<p className="text-[12px] text-muted">{fmtDateTime.format(new Date(a.last.occurredAt))}</p></Detail> : null}
          <Detail label="Pontos">{a.touches}</Detail>
        </dl>
      ) : <p className="text-[13px] text-muted">Origem não registrada. Nada é presumido.</p>}
      <Dialog open={open} onClose={() => setOpen(false)} title="Registrar origem" description="Uma nova linha no histórico de origens. A primeira origem nunca muda.">
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Origem (utm_source)" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} required />
          <Field label="Mídia (utm_medium)" value={v.medium} onChange={(e) => setV({ ...v, medium: e.target.value })} />
          <Field label="Campanha (utm_campaign)" value={v.campaign} onChange={(e) => setV({ ...v, campaign: e.target.value })} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" loading={busy} disabled={!v.source.trim()}>Registrar</Button></div>
        </form>
      </Dialog>
    </Panel>
  );
}

function ConsentPanel({ contact, canEdit, onChange }: { contact: Contact; canEdit: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ channel: 'email', purpose: 'marketing', status: 'granted', source: '', evidence: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/api/v1/contacts/${contact.id}/consents`, { ...v, evidence: v.evidence || null });
      setOpen(false);
      onChange();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Consentimento" actions={canEdit ? <Button variant="ghost" onClick={() => setOpen(true)}>Registrar</Button> : undefined}>
      {contact.consents.length ? (
        <ul className="flex flex-col gap-2">
          {contact.consents.map((c) => (
            <li key={`${c.channel}-${c.purpose}`} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{CHANNEL_LABEL[c.channel]} <span className="font-normal text-muted">· {c.purpose === 'marketing' ? 'marketing' : 'atendimento'}</span></p>
                <p className="text-[12px] text-muted">{c.source} · {fmtDate.format(new Date(c.recordedAt))}</p>
              </div>
              {c.status === 'granted' ? <Badge tone="ok">Autorizado</Badge> : <Badge tone="bad">Recusado</Badge>}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">Nenhum consentimento registrado. Sem registro, o contato não recebe campanhas.</p>}
      <Dialog open={open} onClose={() => setOpen(false)} title="Registrar consentimento" description="Cada mudança fica no histórico com origem e data.">
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Canal" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>
              {Object.entries(CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Select label="Finalidade" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}>
              <option value="marketing">Marketing</option><option value="service">Atendimento</option>
            </Select>
            <Select label="Situação" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
              <option value="granted">Autorizou</option><option value="revoked">Recusou ou retirou</option>
            </Select>
          </div>
          <Field label="Como foi obtido" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} error={err?.fieldError('source')} hint="Ex.: formulário do site, pedido por telefone, contrato." />
          <Field label="Comprovante (opcional)" value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })} hint="Link, protocolo ou descrição." />
          {v.status === 'revoked' && v.purpose === 'marketing' ? <Alert tone="info">Os endereços deste contato entram na lista de bloqueio do canal.</Alert> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" loading={busy} disabled={!v.source.trim()}>Registrar</Button></div>
        </form>
      </Dialog>
    </Panel>
  );
}

function PrivacyPanel({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function download() {
    setErr(null);
    try {
      const data = await api('GET', `/api/v1/privacy/contacts/${contact.id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `titular-${contact.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível exportar.');
    }
  }
  async function anonymize() {
    setBusy(true);
    try {
      await api('POST', `/api/v1/privacy/contacts/${contact.id}/anonymize`, { confirm: true });
      setConfirm(false);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível anonimizar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Privacidade (LGPD)" description="Pedidos do titular dos dados.">
      {err ? <div className="mb-3"><Alert tone="error">{err}</Alert></div> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={download}><Download size={16} aria-hidden />Exportar dados</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}><ShieldOff size={16} aria-hidden />Anonimizar</Button>
      </div>
      <Confirm open={confirm} title={`Anonimizar ${contact.name}?`} confirmLabel="Anonimizar" loading={busy} onConfirm={anonymize} onCancel={() => setConfirm(false)}>
        Nome, e-mails, telefones, documento, notas, arquivos e histórico são apagados de forma definitiva. Negócios e números continuam, sem identificar a pessoa.
        A ação fica registrada na auditoria.
      </Confirm>
    </Panel>
  );
}
