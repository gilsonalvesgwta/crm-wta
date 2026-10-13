'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { REQUIRED_LABEL, type Pipeline, type Stage } from '@/lib/crm';
import { useDirectory, useFields, usePipelines } from '@/components/crm/data';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Confirm } from '@/components/ui/confirm';
import { Empty, Loading } from '@/components/ui/states';

type StageDraft = Omit<Stage, 'id' | 'position' | 'allowedTargets'> & { id?: string; key: string };
const KIND_LABEL = { open: 'Em andamento', won: 'Ganho', lost: 'Perdido' };

export default function PipelinesSettings() {
  const { data: all, refresh } = usePipelines();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = all ?? [];
  const current = list.find((p) => p.id === selected) ?? list.find((p) => !p.archived) ?? list[0];

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const p = await api<Pipeline>('POST', '/api/v1/pipelines', { name });
      setName('');
      await refresh();
      setSelected(p.id);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.title : 'Não foi possível criar.');
    } finally {
      setBusy(false);
    }
  }

  if (!all) return <Loading />;
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel title="Funis">
          {!list.length ? <p className="text-[13px] text-muted">Nenhum funil ainda.</p> : (
            <ul className="flex flex-col gap-1">
              {list.map((p) => (
                <li key={p.id}>
                  <button type="button" aria-current={current?.id === p.id ? 'true' : undefined} onClick={() => setSelected(p.id)}
                    className={`flex h-10 w-full items-center justify-between gap-2 rounded-[6px] px-3 text-left text-sm ${current?.id === p.id ? 'bg-surface-2 font-semibold' : 'hover:bg-surface-2'}`}>
                    <span className="truncate">{p.name}</span>
                    <span className="flex items-center gap-1">{p.restricted ? <Lock size={13} aria-label="Restrito" /> : null}{p.archived ? <Badge>Arquivado</Badge> : null}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={create} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            <Field label="Novo funil" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Vendas, Onboarding" hint="Nasce com etapas padrão, que você ajusta." />
            {err ? <Alert tone="error">{err}</Alert> : null}
            <Button type="submit" variant="secondary" loading={busy} disabled={!name.trim()}><Plus size={16} aria-hidden />Criar funil</Button>
          </form>
        </Panel>
      </div>
      {current ? <PipelineEditor key={current.id} pipeline={current} onChange={refresh} /> : <Empty title="Crie o primeiro funil">Cada funil tem suas etapas, regras e quem pode ver.</Empty>}
    </div>
  );
}

function PipelineEditor({ pipeline, onChange }: { pipeline: Pipeline; onChange: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-5">
      <GeneralPanel pipeline={pipeline} onChange={onChange} />
      <StagesPanel pipeline={pipeline} onChange={onChange} />
      <TransitionsPanel pipeline={pipeline} onChange={onChange} />
    </div>
  );
}

function GeneralPanel({ pipeline, onChange }: { pipeline: Pipeline; onChange: () => Promise<void> }) {
  const { data: dir } = useDirectory();
  const [name, setName] = useState(pipeline.name);
  const [restricted, setRestricted] = useState(pipeline.restricted);
  const [teams, setTeams] = useState<string[]>(pipeline.access?.teamIds ?? []);
  const [people, setPeople] = useState<string[]>(pipeline.access?.membershipIds ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [del, setDel] = useState(false);

  async function save(patch: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api('PATCH', `/api/v1/pipelines/${pipeline.id}`, patch);
      await onChange();
      setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.title : 'Não foi possível salvar.' });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try {
      await api('DELETE', `/api/v1/pipelines/${pipeline.id}`);
      await onChange();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.title : 'Não foi possível excluir.' });
    }
    setDel(false);
  }
  const toggle = (list: string[], id: string, set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Panel title={pipeline.name} actions={<div className="flex gap-2">
      <Button variant="secondary" onClick={() => save({ archived: !pipeline.archived }, pipeline.archived ? 'Funil reativado.' : 'Funil arquivado: some das listas, os negócios continuam.')}>{pipeline.archived ? 'Reativar' : 'Arquivar'}</Button>
      <Button variant="danger" onClick={() => setDel(true)} aria-label="Excluir funil"><Trash2 size={16} aria-hidden /></Button>
    </div>}>
      <div className="flex flex-col gap-4">
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        <div className="flex flex-wrap items-end gap-2">
          <Field className="min-w-[240px] flex-1" label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="secondary" loading={busy} disabled={!name.trim() || name === pipeline.name} onClick={() => save({ name }, 'Nome salvo.')}>Salvar nome</Button>
        </div>
        <fieldset className="flex flex-col gap-3 rounded-[8px] border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">Quem vê este funil</legend>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} />
            Restringir a equipes e pessoas escolhidas
          </label>
          {restricted ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="mb-1 text-[13px] font-medium">Equipes</p>
                {(dir?.teams ?? []).map((t) => <label key={t.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={teams.includes(t.id)} onChange={() => toggle(teams, t.id, setTeams)} />{t.name}</label>)}
                {!dir?.teams.length ? <p className="text-[13px] text-muted">Nenhuma equipe criada.</p> : null}
              </div>
              <div><p className="mb-1 text-[13px] font-medium">Pessoas</p>
                <div className="max-h-48 overflow-y-auto">{(dir?.members ?? []).map((m) => <label key={m.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={people.includes(m.id)} onChange={() => toggle(people, m.id, setPeople)} />{m.name}</label>)}</div>
              </div>
            </div>
          ) : null}
          <p className="text-[13px] text-muted">Quem administra funis sempre vê todos. Fora da lista, o funil e seus negócios somem das telas, da API e das exportações.</p>
          <div><Button variant="secondary" loading={busy} onClick={() => save({ restricted, access: { teamIds: teams, membershipIds: people } }, 'Acesso salvo.')}>Salvar acesso</Button></div>
        </fieldset>
      </div>
      <Confirm open={del} title={`Excluir o funil ${pipeline.name}?`} confirmLabel="Excluir" onConfirm={remove} onCancel={() => setDel(false)}>
        Só é possível excluir um funil sem negócios. Com negócios, arquive.
      </Confirm>
    </Panel>
  );
}

