'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronDown, House, LogOut, Menu, Settings, ShieldCheck, UserRound, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from './session';

type Item = { href: string; label: string; icon: ReactNode; show?: boolean };

export function AppShell({ children }: { children: ReactNode }) {
  const { me, branding, can } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  const work: Item[] = [{ href: '/inicio', label: 'Início', icon: <House size={18} strokeWidth={1.75} aria-hidden /> }];
  const admin = ['settings:admin', 'users:admin', 'audit:view'].some(can);
  const tenant = me.tenants.find((t) => t.id === me.tenantId);
  const initials = me.user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  async function logout() {
    await api('POST', '/api/v1/auth/logout').catch(() => undefined);
    router.replace('/entrar');
  }

  const link = (i: Item) => {
    const active = pathname === i.href || pathname.startsWith(i.href + '/');
    return (
      <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}
        className={`flex h-10 items-center gap-3 rounded-[6px] px-3 ${active ? 'bg-side-active font-semibold text-side-active-text [&_svg]:text-side-mark' : 'font-medium text-side-text hover:bg-side-active/60'}`}>
        {i.icon}
        {i.label}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      <nav aria-label="Menu principal"
        className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col gap-[18px] border-r border-side-border bg-side px-3 pb-4 pt-5 text-side-text transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-9 items-center justify-between px-3">
          {branding?.customized
            ? <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-white">{branding.productName}</span>
            : <img src="/brand/wta-marca.svg" alt="WTA" width={106} height={24} className="h-6 w-auto" />}
          <button type="button" className="lg:hidden" aria-label="Fechar menu" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="px-3 pb-1.5 text-xs font-medium text-side-muted">Trabalho</p>
          {work.map(link)}
        </div>
        <div className="mt-auto flex flex-col gap-0.5 border-t border-side-border pt-3">
          {me.user.isPlatformAdmin ? link({ href: '/plataforma', label: 'Plataforma', icon: <Building2 size={18} strokeWidth={1.75} aria-hidden /> }) : null}
          {admin && me.tenantId ? link({ href: '/configuracoes', label: 'Configurações', icon: <Settings size={18} strokeWidth={1.75} aria-hidden /> }) : null}
          {link({ href: '/conta', label: 'Minha conta', icon: <UserRound size={18} strokeWidth={1.75} aria-hidden /> })}
        </div>
      </nav>
      {open ? <button type="button" aria-label="Fechar menu" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
          <button type="button" className="flex size-10 items-center justify-center rounded-[6px] border border-line lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="flex-1" />
          {tenant ? (
            me.tenants.length > 1 ? (
              <Link href={`/entrar/empresa?voltar=${encodeURIComponent(pathname)}`}
                className="flex h-10 items-center gap-2 rounded-[6px] border border-line px-3 font-medium hover:bg-surface-2">
                {tenant.name}<ChevronDown size={14} aria-hidden />
              </Link>
            ) : <span className="px-2 font-medium text-muted">{tenant.name}</span>
          ) : null}
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} aria-label={`Menu de ${me.user.name}`} onClick={() => setMenu(!menu)}
              className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
              {initials}
            </button>
            {menu ? (
              <div role="menu" className="absolute right-0 top-12 z-50 w-64 rounded-[10px] border border-line bg-surface p-1.5 shadow-lg">
                <div className="px-3 py-2">
                  <p className="font-medium">{me.user.name}</p>
                  <p className="truncate text-[13px] text-muted">{me.user.email}</p>
                </div>
                <Link role="menuitem" href="/conta" onClick={() => setMenu(false)} className="flex h-10 items-center gap-2.5 rounded-[6px] px-3 hover:bg-surface-2">
                  <ShieldCheck size={16} aria-hidden />Conta e segurança
                </Link>
                <button role="menuitem" type="button" onClick={logout} className="flex h-10 w-full items-center gap-2.5 rounded-[6px] px-3 text-left hover:bg-surface-2">
                  <LogOut size={16} aria-hidden />Sair
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
