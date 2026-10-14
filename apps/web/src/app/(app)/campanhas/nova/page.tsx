'use client';
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
      <CampaignWizard initial={null} />
    </div>
  );
}
