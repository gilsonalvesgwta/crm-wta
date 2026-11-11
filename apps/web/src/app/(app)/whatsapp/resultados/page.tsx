'use client';
import { Suspense } from 'react';
import { WhatsappTabs } from '@/components/instagram/wa-tabs';
import { FlowResults } from '@/components/instagram/flow-results';
import { PageHeader } from '@/components/ui/misc';

export default function WhatsappResultsPage() {
  return (
    <Suspense>
      <FlowResults channel="whatsapp" header={<><PageHeader title="WhatsApp" subtitle="Quantas pessoas cada fluxo alcançou, quem tocou em cada botão e onde pararam." /><WhatsappTabs /></>} />
    </Suspense>
  );
}
