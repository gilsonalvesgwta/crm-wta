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
        else if (m.tenants.length === 0 && m.user.isPlatformAdmin) router.replace('/plataforma');
        else setMe(m);
      })
      .catch(() => router.replace('/entrar?motivo=sessao'));
  }, [router]);

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
    return <Alert tone="warning">Sua conta não está ativa em nenhuma empresa. Fale com o administrador.</Alert>;
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
    <AuthShell title="Escolha a empresa" subtitle="Sua conta tem acesso a mais de uma empresa.">
      <Suspense><Chooser /></Suspense>
    </AuthShell>
  );
}
