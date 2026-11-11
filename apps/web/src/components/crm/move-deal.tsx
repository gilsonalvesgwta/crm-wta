'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Deal, Pipeline, Stage } from '@/lib/crm';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useReasons } from './data';

type Pending = { dealId: string; title: string; to: Stage; resolve: (d: Deal | null) => void };

/**
 * Mover negócio de etapa. Ganho e perda pedem motivo; se a etapa exigir campos
 * que faltam, a API recusa e a mensagem diz quais são.
 */
export function useMoveDeal(): { move: (dealId: string, title: string, to: Stage) => Promise<Deal | null>; dialog: ReactNode; error: string | null; clearError: () => void } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(dealId: string, to: Stage, extra: { reasonId?: string | null; note?: string | null } = {}): Promise<Deal> {
    return api<Deal>('POST', `/api/v1/deals/${dealId}/move`, { stageId: to.id, ...extra });
  }

  function explain(e: unknown, to: Stage): string {
    if (e instanceof ApiError) {
      if (e.type === 'stage-requirements') return `${e.title} ${e.errors.map((x) => x.message).join(' ')}`;
      if (e.type === 'transition-not-allowed') return `Este funil não permite ir direto para "${to.name}".`;
      return e.title;
    }
    return 'Não foi possível mover o negócio.';
  }

  async function move(dealId: string, title: string, to: Stage): Promise<Deal | null> {
    setError(null);
    if (to.kind !== 'open') {
      return new Promise((resolve) => setPending({ dealId, title, to, resolve }));
    }
    try {
      return await call(dealId, to);
    } catch (e) {
      setError(explain(e, to));
      return null;
    }
  }

  const dialog = (
    <Dialog open={!!pending} onClose={() => { pending?.resolve(null); setPending(null); }}
      title={pending?.to.kind === 'won' ? 'Marcar como ganho' : 'Marcar como perdido'} description={pending?.title}>
      {pending ? <OutcomeForm pending={pending} onDone={(d) => { pending.resolve(d); setPending(null); }}
        submit={(extra) => call(pending.dealId, pending.to, extra)} explain={(e) => explain(e, pending.to)} /> : null}
    </Dialog>
  );
  return { move, dialog, error, clearError: () => setError(null) };
}

function OutcomeForm({ pending, submit, onDone, explain }: {
  pending: Pending; submit: (x: { reasonId: string | null; note: string | null }) => Promise<Deal>; onDone: (d: Deal | null) => void; explain: (e: unknown) => string;
}) {
  const { data: reasons } = useReasons();
  const list = (reasons ?? []).filter((r) => r.kind === pending.to.kind && r.active);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsReason = pending.to.kind === 'lost' && list.length > 0;

  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onDone(await submit({ reasonId: reason || null, note: note || null }));
    } catch (e2) {
      setErr(explain(e2));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={go} className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err}</Alert> : null}
      {list.length ? (
        <Select label={pending.to.kind === 'won' ? 'Motivo do ganho (opcional)' : 'Motivo da perda'} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">{needsReason ? 'Escolha o motivo' : '—'}</option>
          {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      ) : null}
      <Textarea label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>Cancelar</Button>
        <Button type="submit" loading={busy} disabled={needsReason && !reason}>{pending.to.kind === 'won' ? 'Marcar como ganho' : 'Marcar como perdido'}</Button>
      </div>
    </form>
  );
}

/** Transferir o negócio para outro funil, já na etapa escolhida. */
export function TransferDealDialog({ open, deal, pipelines, onClose, onDone }: {
  open: boolean; deal: Deal; pipelines: Pipeline[]; onClose: () => void; onDone: (d: Deal) => void;
}) {
  const targets = pipelines.filter((p) => !p.archived && p.id !== deal.pipeline.id);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = targets.find((p) => p.id === pipelineId) ?? null;
  const stages = (target?.stages ?? []).filter((s) => s.kind === 'open');
  function pick(id: string) {
    setPipelineId(id);
    setStageId(targets.find((p) => p.id === id)?.stages.find((s) => s.kind === 'open')?.id ?? '');
  }
  async function go(e: FormEvent) {
    e.preventDefault();
    if (!pipelineId || !stageId) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await api<Deal>('POST', `/api/v1/deals/${deal.id}/move`, { pipelineId, stageId }));
      setPipelineId(''); setStageId('');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? (e2.type === 'stage-requirements' ? `${e2.title} ${e2.errors.map((x) => x.message).join(' ')}` : e2.title) : 'Não foi possível transferir.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Transferir para outro funil" description={deal.title}>
      <form onSubmit={go} className="flex flex-col gap-4">
        {err ? <Alert tone="error">{err}</Alert> : null}
        {!targets.length ? <Alert tone="info">Não há outro funil ativo. Crie um em Configurações › Funis.</Alert> : null}
        <p className="text-[13px] text-muted">Hoje em <strong className="text-ink">{deal.pipeline.name}</strong> › {deal.stage.name}. O histórico, as atividades e os arquivos vão junto.</p>
        <Select label="Funil de destino" value={pipelineId} onChange={(e) => pick(e.target.value)}>
          <option value="">Escolha o funil</option>
          {targets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select label="Etapa" value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={!target}>
          {!target ? <option value="">Escolha o funil primeiro</option> : null}
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {deal.status !== 'open' ? <p className="text-[13px] text-muted">O negócio está {deal.status === 'won' ? 'ganho' : 'perdido'}: ao transferir, ele volta a ficar em andamento.</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!pipelineId || !stageId}>Transferir</Button>
        </div>
      </form>
    </Dialog>
  );
}
