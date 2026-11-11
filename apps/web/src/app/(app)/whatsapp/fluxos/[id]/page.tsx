'use client';
import { use, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Flow } from '@/lib/instagram';
import { useSession } from '@/components/shell/session';
import { FlowEditor } from '@/components/instagram/flow-editor';
import { LoadError, Loading } from '@/components/ui/states';

export default function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  useEffect(() => {
    api<Flow>('GET', `/api/v1/whatsapp/flows/${id}`).then(setFlow).catch((e) => setLoadError(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível carregar.')));
  }, [id]);
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  if (loadError) return <LoadError error={loadError} />;
  if (!flow) return <Loading />;
  return <FlowEditor initial={flow} readOnly={!can('campaigns:edit')} channel="whatsapp" />;
}
