'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Clock, ExternalLink, GitBranch, Image as ImageIcon, Maximize, MessageCircle, MessageSquareText, Minus, Plus, Reply, Send, TriangleAlert, X, Zap, CircleHelp } from 'lucide-react';
import { NODE_TITLE, TRIGGER_TITLE, UNIT_LABEL, outputsOf, type FlowEdge, type FlowGraph, type FlowIssue, type FlowNode, type NodeType } from '@/lib/instagram';
import { TriggerIcon } from './trigger-icon';

type Pt = { x: number; y: number };
type View = { x: number; y: number; zoom: number };
type Drag =
  | { kind: 'pan'; start: Pt; view: View; moved: boolean }
  | { kind: 'node'; id: string; start: Pt; pos: Pt; moved: boolean }
  | { kind: 'link'; source: string; handle: string; to: Pt };

export const NODE_W = 272;

const NODE_ICON: Record<Exclude<NodeType, 'trigger'>, { icon: typeof Send; tone: string }> = {
  comment_reply: { icon: MessageCircle, tone: 'bg-[#FDE7F1] text-[#B0185E]' },
  private_reply: { icon: Reply, tone: 'bg-info-soft text-info' },
  text: { icon: Send, tone: 'bg-info-soft text-info' },
  media: { icon: ImageIcon, tone: 'bg-ok-soft text-ok' },
  wait: { icon: Clock, tone: 'bg-surface-2 text-muted' },
  question: { icon: CircleHelp, tone: 'bg-[#EFE7FD] text-[#6B2BD9]' },
  condition: { icon: GitBranch, tone: 'bg-warn-soft text-warn' },
  action: { icon: Zap, tone: 'bg-accent-soft text-accent' },
};

export function NodeIcon({ type, size = 28 }: { type: NodeType; size?: number }) {
  if (type === 'trigger') return <MessageSquareText size={size * 0.55} aria-hidden />;
  const { icon: I, tone } = NODE_ICON[type];
  return (
    <span aria-hidden style={{ width: size, height: size }} className={`inline-flex shrink-0 items-center justify-center rounded-[7px] ${tone}`}>
      <I size={Math.round(size * 0.55)} strokeWidth={1.9} />
    </span>
  );
}

