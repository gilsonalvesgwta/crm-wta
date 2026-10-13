import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/shell/session';
import { AppShell } from '@/components/shell/app-shell';
import { CrmDataProvider } from '@/components/crm/data';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CrmDataProvider>
        <AppShell>{children}</AppShell>
      </CrmDataProvider>
    </SessionProvider>
  );
}
