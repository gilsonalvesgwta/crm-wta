'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AtSign, BadgeCheck, BookOpen, Copy, FileText, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { GuideSheet, MetaGuide, type GuideKind } from './meta-guide';
import { ApiError, api } from '@/lib/api';
import { phone } from '@/lib/crm';
import { ACCOUNT_STATUS, type ChannelAccount } from '@/lib/messages';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';

type Kind = 'whatsapp_cloud' | 'instagram';

function CopyLine({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[12px]">{value}</code>
        <Button type="button" variant="secondary" aria-label={`Copiar ${label.toLowerCase()}`}
          onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          <Copy size={14} aria-hidden />{done ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}

/** O que colar no app da Meta para os avisos chegarem. */
function WebhookBox({ kind, webhook }: { kind: Kind; webhook: { url: string; verifyToken: string } }) {
  return (
    <details className="rounded-[8px] border border-line bg-surface-2 p-3 text-[13px]">
      <summary className="cursor-pointer font-medium">Configurar os avisos na Meta</summary>
      <div className="mt-3 flex flex-col gap-3">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted">
          <li>No app em developers.facebook.com, abra <strong>{kind === 'whatsapp_cloud' ? 'WhatsApp › Configuração' : 'Instagram › Configuração da API com login do Instagram'}</strong> (Webhooks).</li>
          <li>Em URL de retorno, cole o endereço abaixo; em token de verificação, cole o token. Clique em Verificar e salvar.</li>
          <li>Assine os campos <strong>{kind === 'whatsapp_cloud' ? 'messages e message_template_status_update' : 'messages'}</strong>.</li>
        </ol>
        <CopyLine label="URL de retorno" value={webhook.url} />
        <CopyLine label="Token de verificação" value={webhook.verifyToken} />
      </div>
    </details>
  );
}

export function MetaPanels({ accounts, whatsappFull, onChanged, onMessage, onRemove }: {
  accounts: ChannelAccount[]; whatsappFull: boolean; onChanged: () => void; onMessage: (ok: string | null, err: string | null) => void; onRemove: (a: ChannelAccount) => void;
}) {
  const [editing, setEditing] = useState<{ kind: Kind; account: ChannelAccount | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [guide, setGuide] = useState<GuideKind | null>(null);
  const cloud = accounts.filter((a) => a.kind === 'whatsapp_cloud');
  const ig = accounts.filter((a) => a.kind === 'instagram');

  async function verify(a: ChannelAccount) {
    setBusy(a.id);
    try {
      const r = await api<{ status: string; lastError: string | null }>('POST', `/api/v1/channels/${a.id}/verify`);
      onMessage(r.status === 'connected' ? `${a.name}: conexão com a Meta conferida.` : null, r.lastError);
      onChanged();
    } catch (e) {
      onMessage(null, e instanceof ApiError ? e.title : 'Não foi possível conferir.');
    } finally {
      setBusy(null);
    }
  }

  const row = (a: ChannelAccount, icon: React.ReactNode, detail: string) => (
    <li key={a.id} className="flex flex-col gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon}
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium">{a.name} <Badge tone={ACCOUNT_STATUS[a.status].tone}>{ACCOUNT_STATUS[a.status].label}</Badge></p>
            <p className="text-[13px] text-muted">{detail}</p>
            {a.lastError ? <p className="text-[13px] text-bad">{a.lastError}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.kind === 'whatsapp_cloud' ? (
            <Link href={`/configuracoes/canais/modelos?conta=${a.id}`} className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2">
              <FileText size={16} aria-hidden />Modelos
            </Link>
          ) : null}
          <Button variant="secondary" loading={busy === a.id} onClick={() => void verify(a)}><RefreshCw size={16} aria-hidden />Conferir</Button>
          <Button variant="ghost" aria-label={`Editar ${a.name}`} onClick={() => setEditing({ kind: a.kind as Kind, account: a })}><Pencil size={16} aria-hidden /></Button>
          <Button variant="danger" aria-label={`Remover ${a.name}`} onClick={() => onRemove(a)}><Trash2 size={16} aria-hidden /></Button>
        </div>
      </div>
      {a.webhook ? <WebhookBox kind={a.kind as Kind} webhook={a.webhook} /> : null}
    </li>
  );

  return (
    <>
      <Panel title="WhatsApp oficial (API da Meta)" description="Número da sua conta do WhatsApp Business na Meta, com modelos de mensagem aprovados. Não precisa de QR code."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" aria-expanded={guide === 'whatsapp'} onClick={() => setGuide(guide === 'whatsapp' ? null : 'whatsapp')}><BookOpen size={16} aria-hidden />Passo a passo</Button>
          <Button onClick={() => setEditing({ kind: 'whatsapp_cloud', account: null })} disabled={whatsappFull}><Plus size={16} aria-hidden />Adicionar número oficial</Button>
        </div>}>
        {cloud.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhum número oficial. Comece pelo <button type="button" onClick={() => setGuide('whatsapp')} className="font-medium text-accent underline underline-offset-2">passo a passo</button>: ele mostra onde pegar cada dado na Meta.</p>
        ) : <ul className="flex flex-col">{cloud.map((a) => row(a, <BadgeCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-muted" />,
          `${a.address ? phone(a.address) : 'Número não conferido'}${a.cloud?.verifiedName ? ` · ${a.cloud.verifiedName}` : ''}${a.cloud?.quality ? ` · qualidade ${a.cloud.quality}` : ''}`))}</ul>}
      </Panel>

      <Panel title="Instagram" description="Mensagens diretas da conta profissional do Instagram nas Conversas."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" aria-expanded={guide === 'instagram'} onClick={() => setGuide(guide === 'instagram' ? null : 'instagram')}><BookOpen size={16} aria-hidden />Passo a passo</Button>
          <Button onClick={() => setEditing({ kind: 'instagram', account: null })}><Plus size={16} aria-hidden />Adicionar Instagram</Button>
        </div>}>
        {ig.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma conta. Comece pelo <button type="button" onClick={() => setGuide('instagram')} className="font-medium text-accent underline underline-offset-2">passo a passo</button>: ele mostra onde pegar cada dado na Meta.</p>
        ) : <ul className="flex flex-col">{ig.map((a) => row(a, <AtSign size={20} aria-hidden className="mt-0.5 shrink-0 text-muted" />, a.address ?? 'Conta não conferida'))}</ul>}
        <p className="mt-4 text-[13px] text-muted">O Instagram só deixa responder até 24 horas depois da última mensagem da pessoa, e não permite mensagens em massa.</p>
      </Panel>

      {guide && !editing ? <GuideSheet kind={guide} onKind={setGuide} onClose={() => setGuide(null)} /> : null}
      {editing ? <MetaDialog kind={editing.kind} account={editing.account} onClose={() => setEditing(null)}
        onSaved={(m, e) => { setEditing(null); onMessage(m, e); onChanged(); }} /> : null}
    </>
  );
}

