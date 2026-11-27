'use client';
import { useState, type FormEvent } from 'react';
import { Pencil, Phone, PhoneCall, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { ASTERISK_DIALPLAN, HTTP_CONTRACT, PROVIDERS, PROVIDER_STATUS, type VoiceProvider, type VoiceProviderKind } from '@/lib/voice';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { LoadError, Loading } from '@/components/ui/states';
import { VoiceAudioPicker } from './voice-audio';

/** Operadoras de voz da empresa (Configurações › Canais). */
export function VoicePanel() {
  const { data, error, loading, reload } = useLoad(() => api<{ items: VoiceProvider[] }>('GET', '/api/v1/voice/providers'));
  const [edit, setEdit] = useState<VoiceProvider | 'new' | null>(null);
  const [testing, setTesting] = useState<VoiceProvider | null>(null);
  const [removing, setRemoving] = useState<VoiceProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function remove(p: VoiceProvider) {
    setBusy(true);
    try {
      await api('DELETE', `/api/v1/voice/providers/${p.id}`);
      setMsg({ tone: 'success', text: `${p.name} foi removida.` });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.title : 'Não foi possível remover.' });
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <Panel title="Ligações (torpedo de voz)"
      description="Operadoras que fazem as ligações das campanhas de voz: tocam um áudio gravado e, se quiser, recebem uma tecla. Cadastre quantas quiser e escolha qual usar em cada campanha."
      actions={<Button onClick={() => setEdit('new')}><Plus size={16} aria-hidden />Adicionar operadora</Button>}>
      {msg ? <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      {error ? <LoadError error={error} retry={reload} /> : loading && !data ? <Loading /> : !data!.items.length ? (
        <p className="text-[13px] text-muted">Nenhuma operadora ainda. Dá para usar Twilio, Plivo, Telnyx, Zenvia Voz, Infobip, a sua própria central SIP (Asterisk) ou outra empresa com API.</p>
      ) : (
        <ul className="flex flex-col">
          {data!.items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 items-start gap-3">
                <Phone size={20} aria-hidden className="mt-0.5 shrink-0 text-muted" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{p.name} <Badge tone={PROVIDER_STATUS[p.status].tone}>{PROVIDER_STATUS[p.status].label}</Badge></p>
                  <p className="text-[13px] text-muted">{PROVIDERS[p.provider].label}{p.config.from ? ` · ${p.config.from}` : ''}{p.sms ? ' · liga e manda SMS' : ' · só ligação'}
                    {p.testedAt ? ` · último teste ${dateTime.format(new Date(p.testedAt))}` : ''}</p>
                  {p.lastError ? <p className="text-[13px] text-bad">{p.lastError}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setTesting(p)}><PhoneCall size={16} aria-hidden />Testar</Button>
                <Button variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => setEdit(p)}><Pencil size={16} aria-hidden /></Button>
                <Button variant="danger" aria-label={`Remover ${p.name}`} onClick={() => setRemoving(p)}><Trash2 size={16} aria-hidden /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[13px] text-muted">
        A operadora só aparece como “Testada” depois de uma ligação de teste atendida. Ligações para quem pediu para sair (tecla de descadastro ou lista de supressão) não são feitas.
      </p>
      {edit ? <ProviderDialog provider={edit === 'new' ? null : edit} onClose={() => setEdit(null)}
        onSaved={(p) => { setEdit(null); setMsg({ tone: 'success', text: `${p.name} salva. Faça uma ligação de teste para conferir.` }); void reload(); if (edit === 'new') setTesting(p); }} /> : null}
      {testing ? <TestDialog provider={testing} onClose={() => { setTesting(null); void reload(); }} /> : null}
      <Confirm open={!!removing} title={`Remover ${removing?.name}?`} confirmLabel="Remover" loading={busy}
        onConfirm={() => removing && void remove(removing)} onCancel={() => setRemoving(null)}>
        A operadora deixa de ser usada pelo CRM. Campanhas já concluídas continuam com o relatório.
      </Confirm>
    </Panel>
  );
}

function ProviderDialog({ provider, onClose, onSaved }: { provider: VoiceProvider | null; onClose: () => void; onSaved: (p: VoiceProvider) => void }) {
  const [kind, setKind] = useState<VoiceProviderKind>(provider?.provider ?? 'twilio');
  const [name, setName] = useState(provider?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>(provider?.config ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const meta = PROVIDERS[kind];
  const sameKind = provider?.provider === kind;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const config: Record<string, string> = {};
    const secret: Record<string, string> = {};
    for (const f of meta.fields) {
      const v = (values[f.key] ?? '').trim();
      if (!v) continue;
      if (f.secret) secret[f.key] = v;
      else config[f.key] = v;
    }
    const body = { name: name || meta.label, provider: kind, config, ...(Object.keys(secret).length || !sameKind ? { secret } : {}) };
    try {
      const p = provider ? await api<VoiceProvider>('PATCH', `/api/v1/voice/providers/${provider.id}`, body) : await api<VoiceProvider>('POST', '/api/v1/voice/providers', body);
      onSaved(p);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={provider ? `Editar ${provider.name}` : 'Adicionar operadora de voz'} onClose={onClose} width={680}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        {err?.errors.length ? <Alert tone="error">{err.title}</Alert> : null}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Operadora">
          {(Object.keys(PROVIDERS) as VoiceProviderKind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`h-8 rounded-full px-3 text-[13px] font-medium ${kind === k ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>
              {PROVIDERS[k].label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted">{meta.about}{meta.site ? <> <a href={meta.site} target="_blank" rel="noreferrer" className="underline">Abrir o site</a></> : null}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome no CRM" value={name} onChange={(e) => setName(e.target.value)} placeholder={meta.label} error={err?.fieldError('name')} />
          {meta.fields.map((f) => (
            <Field key={`${kind}-${f.key}`} label={`${f.label}${f.required ? ' *' : ''}${f.secret && provider && sameKind ? ' (em branco: mantém)' : ''}`}
              type={f.secret ? 'password' : 'text'} autoComplete={f.secret ? 'new-password' : 'off'}
              value={values[f.key] ?? ''} placeholder={f.secret && provider?.secretHint && sameKind ? `••••${provider.secretHint}` : f.placeholder} hint={f.hint}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              error={err?.fieldError(`${f.secret ? 'secret' : 'config'}.${f.key}`)} />
          ))}
        </div>
        {kind === 'sip' ? (
          <details className="rounded-[10px] border border-line p-3 text-[13px]">
            <summary className="cursor-pointer font-medium">Roteiro para colar no Asterisk</summary>
            <p className="mt-2 text-muted">Ative a ARI (ari.conf e http.conf com TLS) e crie este contexto. O CRM liga pela ARI, a central toca o áudio e avisa a tecla e o fim da ligação.</p>
            <pre className="mt-2 overflow-x-auto rounded-[8px] bg-surface-2 p-3 text-[12px]">{ASTERISK_DIALPLAN}</pre>
          </details>
        ) : null}
        {kind === 'http' ? (
          <details className="rounded-[10px] border border-line p-3 text-[13px]">
            <summary className="cursor-pointer font-medium">Como a API da operadora precisa funcionar</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[8px] bg-surface-2 p-3 text-[12px]">{HTTP_CONTRACT}</pre>
          </details>
        ) : null}
        <p className="text-[13px] text-muted">Tokens e senhas ficam cifrados no banco e não aparecem de novo.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Salvar</Button>
        </div>
      </form>
    </Dialog>
  );
}

function TestDialog({ provider, onClose }: { provider: VoiceProvider; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [audio, setAudio] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(call: boolean) {
    setBusy(call ? 'call' : 'check');
    setErr(null);
    setMsg(null);
    try {
      await api('POST', `/api/v1/voice/providers/${provider.id}/test`, call ? { to, audioFileId: audio || null } : {});
      setMsg(call ? 'Ligação feita. Atenda e aperte uma tecla: a operadora fica “Testada” quando a ligação é atendida.' : 'Credenciais aceitas pela operadora.');
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'O teste falhou.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open title={`Testar ${provider.name}`} onClose={onClose} width={620}>
      <div className="flex flex-col gap-4">
        {err ? <Alert tone="error">{err.errors[0]?.message ?? err.title}</Alert> : null}
        {msg ? <Alert tone="success">{msg}</Alert> : null}
        <Field label="Telefone que recebe o teste" value={to} onChange={(e) => setTo(e.target.value)} placeholder="(11) 98888-7777" error={err?.fieldError('to')} />
        <VoiceAudioPicker value={audio} onChange={setAudio} error={err?.fieldError('audioFileId')} label="Áudio do teste" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" loading={busy === 'check'} onClick={() => void run(false)}>Só conferir as credenciais</Button>
          <Button loading={busy === 'call'} disabled={!to.trim() || !audio} onClick={() => void run(true)}><PhoneCall size={16} aria-hidden />Ligar agora</Button>
        </div>
      </div>
    </Dialog>
  );
}
