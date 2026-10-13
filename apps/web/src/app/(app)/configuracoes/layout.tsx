'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/shell/session';
import { ApiError } from '@/lib/api';
import { LoadError } from '@/components/ui/states';

const tabs = [
  { href: '/configuracoes/empresa', label: 'Empresa', perm: 'settings:admin' },
  { href: '/configuracoes/identidade-visual', label: 'Identidade visual', perm: 'settings:admin' },
  { href: '/configuracoes/dominio', label: 'Domínio próprio', perm: 'settings:admin' },
  { href: '/configuracoes/usuarios', label: 'Usuários', perm: 'users:admin' },
  { href: '/configuracoes/equipes', label: 'Equipes', perm: 'users:admin' },
  { href: '/configuracoes/perfis', label: 'Perfis e permissões', perm: 'users:admin' },
  { href: '/configuracoes/funis', label: 'Funis', perm: 'pipelines:admin' },
  { href: '/configuracoes/campos', label: 'Campos', perm: 'pipelines:admin' },
  { href: '/configuracoes/motivos', label: 'Ganho e perda', perm: 'pipelines:admin' },
  { href: '/configuracoes/produtos', label: 'Produtos', perm: 'products:admin' },
  { href: '/configuracoes/etiquetas', label: 'Etiquetas', perm: 'contacts:delete' },
  { href: '/configuracoes/distribuicao', label: 'Distribuição de leads', perm: 'deals:assign' },
  { href: '/configuracoes/auditoria', label: 'Auditoria', perm: 'audit:view' },
];
/** Áreas que pedem a verificação em duas etapas confirmada (iguais às da API). */
const MFA_PERMS = new Set(['settings:admin', 'users:admin']);

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can, me } = useSession();
  const visible = tabs.filter((t) => can(t.perm) && (t.perm !== 'deals:assign' || me.permissions['deals:assign'] === 'tenant'));
  const current = tabs.find((t) => pathname.startsWith(t.href));
  // Áreas administrativas só abrem com a verificação em duas etapas confirmada.
  const needsMfa = me.mfa.adminRequired && current && MFA_PERMS.has(current.perm) && !me.mfa.verified;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Configurações</h1>
      <nav aria-label="Seções de configurações" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-line px-1">
          {visible.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <li key={t.href}>
                <Link href={t.href} aria-current={active ? 'page' : undefined}
                  className={`flex h-11 items-center border-b-2 px-3 text-sm ${active ? 'border-primary font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'}`}>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {needsMfa ? <LoadError error={new ApiError(403, 'mfa-required', '')} /> : children}
    </div>
  );
}
