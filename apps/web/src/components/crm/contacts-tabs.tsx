'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Subopções de Contatos. */
export function ContactsTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: '/contatos', label: 'Contatos', active: pathname === '/contatos' },
    { href: '/contatos/agendadas', label: 'Ações agendadas', active: pathname.startsWith('/contatos/agendadas') },
  ];
  return (
    <nav aria-label="Subopções de contatos" className="-mt-1 border-b border-line">
      <ul className="flex gap-1">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={t.active ? 'page' : undefined}
              className={`flex h-10 items-center border-b-2 px-3 text-sm ${t.active ? 'border-primary font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'}`}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
