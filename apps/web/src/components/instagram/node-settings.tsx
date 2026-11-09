'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Link2, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import {
  COMMENT_TRIGGERS, KEYWORD_TRIGGERS, NODE_TITLE, TRIGGER_TITLE, VARIABLES, bytes, mediaKind, newId,
  type FlowButton, type FlowIssue, type FlowNode, type FlowOp, type FlowRule, type IgPost, type MediaItem, type NodeData, type NodeType,
} from '@/lib/instagram';
import { useDirectory, useFields, usePipelines, useTags } from '@/components/crm/data';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { NodeIcon } from './flow-canvas';
import { TriggerIcon } from './trigger-icon';

type Upd<T> = (patch: Partial<T>, mergeKey?: string) => void;

/** Painel lateral com as opções do bloco escolhido. */
export function NodeSettings({ node, issues, accountId, readOnly, onChange, onDelete, onDuplicate, onClose }: {
  node: FlowNode; issues: FlowIssue[]; accountId: string; readOnly?: boolean;
  onChange: (data: FlowNode['data'], mergeKey?: string) => void; onDelete: () => void; onDuplicate: () => void; onClose: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upd = (patch: Record<string, unknown>, key?: string) => onChange({ ...(node.data as any), ...patch }, key ? `${node.id}:${key}` : undefined);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {node.type === 'trigger' ? <TriggerIcon type={node.data.type} size={32} /> : <NodeIcon type={node.type} size={32} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{NODE_TITLE[node.type]}</h2>
          {node.type === 'trigger' ? <p className="truncate text-[13px] text-muted">{TRIGGER_TITLE[node.data.type]}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar opções do bloco" className="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><X size={16} aria-hidden /></button>
      </div>
      {issues.length ? (
        <ul className="flex flex-col gap-1.5">
          {issues.map((i, k) => <li key={k}><Alert tone={i.level === 'error' ? 'error' : 'warning'}>{i.message}</Alert></li>)}
        </ul>
      ) : null}
      <fieldset disabled={readOnly} className="flex flex-col gap-4">
        {node.type === 'trigger' ? <TriggerSettings d={node.data} accountId={accountId} upd={upd as Upd<NodeData['trigger']>} /> : null}
        {node.type === 'comment_reply' ? <CommentReplySettings d={node.data} upd={upd as Upd<NodeData['comment_reply']>} /> : null}
        {node.type === 'private_reply' || node.type === 'text' ? <MessageSettings type={node.type} d={node.data} upd={upd as Upd<NodeData['text']>} /> : null}
        {node.type === 'media' ? <MediaSettings d={node.data} upd={upd as Upd<NodeData['media']>} /> : null}
        {node.type === 'wait' ? <WaitSettings d={node.data} upd={upd as Upd<NodeData['wait']>} /> : null}
        {node.type === 'question' ? <QuestionSettings d={node.data} upd={upd as Upd<NodeData['question']>} /> : null}
        {node.type === 'condition' ? <ConditionSettings d={node.data} upd={upd as Upd<NodeData['condition']>} /> : null}
        {node.type === 'action' ? <ActionSettings d={node.data} upd={upd as Upd<NodeData['action']>} /> : null}
      </fieldset>
      {node.type !== 'trigger' && !readOnly ? (
        <div className="flex gap-2 border-t border-line pt-3">
          <Button variant="secondary" onClick={onDuplicate}><Copy size={15} aria-hidden />Duplicar</Button>
          <Button variant="danger" onClick={onDelete}><Trash2 size={15} aria-hidden />Excluir bloco</Button>
        </div>
      ) : null}
    </div>
  );
}

function Section({ step, total, title, children }: { step?: number; total?: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        {step ? <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Etapa {step} de {total}</p> : null}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Choice({ checked, onSelect, title, desc }: { checked: boolean; onSelect: () => void; title: string; desc?: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect}
      className={`flex items-start gap-2.5 rounded-[8px] border p-2.5 text-left ${checked ? 'border-primary bg-accent-soft' : 'border-line hover:bg-surface-2'}`}>
      <span aria-hidden className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-primary' : 'border-line-strong'}`}>
        {checked ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        {desc ? <span className="block text-xs text-muted">{desc}</span> : null}
      </span>
    </button>
  );
}

/** Caixa de texto com atalhos para inserir {{variáveis}} onde está o cursor. */
export function TextVars({ label, value, onChange, max, rows = 4, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; max: number; rows?: number; placeholder?: string; hint?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(k: string) {
    const el = ref.current;
    const tag = `{{${k}}}`;
    const start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? value.length;
    const next = (value.slice(0, start) + tag + value.slice(end)).slice(0, max);
    onChange(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + tag.length, start + tag.length); });
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
        <span className={`text-xs ${value.length > max * 0.9 ? 'text-warn' : 'text-muted'}`}>{value.length}/{max}</span>
      </div>
      <textarea id={id} ref={ref} rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="rounded-[6px] border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted" />
      <div className="flex flex-wrap gap-1" aria-label="Inserir variável">
        {VARIABLES.map((v) => (
          <button key={v.key} type="button" onClick={() => insert(v.key)} title={v.label}
            className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-ink">{`{{${v.key}}}`}</button>
        ))}
      </div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

// ---- Gatilho -----------------------------------------------------------------------

function TriggerSettings({ d, accountId, upd }: { d: NodeData['trigger']; accountId: string; upd: Upd<NodeData['trigger']> }) {
  const [kw, setKw] = useState('');
  const isComment = COMMENT_TRIGGERS.includes(d.type);
  const usesKeywords = KEYWORD_TRIGGERS.includes(d.type);
  const total = d.type === 'comment' ? 3 : usesKeywords ? 2 : 1;
  const addKw = () => {
    const words = kw.split(',').map((w) => w.trim()).filter(Boolean).filter((w) => !d.keywords.includes(w));
    if (words.length) upd({ keywords: [...d.keywords, ...words].slice(0, 30) });
    setKw('');
  };
  let step = 0;
  return (
    <>
      {d.type === 'comment' ? (
        <Section step={++step} total={total} title="Em quais publicações?">
          <div role="radiogroup" aria-label="Publicações" className="flex flex-col gap-2">
            <Choice checked={d.posts === 'any'} onSelect={() => upd({ posts: 'any' })} title="Qualquer post ou reels" desc="Inclusive os que você publicar depois." />
            <Choice checked={d.posts === 'chosen'} onSelect={() => upd({ posts: 'chosen' })} title="Só nos posts que eu escolher" desc="Até 20 publicações." />
          </div>
          {d.posts === 'chosen' ? <PostPicker accountId={accountId} value={d.postIds} onChange={(postIds) => upd({ postIds })} /> : null}
        </Section>
      ) : null}
      {usesKeywords ? (
        <Section step={++step} total={total} title={isComment ? 'Quando o comentário…' : d.type === 'story_reply' ? 'Quando a resposta…' : 'Quando a mensagem…'}>
          <div role="radiogroup" aria-label="Palavras-chave" className="flex flex-col gap-2">
            <Choice checked={d.match === 'contains'} onSelect={() => upd({ match: 'contains' })} title="Tiver uma destas palavras" desc="Ex.: “eu quero!!” dispara com “quero”." />
            <Choice checked={d.match === 'exact'} onSelect={() => upd({ match: 'exact' })} title="For exatamente uma destas palavras" />
            <Choice checked={d.match === 'any'} onSelect={() => upd({ match: 'any' })} title="Qualquer texto" />
          </div>
          {d.match !== 'any' ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input aria-label="Nova palavra-chave" value={kw} maxLength={60} placeholder="Ex.: eu quero, link, preço"
                  onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } }}
                  className="h-10 min-w-0 flex-1 rounded-[6px] border border-line-strong bg-surface px-3 text-sm" />
                <Button variant="secondary" onClick={addKw} disabled={!kw.trim()}>Adicionar</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.keywords.map((k) => (
                  <span key={k} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pl-2.5 pr-1 text-[13px] font-medium">
                    {k}
                    <button type="button" aria-label={`Remover ${k}`} onClick={() => upd({ keywords: d.keywords.filter((x) => x !== k) })}
                      className="flex size-5 items-center justify-center rounded-full hover:bg-surface"><X size={12} aria-hidden /></button>
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted">Maiúsculas, acentos e pontuação não importam.</p>
            </div>
          ) : null}
        </Section>
      ) : null}
      <Section step={++step} total={total} title="Quantas vezes por pessoa?">
        <Select label="Frequência" value={d.frequency} onChange={(e) => upd({ frequency: e.target.value as NodeData['trigger']['frequency'] })}>
          {d.type === 'comment' || d.type === 'live_comment' ? <option value="once_per_post">Uma vez por pessoa em cada publicação</option> : null}
          <option value="once_per_contact">Só uma vez por pessoa</option>
          <option value="every">Toda vez</option>
        </Select>
      </Section>
      {d.type === 'story_mention' ? <p className="text-xs text-muted">Dispara quando alguém marca a sua conta no story. A conversa no direct já fica aberta.</p> : null}
      {d.type === 'reaction' ? <p className="text-xs text-muted">Dispara quando alguém reage (❤️, 😂…) a uma mensagem que você mandou no direct.</p> : null}
      {isComment ? <Alert tone="info">No comentário, o Instagram só deixa mandar <strong>uma</strong> mensagem no privado (a “Resposta no privado”). A conversa continua quando a pessoa toca no botão.</Alert> : null}
    </>
  );
}

function PostPicker({ accountId, value, onChange }: { accountId: string; value: string[]; onChange: (ids: string[]) => void }) {
  const [posts, setPosts] = useState<IgPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPosts(await api<IgPost[]>('GET', `/api/v1/instagram/posts?accountId=${accountId}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.title : 'Não foi possível buscar as publicações.');
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [accountId]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : value.length >= 20 ? value : [...value, id]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{value.length} de 20 escolhidas</span>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 hover:text-ink"><RefreshCw size={12} aria-hidden />Atualizar</button>
      </div>
      {loading && !posts ? <div className="flex justify-center py-4"><Spinner label="Carregando publicações" /></div> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {posts ? (
        <ul className="grid max-h-[320px] grid-cols-3 gap-1.5 overflow-y-auto">
          {posts.map((p) => {
            const on = value.includes(p.id);
            return (
              <li key={p.id}>
                <button type="button" aria-pressed={on} onClick={() => toggle(p.id)} title={p.caption || p.id}
                  className={`relative block aspect-square w-full overflow-hidden rounded-[6px] border-2 bg-surface-2 ${on ? 'border-primary' : 'border-transparent'}`}>
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                  ) : <span className="flex size-full items-center justify-center p-1 text-[10px] text-muted">{p.caption.slice(0, 40) || 'Sem prévia'}</span>}
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">{p.type === 'reels' ? 'Reels' : 'Post'}</span>
                  {on ? <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-fg"><Check size={12} aria-hidden /></span> : null}
                  <span className="sr-only">{p.caption || p.id}</span>
                </button>
              </li>
            );
          })}
          {value.filter((id) => !posts.some((p) => p.id === id)).map((id) => (
            <li key={id}>
              <button type="button" aria-pressed onClick={() => toggle(id)} className="flex aspect-square w-full items-center justify-center rounded-[6px] border-2 border-primary bg-surface-2 p-1 text-[10px] text-muted">
                Publicação antiga ({id.slice(-5)})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---- Mensagens ---------------------------------------------------------------------

function CommentReplySettings({ d, upd }: { d: NodeData['comment_reply']; upd: Upd<NodeData['comment_reply']> }) {
  const set = (i: number, v: string) => upd({ variants: d.variants.map((x, k) => (k === i ? v : x)) }, `v${i}`);
  return (
    <>
      <p className="text-[13px] text-muted">Resposta pública no comentário. Com mais de uma, o CRM sorteia — fica mais natural e o Instagram não confunde com spam.</p>
      {d.variants.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><TextVars label={`Resposta ${i + 1}`} value={v} max={300} rows={2} onChange={(x) => set(i, x)} /></div>
          {d.variants.length > 1 ? (
            <button type="button" aria-label={`Remover resposta ${i + 1}`} onClick={() => upd({ variants: d.variants.filter((_, k) => k !== i) })}
              className="mt-6 flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={15} aria-hidden /></button>
          ) : null}
        </div>
      ))}
      {d.variants.length < 3 ? <Button variant="secondary" onClick={() => upd({ variants: [...d.variants, ''] })}><Plus size={15} aria-hidden />Outra resposta (até 3)</Button> : null}
    </>
  );
}

function MessageSettings({ type, d, upd }: { type: 'private_reply' | 'text'; d: NodeData['text']; upd: Upd<NodeData['text']> }) {
  const setBtn = (id: string, patch: Partial<FlowButton>) => upd({ buttons: d.buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)) }, `btn:${id}`);
  return (
    <>
      {type === 'private_reply' ? (
        <p className="text-[13px] text-muted">A mensagem que chega no direct de quem comentou. Coloque um botão: quando a pessoa toca, a conversa abre e o fluxo continua.</p>
      ) : null}
      <TextVars label="Mensagem" value={d.text} max={type === 'private_reply' ? 640 : 1000} rows={5} onChange={(text) => upd({ text }, 'text')}
        placeholder="Oi, {{nome}}! …" />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Botões <span className="font-normal text-muted">(até 3)</span></h3>
        {d.buttons.map((b, i) => (
          <div key={b.id} className="flex flex-col gap-2 rounded-[8px] border border-line p-2.5">
            <div className="flex items-end gap-2">
              <Field className="min-w-0 flex-1" label={`Botão ${i + 1}`} value={b.title} maxLength={20} onChange={(e) => setBtn(b.id, { title: e.target.value })} />
              <button type="button" aria-label={`Remover botão ${i + 1}`} onClick={() => upd({ buttons: d.buttons.filter((x) => x.id !== b.id) })}
                className="mb-1.5 flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={15} aria-hidden /></button>
            </div>
            <div role="radiogroup" aria-label={`O que o botão ${i + 1} faz`} className="flex gap-1.5 text-xs">
              <button type="button" role="radio" aria-checked={b.url == null} onClick={() => setBtn(b.id, { url: null })}
                className={`flex-1 rounded-[6px] border px-2 py-1.5 ${b.url == null ? 'border-primary bg-accent-soft font-medium' : 'border-line'}`}>Continua o fluxo</button>
              <button type="button" role="radio" aria-checked={b.url != null} onClick={() => setBtn(b.id, { url: b.url ?? 'https://' })}
                className={`flex flex-1 items-center justify-center gap-1 rounded-[6px] border px-2 py-1.5 ${b.url != null ? 'border-primary bg-accent-soft font-medium' : 'border-line'}`}><Link2 size={12} aria-hidden />Abre um link</button>
            </div>
            {b.url != null ? <Field label="Link" type="url" value={b.url} maxLength={2000} onChange={(e) => setBtn(b.id, { url: e.target.value })} /> : (
              <p className="text-xs text-muted">Ligue a bolinha “{b.title || 'Botão'}” do bloco ao próximo passo.</p>
            )}
          </div>
        ))}
        {d.buttons.length < 3 ? (
          <Button variant="secondary" onClick={() => upd({ buttons: [...d.buttons, { id: newId('b'), title: d.buttons.length ? 'Saber mais' : 'Quero', url: null }] })}>
            <Plus size={15} aria-hidden />Adicionar botão
          </Button>
        ) : null}
      </section>
    </>
  );
}

function MediaSettings({ d, upd }: { d: NodeData['media']; upd: Upd<NodeData['media']> }) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = () => api<{ items: MediaItem[] }>('GET', '/api/v1/instagram/media').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);
  async function upload(f: File) {
    setBusy(true);
    setError(null);
    try {
      const m = await apiUpload<MediaItem>('/api/v1/instagram/media', f);
      upd({ fileId: m.id, name: m.name, kind: mediaKind(m.contentType) });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.errors[0]?.message ?? e.title : 'Não foi possível enviar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="text-[13px] text-muted">Imagem, vídeo, áudio ou PDF da biblioteca de mídia.</p>
      <input ref={file} type="file" className="hidden" accept="image/jpeg,image/png,video/mp4,video/quicktime,audio/mp4,audio/x-m4a,audio/aac,audio/wav,application/pdf"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} aria-label="Enviar arquivo" />
      <Button variant="secondary" loading={busy} onClick={() => file.current?.click()}><Upload size={15} aria-hidden />Enviar arquivo</Button>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {items === null ? <Spinner label="Carregando biblioteca" /> : items.length === 0 ? <p className="text-xs text-muted">A biblioteca está vazia.</p> : (
        <ul role="radiogroup" aria-label="Arquivo" className="flex max-h-[300px] flex-col gap-1 overflow-y-auto">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" role="radio" aria-checked={d.fileId === m.id} onClick={() => upd({ fileId: m.id, name: m.name, kind: mediaKind(m.contentType) })}
                className={`flex w-full items-center gap-2 rounded-[6px] border px-2.5 py-2 text-left text-[13px] ${d.fileId === m.id ? 'border-primary bg-accent-soft' : 'border-line hover:bg-surface-2'}`}>
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="shrink-0 text-xs text-muted">{bytes(m.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function WaitSettings({ d, upd }: { d: NodeData['wait']; upd: Upd<NodeData['wait']> }) {
  return (
    <>
      <div className="flex gap-2">
        <Field className="w-28" label="Esperar" type="number" min={1} max={10000} value={d.amount}
          onChange={(e) => upd({ amount: Math.max(1, Math.min(10000, Math.round(Number(e.target.value) || 1))) }, 'amount')} />
        <Select className="flex-1" label="Unidade" value={d.unit} onChange={(e) => upd({ unit: e.target.value as NodeData['wait']['unit'] })}>
          <option value="minutes">minutos</option><option value="hours">horas</option><option value="days">dias</option>
        </Select>
      </div>
      <p className="text-xs text-muted">O Instagram só permite mensagens até 24 horas depois da última mensagem da pessoa.</p>
    </>
  );
}

function QuestionSettings({ d, upd }: { d: NodeData['question']; upd: Upd<NodeData['question']> }) {
  const fields = useFields('contact').data ?? [];
  return (
    <>
      <TextVars label="Pergunta" value={d.text} max={1000} rows={3} onChange={(text) => upd({ text }, 'text')} placeholder="Qual o seu melhor e-mail?" />
      <Select label="Guardar a resposta em" value={d.saveTo}
        onChange={(e) => {
          const saveTo = e.target.value as NodeData['question']['saveTo'];
          upd({ saveTo, validate: saveTo === 'email' ? 'email' : saveTo === 'phone' ? 'phone' : d.validate, key: saveTo === 'email' ? 'email' : saveTo === 'phone' ? 'telefone' : d.key });
        }}>
        <option value="var">Variável do fluxo</option>
        <option value="field">Campo do contato</option>
        <option value="email">E-mail do contato</option>
        <option value="phone">Telefone do contato</option>
      </Select>
      {d.saveTo === 'field' ? (
        <Select label="Campo" value={d.key} onChange={(e) => upd({ key: e.target.value })}>
          <option value="">Escolha…</option>
          {fields.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
        </Select>
      ) : d.saveTo === 'var' ? (
        <Field label="Nome da variável" value={d.key} maxLength={40} hint={`Use nas mensagens seguintes como {{${d.key || 'resposta'}}}.`}
          onChange={(e) => upd({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }, 'key')} />
      ) : null}
      <Select label="Aceitar" value={d.validate} onChange={(e) => upd({ validate: e.target.value as NodeData['question']['validate'] })}>
        <option value="text">Qualquer texto</option><option value="email">Só e-mail válido</option>
        <option value="phone">Só telefone válido</option><option value="number">Só número</option>
      </Select>
      {d.validate !== 'text' ? <Field label="Se a resposta não servir, dizer" value={d.retryText} maxLength={300} onChange={(e) => upd({ retryText: e.target.value }, 'retry')} hint="Pergunta de novo até 2 vezes." /> : null}
      <Select label="Esperar a resposta por" value={String(d.timeoutHours ?? '')} onChange={(e) => upd({ timeoutHours: e.target.value ? Number(e.target.value) : null })}>
        <option value="1">1 hora</option><option value="6">6 horas</option><option value="23">23 horas</option><option value="">7 dias</option>
      </Select>
      <p className="text-xs text-muted">Sem resposta no prazo, o fluxo segue pela saída “Não respondeu” (se estiver ligada).</p>
    </>
  );
}

// ---- Condição e ações --------------------------------------------------------------

const RULE_LABEL: Record<FlowRule['kind'], string> = {
  has_tag: 'Tem a etiqueta', not_tag: 'Não tem a etiqueta', follows: 'Segue a conta', not_follows: 'Não segue a conta',
  var_equals: 'Resposta é igual a', var_set: 'Respondeu (variável preenchida)',
};

function TagSelect({ value, onChange, label = 'Etiqueta' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const tags = useTags().data ?? [];
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Escolha…</option>
      {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </Select>
  );
}

function ConditionSettings({ d, upd }: { d: NodeData['condition']; upd: Upd<NodeData['condition']> }) {
  const set = (i: number, r: FlowRule) => upd({ rules: d.rules.map((x, k) => (k === i ? r : x)) }, `r${i}`);
  const blank = (kind: FlowRule['kind']): FlowRule =>
    kind === 'has_tag' || kind === 'not_tag' ? { kind, tagId: '' } : kind === 'var_equals' ? { kind, key: '', value: '' } : kind === 'var_set' ? { kind, key: '' } : { kind };
  return (
    <>
      <p className="text-[13px] text-muted">Divide o caminho: segue pelo “Sim” ou pelo “Não”.</p>
      <Select label="Seguir pelo Sim quando" value={d.match} onChange={(e) => upd({ match: e.target.value as 'all' | 'any' })}>
        <option value="all">Todas as regras valerem</option><option value="any">Qualquer regra valer</option>
      </Select>
      {d.rules.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-[8px] border border-line p-2.5">
          <div className="flex items-end gap-2">
            <Select className="min-w-0 flex-1" label={`Regra ${i + 1}`} value={r.kind} onChange={(e) => set(i, blank(e.target.value as FlowRule['kind']))}>
              {Object.entries(RULE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <button type="button" aria-label={`Remover regra ${i + 1}`} onClick={() => upd({ rules: d.rules.filter((_, k) => k !== i) })}
              className="mb-1.5 flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={15} aria-hidden /></button>
          </div>
          {'tagId' in r ? <TagSelect value={r.tagId} onChange={(tagId) => set(i, { ...r, tagId })} /> : null}
          {'key' in r ? <Field label="Variável" value={r.key} maxLength={40} onChange={(e) => set(i, { ...r, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /> : null}
          {r.kind === 'var_equals' ? <Field label="Valor" value={r.value} maxLength={200} onChange={(e) => set(i, { ...r, value: e.target.value })} /> : null}
        </div>
      ))}
      {d.rules.length < 10 ? <Button variant="secondary" onClick={() => upd({ rules: [...d.rules, { kind: 'has_tag', tagId: '' }] })}><Plus size={15} aria-hidden />Adicionar regra</Button> : null}
    </>
  );
}

const OP_LABEL: Record<FlowOp['kind'], string> = {
  add_tag: 'Adicionar etiqueta', remove_tag: 'Remover etiqueta', set_field: 'Preencher campo do contato', create_lead: 'Criar lead',
  create_deal: 'Criar negócio', notify: 'Avisar alguém da equipe', assign: 'Passar a conversa para alguém',
};

function ActionSettings({ d, upd }: { d: NodeData['action']; upd: Upd<NodeData['action']> }) {
  const pipelines = (usePipelines().data ?? []).filter((p) => !p.archived);
  const members = useDirectory().data?.members ?? [];
  const fields = useFields('contact').data ?? [];
  const set = (i: number, o: FlowOp) => upd({ ops: d.ops.map((x, k) => (k === i ? o : x)) }, `o${i}`);
  const blank = (kind: FlowOp['kind']): FlowOp => {
    switch (kind) {
      case 'add_tag': case 'remove_tag': return { kind, tagId: '' };
      case 'set_field': return { kind, key: '', value: '' };
      case 'create_lead': return { kind, title: 'Instagram: {{usuario}}' };
      case 'create_deal': return { kind, pipelineId: pipelines[0]?.id ?? '', title: 'Instagram: {{usuario}}' };
      case 'notify': return { kind, membershipId: null, text: '{{usuario}} passou pelo fluxo.' };
      case 'assign': return { kind, membershipId: '' };
    }
  };
  return (
    <>
      <p className="text-[13px] text-muted">Faz coisas no CRM sem mandar mensagem.</p>
      {d.ops.map((o, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-[8px] border border-line p-2.5">
          <div className="flex items-end gap-2">
            <Select className="min-w-0 flex-1" label={`Ação ${i + 1}`} value={o.kind} onChange={(e) => set(i, blank(e.target.value as FlowOp['kind']))}>
              {Object.entries(OP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <button type="button" aria-label={`Remover ação ${i + 1}`} onClick={() => upd({ ops: d.ops.filter((_, k) => k !== i) })}
              className="mb-1.5 flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={15} aria-hidden /></button>
          </div>
          {o.kind === 'add_tag' || o.kind === 'remove_tag' ? <TagSelect value={o.tagId} onChange={(tagId) => set(i, { ...o, tagId })} /> : null}
          {o.kind === 'set_field' ? (
            <>
              <Select label="Campo" value={o.key} onChange={(e) => set(i, { ...o, key: e.target.value })}>
                <option value="">Escolha…</option>
                {fields.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
              </Select>
              <Field label="Valor" value={o.value} maxLength={500} onChange={(e) => set(i, { ...o, value: e.target.value })} hint="Pode usar {{variáveis}}." />
            </>
          ) : null}
          {o.kind === 'create_lead' ? <Field label="Título do lead" value={o.title} maxLength={200} onChange={(e) => set(i, { ...o, title: e.target.value })} /> : null}
          {o.kind === 'create_deal' ? (
            <>
              <Select label="Funil" value={o.pipelineId} onChange={(e) => set(i, { ...o, pipelineId: e.target.value })}>
                <option value="">Escolha…</option>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Field label="Título do negócio" value={o.title} maxLength={200} onChange={(e) => set(i, { ...o, title: e.target.value })} />
            </>
          ) : null}
          {o.kind === 'notify' ? (
            <>
              <Select label="Quem" value={o.membershipId ?? ''} onChange={(e) => set(i, { ...o, membershipId: e.target.value || null })}>
                <option value="">Responsável pelo contato</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Field label="Aviso" value={o.text} maxLength={300} onChange={(e) => set(i, { ...o, text: e.target.value })} />
            </>
          ) : null}
          {o.kind === 'assign' ? (
            <Select label="Para" value={o.membershipId} onChange={(e) => set(i, { ...o, membershipId: e.target.value })}>
              <option value="">Escolha…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          ) : null}
        </div>
      ))}
      {d.ops.length < 10 ? <Button variant="secondary" onClick={() => upd({ ops: [...d.ops, { kind: 'add_tag', tagId: '' }] })}><Plus size={15} aria-hidden />Adicionar ação</Button> : null}
    </>
  );
}

/** Paleta de passos para adicionar. */
export const PALETTE: { type: Exclude<NodeType, 'trigger'>; title: string; desc: string; commentOnly?: boolean }[] = [
  { type: 'comment_reply', title: 'Responder no comentário', desc: 'Resposta pública, sorteia até 3', commentOnly: true },
  { type: 'private_reply', title: 'Responder no privado', desc: 'Abre o direct de quem comentou', commentOnly: true },
  { type: 'text', title: 'Texto', desc: 'Mensagem no direct, até 3 botões' },
  { type: 'media', title: 'Imagem, vídeo, áudio ou PDF', desc: 'Da biblioteca de mídia' },
  { type: 'wait', title: 'Esperar', desc: 'Minutos, horas ou dias' },
  { type: 'question', title: 'Pergunta', desc: 'Guarda a resposta (e-mail, telefone…)' },
  { type: 'condition', title: 'Condição', desc: 'Sim ou não: etiqueta, seguidor…' },
  { type: 'action', title: 'Ações no CRM', desc: 'Etiqueta, lead, negócio, aviso' },
];

export function Palette({ commentFlow, onAdd, from }: { commentFlow: boolean; onAdd: (t: Exclude<NodeType, 'trigger'>) => void; from: string | null }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold">{from ? 'Adicione o próximo passo' : 'Adicionar passo'}</h3>
        <p className="text-xs text-muted">{from ? 'Entra ligado ao bloco escolhido.' : 'Escolha um bloco na tela para já ligar o passo novo a ele.'}</p>
      </div>
      <ul className="grid grid-cols-1 gap-1.5">
        {PALETTE.filter((p) => commentFlow || !p.commentOnly).map((p) => (
          <li key={p.type}>
            <button type="button" onClick={() => onAdd(p.type)} className="flex w-full items-center gap-2.5 rounded-[8px] border border-line bg-surface px-2.5 py-2 text-left hover:border-primary hover:bg-accent-soft">
              <NodeIcon type={p.type} size={28} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{p.title}</span>
                <span className="block truncate text-xs text-muted">{p.desc}</span>
              </span>
              <Plus size={15} aria-hidden className="ml-auto shrink-0 text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

