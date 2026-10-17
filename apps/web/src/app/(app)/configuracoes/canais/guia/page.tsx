'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state';
import { GuideTabs, MetaGuide, type GuideKind } from '@/components/crm/meta-guide';
import { Button } from '@/components/ui/button';

export default function GuidePage() {
  return <Suspense><Guide /></Suspense>;
}

function Guide() {
  const [f, setF] = useQueryState({ canal: 'whatsapp' });
  const kind: GuideKind = f.canal === 'instagram' ? 'instagram' : 'whatsapp';
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/configuracoes/canais" className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink print:hidden"><ArrowLeft size={14} aria-hidden />Canais</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Passo a passo: {kind === 'instagram' ? 'Instagram' : 'WhatsApp oficial (API da Meta)'}</h2>
          <p className="text-[13px] text-muted">Deixe esta aba aberta ao lado do site da Meta e marque cada passo como feito.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <GuideTabs kind={kind} onChange={(k) => setF({ canal: k })} />
          <Button variant="secondary" onClick={() => window.print()}><Printer size={16} aria-hidden />Imprimir</Button>
        </div>
      </div>
      <MetaGuide kind={kind} />
    </div>
  );
}
