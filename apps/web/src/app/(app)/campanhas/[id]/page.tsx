'use client';
import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Copy, Mail, MessageCircle, Pause, Pencil, Play, Trash2, XCircle } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { dateTime } from '@/lib/admin-types';
import { phone, type Page } from '@/lib/crm';
import { CAMPAIGN_STATUS, RECIPIENT_STATUS, type Campaign, type Recipient } from '@/lib/campaigns';
import { useSession } from '@/components/shell/session';
import { CampaignWizard } from '@/components/crm/campaign-wizard';
import { PageHeader, Pagination } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><CampaignView id={id} /></Suspense>;
}

function CampaignView({ id }: { id: string }) {
  const { can } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const [c, setC] = useState<Campaign | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(search.get('salva') ? 'Rascunho salvo.' : null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setC(await api<Campaign>('GET', `/api/v1/campaigns/${id}`)); setErr(null); } catch (e) { setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível abrir.')); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const live = c?.status === 'sending' || c?.status === 'scheduled';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [live, load]);

  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  if (err) return <LoadError error={err} retry={load} />;
  if (!c) return <Loading />;

  if (c.status === 'draft' || editing) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader title={c.status === 'draft' ? 'Campanha (rascunho)' : 'Editar campanha'} subtitle={c.name} back={{ href: '/campanhas', label: 'Campanhas' }} />
        {msg ? <Alert tone="success">{msg}</Alert> : null}
        {can('campaigns:edit') ? <CampaignWizard initial={c} /> : <Alert tone="info">Você pode ver, mas não editar campanhas.</Alert>}
      </div>
    );
  }

  async function act(action: 'pause' | 'resume' | 'cancel' | 'duplicate' | 'delete') {
    setBusy(action);
    setActErr(null);
    try {
      if (action === 'duplicate') {
        const d = await api<Campaign>('POST', `/api/v1/campaigns/${id}/duplicate`);
        router.push(`/campanhas/${d.id}`);
        return;
      }
      if (action === 'delete') {
        await api('DELETE', `/api/v1/campaigns/${id}`);
        router.push('/campanhas');
        return;
      }
      setC(await api<Campaign>('POST', `/api/v1/campaigns/${id}/${action}`));
      setMsg(action === 'pause' ? 'Campanha pausada.' : action === 'resume' ? 'Envio retomado.' : 'Campanha cancelada.');
    } catch (e) {
      setActErr(e instanceof ApiError ? e.title : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
    }
  }

  const s = c.stats;
  const processed = s.sent + s.failed + s.skipped;
  const pct = s.total ? Math.round((processed / s.total) * 100) : 0;
  const approve = can('campaigns:approve');
  const cards: [string, number, string?][] = [
    ['Público', s.total], ['Enviadas', s.sent], ['Entregues', s.delivered], ['Lidas', s.read], ['Respostas', s.replied],
    ['Falharam', s.failed], ['Não enviadas', s.skipped, 'Pediram para sair, cancelada ou sem contato'],
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader back={{ href: '/campanhas', label: 'Campanhas' }}
        title={<span className="flex flex-wrap items-center gap-3">{c.name}<Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge></span>}
        subtitle={<span className="inline-flex items-center gap-1.5">{c.channel === 'email' ? <Mail size={14} aria-hidden /> : <MessageCircle size={14} aria-hidden />}
          {c.channel === 'email' ? 'E-mail' : 'WhatsApp'}{c.account ? ` · ${c.account.name}` : ''}{c.description ? ` · ${c.description}` : ''}</span>}
        actions={<div className="flex flex-wrap gap-2">
          {approve && c.status === 'scheduled' ? <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden />Editar</Button> : null}
          {approve && (c.status === 'sending' || c.status === 'scheduled') ? <Button variant="secondary" loading={busy === 'pause'} onClick={() => void act('pause')}><Pause size={16} aria-hidden />Pausar</Button> : null}
          {approve && c.status === 'paused' ? <Button loading={busy === 'resume'} onClick={() => void act('resume')}><Play size={16} aria-hidden />Retomar</Button> : null}
          {can('campaigns:edit') ? <Button variant="secondary" loading={busy === 'duplicate'} onClick={() => void act('duplicate')}><Copy size={16} aria-hidden />Duplicar</Button> : null}
          {approve && ['scheduled', 'sending', 'paused'].includes(c.status) ? <Button variant="danger" onClick={() => setConfirm('cancel')}><XCircle size={16} aria-hidden />Cancelar</Button> : null}
          {can('campaigns:edit') && (c.status === 'done' || c.status === 'canceled') ? <Button variant="ghost" aria-label="Excluir campanha" onClick={() => setConfirm('delete')}><Trash2 size={16} aria-hidden /></Button> : null}
        </div>} />
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {actErr ? <Alert tone="error">{actErr}</Alert> : null}
      {c.status === 'paused' && c.lastError ? <Alert tone="error">Pausada sozinha: {c.lastError} Resolva e clique em Retomar.</Alert> : null}
      {c.status === 'scheduled' && c.scheduledAt ? <Alert tone="info">Envio marcado para {dateTime.format(new Date(c.scheduledAt))}.</Alert> : null}

      <Panel title="Andamento" description={c.startedAt ? `Começou ${dateTime.format(new Date(c.startedAt))}${c.finishedAt ? `, terminou ${dateTime.format(new Date(c.finishedAt))}` : ''}. Ritmo: ${c.perMinute} por minuto${c.windowStart ? `, das ${c.windowStart} às ${c.windowEnd}` : ''}.` : undefined}>
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex justify-between text-[13px]"><span>{processed} de {s.total} processadas</span><span className="font-semibold">{pct}%</span></div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Andamento do envio" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {cards.map(([label, n, hint]) => (
              <div key={label} className="rounded-[10px] border border-line p-3" title={hint}>
                <dt className="text-[12px] text-muted">{label}</dt>
                <dd className="text-xl font-semibold">{n}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      <Recipients id={id} version={processed} />

      <Panel title="Mensagem">
        {c.subject ? <p className="mb-1 font-semibold">{c.subject}</p> : null}
        <p className="whitespace-pre-wrap text-sm">{c.body}</p>
      </Panel>

      <Confirm open={confirm === 'cancel'} title="Cancelar a campanha?" confirmLabel="Cancelar campanha"
        onConfirm={() => { setConfirm(null); void act('cancel'); }} onCancel={() => setConfirm(null)}>
        Quem ainda não recebeu não recebe mais. O que já foi enviado continua no histórico.
      </Confirm>
      <Confirm open={confirm === 'delete'} title="Excluir a campanha?" confirmLabel="Excluir"
        onConfirm={() => { setConfirm(null); void act('delete'); }} onCancel={() => setConfirm(null)}>
        O relatório some. As mensagens enviadas continuam no histórico dos contatos.
      </Confirm>
    </div>
  );
}

function Recipients({ id, version }: { id: string; version: number }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Recipient> | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (status) qs.set('status', status);
    api<Page<Recipient>>('GET', `/api/v1/campaigns/${id}/recipients?${qs}`).then(setData).catch(() => setData(null));
  }, [id, status, page, version]);
  return (
    <Panel title="Destinatários">
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Filtrar destinatários" className="flex flex-wrap gap-1">
          {[['', 'Todos'], ['sent', 'Enviadas'], ['pending', 'Na fila'], ['failed', 'Falharam'], ['skipped', 'Não enviadas']].map(([v, label]) => (
            <button key={v} type="button" aria-pressed={status === v} onClick={() => { setStatus(v!); setPage(1); }}
              className={`h-8 rounded-full px-3 text-[13px] font-medium ${status === v ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        {!data ? <Loading /> : data.items.length === 0 ? <p className="text-[13px] text-muted">Ninguém aqui.</p> : (
          <>
            <ul className="flex flex-col">
              {data.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm first:border-t-0">
                  <span className="min-w-0"><Link href={`/contatos/${r.contactId}`} className="font-medium hover:underline">{r.name}</Link>
                    <span className="ml-2 text-[13px] text-muted">{r.address.startsWith('+') ? phone(r.address) : r.address}</span></span>
                  <span className="text-[13px] text-muted">
                    {RECIPIENT_STATUS[r.status]}{r.messageStatus === 'read' ? ' · lida' : r.messageStatus === 'delivered' ? ' · entregue' : ''}
                    {r.sentAt ? ` · ${dateTime.format(new Date(r.sentAt))}` : ''}{r.reason ? ` · ${r.reason}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </Panel>
  );
}
