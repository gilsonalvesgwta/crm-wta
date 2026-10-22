'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Erro inesperado ao montar uma tela: mostra um aviso dentro do CRM (menu e
 * navegação continuam) em vez de derrubar a página inteira, com a mensagem
 * técnica para o suporte.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-xl flex-col items-start gap-3 rounded-[12px] border border-line bg-surface p-6">
      <AlertTriangle size={24} className="text-warn" aria-hidden />
      <h1 className="text-lg font-semibold">Não foi possível mostrar esta tela</h1>
      <p className="text-sm text-muted">
        Algo nos dados desta página não pôde ser exibido. Tente de novo; se continuar, mande ao suporte um print deste aviso.
      </p>
      <pre className="w-full overflow-x-auto whitespace-pre-wrap rounded-[6px] bg-surface-2 px-3 py-2 font-mono text-[12px] text-muted">
        {`${error.name}: ${error.message}${error.digest ? `\ncódigo: ${error.digest}` : ''}\nversão: ${process.env.NEXT_PUBLIC_VERSAO ?? 'dev'}\nendereço: ${typeof window === 'undefined' ? '' : window.location.pathname}`}
      </pre>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>Tentar de novo</Button>
        <Link href="/inicio" className="inline-flex h-10 items-center rounded-[6px] border border-line-strong px-3.5 text-sm font-medium hover:bg-surface-2">Ir para o início</Link>
      </div>
    </div>
  );
}
