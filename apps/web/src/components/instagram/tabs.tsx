'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/shell/session';

/** Abas do Instagram: Fluxos, Resultados, Mídias, Contatos e Diagnóstico. */
export function InstagramTabs() {
  const pathname = usePathname();
  const { can } = useSession();
  const tabs = [
    { href: '/instagram', label: 'Fluxos', active: pathname === '/instagram' || pathname.startsWith('/instagram/fluxos') },
    { href: '/instagram/resultados', label: 'Resultados', active: pathname.startsWith('/instagram/resultados') },
    { href: '/instagram/midias', label: 'Mídias', active: pathname.startsWith('/instagram/midias') },
    ...(can('contacts:view') ? [{ href: '/instagram/contatos', label: 'Contatos', active: pathname.startsWith('/instagram/contatos') }] : []),
    { href: '/instagram/diagnostico', label: 'Diagnóstico', active: pathname.startsWith('/instagram/diagnostico') },
  ];
  return (
    <nav aria-label="Subopções do Instagram" className="-mt-1 overflow-x-auto border-b border-line">
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

/** Ícone colorido de cada gatilho. */
export const TRIGGER_TONE: Record<string, string> = {
  comment: 'bg-[#FDE7F1] text-[#B0185E]',
  dm_keyword: 'bg-info-soft text-info',
  live_comment: 'bg-bad-soft text-bad',
  story_reply: 'bg-accent-soft text-accent',
  story_mention: 'bg-[#EFE7FD] text-[#6B2BD9]',
  reaction: 'bg-warn-soft text-warn',
};
