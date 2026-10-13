'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import type { TagRef } from '@/lib/crm';
import { useTags } from '@/components/crm/data';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { Loading } from '@/components/ui/states';

const COLORS = ['#64748B', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#2563EB', '#7C3AED', '#DB2777'];

export default function TagsSettings() {
  const { data, refresh } = useTags();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[6]!);
  const [err, setErr] = useState<string | null>(null);
  const [remove, setRemove] = useState<(TagRef & { uses: number }) | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api('POST', '/api/v1/tags', { name, color });
      setName('');
      await refresh();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.title : 'Não foi possível criar.');
    }
  }
  async function rename(t: TagRef) {
    setErr(null);
    try {
      await api('PATCH', `/api/v1/tags/${t.id}`, { name: editName });
      setEditing(null);
      await refresh();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.title : 'Não foi possível renomear.');
    }
  }
  async function recolor(t: TagRef, c: string) {
    await api('PATCH', `/api/v1/tags/${t.id}`, { color: c }).catch(() => undefined);
    await refresh();
  }
  async function del() {
    if (!remove) return;
    await api('DELETE', `/api/v1/tags/${remove.id}`).catch(() => undefined);
    setRemove(null);
    await refresh();
  }

  if (!data) return <Loading />;
  return (
    <Panel title="Etiquetas" description="Valem para contatos, organizações e negócios. Quem cadastra também pode criar etiquetas na hora.">
      <form onSubmit={add} className="mb-5 flex flex-wrap items-end gap-2">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label htmlFor="nova-etiqueta" className="text-[13px] font-medium">Nova etiqueta</label>
          <input id="nova-etiqueta" value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-[6px] border border-line-strong bg-surface px-3 text-sm" />
        </div>
        <div role="radiogroup" aria-label="Cor" className="flex gap-1">
          {COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${c}`} onClick={() => setColor(c)}
              className={`size-8 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`} style={{ background: c }} />
          ))}
        </div>
        <Button type="submit" variant="secondary" disabled={!name.trim()}>Criar</Button>
      </form>
      {err ? <div className="mb-3"><Alert tone="error">{err}</Alert></div> : null}
      <ul className="flex flex-col">
        {data.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <select aria-label={`Cor de ${t.name}`} value={t.color} onChange={(e) => recolor(t, e.target.value)} className="h-8 w-14 rounded-[6px] border border-line bg-surface text-xs" style={{ color: t.color }}>
              {[...new Set([t.color, ...COLORS])].map((c) => <option key={c} value={c} style={{ color: c }}>●</option>)}
            </select>
            {editing === t.id ? (
              <span className="flex flex-1 gap-2">
                <input aria-label="Novo nome" value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 flex-1 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm" />
                <Button variant="secondary" onClick={() => rename(t)}>Salvar</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              </span>
            ) : (
              <>
                <span className="flex-1 font-medium">{t.name}</span>
                <span className="text-[13px] text-muted">{t.uses} {t.uses === 1 ? 'uso' : 'usos'}</span>
                <Button variant="ghost" onClick={() => { setEditing(t.id); setEditName(t.name); }}>Renomear</Button>
                <Button variant="ghost" onClick={() => setRemove(t)}>Excluir</Button>
              </>
            )}
          </li>
        ))}
        {!data.length ? <li className="text-[13px] text-muted">Nenhuma etiqueta ainda.</li> : null}
      </ul>
      <Confirm open={!!remove} title={`Excluir a etiqueta ${remove?.name}?`} confirmLabel="Excluir" onConfirm={del} onCancel={() => setRemove(null)}>
        Ela sai de {remove?.uses ?? 0} {remove?.uses === 1 ? 'registro' : 'registros'}. Os registros continuam.
      </Confirm>
    </Panel>
  );
}
