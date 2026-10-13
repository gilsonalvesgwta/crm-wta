'use client';
import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { LIMITS, PERIODS, limitText, money } from '@/lib/plans';
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

export type Offer = { id: string; externalProduct: string; label: string | null; durationDays: number | null };
export type Plan = {
  id: string; name: string; description: string | null; priceCents: number; currency: string;
  billingPeriod: 'monthly' | 'quarterly' | 'yearly' | 'one_time'; durationDays: number;
  limits: Record<string, number | boolean | null>; active: boolean; position: number; tenantCount: number; offers: Offer[];
};

const DURATION: Record<Plan['billingPeriod'], number> = { monthly: 30, quarterly: 90, yearly: 365, one_time: 365 };

export function PlansTab() {
  const plans = useLoad(() => api<{ items: Plan[] }>('GET', '/api/v1/platform/plans').then((r) => r.items));
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [removing, setRemoving] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (plans.error) return <LoadError error={plans.error} retry={plans.reload} />;

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setErr(null);
    try {
      await api('DELETE', `/api/v1/platform/plans/${removing.id}`);
      await plans.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.');
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  const current = editing && editing !== 'new' ? plans.data?.find((p) => p.id === editing.id) ?? editing : editing;

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Planos" description="O que cada empresa pode usar. Campo de número vazio quer dizer sem limite."
        actions={<Button onClick={() => setEditing('new')}><Plus size={16} aria-hidden />Novo plano</Button>}>
        {err ? <div className="mb-3"><Alert tone="error">{err}</Alert></div> : null}
        {!plans.data ? <Loading /> : plans.data.length === 0 ? (
          <p className="text-muted">Nenhum plano ainda. Crie o primeiro e ligue-o aos produtos da Greenn.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.data.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-[8px] border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold">{p.name}{p.active ? null : <Badge>Inativo</Badge>}</p>
                    <p className="text-[13px] text-muted">{money(p.priceCents, p.currency)} · {PERIODS[p.billingPeriod]} · {p.durationDays} dias</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}><Pencil size={16} aria-hidden /></Button>
                    <Button variant="ghost" aria-label={`Excluir ${p.name}`} onClick={() => setRemoving(p)}><Trash2 size={16} aria-hidden /></Button>
                  </div>
                </div>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
                  {LIMITS.map((l) => (
                    <div key={l.key} className="contents">
                      <dt className="text-muted">{l.label}</dt>
                      <dd className="text-right font-medium">{limitText(l.kind === 'bool' ? !!p.limits[l.key] : p.limits[l.key] ?? null)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-[13px] text-muted">
                  {p.tenantCount} {p.tenantCount === 1 ? 'empresa' : 'empresas'} ·{' '}
                  {p.offers.length ? `Greenn: ${p.offers.map((o) => o.externalProduct).join(', ')}` : 'sem produto da Greenn'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {current ? (
        <EditPlan plan={current === 'new' ? null : current} onClose={() => setEditing(null)}
          onSaved={(p) => { setEditing(p); void plans.reload(); }} />
      ) : null}
      <Confirm open={!!removing} title={`Excluir o plano ${removing?.name}?`} confirmLabel="Excluir" loading={busy}
        onConfirm={remove} onCancel={() => setRemoving(null)}>
        {removing?.tenantCount ? 'Há empresas neste plano: a exclusão será recusada. Desative o plano para parar de vendê-lo.' : 'Os produtos da Greenn ligados a ele deixam de ativar empresas.'}
      </Confirm>
    </div>
  );
}

type LimitDraft = Record<string, string | boolean>;

function EditPlan({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: (p: Plan) => void }) {
  const [f, setF] = useState({
    name: plan?.name ?? '', description: plan?.description ?? '',
    price: plan ? (plan.priceCents / 100).toFixed(2).replace('.', ',') : '',
    billingPeriod: plan?.billingPeriod ?? 'monthly' as Plan['billingPeriod'],
    durationDays: String(plan?.durationDays ?? 30), active: plan?.active ?? true,
  });
  const [limits, setLimits] = useState<LimitDraft>(() => Object.fromEntries(LIMITS.map((l) => [l.key,
    l.kind === 'bool' ? !!plan?.limits[l.key] : plan?.limits[l.key] == null ? '' : String(plan.limits[l.key])])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(f.price.replace(/\./g, '').replace(',', '.') || '0') * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setErr(new ApiError(422, 'validation', 'Ajuste o preço.', [{ field: 'priceCents', message: 'Use um valor como 97,00.' }]));
      return;
    }
    const lim: Record<string, number | boolean | null> = {};
    for (const l of LIMITS) {
      const v = limits[l.key];
      lim[l.key] = l.kind === 'bool' ? !!v : v === '' ? null : Number(v);
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const body = {
        name: f.name, description: f.description, priceCents: cents, billingPeriod: f.billingPeriod,
        durationDays: Number(f.durationDays), limits: lim, active: f.active,
      };
      const p = plan ? await api<Plan>('PATCH', `/api/v1/platform/plans/${plan.id}`, body) : await api<Plan>('POST', '/api/v1/platform/plans', body);
      setMsg('Plano salvo.');
      onSaved(p);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }

  const limitErr = (k: string) => err?.fieldError(`limits.${k}`);

  return (
    <Dialog open title={plan ? `Plano ${plan.name}` : 'Novo plano'} onClose={onClose} width={720}>
      <div className="flex flex-col gap-6">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {msg ? <Alert tone="success">{msg}</Alert> : null}
          {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={err?.fieldError('name')} />
            <Field label="Preço (R$)" inputMode="decimal" value={f.price} placeholder="97,00" onChange={(e) => setF({ ...f, price: e.target.value })} error={err?.fieldError('priceCents')} />
            <Select label="Cobrança" value={f.billingPeriod}
              onChange={(e) => { const bp = e.target.value as Plan['billingPeriod']; setF({ ...f, billingPeriod: bp, durationDays: String(DURATION[bp]) }); }}>
              {Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Field label="Dias de acesso por pagamento" type="number" min={1} value={f.durationDays}
              onChange={(e) => setF({ ...f, durationDays: e.target.value })} error={err?.fieldError('durationDays')}
              hint="Vale para compras avulsas. Assinaturas da Greenn seguem a data do próximo pagamento." />
          </div>
          <Textarea label="Descrição" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 font-semibold">Limites e recursos</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {LIMITS.filter((l) => l.kind === 'number').map((l) => (
                <Field key={l.key} label={l.label} type="number" min={0} placeholder="Sem limite" value={String(limits[l.key])}
                  onChange={(e) => setLimits({ ...limits, [l.key]: e.target.value })} error={limitErr(l.key)} />
              ))}
            </div>
            {LIMITS.filter((l) => l.kind === 'bool').map((l) => (
              <label key={l.key} className="flex min-h-11 items-center gap-2.5">
                <input type="checkbox" checked={!!limits[l.key]} className="size-[18px] accent-[var(--primary)]"
                  onChange={(e) => setLimits({ ...limits, [l.key]: e.target.checked })} />
                {l.label}
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-11 items-center gap-2.5">
            <input type="checkbox" checked={f.active} className="size-[18px] accent-[var(--primary)]" onChange={(e) => setF({ ...f, active: e.target.checked })} />
            Plano ativo (disponível para novas empresas e compras)
          </label>
          <Button type="submit" loading={busy} className="self-start">{plan ? 'Salvar plano' : 'Criar plano'}</Button>
        </form>
        {plan ? <Offers plan={plan} onChanged={() => onSaved(plan)} /> : <p className="text-[13px] text-muted">Depois de criar, ligue o plano aos produtos da Greenn.</p>}
      </div>
    </Dialog>
  );
}

function Offers({ plan, onChanged }: { plan: Plan; onChanged: () => void }) {
  const [f, setF] = useState({ externalProduct: '', label: '', durationDays: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy('add');
    setErr(null);
    try {
      await api('POST', `/api/v1/platform/plans/${plan.id}/offers`, {
        externalProduct: f.externalProduct.trim(), label: f.label, durationDays: f.durationDays ? Number(f.durationDays) : null,
      });
      setF({ externalProduct: '', label: '', durationDays: '' });
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível ligar o produto.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setErr(null);
    try {
      await api('DELETE', `/api/v1/platform/offers/${id}`);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível remover.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div>
        <h3 className="font-semibold">Produtos da Greenn</h3>
        <p className="text-[13px] text-muted">A compra paga de um destes produtos ativa ou renova a empresa neste plano. O código fica na Greenn, em Produtos (o número do produto).</p>
      </div>
      {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
      {plan.offers.length ? (
        <ul className="flex flex-col">
          {plan.offers.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
              <span><span className="font-mono">{o.externalProduct}</span>{o.label ? ` · ${o.label}` : ''}{o.durationDays ? ` · ${o.durationDays} dias` : ''}</span>
              <Button variant="ghost" aria-label={`Remover produto ${o.externalProduct}`} loading={busy === o.id} onClick={() => remove(o.id)}><Trash2 size={16} aria-hidden /></Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">Nenhum produto ligado.</p>}
      <form onSubmit={add} noValidate className="grid items-start gap-3 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
        <Field label="Código do produto" value={f.externalProduct} onChange={(e) => setF({ ...f, externalProduct: e.target.value })} error={err?.fieldError('externalProduct')} />
        <Field label="Descrição (opcional)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <Field label="Dias (opcional)" type="number" min={1} value={f.durationDays} placeholder={String(plan.durationDays)} onChange={(e) => setF({ ...f, durationDays: e.target.value })} error={err?.fieldError('durationDays')} />
        <Button type="submit" variant="secondary" loading={busy === 'add'} disabled={!f.externalProduct.trim()} className="sm:mt-[26px]">Ligar</Button>
      </form>
    </div>
  );
}
