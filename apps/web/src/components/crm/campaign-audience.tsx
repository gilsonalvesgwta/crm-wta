'use client';
import { Plus, Trash2 } from 'lucide-react';
import type { DealGroup } from '@/lib/campaigns';
import type { Pipeline } from '@/lib/crm';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';

const STATUS_LABEL: Record<DealGroup['status'], string> = { open: 'Em andamento', won: 'Ganho', lost: 'Perdido', any: 'Qualquer situação' };

/**
 * Grupos de negócio para o público da campanha: cada linha é um funil, as
 * etapas marcadas (nenhuma marcada = o funil todo) e a situação do negócio.
 * Usado para incluir e para excluir.
 */
export function DealGroupsEditor({ label, hint, value, pipelines, onChange, tone = 'include' }: {
  label: string; hint: string; value: DealGroup[]; pipelines: Pipeline[]; onChange: (v: DealGroup[]) => void; tone?: 'include' | 'exclude';
}) {
  const set = (i: number, g: DealGroup) => onChange(value.map((x, k) => (k === i ? g : x)));
  const active = pipelines.filter((p) => !p.archived);
  return (
    <fieldset className={`flex flex-col gap-2 rounded-[10px] border p-3 ${tone === 'exclude' ? 'border-bad/30' : 'border-line'}`}>
      <legend className="px-1 text-[13px] font-semibold">{label}</legend>
      <p className="-mt-1 text-[12px] text-muted">{hint}</p>
      {value.map((g, i) => {
        const p = pipelines.find((x) => x.id === g.pipelineId);
        const stages = p?.stages ?? [];
        return (
          <div key={i} className="flex flex-col gap-2 rounded-[8px] bg-surface-2 p-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <Select className="min-w-[180px] flex-1" label="Funil" value={g.pipelineId} onChange={(e) => set(i, { ...g, pipelineId: e.target.value, stageIds: [] })}>
                {active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              <Select className="w-44" label="Situação do negócio" value={g.status} onChange={(e) => set(i, { ...g, status: e.target.value as DealGroup['status'] })}>
                {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <button type="button" aria-label={`Remover ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))}
                className="mb-1.5 flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-bad"><Trash2 size={15} aria-hidden /></button>
            </div>
            <div role="group" aria-label={`Etapas de ${p?.name ?? 'funil'}`} className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={!g.stageIds.length} onClick={() => set(i, { ...g, stageIds: [] })}
                className={`h-8 rounded-full border px-3 text-[12px] font-medium ${!g.stageIds.length ? 'border-primary bg-accent-soft' : 'border-line bg-surface'}`}>Todas as etapas</button>
              {stages.map((st) => {
                const on = g.stageIds.includes(st.id);
                return (
                  <button key={st.id} type="button" aria-pressed={on}
                    onClick={() => set(i, { ...g, stageIds: on ? g.stageIds.filter((x) => x !== st.id) : [...g.stageIds, st.id] })}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium ${on ? 'border-primary bg-accent-soft' : 'border-line bg-surface'}`}>
                    <span aria-hidden className="size-2 rounded-full" style={{ background: st.color }} />{st.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {value.length < 10 && active.length ? (
        <button type="button" onClick={() => onChange([...value, { pipelineId: active[0]!.id, stageIds: [], status: 'open' }])}
          className="inline-flex h-9 items-center gap-1.5 self-start rounded-[6px] px-2 text-[13px] font-medium text-primary hover:bg-accent-soft">
          <Plus size={15} aria-hidden />{value.length ? 'Outro funil' : tone === 'exclude' ? 'Excluir quem está num funil/etapa' : 'Escolher funil e etapas'}
        </button>
      ) : null}
    </fieldset>
  );
}

export type Pace = { windowDays: number[]; maxPerHour: string; maxPerDay: string; pauseAt: string };
const DAYS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [7, 'Dom']] as const;

/** Dias da semana, limites por hora e por dia e pausa programada. */
export function PaceFields({ value, onChange }: { value: Pace; onChange: (patch: Partial<Pace>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Dias em que envia <span className="font-normal text-muted">(nenhum marcado: todos)</span></legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map(([n, l]) => {
            const on = value.windowDays.includes(n);
            return (
              <button key={n} type="button" aria-pressed={on} onClick={() => onChange({ windowDays: on ? value.windowDays.filter((x) => x !== n) : [...value.windowDays, n] })}
                className={`h-9 w-12 rounded-[6px] border text-[13px] font-medium ${on ? 'border-primary bg-accent-soft' : 'border-line bg-surface'}`}>{l}</button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid max-w-md gap-2 sm:grid-cols-2">
        <Field label="Máximo por hora" type="number" min={1} placeholder="Sem limite" value={value.maxPerHour} onChange={(e) => onChange({ maxPerHour: e.target.value })} />
        <Field label="Máximo por dia" type="number" min={1} placeholder="Sem limite" value={value.maxPerDay} onChange={(e) => onChange({ maxPerDay: e.target.value })} />
      </div>
      <p className="-mt-1 text-[12px] text-muted">Ao chegar no limite, a campanha espera a próxima hora (ou o dia seguinte) e continua de onde parou.</p>
      <Field className="max-w-xs" label="Pausar automaticamente em" type="datetime-local" value={value.pauseAt} onChange={(e) => onChange({ pauseAt: e.target.value })}
        hint="Opcional. Depois é só tocar em “Retomar” para continuar de onde parou." />
    </div>
  );
}

/** Converte os campos da tela para a API. */
export function paceToApi(v: Pace) {
  const n = (s: string) => (s.trim() && Number(s) > 0 ? Math.round(Number(s)) : null);
  return { windowDays: [...v.windowDays].sort(), maxPerHour: n(v.maxPerHour), maxPerDay: n(v.maxPerDay), pauseAt: v.pauseAt ? new Date(v.pauseAt).toISOString() : null };
}
