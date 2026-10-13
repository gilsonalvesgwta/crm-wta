'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { initials } from '@/lib/crm';

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-ink">
      {initials(name) || '?'}
    </span>
  );
}

export function TagChip({ tag }: { tag: { name: string; color: string } }) {
  return (
    <span className="inline-flex h-6 max-w-[160px] items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-xs font-medium">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: tag.color }} />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

export function SearchBox({ value, onChange, label, placeholder, className = '' }: {
  value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input type="search" aria-label={label} placeholder={placeholder ?? label} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-[6px] border border-line-strong bg-surface pl-9 pr-3 text-sm placeholder:text-muted" />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 pt-3 text-[13px] text-muted">
      <span>{from.toLocaleString('pt-BR')}–{to.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"
          className="flex size-9 items-center justify-center rounded-[6px] border border-line bg-surface text-ink disabled:opacity-40"><ChevronLeft size={16} aria-hidden /></button>
        <span className="px-2">Página {page} de {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página"
          className="flex size-9 items-center justify-center rounded-[6px] border border-line bg-surface text-ink disabled:opacity-40"><ChevronRight size={16} aria-hidden /></button>
      </div>
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col gap-2">
      {back ? (
        <Link href={back.href} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
          <ChevronLeft size={14} aria-hidden />{back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Linha de rótulo e valor nas fichas de detalhe. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}
