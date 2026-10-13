'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Reason } from '@/lib/crm';
import { useReasons } from '@/components/crm/data';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/states';

export default function ReasonsSettings() {
  const { data, refresh } = useReasons();
  if (!data) return <Loading />;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <ReasonList kind="lost" title="Motivos de perda" description="Com motivos cadastrados, marcar um negócio como perdido exige escolher um." items={data.filter((r) => r.kind === 'lost')} onChange={refresh} />
      <ReasonList kind="won" title="Motivos de ganho" description="Opcional ao marcar um negócio como ganho." items={data.filter((r) => r.kind === 'won')} onChange={refresh} />
    </div>
  );
}

function ReasonList({ kind, title, description, items, onChange }: { kind: 'won' | 'lost'; title: string; description: string; items: Reason[]; onChange: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/api/v1/outcome-reasons', { kind, name });
      setName('');
      await onChange();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.title : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  async function toggle(r: Reason) {
    await api('PATCH', `/api/v1/outcome-reasons/${r.id}`, { active: !r.active }).catch(() => undefined);
    await onChange();
  }
  return (
    <Panel title={title} description={description}>
      <ul className="mb-4 flex flex-col">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 border-t border-line py-2 first:border-t-0 first:pt-0">
            <span className={r.active ? '' : 'text-muted line-through'}>{r.name}</span>
            <span className="flex items-center gap-2">{!r.active ? <Badge>Desativado</Badge> : null}<Button variant="ghost" onClick={() => toggle(r)}>{r.active ? 'Desativar' : 'Reativar'}</Button></span>
          </li>
        ))}
        {!items.length ? <li className="text-[13px] text-muted">Nenhum motivo.</li> : null}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <label htmlFor={`motivo-${kind}`} className="sr-only">Novo motivo</label>
        <input id={`motivo-${kind}`} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'lost' ? 'Ex.: Preço, Concorrente, Sem retorno' : 'Ex.: Indicação, Atendimento'}
          className="h-10 flex-1 rounded-[6px] border border-line-strong bg-surface px-3 text-sm placeholder:text-muted" />
        <Button type="submit" variant="secondary" loading={busy} disabled={!name.trim()}>Adicionar</Button>
      </form>
      {err ? <div className="mt-2"><Alert tone="error">{err}</Alert></div> : null}
    </Panel>
  );
}