function pathFor(a: Pt, b: Pt) {
  const dx = Math.max(60, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/**
 * Tela do editor: blocos que se arrastam, setas que ligam a saída de um bloco
 * à entrada de outro, arrastar o fundo para mover e Ctrl+roda (ou os botões)
 * para aproximar.
 */
export function FlowCanvas({ graph, selected, selectedEdge, issues, readOnly, onChange, onSelect, onSelectEdge, onDeleteEdge }: {
  graph: FlowGraph; selected: string | null; selectedEdge: string | null; issues: FlowIssue[]; readOnly?: boolean;
  onChange: (g: FlowGraph, mergeKey?: string) => void; onSelect: (id: string | null) => void; onSelectEdge: (id: string | null) => void;
  onDeleteEdge: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [anchors, setAnchors] = useState<Record<string, Pt>>({});
  const fitted = useRef(false);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const toWorld = useCallback((clientX: number, clientY: number, v = view): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, [view]);

  // Enquadra os blocos na primeira vez.
  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !graphRef.current.nodes.length) return;
    const xs = graphRef.current.nodes.map((n) => n.position.x);
    const ys = graphRef.current.nodes.map((n) => n.position.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W, minY = Math.min(...ys), maxY = Math.max(...ys) + 260;
    const w = el.clientWidth, h = el.clientHeight;
    const zoom = Math.max(0.4, Math.min(1, (w - 80) / (maxX - minX), (h - 80) / (maxY - minY)));
    setView({ zoom, x: (w - (maxX - minX) * zoom) / 2 - minX * zoom, y: Math.max(24, (h - (maxY - minY) * zoom) / 2) - minY * zoom });
  }, []);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [fit]);

  // Bloco escolhido fora da tela (por exemplo, um passo recém-adicionado): leva a tela até ele.
  useEffect(() => {
    const el = box.current;
    const n = selected ? graphRef.current.nodes.find((x) => x.id === selected) : null;
    if (!el || !n) return;
    setView((v) => {
      const left = v.x + n.position.x * v.zoom, top = v.y + n.position.y * v.zoom;
      const w = NODE_W * v.zoom, h = 180 * v.zoom;
      if (left >= 16 && top >= 16 && left + w <= el.clientWidth - 16 && top + h <= el.clientHeight - 16) return v;
      return { ...v, x: el.clientWidth / 2 - (n.position.x + NODE_W / 2) * v.zoom, y: el.clientHeight / 2 - (n.position.y + 90) * v.zoom };
    });
  }, [selected]);

  // Onde ficam as entradas e saídas de cada bloco (medido na tela, em coordenadas do desenho).
  useLayoutEffect(() => {
    const root = inner.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const next: Record<string, Pt> = {};
    root.querySelectorAll<HTMLElement>('[data-anchor]').forEach((el) => {
      const r = el.getBoundingClientRect();
      next[el.dataset.anchor!] = { x: (r.left + r.width / 2 - base.left) / view.zoom, y: (r.top + r.height / 2 - base.top) / view.zoom };
    });
    setAnchors((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  });

  function down(e: RPointerEvent, d: Drag) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(d);
  }

  function move(e: RPointerEvent) {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.start.x, dy = e.clientY - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) setDrag({ ...drag, moved: true });
      setView({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy });
    } else if (drag.kind === 'node') {
      const dx = (e.clientX - drag.start.x) / view.zoom, dy = (e.clientY - drag.start.y) / view.zoom;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      const g = graphRef.current;
      onChange({ ...g, nodes: g.nodes.map((n) => (n.id === drag.id ? { ...n, position: { x: Math.round(drag.pos.x + dx), y: Math.round(drag.pos.y + dy) } } : n)) as FlowNode[] }, `move:${drag.id}`);
    } else {
      setDrag({ ...drag, to: toWorld(e.clientX, e.clientY) });
    }
  }

  function up(e: RPointerEvent) {
    if (!drag) return;
    if (drag.kind === 'pan' && !drag.moved) { onSelect(null); onSelectEdge(null); }
    if (drag.kind === 'link') {
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-node-id]');
      const target = hit?.dataset.nodeId;
      const g = graphRef.current;
      if (target && target !== drag.source && g.nodes.find((n) => n.id === target)?.type !== 'trigger') {
        const edges = g.edges.filter((x) => !(x.source === drag.source && x.sourceHandle === drag.handle));
        edges.push({ id: `e${Math.random().toString(36).slice(2, 9)}`, source: drag.source, sourceHandle: drag.handle, target });
        onChange({ ...g, edges });
      }
    }
    setDrag(null);
  }

  function wheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX, e.clientY, factor);
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const r = box.current!.getBoundingClientRect();
    setView((v) => {
      const zoom = Math.min(1.6, Math.max(0.3, v.zoom * factor));
      const px = clientX - r.left, py = clientY - r.top;
      return { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom };
    });
  }
  const zoomCenter = (f: number) => {
    const r = box.current!.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };

  const byNode = new Map<string, FlowIssue[]>();
  for (const i of issues) if (i.nodeId) byNode.set(i.nodeId, [...(byNode.get(i.nodeId) ?? []), i]);
  const edgeEnds = (ed: FlowEdge) => {
    const a = anchors[`out:${ed.source}:${ed.sourceHandle}`];
    const b = anchors[`in:${ed.target}`];
    return a && b ? { a, b } : null;
  };
  const sel = selectedEdge ? graph.edges.find((x) => x.id === selectedEdge) : null;
  const selEnds = sel ? edgeEnds(sel) : null;

  return (
    <div ref={box} onPointerDown={(e) => down(e, { kind: 'pan', start: { x: e.clientX, y: e.clientY }, view, moved: false })}
      onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onWheel={wheel}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-surface-2"
      style={{ backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px`, cursor: drag?.kind === 'pan' ? 'grabbing' : 'default' }}>
      <div ref={inner} className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
          {graph.edges.map((ed) => {
            const ends = edgeEnds(ed);
            if (!ends) return null;
            const on = ed.id === selectedEdge;
            return (
              <g key={ed.id}>
                <path d={pathFor(ends.a, ends.b)} fill="none" stroke="transparent" strokeWidth={16} className="pointer-events-auto cursor-pointer"
                  onPointerDown={(e) => { e.stopPropagation(); onSelectEdge(ed.id); onSelect(null); }} />
                <path d={pathFor(ends.a, ends.b)} fill="none" stroke={on ? 'var(--primary)' : 'var(--border-strong)'} strokeWidth={on ? 2.5 : 1.75} />
              </g>
            );
          })}
          {drag?.kind === 'link' && anchors[`out:${drag.source}:${drag.handle}`] ? (
            <path d={pathFor(anchors[`out:${drag.source}:${drag.handle}`]!, drag.to)} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" />
          ) : null}
        </svg>
        {selEnds && !readOnly ? (
          <button type="button" aria-label="Remover esta seta" onPointerDown={(e) => e.stopPropagation()} onClick={() => onDeleteEdge(sel!.id)}
            className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-bad shadow"
            style={{ left: (selEnds.a.x + selEnds.b.x) / 2, top: (selEnds.a.y + selEnds.b.y) / 2 }}>
            <X size={14} aria-hidden />
          </button>
        ) : null}
        {graph.nodes.map((n) => (
          <NodeCard key={n.id} node={n} selected={n.id === selected} issues={byNode.get(n.id) ?? []} readOnly={readOnly}
            connected={(h) => graph.edges.some((x) => x.source === n.id && x.sourceHandle === h)}
            onSelect={() => { onSelect(n.id); onSelectEdge(null); }}
            onDragStart={(e) => { onSelect(n.id); onSelectEdge(null); if (!readOnly) down(e, { kind: 'node', id: n.id, start: { x: e.clientX, y: e.clientY }, pos: n.position, moved: false }); }}
            onLinkStart={(e, handle) => { if (!readOnly) down(e, { kind: 'link', source: n.id, handle, to: toWorld(e.clientX, e.clientY) }); }} />
        ))}
      </div>
      <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-[8px] border border-line bg-surface shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Afastar" onClick={() => zoomCenter(1 / 1.2)} className="flex size-9 items-center justify-center hover:bg-surface-2"><Minus size={16} aria-hidden /></button>
        <span className="flex w-12 items-center justify-center border-x border-line text-xs text-muted">{Math.round(view.zoom * 100)}%</span>
        <button type="button" aria-label="Aproximar" onClick={() => zoomCenter(1.2)} className="flex size-9 items-center justify-center hover:bg-surface-2"><Plus size={16} aria-hidden /></button>
        <button type="button" aria-label="Enquadrar o fluxo" onClick={fit} className="flex size-9 items-center justify-center border-l border-line hover:bg-surface-2"><Maximize size={15} aria-hidden /></button>
      </div>
    </div>
  );
}

function NodeCard({ node, selected, issues, readOnly, connected, onSelect, onDragStart, onLinkStart }: {
  node: FlowNode; selected: boolean; issues: FlowIssue[]; readOnly?: boolean; connected: (h: string) => boolean;
  onSelect: () => void; onDragStart: (e: RPointerEvent) => void; onLinkStart: (e: RPointerEvent, handle: string) => void;
}) {
  const hasError = issues.some((i) => i.level === 'error');
  const outs = outputsOf(node);
  const isTrigger = node.type === 'trigger';
  return (
    <div data-node-id={node.id} role="group" aria-label={NODE_TITLE[node.type]}
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute rounded-[12px] border bg-surface shadow-sm ${selected ? 'border-primary ring-2 ring-primary/30' : hasError ? 'border-bad' : 'border-line'}`}
      style={{ left: node.position.x, top: node.position.y, width: NODE_W }}>
      {!isTrigger ? <span data-anchor={`in:${node.id}`} className="absolute -left-[7px] top-[22px] size-3.5 rounded-full border-2 border-surface bg-border-strong" style={{ background: 'var(--border-strong)' }} /> : null}
      <button type="button" onClick={onSelect} onPointerDown={onDragStart}
        className={`flex w-full items-center gap-2 rounded-t-[12px] px-3 py-2.5 text-left ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'} ${isTrigger ? 'bg-primary/10' : ''}`}>
        {isTrigger ? <TriggerIcon type={node.data.type} size={28} /> : <NodeIcon type={node.type} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{NODE_TITLE[node.type]}</span>
          {isTrigger ? <span className="block truncate text-xs text-muted">{TRIGGER_TITLE[node.data.type]}</span> : null}
        </span>
        {issues.length ? (
          <span title={issues.map((i) => i.message).join('\n')} className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${hasError ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn'}`}>
            <TriangleAlert size={12} aria-hidden />{issues.length}<span className="sr-only"> aviso(s)</span>
          </span>
        ) : null}
      </button>
      <div className="flex flex-col gap-2 px-3 pb-3 text-[13px]">
        <NodeBody node={node} />
      </div>
      {outs.length ? (
        <div className="flex flex-col gap-1 border-t border-line px-3 py-2">
          {outs.map((o) => (
            <div key={o.handle} className="relative flex h-7 items-center justify-end text-xs">
              <span className={o.tone === 'ok' ? 'font-medium text-ok' : o.tone === 'bad' ? 'font-medium text-bad' : 'text-muted'}>
                {o.label ?? (connected(o.handle) ? 'Depois' : 'Próximo passo')}
              </span>
              <span data-anchor={`out:${node.id}:${o.handle}`} role="button" tabIndex={-1} aria-label={`Ligar ${o.label ?? 'próximo passo'}`}
                onPointerDown={(e) => onLinkStart(e, o.handle)}
                className={`absolute -right-[19px] top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-surface ${readOnly ? '' : 'cursor-crosshair'} ${connected(o.handle) ? 'bg-primary' : 'bg-surface ring-2 ring-primary'}`} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Bubble({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <p className={`line-clamp-4 whitespace-pre-wrap break-words rounded-[10px] px-2.5 py-2 ${muted ? 'bg-surface-2 text-muted italic' : 'bg-surface-2'}`}>{children}</p>;
}

function NodeBody({ node }: { node: FlowNode }) {
  switch (node.type) {
    case 'trigger': {
      const d = node.data;
      const where = d.type === 'comment' ? (d.posts === 'any' ? 'Qualquer post ou reels' : `${d.postIds.length} publicação(ões) escolhida(s)`) : null;
      return (
        <>
          {where ? <p className="text-muted">{where}</p> : null}
          {d.match === 'any' ? <p className="text-muted">Qualquer {d.type === 'dm_keyword' ? 'mensagem' : d.type.includes('comment') ? 'comentário' : 'evento'}</p> : (
            <div className="flex flex-wrap gap-1">
              {d.keywords.filter(Boolean).length ? d.keywords.filter(Boolean).slice(0, 6).map((k) => (
                <span key={k} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium">{k}</span>
              )) : <span className="text-bad">Sem palavras-chave</span>}
            </div>
          )}
        </>
      );
    }
    case 'comment_reply': {
      const v = node.data.variants.filter((x) => x.trim());
      return (
        <>
          <p className="text-xs text-muted">{v.length > 1 ? `Sorteia entre ${v.length} respostas` : 'Resposta pública'}</p>
          <Bubble muted={!v.length}>{v[0] || 'Escreva a resposta…'}</Bubble>
        </>
      );
    }
    case 'private_reply':
    case 'text':
      return (
        <>
          <Bubble muted={!node.data.text.trim()}>{node.data.text || 'Escreva a mensagem…'}</Bubble>
          {node.data.buttons.filter((b) => b.url).map((b) => (
            <span key={b.id} className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-line text-xs font-medium">
              {b.title || 'Link'}<ExternalLink size={12} aria-hidden />
            </span>
          ))}
          {node.type === 'private_reply' && node.data.buttons.some((b) => !b.url) ? <p className="text-xs text-muted">Sem o clique, a conversa para aqui.</p> : null}
        </>
      );
    case 'media':
      return node.data.fileId ? <Bubble>📎 {node.data.name}</Bubble> : <Bubble muted>Escolha o arquivo…</Bubble>;
    case 'wait':
      return <p>Espera <strong>{node.data.amount} {UNIT_LABEL[node.data.unit]}</strong></p>;
    case 'question':
      return (
        <>
          <Bubble muted={!node.data.text.trim()}>{node.data.text || 'Escreva a pergunta…'}</Bubble>
          <p className="text-xs text-muted">Guarda em {node.data.saveTo === 'email' ? 'e-mail do contato' : node.data.saveTo === 'phone' ? 'telefone do contato' : `{{${node.data.key}}}`}</p>
        </>
      );
    case 'condition':
      return <p className="text-muted">{node.data.rules.length} regra(s) · {node.data.match === 'all' ? 'todas' : 'qualquer uma'}</p>;
    case 'action':
      return <p className="text-muted">{node.data.ops.length} ação(ões) no CRM</p>;
  }
}
