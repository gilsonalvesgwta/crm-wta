'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Vindo do convite, o e-mail já chega preenchido.
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email');
    if (e) setEmail(e);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('POST', '/api/v1/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Algo deu errado. Tente de novo.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Esqueci minha senha" subtitle="Enviamos um link para você criar uma nova senha.">
      {sent ? (
        <div className="flex flex-col gap-5">
          <Alert tone="success">
            Se <strong>{email}</strong> estiver cadastrado, você vai receber um e-mail com o link em alguns minutos. O link vale por 1 hora.
          </Alert>
          <p className="text-[13px] text-muted">Não chegou? Confira a caixa de spam ou peça de novo daqui a alguns minutos.</p>
          <Link href="/entrar" className="text-sm font-medium text-accent hover:underline">Voltar para o login</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
          {error && error.errors.length === 0 ? <Alert tone="error">{error.title}</Alert> : null}
          <Field label="E-mail" type="email" autoComplete="username" required autoFocus value={email}
            onChange={(e) => setEmail(e.target.value)} error={error?.fieldError('email')} />
          <Button type="submit" size="lg" loading={loading}>Enviar link</Button>
          <Link href="/entrar" className="min-h-11 text-[13px] font-medium text-accent hover:underline">Voltar para o login</Link>
        </form>
      )}
    </AuthShell>
  );
}
