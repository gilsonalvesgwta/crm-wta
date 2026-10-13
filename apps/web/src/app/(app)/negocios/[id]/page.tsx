'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { fmtDateTime, fmtIsoDate, money, moneyInput, parseMoney, type Deal, type Stage } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useFields, usePipelines, useProducts } from '@/components/crm/data';
import { DealDialog } from '@/components/crm/deal-form';
import { useMoveDeal } from '@/components/crm/move-deal';
import { CustomFieldValues } from '@/components/crm/custom-fields';
import { ActivitiesPanel, FilesPanel, NotesPanel, TimelinePanel } from '@/components/crm/record-panels';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';
import { Detail, PageHeader, TagChip } from '@/components/ui/misc';

function duration(seconds: number | null): string {
  if (seconds == null) return '';
  const d = Math.floor(seconds / 86400);
  if (d >= 1) return `${d} ${d === 1 ? 'dia' : 'dias'}`;
  const h = Math.floor(seconds / 3600);
  return h >= 1 ? `${h} h` : 'menos de 1 h';
}

export default function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const router = useRouter();
  const deal = useLoad(() => api<Deal>('GET', `/api/v1/deals/${id}`), [id]);
  const { data: pipelines } = usePipelines();
  const { data: defs } = useFields('deal');
  const { move, dialog, error, clearError } = useMoveDeal();
  const [editing, setEditing] = useState(false);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  if (deal.error) return <div className="mx-auto max-w-6xl"><LoadError error={deal.error} retry={deal.reload} /></div>;
  const d = deal.data;
  if (!d) return <div className="mx-auto max-w-6xl"><Loading /></div>;
  const pipeline = pipelines?.find((p) => p.id === d.pipeline.id);
  const stages = pipeline?.stages ?? [];
  const open = stages.filter((s) => s.kind === 'open');
  const won = stages.find((s) => s.kind === 'won');
  const lost = stages.find((s) => s.kind === 'lost');
  const canEdit = can('deals:edit');
  const currentIdx = open.findIndex((s) => s.id === d.stage.id);

  async function go(to: Stage) {
    clearError();
    const r = await move(d!.id, d!.title, to);
    if (r) { deal.setData(r); setTick((t) => t + 1); }
  }
  async function remove() {
    setBusy(true);
    await api('DELETE', `/api/v1/deals/${id}`).catch(() => undefined);
    router.replace('/negocios');
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader back={{ href: `/negocios?funil=${d.pipeline.id}`, label: d.pipeline.name }}
        title={<span className="flex flex-wrap items-center gap-3">{d.title}
          {d.status === 'won' ? <Badge tone="ok">Ganho</Badge> : d.status === 'lost' ? <Badge tone="bad">Perdido</Badge> : null}
          {d.rotting ? <Badge tone="warn">Parado</Badge> : null}</span>}
        subtitle={<span className="text-lg font-semibold text-ink tabular-nums">{money(d.valueCents, d.currency)}</span>}
        actions={<>
          {canEdit ? <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden />Editar</Button> : null}
          {canEdit && d.status === 'open' && won ? <Button onClick={() => go(won)}><Check size={16} aria-hidden />Ganho</Button> : null}
          {canEdit && d.status === 'open' && lost ? <Button variant="danger" onClick={() => go(lost)}><X size={16} aria-hidden />Perdido</Button> : null}
          {canEdit && d.status !== 'open' && open[0] ? <Button variant="secondary" onClick={() => go(open[open.length - 1]!)}><RotateCcw size={16} aria-hidden />Reabrir</Button> : null}
          {can('deals:delete') ? <Button variant="ghost" onClick={() => setDel(true)} aria-label="Excluir negócio"><Trash2 size={16} aria-hidden /></Button> : null}
        </>} />
      {error ? <Alert tone="error">{error}</Alert> : null}

      <nav aria-label="Etapas do funil" className="overflow-x-auto">
        <ol className="flex min-w-max gap-1">
          {open.map((s, i) => {
            const current = s.id === d.stage.id;
            const passed = d.status !== 'open' || (currentIdx >= 0 && i < currentIdx);
            const blocked = !!(stages.find((x) => x.id === d.stage.id)?.allowedTargets.length) && !stages.find((x) => x.id === d.stage.id)!.allowedTargets.includes(s.id) && !current;
            return (
              <li key={s.id}>
                <button type="button" disabled={!canEdit || current || blocked} onClick={() => go(s)} aria-current={current ? 'step' : undefined}
                  title={blocked ? 'O funil não permite esta mudança' : `${s.probability}% de chance`}
                  className={`flex h-10 min-w-[120px] items-center justify-center rounded-[6px] px-3 text-[13px] font-medium transition-colors disabled:cursor-default ${
                    current ? 'bg-primary text-primary-fg' : passed ? 'bg-accent-soft text-ink' : 'border border-line bg-surface text-muted enabled:hover:border-line-strong enabled:hover:text-ink'}`}>
                  {s.name}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {d.status !== 'open' ? (
        <Alert tone={d.status === 'won' ? 'success' : 'info'}>
          {d.status === 'won' ? 'Ganho' : 'Perdido'} em {d.closedAt ? fmtDateTime.format(new Date(d.closedAt)) : ''}
          {d.outcomeReason ? ` · Motivo: ${d.outcomeReason.name}` : ''}{d.outcomeNote ? ` · ${d.outcomeNote}` : ''}
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Dados">
            <dl>
              <Detail label="Contato">{d.contact ? <Link href={`/contatos/${d.contact.id}`} className="text-accent hover:underline">{d.contact.name}</Link> : null}</Detail>
              <Detail label="Organização">{d.organization ? <Link href={`/organizacoes/${d.organization.id}`} className="text-accent hover:underline">{d.organization.name}</Link> : null}</Detail>
              <Detail label="Responsável">{d.owner?.name}</Detail>
              <Detail label="Participantes">{d.participants.map((p) => p.name).join(', ')}</Detail>
              <Detail label="Previsão">{fmtIsoDate(d.expectedCloseDate)}</Detail>
              <Detail label="Probabilidade">{`${d.stage.probability}%`}</Detail>
              <Detail label="Na etapa desde">{fmtDateTime.format(new Date(d.stageEnteredAt))}</Detail>
              <Detail label="Etiquetas">{d.tags.length ? <div className="flex flex-wrap gap-1">{d.tags.map((t) => <TagChip key={t.id} tag={t} />)}</div> : null}</Detail>
              {d.leadId ? <Detail label="Origem"><Link href={`/leads/${d.leadId}`} className="text-accent hover:underline">Lead qualificado</Link></Detail> : null}
            </dl>
            {defs?.length ? <div className="mt-2 border-t border-line pt-2"><CustomFieldValues defs={defs} value={d.custom} /></div> : null}
          </Panel>
          <Panel title="Caminho no funil">
            <ol className="flex flex-col gap-2.5">
              {d.history.map((h, i) => (
                <li key={i} className="text-sm">
                  <p>{h.from ? <>{h.from.name} → <span className="font-medium">{h.to.name}</span></> : <>Criado em <span className="font-medium">{h.to.name}</span></>}</p>
                  <p className="text-[12px] text-muted">{fmtDateTime.format(new Date(h.movedAt))}{h.movedBy ? ` · ${h.movedBy}` : ''}{h.secondsInPrevious != null ? ` · ${duration(h.secondsInPrevious)} na anterior` : ''}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="flex flex-col gap-5">
          <ItemsPanel deal={d} canEdit={canEdit} onSaved={(x) => { deal.setData(x); setTick((t) => t + 1); }} />
          <ActivitiesPanel filter={`dealId=${id}`} links={{ deal: { id: d.id, name: d.title }, contact: d.contact, organization: d.organization }}
            canEdit={can('tasks:manage')} onChange={() => { void deal.reload(); setTick((t) => t + 1); }} />
          <NotesPanel kind="deal" id={id} canEdit={canEdit} />
          <FilesPanel kind="deal" id={id} canEdit={canEdit} onChange={() => setTick((t) => t + 1)} />
          <TimelinePanel kind="deal" id={id} refreshKey={tick} />
        </div>
      </div>
      <DealDialog open={editing} deal={d} onClose={() => setEditing(false)} onSaved={(x) => { setEditing(false); deal.setData(x); setTick((t) => t + 1); }} />
      <Confirm open={del} title="Excluir o negócio?" confirmLabel="Excluir" loading={busy} onConfirm={remove} onCancel={() => setDel(false)}>
        Notas, atividades, arquivos e o histórico deste negócio são apagados. A exclusão fica na auditoria.
      </Confirm>
      {dialog}
    </div>
  );
}

type ItemRow = { productId: string | null; name: string; quantity: string; price: string; discount: string };

function ItemsPanel({ deal, canEdit, onSaved }: { deal: Deal; canEdit: boolean; onSaved: (d: Deal) => void }) {
  const { data: products } = useProducts();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const start = () => {
    setRows(deal.items.map((i) => ({ productId: i.productId, name: i.name, quantity: String(i.quantity).replace('.', ','), price: moneyInput(i.unitPriceCents), discount: i.discountCents ? moneyInput(i.discountCents) : '' })));
    setEditing(true);
    setErr(null);
  };
  const line = (r: ItemRow) => Math.round(Number(r.quantity.replace(',', '.') || 0) * (parseMoney(r.price) ?? 0)) - (parseMoney(r.discount) ?? 0);
  const total = rows.reduce((s, r) => s + line(r), 0);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const d = await api<Deal>('PUT', `/api/v1/deals/${deal.id}/items`, {
        items: rows.map((r) => ({
          productId: r.productId, name: r.name || undefined, quantity: Number(r.quantity.replace(',', '.')) || 1,
          unitPriceCents: parseMoney(r.price) ?? 0, discountCents: parseMoney(r.discount) ?? 0,
        })),
      });
      onSaved(d);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Produtos" actions={canEdit && !editing ? <Button variant="secondary" onClick={start}>{deal.items.length ? 'Editar' : 'Adicionar produtos'}</Button> : undefined}>
      {!editing ? (deal.items.length ? (
        <table className="w-full text-sm">
          <thead><tr className="text-[12px] text-muted"><th scope="col" className="pb-2 text-left font-medium">Item</th><th scope="col" className="pb-2 text-right font-medium">Qtd.</th><th scope="col" className="pb-2 text-right font-medium">Unitário</th><th scope="col" className="pb-2 text-right font-medium">Total</th></tr></thead>
          <tbody>
            {deal.items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-2">{i.name}{i.discountCents ? <p className="text-[12px] text-muted">desconto {money(i.discountCents, deal.currency)}</p> : null}</td>
                <td className="py-2 text-right tabular-nums">{i.quantity.toLocaleString('pt-BR')}</td>
                <td className="py-2 text-right tabular-nums">{money(i.unitPriceCents, deal.currency)}</td>
                <td className="py-2 text-right font-medium tabular-nums">{money(Math.round(i.quantity * i.unitPriceCents) - i.discountCents, deal.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line-strong"><td colSpan={3} className="pt-2 text-right font-medium">Total</td><td className="pt-2 text-right font-semibold tabular-nums">{money(deal.valueCents, deal.currency)}</td></tr></tfoot>
        </table>
      ) : <p className="text-[13px] text-muted">Sem produtos. O valor do negócio é informado à mão.</p>) : (
        <div className="flex flex-col gap-3">
          {err ? <Alert tone="error">{err.errors[0]?.message ?? err.title}</Alert> : null}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-[8px] border border-line p-2 sm:grid-cols-[minmax(0,1fr)_80px_110px_100px_40px]">
              <select aria-label={`Produto ${i + 1}`} value={r.productId ?? ''} className="col-span-2 h-10 rounded-[6px] border border-line-strong bg-surface px-2 text-sm sm:col-span-1"
                onChange={(e) => {
                  const p = products?.find((x) => x.id === e.target.value);
                  setRows(rows.map((x, j) => (j === i ? { ...x, productId: p?.id ?? null, name: p?.name ?? x.name, price: p ? moneyInput(p.priceCents) : x.price } : x)));
                }}>
                <option value="">{r.name && !r.productId ? r.name : 'Item avulso'}</option>
                {(products ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input aria-label={`Quantidade ${i + 1}`} inputMode="decimal" value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2 text-right text-sm" />
              <input aria-label={`Preço unitário ${i + 1}`} inputMode="decimal" value={r.price} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2 text-right text-sm" />
              <input aria-label={`Desconto ${i + 1}`} inputMode="decimal" placeholder="Desconto" value={r.discount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, discount: e.target.value } : x)))} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2 text-right text-sm placeholder:text-muted" />
              <button type="button" aria-label={`Remover item ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="flex size-10 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={16} aria-hidden /></button>
              {!r.productId ? <input aria-label={`Nome do item ${i + 1}`} placeholder="Nome do item" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="col-span-2 h-10 rounded-[6px] border border-line-strong bg-surface px-2 text-sm placeholder:text-muted sm:col-span-5" /> : null}
            </div>
          ))}
          <button type="button" onClick={() => setRows([...rows, { productId: null, name: '', quantity: '1', price: '', discount: '' }])} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-accent hover:underline"><Plus size={14} aria-hidden />Adicionar item</button>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <span className="text-sm">Total: <span className="font-semibold tabular-nums">{money(total, deal.currency)}</span></span>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button><Button loading={busy} onClick={save}>Salvar produtos</Button></div>
          </div>
        </div>
      )}
    </Panel>
  );
}
