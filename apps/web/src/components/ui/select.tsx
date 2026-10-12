'use client';
import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useHydrated } from '@/lib/use-hydrated';

export function Select({ label, error, children, className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; error?: string; children: ReactNode;
}) {
  const id = useId();
  const hydrated = useHydrated();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      <select id={id} {...rest} disabled={rest.disabled || !hydrated} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-erro` : undefined}
        className={`h-11 rounded-[6px] border bg-surface px-3 text-sm text-ink ${error ? 'border-bad' : 'border-line-strong'}`}>
        {children}
      </select>
      {error ? <p id={`${id}-erro`} className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
