'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Abas do WhatsApp oficial: Fluxos, Transmissões, Resultados e Modelos. */
export function WhatsappTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: '/whatsapp', label: 'Fluxos', active: pathname === '/whatsapp' || pathname.startsWith('/whatsapp/fluxos') },
    { href: '/whatsapp/transmissoes', label: 'Transmissões', active: pathname.startsWith('/whatsapp/transmissoes') },
    { href: '/whatsapp/resultados', label: 'Resultados', active: pathname.startsWith('/whatsapp/resultados') },
    { href: '/configuracoes/canais', label: 'Modelos', active: false },
  ];
  return (
    <nav aria-label="Subopções do WhatsApp" className="-mt-1 overflow-x-auto border-b border-line">
      <ul className="flex gap-1">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={t.active ? 'page' : undefined}
              className={`flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-sm ${t.active ? 'border-primary font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'}`}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
