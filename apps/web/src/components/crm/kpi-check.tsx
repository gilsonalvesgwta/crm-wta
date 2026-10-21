'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { OUTCOME_LABEL, fmtDateTime, money, type CallOutcome } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useTags } from './data';
import { fmtDay } from './ad-spend';
import { Field } from '@/components/ui/field';
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
  leads: 'Contatos que receberam a etiqueta do funil no período (sem funil criado, todo contato novo).',
  prospected: 'Pessoas do funil que receberam mensagem (equipe, campanha ou automação) ou tiveram reunião realizada, mais o número lançado pelos vendedores.',
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
type Details = {
  metric: KpiMetric; kind: 'contact' | 'activity' | 'deal'; items: Item[];
  funnel: { id: string; name: string } | null;
  manual: { day: string; count: number; name: string; membershipId: string }[];
};

const href = (kind: Details['kind'], i: Item) => (kind === 'contact' ? `/contatos/${i.id}` : kind === 'deal' ? `/negocios/${i.id}` : '/agenda');

/** Conferência de um número: o que foi contado, com link para corrigir e opção de tirar da conta. */
export function KpiDetailsDialog({ metric, from, to, funnelId, onClose, onChanged }: {
  metric: KpiMetric; from: string; to: string; funnelId: string | null; onClose: () => void; onChanged: () => void;
}) {
  const { can } = useSession();
  const canEdit = can('reports:export');
  const fq = funnelId ? `&funnelId=${funnelId}` : '';
  const data = useLoad(() => api<Details>('GET', `/api/v1/dashboard/kpis/details?from=${from}&to=${to}&metric=${metric}${fq}`), [metric, from, to, fq]);
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
    <Dialog open title={`Conferir: ${METRIC_NAME[metric]}`} description={`${d?.funnel ? `Funil ${d.funnel.name}. ` : ''}${METRIC_HELP[metric]}`} onClose={onClose} width={760}>
      <div className="flex flex-col gap-3">
        {err ? <Alert tone="error">{err}</Alert> : null}
        {d && d.manual.length ? (
          <div className="rounded-[8px] border border-line p-3 text-[13px]">
            <p className="mb-1.5 font-medium">Lançadas pelos vendedores: {d.manual.reduce((s, m) => s + m.count, 0).toLocaleString('pt-BR')}</p>
            <ul aria-label="Prospecção lançada" className="flex flex-col gap-0.5 text-muted">
              {d.manual.map((m) => <li key={`${m.membershipId}-${m.day}`}>{fmtDay(m.day)} · {m.name}: <span className="tabular-nums text-ink">{m.count}</span></li>)}
            </ul>
          </div>
        ) : null}
        {data.error ? <LoadError error={data.error} retry={data.reload} /> : !d ? <Loading /> : !d.items.length ? (
          <p className="text-[13px] text-muted">{d.manual.length ? 'Nenhuma pessoa registrada no CRM no período.' : 'Nada contado no período.'}</p>
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
              {metric === 'leads' ? ' Quem não é lead deste funil também pode perder a etiqueta no próprio contato.' : ''}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

export type KpiFunnel = { id: string; name: string; tagIds: string[]; receivesAdSpend: boolean; manualProspecting: boolean; position: number };

/** Criar ou editar um funil: nome, etiquetas, se recebe o investimento e se o vendedor lança a prospecção. */
export function FunnelDialog({ funnel, onClose, onSaved }: { funnel: KpiFunnel | null; onClose: () => void; onSaved: (f: KpiFunnel | null) => void }) {
  const tags = useTags();
  const [name, setName] = useState(funnel?.name ?? '');
  const [sel, setSel] = useState<string[]>(funnel?.tagIds ?? []);
  const [spend, setSpend] = useState(funnel?.receivesAdSpend ?? false);
  const [manual, setManual] = useState(funnel?.manualProspecting ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [del, setDel] = useState(false);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = { name, tagIds: sel, receivesAdSpend: spend, manualProspecting: manual };
      onSaved(await api<KpiFunnel>(funnel ? 'PATCH' : 'POST', funnel ? `/api/v1/dashboard/kpis/funnels/${funnel.id}` : '/api/v1/dashboard/kpis/funnels', body));
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api('DELETE', `/api/v1/dashboard/kpis/funnels/${funnel!.id}`);
      onSaved(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível apagar.'));
      setBusy(false);
    }
  }
  const tagErr = err?.fieldError('tagIds');
  return (
    <Dialog open title={funnel ? `Editar funil: ${funnel.name}` : 'Novo funil'} onClose={onClose} width={560}
      description="Cada funil tem o próprio painel. Um contato é do funil quando tem uma das etiquetas dele; as reuniões e vendas dessa pessoa entram só nesse painel.">
      <div className="flex flex-col gap-4">
        {err && !err.fieldError('name') && !tagErr ? <Alert tone="error">{err.title}</Alert> : null}
        <Field label="Nome do funil" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ex.: Tráfego pago, Prospecção ativa" error={err?.fieldError('name')} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Etiquetas que colocam o contato neste funil</legend>
          {!tags.data ? <Loading /> : !tags.data.length ? (
            <p className="text-[13px] text-muted">Ainda não há etiquetas. Crie uma (ex.: "Lead anúncio") num contato e volte aqui.</p>
          ) : tags.data.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sel.includes(t.id)} className="size-4 accent-[var(--primary)]"
                onChange={(e) => setSel((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
              <span className="inline-block size-2.5 rounded-full" style={{ background: t.color }} aria-hidden />
              {t.name}
            </label>
          ))}
          {tagErr ? <p className="text-[12px] text-bad">{tagErr}</p> : null}
          <p className="text-[12px] text-muted">Dica: uma automação pode colocar a etiqueta sozinha (ex.: em quem chega pelo formulário do anúncio).</p>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={spend} onChange={(e) => setSpend(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span><strong>Recebe o investimento em anúncios</strong><br /><span className="text-[12px] text-muted">O gasto da Meta Ads e os lançamentos entram só neste funil (só um funil recebe).</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span><strong>Prospecção lançada pelo vendedor</strong><br /><span className="text-[12px] text-muted">Cada vendedor informa no Início quantos prospectou no dia; soma com o que o CRM registra.</span></span>
        </label>
        <div className="flex flex-wrap justify-between gap-2">
          {funnel ? (del ? (
            <span className="flex items-center gap-2 text-[13px]">Apagar o funil e as prospecções lançadas nele?
              <Button type="button" variant="danger" loading={busy} onClick={() => void remove()}>Apagar</Button>
              <Button type="button" variant="ghost" onClick={() => setDel(false)}>Não</Button>
            </span>
          ) : <Button type="button" variant="ghost" onClick={() => setDel(true)}>Apagar funil</Button>) : <span />}
          <span className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="button" loading={busy && !del} disabled={!name.trim() || !sel.length} onClick={() => void save()}>{funnel ? 'Salvar' : 'Criar funil'}</Button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
