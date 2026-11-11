'use client';
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Send } from 'lucide-react';
import { useTags } from '@/components/crm/data';
import {
  COMMENT_TRIGGERS, UNIT_LABEL, checkAnswer, keywordMatches, renderText,
  type FlowChannel, type FlowGraph, type FlowNode, type NodeData,
} from '@/lib/instagram';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type Msg =
  | { from: 'them' | 'me'; text: string; buttons?: { id: string; title: string; url?: string | null }[]; public?: boolean }
  | { from: 'note'; text: string };
type Wait = { kind: 'click' | 'reply' | 'cond'; nodeId: string } | null;

const START_LABEL: Record<string, string> = {
  comment: 'Comentário da pessoa', live_comment: 'Comentário na live', dm_keyword: 'Mensagem no direct',
  story_reply: 'Resposta ao story', story_mention: 'Menção em story', reaction: 'Reação a mensagem',
  wa_broadcast: 'Envio da transmissão', wa_keyword: 'Mensagem no WhatsApp',
};

/** Prévia do fluxo: roda o desenho na tela, sem mandar nada ao Instagram. */
export function Simulator({ open, graph, onClose, channel = 'instagram' }: { open: boolean; graph: FlowGraph; onClose: () => void; channel?: FlowChannel }) {
  const tags = useTags().data ?? [];
  const trig = graph.nodes.find((n) => n.type === 'trigger') as Extract<FlowNode, { type: 'trigger' }>;
  const t = trig.data;
  const needsText = !['story_mention', 'reaction', 'wa_broadcast'].includes(t.type);
  const [input, setInput] = useState(t.match === 'any' ? 'Oi!' : t.keywords[0] ?? '');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [wait, setWait] = useState<Wait>(null);
  const [started, setStarted] = useState(false);
  const vars = useRef<Record<string, string>>({});
  const tries = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  useEffect(() => { if (open) reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  function reset() {
    setMsgs([]); setWait(null); setStarted(false); tries.current = 0;
    setInput(t.match === 'any' ? 'Oi!' : t.keywords[0] ?? '');
  }

  const tagName = (id: string) => tags.find((x) => x.id === id)?.name ?? 'etiqueta';
  const next = (nodeId: string, handle = 'next') => {
    const e = graph.edges.find((x) => x.source === nodeId && x.sourceHandle === handle);
    return e ? graph.nodes.find((n) => n.id === e.target) ?? null : null;
  };

  /** Roda a partir de um bloco até precisar da pessoa (ou acabar). */
  function run(start: FlowNode | null, out: Msg[]): Msg[] {
    let node = start;
    for (let i = 0; node && i < 40; i++) {
      const r = (s: string) => renderText(s, vars.current);
      switch (node.type) {
        case 'comment_reply': {
          const v = node.data.variants.filter((x) => x.trim());
          out.push({ from: 'me', public: true, text: r(v[Math.floor(Math.random() * v.length)] ?? '') });
          node = next(node.id);
          break;
        }
        case 'private_reply':
        case 'text': {
          out.push({ from: 'me', text: r(node.data.text), buttons: node.data.buttons.filter((b) => b.title.trim()) });
          const flowBtns = node.data.buttons.filter((b) => !b.url && b.title.trim());
          if (flowBtns.length) { setWait({ kind: 'click', nodeId: node.id }); return out; }
          if (node.type === 'private_reply') node = null;
          else node = next(node.id);
          break;
        }
        case 'template': {
          out.push({ from: 'me', text: node.data.templateId ? `📄 Modelo ${node.data.name}${node.data.params.length ? `\n${node.data.params.map((p, k) => `{{${k + 1}}} = ${r(p)}`).join('\n')}` : ''}` : '📄 (modelo não escolhido)', buttons: node.data.buttons });
          if (node.data.buttons.length) { setWait({ kind: 'click', nodeId: node.id }); return out; }
          node = next(node.id);
          break;
        }
        case 'media':
          out.push({ from: 'me', text: node.data.fileId ? `📎 ${node.data.name}` : '📎 (arquivo não escolhido)' });
          node = next(node.id);
          break;
        case 'wait':
          out.push({ from: 'note', text: `⏱ Espera ${node.data.amount} ${UNIT_LABEL[node.data.unit]}` });
          node = next(node.id);
          break;
        case 'question':
          out.push({ from: 'me', text: r(node.data.text) });
          tries.current = 0;
          setWait({ kind: 'reply', nodeId: node.id });
          return out;
        case 'condition':
          out.push({ from: 'note', text: 'Condição: escolha o caminho para testar.' });
          setWait({ kind: 'cond', nodeId: node.id });
          return out;
        case 'action':
          for (const o of node.data.ops) {
            out.push({
              from: 'note', text: o.kind === 'add_tag' ? `✓ Etiqueta “${tagName(o.tagId)}” adicionada` : o.kind === 'remove_tag' ? `✓ Etiqueta “${tagName(o.tagId)}” removida`
                : o.kind === 'set_field' ? `✓ Campo ${o.key || '…'} = ${r(o.value)}` : o.kind === 'create_lead' ? `✓ Lead criado: ${r(o.title)}`
                  : o.kind === 'create_deal' ? `✓ Negócio criado: ${r(o.title)}` : o.kind === 'notify' ? '✓ Aviso para a equipe' : '✓ Conversa passada para alguém',
            });
          }
          node = next(node.id);
          break;
        default:
          node = null;
      }
    }
    setWait(null);
    out.push({ from: 'note', text: 'Fim do fluxo.' });
    return out;
  }

  function simulate() {
    const text = needsText ? input.trim() : t.type === 'reaction' ? '❤️' : t.type === 'wa_broadcast' ? '' : '(marcou você no story)';
    vars.current = { nome: 'Maria', primeiro_nome: 'Maria', nome_completo: 'Maria Silva', usuario: '@maria.silva', comentario: text, telefone: '+55 11 99999-0000', mensagem: text };
    const out: Msg[] = t.type === 'wa_broadcast' ? [{ from: 'note', text: 'Transmissão enviada para Maria.' }] : [{ from: 'them', text, public: COMMENT_TRIGGERS.includes(t.type) }];
    setStarted(true);
    if (KEY_TRIGGERS.includes(t.type) && !keywordMatches(t, text)) {
      out.push({ from: 'note', text: 'Não dispara: o texto não tem as palavras-chave do gatilho.' });
      setMsgs(out); setWait(null);
      return;
    }
    setMsgs(run(next(trig.id), out));
    setInput('');
  }

  function click(btn: { id: string; title: string; url?: string | null }) {
    if (!wait || wait.kind !== 'click') return;
    if (btn.url) { setMsgs((m) => [...m, { from: 'note', text: `Abre o link ${btn.url}` }]); return; }
    setMsgs((m) => run(next(wait.nodeId, `btn:${btn.id}`), [...m, { from: 'them', text: btn.title }]));
  }

  function reply(text: string) {
    if (!wait || wait.kind !== 'reply') return;
    const node = graph.nodes.find((n) => n.id === wait.nodeId) as Extract<FlowNode, { type: 'question' }>;
    const d: NodeData['question'] = node.data;
    const value = checkAnswer(d.validate, text);
    const out: Msg[] = [...msgs, { from: 'them', text }];
    if (value === null && tries.current < 2) {
      tries.current++;
      out.push({ from: 'me', text: d.retryText });
      setMsgs(out); setInput('');
      return;
    }
    if (value !== null) vars.current[d.key || (d.saveTo === 'phone' ? 'telefone' : d.saveTo)] = value;
    setMsgs(run(next(node.id), out));
    setInput('');
  }

  const choose = (yes: boolean) => wait && setMsgs((m) => run(next(wait.nodeId, yes ? 'yes' : 'no'), [...m, { from: 'note', text: yes ? 'Caminho “Sim”' : 'Caminho “Não”' }]));
  const timeout = () => wait && setMsgs((m) => run(next(wait.nodeId, 'timeout'), [...m, { from: 'note', text: 'A pessoa não respondeu no prazo.' }]));

  return (
    <Dialog open={open} onClose={onClose} title="Visualizar o fluxo" description={channel === 'whatsapp' ? 'Nada é enviado ao WhatsApp.' : 'Nada é enviado ao Instagram.'} width={460}
      footer={<><Button variant="ghost" onClick={reset}><RotateCcw size={15} aria-hidden />Recomeçar</Button><Button variant="secondary" onClick={onClose}>Fechar</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="flex h-[420px] flex-col gap-2 overflow-y-auto rounded-[16px] border border-line bg-surface-2 p-3" aria-live="polite">
          {!started ? <p className="m-auto max-w-[260px] text-center text-[13px] text-muted">Escreva como a pessoa e toque em Simular para ver o que ela receberia.</p> : null}
          {msgs.map((m, i) => m.from === 'note' ? (
            <p key={i} className="mx-auto rounded-full bg-surface px-3 py-1 text-center text-xs text-muted">{m.text}</p>
          ) : (
            <div key={i} className={`flex max-w-[85%] flex-col gap-1 ${m.from === 'me' ? 'self-end items-end' : 'self-start items-start'}`}>
              {m.public ? <span className="text-[11px] text-muted">{m.from === 'me' ? 'Resposta no comentário' : 'Comentou'}</span> : null}
              <p className={`whitespace-pre-wrap break-words rounded-[16px] px-3 py-2 text-[13px] ${m.from === 'me' ? 'bg-primary text-primary-fg' : 'bg-surface text-ink border border-line'}`}>{m.text || '…'}</p>
              {m.buttons?.length ? (
                <div className="flex w-full flex-col gap-1">
                  {m.buttons.map((b) => (
                    <button key={b.id} type="button" onClick={() => click(b)} disabled={!(wait?.kind === 'click' && i === msgs.length - 1) && !b.url}
                      className="h-8 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium text-info disabled:opacity-60">{b.title}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {wait?.kind === 'cond' ? (
            <div className="flex justify-center gap-2"><Button variant="secondary" onClick={() => choose(true)}>Sim</Button><Button variant="secondary" onClick={() => choose(false)}>Não</Button></div>
          ) : null}
          {wait?.kind === 'reply' ? <button type="button" onClick={timeout} className="mx-auto text-xs text-muted underline">Simular que não respondeu</button> : null}
          <div ref={end} />
        </div>
        {!started || wait?.kind === 'reply' ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!started) simulate(); else if (input.trim()) reply(input); }}>
            {needsText || started ? (
              <input aria-label={started ? 'Resposta da pessoa' : START_LABEL[t.type]} placeholder={started ? 'Resposta da pessoa' : START_LABEL[t.type]} value={input}
                onChange={(e) => setInput(e.target.value)} className="h-10 min-w-0 flex-1 rounded-[6px] border border-line-strong bg-surface px-3 text-sm" />
            ) : <p className="flex flex-1 items-center text-[13px] text-muted">{START_LABEL[t.type]}</p>}
            <Button type="submit" disabled={needsText && !started && !input.trim()}><Send size={15} aria-hidden />{started ? 'Responder' : 'Simular'}</Button>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}

const KEY_TRIGGERS = ['comment', 'live_comment', 'dm_keyword', 'story_reply', 'wa_keyword'];
