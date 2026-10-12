import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/shell/session';
import { AppShell } from '@/components/shell/app-shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
