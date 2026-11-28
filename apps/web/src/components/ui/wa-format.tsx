'use client';
import { Fragment, type ReactNode, type RefObject } from 'react';
import { Bold, Code, Eye, EyeOff, Italic, List, ListOrdered, Quote, Strikethrough } from 'lucide-react';

/*
 * Formatação do WhatsApp: *negrito*, _itálico_, ~tachado~, ```monoespaçado```,
 * `código`, listas ("- " ou "1. ") e citação ("> "). A barra aplica no texto
 * selecionado; a prévia mostra como chega no celular.
 */

type Kind = 'bold' | 'italic' | 'strike' | 'mono' | 'bullet' | 'number' | 'quote';
const WRAP: Partial<Record<Kind, string>> = { bold: '*', italic: '_', strike: '~', mono: '```' };

/** Troca o valor do campo como se a pessoa tivesse digitado (o React recebe o onChange). */
function setNative(el: HTMLTextAreaElement, value: string, selStart: number, selEnd: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(selStart, selEnd); });
}

export function applyWaFormat(el: HTMLTextAreaElement, kind: Kind) {
  const { value, selectionStart: a, selectionEnd: b } = el;
  const mark = WRAP[kind];
  if (mark) {
    let sel = value.slice(a, b);
    // Espaços nas pontas ficam fora da marcação (senão o WhatsApp não formata).
    const lead = sel.match(/^\s*/)![0];
    const trail = sel.match(/\s*$/)![0];
    sel = sel.trim();
    const already = sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2;
    const inner = already ? sel.slice(mark.length, sel.length - mark.length) : sel;
    const out = already ? inner : `${mark}${inner || 'texto'}${mark}`;
    const next = value.slice(0, a) + lead + out + trail + value.slice(b);
    const start = a + lead.length + (already ? 0 : mark.length);
    setNative(el, next, start, start + (inner || (already ? '' : 'texto')).length);
    return;
  }
  // Listas e citação: no começo de cada linha selecionada.
  const lineStart = value.lastIndexOf('\n', a - 1) + 1;
  const lineEnd = value.indexOf('\n', b) === -1 ? value.length : value.indexOf('\n', b);
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const re = kind === 'bullet' ? /^- / : kind === 'number' ? /^\d+\. / : /^> /;
  const all = lines.every((l) => re.test(l));
  const out = lines.map((l, i) => (all ? l.replace(re, '') : `${kind === 'bullet' ? '- ' : kind === 'number' ? `${i + 1}. ` : '> '}${l.replace(/^(- |\d+\. |> )/, '')}`)).join('\n');
  const next = value.slice(0, lineStart) + out + value.slice(lineEnd);
  setNative(el, next, lineStart, lineStart + out.length);
}

const TOOLS: [Kind, string, typeof Bold][] = [
  ['bold', 'Negrito (*texto*)', Bold], ['italic', 'Itálico (_texto_)', Italic], ['strike', 'Tachado (~texto~)', Strikethrough],
  ['mono', 'Monoespaçado (```texto```)', Code], ['bullet', 'Lista com marcadores (- )', List], ['number', 'Lista numerada (1. )', ListOrdered], ['quote', 'Citação (> )', Quote],
];

/** Barra de formatação do WhatsApp para um campo de texto. */
export function WaToolbar({ target, preview, onPreview, disabled }: {
  target: RefObject<HTMLTextAreaElement | null>; preview?: boolean; onPreview?: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div role="toolbar" aria-label="Formatação do WhatsApp" className="flex flex-wrap items-center gap-0.5">
      {TOOLS.map(([k, label, Icon]) => (
        <button key={k} type="button" title={label} aria-label={label} disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} onClick={() => target.current && applyWaFormat(target.current, k)}
          className="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">
          <Icon size={15} aria-hidden />
        </button>
      ))}
      {onPreview ? (
        <button type="button" aria-pressed={!!preview} onClick={() => onPreview(!preview)}
          className={`ml-1 inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-medium ${preview ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
          {preview ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}Prévia
        </button>
      ) : null}
    </div>
  );
}

// ---- Exibição -----------------------------------------------------------------------------------

const INLINE = /(```[\s\S]+?```|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    const at = m.index ?? 0;
    const before = text[at - 1];
    const after = text[at + t.length];
    // Como no WhatsApp: a marcação precisa encostar no texto e não ficar no meio de uma palavra.
    const word = /[\p{L}\p{N}]/u;
    const marker = !t.startsWith('http');
    const inner = t.startsWith('```') ? t.slice(3, -3) : marker ? t.slice(1, -1) : t;
    if (marker && (/^\s|\s$/.test(inner) || (before && word.test(before)) || (after && word.test(after)))) continue;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${i++}`;
    if (t.startsWith('```')) out.push(<code key={k} className="rounded bg-black/5 px-1 font-mono text-[0.92em] dark:bg-white/10">{inner}</code>);
    else if (t.startsWith('`')) out.push(<code key={k} className="rounded bg-black/5 px-1 font-mono text-[0.92em] dark:bg-white/10">{inner}</code>);
    else if (t.startsWith('*')) out.push(<strong key={k}>{inline(inner, k)}</strong>);
    else if (t.startsWith('_')) out.push(<em key={k}>{inline(inner, k)}</em>);
    else if (t.startsWith('~')) out.push(<del key={k}>{inline(inner, k)}</del>);
    else out.push(<a key={k} href={t} target="_blank" rel="noreferrer noopener" className="underline break-all">{t}</a>);
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Texto com a formatação do WhatsApp aplicada (negrito, itálico, listas, links…). */
export function WaText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n');
  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {lines.map((l, i) => {
        const k = `l${i}`;
        const end = i < lines.length - 1 ? '\n' : '';
        if (/^> /.test(l)) return <Fragment key={k}><span className="inline-block border-l-2 border-current/40 pl-2 opacity-80">{inline(l.slice(2), k)}</span>{end}</Fragment>;
        if (/^[-*•] /.test(l)) return <Fragment key={k}>{'• '}{inline(l.slice(2), k)}{end}</Fragment>;
        return <Fragment key={k}>{inline(l, k)}{end}</Fragment>;
      })}
    </span>
  );
}

/** Prévia em balão, como chega no WhatsApp. */
export function WaPreview({ text, empty = 'A prévia aparece aqui.' }: { text: string; empty?: string }) {
  return (
    <div className="rounded-[10px] bg-[#e7ffdb] p-3 text-[14px] leading-relaxed text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]" aria-label="Prévia no WhatsApp">
      {text.trim() ? <WaText text={text} /> : <span className="opacity-60">{empty}</span>}
    </div>
  );
}
