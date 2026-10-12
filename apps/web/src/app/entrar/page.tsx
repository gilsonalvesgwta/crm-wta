import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <AuthShell title="Entrar" subtitle="Use o e-mail cadastrado pela sua empresa.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
