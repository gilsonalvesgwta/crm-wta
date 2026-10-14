'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { usePipelines } from '@/components/crm/data';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; createdBy: { name: string } | null };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button type="button" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      <Copy size={16} aria-hidden />{done ? 'Copiado' : label}
    </Button>
  );
}

export default function IntegrationsPage() {
  const keys = useLoad(() => api<{ items: Key[] }>('GET', '/api/v1/api-keys').then((r) => r.items));
  const { data: pipelines } = usePipelines();
  const [name, setName] = useState('n8n');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Key | null>(null);
  const [origin, setOrigin] = useState('https://crm.suaempresa.com.br');
  useEffect(() => setOrigin(window.location.origin), []);

  if (keys.error) return <LoadError error={keys.error} retry={keys.reload} />;
  const endpoint = `${origin}/api/v1/inbound`;
  const firstPipe = pipelines?.[0];
  const example = {
    contact: { name: 'Maria Souza', email: 'maria@cliente.com.br', phone: '(11) 98765-4321', tags: ['Site'] },
    organization: { name: 'Souza Comércio' },
    deal: { title: 'Orçamento do site', value: 1500, pipeline: firstPipe?.name ?? 'Vendas', stage: firstPipe?.stages.find((s) => s.kind === 'open')?.name ?? 'Qualificação' },
    note: 'Pediu orçamento pelo formulário.',
    touch: { source: 'google', medium: 'cpc', campaign: 'outubro' },
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ key: string }>('POST', '/api/v1/api-keys', { name });
      setCreated(r.key);
      await keys.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.title : 'Não foi possível criar a chave.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Chaves de API" description="Para o n8n (ou outro sistema) cadastrar contatos, leads e negócios e ler dados do CRM. A chave age com as permissões de quem a criou.">
        <div className="flex flex-col gap-4">
          {err ? <Alert tone="error">{err}</Alert> : null}
          {created ? (
            <Alert tone="success">
              <span className="block font-medium">Chave criada. Copie agora: ela não aparece de novo.</span>
              <code className="mt-2 block break-all rounded bg-surface px-2 py-1.5 font-mono text-[12px] text-ink">{created}</code>
              <span className="mt-2 inline-block"><CopyButton text={created} label="Copiar a chave" /></span>
            </Alert>
          ) : null}
          <form onSubmit={create} noValidate className="flex flex-wrap items-end gap-2">
            <Field label="Nome da chave" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" hint="Para saber onde ela está em uso, como n8n ou site." />
            <Button type="submit" loading={busy} disabled={!name.trim()} className="mb-[26px]"><KeyRound size={16} aria-hidden />Criar chave</Button>
          </form>
          {!keys.data ? <Loading /> : keys.data.length === 0 ? <p className="text-[13px] text-muted">Nenhuma chave ainda.</p> : (
            <ul className="flex flex-col">
              {keys.data.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{k.name} {k.revokedAt ? <Badge tone="bad">Revogada</Badge> : <Badge tone="ok">Ativa</Badge>}</p>
                    <p className="text-[13px] text-muted">
                      <span className="font-mono">crm_{k.prefix}_…</span> · criada {dateTime.format(new Date(k.createdAt))}{k.createdBy ? ` por ${k.createdBy.name}` : ''}
                      {' · '}{k.lastUsedAt ? `último uso ${dateTime.format(new Date(k.lastUsedAt))}` : 'nunca usada'}
                    </p>
                  </div>
                  {!k.revokedAt ? <Button variant="danger" aria-label={`Revogar ${k.name}`} onClick={() => setRevoking(k)}><Trash2 size={16} aria-hidden />Revogar</Button> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title="Cadastrar pelo n8n" description="Um nó HTTP Request no n8n cria (ou acha) o contato e põe o negócio exatamente no funil e na etapa que você quiser.">
        <div className="flex flex-col gap-4 text-sm">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>No n8n, adicione um nó <strong>HTTP Request</strong>, método <strong>POST</strong>, com o endereço abaixo.</li>
            <li>Em Authentication, escolha &ldquo;Generic Credential Type › Header Auth&rdquo;: nome <code className="rounded bg-surface-2 px-1">Authorization</code>, valor <code className="rounded bg-surface-2 px-1">Bearer</code> + espaço + a chave.</li>
            <li>Em Body, escolha JSON e monte o corpo como no exemplo, trocando os valores pelos campos do seu fluxo.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-[6px] border border-line bg-surface-2 px-3 py-2 text-[13px]">{endpoint}</code>
            <CopyButton text={endpoint} label="Copiar endereço" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">Exemplo de corpo (JSON)</span><CopyButton text={JSON.stringify(example, null, 2)} label="Copiar exemplo" /></div>
            <pre className="overflow-x-auto rounded-[6px] border border-line bg-surface-2 p-3 text-[12px] leading-relaxed">{JSON.stringify(example, null, 2)}</pre>
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
            <li>Contato com o mesmo e-mail ou telefone é reaproveitado (e completado); senão, é criado.</li>
            <li>Funil e etapa pelo nome (sem diferença de maiúsculas e acentos) ou pelo identificador (<code>pipelineId</code>, <code>stageId</code>). Sem funil, vai para o primeiro, na primeira etapa.</li>
            <li>Em vez de <code>deal</code>, mande <code>lead</code> com <code>title</code> e <code>source</code> para cair em Leads.</li>
            <li>Responsável: <code>ownerEmail</code> no contato, no negócio ou no lead (e-mail de quem usa o CRM).</li>
            <li>A resposta traz <code>contactId</code>, <code>dealId</code> e <code>leadId</code>. Erros voltam com a mensagem e o campo.</li>
            <li>Para o CRM avisar o n8n (negócio ganho, contato novo…), crie uma automação com a ação &ldquo;Avisar o n8n (webhook)&rdquo;.</li>
          </ul>
          {pipelines?.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Funis e etapas desta empresa</span>
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead><tr className="border-b border-line text-muted"><th className="py-1.5 pr-3 font-medium">Funil</th><th className="py-1.5 pr-3 font-medium">Etapa</th><th className="py-1.5 font-medium">Identificador da etapa</th></tr></thead>
                  <tbody>
                    {pipelines.flatMap((p) => p.stages.filter((s) => s.kind === 'open').map((s) => (
                      <tr key={s.id} className="border-b border-line last:border-0"><td className="py-1.5 pr-3">{p.name}</td><td className="py-1.5 pr-3">{s.name}</td><td className="py-1.5 font-mono text-[12px]">{s.id}</td></tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <Confirm open={!!revoking} title={`Revogar a chave ${revoking?.name}?`} confirmLabel="Revogar"
        onConfirm={async () => {
          const k = revoking!;
          setRevoking(null);
          try { await api('DELETE', `/api/v1/api-keys/${k.id}`); await keys.reload(); } catch (e) { setErr(e instanceof ApiError ? e.title : 'Não foi possível revogar.'); }
        }}
        onCancel={() => setRevoking(null)}>
        O que usa esta chave (o fluxo do n8n, por exemplo) para de funcionar na hora.
      </Confirm>
    </div>
  );
}
