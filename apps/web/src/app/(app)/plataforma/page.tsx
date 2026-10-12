'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateOnly } from '@/lib/admin-types';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

type TenantRow = { id: string; name: string; slug: string; status: 'active' | 'suspended' | 'archived'; createdAt: string };

const STATUS: Record<TenantRow['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  active: { label: 'Ativa', tone: 'ok' },
  suspended: { label: 'Suspensa', tone: 'warn' },
  archived: { label: 'Arquivada', tone: 'neutral' },
};

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

export default function PlatformPage() {
  const { me } = useSession();
  const tenants = useLoad(() => api<{ items: TenantRow[] }>('GET', '/api/v1/platform/tenants').then((r) => r.items));
  const [change, setChange] = useState<{ t: TenantRow; to: TenantRow['status'] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!me.user.isPlatformAdmin) return <LoadError error={new ApiError(404, 'not-found', '')} />;
  if (tenants.error) return <div className="mx-auto max-w-5xl"><LoadError error={tenants.error} retry={tenants.reload} /></div>;

  async function apply() {
    if (!change) return;
    setBusy(true);
    setErr(null);
    try {
      await api('PATCH', `/api/v1/platform/tenants/${change.t.id}`, { status: change.to });
      await tenants.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível alterar.');
    } finally {
      setBusy(false);
      setChange(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Plataforma</h1>
        <p className="text-muted">Empresas que usam o CRM. Daqui não se veem os dados delas.</p>
      </div>
      <NewTenant onDone={() => void tenants.reload()} />
      <Panel title="Empresas">
        {err ? <div className="mb-3"><Alert tone="error">{err}</Alert></div> : null}
        {!tenants.data ? <Loading /> : (
          <ul className="flex flex-col">
            {tenants.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{t.name} <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></p>
                  <p className="text-[13px] text-muted">{t.slug} · desde {dateOnly.format(new Date(t.createdAt))}</p>
                </div>
                <div className="flex gap-2">
                  {t.status === 'active'
                    ? <Button variant="danger" onClick={() => setChange({ t, to: 'suspended' })}>Suspender</Button>
                    : <Button variant="secondary" onClick={() => setChange({ t, to: 'active' })}>Reativar</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Confirm open={!!change} title={change?.to === 'suspended' ? `Suspender ${change?.t.name}?` : `Reativar ${change?.t.name}?`}
        confirmLabel={change?.to === 'suspended' ? 'Suspender' : 'Reativar'} danger={change?.to === 'suspended'} loading={busy}
        onConfirm={apply} onCancel={() => setChange(null)}>
        {change?.to === 'suspended'
          ? 'Ninguém da empresa consegue entrar enquanto ela estiver suspensa, e as sessões abertas deixam de valer. Os dados ficam guardados.'
          : 'As pessoas da empresa voltam a entrar normalmente.'}
      </Confirm>
    </div>
  );
}

function NewTenant({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const s = slug ?? slugify(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api('POST', '/api/v1/platform/tenants', { name, slug: s, adminEmail: email });
      setMsg(`Empresa criada. ${email.trim().toLowerCase()} recebeu o convite de administrador.`);
      setName(''); setSlug(null); setEmail('');
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível criar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Nova empresa" description="A empresa nasce com os perfis padrão, e o administrador indicado recebe um convite por e-mail.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {msg ? <Alert tone="success">{msg}</Alert> : null}
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Nome da empresa" value={name} onChange={(e) => setName(e.target.value)} error={err?.fieldError('name')} />
          <Field label="Identificador" value={s} onChange={(e) => setSlug(e.target.value)} error={err?.fieldError('slug')} hint="Letras minúsculas, números e hífen." />
          <Field label="E-mail do administrador" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err?.fieldError('adminEmail')} />
        </div>
        <Button type="submit" loading={busy} disabled={!name || !s || !email} className="self-start">Criar empresa</Button>
      </form>
    </Panel>
  );
}
