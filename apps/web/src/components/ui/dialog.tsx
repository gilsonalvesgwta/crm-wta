'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Diálogo modal nativo: foco preso, Esc fecha, fundo inerte. O conteúdo é
 * montado só enquanto aberto, para cada abertura começar limpa.
 */
export function Dialog({ open, title, description, onClose, children, width = 560, footer }: {
  open: boolean; title: string; description?: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-labelledby={`${id}-t`}
      style={{ width: `min(${width}px, calc(100vw - 24px))` }}
      className="m-auto max-h-[calc(100dvh-24px)] rounded-[12px] border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/45">
      {open ? (
        <div className="flex max-h-[calc(100dvh-24px)] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 id={`${id}-t`} className="text-base font-semibold">{title}</h2>
              {description ? <div className="mt-0.5 text-[13px] text-muted">{description}</div> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink">
              <X size={18} aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
