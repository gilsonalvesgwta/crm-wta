'use client';
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useQueryState } from '@/lib/use-query-state';
import { dateTime } from '@/lib/admin-types';
import { FLOW_BASE, TRIGGER_TITLE, nodeTitle, type Flow, type FlowChannel, type FlowItem } from '@/lib/instagram';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Empty, LoadError, Loading } from '@/components/ui/states';

type ResultsData = {
  flow: { id: string; name: string; triggerType: FlowItem['triggerType']; status: string };
  totals: { triggered: number; people: number; completed: number; failed: number; waiting: number };
  nodes: { nodeId: string; sent: number; failed: number; answered: number; clicked: number; skipped: number }[];
  buttons: { nodeId: string; button: string; clicks: number }[];
  errors: { nodeId: string | null; error: string; n: number }[];
  daily: { day: string; triggered: number }[];
  runs: { id: string; status: string; nodeId: string | null; waitKind: string | null; startedAt: string; finishedAt: string | null; lastError: string | null; text: string | null; contact: { id: string; name: string } | null }[];
};

const RUN_STATUS: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' }> = {
  running: { label: 'Rodando', tone: 'info' }, waiting: { label: 'Esperando', tone: 'warn' }, done: { label: 'Concluiu', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'bad' }, canceled: { label: 'Encerrado', tone: 'neutral' },
};
const PERIODS = [{ v: '7', l: 'Últimos 7 dias' }, { v: '30', l: 'Últimos 30 dias' }, { v: '90', l: 'Últimos 90 dias' }, { v: '1', l: 'Hoje' }];

