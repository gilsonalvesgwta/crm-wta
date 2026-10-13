import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { themeCss } from '@/lib/theme';
import { serverBranding } from '@/lib/brand-server';
import { BrandProvider } from '@/components/brand/brand-context';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const b = await serverBranding();
  const name = b?.customized || b?.tenantName ? b.productName : 'CRM WTA';
  return {
    title: { default: name, template: `%s · ${name}` },
    description: 'Vendas, atendimento e automações no mesmo lugar.',
    robots: { index: false, follow: false },
    ...(b?.iconUrl ? { icons: { icon: b.iconUrl } } : {}),
  };
}

/** Tema da empresa (da sessão ou do domínio próprio), aplicado já no primeiro HTML, sem piscar o padrão. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const branding = await serverBranding();
  const css = branding ? themeCss(branding) : '';
  return (
    <html lang="pt-BR" data-theme={branding?.theme.mode ?? 'light'} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>{css ? <style id="tema-da-empresa" dangerouslySetInnerHTML={{ __html: css }} /> : null}</head>
      <body><BrandProvider value={branding}>{children}</BrandProvider></body>
    </html>
  );
}
