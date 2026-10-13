'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Filtros de lista guardados no endereço: voltar para a lista mantém a busca,
 * e o link pode ser compartilhado. Atualiza sem recarregar a página.
 */
export function useQueryState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const read = useCallback(() => {
    const out = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v !== null) (out as Record<string, string>)[k] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const [state, setState] = useState<T>(read);
  useEffect(() => setState(read()), [read]);

  const update = useCallback((patch: Partial<T>) => {
    setState((cur) => {
      const next = { ...cur, ...patch };
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) if (v !== '' && v !== defaults[k]) q.set(k, v);
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router]);

  return [state, update];
}

/** Valor que só muda depois de uma pausa na digitação. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
