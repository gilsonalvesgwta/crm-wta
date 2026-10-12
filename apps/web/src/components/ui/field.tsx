'use client';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { useHydrated } from '@/lib/use-hydrated';

export function Field({
  label, error, hint, aside, className = '', ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode; aside?: ReactNode }) {
  const id = useId();
  const hydrated = useHydrated();
  const describedBy = [error ? `${id}-erro` : null, hint ? `${id}-dica` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
        {aside}
      </div>
      <input
        id={id}
        {...input}
        disabled={input.disabled || !hydrated}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`h-11 rounded-[6px] border bg-surface px-3 text-sm text-ink placeholder:text-muted ${error ? 'border-bad' : 'border-line-strong'}`}
      />
      {hint && !error ? <p id={`${id}-dica`} className="text-[13px] text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-erro`} className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
