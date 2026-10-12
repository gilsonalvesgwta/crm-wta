'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, safeBack, type Me } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

function VerifyForm() {
  const router = useRouter();
  const back = useSearchParams().get('voltar');
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ usedRecoveryCode: boolean; recoveryCodesLeft: number }>('POST', '/api/v1/auth/mfa/verify', { code });
      if (r.usedRecoveryCode) {
        setNotice(`Código de recuperação usado. Restam ${r.recoveryCodesLeft}.`);
      }
      const me = await api<Me>('GET', '/api/v1/auth/me');
      router.replace(me.tenantId ? (safeBack(back) ?? '/inicio') : '/entrar/empresa');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.type === 'unauthenticated') {
        router.replace('/entrar?motivo=sessao');
        return;
      }
      setError(err instanceof ApiError ? err.title : 'Algo deu errado. Tente de novo.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {recovery ? (
        <Field label="Código de recuperação" name="code" autoComplete="off" autoFocus required
          placeholder="xxxxx-xxxxx" value={code} onChange={(e) => setCode(e.target.value)} />
      ) : (
        <Field label="Código de 6 dígitos" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required
          maxLength={6} pattern="[0-9]*" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          hint="Abra o aplicativo autenticador no celular." />
      )}
      <Button type="submit" size="lg" loading={loading}>Confirmar</Button>
      <button type="button" className="min-h-11 self-start text-[13px] font-medium text-accent hover:underline"
        onClick={() => { setRecovery(!recovery); setCode(''); setError(null); }}>
        {recovery ? 'Usar o código do aplicativo' : 'Sem acesso ao aplicativo? Use um código de recuperação'}
      </button>
    </form>
  );
}

export default function VerifyPage() {
  return (
    <AuthShell title="Verificação em duas etapas" subtitle="Confirme que é você.">
      <Suspense><VerifyForm /></Suspense>
    </AuthShell>
  );
}
