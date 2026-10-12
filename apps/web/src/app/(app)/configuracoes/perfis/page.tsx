'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { SCOPE_LABEL, type PermissionInfo, type Role, type Scope } from '@/lib/admin-types';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

const GROUPS: { title: string; prefixes: string[] }[] = [
  { title: 'Contatos e vendas', prefixes: ['contacts', 'leads', 'deals', 'products', 'pipelines', 'goals'] },
  { title: 'Atendimento', prefixes: ['conversations', 'tickets', 'support', 'tasks'] },
  { title: 'Marketing e mensagens', prefixes: ['scheduled', 'campaigns', 'automations'] },
  { title: 'Relatórios', prefixes: ['reports'] },
  { title: 'Administração', prefixes: ['users', 'channels', 'integrations', 'settings', 'audit', 'privacy'] },
];

export default function RolesPage() {
  const roles = useLoad(() => api<{ items: Role[] }>('GET', '/api/v1/roles').then((r) => r.items));
  const catalog = useLoad(() => api<{ items: PermissionInfo[] }>('GET', '/api/v1/permissions').then((r) => r.items));
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (roles.error) return <LoadError error={roles.error} retry={roles.reload} />;
  if (catalog.error) return <LoadError error={catalog.error} retry={catalog.reload} />;
  if (!roles.data || !catalog.data) return <Loading />;
  const current = roles.data.find((r) => r.id === selected) ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Panel title="Perfis">
        <ul className="-mx-2 flex flex-col">
          {roles.data.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { setSelected(r.id); setCreating(false); }} aria-current={r.id === selected || undefined}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-[6px] px-2 text-left ${r.id === selected ? 'bg-accent-soft font-semibold' : 'hover:bg-surface-2'}`}>
                <span className="truncate">{r.name}</span>
                <span className="text-[13px] font-normal text-muted">{r.members}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => { setCreating(true); setSelected(null); }}>Novo perfil</Button>
      </Panel>
      {creating ? (
        <RoleForm catalog={catalog.data} roles={roles.data} onDone={async (id) => { await roles.reload(); setCreating(false); setSelected(id); }} onCancel={() => setCreating(false)} />
      ) : current ? (
        <RoleForm key={current.id} role={current} catalog={catalog.data} roles={roles.data}
          onDone={async () => { await roles.reload(); }} onDeleted={async () => { setSelected(null); await roles.reload(); }} />
      ) : (
        <Panel title="Como funcionam os perfis">
          <div className="flex flex-col gap-2 text-[13px] text-muted">
            <p>Cada permissão tem um alcance: <strong className="text-ink">próprios</strong> (registros de que a pessoa é responsável), <strong className="text-ink">equipe</strong> (os das equipes dela) ou <strong className="text-ink">toda a empresa</strong>.</p>
            <p>Quem tem mais de um perfil fica com a soma deles, valendo o maior alcance.</p>
            <p>Escolha um perfil à esquerda para ver ou ajustar as permissões.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}

function RoleForm({ role, catalog, roles, onDone, onCancel, onDeleted }: {
  role?: Role; catalog: PermissionInfo[]; roles: Role[];
  onDone: (id: string) => void | Promise<void>; onCancel?: () => void; onDeleted?: () => void | Promise<void>;
}) {
  const locked = role?.key === 'admin';
  const [name, setName] = useState(role?.name ?? '');
  const [grants, setGrants] = useState<Record<string, Scope>>(role?.grants ?? {});
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const byGroup = useMemo(() => GROUPS.map((g) => ({ ...g, items: catalog.filter((p) => g.prefixes.includes(p.key.split(':')[0]!)) })), [catalog]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = role
        ? await api<Role>('PATCH', `/api/v1/roles/${role.id}`, { name, grants })
        : await api<Role>('POST', '/api/v1/roles', { name, grants });
      setMsg('Perfil salvo. As permissões já valem para quem tem este perfil.');
      await onDone(r.id);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!role) return;
    setBusy(true);
    try {
      await api('DELETE', `/api/v1/roles/${role.id}`);
      await onDeleted?.();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível excluir.'));
    } finally {
      setBusy(false);
      setAskDelete(false);
    }
  }

  return (
    <Panel title={role ? role.name : 'Novo perfil'}
      description={role ? `${role.members} ${role.members === 1 ? 'pessoa' : 'pessoas'} com este perfil${role.isSystem ? ' · perfil padrão' : ''}` : 'Escolha o nome e as permissões.'}
      actions={role && !role.isSystem ? <Button variant="danger" onClick={() => setAskDelete(true)}>Excluir</Button> : null}>
      <form onSubmit={save} noValidate className="flex flex-col gap-5">
        {locked ? <Alert tone="info">O perfil Administrador tem todas as permissões e não pode ser alterado, para a empresa nunca perder o controle.</Alert> : null}
        {msg ? <Alert tone="success">{msg}</Alert> : null}
        {err && !err.fieldError('name') ? <Alert tone="error">{err.title}</Alert> : null}
        {!role ? (
          <Select label="Começar a partir de" defaultValue="" onChange={(e) => { const base = roles.find((r) => r.id === e.target.value); setGrants(base ? { ...base.grants } : {}); }}>
            <option value="">Nenhuma permissão</option>
            {roles.filter((r) => r.key !== 'admin').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        ) : null}
        <Field label="Nome do perfil" value={name} onChange={(e) => setName(e.target.value)} disabled={locked} error={err?.fieldError('name')} className="max-w-sm" />
        {byGroup.map((g) => (
          <fieldset key={g.title} className="flex flex-col">
            <legend className="mb-1 text-sm font-semibold">{g.title}</legend>
            {g.items.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <span className="text-sm">{p.label}</span>
                <select aria-label={p.label} value={grants[p.key] ?? ''} disabled={locked}
                  onChange={(e) => { const n = { ...grants }; if (e.target.value) n[p.key] = e.target.value as Scope; else delete n[p.key]; setGrants(n); }}
                  className="h-9 rounded-[6px] border border-line-strong bg-surface px-2 text-[13px]">
                  <option value="">Sem acesso</option>
                  {p.scopes.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                </select>
              </div>
            ))}
          </fieldset>
        ))}
        {!locked ? (
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!name.trim()}>Salvar perfil</Button>
            {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button> : null}
          </div>
        ) : null}
      </form>
      {role ? (
        <Confirm open={askDelete} title={`Excluir o perfil ${role.name}?`} confirmLabel="Excluir perfil" loading={busy}
          onConfirm={remove} onCancel={() => setAskDelete(false)}>
          Só é possível excluir um perfil que ninguém usa.
        </Confirm>
      ) : null}
      {role?.isSystem && !locked ? <p className="mt-3 text-[13px] text-muted"><Badge tone="neutral">Perfil padrão</Badge> Pode ser ajustado, mas não excluído.</p> : null}
    </Panel>
  );
}
