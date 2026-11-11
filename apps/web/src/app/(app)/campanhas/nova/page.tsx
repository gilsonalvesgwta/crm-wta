'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useSession } from '@/components/shell/session';
import { CampaignWizard } from '@/components/crm/campaign-wizard';
import { PageHeader } from '@/components/ui/misc';
import { LoadError } from '@/components/ui/states';

export default function NewCampaignPage() {
  const { can } = useSession();
  if (!can('campaigns:edit')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title="Nova Campanha" subtitle="Criar uma nova campanha de mensagens em massa" back={{ href: '/campanhas', label: 'Campanhas' }} />
      <Suspense><Wizard /></Suspense>
    </div>
  );
}

/** "?fluxo=<id>" (do editor do fluxo) ou "?tipo=transmissao" já começam uma transmissão do WhatsApp oficial. */
function Wizard() {
  const sp = useSearchParams();
  const flowId = sp.get('fluxo');
  return <CampaignWizard initial={null} preset={{ flowId: flowId && /^[0-9a-f-]{36}$/.test(flowId) ? flowId : null, broadcast: sp.get('tipo') === 'transmissao' }} />;
}
