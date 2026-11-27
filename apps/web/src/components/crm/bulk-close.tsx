'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useReasons } from './data';
import { localDay } from './move-deal';

type Result = { closed: number; skipped: { id: string; title: string; reason: string }[] };

/**
 * Fechar vários negócios de uma vez (ganho ou perdido) com a data em que
 * fecharam de verdade: acerta negócios antigos importados de outro sistema sem
 * jogar tudo no mês atual dos relatórios.
 */
export function BulkCloseDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (r: Result) => void }) {
  const today = localDay();
  const { data: reasons } = useReasons();
  const [outcome, setOutcome] = useState<'won' | 'lost'>('won');
  const [day, setDay] = useState(today);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const list = (reasons ?? []).filter((r) => r.kind === outcome && r.active);
  const needsReason = outcome === 'lost' && list.length > 0;

  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Result>('POST', '/api/v1/deals/bulk-close', { ids, outcome, closedAt: day || null, reasonId: reason || null, note: note || null });
      if (r.skipped.length) setResult(r);
      else onDone(r);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? (e2.errors[0]?.message ?? e2.title) : 'Não foi possível fechar os negócios.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Dialog open onClose={() => onDone(result)} title="Negócios fechados">
        <div className="flex flex-col gap-3">
          <Alert tone={result.closed ? 'success' : 'warning'}>{result.closed} negócio(s) fechado(s). {result.skipped.length} ficaram como estavam:</Alert>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-sm">
            {result.skipped.map((s) => <li key={s.id}><a href={`/negocios/${s.id}`} className="font-medium underline">{s.title || 'Negócio'}</a> — <span className="text-muted">{s.reason}</span></li>)}
          </ul>
          <div className="flex justify-end"><Button onClick={() => onDone(result)}>Entendi</Button></div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={`Fechar ${ids.length} negócio(s)`} description="Cada um vai para a etapa de ganho ou perda do próprio funil.">
      <form onSubmit={go} className="flex flex-col gap-4">
        {err ? <Alert tone="error">{err}</Alert> : null}
        <div role="radiogroup" aria-label="Resultado" className="flex gap-2">
          {([['won', 'Ganho'], ['lost', 'Perdido']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={outcome === k} onClick={() => { setOutcome(k); setReason(''); }}
              className={`h-10 flex-1 rounded-[6px] border text-sm font-semibold ${outcome === k ? (k === 'won' ? 'border-ok bg-ok-soft text-ink' : 'border-bad bg-bad-soft text-ink') : 'border-line text-muted'}`}>{l}</button>
          ))}
        </div>
        <Field label="Data do fechamento" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)}
          hint="Use a data em que fecharam de verdade: relatórios e metas contam no mês certo. Os que já estão fechados com este resultado só têm a data corrigida." />
        {list.length ? (
          <Select label={outcome === 'won' ? 'Motivo do ganho (opcional)' : 'Motivo da perda'} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{needsReason ? 'Escolha o motivo' : '—'}</option>
            {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        ) : null}
        <Textarea label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!day || (needsReason && !reason)}>Fechar {ids.length}</Button>
        </div>
      </form>
    </Dialog>
  );
}
