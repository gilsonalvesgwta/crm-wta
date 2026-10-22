'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Erro inesperado ao montar uma tela: mostra um aviso dentro do CRM (menu e
 * navegação continuam) em vez de derrubar a página inteira.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-lg flex-col items-start gap-3 rounded-[12px] border border-line bg-surface p-6">
      <AlertTriangle size={24} className="text-warn" aria-hidden />
      <h1 className="text-lg font-semibold">Não foi possível mostrar esta tela</h1>
      <p className="text-sm text-muted">
        Algo nos dados desta página não pôde ser exibido. Tente de novo; se continuar, avise o suporte com o código abaixo.
      </p>
      <p className="rounded-[6px] bg-surface-2 px-2 py-1 font-mono text-[12px] text-muted">{error.digest ?? (error.message || 'erro').slice(0, 120)}</p>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>Tentar de novo</Button>
        <Link href="/inicio" className="inline-flex h-10 items-center rounded-[6px] border border-line-strong px-3.5 text-sm font-medium hover:bg-surface-2">Ir para o início</Link>
      </div>
    </div>
  );
}
