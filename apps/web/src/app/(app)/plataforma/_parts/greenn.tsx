'use client';
import { useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LoadError, Loading } from '@/components/ui/states';

type Event = {
  id: string; receivedAt: string; eventType: string | null; status: string | null; externalProduct: string | null;
  externalSale: string | null; externalContract: string | null; customerEmail: string | null;
  action: string; detail: string | null; tenantId: string | null; tenantName: string | null;
};
type Info = { configured: boolean; url: string | null; events: Event[] };

const ACTION: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  created: { label: 'Empresa criada', tone: 'ok' },
  renewed: { label: 'Renovada', tone: 'ok' },
  activated: { label: 'Ativada', tone: 'ok' },
  canceled: { label: 'Cancelada', tone: 'warn' },
  deactivated: { label: 'Desativada', tone: 'bad' },
  ignored: { label: 'Ignorado', tone: 'neutral' },
  unmatched: { label: 'Produto sem plano', tone: 'warn' },
  invalid: { label: 'Inválido', tone: 'bad' },
};

export function GreennTab() {
  const { data, error, loading, reload } = useLoad(() => api<Info>('GET', '/api/v1/platform/greenn'));
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  if (error) return <LoadError error={error} retry={reload} />;
  if (!data) return <Loading />;
  const masked = data.url ? data.url.replace(/[^/]+$/, (s) => '•'.repeat(Math.min(s.length, 24))) : '';

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Webhook da Greenn" description="A Greenn avisa o CRM de cada compra paga, renovação, cancelamento e reembolso. O CRM ativa, renova ou suspende a empresa sozinho.">
        {!data.configured || !data.url ? (
          <Alert tone="info">
            Falta o segredo do webhook. No Portainer, na stack <span className="font-mono">crmwta</span>, crie a variável
            <span className="font-mono"> SEGREDO_DA_GREENN</span> com uma senha longa (de 16 a 200 letras, números, hífen ou sublinhado; 32 ou mais é o ideal) e clique em Update the stack.
            O endereço aparece aqui depois.
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Endereço para cadastrar na Greenn</span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-[6px] border border-line bg-surface-2 px-3 py-2.5 text-[13px]">{show ? data.url : masked}</code>
                <Button variant="secondary" onClick={() => setShow(!show)} aria-label={show ? 'Esconder endereço' : 'Mostrar endereço'}>
                  {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                </Button>
                <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(data.url!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  <Copy size={16} aria-hidden />{copied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
              <p className="text-[13px] text-muted">O final do endereço é a senha do webhook: não compartilhe. Para trocá-la, mude SEGREDO_DA_GREENN na stack e atualize o endereço na Greenn.</p>
            </div>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
              <li>Na Greenn, abra o produto (ou Configurações › Webhooks/Postback) e adicione este endereço.</li>
              <li>Marque os eventos de venda (paga, reembolsada, chargeback) e de assinatura (paga, atrasada, cancelada).</li>
              <li>Na aba Planos, ligue o código de cada produto da Greenn ao plano que ele vende.</li>
              <li>Faça uma compra de teste: o aviso aparece abaixo, e o comprador recebe o convite para criar a senha.</li>
            </ol>
          </div>
        )}
      </Panel>

      <Panel title="Avisos recebidos" description="Os 100 mais recentes. Avisos repetidos são aplicados uma vez só."
        actions={<Button variant="secondary" loading={loading} onClick={() => void reload()}><RefreshCw size={16} aria-hidden />Atualizar</Button>}>
        {data.events.length === 0 ? <p className="text-muted">Nenhum aviso recebido ainda.</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th className="py-2 pr-3 font-medium">Recebido</th><th className="py-2 pr-3 font-medium">Evento</th>
                  <th className="py-2 pr-3 font-medium">Produto</th><th className="py-2 pr-3 font-medium">Comprador</th>
                  <th className="py-2 pr-3 font-medium">Resultado</th><th className="py-2 font-medium">Empresa</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => {
                  const a = ACTION[e.action] ?? { label: e.action, tone: 'neutral' as const };
                  return (
                    <tr key={e.id} className="border-b border-line align-top last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">{dateTime.format(new Date(e.receivedAt))}</td>
                      <td className="py-2 pr-3">{[e.eventType, e.status].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="py-2 pr-3 font-mono">{e.externalProduct ?? '—'}</td>
                      <td className="py-2 pr-3">{e.customerEmail ?? '—'}</td>
                      <td className="py-2 pr-3"><Badge tone={a.tone}>{a.label}</Badge>{e.detail ? <p className="mt-1 text-[12px] text-muted">{e.detail}</p> : null}</td>
                      <td className="py-2">{e.tenantName ?? '—'}</td>
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
