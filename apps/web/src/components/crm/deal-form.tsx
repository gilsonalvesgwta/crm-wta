'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { moneyInput, parseMoney, type Deal, type Ref } from '@/lib/crm';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { CustomFieldInputs } from './custom-fields';
import { useFields, usePipelines } from './data';
import { EntityPicker, MemberSelect, TagPicker } from './pickers';

export function DealDialog({ open, deal, pipelineId, stageId, contact, organization, onClose, onSaved }: {
  open: boolean; deal?: Deal | null; pipelineId?: string; stageId?: string; contact?: Ref | null; organization?: Ref | null;
  onClose: () => void; onSaved: (d: Deal) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={deal ? 'Editar negócio' : 'Novo negócio'} width={640}>
      <DealForm deal={deal ?? null} pipelineId={pipelineId} stageId={stageId} contact={contact ?? null} organization={organization ?? null}
        onSaved={onSaved} onCancel={onClose} />
    </Dialog>
  );
}

function DealForm({ deal, pipelineId, stageId, contact, organization, onSaved, onCancel }: {
  deal: Deal | null; pipelineId?: string; stageId?: string; contact: Ref | null; organization: Ref | null;
  onSaved: (d: Deal) => void; onCancel: () => void;
}) {
  const { data: pipelines } = usePipelines();
  const { data: defs } = useFields('deal');
  const active = (pipelines ?? []).filter((p) => !p.archived);
  const [pipe, setPipe] = useState(pipelineId ?? '');
  const pipeline = active.find((p) => p.id === (pipe || active[0]?.id));
  const [stage, setStage] = useState(stageId ?? '');
  const [title, setTitle] = useState(deal?.title ?? '');
  const [value, setValue] = useState(moneyInput(deal?.valueCents ?? null));
  const [c, setC] = useState<Ref | null>(deal?.contact ?? contact);
  const [o, setO] = useState<Ref | null>(deal?.organization ?? organization);
  const [owner, setOwner] = useState<string | null | undefined>(deal ? deal.owner?.id ?? null : undefined);
  const [close, setClose] = useState(deal?.expectedCloseDate ?? '');
  const [tags, setTags] = useState<string[]>(deal?.tags.map((t) => t.id) ?? []);
  const [custom, setCustom] = useState<Record<string, unknown>>(deal?.custom ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const openStages = pipeline?.stages.filter((s) => s.kind === 'open') ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const cents = value.trim() ? parseMoney(value) : 0;
    if (cents === null) {
      setErr(new ApiError(422, 'validation', 'Confira os campos destacados.', [{ field: 'valueCents', message: 'Valor inválido.' }]));
      setBusy(false);
      return;
    }
    const body: Record<string, unknown> = {
      title, valueCents: cents, contactId: c?.id ?? null, organizationId: o?.id ?? null, expectedCloseDate: close || null, tagIds: tags, custom,
    };
    if (owner !== undefined) body.ownerId = owner;
    try {
      const d = deal
        ? await api<Deal>('PATCH', `/api/v1/deals/${deal.id}`, body)
        : await api<Deal>('POST', '/api/v1/deals', { ...body, pipelineId: pipeline?.id, ...(stage ? { stageId: stage } : {}) });
      onSaved(d);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  if (!deal && pipelines && active.length === 0) {
    return <Alert tone="info">Nenhum funil disponível. Peça a quem administra o CRM para criar um em Configurações › Funis.</Alert>;
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err.title}</Alert> : null}
      <Field label="Título" value={title} onChange={(e) => setTitle(e.target.value)} error={err?.fieldError('title')} required autoFocus
        placeholder="Ex.: Implantação do CRM — Clínica Aurora" />
      {!deal ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Funil" value={pipeline?.id ?? ''} onChange={(e) => { setPipe(e.target.value); setStage(''); }} error={err?.fieldError('pipelineId')}>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="Etapa" value={stage || openStages[0]?.id || ''} onChange={(e) => setStage(e.target.value)} error={err?.fieldError('stageId')}>
            {openStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Valor (${pipeline?.currency ?? deal?.currency ?? 'BRL'})`} inputMode="decimal" placeholder="0,00" value={value}
          onChange={(e) => setValue(e.target.value)} error={err?.fieldError('valueCents')}
          hint={deal?.items.length ? 'Com produtos, o valor é a soma deles.' : undefined} disabled={!!deal?.items.length} />
        <Field label="Previsão de fechamento" type="date" value={close} onChange={(e) => setClose(e.target.value)} error={err?.fieldError('expectedCloseDate')} />
        <EntityPicker kind="contact" label="Contato" value={c} onChange={setC} error={err?.fieldError('contactId')} />
        <EntityPicker kind="organization" label="Organização" value={o} onChange={setO} error={err?.fieldError('organizationId')} />
        <MemberSelect value={owner === undefined ? null : owner} noneLabel={deal ? 'Sem responsável' : 'Eu (padrão)'} onChange={(v) => setOwner(v ?? (deal ? null : undefined))} error={err?.fieldError('ownerId')} />
      </div>
      <TagPicker value={tags} onChange={setTags} />
      <CustomFieldInputs defs={defs ?? []} value={custom} onChange={setCustom} error={err} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={busy} disabled={!title.trim()}>{deal ? 'Salvar' : 'Criar negócio'}</Button>
      </div>
    </form>
  );
}
