'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateOnly, dateTime, type Invitation, type Member, type Role } from '@/lib/admin-types';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Empty, LoadError, Loading } from '@/components/ui/states';

export default function UsersPage() {
  const members = useLoad(() => api<{ items: Member[] }>('GET', '/api/v1/members').then((r) => r.items));
  const invites = useLoad(() => api<{ items: Invitation[] }>('GET', '/api/v1/invitations').then((r) => r.items));
  const roles = useLoad(() => api<{ items: Role[] }>('GET', '/api/v1/roles').then((r) => r.items));

  if (members.error) return <LoadError error={members.error} retry={members.reload} />;
  return (
    <div className="flex flex-col gap-5">
      <InviteForm roles={roles.data ?? []} onDone={() => void invites.reload()} />
      <Invitations items={invites.data} loading={invites.loading} onChange={() => void invites.reload()} />
      <Members items={members.data} roles={roles.data ?? []} loading={members.loading} onChange={() => void members.reload()} />
    </div>
  );
}

function InviteForm({ roles, onDone }: { roles: Role[]; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const role = roleId || roles.find((r) => r.key === 'sales')?.id || roles[0]?.id || '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setMsg(null);
    try {
      await api('POST', '/api/v1/invitations', { email, roleId: role });
      setMsg(`Convite enviado para ${email.trim().toLowerCase()}. O link vale por 7 dias.`);
      setEmail('');
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível convidar.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Convidar pessoa" description="A pessoa recebe um e-mail para criar a conta e entrar nesta empresa.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {msg ? <Alert tone="success">{msg}</Alert> : null}
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
          <Field label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err?.fieldError('email')} />
          <Select label="Perfil" value={role} onChange={(e) => setRoleId(e.target.value)} error={err?.fieldError('roleId')}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Button type="submit" loading={loading} disabled={!email || !role}>Convidar</Button>
        </div>
      </form>
    </Panel>
  );
}

function Invitations({ items, loading, onChange }: { items: Invitation[] | null; loading: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [cancel, setCancel] = useState<Invitation | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !items) return null;
  if (!items || items.length === 0) return null;

  async function resend(i: Invitation) {
    setBusy(i.id);
    try {
      await api('POST', `/api/v1/invitations/${i.id}/resend`);
      setMsg(`Convite reenviado para ${i.email}. O link anterior deixou de valer.`);
      onChange();
    } finally {
      setBusy(null);
    }
  }
  async function revoke() {
    if (!cancel) return;
    setBusy(cancel.id);
    try {
      await api('DELETE', `/api/v1/invitations/${cancel.id}`);
      setMsg(`Convite de ${cancel.email} cancelado.`);
      onChange();
    } finally {
      setBusy(null);
      setCancel(null);
    }
  }

  return (
    <Panel title="Convites pendentes">
      {msg ? <div className="mb-3"><Alert tone="info">{msg}</Alert></div> : null}
      <ul className="flex flex-col">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
            <div className="min-w-0">
              <p className="font-medium">{i.email}</p>
              <p className="text-[13px] text-muted">{i.roleName ?? 'Sem perfil'} · vale até {dateOnly.format(new Date(i.expiresAt))}{i.invitedBy ? ` · convidado por ${i.invitedBy}` : ''}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" loading={busy === i.id} onClick={() => resend(i)}>Reenviar</Button>
              <Button variant="danger" onClick={() => setCancel(i)}>Cancelar</Button>
            </div>
          </li>
        ))}
      </ul>
      <Confirm open={!!cancel} title="Cancelar o convite?" confirmLabel="Cancelar convite" loading={busy === cancel?.id}
        onConfirm={revoke} onCancel={() => setCancel(null)}>
        O link enviado para {cancel?.email} deixa de valer.
      </Confirm>
    </Panel>
  );
}

