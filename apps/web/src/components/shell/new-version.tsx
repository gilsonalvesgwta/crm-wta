'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const MINE = process.env.NEXT_PUBLIC_VERSAO ?? 'dev';

/**
 * Aviso de versão nova: depois de uma atualização da stack, a aba que já estava
 * aberta continua com a interface antiga até recarregar. Confere a versão do
 * servidor ao voltar para a aba e a cada 5 minutos.
 */
export function NewVersionBanner() {
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    if (MINE === 'dev') return;
    let alive = true;
    const check = () => {
      fetch('/api/healthz', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
        .then((b: { version?: string } | null) => { if (alive && b?.version && b.version !== 'dev') setServer(b.version); })
        .catch(() => undefined);
    };
    check();
    const t = setInterval(check, 5 * 60_000);
    const onFocus = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  if (!server || server === MINE) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-info-soft px-4 py-2 text-[13px] text-ink">
      <span>O CRM foi atualizado (versão {server}). Recarregue para usar a versão nova.</span>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-primary px-3 font-medium text-primary-fg">
        <RefreshCw size={14} aria-hidden />Recarregar
      </button>
    </div>
  );
}
