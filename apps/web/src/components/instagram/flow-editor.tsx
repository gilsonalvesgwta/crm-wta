'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, ChevronLeft, Copy, Eye, MoreHorizontal, Pause, Play, Redo2, Rocket, Send, Trash2, TriangleAlert, Undo2, Check, CloudOff } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { COMMENT_TRIGGERS, FLOW_BASE, FLOW_STATUS, newId, newNode, nodeTitle, outputsOf, type Flow, type FlowChannel, type FlowGraph, type FlowNode, type NodeType } from '@/lib/instagram';
import { FlowCanvas, NODE_W } from './flow-canvas';
import { NodeSettings, Palette } from './node-settings';
import { Simulator } from './simulator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Alert } from '@/components/ui/alert';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

/** Editor de fluxo (Instagram ou WhatsApp oficial): tela com os blocos, painel do bloco, prévia e publicação. */
export function FlowEditor({ initial, readOnly, channel = 'instagram' }: { initial: Flow; readOnly: boolean; channel?: FlowChannel }) {
  const router = useRouter();
  const base = FLOW_BASE[channel];
  const [meta, setMeta] = useState(initial);
  const [graph, setGraph] = useState<FlowGraph>(initial.draft);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('saved');
  const [name, setName] = useState(initial.name);
  const [preview, setPreview] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const past = useRef<FlowGraph[]>([]);
  const future = useRef<FlowGraph[]>([]);
  const last = useRef<{ key?: string; at: number }>({ at: 0 });
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const [, force] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  const persist = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const g = graphRef.current;
    setSave('saving');
    const p = api<Flow>('PATCH', `${base.api}/flows/${initial.id}`, { draft: g }).then((f) => {
      setMeta((m) => ({ ...m, issues: f.issues, unpublishedChanges: f.unpublishedChanges, status: f.status, triggerType: f.triggerType }));
      setSave(graphRef.current === g ? 'saved' : 'dirty');
    }).catch(() => setSave('error'));
    saving.current = p;
    await p;
  }, [initial.id]);

  const schedule = useCallback(() => {
    setSave('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), 700);
  }, [persist]);

  // Avisa antes de sair com alteração sem salvar.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (save === 'dirty' || save === 'saving') e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [save]);

  const change = useCallback((next: FlowGraph, mergeKey?: string) => {
    if (readOnly) return;
    const now = Date.now();
    if (!(mergeKey && last.current.key === mergeKey && now - last.current.at < 1500)) {
      past.current = [...past.current.slice(-99), graphRef.current];
      future.current = [];
    }
    last.current = { key: mergeKey, at: now };
    graphRef.current = next;
    setGraph(next);
    schedule();
  }, [readOnly, schedule]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(graphRef.current);
    last.current = { at: 0 };
    graphRef.current = prev;
    setGraph(prev);
    schedule();
    force((n) => n + 1);
  }, [schedule]);
  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push(graphRef.current);
    last.current = { at: 0 };
    graphRef.current = nxt;
    setGraph(nxt);
    schedule();
    force((n) => n + 1);
  }, [schedule]);

  const removeNode = useCallback((nodeId: string) => {
    const g = graphRef.current;
    if (g.nodes.find((n) => n.id === nodeId)?.type === 'trigger') return;
    change({ nodes: g.nodes.filter((n) => n.id !== nodeId), edges: g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId) });
    setSelected(null);
  }, [change]);
  const removeEdge = useCallback((edgeId: string) => {
    const g = graphRef.current;
    change({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) });
    setSelectedEdge(null);
  }, [change]);

  // Atalhos: desfazer, refazer e apagar o que está escolhido.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable], dialog')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
        if (selectedEdge) removeEdge(selectedEdge);
        else if (selected) removeNode(selected);
      } else if (e.key === 'Escape') { setSelected(null); setSelectedEdge(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo, redo, removeEdge, removeNode, selected, selectedEdge, readOnly]);

  const node = selected ? graph.nodes.find((n) => n.id === selected) ?? null : null;
  const trigger = graph.nodes.find((n) => n.type === 'trigger') as Extract<FlowNode, { type: 'trigger' }>;
  const commentFlow = COMMENT_TRIGGERS.includes(trigger.data.type);
  const broadcast = trigger.data.type === 'wa_broadcast';
  const errors = meta.issues.filter((i) => i.level === 'error');

  function add(type: Exclude<NodeType, 'trigger'>) {
    const g = graphRef.current;
    const from = node;
    const pos = from ? { x: from.position.x + NODE_W + 110, y: from.position.y + 40 * g.edges.filter((e) => e.source === from.id).length }
      : { x: Math.max(0, ...g.nodes.map((n) => n.position.x)) + NODE_W + 110, y: 0 };
    const n = newNode(type, pos);
    const edges = [...g.edges];
    if (from) {
      const free = outputsOf(from).find((o) => !g.edges.some((e) => e.source === from.id && e.sourceHandle === o.handle));
      if (free) edges.push({ id: newId('e'), source: from.id, sourceHandle: free.handle, target: n.id });
    }
    change({ nodes: [...g.nodes, n], edges });
    setSelected(n.id);
  }

  function duplicateNode(nodeId: string) {
    const g = graphRef.current;
    const src = g.nodes.find((n) => n.id === nodeId);
    if (!src || src.type === 'trigger') return;
    const copy = JSON.parse(JSON.stringify(src)) as FlowNode;
    copy.id = newId();
    copy.position = { x: src.position.x + 40, y: src.position.y + 180 };
    if ((copy.type === 'text' || copy.type === 'private_reply')) copy.data.buttons = copy.data.buttons.map((b) => ({ ...b, id: newId('b') }));
    change({ ...g, nodes: [...g.nodes, copy] });
    setSelected(copy.id);
  }

  async function saveName() {
    const v = name.trim();
    if (!v || v === meta.name) { setName(meta.name); return; }
    try {
      const f = await api<Flow>('PATCH', `${base.api}/flows/${initial.id}`, { name: v });
      setMeta((m) => ({ ...m, name: f.name }));
    } catch (e) {
      setName(meta.name);
      setNotice({ tone: 'error', text: e instanceof ApiError ? e.errors[0]?.message ?? e.title : 'Não foi possível renomear.' });
    }
  }

  async function publish() {
    setBusy('publish');
    setNotice(null);
    try {
      if (timer.current || save !== 'saved') await persist();
      else if (saving.current) await saving.current;
      const f = await api<Flow>('POST', `${base.api}/flows/${initial.id}/publish`);
      setMeta((m) => ({ ...m, ...f, draft: m.draft }));
      setNotice({ tone: 'success', text: channel === 'whatsapp' ? (graphRef.current.nodes.some((n) => n.type === 'trigger' && n.data.type === 'wa_broadcast') ? 'Fluxo publicado: já pode ser usado numa transmissão.' : 'Fluxo publicado: já está funcionando no WhatsApp.') : 'Fluxo publicado: já está funcionando no Instagram.' });
    } catch (e) {
      const err = e as ApiError;
      setNotice({ tone: 'error', text: err.type === 'flow-errors' ? 'Corrija os erros marcados nos blocos antes de publicar.' : err.title });
      if (err.type === 'flow-errors') setIssuesOpen(true);
    } finally {
      setBusy(null);
    }
  }

  async function act(kind: 'pause' | 'resume' | 'duplicate' | 'delete') {
    setMenu(false);
    setBusy(kind);
    try {
      if (kind === 'delete') {
        await api('DELETE', `${base.api}/flows/${initial.id}`);
        router.push(base.path);
        return;
      }
      if (kind === 'duplicate') {
        const f = await api<Flow>('POST', `${base.api}/flows/${initial.id}/duplicate`);
        router.push(`${base.path}/fluxos/${f.id}`);
        return;
      }
      const f = await api<Flow>('POST', `${base.api}/flows/${initial.id}/${kind}`);
      setMeta((m) => ({ ...m, status: f.status }));
      setNotice({ tone: 'success', text: kind === 'pause' ? 'Fluxo pausado. Quem estava no meio foi encerrado.' : 'Fluxo ativo de novo.' });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof ApiError ? e.title : 'Não foi possível concluir.' });
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  const st = FLOW_STATUS[meta.status];
  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-65px)] min-h-[560px] flex-col sm:-mx-6">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <Link href={base.path} aria-label="Voltar aos fluxos" className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><ChevronLeft size={18} aria-hidden /></Link>
        <input aria-label="Nome do fluxo" value={name} maxLength={80} disabled={readOnly} onChange={(e) => setName(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="h-9 min-w-0 max-w-[280px] flex-1 rounded-[6px] border border-transparent bg-transparent px-2 text-[15px] font-semibold hover:border-line focus:border-line-strong" />
        <Badge tone={st.tone}>{st.label}</Badge>
        {meta.unpublishedChanges ? <span className="hidden text-xs text-warn md:inline">Alterações não publicadas</span> : null}
        <div className="flex-1" />
        <span className="flex items-center gap-1 text-xs text-muted" role="status">
          {save === 'saved' ? <><Check size={13} aria-hidden />Salvo</> : save === 'error' ? <span className="flex items-center gap-1 text-bad"><CloudOff size={13} aria-hidden />Não salvou <button type="button" className="underline" onClick={() => void persist()}>tentar de novo</button></span> : 'Salvando…'}
        </span>
        <div className="relative">
          <button type="button" onClick={() => setIssuesOpen(!issuesOpen)} aria-expanded={issuesOpen}
            className={`flex h-9 items-center gap-1.5 rounded-[6px] border px-2.5 text-[13px] font-medium ${errors.length ? 'border-bad/40 bg-bad-soft text-bad' : meta.issues.length ? 'border-warn/40 bg-warn-soft text-warn' : 'border-line text-ok'}`}>
            {meta.issues.length ? <TriangleAlert size={14} aria-hidden /> : <Check size={14} aria-hidden />}
            {meta.issues.length ? `${meta.issues.length} aviso${meta.issues.length > 1 ? 's' : ''}` : 'Tudo certo'}
          </button>
          {issuesOpen && meta.issues.length ? (
            <div className="absolute right-0 top-11 z-30 w-[340px] rounded-[10px] border border-line bg-surface p-2 shadow-lg">
              <ul className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
                {meta.issues.map((i, k) => (
                  <li key={k}>
                    <button type="button" onClick={() => { if (i.nodeId) setSelected(i.nodeId); setIssuesOpen(false); }}
                      className="flex w-full gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-surface-2">
                      <TriangleAlert size={14} aria-hidden className={`mt-0.5 shrink-0 ${i.level === 'error' ? 'text-bad' : 'text-warn'}`} />
                      <span><span className="font-medium">{i.nodeId ? nodeTitle(graph.nodes.find((n) => n.id === i.nodeId)?.type ?? 'text', channel) : 'Fluxo'}:</span> {i.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {!readOnly ? (
          <div className="flex">
            <button type="button" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!past.current.length} onClick={undo} className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"><Undo2 size={16} aria-hidden /></button>
            <button type="button" aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo} className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"><Redo2 size={16} aria-hidden /></button>
          </div>
        ) : null}
        <Button variant="secondary" onClick={() => setPreview(true)}><Eye size={15} aria-hidden />Visualizar</Button>
        {broadcast && meta.status === 'active' && !meta.unpublishedChanges ? <Link href={`/campanhas/nova?fluxo=${initial.id}`} className="hidden h-9 items-center gap-1.5 rounded-[6px] border border-line px-3 text-[13px] font-medium hover:bg-surface-2 sm:inline-flex"><Send size={15} aria-hidden />Enviar transmissão</Link> : null}
        {!readOnly ? <Button loading={busy === 'publish'} onClick={publish}><Rocket size={15} aria-hidden />{meta.status === 'draft' ? 'Publicar' : meta.unpublishedChanges ? 'Publicar alterações' : 'Publicado'}</Button> : null}
        <div className="relative">
          <button type="button" aria-label="Mais opções" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><MoreHorizontal size={18} aria-hidden /></button>
          {menu ? (
            <div role="menu" className="absolute right-0 top-11 z-30 w-56 rounded-[10px] border border-line bg-surface p-1.5 shadow-lg">
              <Link role="menuitem" href={`${base.path}/resultados?fluxo=${initial.id}`} className="flex h-9 items-center gap-2 rounded-[6px] px-2.5 text-[13px] hover:bg-surface-2"><BarChart3 size={15} aria-hidden />Resultados</Link>
              {broadcast && meta.status === 'active' ? <Link role="menuitem" href={`/campanhas/nova?fluxo=${initial.id}`} className="flex h-9 items-center gap-2 rounded-[6px] px-2.5 text-[13px] hover:bg-surface-2"><Send size={15} aria-hidden />Enviar transmissão</Link> : null}
              {!readOnly && meta.status === 'active' ? <button role="menuitem" type="button" onClick={() => act('pause')} className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-[13px] hover:bg-surface-2"><Pause size={15} aria-hidden />Pausar</button> : null}
              {!readOnly && meta.status === 'paused' ? <button role="menuitem" type="button" onClick={() => act('resume')} className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-[13px] hover:bg-surface-2"><Play size={15} aria-hidden />Reativar</button> : null}
              {!readOnly ? <button role="menuitem" type="button" onClick={() => act('duplicate')} className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-[13px] hover:bg-surface-2"><Copy size={15} aria-hidden />Duplicar fluxo</button> : null}
              {!readOnly ? <button role="menuitem" type="button" onClick={() => { setMenu(false); setConfirmDelete(true); }} className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-[13px] text-bad hover:bg-bad-soft"><Trash2 size={15} aria-hidden />Excluir fluxo</button> : null}
            </div>
          ) : null}
        </div>
      </header>
      {notice ? <div className="border-b border-line bg-surface px-4 py-2"><Alert tone={notice.tone}>{notice.text} <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>Ok</button></Alert></div> : null}
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <aside className="max-h-[45vh] w-full shrink-0 overflow-y-auto border-t border-line bg-surface p-4 md:max-h-none md:w-[360px] md:border-r md:border-t-0">
          {node ? (
            <div className="flex flex-col gap-5">
              <NodeSettings key={node.id} node={node} channel={channel} issues={meta.issues.filter((i) => i.nodeId === node.id)} accountId={meta.accountId} readOnly={readOnly}
                onChange={(data, key) => change({ ...graphRef.current, nodes: graphRef.current.nodes.map((n) => (n.id === node.id ? { ...n, data } : n)) as FlowNode[] }, key)}
                onDelete={() => removeNode(node.id)} onDuplicate={() => duplicateNode(node.id)} onClose={() => setSelected(null)} />
              {!readOnly ? <Palette channel={channel} commentFlow={commentFlow} from={node.id} onAdd={add} /> : null}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <h2 className="text-[15px] font-semibold">Como funciona</h2>
                <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-[13px] text-muted">
                  <li>Toque no bloco <strong className="text-ink">Quando…</strong> para escolher o que dispara.</li>
                  <li>Toque num bloco para editar e adicionar o próximo passo.</li>
                  <li>Arraste da bolinha à direita de um bloco até outro para ligar.</li>
                  <li>Use <strong className="text-ink">Visualizar</strong> para testar e <strong className="text-ink">Publicar</strong> para ligar.</li>
                </ol>
              </div>
              {!readOnly ? <Palette channel={channel} commentFlow={commentFlow} from={null} onAdd={add} /> : null}
            </div>
          )}
        </aside>
        <div className="min-h-[50vh] min-w-0 flex-1 md:min-h-0">
          <FlowCanvas channel={channel} graph={graph} selected={selected} selectedEdge={selectedEdge} issues={meta.issues} readOnly={readOnly}
            onChange={change} onSelect={setSelected} onSelectEdge={setSelectedEdge} onDeleteEdge={removeEdge} />
        </div>
      </div>
      <Simulator channel={channel} open={preview} graph={graph} onClose={() => setPreview(false)} />
      <Confirm open={confirmDelete} title="Excluir este fluxo?" confirmLabel="Excluir" loading={busy === 'delete'} onConfirm={() => act('delete')} onCancel={() => setConfirmDelete(false)}>
        O fluxo para de funcionar e some da lista. As mensagens já mandadas continuam nas conversas.
      </Confirm>
    </div>
  );
}
