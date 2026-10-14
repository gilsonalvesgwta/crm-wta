'use client';
import Link from 'next/link';
import { Mail, MessageCircle, Plus } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { CAMPAIGN_STATUS, type Campaign } from '@/lib/campaigns';
import { useSession } from '@/components/shell/session';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { LoadError, Loading } from '@/components/ui/states';

export default function CampaignsPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useLoad(() => api<{ items: Campaign[] }>('GET', '/api/v1/campaigns'));
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Campanhas" subtitle="Mensagens de WhatsApp e e-mail em massa para um público escolhido."
        actions={can('campaigns:edit') ? (
          <Link href="/campanhas/nova" className="inline-flex h-10 items-center gap-2 rounded-[6px] bg-primary px-4 text-sm font-semibold text-primary-fg hover:opacity-90">
            <Plus size={16} aria-hidden />Nova campanha
          </Link>
        ) : undefined} />
      <Panel title="Todas as campanhas">
        {error ? <LoadError error={error} retry={reload} /> : loading && !data ? <Loading /> : data!.items.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma campanha ainda. Crie a primeira em &ldquo;Nova campanha&rdquo;.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5" tabIndex={0} role="region" aria-label="Campanhas">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th className="py-2 pr-3 font-medium">Campanha</th><th className="py-2 pr-3 font-medium">Canal</th>
                  <th className="py-2 pr-3 font-medium">Estado</th><th className="py-2 pr-3 font-medium">Envio</th>
                  <th className="py-2 font-medium">Criada</th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map((c) => {
                  const pct = c.stats.total ? Math.round(((c.stats.sent + c.stats.failed + c.stats.skipped) / c.stats.total) * 100) : 0;
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3"><Link href={`/campanhas/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                        {c.description ? <p className="max-w-[320px] truncate text-[13px] text-muted">{c.description}</p> : null}</td>
                      <td className="py-2.5 pr-3"><span className="inline-flex items-center gap-1.5">{c.channel === 'email' ? <Mail size={14} aria-hidden /> : <MessageCircle size={14} aria-hidden />}{c.channel === 'email' ? 'E-mail' : 'WhatsApp'}</span></td>
                      <td className="py-2.5 pr-3"><Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge></td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{c.stats.total ? `${c.stats.sent} de ${c.stats.total} (${pct}%)` : c.scheduledAt && c.status === 'scheduled' ? dateTime.format(new Date(c.scheduledAt)) : '—'}</td>
                      <td className="py-2.5 whitespace-nowrap text-muted">{dateTime.format(new Date(c.createdAt))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
