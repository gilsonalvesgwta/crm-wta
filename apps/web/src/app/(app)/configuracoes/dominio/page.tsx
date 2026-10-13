'use client';
import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleDashed, Copy, XCircle } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

type Domain = {
  allowed: boolean; target: string; domain: string | null; dnsOk: boolean; routingOk: boolean;
  verifiedAt: string | null; checkedAt: string | null; lastError: string | null;
};

export default function DomainPage() {
  const { data, error, loading, reload, setData } = useLoad(() => api<Domain>('GET', '/api/v1/domain'));
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'check' | 'remove' | null>(null);
  const [askRemove, setAskRemove] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} retry={reload} />;
  const d = data!;

  async function run(kind: 'save' | 'check' | 'remove', fn: () => Promise<Domain>) {
    setBusy(kind);
    setErr(null);
    try {
      setData(await fn());
      setValue(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível concluir.'));
    } finally {
      setBusy(null);
      setAskRemove(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void run('save', () => api<Domain>('PUT', '/api/v1/domain', { domain: value ?? d.domain ?? '' }));
  }

  if (!d.allowed) {
    return (
      <Panel title="Domínio próprio">
        <Alert tone="info">O plano atual da empresa não inclui domínio próprio. Fale com o suporte da WTA para incluir.</Alert>
      </Panel>
    );
  }

  const host = (value ?? d.domain ?? '').trim().toLowerCase() || 'crm.suaempresa.com.br';
  const sub = host.split('.')[0];

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Domínio próprio" description="A equipe entra no CRM por um endereço da sua empresa, com o seu logotipo e as suas cores na tela de login.">
        <form onSubmit={save} noValidate className="flex max-w-lg flex-col gap-4">
          {err && !err.fieldError('domain') ? <Alert tone="error">{err.title}</Alert> : null}
          <Field label="Endereço" placeholder="crm.suaempresa.com.br" value={value ?? d.domain ?? ''}
            onChange={(e) => setValue(e.target.value)} error={err?.fieldError('domain')}
            hint="Use um subdomínio (como crm.suaempresa.com.br), não o domínio principal do site." />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === 'save'} disabled={value === null || value.trim() === (d.domain ?? '')}>Salvar</Button>
            {d.domain ? <Button type="button" variant="secondary" loading={busy === 'check'} onClick={() => run('check', () => api<Domain>('POST', '/api/v1/domain/check'))}>Verificar agora</Button> : null}
            {d.domain ? <Button type="button" variant="ghost" onClick={() => setAskRemove(true)}>Remover</Button> : null}
          </div>
        </form>
        {d.domain ? (
          <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
            <Status ok={d.dnsOk} checked={!!d.checkedAt} label="DNS apontando para o CRM" />
            <Status ok={d.routingOk} checked={!!d.checkedAt} label="Endereço respondendo com certificado (cadeado)" />
            {d.lastError ? <p className="text-[13px] text-bad">{d.lastError}</p> : null}
            <p className="text-[13px] text-muted">
              {d.checkedAt ? `Última verificação: ${new Date(d.checkedAt).toLocaleString('pt-BR')}.` : 'Ainda não verificado.'}
              {d.dnsOk && d.routingOk ? ` Pronto: a equipe já pode entrar por https://${d.domain}.` : ''}
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel title="Como configurar">
        <ol className="flex list-decimal flex-col gap-4 pl-5">
          <li>
            <p className="font-medium">No painel onde o domínio da empresa está registrado (Registro.br, Cloudflare, Hostinger, GoDaddy…), crie este registro DNS:</p>
            <table className="mt-2 w-full max-w-xl text-left text-sm">
              <thead><tr className="border-b border-line text-[13px] text-muted"><th className="py-1.5 font-medium">Tipo</th><th className="py-1.5 font-medium">Nome</th><th className="py-1.5 font-medium">Valor (destino)</th></tr></thead>
              <tbody>
                <tr>
                  <td className="py-1.5 font-mono">CNAME</td>
                  <td className="py-1.5 font-mono">{sub}</td>
                  <td className="py-1.5 font-mono">
                    <span className="inline-flex items-center gap-2">{d.target}
                      <button type="button" aria-label="Copiar destino" className="text-muted hover:text-ink"
                        onClick={() => { void navigator.clipboard?.writeText(d.target); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                        <Copy size={14} aria-hidden />
                      </button>
                      {copied ? <span className="text-[12px] text-ok">copiado</span> : null}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[13px] text-muted">No Cloudflare, deixe o registro como &ldquo;somente DNS&rdquo; (nuvem cinza). Se o painel não aceitar CNAME, crie um registro A com os mesmos IPs de {d.target}.</p>
          </li>
          <li>
            <p className="font-medium">Espere a propagação e clique em &ldquo;Verificar agora&rdquo;.</p>
            <p className="text-[13px] text-muted">Costuma levar de alguns minutos a algumas horas. Com o DNS certo, a equipe da WTA libera o certificado de segurança do endereço; a segunda verificação fica verde quando ele estiver ativo.</p>
          </li>
          <li>
            <p className="font-medium">Avise a equipe.</p>
            <p className="text-[13px] text-muted">O login pelo endereço novo usa o logotipo e as cores da Identidade visual. Convites e e-mails de nova senha passam a levar o endereço da empresa. O endereço principal continua funcionando.</p>
          </li>
        </ol>
      </Panel>

      <Confirm open={askRemove} title="Remover o domínio próprio?" confirmLabel="Remover" loading={busy === 'remove'}
        onConfirm={() => run('remove', () => api<Domain>('DELETE', '/api/v1/domain'))} onCancel={() => setAskRemove(false)}>
        A equipe volta a entrar só pelo endereço principal do CRM. O registro DNS pode ser apagado depois.
      </Confirm>
    </div>
  );
}

function Status({ ok, checked, label }: { ok: boolean; checked: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 size={18} className="text-ok" aria-hidden /> : checked ? <XCircle size={18} className="text-bad" aria-hidden /> : <CircleDashed size={18} className="text-muted" aria-hidden />}
      <span>{label}</span>
      <span className="sr-only">{ok ? 'concluído' : checked ? 'pendente' : 'não verificado'}</span>
    </p>
  );
}
