import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { themeCss, type Branding } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CRM WTA', template: '%s · CRM WTA' },
  description: 'Vendas, atendimento e automações no mesmo lugar.',
  robots: { index: false, follow: false },
};

/** Tema da empresa da sessão, aplicado já no primeiro HTML (sem piscar o padrão). */
async function currentBranding(): Promise<Branding | null> {
  const session = (await cookies()).get('crm_session')?.value;
  if (!session) return null;
  const api = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const r = await fetch(`${api}/api/v1/branding`, {
      headers: { cookie: `crm_session=${session}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    return r.ok ? ((await r.json()) as Branding) : null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const branding = await currentBranding();
  const css = branding ? themeCss(branding) : '';
  return (
    <html lang="pt-BR" data-theme={branding?.theme.mode ?? 'light'} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>{css ? <style id="tema-da-empresa" dangerouslySetInnerHTML={{ __html: css }} /> : null}</head>
      <body>{children}</body>
    </html>
  );
}
