'use client';
import { Suspense, useEffect, useMemo, useState, type PointerEventHandler, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { AlarmClock, CalendarClock, Download, GripVertical, Kanban, List, Plus, Settings2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useDebounced, useQueryState } from '@/lib/use-query-state';
import { fmtDateShort, fmtIsoDate, money, type Board, type DealCard, type Page, type Stage } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useDirectory, usePipelines } from '@/components/crm/data';
import { DealDialog } from '@/components/crm/deal-form';
import { useMoveDeal } from '@/components/crm/move-deal';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Empty, LoadError, Loading } from '@/components/ui/states';
import { PageHeader, Pagination, SearchBox, TagChip } from '@/components/ui/misc';

export default function DealsPage() {
  return <Suspense><Deals /></Suspense>;
}

function Deals() {
  const { can } = useSession();
  const router = useRouter();
  const { data: pipelines } = usePipelines();
  const { data: dir } = useDirectory();
  const [f, setF] = useQueryState({ funil: '', visao: 'quadro', ownerId: '', q: '', status: 'open', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== f.q) setF({ q: dq, page: '1' }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = (pipelines ?? []).filter((p) => !p.archived);
  const pipelineId = f.funil && active.some((p) => p.id === f.funil) ? f.funil : active[0]?.id ?? '';
  const [creating, setCreating] = useState(false);

  if (pipelines && active.length === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <PageHeader title="Negócios" />
        <Empty title="Nenhum funil ainda" action={can('pipelines:admin') ? <Link href="/configuracoes/funis" className="inline-flex h-10 items-center rounded-[6px] bg-primary px-4 font-semibold text-primary-fg">Criar funil</Link> : undefined}>
          {can('pipelines:admin') ? 'Crie o primeiro funil para organizar as vendas em etapas.' : 'Peça a quem administra o CRM para criar um funil.'}
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Negócios"
        actions={<>
          {can('deals:export') ? <a href={`/api/v1/deals/export.csv?pipelineId=${pipelineId}&status=all`} className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2"><Download size={16} aria-hidden />Exportar</a> : null}
          {can('pipelines:admin') ? <Link href="/configuracoes/funis" className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2"><Settings2 size={16} aria-hidden />Funis</Link> : null}
          {can('deals:edit') ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Novo negócio</Button> : null}
        </>} />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Funil" value={pipelineId} onChange={(e) => setF({ funil: e.target.value, page: '1' })}
          className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm font-medium">
          {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <SearchBox className="w-full sm:w-64" value={q} onChange={setQ} label="Buscar negócios" placeholder="Buscar pelo título" />
        <select aria-label="Responsável" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">Todos os responsáveis</option>
          {dir?.me ? <option value={dir.me}>Meus negócios</option> : null}
          {(dir?.members ?? []).filter((m) => m.id !== dir?.me).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {f.visao === 'lista' ? (
          <select aria-label="Situação" value={f.status} onChange={(e) => setF({ status: e.target.value, page: '1' })} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm">
            <option value="open">Em andamento</option><option value="won">Ganhos</option><option value="lost">Perdidos</option><option value="all">Todos</option>
          </select>
        ) : null}
        <div role="group" aria-label="Visão" className="ml-auto flex rounded-[6px] border border-line bg-surface p-0.5">
          <button type="button" aria-pressed={f.visao !== 'lista'} onClick={() => setF({ visao: 'quadro' })}
            className={`flex h-9 items-center gap-1.5 rounded-[5px] px-3 text-sm font-medium ${f.visao !== 'lista' ? 'bg-surface-2 text-ink' : 'text-muted'}`}><Kanban size={16} aria-hidden />Quadro</button>
          <button type="button" aria-pressed={f.visao === 'lista'} onClick={() => setF({ visao: 'lista' })}
            className={`flex h-9 items-center gap-1.5 rounded-[5px] px-3 text-sm font-medium ${f.visao === 'lista' ? 'bg-surface-2 text-ink' : 'text-muted'}`}><List size={16} aria-hidden />Lista</button>
        </div>
      </div>
      {!pipelineId ? <Loading /> : f.visao === 'lista'
        ? <DealList pipelineId={pipelineId} ownerId={f.ownerId} q={f.q} status={f.status} page={Number(f.page)} onPage={(p) => setF({ page: String(p) })} />
        : <BoardView pipelineId={pipelineId} ownerId={f.ownerId} q={f.q} canMove={can('deals:edit')} />}
      <DealDialog open={creating} pipelineId={pipelineId} onClose={() => setCreating(false)} onSaved={(d) => { setCreating(false); router.push(`/negocios/${d.id}`); }} />
    </div>
  );
}

function BoardView({ pipelineId, ownerId, q, canMove }: { pipelineId: string; ownerId: string; q: string; canMove: boolean }) {
  const qs = new URLSearchParams({ pipelineId });
  if (ownerId) qs.set('ownerId', ownerId);
  if (q) qs.set('q', q);
  const board = useLoad(() => api<Board>('GET', `/api/v1/deals/board?${qs}`), [qs.toString()]);
  const [cols, setCols] = useState<Board['stages'] | null>(null);
  useEffect(() => { if (board.data) setCols(board.data.stages); }, [board.data]);
  const [dragging, setDragging] = useState<DealCard | null>(null);
  const { move, dialog, error, clearError } = useMoveDeal();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const stageById = useMemo(() => new Map((cols ?? []).map((s) => [s.id, s])), [cols]);

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Negócio ${String(active.data.current?.title ?? '')} selecionado. Use as setas para escolher a etapa e espaço para soltar.`,
    onDragOver: ({ over }) => (over ? `Sobre a etapa ${stageById.get(String(over.id))?.name ?? ''}.` : 'Fora das etapas.'),
    onDragEnd: ({ over }) => (over ? `Solto em ${stageById.get(String(over.id))?.name ?? ''}.` : 'Movimento cancelado.'),
    onDragCancel: () => 'Movimento cancelado.',
  };

  if (board.error) return <LoadError error={board.error} retry={board.reload} />;
  if (!cols) return <Loading />;
  const open = cols.filter((s) => s.kind === 'open');
  const closed = cols.filter((s) => s.kind !== 'open');

  function onStart(e: DragStartEvent) {
    clearError();
    setDragging((e.active.data.current?.deal as DealCard) ?? null);
  }
  async function onEnd(e: DragEndEvent) {
    setDragging(null);
    const deal = e.active.data.current?.deal as DealCard | undefined;
    const to = e.over ? stageById.get(String(e.over.id)) : undefined;
    if (!deal || !to || to.id === deal.stageId) return;
    const before = cols!;
    // Otimista: o cartão muda de coluna na hora e volta se a API recusar.
    setCols(before.map((s) => {
      if (s.id === deal.stageId) return { ...s, deals: s.deals.filter((d) => d.id !== deal.id), count: s.count - 1, totalCents: s.totalCents - deal.valueCents };
      if (s.id === to.id) return { ...s, deals: [{ ...deal, stageId: to.id }, ...s.deals], count: s.count + 1, totalCents: s.totalCents + deal.valueCents };
      return s;
    }));
    const r = await move(deal.id, deal.title, to as Stage);
    if (!r) setCols(before);
    else void board.reload();
  }

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)} accessibility={{ announcements, screenReaderInstructions: { draggable: 'Para mover um negócio, pressione espaço, use as setas e pressione espaço de novo para soltar.' } }}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-3" aria-busy={board.loading}>
          {open.map((s) => <Column key={s.id} stage={s} canMove={canMove} />)}
        </div>
      </div>
      {canMove ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {closed.map((s) => <OutcomeZone key={s.id} stage={s} active={!!dragging} />)}
        </div>
      ) : null}
      <DragOverlay>{dragging ? <Card deal={dragging} overlay /> : null}</DragOverlay>
      {dialog}
    </DndContext>
  );
}

function Column({ stage, canMove }: { stage: Board['stages'][number]; canMove: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section ref={setNodeRef} aria-label={`Etapa ${stage.name}`}
      className={`flex w-[292px] shrink-0 flex-col rounded-[10px] border bg-surface-2 ${isOver ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}>
      <header className="flex flex-col gap-0.5 border-b border-line px-3 py-2.5" style={{ boxShadow: `inset 0 3px 0 ${stage.color}` }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
          <span className="text-[12px] text-muted">{stage.count}</span>
        </div>
        <p className="text-[12px] text-muted"><span className="font-medium text-ink tabular-nums">{money(stage.totalCents, 'BRL', true)}</span>{stage.probability ? ` · ${stage.probability}%` : ''}</p>
      </header>
      <ol className="flex min-h-[120px] flex-col gap-2 p-2">
        {stage.deals.map((d) => <li key={d.id}>{canMove ? <DraggableCard deal={d} /> : <Card deal={d} />}</li>)}
        {stage.count > stage.deals.length ? <li className="px-2 py-1 text-[12px] text-muted">+{stage.count - stage.deals.length} na visão em lista</li> : null}
      </ol>
    </section>
  );
}

/**
 * O cartão inteiro se arrasta com o mouse; pelo teclado, a alça (botão com o
 * ícone de pontos) pega o cartão. Assim o link do título continua um link.
 */
function DraggableCard({ deal }: { deal: DealCard }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: deal.id, data: { deal, title: deal.title } });
  return (
    <div ref={setNodeRef} onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLDivElement> | undefined} className={`cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}>
      <Card deal={deal} handle={
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-roledescription="negócio arrastável"
          aria-label={`Mover ${deal.title}`} className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink">
          <GripVertical size={14} aria-hidden />
        </button>
      } />
    </div>
  );
}

function Card({ deal, overlay = false, handle }: { deal: DealCard; overlay?: boolean; handle?: ReactNode }) {
  return (
    <article className={`flex flex-col gap-1.5 rounded-[8px] border bg-surface p-3 text-sm ${overlay ? 'rotate-1 border-primary shadow-xl' : 'border-line shadow-[0_1px_0_rgba(5,22,40,0.04)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/negocios/${deal.id}`} className="font-medium leading-snug hover:underline" onPointerDown={(e) => e.stopPropagation()}>{deal.title}</Link>
        {handle}
      </div>
      {deal.organization || deal.contact ? <p className="truncate text-[12px] text-muted">{deal.organization?.name ?? deal.contact?.name}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{money(deal.valueCents, deal.currency)}</span>
        <span className="truncate text-[12px] text-muted">{deal.owner?.name.split(' ')[0]}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {deal.status === 'won' ? <Badge tone="ok">Ganho</Badge> : deal.status === 'lost' ? <Badge tone="bad">Perdido</Badge> : null}
        {deal.rotting ? <span className="inline-flex items-center gap-1 font-medium text-warn"><AlarmClock size={12} aria-hidden />Parado</span> : null}
        {deal.nextActivityAt ? (
          <span className={`inline-flex items-center gap-1 ${new Date(deal.nextActivityAt) < new Date() ? 'font-medium text-bad' : 'text-muted'}`}>
            <CalendarClock size={12} aria-hidden />{fmtDateShort.format(new Date(deal.nextActivityAt))}
          </span>
        ) : deal.status === 'open' ? <span className="text-muted">Sem próxima atividade</span> : null}
        {deal.tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} />)}
      </div>
    </article>
  );
}

function OutcomeZone({ stage, active }: { stage: Board['stages'][number]; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const won = stage.kind === 'won';
  return (
    <div ref={setNodeRef} aria-label={`Soltar para marcar como ${won ? 'ganho' : 'perdido'}`}
      className={`flex h-16 items-center justify-between rounded-[10px] border-2 border-dashed px-4 text-sm transition-colors ${
        isOver ? (won ? 'border-ok bg-ok-soft' : 'border-bad bg-bad-soft') : active ? 'border-line-strong bg-surface' : 'border-line bg-transparent'}`}>
      <span className={`font-semibold ${won ? 'text-ok' : 'text-bad'}`}>{won ? 'Ganho' : 'Perdido'}</span>
      <span className="text-[12px] text-muted">{stage.count} nos últimos 30 dias · {money(stage.totalCents, 'BRL', true)}</span>
    </div>
  );
}

function DealList({ pipelineId, ownerId, q, status, page, onPage }: { pipelineId: string; ownerId: string; q: string; status: string; page: number; onPage: (p: number) => void }) {
  const qs = new URLSearchParams({ pipelineId, status, page: String(page), pageSize: '25' });
  if (ownerId) qs.set('ownerId', ownerId);
  if (q) qs.set('q', q);
  const list = useLoad(() => api<Page<DealCard> & { totalValueCents: number }>('GET', `/api/v1/deals?${qs}`), [qs.toString()]);
  if (list.error) return <LoadError error={list.error} retry={list.reload} />;
  if (!list.data) return <Loading />;
  if (!list.data.items.length) return <Empty title="Nenhum negócio com estes filtros" />;
  return (
    <section aria-label="Lista de negócios" className="rounded-[10px] border border-line bg-surface">
      <p className="border-b border-line px-4 py-2.5 text-[13px] text-muted">{list.data.total} negócios · <span className="font-medium text-ink">{money(list.data.totalValueCents)}</span></p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[12px] text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">Negócio</th><th scope="col" className="px-3 py-2.5 font-medium">Etapa</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Valor</th><th scope="col" className="px-3 py-2.5 font-medium">Responsável</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Previsão</th><th scope="col" className="px-4 py-2.5 font-medium">Próxima atividade</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link href={`/negocios/${d.id}`} className="font-medium hover:underline">{d.title}</Link><p className="text-[13px] text-muted">{d.organization?.name ?? d.contact?.name ?? ''}</p></td>
                <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: d.stage?.color }} />{d.stage?.name}</span>{d.rotting ? <p className="text-[12px] font-medium text-warn">Parado</p> : null}</td>
                <td className="px-3 py-3 text-right font-medium tabular-nums">{money(d.valueCents, d.currency)}</td>
                <td className="px-3 py-3">{d.owner?.name ?? '—'}</td>
                <td className="px-3 py-3 text-[13px]">{fmtIsoDate(d.expectedCloseDate) || '—'}</td>
                <td className="px-4 py-3 text-[13px]">{d.nextActivityAt ? fmtDateShort.format(new Date(d.nextActivityAt)) : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-3"><Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={onPage} /></div>
    </section>
  );
}
