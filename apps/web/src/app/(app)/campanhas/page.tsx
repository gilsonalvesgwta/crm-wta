'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Mail, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { CAMPAIGN_STATUS, type Campaign } from '@/lib/campaigns';
import { useSession } from '@/components/shell/session';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

export default function CampaignsPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useLoad(() => api<{ items: Campaign[] }>('GET', '/api/v1/campaigns'));
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  const edit = can('campaigns:edit');
  // Em andamento ou pausada não se exclui (cancele antes).
  const deletable = (c: Campaign) => c.status !== 'sending' && c.status !== 'paused';
  const items = data?.items ?? [];
  const selectable = items.filter(deletable);
  const allPicked = selectable.length > 0 && selectable.every((c) => picked.includes(c.id));

  async function remove(ids: string[]) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ deleted: number; kept: string[] }>('POST', '/api/v1/campaigns/bulk-delete', { ids });
      setMsg({ tone: 'success', text: `${r.deleted} campanha(s) excluída(s).${r.kept.length ? ` ${r.kept.length} em andamento ou pausada(s) ficaram (cancele antes de excluir).` : ''}` });
      setPicked([]);
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.title : 'Não foi possível excluir.' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Campanhas" subtitle="Mensagens de WhatsApp e e-mail em massa para um público escolhido."
        actions={can('campaigns:edit') ? (
          <Link href="/campanhas/nova" className="inline-flex h-10 items-center gap-2 rounded-[6px] bg-primary px-4 text-sm font-semibold text-primary-fg hover:opacity-90">
            <Plus size={16} aria-hidden />Nova campanha
          </Link>
        ) : undefined} />
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Panel title="Todas as campanhas" actions={edit && picked.length ? (
        <Button variant="danger" onClick={() => setConfirm(picked)}><Trash2 size={15} aria-hidden />Excluir {picked.length} selecionada(s)</Button>
      ) : edit && items.some((c) => c.status === 'draft') ? (
        <Button variant="secondary" onClick={() => setPicked(items.filter((c) => c.status === 'draft').map((c) => c.id))}>Selecionar rascunhos</Button>
      ) : undefined}>
        {error ? <LoadError error={error} retry={reload} /> : loading && !data ? <Loading /> : data!.items.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma campanha ainda. Crie a primeira em &ldquo;Nova campanha&rdquo;.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5" tabIndex={0} role="region" aria-label="Campanhas">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  {edit ? (
                    <th className="w-8 py-2 pr-2"><input type="checkbox" aria-label="Selecionar todas" className="size-4 accent-[var(--primary)]" checked={allPicked}
                      onChange={(e) => setPicked(e.target.checked ? selectable.map((c) => c.id) : [])} /></th>
                  ) : null}
                  <th className="py-2 pr-3 font-medium">Campanha</th><th className="py-2 pr-3 font-medium">Canal</th>
                  <th className="py-2 pr-3 font-medium">Estado</th><th className="py-2 pr-3 font-medium">Envio</th>
                  <th className="py-2 font-medium">Criada</th>
                  {edit ? <th className="w-10 py-2"><span className="sr-only">Excluir</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {data!.items.map((c) => {
                  const pct = c.stats.total ? Math.round(((c.stats.sent + c.stats.failed + c.stats.skipped) / c.stats.total) * 100) : 0;
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      {edit ? (
                        <td className="py-2.5 pr-2"><input type="checkbox" aria-label={`Selecionar ${c.name}`} className="size-4 accent-[var(--primary)]" disabled={!deletable(c)}
                          checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} /></td>
                      ) : null}
                      <td className="py-2.5 pr-3"><Link href={`/campanhas/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                        {c.description ? <p className="max-w-[320px] truncate text-[13px] text-muted">{c.description}</p> : null}</td>
                      <td className="py-2.5 pr-3"><span className="inline-flex items-center gap-1.5">{c.channel === 'email' ? <Mail size={14} aria-hidden /> : <MessageCircle size={14} aria-hidden />}{c.channel === 'email' ? 'E-mail' : 'WhatsApp'}</span></td>
                      <td className="py-2.5 pr-3"><Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge></td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{c.stats.total ? `${c.stats.sent} de ${c.stats.total} (${pct}%)` : c.scheduledAt && c.status === 'scheduled' ? dateTime.format(new Date(c.scheduledAt)) : '—'}</td>
                      <td className="py-2.5 whitespace-nowrap text-muted">{dateTime.format(new Date(c.createdAt))}</td>
                      {edit ? (
                        <td className="py-2.5 text-right">
                          {deletable(c) ? (
                            <button type="button" aria-label={`Excluir ${c.name}`} title="Excluir" onClick={() => setConfirm([c.id])}
                              className="inline-flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-bad-soft hover:text-bad"><Trash2 size={15} aria-hidden /></button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Confirm open={!!confirm} title={confirm?.length === 1 ? `Excluir “${items.find((c) => c.id === confirm[0])?.name ?? 'campanha'}”?` : `Excluir ${confirm?.length ?? 0} campanhas?`}
        confirmLabel="Excluir" loading={busy} onConfirm={() => confirm && void remove(confirm)} onCancel={() => setConfirm(null)}>
        A campanha some da lista com o relatório. As mensagens já enviadas continuam nas conversas de cada contato.
      </Confirm>
    </div>
  );
}