/** Resultados dos fluxos (Instagram ou WhatsApp): disparos, blocos, cliques, falhas e as últimas pessoas. */
export function FlowResults({ channel, header }: { channel: FlowChannel; header: ReactNode }) {
  const { can } = useSession();
  const base = FLOW_BASE[channel];
  const flows = useLoad(() => api<FlowItem[]>('GET', `${base.api}/flows`));
  const [q, setQ] = useQueryState({ fluxo: '' });
  const flowParam = q.fluxo;
  const setFlow = (v: string) => setQ({ fluxo: v });
  const [period, setPeriod] = useState('7');
  const flowId = flowParam || flows.data?.[0]?.id || '';
  const range = useMemo(() => {
    const to = new Date(Date.now() + 60_000);
    const from = new Date();
    if (period === '1') from.setHours(0, 0, 0, 0); else from.setTime(Date.now() - Number(period) * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [period]);
  const res = useLoad(() => flowId ? api<ResultsData>('GET', `${base.api}/flows/${flowId}/results?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`) : Promise.resolve(null), [flowId, range]);
  const flow = useLoad(() => flowId ? api<Flow>('GET', `${base.api}/flows/${flowId}`) : Promise.resolve(null), [flowId]);
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  const nodeName = (id: string | null) => {
    const n = flow.data?.draft.nodes.find((x) => x.id === id) ?? flow.data?.published?.nodes.find((x) => x.id === id);
    return n ? nodeTitle(n.type, channel) : 'Bloco removido';
  };
  const r = res.data;
  const maxDay = Math.max(1, ...(r?.daily.map((d) => d.triggered) ?? [1]));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      {header}
      {flows.error ? <LoadError error={flows.error} retry={flows.reload} /> : flows.loading && !flows.data ? <Loading /> : !flows.data!.length ? (
        <Empty title="Nenhum fluxo ainda">Crie um fluxo na aba Fluxos para ver os resultados aqui.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Select className="min-w-[260px] flex-1 sm:flex-none" label="Fluxo" value={flowId} onChange={(e) => setFlow(e.target.value)}>
              {flows.data!.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Select label="Período" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </Select>
          </div>
          {res.error ? <LoadError error={res.error} retry={res.reload} /> : !r ? <Loading /> : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  { l: 'Disparos', v: r.totals.triggered }, { l: 'Pessoas', v: r.totals.people }, { l: 'Concluíram', v: r.totals.completed },
                  { l: 'Esperando agora', v: r.totals.waiting }, { l: 'Falhas', v: r.totals.failed },
                ].map((k) => (
                  <div key={k.l} className="rounded-[10px] border border-line bg-surface px-4 py-3">
                    <p className="text-[13px] text-muted">{k.l}</p>
                    <p className="text-2xl font-semibold tracking-[-0.02em]">{k.v.toLocaleString('pt-BR')}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="Disparos por dia" description={`${TRIGGER_TITLE[r.flow.triggerType]}`}>
                  {!r.daily.length ? <p className="text-[13px] text-muted">Nenhum disparo no período.</p> : (
                    <ul className="flex flex-col gap-1.5" aria-label="Disparos por dia">
                      {r.daily.map((d) => (
                        <li key={d.day} className="grid grid-cols-[80px_minmax(0,1fr)_40px] items-center gap-2 text-[13px]">
                          <span className="text-muted">{d.day.split('-').reverse().slice(0, 2).join('/')}</span>
                          <span className="h-3 rounded-full bg-surface-2"><span className="block h-3 rounded-full bg-primary" style={{ width: `${(d.triggered / maxDay) * 100}%` }} /></span>
                          <span className="text-right font-medium">{d.triggered}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title="Por bloco" description="Mensagens enviadas, cliques e respostas.">
                  {!r.nodes.length ? <p className="text-[13px] text-muted">Sem atividade no período.</p> : (
                    <table className="w-full text-left text-[13px]">
                      <thead><tr className="border-b border-line text-muted"><th className="py-1.5 font-medium">Bloco</th><th className="py-1.5 text-right font-medium">Enviadas</th><th className="py-1.5 text-right font-medium">Cliques</th><th className="py-1.5 text-right font-medium">Respostas</th><th className="py-1.5 text-right font-medium">Falhas</th></tr></thead>
                      <tbody>
                        {r.nodes.map((n) => (
                          <tr key={n.nodeId} className="border-b border-line last:border-0">
                            <td className="py-1.5">{nodeName(n.nodeId)}</td><td className="py-1.5 text-right">{n.sent}</td><td className="py-1.5 text-right">{n.clicked}</td>
                            <td className="py-1.5 text-right">{n.answered}</td><td className={`py-1.5 text-right ${n.failed ? 'text-bad' : ''}`}>{n.failed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {r.buttons.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.buttons.map((b) => <span key={`${b.nodeId}${b.button}`} className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium">“{b.button}”: {b.clicks} clique(s)</span>)}
                    </div>
                  ) : null}
                </Panel>
              </div>
              {r.errors.length ? (
                <Panel title="Falhas mais comuns">
                  <ul className="flex flex-col gap-2 text-[13px]">
                    {r.errors.map((e, i) => <li key={i}><span className="font-medium">{nodeName(e.nodeId)}</span> — {e.error} <span className="text-muted">({e.n}×)</span></li>)}
                  </ul>
                </Panel>
              ) : null}
              <Panel title="Últimas pessoas no fluxo">
                {!r.runs.length ? <p className="text-[13px] text-muted">Ninguém passou pelo fluxo ainda.</p> : (
                  <div className="-mx-5 overflow-x-auto px-5" tabIndex={0} role="region" aria-label="Últimas pessoas">
                    <table className="w-full min-w-[640px] text-left text-[13px]">
                      <thead><tr className="border-b border-line text-muted"><th className="py-2 pr-3 font-medium">Pessoa</th><th className="py-2 pr-3 font-medium">Disse</th><th className="py-2 pr-3 font-medium">Estado</th><th className="py-2 pr-3 font-medium">Onde</th><th className="py-2 font-medium">Quando</th></tr></thead>
                      <tbody>
                        {r.runs.map((x) => (
                          <tr key={x.id} className="border-b border-line last:border-0">
                            <td className="py-2 pr-3">{x.contact ? <Link href={`/contatos/${x.contact.id}`} className="font-medium hover:underline">{x.contact.name}</Link> : '—'}</td>
                            <td className="max-w-[200px] truncate py-2 pr-3 text-muted">{x.text ?? '—'}</td>
                            <td className="py-2 pr-3"><Badge tone={RUN_STATUS[x.status]?.tone ?? 'neutral'}>{RUN_STATUS[x.status]?.label ?? x.status}</Badge>
                              {x.lastError && x.status === 'failed' ? <p className="mt-1 max-w-[260px] text-xs text-bad">{x.lastError}</p> : null}</td>
                            <td className="py-2 pr-3 text-muted">{x.nodeId ? nodeName(x.nodeId) : '—'}{x.waitKind === 'click' ? ' (clique)' : x.waitKind === 'reply' ? ' (resposta)' : x.waitKind === 'delay' ? ' (esperando)' : ''}</td>
                            <td className="whitespace-nowrap py-2 text-muted">{dateTime.format(new Date(x.startedAt))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
