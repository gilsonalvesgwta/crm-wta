'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mail, MessageCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { phone } from '@/lib/crm';
import { ACCOUNT_STATUS, type ChannelAccount } from '@/lib/messages';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { MetaPanels } from '@/components/crm/meta-channels';
import { LoadError, Loading } from '@/components/ui/states';

type Limit = { used: number; max: number | null };
type Data = { evolutionConfigured: boolean; accounts: ChannelAccount[]; limits: { whatsapp: Limit; email: Limit } };
type Qr = { account: ChannelAccount; qr: string | null; pairingCode: string | null };

const limitText = (l: Limit, what: string) => (l.max === null ? `${l.used} ${what}` : `${l.used} de ${l.max} ${what} do plano`);

export default function ChannelsPage() {
  const { data, error, loading, reload } = useLoad(() => api<Data>('GET', '/api/v1/channels'));
  const [qr, setQr] = useState<Qr | null>(null);
  const [newWa, setNewWa] = useState(false);
  const [email, setEmail] = useState<ChannelAccount | 'new' | null>(null);
  const [removing, setRemoving] = useState<ChannelAccount | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} retry={reload} />;
  const d = data!;
  const wa = d.accounts.filter((a) => a.kind === 'whatsapp_evolution');
  const mails = d.accounts.filter((a) => a.kind === 'email_smtp');
  const waFull = d.limits.whatsapp.max !== null && d.limits.whatsapp.used >= d.limits.whatsapp.max;
  const mailFull = d.limits.email.max !== null && d.limits.email.used >= d.limits.email.max;

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
    }
  }

  async function openQr(a: ChannelAccount) {
    setBusy(`qr-${a.id}`);
    setErr(null);
    try {
      setQr(await api<Qr>('GET', `/api/v1/channels/${a.id}/qr`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível gerar o QR code.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}

      <Panel title="WhatsApp (QR code)" description={`Números conectados pela Evolution API. ${limitText(d.limits.whatsapp, d.limits.whatsapp.used === 1 ? 'número' : 'números')}.`}
        actions={d.evolutionConfigured ? <Button onClick={() => setNewWa(true)} disabled={waFull}><Plus size={16} aria-hidden />Conectar número</Button> : undefined}>
        {!d.evolutionConfigured ? (
          <Alert tone="info">O WhatsApp ainda não foi habilitado nesta instalação. Fale com o suporte da WTA.</Alert>
        ) : wa.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhum número conectado. Clique em Conectar número e leia o QR code com o WhatsApp do celular (Aparelhos conectados › Conectar aparelho).</p>
        ) : (
          <ul className="flex flex-col">
            {wa.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                <div className="flex min-w-0 items-start gap-3">
                  <MessageCircle size={20} aria-hidden className="mt-0.5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{a.name} <Badge tone={ACCOUNT_STATUS[a.status].tone}>{ACCOUNT_STATUS[a.status].label}</Badge></p>
                    <p className="text-[13px] text-muted">{a.address ? phone(a.address) : 'Número ainda não conectado'} · instância {a.instance}</p>
                    {a.lastError ? <p className="text-[13px] text-bad">{a.lastError}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status !== 'connected' ? <Button variant="secondary" loading={busy === `qr-${a.id}`} onClick={() => void openQr(a)}>Conectar (QR code)</Button> : null}
                  <Button variant="ghost" aria-label={`Atualizar o estado de ${a.name}`} loading={busy === `r-${a.id}`}
                    onClick={() => void run(`r-${a.id}`, () => api('POST', `/api/v1/channels/${a.id}/refresh`))}><RefreshCw size={16} aria-hidden /></Button>
                  {a.status === 'connected' ? (
                    <Button variant="secondary" loading={busy === `d-${a.id}`}
                      onClick={() => void run(`d-${a.id}`, () => api('POST', `/api/v1/channels/${a.id}/disconnect`), `${a.name} foi desconectado.`)}>Desconectar</Button>
                  ) : null}
                  <Button variant="secondary" loading={busy === `w-${a.id}`}
                    onClick={() => void run(`w-${a.id}`, () => api('POST', `/api/v1/channels/${a.id}/rewire`), 'Webhook da instância refeito.')}>Refazer webhook</Button>
                  <Button variant="danger" aria-label={`Remover ${a.name}`} onClick={() => setRemoving(a)}><Trash2 size={16} aria-hidden /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <MetaPanels accounts={d.accounts} whatsappFull={waFull} onChanged={() => void reload()}
        onMessage={(ok, e) => { setMsg(ok); setErr(e); }} onRemove={(a) => setRemoving(a)} />

      <Panel title="E-mail" description={`Caixas de e-mail da empresa para enviar pelo CRM. ${limitText(d.limits.email, d.limits.email.used === 1 ? 'caixa' : 'caixas')}.`}
        actions={<Button onClick={() => setEmail('new')} disabled={mailFull}><Plus size={16} aria-hidden />Adicionar e-mail</Button>}>
        {mails.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma caixa cadastrada. Use a mesma caixa que a equipe já usa (Hostinger, Gmail, Outlook) com os dados de SMTP dela.</p>
        ) : (
          <ul className="flex flex-col">
            {mails.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                <div className="flex min-w-0 items-start gap-3">
                  <Mail size={20} aria-hidden className="mt-0.5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{a.name} <Badge tone={ACCOUNT_STATUS[a.status].tone}>{ACCOUNT_STATUS[a.status].label}</Badge></p>
                    <p className="text-[13px] text-muted">{a.smtp?.fromName} &lt;{a.address}&gt; · {a.smtp?.host}:{a.smtp?.port}</p>
                    {a.lastError ? <p className="text-[13px] text-bad">{a.lastError}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" loading={busy === `t-${a.id}`}
                    onClick={() => void run(`t-${a.id}`, async () => {
                      const r = await api<{ account: ChannelAccount; sentTo: string | null }>('POST', `/api/v1/channels/${a.id}/test`);
                      if (!r.sentTo) throw new ApiError(0, 'error', r.account.lastError ?? 'O teste falhou.');
                      setMsg(`Teste enviado para ${r.sentTo}. Confira a caixa de entrada (e o spam).`);
                    })}>Testar</Button>
                  <Button variant="ghost" aria-label={`Editar ${a.name}`} onClick={() => setEmail(a)}><Pencil size={16} aria-hidden /></Button>
                  <Button variant="danger" aria-label={`Remover ${a.name}`} onClick={() => setRemoving(a)}><Trash2 size={16} aria-hidden /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[13px] text-muted">
          As mensagens enviadas pelo CRM aparecem no histórico do contato. Respostas chegam na caixa de e-mail de sempre; a leitura delas pelo CRM vem numa próxima etapa.
        </p>
      </Panel>

      {newWa ? <NewWhatsapp onClose={() => setNewWa(false)} onCreated={(q) => { setNewWa(false); setQr(q); void reload(); }} /> : null}
      {qr ? <QrDialog initial={qr} onClose={(connected) => { setQr(null); if (connected) setMsg('WhatsApp conectado.'); void reload(); }} /> : null}
      {email ? <EmailDialog account={email === 'new' ? null : email} onClose={() => setEmail(null)} onSaved={(m) => { setEmail(null); setMsg(m); void reload(); }} /> : null}
      <Confirm open={!!removing} title={`Remover ${removing?.name}?`} confirmLabel="Remover" loading={busy === 'remove'}
        onConfirm={() => { const a = removing!; setRemoving(null); void run('remove', () => api('DELETE', `/api/v1/channels/${a.id}`), `${a.name} foi removido.`); }}
        onCancel={() => setRemoving(null)}>
        {removing?.kind === 'whatsapp_evolution'
          ? 'A instância é apagada da Evolution API e o número deixa de receber e enviar pelo CRM. O histórico de mensagens continua nos contatos.'
          : removing?.kind === 'email_smtp' ? 'A caixa deixa de enviar pelo CRM. O histórico de mensagens continua nos contatos.'
          : 'A conta deixa de receber e enviar pelo CRM (na Meta nada muda; remova o webhook lá se quiser). Os modelos cadastrados saem do CRM. O histórico continua nos contatos.'}
      </Confirm>
    </div>
  );
}

function NewWhatsapp({ onClose, onCreated }: { onClose: () => void; onCreated: (q: Qr) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onCreated(await api<Qr>('POST', '/api/v1/channels/whatsapp', { name }));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível criar.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open title="Conectar número de WhatsApp" onClose={onClose} width={460}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !err.fieldError('name') ? <Alert tone="error">{err.title}</Alert> : null}
        <Field label="Nome do número" value={name} onChange={(e) => setName(e.target.value)} placeholder="Comercial, Suporte…" maxLength={120}
          error={err?.fieldError('name')} hint="Só para a equipe saber qual número é qual." />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>Gerar QR code</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** QR code com atualização: confere o estado a cada 4 s e troca o QR a cada 30 s. */
function QrDialog({ initial, onClose }: { initial: Qr; onClose: (connected: boolean) => void }) {
  const [qr, setQr] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const id = initial.account.id;
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const a = await api<ChannelAccount>('POST', `/api/v1/channels/${id}/refresh`);
        if (!alive) return;
        if (a.status === 'connected' && !done.current) {
          done.current = true;
          close.current(true);
        }
      } catch { /* tenta de novo na próxima volta */ }
    };
    const renew = async () => {
      try {
        const r = await api<Qr>('GET', `/api/v1/channels/${id}/qr`);
        if (!alive) return;
        setQr(r);
        setErr(null);
        if (!r.qr && r.account.status === 'connected' && !done.current) {
          done.current = true;
          close.current(true);
        }
      } catch (e) {
        if (alive) setErr(e instanceof ApiError ? e.title : 'Não foi possível atualizar o QR code.');
      }
    };
    const t1 = setInterval(() => void check(), 4000);
    const t2 = setInterval(() => void renew(), 30000);
    return () => { alive = false; clearInterval(t1); clearInterval(t2); };
  }, [id]);
  return (
    <Dialog open title={`Conectar ${initial.account.name}`} description="No celular: WhatsApp › Aparelhos conectados › Conectar aparelho, e aponte a câmera para o código." onClose={() => onClose(false)} width={440}>
      <div className="flex flex-col items-center gap-4">
        {err ? <Alert tone="error">{err}</Alert> : null}
        {qr.qr ? <img src={qr.qr} alt="QR code para conectar o WhatsApp" width={280} height={280} className="size-[280px] rounded-[8px] border border-line bg-white p-2" />
          : <p className="text-[13px] text-muted">Gerando o QR code…</p>}
        {qr.pairingCode ? <p className="text-center text-[13px] text-muted">Ou use o código de pareamento: <span className="font-mono font-semibold text-ink">{qr.pairingCode}</span></p> : null}
        <p className="text-center text-[13px] text-muted">Esta janela fecha sozinha quando o número conectar.</p>
      </div>
    </Dialog>
  );
}

const PRESETS: Record<string, { host: string; port: number; secure: boolean; hint: string }> = {
  hostinger: { host: 'smtp.hostinger.com', port: 465, secure: true, hint: 'Usuário: o e-mail completo. Se a 465 não conectar, use a 587.' },
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false, hint: 'Use uma senha de app do Google (com a verificação em duas etapas ligada na conta).' },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false, hint: 'O administrador do Microsoft 365 precisa permitir SMTP autenticado para a caixa.' },
};

function EmailDialog({ account, onClose, onSaved }: { account: ChannelAccount | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const s = account?.smtp;
  const [v, setV] = useState({
    name: account?.name ?? '', address: account?.address ?? '', fromName: s?.fromName ?? '', host: s?.host ?? 'smtp.hostinger.com',
    port: String(s?.port ?? 465), user: s?.user ?? '', pass: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const preset = Object.entries(PRESETS).find(([, p]) => p.host === v.host)?.[1];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const port = Number(v.port);
    const body = { name: v.name, address: v.address, fromName: v.fromName, host: v.host, port, secure: port === 465, user: v.user || v.address, pass: v.pass || null };
    try {
      const a = account
        ? await api<ChannelAccount>('PATCH', `/api/v1/channels/email/${account.id}`, body)
        : await api<ChannelAccount>('POST', '/api/v1/channels/email', body);
      const t = await api<{ account: ChannelAccount; sentTo: string | null }>('POST', `/api/v1/channels/${a.id}/test`);
      onSaved(t.sentTo ? `Caixa salva e testada: o teste foi para ${t.sentTo}.` : `Caixa salva, mas o teste falhou: ${t.account.lastError ?? 'erro desconhecido'}.`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={account ? `Editar ${account.name}` : 'Adicionar e-mail'} onClose={onClose} width={620}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Provedor">
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} type="button" aria-pressed={v.host === p.host}
              onClick={() => setV({ ...v, host: p.host, port: String(p.port) })}
              className={`h-8 rounded-full px-3 text-[13px] font-medium ${v.host === p.host ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>
              {k === 'hostinger' ? 'Hostinger' : k === 'gmail' ? 'Gmail' : 'Outlook / Microsoft 365'}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da conta" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Vendas" error={err?.fieldError('name')} />
          <Field label="E-mail" type="email" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} placeholder="vendas@suaempresa.com.br" error={err?.fieldError('address')} />
          <Field label="Nome do remetente" value={v.fromName} onChange={(e) => setV({ ...v, fromName: e.target.value })} placeholder="Sua Empresa" error={err?.fieldError('fromName')}
            hint="Como aparece para quem recebe." />
          <Field label="Usuário" value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} placeholder="Em branco: o próprio e-mail" error={err?.fieldError('user')} />
          <Field label="Servidor SMTP" value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} error={err?.fieldError('host')} />
          <Select label="Porta" value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} error={err?.fieldError('port')}>
            <option value="465">465 (SSL)</option>
            <option value="587">587 (STARTTLS)</option>
            <option value="2525">2525</option>
            <option value="25">25</option>
          </Select>
          <Field label={account ? 'Senha (em branco: mantém a atual)' : 'Senha'} type="password" autoComplete="new-password" value={v.pass}
            onChange={(e) => setV({ ...v, pass: e.target.value })} error={err?.fieldError('pass')} />
        </div>
        {preset ? <p className="text-[13px] text-muted">{preset.hint}</p> : null}
        <p className="text-[13px] text-muted">A senha fica cifrada no banco e não aparece de novo. Ao salvar, o CRM manda um e-mail de teste para você.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!v.name.trim() || !v.address.trim() || !v.fromName.trim() || (!account && !v.pass)}>Salvar e testar</Button>
        </div>
      </form>
    </Dialog>
  );
}
