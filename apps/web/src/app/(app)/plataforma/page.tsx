'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useSession } from '@/components/shell/session';
import { LoadError } from '@/components/ui/states';
import { TenantsTab } from './_parts/tenants';
import { PlansTab } from './_parts/plans';
import { GreennTab } from './_parts/greenn';
import { BackupsTab } from './_parts/backups';

const TABS = [
  { key: 'empresas', label: 'Empresas' },
  { key: 'planos', label: 'Planos' },
  { key: 'greenn', label: 'Greenn' },
  { key: 'copias', label: 'Backups' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function PlatformPage() {
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>('empresas');
  if (!me.user.isPlatformAdmin) return <LoadError error={new ApiError(404, 'not-found', '')} />;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Plataforma</h1>
        <p className="text-muted">Empresas clientes, planos, cobrança e cópias de segurança. Daqui não se veem os dados das empresas.</p>
      </div>
      <div role="tablist" aria-label="Seções da plataforma" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`flex h-11 items-center border-b-2 px-3 text-sm ${tab === t.key ? 'border-primary font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'empresas' ? <TenantsTab /> : tab === 'planos' ? <PlansTab /> : tab === 'greenn' ? <GreennTab /> : <BackupsTab />}
      </div>
    </div>
  );
}
