import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import type { Branding } from './theme';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

async function get<T>(path: string, init: Record<string, string>): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { headers: init, cache: 'no-store', signal: AbortSignal.timeout(1500) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Marca para o primeiro HTML. Com sessão, a da empresa da sessão; sem sessão,
 * a da empresa dona do domínio acessado (domínio próprio). Uma busca por requisição.
 */
export const serverBranding = cache(async (): Promise<Branding | null> => {
  const session = (await cookies()).get('crm_session')?.value;
  if (session) {
    const b = await get<Branding>('/api/v1/branding', { cookie: `crm_session=${session}` });
    if (b) return b;
  }
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0]!.trim().replace(/:\d+$/, '').toLowerCase();
  if (!host) return null;
  const p = await get<Branding & { found: boolean }>('/api/v1/public/branding', { 'x-crm-host': host });
  return p?.found ? p : null;
});
