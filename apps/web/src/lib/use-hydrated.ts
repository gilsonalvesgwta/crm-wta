'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * Falso no HTML do servidor e na hidratação; verdadeiro depois. Campos e botões
 * ficam desabilitados até lá, para nada digitado ou clicado antes de a página
 * ficar interativa se perder (ou virar um envio nativo do formulário).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
