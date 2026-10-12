'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, nextStep, type LoginResponse } from '@/lib/api';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const back = params.get('voltar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<LoginResponse>('POST', '/api/v1/auth/login', { email, password, remember });
      router.replace(nextStep(r, back));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Algo deu errado. Tente de novo.'));
      setLoading(false);
    }
  }

  const generic = error && error.errors.length === 0 ? error.title : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
      {params.get('motivo') === 'sessao' ? <Alert tone="info">Sua sessão terminou. Entre de novo para continuar.</Alert> : null}
      {params.get('motivo') === 'senha' ? <Alert tone="success">Senha redefinida. Entre com a senha nova.</Alert> : null}
      {generic ? <Alert tone="error">{generic}</Alert> : null}
      <Field
        label="E-mail" type="email" name="email" autoComplete="username" required autoFocus
        value={email} onChange={(e) => setEmail(e.target.value)} error={error?.fieldError('email')}
      />
      <Field
        label="Senha" type="password" name="password" autoComplete="current-password" required
        value={password} onChange={(e) => setPassword(e.target.value)} error={error?.fieldError('password')}
        aside={<Link href="/recuperar-senha" className="text-[13px] font-medium text-accent hover:underline">Esqueci minha senha</Link>}
      />
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-[18px] accent-[var(--primary)]" />
        Manter conectado neste dispositivo
      </label>
      <Button type="submit" size="lg" loading={loading}>Entrar</Button>
    </form>
  );
}
