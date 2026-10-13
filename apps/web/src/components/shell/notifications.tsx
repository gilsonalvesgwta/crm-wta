'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { relative, type Notification } from '@/lib/crm';

/** Avisos da pessoa: lembretes, leads recebidos, importações concluídas. Atualiza a cada minuto. */
export function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Notification[]; unread: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setData(await api('GET', '/api/v1/notifications'));
    } catch {
      // Sem empresa ou sessão: o sino some até a próxima tentativa.
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  async function readAll() {
    await api('POST', '/api/v1/notifications/read', { ids: 'all' }).catch(() => undefined);
    void load();
  }
  async function read(n: Notification) {
    setOpen(false);
    if (!n.readAt) await api('POST', '/api/v1/notifications/read', { ids: [n.id] }).catch(() => undefined);
    void load();
  }

  const unread = data?.unread ?? 0;
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setOpen(!open); if (!open) void load(); }} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread ? `Avisos: ${unread} não lidos` : 'Avisos'}
        className="relative flex size-10 items-center justify-center rounded-[6px] border border-line hover:bg-surface-2">
        <Bell size={18} aria-hidden />
        {unread ? <span aria-hidden className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-fg">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Avisos" className="absolute right-0 top-12 z-50 flex max-h-[70vh] w-[min(360px,calc(100vw-24px))] flex-col rounded-[10px] border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-semibold">Avisos</p>
            {unread ? <button type="button" onClick={readAll} className="text-[13px] font-medium text-accent hover:underline">Marcar todos como lidos</button> : null}
          </div>
          <ul className="overflow-y-auto">
            {!data?.items.length ? <li className="px-4 py-6 text-center text-[13px] text-muted">Nenhum aviso.</li> : data.items.map((n) => {
              const body = (
                <>
                  <span className="flex items-start justify-between gap-2">
                    <span className={`text-sm ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</span>
                    {!n.readAt ? <span aria-label="não lido" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /> : null}
                  </span>
                  {n.body ? <span className="block text-[13px] text-muted">{n.body}</span> : null}
                  <span className="block text-[12px] text-muted">{relative(n.createdAt)}</span>
                </>
              );
              return (
                <li key={n.id} className="border-b border-line last:border-0">
                  {n.link
                    ? <Link href={n.link} onClick={() => read(n)} className="block px-4 py-3 hover:bg-surface-2">{body}</Link>
                    : <button type="button" onClick={() => read(n)} className="block w-full px-4 py-3 text-left hover:bg-surface-2">{body}</button>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
