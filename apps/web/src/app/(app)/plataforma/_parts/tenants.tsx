'use client';
import { useState, type FormEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateOnly } from '@/lib/admin-types';
import { SUB_STATUS, dateBR } from '@/lib/plans';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { LoadError, Loading } from '@/components/ui/states';
import type { Plan } from './plans';

export type TenantRow = {
  id: string; name: string; slug: string; status: 'active' | 'suspended' | 'archived'; createdAt: string;
  contactName: string | null; contactEmail: string | null; phone: string | null; document: string | null; notes: string | null;
  subscription: {
    planId: string | null; planName: string | null; status: string; currentPeriodEnd: string | null; source: string;
    customerEmail: string | null; notes: string | null;
  } | null;
  domain: { domain: string; dnsOk: boolean; routingOk: boolean } | null;
};

const STATUS: Record<TenantRow['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  active: { label: 'Ativa', tone: 'ok' },
  suspended: { label: 'Suspensa', tone: 'warn' },
  archived: { label: 'Arquivada', tone: 'neutral' },
};

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

export function TenantsTab() {
  const tenants = useLoad(() => api<{ items: TenantRow[] }>('GET', '/api/v1/platform/tenants').then((r) => r.items));
  const plans = useLoad(() => api<{ items: Plan[] }>('GET', '/api/v1/platform/plans').then((r) => r.items));
  const [change, setChange] = useState<{ t: TenantRow; to: TenantRow['status'] } | null>(null);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [removing, setRemoving] = useState<TenantRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (tenants.error) return <LoadError error={tenants.error} retry={tenants.reload} />;

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
    <div className="flex flex-col gap-5">
      <NewTenant onDone={() => void tenants.reload()} />
      <Panel title="Empresas">
        {err ? <div className="mb-3"><Alert tone="error">{err}</Alert></div> : null}
        {msg ? <div className="mb-3"><Alert tone="success">{msg}</Alert></div> : null}
        {!tenants.data ? <Loading /> : (
          <ul className="flex flex-col">
            {tenants.data.map((t) => {
              const sub = t.subscription;
              const st = sub ? SUB_STATUS[sub.status] : null;
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{t.name} <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></p>
                    <p className="text-[13px] text-muted">
                      {t.slug} · desde {dateOnly.format(new Date(t.createdAt))}{t.contactEmail ? ` · ${t.contactEmail}` : ''}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-medium">{sub?.planName ?? 'Sem plano'}</span>
                      {st ? <Badge tone={st.tone}>{st.label}</Badge> : null}
                      {sub?.currentPeriodEnd ? <span className="text-muted">até {dateBR(sub.currentPeriodEnd)}</span> : null}
                      {sub?.source === 'greenn' ? <Badge tone="info">Greenn</Badge> : null}
                      {t.domain ? <span className="text-muted">· {t.domain.domain}{t.domain.routingOk ? '' : ' (pendente)'}</span> : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => { setMsg(null); setEditing(t); }} aria-label={`Editar ${t.name}`}><Pencil size={16} aria-hidden />Editar</Button>
                    {t.status === 'active'
                      ? <Button variant="danger" onClick={() => setChange({ t, to: 'suspended' })}>Suspender</Button>
                      : <Button variant="secondary" onClick={() => setChange({ t, to: 'active' })}>Reativar</Button>}
                    {t.slug !== 'wta'
                      ? <Button variant="danger" onClick={() => setRemoving(t)} aria-label={`Excluir ${t.name}`}><Trash2 size={16} aria-hidden /></Button>
                      : null}
                  </div>
                </li>
              );
            })}
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

      {editing ? (
        <EditTenant tenant={editing} plans={plans.data ?? []} onClose={() => setEditing(null)}
          onSaved={(t) => { setEditing(t); void tenants.reload(); }} />
      ) : null}
      {removing ? (
        <RemoveTenant tenant={removing} onClose={() => setRemoving(null)}
          onDone={() => { setMsg(`${removing.name} foi excluída.`); setRemoving(null); void tenants.reload(); }} />
      ) : null}
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
    <Panel title="Nova empresa" description="A empresa nasce com os perfis padrão, e o administrador indicado recebe um convite por e-mail. Compras pela Greenn criam a empresa sozinhas.">
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

/** Data (AAAA-MM-DD) do fim da vigência, no horário de Brasília. */
function toDateInput(v: string | null | undefined): string {
  if (!v) return '';
  return new Date(v).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function EditTenant({ tenant, plans, onClose, onSaved }: {
  tenant: TenantRow; plans: Plan[]; onClose: () => void; onSaved: (t: TenantRow) => void;
}) {
  const [data, setData] = useState({
    name: tenant.name, contactName: tenant.contactName ?? '', contactEmail: tenant.contactEmail ?? '',
    phone: tenant.phone ?? '', document: tenant.document ?? '', notes: tenant.notes ?? '',
  });
  const [sub, setSub] = useState({
    planId: tenant.subscription?.planId ?? '', status: tenant.subscription?.status ?? 'active',
    end: toDateInput(tenant.subscription?.currentPeriodEnd),
  });
  const [busy, setBusy] = useState<'data' | 'sub' | 'invite' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  async function run(kind: 'data' | 'sub' | 'invite', fn: () => Promise<string>) {
    setBusy(kind);
    setErr(null);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(null);
    }
  }

  const saveData = (e: FormEvent) => {
    e.preventDefault();
    void run('data', async () => {
      const t = await api<TenantRow>('PATCH', `/api/v1/platform/tenants/${tenant.id}`, {
        ...data, contactEmail: data.contactEmail.trim() || null,
      });
      onSaved(t);
      return 'Dados salvos.';
    });
  };

  const saveSub = (e: FormEvent) => {
    e.preventDefault();
    void run('sub', async () => {
      const t = await api<TenantRow>('PUT', `/api/v1/platform/tenants/${tenant.id}/subscription`, {
        planId: sub.planId || null, status: sub.status,
        currentPeriodEnd: sub.end ? `${sub.end}T23:59:59-03:00` : null,
      });
      onSaved(t);
      return 'Assinatura salva.';
    });
  };

  const invite = () => run('invite', async () => {
    const r = await api<{ email: string }>('POST', `/api/v1/platform/tenants/${tenant.id}/invite-admin`,
      data.contactEmail.trim() ? { email: data.contactEmail.trim() } : {});
    return `Convite de administrador enviado para ${r.email}.`;
  });

  return (
    <Dialog open title={`Editar ${tenant.name}`} description={`Identificador: ${tenant.slug}`} onClose={onClose} width={720}>
      <div className="flex flex-col gap-6">
        {msg ? <Alert tone="success">{msg}</Alert> : null}
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}

        <form onSubmit={saveData} noValidate className="flex flex-col gap-4">
          <h3 className="font-semibold">Dados e contato</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da empresa" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} error={err?.fieldError('name')} />
            <Field label="CPF ou CNPJ" value={data.document} onChange={(e) => setData({ ...data, document: e.target.value })} error={err?.fieldError('document')} />
            <Field label="Nome do responsável" value={data.contactName} onChange={(e) => setData({ ...data, contactName: e.target.value })} error={err?.fieldError('contactName')} />
            <Field label="E-mail do responsável" type="email" value={data.contactEmail} onChange={(e) => setData({ ...data, contactEmail: e.target.value })}
              error={err?.fieldError('contactEmail')} hint="Usado no convite de administrador e para casar compras da Greenn." />
            <Field label="Telefone" value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} error={err?.fieldError('phone')} />
          </div>
          <Textarea label="Observações internas" rows={3} value={data.notes} onChange={(e) => setData({ ...data, notes: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === 'data'}>Salvar dados</Button>
            <Button type="button" variant="secondary" loading={busy === 'invite'} onClick={invite} disabled={!data.contactEmail.trim()}>
              Enviar convite de administrador
            </Button>
          </div>
        </form>

        <form onSubmit={saveSub} noValidate className="flex flex-col gap-4 border-t border-line pt-5">
          <div>
            <h3 className="font-semibold">Assinatura</h3>
            <p className="text-[13px] text-muted">
              {tenant.subscription?.source === 'greenn'
                ? `Alimentada pela Greenn${tenant.subscription.customerEmail ? ` (comprador ${tenant.subscription.customerEmail})` : ''}. Uma mudança aqui vale até o próximo aviso da Greenn.`
                : 'Controle manual. Vencida a vigência, a empresa é suspensa sozinha; uma nova data em dia a reativa.'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Plano" value={sub.planId} onChange={(e) => setSub({ ...sub, planId: e.target.value })} error={err?.fieldError('planId')}>
              <option value="">Sem plano (sem limites)</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inativo)'}</option>)}
            </Select>
            <Select label="Situação" value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}>
              {Object.entries(SUB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Field label="Vigência até" type="date" value={sub.end} onChange={(e) => setSub({ ...sub, end: e.target.value })}
              error={err?.fieldError('currentPeriodEnd')} hint="Vazio: sem data de término." />
          </div>
          <Button type="submit" loading={busy === 'sub'} className="self-start">Salvar assinatura</Button>
        </form>
      </div>
    </Dialog>
  );
}

function RemoveTenant({ tenant, onClose, onDone }: { tenant: TenantRow; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/api/v1/platform/tenants/${tenant.id}/delete`, { confirm });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível excluir.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={`Excluir ${tenant.name}?`} onClose={onClose} width={480}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Alert tone="error">
          Apaga para sempre a empresa e tudo dela: contatos, negócios, leads, agenda, arquivos, usuários e histórico. Não há como desfazer.
          Para só bloquear o acesso, use Suspender.
        </Alert>
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        <Field label={`Digite ${tenant.slug} para confirmar`} value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off" error={err?.fieldError('confirm')} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="danger" loading={busy} disabled={confirm !== tenant.slug}><Trash2 size={16} aria-hidden />Excluir definitivamente</Button>
        </div>
      </form>
    </Dialog>
  );
}
