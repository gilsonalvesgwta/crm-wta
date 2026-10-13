'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import type { Page, Ref, TagRef } from '@/lib/crm';
import { useHydrated } from '@/lib/use-hydrated';
import { Select } from '@/components/ui/select';
import { TagChip } from '@/components/ui/misc';
import { useDirectory, useTags } from './data';

/** Responsável: pessoas ativas da empresa. */
export function MemberSelect({ label = 'Responsável', value, onChange, allowNone = true, noneLabel = 'Sem responsável', error, className }: {
  label?: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; noneLabel?: string; error?: string; className?: string;
}) {
  const { data } = useDirectory();
  return (
    <Select label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} error={error} className={className}>
      {allowNone ? <option value="">{noneLabel}</option> : null}
      {(data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.id === data?.me ? `${m.name} (você)` : m.name}</option>)}
    </Select>
  );
}

export function TeamSelect({ label = 'Equipe', value, onChange, className }: {
  label?: string; value: string | null; onChange: (v: string | null) => void; className?: string;
}) {
  const { data } = useDirectory();
  return (
    <Select label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">Sem equipe</option>
      {(data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </Select>
  );
}

/** Etiquetas: escolhe da lista e cria nova na hora. */
export function TagPicker({ value, onChange, label = 'Etiquetas' }: { value: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const { data: tags, refresh } = useTags();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const hydrated = useHydrated();
  const selected = (tags ?? []).filter((t) => value.includes(t.id));
  const matches = (tags ?? []).filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exact = (tags ?? []).some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  async function create() {
    setErr(null);
    try {
      const t = await api<TagRef>('POST', '/api/v1/tags', { name: query.trim() });
      await refresh();
      onChange([...value, t.id]);
      setQuery('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível criar a etiqueta.');
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-l`} className="text-[13px] font-medium">{label}</span>
      <div className="flex flex-wrap gap-1.5" aria-labelledby={`${id}-l`}>
        {selected.map((t) => (
          <span key={t.id} className="inline-flex items-center">
            <TagChip tag={t} />
            <button type="button" aria-label={`Remover etiqueta ${t.name}`} onClick={() => onChange(value.filter((v) => v !== t.id))}
              className="-ml-1 flex size-6 items-center justify-center rounded-full text-muted hover:text-ink"><X size={12} aria-hidden /></button>
          </span>
        ))}
        <button type="button" disabled={!hydrated} aria-expanded={open} aria-controls={`${id}-p`} onClick={() => setOpen(!open)}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-line-strong px-2 text-xs font-medium text-muted hover:text-ink">
          <Plus size={12} aria-hidden />Etiqueta
        </button>
      </div>
      {open ? (
        <div id={`${id}-p`} className="flex flex-col gap-2 rounded-[8px] border border-line bg-surface-2 p-2">
          <input aria-label="Buscar ou criar etiqueta" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar ou criar"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (query.trim() && !exact) void create(); } }}
            className="h-9 rounded-[6px] border border-line-strong bg-surface px-2.5 text-sm" />
          <ul className="flex max-h-44 flex-col overflow-y-auto">
            {matches.map((t) => {
              const on = value.includes(t.id);
              return (
                <li key={t.id}>
                  <button type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== t.id) : [...value, t.id])}
                    className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-sm hover:bg-surface">
                    <span aria-hidden className="size-2.5 rounded-full" style={{ background: t.color }} />
                    <span className="flex-1 truncate">{t.name}</span>
                    {on ? <Check size={14} aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {query.trim() && !exact ? (
            <button type="button" onClick={create} className="flex h-9 items-center gap-2 rounded-[6px] px-2 text-left text-sm font-medium text-accent hover:bg-surface">
              <Plus size={14} aria-hidden />Criar “{query.trim()}”
            </button>
          ) : null}
          {err ? <p role="alert" className="text-[13px] text-bad">{err}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type Kind = 'contact' | 'organization' | 'deal';
const ENDPOINT: Record<Kind, (q: string) => string> = {
  contact: (q) => `/api/v1/contacts?pageSize=8&sort=name&dir=asc&q=${encodeURIComponent(q)}`,
  organization: (q) => `/api/v1/organizations?pageSize=8&q=${encodeURIComponent(q)}`,
  deal: (q) => `/api/v1/deals?pageSize=8&status=all&q=${encodeURIComponent(q)}`,
};

/**
 * Busca com lista de sugestões (padrão combobox da ARIA): digita, escolhe com
 * setas e Enter, ou com o mouse.
 */
export function EntityPicker({ kind, label, value, onChange, error, placeholder }: {
  kind: Kind; label: string; value: Ref | null; onChange: (v: Ref | null) => void; error?: string; placeholder?: string;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Ref[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<Page<{ id: string; name?: string; title?: string }>>('GET', ENDPOINT[kind](query.trim()));
        setItems(r.items.map((i) => ({ id: i.id, name: i.name ?? i.title ?? '' })));
        setActive(0);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, open, kind]);

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">{label}</span>
        <div className="flex h-11 items-center justify-between gap-2 rounded-[6px] border border-line-strong bg-surface px-3 text-sm">
          <span className="truncate">{value.name}</span>
          <button type="button" disabled={!hydrated} onClick={() => onChange(null)} aria-label={`Remover ${label.toLowerCase()}`}
            className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><X size={14} aria-hidden /></button>
        </div>
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
      </div>
    );
  }

  const choose = (r: Ref) => { onChange(r); setOpen(false); setQuery(''); };
  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-lb`} aria-autocomplete="list" autoComplete="off"
        aria-activedescendant={open && items[active] ? `${id}-o${active}` : undefined} aria-invalid={error ? true : undefined}
        disabled={!hydrated} value={query} placeholder={placeholder ?? 'Digite para buscar'}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); choose(items[active]!); }
          if (e.key === 'Escape') setOpen(false);
        }}
        className={`h-11 rounded-[6px] border bg-surface px-3 text-sm placeholder:text-muted ${error ? 'border-bad' : 'border-line-strong'}`} />
      {open ? (
        <ul id={`${id}-lb`} role="listbox" aria-label={label}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto rounded-[8px] border border-line bg-surface p-1 shadow-lg">
          {items.length === 0 ? (
            <li role="option" aria-selected={false} aria-disabled className="px-3 py-2 text-[13px] text-muted">{loading ? 'Buscando…' : 'Nada encontrado'}</li>
          ) : items.map((r, i) => (
            <li key={r.id} id={`${id}-o${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
              className={`cursor-pointer truncate rounded-[6px] px-3 py-2 text-sm ${i === active ? 'bg-surface-2' : ''}`}>{r.name}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
