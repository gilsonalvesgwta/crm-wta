'use client';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { phone } from '@/lib/crm';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { LoadError, Loading } from '@/components/ui/states';

type Item = { id: string; kind: string; summary: string | null; outcome: string | null; createdAt: string; flow: { id: string; name: string } | null };
type Res = { account: { id: string; name: string; kind: string; address: string | null }; items: Item[] };

/** Explica, em palavras, o resultado de cada mensagem. */
function explain(o: string | null): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!o) return { text: 'Processando…', tone: 'muted' };
  if (/^fluxo "/.test(o)) return { text: `Começou o ${o}`, tone: 'ok' };
  if (o === 'nenhum fluxo para este gatilho') return { text: 'Nenhum fluxo ativo com esta palavra-chave', tone: 'warn' };
  if (/já passou por ele/.test(o)) return { text: `${o} (frequência "uma vez por pessoa")`, tone: 'warn' };
  if (/resposta da pergunta|clique|opção|escolheu/.test(o)) return { text: `Continuou um fluxo: ${o}`, tone: 'ok' };
  if (/pediu de novo|fora das opções/.test(o)) return { text: `Esperava uma das opções: ${o}`, tone: 'warn' };
  return { text: o, tone: o.startsWith('erro') ? 'warn' : 'muted' };
}

/** Últimas mensagens recebidas pelo número e o que os fluxos fizeram com cada uma. */
export function FlowActivityDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const r = useLoad(() => api<Res>('GET', `/api/v1/instagram/accounts/${accountId}/events`), [accountId]);
  const qr = r.data?.account.kind === 'whatsapp_evolution';
  return (
    <Dialog open onClose={onClose} width={640} title="Testar e ver o que aconteceu"
      description="As últimas mensagens que chegaram neste número e o que os fluxos fizeram com cada uma."
      footer={<><Button variant="secondary" onClick={() => void r.reload()}><RefreshCw size={15} aria-hidden />Atualizar</Button><Button onClick={onClose}>Fechar</Button></>}>
      <div className="flex flex-col gap-3">
        <Alert tone="info">
          Para testar, mande a palavra-chave <strong>de outro celular</strong> para {r.data?.account.address ? phone(r.data.account.address) : 'o número'}
          {qr ? ', ou na conversa “Você” (mensagem para si mesmo) do próprio celular conectado' : ''}. O fluxo precisa estar <strong>publicado</strong>.
          Mensagem que você manda do celular conectado para um cliente conta como a equipe respondendo e não começa fluxo.
        </Alert>
        {r.error ? <LoadError error={r.error} retry={r.reload} /> : !r.data ? <Loading /> : !r.data.items.length ? (
          <p className="text-[13px] text-muted">Nenhuma mensagem chegou ainda neste número desde que ele foi conectado. Se você mandou e não aparece aqui, confira se o WhatsApp está conectado em Configurações › Canais.</p>
        ) : (
          <ul className="flex max-h-[420px] flex-col divide-y divide-line overflow-y-auto">
            {r.data.items.map((i) => {
              const e = explain(i.outcome);
              return (
                <li key={i.id} className="flex flex-col gap-0.5 py-2 text-[13px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">“{i.summary ?? (i.kind === 'button' ? 'clique em botão' : 'mensagem')}”</span>
                    <span className="shrink-0 text-[12px] text-muted">{dateTime.format(new Date(i.createdAt))}</span>
                  </div>
                  <span className={e.tone === 'ok' ? 'text-ok' : e.tone === 'warn' ? 'text-warn' : 'text-muted'}>{e.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