function StagesPanel({ pipeline, onChange }: { pipeline: Pipeline; onChange: () => Promise<void> }) {
  const { data: fields } = useFields('deal');
  const toDraft = (s: Stage): StageDraft => ({ id: s.id, key: s.id, name: s.name, color: s.color, probability: s.probability, kind: s.kind, requiredFields: s.requiredFields, rottingDays: s.rottingDays });
  const [rows, setRows] = useState<StageDraft[]>(pipeline.stages.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const requiredOptions = [...Object.keys(REQUIRED_LABEL), ...(fields ?? []).filter((f) => !f.archived).map((f) => `custom.${f.key}`)];
  const reqLabel = (k: string) => REQUIRED_LABEL[k] ?? fields?.find((f) => `custom.${f.key}` === k)?.label ?? k;
  const set = (i: number, patch: Partial<StageDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveRow = (i: number, d: number) => { const n = [...rows]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); setRows(n); };

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api('PUT', `/api/v1/pipelines/${pipeline.id}/stages`, {
        stages: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, color: r.color, probability: Number(r.probability) || 0, kind: r.kind, requiredFields: r.requiredFields, rottingDays: r.rottingDays || null })),
      });
      await onChange();
      setMsg({ tone: 'success', text: 'Etapas salvas.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? [e.title, ...e.errors.map((x) => x.message)].join(' ') : 'Não foi possível salvar.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Etapas" description="A ordem é a do quadro. O funil precisa de uma etapa de ganho e uma de perda.">
      <div className="flex flex-col gap-3">
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        {rows.map((r, i) => (
          <fieldset key={r.key} className="flex flex-col gap-3 rounded-[8px] border border-line p-3" style={{ borderLeft: `4px solid ${r.color}` }}>
            <legend className="sr-only">Etapa {i + 1}</legend>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_110px_auto]">
              <input aria-label={`Nome da etapa ${i + 1}`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-3 text-sm font-medium" />
              <select aria-label={`Tipo da etapa ${i + 1}`} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Stage['kind'] })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <label className="flex h-10 items-center gap-1 rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
                <span className="sr-only">Probabilidade da etapa {i + 1}</span>
                <input type="number" min={0} max={100} value={r.probability} onChange={(e) => set(i, { probability: Number(e.target.value) })} className="w-12 bg-transparent text-right outline-none" />%
              </label>
              <div className="flex items-center gap-1">
                <input type="color" aria-label={`Cor da etapa ${i + 1}`} value={r.color} onChange={(e) => set(i, { color: e.target.value.toUpperCase() })} className="h-10 w-10 cursor-pointer rounded-[6px] border border-line-strong bg-surface p-1" />
                <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => moveRow(i, -1)} className="flex size-10 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowUp size={16} aria-hidden /></button>
                <button type="button" aria-label="Descer" disabled={i === rows.length - 1} onClick={() => moveRow(i, 1)} className="flex size-10 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowDown size={16} aria-hidden /></button>
                <button type="button" aria-label={`Remover etapa ${r.name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="flex size-10 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={16} aria-hidden /></button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span className="text-muted">Para entrar, exige:</span>
              {requiredOptions.map((k) => (
                <label key={k} className="flex min-h-8 items-center gap-1.5">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={r.requiredFields.includes(k)}
                    onChange={(e) => set(i, { requiredFields: e.target.checked ? [...r.requiredFields, k] : r.requiredFields.filter((x) => x !== k) })} />{reqLabel(k)}
                </label>
              ))}
            </div>
            {r.kind === 'open' ? (
              <label className="flex items-center gap-2 text-[13px]">
                <span className="text-muted">Marcar como parado depois de</span>
                <input type="number" min={1} max={365} value={r.rottingDays ?? ''} placeholder="—" onChange={(e) => set(i, { rottingDays: e.target.value ? Number(e.target.value) : null })}
                  className="h-8 w-16 rounded-[6px] border border-line-strong bg-surface px-2 text-right" aria-label={`Dias sem atividade na etapa ${r.name}`} />
                <span className="text-muted">dias sem atividade</span>
              </label>
            ) : null}
          </fieldset>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={() => setRows([...rows.filter((r) => r.kind === 'open'), { key: crypto.randomUUID(), name: 'Nova etapa', color: '#64748B', probability: 50, kind: 'open', requiredFields: [], rottingDays: null }, ...rows.filter((r) => r.kind !== 'open')])}>
            <Plus size={16} aria-hidden />Adicionar etapa
          </Button>
          <Button loading={busy} onClick={save}>Salvar etapas</Button>
        </div>
      </div>
    </Panel>
  );
}

function TransitionsPanel({ pipeline, onChange }: { pipeline: Pipeline; onChange: () => Promise<void> }) {
  const init = new Set(pipeline.stages.flatMap((s) => s.allowedTargets.map((t) => `${s.id}>${t}`)));
  const [rules, setRules] = useState(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const stages = pipeline.stages;
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api('PUT', `/api/v1/pipelines/${pipeline.id}/transitions`, { rules: [...rules].map((r) => { const [a, b] = r.split('>'); return { fromStageId: a, toStageId: b }; }) });
      await onChange();
      setMsg('Regras salvas.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Regras de transição" description="Etapa sem nenhuma marcação pode ir para qualquer outra. Marque para limitar os destinos.">
      {msg ? <div className="mb-3"><Alert tone="success">{msg}</Alert></div> : null}
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead><tr><th scope="col" className="px-2 py-2 text-left text-[12px] font-medium text-muted">De ↓ / Para →</th>{stages.map((s) => <th key={s.id} scope="col" className="max-w-[90px] px-2 py-2 text-[12px] font-medium">{s.name}</th>)}</tr></thead>
          <tbody>
            {stages.filter((s) => s.kind === 'open').map((from) => (
              <tr key={from.id} className="border-t border-line">
                <th scope="row" className="px-2 py-2 text-left font-medium">{from.name}</th>
                {stages.map((to) => (
                  <td key={to.id} className="px-2 py-2 text-center">
                    {from.id === to.id ? <span className="text-muted">—</span> : (
                      <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={`Permitir de ${from.name} para ${to.name}`}
                        checked={rules.has(`${from.id}>${to.id}`)}
                        onChange={(e) => { const n = new Set(rules); if (e.target.checked) n.add(`${from.id}>${to.id}`); else n.delete(`${from.id}>${to.id}`); setRules(n); }} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end"><Button variant="secondary" loading={busy} onClick={save}>Salvar regras</Button></div>
    </Panel>
  );
}
