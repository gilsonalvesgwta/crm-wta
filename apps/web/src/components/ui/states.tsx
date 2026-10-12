'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { Spinner } from './spinner';
import { Button } from './button';

export function Loading({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only"><Spinner label={label} /></span>
      {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-[8px] bg-surface-2" />)}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="max-w-md text-[13px] text-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Erro de carregamento, com tratamento próprio para falta de permissão e de 2FA. */
export function LoadError({ error, retry }: { error: ApiError; retry?: () => void }) {
  if (error.type === 'mfa-required') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[10px] border border-line bg-surface px-6 py-10 text-center">
        <ShieldAlert size={28} className="text-warn" aria-hidden />
        <p className="font-medium">Ative a verificação em duas etapas</p>
        <p className="max-w-md text-[13px] text-muted">Esta área administra a empresa. Por segurança, ela só abre com a verificação em duas etapas ativa na sua conta.</p>
        <Link href="/conta#dois-fatores" className="inline-flex h-10 items-center rounded-[6px] bg-primary px-4 font-semibold text-primary-fg">Ativar agora</Link>
      </div>
    );
  }
  if (error.status === 403 || error.status === 404) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[10px] border border-line bg-surface px-6 py-10 text-center">
        <Lock size={28} className="text-muted" aria-hidden />
        <p className="font-medium">{error.status === 404 ? 'Não encontrado' : 'Sem permissão'}</p>
        <p className="max-w-md text-[13px] text-muted">
          {error.status === 404 ? 'Este item não existe ou não está disponível para você.' : 'Seu perfil não dá acesso a esta área. Se precisar, fale com o administrador da empresa.'}
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[10px] border border-line bg-surface px-6 py-10 text-center">
      <p className="font-medium">{error.title}</p>
      {retry ? <Button variant="secondary" onClick={retry}>Tentar de novo</Button> : null}
    </div>
  );
}
