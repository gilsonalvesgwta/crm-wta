'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { Branding } from '@/lib/theme';

/** Marca recebida no primeiro HTML: da empresa da sessão ou do domínio próprio acessado. */
const Ctx = createContext<Branding | null>(null);

export function BrandProvider({ value, children }: { value: Branding | null; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInitialBrand(): Branding | null {
  return useContext(Ctx);
}
