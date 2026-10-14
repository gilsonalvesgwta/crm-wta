'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, safeBack, type Me } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

function Chooser() {
  const router = useRouter();
  const back = useSearchParams().get('voltar');
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>('GET', '/api/v1/auth/me')
      .then((m) => {
        if (m.mfa.pending) router.replace('/entrar/verificacao');
        // Administrador geral sem empresa ativa vai para a Plataforma (onde cria ou reativa empresas).
        else if (m.tenants.length === 0 && safeBack(back)?.startsWith('/convite')) router.replace(back!);
        else if (m.tenants.length === 0 && m.user.isPlatformAdmin) router.replace('/plataforma');
        else setMe(m);
      })
      .catch(() => router.replace('/entrar?motivo=sessao'));
  }, [router, back]);

  async function choose(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api('POST', '/api/v1/auth/tenant', { tenantId: id });
      router.replace(safeBack(back) ?? '/inicio');
    } catch (err) {
      setError(err instanceof ApiError ? err.title : 'Não foi possível entrar nesta empresa.');
      setBusy(null);
    }
  }

  if (!me) return <Spinner label="Carregando" />;
  if (me.tenants.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="warning">
          Sua conta ({me.user.email}) não está ativa em nenhuma empresa no momento. Se você recebeu um convite, abra o link do e-mail
          para aceitar; senão, peça ao administrador da empresa para convidar você de novo.
        </Alert>
        <button type="button" onClick={() => void api('POST', '/api/v1/auth/logout').finally(() => router.replace('/entrar'))}
          className="inline-flex h-[46px] items-center justify-center rounded-[6px] border border-line bg-surface font-medium hover:bg-surface-2">
          Sair e entrar com outra conta
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="flex flex-col gap-2">
        {me.tenants.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => choose(t.id)} disabled={busy !== null}
              className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-[8px] border px-4 text-left transition-colors hover:bg-surface-2 disabled:opacity-60 ${me.tenantId === t.id ? 'border-primary' : 'border-line'}`}>
              <span className="font-medium">{t.name}</span>
              {busy === t.id ? <Spinner /> : me.tenantId === t.id ? <span className="text-[13px] text-muted">Atual</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TenantPage() {
  return (
    <AuthShell title="Escolha a empresa" subtitle="Em qual empresa você vai trabalhar agora?">
      <Suspense><Chooser /></Suspense>
    </AuthShell>
  );
}
