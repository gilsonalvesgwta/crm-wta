'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { OUTCOME_LABEL, fmtDateTime, money, type CallOutcome } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useTags } from './data';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { LoadError, Loading } from '@/components/ui/states';

export type KpiMetric = 'leads' | 'prospected' | 'scheduled' | 'held' | 'no_show' | 'rescheduled' | 'sales';
export const METRIC_NAME: Record<KpiMetric, string> = {
  leads: 'Leads', prospected: 'Prospecções', scheduled: 'Reuniões agendadas', held: 'Reuniões realizadas',
  no_show: 'Não compareceram', rescheduled: 'Remarcadas', sales: 'Vendas',
};
const METRIC_HELP: Record<KpiMetric, string> = {
  leads: 'Contatos que receberam a etiqueta de lead no período (ou, sem etiqueta escolhida, todo contato novo).',
  prospected: 'Pessoas que receberam mensagem (equipe, campanha ou automação) ou tiveram reunião realizada.',
  scheduled: 'Ligações e reuniões criadas na agenda no período.',
  held: 'Ligações e reuniões do período concluídas como realizadas.',
  no_show: 'Ligações e reuniões do período concluídas como "não compareceu".',
  rescheduled: 'Ligações e reuniões do período concluídas como "remarcada".',
  sales: 'Negócios ganhos no período, com o valor cadastrado no negócio (é ele que forma o faturamento e o ticket médio).',
};

type Item = {
  id: string; title: string; detail: string | null; at: string; valueCents: number | null; excluded: boolean;
  outcome?: CallOutcome | null; type?: string;
};
type Details = { metric: KpiMetric; kind: 'contact' | 'activity' | 'deal'; items: Item[] };

const href = (kind: Details['kind'], i: Item) => (kind === 'contact' ? `/contatos/${i.id}` : kind === 'deal' ? `/negocios/${i.id}` : '/agenda');

/** Conferência de um número: o que foi contado, com link para corrigir e opção de tirar da conta. */
export function KpiDetailsDialog({ metric, from, to, onClose, onChanged }: {
  metric: KpiMetric; from: string; to: string; onClose: () => void; onChanged: () => void;
}) {
  const { can } = useSession();
  const canEdit = can('reports:export');
  const data = useLoad(() => api<Details>('GET', `/api/v1/dashboard/kpis/details?from=${from}&to=${to}&metric=${metric}`), [metric, from, to]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(i: Item) {
    setBusy(i.id);
    setErr(null);
    try {
      await api('POST', '/api/v1/dashboard/kpis/exclusions', { kind: data.data!.kind, id: i.id, excluded: !i.excluded });
      await data.reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível mudar.');
    } finally {
      setBusy(null);
    }
  }

  const d = data.data;
  const counted = d ? d.items.filter((i) => !i.excluded) : [];
  const total = counted.reduce((s, i) => s + (i.valueCents ?? 0), 0);
  return (
    <Dialog open title={`Conferir: ${METRIC_NAME[metric]}`} description={METRIC_HELP[metric]} onClose={onClose} width={760}>
      <div className="flex flex-col gap-3">
        {err ? <Alert tone="error">{err}</Alert> : null}
        {data.error ? <LoadError error={data.error} retry={data.reload} /> : !d ? <Loading /> : !d.items.length ? (
          <p className="text-[13px] text-muted">Nada contado no período.</p>
        ) : (
          <>
            <p className="text-[13px]">
              <strong>{counted.length}</strong> contados{metric === 'sales' ? <> · <strong>{money(total)}</strong></> : null}
              {d.items.length > counted.length ? <span className="text-muted"> · {d.items.length - counted.length} fora dos KPIs</span> : null}
            </p>
            <ul className="flex max-h-[55vh] flex-col overflow-y-auto rounded-[8px] border border-line" aria-label={`Registros de ${METRIC_NAME[metric]}`}>
              {d.items.map((i) => (
                <li key={i.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-sm last:border-0 ${i.excluded ? 'bg-surface-2' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <Link href={href(d.kind, i)} className={`font-medium hover:underline ${i.excluded ? 'text-muted line-through' : ''}`}>{i.title}</Link>
                    <p className="flex flex-wrap gap-x-2 text-[12px] text-muted">
                      <span>{fmtDateTime.format(new Date(i.at))}</span>
                      {i.detail ? <span>{i.detail}</span> : null}
                      {i.outcome && i.outcome !== 'held' ? <span>{OUTCOME_LABEL[i.outcome]}</span> : null}
                    </p>
                  </div>
                  {i.valueCents !== null ? <span className="tabular-nums">{money(i.valueCents)}</span> : null}
                  {i.excluded ? <Badge tone="warn">Fora dos KPIs</Badge> : null}
                  {canEdit ? (
                    <Button type="button" variant="ghost" loading={busy === i.id} onClick={() => void toggle(i)}
                      aria-label={`${i.excluded ? 'Voltar a contar' : 'Não contar nos KPIs'}: ${i.title}`}>
                      {i.excluded ? 'Voltar a contar' : 'Não contar'}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-muted">
              "Não contar" tira o registro só dos KPIs: nada é apagado do CRM e dá para voltar a contar.
              {metric === 'sales' ? ' Valor errado? Abra o negócio e corrija o valor: o ticket e o faturamento mudam junto.' : ''}
              {metric === 'leads' ? ' Quem não é lead também pode perder a etiqueta no próprio contato.' : ''}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Qual etiqueta marca um contato como lead. */
export function KpiSettingsDialog({ current, onClose, onSaved }: { current: string[]; onClose: () => void; onSaved: () => void }) {
  const tags = useTags();
  const [sel, setSel] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api('PATCH', '/api/v1/dashboard/kpis/settings', { leadTagIds: sel });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open title="Etiqueta de lead" onClose={onClose} width={520}
      description="Só contatos com uma destas etiquetas contam como lead, na data em que receberam a etiqueta. Uma automação pode colocar a etiqueta sozinha (por exemplo, em quem chega pelo anúncio).">
      <div className="flex flex-col gap-4">
        {err ? <Alert tone="error">{err}</Alert> : null}
        {!tags.data ? <Loading /> : !tags.data.length ? (
          <p className="text-[13px] text-muted">Ainda não há etiquetas. Crie uma (ex.: "Lead anúncio") num contato e volte aqui.</p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Etiquetas de lead</legend>
            {tags.data.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sel.includes(t.id)} className="size-4 accent-[var(--primary)]"
                  onChange={(e) => setSel((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
                <span className="inline-block size-2.5 rounded-full" style={{ background: t.color }} aria-hidden />
                {t.name}
              </label>
            ))}
          </fieldset>
        )}
        <p className="text-[12px] text-muted">Sem etiqueta marcada, todo contato novo conta como lead.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="button" loading={busy} onClick={() => void save()}>Salvar</Button>
        </div>
      </div>
    </Dialog>
  );
}
