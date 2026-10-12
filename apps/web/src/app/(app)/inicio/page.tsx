'use client';
import Link from 'next/link';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Alert } from '@/components/ui/alert';

const ADMIN_PERMS = ['users:admin', 'settings:admin', 'integrations:admin', 'channels:admin'];

export default function HomePage() {
  const { me, can } = useSession();
  const first = me.user.name.split(/\s+/)[0];
  const tenant = me.tenants.find((t) => t.id === me.tenantId);
  const isAdmin = ADMIN_PERMS.some(can) || me.user.isPlatformAdmin;
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Olá, {first}</h1>
        <p className="text-muted">{tenant ? `${tenant.name} · ` : ''}{today}</p>
      </div>

      {isAdmin && !me.mfa.enabled ? (
        <Alert tone="warning">
          Você administra esta empresa. Ative a verificação em duas etapas para abrir as configurações.{' '}
          <Link href="/conta#dois-fatores" className="font-semibold underline">Ativar agora</Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Segurança da conta">
          <div className="flex items-start gap-3">
            {me.mfa.enabled
              ? <ShieldCheck size={22} className="mt-0.5 shrink-0 text-ok" aria-hidden />
              : <ShieldAlert size={22} className="mt-0.5 shrink-0 text-warn" aria-hidden />}
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                {me.mfa.enabled ? 'Verificação em duas etapas ativa' : 'Verificação em duas etapas desligada'}
              </p>
              <p className="text-[13px] text-muted">
                {me.mfa.enabled
                  ? 'Sua conta pede um código do aplicativo autenticador a cada login.'
                  : 'Com ela, só a senha não basta para entrar na sua conta.'}
              </p>
              <Link href="/conta" className="mt-1 text-[13px] font-medium text-accent hover:underline">Abrir conta e segurança</Link>
            </div>
          </div>
        </Panel>

        <Panel title="Suas empresas">
          <ul className="flex flex-col gap-2">
            {me.tenants.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <span className={t.id === me.tenantId ? 'font-medium' : ''}>{t.name}</span>
                {t.id === me.tenantId ? <span className="text-[13px] text-muted">Em uso</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
