'use client';
import Link from 'next/link';
import type { OddName } from '@/lib/campaigns';

/** Aviso dos contatos com nome estranho no cadastro ("sem nome", números, frase), com link para corrigir. */
export function OddNames({ items, total }: { items: OddName[]; total: number }) {
  if (!total) return null;
  return (
    <details className="rounded-[8px] border border-warn/40 bg-warn-soft px-3 py-2 text-[13px]">
      <summary className="cursor-pointer font-medium text-ink">{total} contato(s) com nome que não parece nome no cadastro</summary>
      <p className="mt-1.5 text-ink">
        Nesses casos o CRM deixa o nome em branco (“Olá, tudo bem?”). Para usar outra palavra, escreva a variável com uma alternativa:
        {' '}<code className="rounded bg-surface px-1 font-mono">{'{{primeiro_nome|cliente}}'}</code>. Ou corrija o cadastro pelo link.
      </p>
      <ul className="mt-1.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/contatos/${m.id}`} target="_blank" className="underline">{m.name || '(vazio)'}</Link>
            <span className="text-[12px] text-ink">({m.problem})</span>
          </li>
        ))}
      </ul>
      {total > items.length ? <p className="mt-1 text-ink">Mostrando {items.length} de {total}.</p> : null}
    </details>
  );
}
