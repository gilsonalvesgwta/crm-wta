'use client';
import { useId, type TextareaHTMLAttributes } from 'react';
import { useHydrated } from '@/lib/use-hydrated';

export function Textarea({ label, error, hint, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string; error?: string; hint?: string;
}) {
  const id = useId();
  const hydrated = useHydrated();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      <textarea id={id} {...rest} disabled={rest.disabled || !hydrated} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-erro` : hint ? `${id}-dica` : undefined}
        className={`min-h-[88px] rounded-[6px] border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted ${error ? 'border-bad' : 'border-line-strong'}`} />
      {hint && !error ? <p id={`${id}-dica`} className="text-[13px] text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-erro`} className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
