'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import type { Member, Team } from '@/lib/admin-types';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Empty, LoadError, Loading } from '@/components/ui/states';

export default function TeamsPage() {
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/api/v1/teams').then((r) => r.items));
  const members = useLoad(() => api<{ items: Member[] }>('GET', '/api/v1/members').then((r) => r.items.filter((m) => m.status === 'active')));
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  if (teams.error) return <LoadError error={teams.error} retry={teams.reload} />;

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      await api('POST', '/api/v1/teams', { name });
      setName('');
      await teams.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível criar.'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Nova equipe" description="Equipes definem quem vê o quê quando o perfil dá acesso aos registros da equipe.">
        <form onSubmit={create} noValidate className="flex flex-wrap items-end gap-3">
          <Field label="Nome da equipe" value={name} onChange={(e) => setName(e.target.value)} error={err?.fieldError('name') ?? (err && err.errors.length === 0 ? err.title : undefined)} className="w-72 max-w-full" />
          <Button type="submit" loading={creating} disabled={!name.trim()}>Criar equipe</Button>
        </form>
      </Panel>
      {teams.loading && !teams.data ? <Loading /> : teams.data!.length === 0 ? (
        <Empty title="Nenhuma equipe ainda">Crie a primeira equipe acima. Ex.: Comercial, Suporte, Pós-venda.</Empty>
      ) : (
        teams.data!.map((t) => <TeamCard key={t.id} team={t} members={members.data ?? []} onChange={() => void teams.reload()} />)
      )}
    </div>
  );
}

function TeamCard({ team, members, onChange }: { team: Team; members: Member[]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [sel, setSel] = useState<Map<string, 'leader' | 'member'>>(new Map(team.members.map((m) => [m.membershipId, m.role])));
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api('PATCH', `/api/v1/teams/${team.id}`, {
        name: name !== team.name ? name : undefined,
        members: [...sel].map(([membershipId, role]) => ({ membershipId, role })),
      });
      setEditing(false);
      onChange();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api('DELETE', `/api/v1/teams/${team.id}`);
      onChange();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.');
    } finally {
      setBusy(false);
      setAskDelete(false);
    }
  }

  return (
    <Panel title={team.name} description={`${team.members.length} ${team.members.length === 1 ? 'pessoa' : 'pessoas'}`}
      actions={!editing ? (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>
          <Button variant="danger" onClick={() => setAskDelete(true)}>Excluir</Button>
        </div>
      ) : null}>
      {err ? <div className="mb-3"><Alert tone="error">{err}</Alert></div> : null}
      {editing ? (
        <div className="flex flex-col gap-4">
          <Field label="Nome da equipe" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Pessoas</legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {members.map((m) => {
                const role = sel.get(m.membershipId);
                return (
                  <li key={m.membershipId} className="flex min-h-11 items-center justify-between gap-2 rounded-[6px] px-2 hover:bg-surface-2">
                    <label className="flex min-w-0 items-center gap-2">
                      <input type="checkbox" checked={!!role} className="size-4 accent-[var(--primary)]"
                        onChange={(e) => { const n = new Map(sel); if (e.target.checked) n.set(m.membershipId, 'member'); else n.delete(m.membershipId); setSel(n); }} />
                      <span className="truncate">{m.name}</span>
                    </label>
                    {role ? (
                      <label className="flex items-center gap-1.5 text-[13px] text-muted">
                        <input type="checkbox" checked={role === 'leader'} className="size-4 accent-[var(--primary)]"
                          onChange={(e) => { const n = new Map(sel); n.set(m.membershipId, e.target.checked ? 'leader' : 'member'); setSel(n); }} />
                        Líder
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="flex gap-2">
            <Button loading={busy} onClick={save}>Salvar</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setName(team.name); setSel(new Map(team.members.map((m) => [m.membershipId, m.role]))); }}>Cancelar</Button>
          </div>
        </div>
      ) : team.members.length === 0 ? (
        <p className="text-[13px] text-muted">Nenhuma pessoa nesta equipe.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {team.members.map((m) => (
            <li key={m.membershipId} className="flex h-8 items-center gap-2 rounded-full border border-line px-3 text-[13px]">
              {m.name}{m.role === 'leader' ? <Badge tone="info">Líder</Badge> : null}
            </li>
          ))}
        </ul>
      )}
      <Confirm open={askDelete} title={`Excluir a equipe ${team.name}?`} confirmLabel="Excluir equipe" loading={busy}
        onConfirm={remove} onCancel={() => setAskDelete(false)}>
        As pessoas continuam na empresa; só deixam de fazer parte desta equipe.
      </Confirm>
    </Panel>
  );
}
