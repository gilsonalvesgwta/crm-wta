'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Pipeline } from '@/lib/crm';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

type Member = { id: string; name: string };

/**
 * Trocar o responsável de vários negócios de uma vez (por exemplo, depois de
 * importar tudo de outro CRM). Mostra quantos negócios vão mudar antes de
 * confirmar.
 */
export function BulkOwnerDialog({ open, pipelines, pipelineId, members, me, onClose, onDone }: {
  open: boolean; pipelines: Pipeline[]; pipelineId: string; members: Member[]; me: string;
  onClose: () => void; onDone: (n: number) => void;
}) {
  const [funil, setFunil] = useState(pipelineId);
  const [from, setFrom] = useState(me);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [to, setTo] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setFunil(pipelineId); setFrom(me); setTo(''); setErr(null); } }, [open, pipelineId, me]);

  const body = (dryRun: boolean) => ({
    pipelineId: funil || null, fromOwnerId: from || null, status, toOwnerId: to, dryRun,
  });

  useEffect(() => {
    if (!open || !to) { setCount(null); return; }
    let live = true;
    setCount(null);
    api<{ count: number }>('POST', '/api/v1/deals/bulk-owner', body(true))
      .then((r) => { if (live) setCount(r.count); })
      .catch((e) => { if (live) setErr(e instanceof ApiError ? e.title : 'Não foi possível contar os negócios.'); });
    return () => { live = false; };
  }, [open, funil, from, status, to]); // eslint-disable-line react-hooks/exhaustive-deps

  async function go(e: FormEvent) {
    e.preventDefault();
    if (!to || !count) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ updated: number }>('POST', '/api/v1/deals/bulk-owner', body(false));
      onDone(r.updated);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.title : 'Não foi possível trocar o responsável.');
    } finally {
      setBusy(false);
    }
  }

  const name = (id: string) => members.find((m) => m.id === id)?.name ?? '';
  return (
    <Dialog open={open} onClose={onClose} title="Trocar responsável em massa"
      description="Passa vários negócios de uma vez para outra pessoa. O histórico de cada negócio registra a troca.">
      <form onSubmit={go} className="flex flex-col gap-4">
        {err ? <Alert tone="error">{err}</Alert> : null}
        <Select label="Funil" value={funil} onChange={(e) => setFunil(e.target.value)}>
          <option value="">Todos os funis</option>
          {pipelines.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select label="Responsável atual" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Qualquer responsável</option>
          <option value="none">Sem responsável</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.id === me ? `${m.name} (você)` : m.name}</option>)}
        </Select>
        <Select label="Situação" value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'all')}>
          <option value="open">Só em andamento</option>
          <option value="all">Todos (inclui ganhos e perdidos)</option>
        </Select>
        <Select label="Novo responsável" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Escolha a pessoa</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.id === me ? `${m.name} (você)` : m.name}</option>)}
        </Select>
        {to ? (
          <p role="status" className="rounded-[8px] bg-surface-2 px-3 py-2.5 text-sm">
            {count === null ? 'Contando…'
              : count === 0 ? 'Nenhum negócio com estes filtros (ou já estão com essa pessoa).'
              : <><strong>{count}</strong> {count === 1 ? 'negócio vai' : 'negócios vão'} passar para <strong>{name(to)}</strong>.</>}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!to || !count}>
            {count ? `Transferir ${count}` : 'Transferir'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
