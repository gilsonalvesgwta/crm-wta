'use client';
import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRightCircle, RotateCcw, UserPlus, XCircle } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { LEAD_STATUS, fmtDateTime, parseMoney, phone, type Lead } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { usePipelines } from '@/components/crm/data';
import { MemberSelect } from '@/components/crm/pickers';
import { ActivitiesPanel, NotesPanel, TimelinePanel } from '@/components/crm/record-panels';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LoadError, Loading } from '@/components/ui/states';
import { Detail, PageHeader } from '@/components/ui/misc';

const TONE = { new: 'info', working: 'warn', qualified: 'ok', disqualified: 'neutral' } as const;

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const lead = useLoad(() => api<Lead>('GET', `/api/v1/leads/${id}`), [id]);
  const [dialog, setDialog] = useState<'qualify' | 'disqualify' | 'assign' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  if (lead.error) return <div className="mx-auto max-w-6xl"><LoadError error={lead.error} retry={lead.reload} /></div>;
  const l = lead.data;
  if (!l) return <div className="mx-auto max-w-6xl"><Loading /></div>;
  const openLead = l.status === 'new' || l.status === 'working';
  const canWork = can('leads:work');
  const done = (x: Lead) => { lead.setData(x); setDialog(null); setTick((t) => t + 1); };

  async function reopen() {
    setErr(null);
    try { done(await api<Lead>('POST', `/api/v1/leads/${id}/reopen`)); } catch (e) { setErr(e instanceof ApiError ? e.title : 'Não foi possível reabrir.'); }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader back={{ href: '/leads', label: 'Leads' }} title={<span className="flex flex-wrap items-center gap-3">{l.title}<Badge tone={TONE[l.status]}>{LEAD_STATUS[l.status]}</Badge></span>}
        subtitle={l.source ? `Origem: ${l.source}` : undefined}
        actions={<>
          {can('deals:assign') ? <Button variant="secondary" onClick={() => setDialog('assign')}><UserPlus size={16} aria-hidden />Atribuir</Button> : null}
          {canWork && openLead ? <Button variant="danger" onClick={() => setDialog('disqualify')}><XCircle size={16} aria-hidden />Descartar</Button> : null}
          {canWork && openLead && can('deals:edit') ? <Button onClick={() => setDialog('qualify')}><ArrowRightCircle size={16} aria-hidden />Qualificar</Button> : null}
          {canWork && l.status === 'disqualified' ? <Button variant="secondary" onClick={reopen}><RotateCcw size={16} aria-hidden />Reabrir</Button> : null}
        </>} />
      {err ? <Alert tone="error">{err}</Alert> : null}
      {l.status === 'qualified' && l.dealId ? <Alert tone="success">Qualificado em {l.qualifiedAt ? fmtDateTime.format(new Date(l.qualifiedAt)) : ''}. <Link href={`/negocios/${l.dealId}`} className="font-semibold underline">Abrir o negócio</Link></Alert> : null}
      {l.status === 'disqualified' ? <Alert tone="info">Descartado: {l.disqualifyReason}</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Dados">
          <dl>
            <Detail label="Contato"><Link href={`/contatos/${l.contact.id}`} className="text-accent hover:underline">{l.contact.name}</Link></Detail>
            <Detail label="E-mail">{l.contact.email}</Detail>
            <Detail label="Telefone">{phone(l.contact.phone)}</Detail>
            <Detail label="Responsável">{l.owner?.name ?? <Badge tone="warn">Sem responsável</Badge>}</Detail>
            <Detail label="Equipe">{l.team?.name}</Detail>
            <Detail label="Entrada">{fmtDateTime.format(new Date(l.createdAt))}</Detail>
            <Detail label="Atribuído">{l.assignedAt ? fmtDateTime.format(new Date(l.assignedAt)) : null}</Detail>
          </dl>
        </Panel>
        <div className="flex flex-col gap-5">
          <ActivitiesPanel filter={`leadId=${id}`} links={{ lead: { id: l.id, name: l.title }, contact: { id: l.contact.id, name: l.contact.name } }} canEdit={can('tasks:manage')} onChange={() => { void lead.reload(); setTick((t) => t + 1); }} />
          <NotesPanel kind="lead" id={id} canEdit={canWork} />
          <TimelinePanel kind="lead" id={id} refreshKey={tick} />
        </div>
      </div>
      <Dialog open={dialog === 'qualify'} onClose={() => setDialog(null)} title="Qualificar lead" description="Cria um negócio no funil escolhido, ligado a este lead e ao contato.">
        <QualifyForm lead={l} onDone={(x, dealId) => { done(x); void dealId; }} onCancel={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'disqualify'} onClose={() => setDialog(null)} title="Descartar lead">
        <DisqualifyForm lead={l} onDone={done} onCancel={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'assign'} onClose={() => setDialog(null)} title="Atribuir lead">
        <AssignForm lead={l} onDone={done} onCancel={() => setDialog(null)} />
      </Dialog>
    </div>
  );
}

function QualifyForm({ lead, onDone, onCancel }: { lead: Lead; onDone: (l: Lead, dealId: string) => void; onCancel: () => void }) {
  const router = useRouter();
  const { data: pipelines } = usePipelines();
  const active = (pipelines ?? []).filter((p) => !p.archived);
  const [pipe, setPipe] = useState('');
  const pipeline = active.find((p) => p.id === (pipe || active[0]?.id));
  const [stage, setStage] = useState('');
  const [title, setTitle] = useState(lead.title);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ lead: Lead; dealId: string }>('POST', `/api/v1/leads/${lead.id}/qualify`, {
        pipelineId: pipeline?.id, ...(stage ? { stageId: stage } : {}), title, ...(value ? { valueCents: parseMoney(value) ?? 0 } : {}),
      });
      onDone(r.lead, r.dealId);
      router.push(`/negocios/${r.dealId}`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : null);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err.title} {err.errors.map((x) => x.message).join(' ')}</Alert> : null}
      <Field label="Título do negócio" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Funil" value={pipeline?.id ?? ''} onChange={(e) => { setPipe(e.target.value); setStage(''); }}>
          {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select label="Etapa" value={stage} onChange={(e) => setStage(e.target.value)}>
          {(pipeline?.stages ?? []).filter((s) => s.kind === 'open').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      <Field label="Valor estimado (R$)" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button><Button type="submit" loading={busy} disabled={!pipeline}>Qualificar e criar negócio</Button></div>
    </form>
  );
}

function DisqualifyForm({ lead, onDone, onCancel }: { lead: Lead; onDone: (l: Lead) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { onDone(await api<Lead>('POST', `/api/v1/leads/${lead.id}/disqualify`, { reason })); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Textarea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} hint="Ex.: sem orçamento, fora do perfil, contato inválido." />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button><Button type="submit" variant="danger" loading={busy} disabled={!reason.trim()}>Descartar</Button></div>
    </form>
  );
}

function AssignForm({ lead, onDone, onCancel }: { lead: Lead; onDone: (l: Lead) => void; onCancel: () => void }) {
  const [owner, setOwner] = useState<string | null>(lead.owner?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try { onDone(await api<Lead>('POST', `/api/v1/leads/${lead.id}/assign`, { ownerId: owner })); } catch (e2) {
      setErr(e2 instanceof ApiError ? (e2.errors[0]?.message ?? e2.title) : 'Não foi possível atribuir.');
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err}</Alert> : null}
      <MemberSelect value={owner} onChange={setOwner} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button><Button type="submit" loading={busy}>Atribuir</Button></div>
    </form>
  );
}
