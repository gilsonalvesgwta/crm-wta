'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

/** Confirmação de ação destrutiva, em diálogo nativo (foco e Esc acessíveis). */
export function Confirm({ open, title, children, confirmLabel, danger = true, loading, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; loading?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby="confirm-title"
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[10px] border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40">
      <div className="flex flex-col gap-3 p-5">
        <h2 id="confirm-title" className="text-base font-semibold">{title}</h2>
        <div className="text-[13px] text-muted">{children}</div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
