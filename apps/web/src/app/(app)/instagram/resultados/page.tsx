'use client';
import { Suspense } from 'react';
import { InstagramTabs } from '@/components/instagram/tabs';
import { FlowResults } from '@/components/instagram/flow-results';
import { PageHeader } from '@/components/ui/misc';

export default function InstagramResultsPage() {
  return (
    <Suspense>
      <FlowResults channel="instagram" header={<><PageHeader title="Instagram" subtitle="Quantas pessoas cada fluxo alcançou e onde elas pararam." /><InstagramTabs /></>} />
    </Suspense>
  );
}
