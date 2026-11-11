'use client';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { CAMPAIGN_STATUS, type Campaign } from '@/lib/campaigns';
import { useSession } from '@/components/shell/session';
import { WhatsappTabs } from '@/components/instagram/wa-tabs';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Empty, LoadError, Loading } from '@/components/ui/states';

/** Transmissões: campanhas do WhatsApp oficial que rodam um fluxo (modelo com botões e o que cada clique responde). */
export default function WhatsappBroadcastsPage() {
  const { can } = useSession();
  const list = useLoad(() => api<{ items: Campaign[] }>('GET', '/api/v1/campaigns'));
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  const items = (list.data?.items ?? []).filter((c) => c.flowId);
  const newLink = can('campaigns:edit') ? (
    <Link href="/campanhas/nova?tipo=transmissao" className="inline-flex h-10 items-center gap-1.5 rounded-[6px] bg-primary px-4 text-sm font-semibold text-primary-fg"><Plus size={16} aria-hidden />Nova transmissão</Link>
  ) : undefined;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="WhatsApp" subtitle="Mensagens em massa pela API oficial: o modelo aprovado chega a todos e cada botão continua a conversa." actions={newLink} />
      <WhatsappTabs />
      <Panel title="Transmissões" description="Público, ritmo, agendamento e aprovação são os mesmos das Campanhas.">
        {list.error ? <LoadError error={list.error} retry={list.reload} /> : list.loading && !list.data ? <Loading /> : !items.length ? (
          <Empty title="Nenhuma transmissão ainda" action={newLink}>
            Crie um fluxo de transmissão na aba Fluxos, publique e depois envie para o público que quiser.
          </Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5" tabIndex={0} role="region" aria-label="Transmissões">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3 font-medium">Transmissão</th><th className="py-2 pr-3 font-medium">Fluxo</th><th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 text-right font-medium">Enviadas</th><th className="py-2 pr-3 text-right font-medium">Entregues</th><th className="py-2 pr-3 text-right font-medium">Lidas</th>
                  <th className="py-2 pr-3 text-right font-medium">Tocaram num botão</th><th className="py-2 font-medium">Criada</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3"><Link href={`/campanhas/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td>
                    <td className="py-2.5 pr-3">{c.flow ? <Link href={`/whatsapp/fluxos/${c.flow.id}`} className="text-muted hover:underline">{c.flow.name}</Link> : '—'}</td>
                    <td className="py-2.5 pr-3"><Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge></td>
                    <td className="py-2.5 pr-3 text-right">{c.stats.sent.toLocaleString('pt-BR')}</td>
                    <td className="py-2.5 pr-3 text-right">{c.stats.delivered.toLocaleString('pt-BR')}</td>
                    <td className="py-2.5 pr-3 text-right">{c.stats.read.toLocaleString('pt-BR')}</td>
                    <td className="py-2.5 pr-3 text-right">{(c.flowStats?.clicked ?? 0).toLocaleString('pt-BR')}</td>
                    <td className="whitespace-nowrap py-2.5 text-muted">{dateTime.format(new Date(c.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
