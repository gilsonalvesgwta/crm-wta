'use client';
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';
import { useNewPassword } from '@/components/auth/new-password';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const pw = useNewPassword();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">Link incompleto. Abra o link do e-mail de novo ou peça outro.</Alert>
        <Link href="/recuperar-senha" className="text-sm font-medium text-accent hover:underline">Pedir um novo link</Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    pw.touch();
    if (!pw.valid) return;
    setLoading(true);
    setError(null);
    try {
      await api('POST', '/api/v1/auth/password/reset', { token, password: pw.password });
      router.replace('/entrar?motivo=senha');
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Algo deu errado. Tente de novo.'));
      setLoading(false);
    }
  }

  const expired = error?.fieldError('token');
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
      {expired ? (
        <Alert tone="error">
          {error?.title} <Link href="/recuperar-senha" className="font-medium underline">Pedir um novo link</Link>
        </Alert>
      ) : error && !error.fieldError('password') ? <Alert tone="error">{error.title}</Alert> : null}
      {pw.render(error?.fieldError('password'))}
      <Button type="submit" size="lg" loading={loading}>Salvar nova senha</Button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <AuthShell title="Crie uma nova senha" subtitle="Depois de salvar, todas as sessões abertas são encerradas.">
      <Suspense><ResetForm /></Suspense>
    </AuthShell>
  );
}