function Members({ items, roles, loading, onChange }: { items: Member[] | null; roles: Role[]; loading: boolean; onChange: () => void }) {
  const { me } = useSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [toggle, setToggle] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  if (loading && !items) return <Panel title="Usuários"><Loading /></Panel>;
  const list = (items ?? []).filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(query.trim().toLowerCase()));

  async function setStatus() {
    if (!toggle) return;
    setBusy(true);
    setErr(null);
    try {
      await api('PATCH', `/api/v1/members/${toggle.membershipId}`, { status: toggle.status === 'active' ? 'disabled' : 'active' });
      onChange();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível alterar.');
    } finally {
      setBusy(false);
      setToggle(null);
    }
  }

  return (
    <Panel title="Usuários" description={`${items?.filter((m) => m.status === 'active').length ?? 0} com acesso ativo`}
      actions={<input type="search" aria-label="Buscar usuários" placeholder="Buscar por nome ou e-mail" value={query}
        onChange={(e) => setQuery(e.target.value)} className="h-10 w-64 max-w-full rounded-[6px] border border-line bg-surface-2 px-3 text-sm" />}>
      {err ? <div className="mb-3"><Alert tone="error">{err}</Alert></div> : null}
      {list.length === 0 ? (
        <Empty title={query ? `Nenhum usuário encontrado para "${query}"` : 'Nenhum usuário'}>
          {query ? <button type="button" className="font-medium text-accent" onClick={() => setQuery('')}>Limpar a busca</button> : null}
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-line text-[12px] font-medium text-muted">
                <th className="py-2 pr-3 font-medium">Pessoa</th>
                <th className="py-2 pr-3 font-medium">Perfil</th>
                <th className="py-2 pr-3 font-medium">Verificação</th>
                <th className="py-2 pr-3 font-medium">Último acesso</th>
                <th className="py-2 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.membershipId} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-3">
                    <p className="font-medium">{m.name} {m.userId === me.user.id ? <span className="text-[13px] font-normal text-muted">(você)</span> : null}</p>
                    <p className="text-[13px] text-muted">{m.email}</p>
                    {m.status !== 'active' ? <div className="mt-1"><Badge tone="bad">Desativado</Badge></div> : null}
                  </td>
                  <td className="py-3 pr-3">
                    {editing === m.membershipId
                      ? <RoleEditor member={m} roles={roles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />
                      : <span>{m.roles.map((r) => r.name).join(', ') || 'Sem perfil'}</span>}
                  </td>
                  <td className="py-3 pr-3">{m.totpEnabled ? <Badge tone="ok">Ativa</Badge> : <Badge tone="neutral">Desligada</Badge>}</td>
                  <td className="py-3 pr-3 text-[13px] text-muted">{m.lastLoginAt ? dateTime.format(new Date(m.lastLoginAt)) : 'Nunca entrou'}</td>
                  <td className="py-3">
                    <div className="flex justify-end gap-1.5">
                      {editing !== m.membershipId ? <Button variant="ghost" onClick={() => setEditing(m.membershipId)}>Alterar perfil</Button> : null}
                      {m.userId !== me.user.id ? (
                        <Button variant={m.status === 'active' ? 'danger' : 'secondary'} onClick={() => setToggle(m)}>
                          {m.status === 'active' ? 'Desativar' : 'Reativar'}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Confirm open={!!toggle} title={toggle?.status === 'active' ? `Desativar ${toggle?.name}?` : `Reativar ${toggle?.name}?`}
        confirmLabel={toggle?.status === 'active' ? 'Desativar' : 'Reativar'} danger={toggle?.status === 'active'} loading={busy}
        onConfirm={setStatus} onCancel={() => setToggle(null)}>
        {toggle?.status === 'active'
          ? 'A pessoa perde o acesso a esta empresa na hora, e as sessões abertas nela deixam de valer. Os registros dela continuam.'
          : 'A pessoa volta a entrar com a mesma conta e o mesmo perfil.'}
      </Confirm>
    </Panel>
  );
}

function RoleEditor({ member, roles, onClose, onSaved }: { member: Member; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(member.roles.map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api('PATCH', `/api/v1/members/${member.membershipId}`, { roleIds: [...selected] });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível salvar.');
      setBusy(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">Perfis de {member.name}</legend>
      {roles.map((r) => (
        <label key={r.id} className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.has(r.id)} className="size-4 accent-[var(--primary)]"
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(r.id); else next.delete(r.id);
              setSelected(next);
            }} />
          {r.name}
        </label>
      ))}
      {err ? <p role="alert" className="text-[13px] text-bad">{err}</p> : null}
      <div className="mt-1 flex gap-2">
        <Button loading={busy} disabled={selected.size === 0} onClick={save}>Salvar</Button>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </fieldset>
  );
}
