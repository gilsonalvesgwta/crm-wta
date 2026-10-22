'use client';
import { useEffect } from 'react';

/**
 * Último recurso: erro fora das telas internas (no layout geral). Sem os
 * estilos do CRM, que podem não ter carregado; em português e com a mensagem
 * técnica para o suporte.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 32, background: '#fff', color: '#111' }}>
        <div role="alert" style={{ maxWidth: 560, margin: '40px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Não foi possível carregar o CRM</h1>
          <p style={{ margin: 0, color: '#555' }}>Recarregue a página. Se continuar, mande ao suporte um print deste aviso.</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f4f6', padding: 12, borderRadius: 6, fontSize: 12, color: '#444' }}>
            {`${error.name}: ${error.message}${error.digest ? `\ncódigo: ${error.digest}` : ''}\nversão: ${process.env.NEXT_PUBLIC_VERSAO ?? 'dev'}`}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => window.location.reload()} style={{ height: 40, padding: '0 14px', borderRadius: 6, border: 0, background: '#111', color: '#fff', fontWeight: 600 }}>Recarregar</button>
            <button type="button" onClick={reset} style={{ height: 40, padding: '0 14px', borderRadius: 6, border: '1px solid #ccc', background: '#fff' }}>Tentar de novo</button>
          </div>
        </div>
      </body>
    </html>
  );
}
