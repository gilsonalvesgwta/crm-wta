'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CircleCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { TRIGGER_TITLE, type IgAccount, type TriggerType } from '@/lib/instagram';
import { useSession } from '@/components/shell/session';
import { InstagramTabs } from '@/components/instagram/tabs';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Empty, LoadError, Loading } from '@/components/ui/states';

type Diag = {
  account: { id: string; name: string; igUserId: string };
  webhook: { url: string; verifyToken?: string };
  subscribed: string[] | null; missing: string[]; error: string | null;
  events: { id: number; kind: string; summary: string | null; outcome: string | null; createdAt: string; flow: { id: string; name: string } | null }[];
  activeFlows: { trigger: TriggerType; n: number }[];
};

const FIELD_LABEL: Record<string, string> = {
  messages: 'Mensagens no direct (inclui respostas e menções em story)', messaging_postbacks: 'Cliques em botões', message_reactions: 'Reações a mensagens',
  comments: 'Comentários em posts e reels', live_comments: 'Comentários em lives', mentions: 'Menções',
};
const KIND_LABEL: Record<string, string> = {
  comment: 'Comentário', live_comment: 'Comentário em live', message: 'Mensagem', postback: 'Clique', reaction: 'Reação',
  story_reply: 'Resposta a story', story_mention: 'Menção em story', quick_reply: 'Resposta rápida',
};

export default function InstagramDiagnosticsPage() {
  const { can } = useSession();
  const accounts = useLoad(() => api<IgAccount[]>('GET', '/api/v1/instagram/accounts'));
  const [acc, setAcc] = useState('');
  const accountId = acc || accounts.data?.[0]?.id || '';
  const diag = useLoad(() => accountId ? api<Diag>('GET', `/api/v1/instagram/diagnostics?accountId=${accountId}`) : Promise.resolve(null), [accountId]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;

  async function fix() {
    setBusy(true);
    setErr(null);
    try {
      diag.setData(await api<Diag>('POST', '/api/v1/instagram/diagnostics/subscribe', { accountId }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível ativar.');
    } finally {
      setBusy(false);
    }
  }

  const d = diag.data;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Instagram" subtitle="Confira se o Instagram está avisando o CRM e o que aconteceu com cada aviso." />
      <InstagramTabs />
      {accounts.error ? <LoadError error={accounts.error} retry={accounts.reload} /> : !accounts.data ? <Loading /> : !accounts.data.length ? (
        <Empty title="Nenhuma conta do Instagram" action={<Link href="/configuracoes/canais" className="inline-flex h-10 items-center rounded-[6px] bg-primary px-4 text-sm font-semibold text-primary-fg">Ir para Canais</Link>}>
          Conecte uma conta em Configurações › Canais.
        </Empty>
      ) : (
        <>
          {accounts.data.length > 1 ? (
            <Select className="max-w-xs" label="Conta" value={accountId} onChange={(e) => setAcc(e.target.value)}>
              {accounts.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          ) : null}
          {diag.error ? <LoadError error={diag.error} retry={diag.reload} /> : !d ? <Loading /> : (
            <>
              <Panel title="Avisos do Instagram" description="Os fluxos só funcionam com estes avisos ativos na conta."
                actions={<Button variant="secondary" onClick={() => void diag.reload()}><RefreshCw size={15} aria-hidden />Conferir de novo</Button>}>
                <div className="flex flex-col gap-3">
                  {d.error ? <Alert tone="error">Não foi possível consultar a Meta: {d.error}</Alert> : null}
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {Object.keys(FIELD_LABEL).map((f) => {
                      const ok = !d.missing.includes(f);
                      return (
                        <li key={f} className="flex items-start gap-2 text-[13px]">
                          {ok ? <CircleCheck size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden /> : <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />}
                          <span><span className="font-medium">{FIELD_LABEL[f]}</span> <span className="text-muted">({ok ? 'ativo' : 'desligado'})</span></span>
                        </li>
                      );
                    })}
                  </ul>
                  {d.missing.length && can('campaigns:edit') ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button loading={busy} onClick={fix}>Ativar os avisos que faltam</Button>
                      <span className="text-[13px] text-muted">Se não ativar, confira no app da Meta os campos do webhook e a permissão de comentários (veja o guia em Configurações › Canais).</span>
                    </div>
                  ) : null}
                  {err ? <Alert tone="error">{err}</Alert> : null}
                  <p className="text-[13px] text-muted">Endereço do webhook: <code className="break-all rounded bg-surface-2 px-1.5 py-0.5 text-xs">{d.webhook.url}</code></p>
                  <p className="text-[13px] text-muted">Fluxos ativos nesta conta: {d.activeFlows.length ? d.activeFlows.map((f) => `${TRIGGER_TITLE[f.trigger]} (${f.n})`).join(', ') : 'nenhum'}.</p>
                </div>
              </Panel>
              <Panel title="Últimos avisos recebidos" description="Os 50 mais recentes desta conta e o que o CRM fez com cada um.">
                {!d.events.length ? <p className="text-[13px] text-muted">Nenhum aviso ainda. Comente num post ou mande um direct para a conta e clique em “Conferir de novo”.</p> : (
                  <div className="-mx-5 overflow-x-auto px-5" tabIndex={0} role="region" aria-label="Últimos avisos">
                    <table className="w-full min-w-[640px] text-left text-[13px]">
                      <thead><tr className="border-b border-line text-muted"><th className="py-2 pr-3 font-medium">Quando</th><th className="py-2 pr-3 font-medium">Tipo</th><th className="py-2 pr-3 font-medium">Conteúdo</th><th className="py-2 font-medium">Resultado</th></tr></thead>
                      <tbody>
                        {d.events.map((e) => (
                          <tr key={e.id} className="border-b border-line align-top last:border-0">
                            <td className="whitespace-nowrap py-2 pr-3 text-muted">{dateTime.format(new Date(e.createdAt))}</td>
                            <td className="py-2 pr-3">{KIND_LABEL[e.kind] ?? e.kind}</td>
                            <td className="max-w-[260px] truncate py-2 pr-3 text-muted">{e.summary ?? '—'}</td>
                            <td className="py-2">{e.flow ? <Link href={`/instagram/fluxos/${e.flow.id}`} className="font-medium hover:underline">{e.flow.name}</Link> : null}{e.flow && e.outcome ? ' — ' : ''}{e.outcome ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
