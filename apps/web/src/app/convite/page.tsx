'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, type Me } from '@/lib/api';
import { AuthShell } from '@/components/auth/auth-shell';
import { useNewPassword } from '@/components/auth/new-password';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

type Info = { tenantName: string; email: string; userExists: boolean };

function Invite() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const pw = useNewPassword({ password: 'Crie uma senha', confirm: 'Confirme a senha' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadError('Link incompleto. Abra o link do e-mail de novo.');
      return;
    }
    api<Info>('GET', `/api/v1/auth/invitations/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof ApiError ? e.title : 'Não foi possível abrir o convite.'));
    api<Me>('GET', '/api/v1/auth/me').then(setMe).catch(() => setMe(null));
  }, [token]);

  async function accept(e?: FormEvent) {
    e?.preventDefault();
    if (info && !info.userExists) {
      pw.touch();
      if (!name.trim() || !pw.valid) return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = info?.userExists ? { token } : { token, name, password: pw.password };
      const r = await api<{ tenantId: string; createdUser: boolean }>('POST', '/api/v1/auth/invitations/accept', body);
      if (r.createdUser) {
        await api('POST', '/api/v1/auth/login', { email: info!.email, password: pw.password });
        router.replace('/inicio');
      } else {
        await api('POST', '/api/v1/auth/tenant', { tenantId: r.tenantId });
        router.replace('/inicio');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Algo deu errado. Tente de novo.'));
      setLoading(false);
    }
  }

  if (loadError) {
    return <Alert tone="error">{loadError}</Alert>;
  }
  if (!info) return <Spinner label="Abrindo o convite" />;

  if (info.userExists) {
    const signedAs = me?.user.email;
    if (signedAs !== info.email) {
      return (
        <div className="flex flex-col gap-4">
          <Alert tone="info">
            O e-mail <strong>{info.email}</strong> já tem conta. Entre com ela para aceitar o convite de <strong>{info.tenantName}</strong>.
          </Alert>
          {signedAs ? <p className="text-[13px] text-muted">Você está conectado como {signedAs}.</p> : null}
          <Link href={`/entrar?voltar=${encodeURIComponent(`/convite?token=${token}`)}`}
            className="inline-flex h-[46px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-fg">
            Entrar com {info.email}
          </Link>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error.title}</Alert> : null}
        <p>Você foi convidado para <strong>{info.tenantName}</strong>.</p>
        <Button size="lg" loading={loading} onClick={() => accept()}>Aceitar o convite</Button>
      </div>
    );
  }

  return (
    <form onSubmit={accept} noValidate className="flex flex-col gap-[18px]">
      {error && !error.fieldError('password') ? <Alert tone="error">{error.title}</Alert> : null}
      <Field label="E-mail" value={info.email} readOnly disabled />
      <Field label="Seu nome" autoComplete="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      {pw.render(error?.fieldError('password'))}
      <Button type="submit" size="lg" loading={loading}>Criar conta e entrar</Button>
    </form>
  );
}

export default function InvitePage() {
  return (
    <AuthShell title="Convite" subtitle="Crie sua conta para começar.">
      <Suspense><Invite /></Suspense>
    </AuthShell>
  );
}
