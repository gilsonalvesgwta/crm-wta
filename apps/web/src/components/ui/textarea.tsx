'use client';
import { useId, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { useHydrated } from '@/lib/use-hydrated';
import { WaPreview, WaToolbar } from './wa-format';

/**
 * Campo de texto. Com `whatsapp`, ganha a barra de formatação do WhatsApp
 * (negrito, itálico, listas…) e a prévia de como chega no celular.
 */
export function Textarea({ label, error, hint, className = '', whatsapp = false, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string; error?: string; hint?: string; whatsapp?: boolean;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const off = rest.disabled || !hydrated;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      {whatsapp ? <WaToolbar target={ref} preview={preview} onPreview={setPreview} disabled={off || rest.readOnly} /> : null}
      <textarea ref={ref} id={id} {...rest} disabled={off} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-erro` : hint ? `${id}-dica` : undefined}
        className={`min-h-[88px] rounded-[6px] border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted ${error ? 'border-bad' : 'border-line-strong'}`} />
      {whatsapp && preview ? <WaPreview text={String(rest.value ?? '')} /> : null}
      {hint && !error ? <p id={`${id}-dica`} className="text-[13px] text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-erro`} className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
