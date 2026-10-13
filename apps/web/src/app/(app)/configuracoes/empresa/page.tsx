'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { LoadError, Loading } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { SUB_STATUS, dateBR, limitText } from '@/lib/plans';

type Tenant = { id: string; name: string; slug: string; status: string; timezone: string; locale: string };

export default function CompanyPage() {
  const { reload: reloadSession } = useSession();
  const { data, error, loading, reload, setData } = useLoad(() => api<Tenant>('GET', '/api/v1/tenant'));
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [form, setForm] = useState<{ name: string; timezone: string; locale: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} retry={reload} />;
  const v = form ?? { name: data!.name, timezone: data!.timezone, locale: data!.locale };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const t = await api<Tenant>('PATCH', '/api/v1/tenant', v);
      setData(t);
      setForm(null);
      setSaved(true);
      void reloadSession();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
    <Panel title="Dados da empresa" description={`Identificador: ${data!.slug}`}>
      <form onSubmit={submit} noValidate className="flex max-w-lg flex-col gap-4">
        {saved ? <Alert tone="success">Alterações salvas.</Alert> : null}
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        <Field label="Nome" value={v.name} onChange={(e) => setForm({ ...v, name: e.target.value })} error={err?.fieldError('name')} />
        <Select label="Fuso horário" value={v.timezone} onChange={(e) => setForm({ ...v, timezone: e.target.value })} error={err?.fieldError('timezone')}>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </Select>
        <p className="-mt-2 text-[13px] text-muted">Usado em agendamentos, lembretes e relatórios da empresa.</p>
        <Select label="Idioma" value={v.locale} onChange={(e) => setForm({ ...v, locale: e.target.value })}>
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en-US">Inglês</option>
          <option value="es">Espanhol</option>
        </Select>
        <Button type="submit" loading={saving} disabled={!form} className="self-start">Salvar</Button>
      </form>
    </Panel>
    <PlanPanel />
    </div>
  );
}

type Subscription = {
  plan: string | null; status: string | null; currentPeriodEnd: string | null;
  limits: { key: string; label: string; value: unknown; used: number | null }[] | null;
};

/** Plano contratado, vigência e uso dos limites. Só leitura: quem muda é a plataforma ou a Greenn. */
function PlanPanel() {
  const { data, error, reload } = useLoad(() => api<Subscription>('GET', '/api/v1/subscription'));
  if (error) return <LoadError error={error} retry={reload} />;
  if (!data) return null;
  const st = data.status ? SUB_STATUS[data.status] : null;
  return (
    <Panel title="Plano" description="Para mudar de plano, fale com o suporte da WTA.">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
        <div><dt className="text-[13px] text-muted">Plano</dt><dd className="font-medium">{data.plan ?? 'Sem plano (sem limites)'}</dd></div>
        <div><dt className="text-[13px] text-muted">Situação</dt><dd>{st ? <Badge tone={st.tone}>{st.label}</Badge> : '—'}</dd></div>
        <div><dt className="text-[13px] text-muted">Vigência até</dt><dd className="font-medium">{data.currentPeriodEnd ? dateBR(data.currentPeriodEnd) : 'Sem data de término'}</dd></div>
      </dl>
      {data.limits ? (
        <table className="mt-5 w-full text-left text-sm">
          <thead><tr className="border-b border-line text-[13px] text-muted"><th className="py-2 font-medium">Recurso</th><th className="py-2 font-medium">Limite</th><th className="py-2 font-medium">Em uso</th></tr></thead>
          <tbody>
            {data.limits.map((l) => (
              <tr key={l.key} className="border-b border-line last:border-0">
                <td className="py-2">{l.label}</td>
                <td className="py-2">{limitText(l.value)}</td>
                <td className="py-2">{l.used ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Panel>
  );
}
