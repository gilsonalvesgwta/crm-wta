'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/components/shell/session';
import { useNewPassword } from '@/components/auth/new-password';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

export default function AccountPage() {
  const { me } = useSession();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Conta e segurança</h1>
        <p className="text-muted">{me.user.name} · {me.user.email}</p>
      </div>
      <TwoFactor />
      <ChangePassword />
      <Sessions />
    </div>
  );
}

function ChangePassword() {
  const pw = useNewPassword();
  const [current, setCurrent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [key, setKey] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    pw.touch();
    if (!pw.valid) return;
    setLoading(true);
    setError(null);
    setDone(false);
    try {
      await api('POST', '/api/v1/auth/password/change', { currentPassword: current, newPassword: pw.password });
      setDone(true);
      setCurrent('');
      setKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Algo deu errado.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Senha" description="Trocar a senha encerra as suas outras sessões abertas.">
      <form key={key} onSubmit={submit} noValidate className="flex max-w-sm flex-col gap-4">
        {done ? <Alert tone="success">Senha trocada.</Alert> : null}
        {error && error.errors.length === 0 ? <Alert tone="error">{error.title}</Alert> : null}
        <Field label="Senha atual" type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} error={error?.fieldError('currentPassword')} />
        {pw.render(error?.fieldError('newPassword'))}
        <Button type="submit" variant="secondary" loading={loading} className="self-start">Trocar senha</Button>
      </form>
    </Panel>
  );
}

function TwoFactor() {
  const { me, reload } = useSession();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ secret: string; otpauthUri: string }>('POST', '/api/v1/auth/mfa/setup');
      const qr = await QRCode.toString(r.otpauthUri, { type: 'svg', margin: 1, width: 184, color: { dark: '#051628', light: '#FFFFFF' } });
      setSetup({ secret: r.secret, qr });
    } catch (err) {
      setError(err instanceof ApiError ? err.title : 'Não foi possível começar.');
    } finally {
      setLoading(false);
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>('POST', '/api/v1/auth/mfa/enable', { code });
      setCodes(r.recoveryCodes);
      setSetup(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.title : 'Não foi possível ativar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="dois-fatores">
      <Panel
        title="Verificação em duas etapas"
        description="Além da senha, o login pede um código do aplicativo autenticador do celular."
        actions={me.mfa.enabled ? <Badge tone="ok">Ativa</Badge> : <Badge tone="warn">Desligada</Badge>}
      >
        {codes ? (
          <div className="flex flex-col gap-3">
            <Alert tone="success">Verificação ativada.</Alert>
            <p className="font-medium">Guarde estes códigos de recuperação em lugar seguro.</p>
            <p className="text-[13px] text-muted">Cada um vale uma vez, para entrar se você perder o celular. Eles não serão mostrados de novo.</p>
            <ul className="grid grid-cols-2 gap-2 rounded-[8px] border border-line bg-surface-2 p-3 font-mono text-sm sm:grid-cols-5">
              {codes.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>Copiar códigos</Button>
              <Button onClick={() => { setCodes(null); void reload(); }}>Já guardei</Button>
            </div>
          </div>
        ) : me.mfa.enabled ? (
          <DisableTwoFactor />
        ) : setup ? (
          <form onSubmit={enable} noValidate className="flex flex-col gap-4">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] text-muted">
              <li>Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password ou outro).</li>
              <li>Leia o QR code ou digite a chave.</li>
              <li>Informe o código de 6 dígitos que aparecer.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-5">
              <div className="rounded-[8px] border border-line bg-white p-2" role="img" aria-label="QR code para o aplicativo autenticador"
                dangerouslySetInnerHTML={{ __html: setup.qr }} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[13px] text-muted">Chave para digitar</p>
                <code className="break-all font-mono text-sm">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
              </div>
            </div>
            <div className="flex max-w-xs flex-col gap-3">
              <Field label="Código de 6 dígitos" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button type="submit" loading={loading} disabled={code.length !== 6} className="self-start">Ativar</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-start gap-3">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Button onClick={start} loading={loading}>Configurar</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

const ADMIN_PERMS = ['users:admin', 'settings:admin'];

function DisableTwoFactor() {
  const { me, can, reload } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  if (me.user.isPlatformAdmin || ADMIN_PERMS.some(can)) {
    return <p className="text-[13px] text-muted">Sua conta está protegida. Administradores precisam manter a verificação ativa.</p>;
  }
  if (!open) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-muted">Sua conta está protegida.</p>
        <Button variant="danger" onClick={() => setOpen(true)}>Desativar</Button>
      </div>
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('POST', '/api/v1/auth/mfa/disable', { password });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Não foi possível desativar.'));
      setLoading(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="flex max-w-sm flex-col gap-3">
      <Alert tone="warning">Sem a verificação, só a senha protege sua conta.</Alert>
      {error && error.errors.length === 0 ? <Alert tone="error">{error.title}</Alert> : null}
      <Field label="Confirme sua senha" type="password" autoComplete="current-password" value={password}
        onChange={(e) => setPassword(e.target.value)} error={error?.fieldError('currentPassword')} />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={loading}>Desativar verificação</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </form>
  );
}

type SessionRow = { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; current: boolean };

function describeAgent(ua: string | null): string {
  if (!ua) return 'Navegador desconhecido';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} no ${os}` : browser;
}

function Sessions() {
  const [items, setItems] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const load = useCallback(() => {
    api<{ items: SessionRow[] }>('GET', '/api/v1/auth/sessions')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.title : 'Não foi possível carregar as sessões.'));
  }, []);
  useEffect(load, [load]);

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api('DELETE', `/api/v1/auth/sessions/${id}`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.title : 'Não foi possível encerrar.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Sessões abertas" description="Encerre as que você não reconhece.">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!items && !error ? <Spinner label="Carregando" /> : null}
      {items ? (
        <ul className="flex flex-col">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <p className="font-medium">{describeAgent(s.userAgent)} {s.current ? <Badge tone="ok">Esta sessão</Badge> : null}</p>
                <p className="text-[13px] text-muted">{s.ip ?? 'IP desconhecido'} · último acesso {fmt.format(new Date(s.lastSeenAt))}</p>
              </div>
              {!s.current ? (
                <Button variant="danger" loading={busy === s.id} onClick={() => revoke(s.id)}>Encerrar</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
