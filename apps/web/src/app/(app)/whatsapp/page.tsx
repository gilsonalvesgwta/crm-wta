'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { FLOW_STATUS, WA_TRIGGERS, TRIGGER_TITLE, type Flow, type FlowItem, type TriggerType, type WaAccount } from '@/lib/instagram';
import { useSession } from '@/components/shell/session';
import { WhatsappTabs } from '@/components/instagram/wa-tabs';
import { TriggerIcon } from '@/components/instagram/trigger-icon';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Empty, LoadError, Loading } from '@/components/ui/states';

export default function WhatsappFlowsPage() {
  const { can } = useSession();
  const flows = useLoad(() => api<FlowItem[]>('GET', '/api/v1/whatsapp/flows'));
  const accounts = useLoad(() => api<WaAccount[]>('GET', '/api/v1/whatsapp/accounts'));
  const [creating, setCreating] = useState(false);
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  const noAccount = accounts.data && accounts.data.length === 0;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="WhatsApp" subtitle="Transmissões pela API oficial com modelos aprovados e conversas que seguem conforme a pessoa toca nos botões."
        actions={can('campaigns:edit') && !noAccount ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Novo fluxo</Button> : undefined} />
      <WhatsappTabs />
      {noAccount ? (
        <Empty title="Conecte um WhatsApp oficial"
          action={<Link href="/configuracoes/canais" className="inline-flex h-10 items-center rounded-[6px] bg-primary px-4 text-sm font-semibold text-primary-fg">Ir para Canais</Link>}>
          Os fluxos e as transmissões usam o WhatsApp oficial (Cloud API da Meta) cadastrado em Configurações › Canais.
        </Empty>
      ) : (
        <Panel title="Fluxos" description="Cada fluxo começa com um gatilho e segue os passos que você desenhar.">
          {flows.error ? <LoadError error={flows.error} retry={flows.reload} /> : flows.loading && !flows.data ? <Loading /> : flows.data!.length === 0 ? (
            <Empty title="Nenhum fluxo ainda" action={can('campaigns:edit') ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Criar o primeiro fluxo</Button> : undefined}>
              Comece pela transmissão: um modelo aprovado com botões (&ldquo;Quero saber mais&rdquo;, &ldquo;Como funciona?&rdquo;) e o que cada botão responde.
            </Empty>
          ) : (
            <ul className="-mx-5 divide-y divide-line">
              {flows.data!.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <TriggerIcon type={f.triggerType} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/whatsapp/fluxos/${f.id}`} className="font-medium hover:underline">{f.name}</Link>
                    <p className="text-[13px] text-muted">{TRIGGER_TITLE[f.triggerType]} · {f.accountName}{f.unpublishedChanges ? ' · alterações não publicadas' : ''}</p>
                  </div>
                  <div className="flex items-center gap-5 text-[13px]">
                    <span className="text-right"><span className="block font-semibold text-ink">{f.triggered7d.toLocaleString('pt-BR')}</span><span className="text-muted">7 dias</span></span>
                    <span className="text-right"><span className="block font-semibold text-ink">{f.triggeredTotal.toLocaleString('pt-BR')}</span><span className="text-muted">no total</span></span>
                    <span className="hidden w-28 text-muted sm:block">{dateTime.format(new Date(f.updatedAt))}</span>
                    <Badge tone={FLOW_STATUS[f.status].tone}>{FLOW_STATUS[f.status].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <NewFlowDialog open={creating} accounts={accounts.data ?? []} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewFlowDialog({ open, accounts, onClose }: { open: boolean; accounts: WaAccount[]; onClose: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<TriggerType>('wa_broadcast');
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const accountId = account || accounts[0]?.id || '';

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const f = await api<Flow>('POST', '/api/v1/whatsapp/flows', { accountId, name, triggerType: type });
      router.push(`/whatsapp/fluxos/${f.id}`);
    } catch (e) {
      setError(e as ApiError);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Novo fluxo" description="O que vai disparar a conversa?" width={680}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!accountId} onClick={create}>Criar e abrir o editor</Button></>}>
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Gatilho" className="grid gap-2 sm:grid-cols-2">
          {WA_TRIGGERS.map((t) => (
            <button key={t.type} type="button" role="radio" aria-checked={type === t.type} onClick={() => setType(t.type)}
              className={`flex items-start gap-3 rounded-[10px] border p-3 text-left transition-colors ${type === t.type ? 'border-primary bg-accent-soft' : 'border-line hover:bg-surface-2'}`}>
              <TriggerIcon type={t.type} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t.title}</span>
                <span className="block text-[13px] text-muted">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <Field label="Nome do fluxo" placeholder={TRIGGER_TITLE[type]} maxLength={80} value={name} onChange={(e) => setName(e.target.value)}
          hint="Só você vê. Ex.: Raio X — novembro." />
        {accounts.length > 1 ? (
          <Select label="WhatsApp oficial" value={accountId} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.address ? ` (${a.address})` : ''}</option>)}
          </Select>
        ) : null}
        {error ? <Alert tone="error">{error.errors[0]?.message ?? error.title}</Alert> : null}
      </div>
    </Dialog>
  );
}