function MetaDialog({ kind, account, onClose, onSaved }: {
  kind: Kind; account: ChannelAccount | null; onClose: () => void; onSaved: (ok: string | null, err: string | null) => void;
}) {
  const [v, setV] = useState({
    name: account?.name ?? '', phoneNumberId: account?.cloud?.phoneNumberId ?? '', wabaId: account?.cloud?.wabaId ?? '',
    igUserId: account?.instagram?.igUserId ?? '', host: account?.instagram?.host ?? 'instagram', token: '', appSecret: '', appSecret2: '', pin: '',
  });
  // Novo cadastro: o passo a passo já abre ao lado do formulário.
  const [showGuide, setShowGuide] = useState(!account);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (p: Partial<typeof v>) => setV((c) => ({ ...c, ...p }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = kind === 'whatsapp_cloud'
      ? { name: v.name, phoneNumberId: v.phoneNumberId, wabaId: v.wabaId, token: v.token || null, appSecret: v.appSecret || null, pin: v.pin || null }
      : { name: v.name, igUserId: v.igUserId, host: v.host, token: v.token || null, appSecret: v.appSecret || null, appSecret2: v.appSecret2 || null };
    const path = kind === 'whatsapp_cloud' ? 'whatsapp-cloud' : 'instagram';
    try {
      type R = { status: string; lastError: string | null; warnings?: string[]; registered?: boolean };
      const r = account
        ? await api<R>('PATCH', `/api/v1/channels/${path}/${account.id}`, body)
        : await api<R>('POST', `/api/v1/channels/${path}`, body);
      const ok = r.status === 'connected';
      onSaved(ok ? `Conta salva e conferida na Meta${r.registered ? ', com o número registrado na API' : ''}. Agora configure os avisos (abra "Configurar os avisos na Meta").` : null,
        !ok ? `Conta salva, mas a Meta recusou: ${r.lastError ?? 'erro desconhecido'}` : r.warnings?.length ? r.warnings.join(' ') : null);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  const ok = v.name.trim() && (kind === 'whatsapp_cloud' ? v.phoneNumberId && v.wabaId : v.igUserId) && (account || (v.token && v.appSecret));
  return (
    <Dialog open title={account ? `Editar ${account.name}` : kind === 'whatsapp_cloud' ? 'Adicionar número oficial do WhatsApp' : 'Adicionar Instagram'} onClose={onClose} width={showGuide ? 1200 : 640}>
      <div className={showGuide ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]' : ''}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <button type="button" onClick={() => setShowGuide((x) => !x)} aria-expanded={showGuide}
          className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-accent underline underline-offset-2">
          <BookOpen size={14} aria-hidden />{showGuide ? 'Esconder o passo a passo' : 'Mostrar o passo a passo ao lado'}
        </button>
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        <Field label="Nome da conta" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={kind === 'whatsapp_cloud' ? 'Atendimento oficial' : 'Instagram da loja'} error={err?.fieldError('name')} />
        {kind === 'whatsapp_cloud' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID do número de telefone" value={v.phoneNumberId} onChange={(e) => set({ phoneNumberId: e.target.value.trim() })} inputMode="numeric"
              hint="Passo 3: Configuração da API, no app da Meta." error={err?.fieldError('phoneNumberId')} />
            <Field label="ID da conta do WhatsApp Business" value={v.wabaId} onChange={(e) => set({ wabaId: e.target.value.trim() })} inputMode="numeric"
              hint="Passo 3: no mesmo lugar (WABA ID)." error={err?.fieldError('wabaId')} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID da conta do Instagram" value={v.igUserId} onChange={(e) => set({ igUserId: e.target.value.trim() })} inputMode="numeric" error={err?.fieldError('igUserId')}
              hint="Passo 2: aparece ao lado da conta, em Gerar tokens de acesso." />
            <Select label="Tipo de acesso" value={v.host} onChange={(e) => set({ host: e.target.value as 'instagram' | 'facebook' })}>
              <option value="instagram">API com login do Instagram</option>
              <option value="facebook">Pela página do Facebook</option>
            </Select>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={account ? 'Token de acesso (em branco: mantém)' : kind === 'whatsapp_cloud' ? 'Token de acesso permanente' : 'Token de acesso'} type="password" autoComplete="off" value={v.token}
            onChange={(e) => set({ token: e.target.value })} error={err?.fieldError('token')}
            hint={kind === 'whatsapp_cloud' ? 'Passo 5: token do usuário do sistema, com validade "Nunca".' : 'Passo 2: "Gerar token" na conta. O CRM renova sozinho.'} />
          <Field label={account ? 'Chave secreta do app (em branco: mantém)' : 'Chave secreta do app'} type="password" autoComplete="off" value={v.appSecret}
            onChange={(e) => set({ appSecret: e.target.value })} error={err?.fieldError('appSecret')}
            hint={kind === 'whatsapp_cloud' ? 'Passo 4: Configurações do app › Básico.' : 'Passo 3: Configurações do app › Básico.'} />
          {kind === 'whatsapp_cloud' ? (
            <Field label="PIN (6 dígitos)" inputMode="numeric" autoComplete="off" maxLength={6} value={v.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '') })}
              error={err?.fieldError('pin')} hint="Passo 6: registra o número na API. Preencha na primeira vez; depois, deixe em branco." />
          ) : (
            <Field label={account ? 'Segunda chave secreta (em branco: mantém)' : 'Segunda chave secreta (opcional)'} type="password" autoComplete="off" value={v.appSecret2}
              onChange={(e) => set({ appSecret2: e.target.value })} error={err?.fieldError('appSecret2')} hint="Passo 3: a chave do app do Instagram (tela da API com login do Instagram)." />
          )}
        </div>
        <p className="text-[13px] text-muted">O token e a chave ficam cifrados no banco e não aparecem de novo. Ao salvar, o CRM confere a conta na Meta.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!ok}>Salvar e conferir</Button>
        </div>
      </form>
      {showGuide ? (
        <section aria-label="Passo a passo" className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto rounded-[10px] border border-line bg-bg p-4">
          <MetaGuide kind={kind === 'instagram' ? 'instagram' : 'whatsapp'} />
        </section>
      ) : null}
      </div>
    </Dialog>
  );
}
