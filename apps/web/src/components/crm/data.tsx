'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { Directory, FieldDef, Pipeline, Product, Reason, TagRef } from '@/lib/crm';

/**
 * Cadastros de apoio usados por várias telas (pessoas, etiquetas, campos,
 * funis, motivos, produtos). Carregados na primeira vez que alguém pede e
 * guardados durante a navegação; quem altera um cadastro chama refresh().
 */
type Key = 'directory' | 'tags' | 'fields' | 'pipelines' | 'reasons' | 'products';
type Values = {
  directory: Directory; tags: (TagRef & { uses: number })[]; fields: FieldDef[]; pipelines: Pipeline[]; reasons: Reason[]; products: Product[];
};
const LOADERS: { [K in Key]: () => Promise<Values[K]> } = {
  directory: () => api('GET', '/api/v1/directory'),
  tags: () => api('GET', '/api/v1/tags'),
  fields: () => api('GET', '/api/v1/custom-fields'),
  pipelines: () => api('GET', '/api/v1/pipelines'),
  reasons: () => api('GET', '/api/v1/outcome-reasons'),
  products: () => api('GET', '/api/v1/products'),
};

type Ctx = {
  values: Partial<Values>;
  request: (k: Key) => void;
  refresh: (k: Key) => Promise<void>;
};
const C = createContext<Ctx | null>(null);

export function CrmDataProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Partial<Values>>({});
  const pending = useRef(new Set<Key>());

  const refresh = useCallback(async (k: Key) => {
    pending.current.add(k);
    try {
      const v = await LOADERS[k]();
      setValues((cur) => ({ ...cur, [k]: v }));
    } catch {
      // Sem permissão ou falha: a tela mostra o que tiver.
      setValues((cur) => ({ ...cur, [k]: cur[k] ?? (k === 'directory' ? { me: '', members: [], teams: [] } : []) }));
    }
  }, []);

  const request = useCallback((k: Key) => {
    if (pending.current.has(k)) return;
    void refresh(k);
  }, [refresh]);

  return <C.Provider value={{ values, request, refresh }}>{children}</C.Provider>;
}

function useData<K extends Key>(k: K): { data: Values[K] | undefined; refresh: () => Promise<void> } {
  const c = useContext(C);
  if (!c) throw new Error('fora do CrmDataProvider');
  const { request, refresh } = c;
  useEffect(() => { request(k); }, [k, request]);
  return { data: c.values[k] as Values[K] | undefined, refresh: () => refresh(k) };
}

export const useDirectory = () => useData('directory');
export const useTags = () => useData('tags');
export const usePipelines = () => useData('pipelines');
export const useReasons = () => useData('reasons');
export const useProducts = () => useData('products');
export function useFields(entity?: FieldDef['entity']) {
  const r = useData('fields');
  return { ...r, data: r.data?.filter((f) => !entity || f.entity === entity) };
}
