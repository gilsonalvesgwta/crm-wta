'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Empty, LoadError, Loading } from '@/components/ui/states';

type Entry = { id: string; occurredAt: string; actorType: string; actorName: string | null; action: string; objectType: string | null; objectId: string | null; detail: Record<string, unknown> };
type Page = { items: Entry[]; nextCursor: string | null };

const ACTIONS: Record<string, string> = {
  'tenant.updated': 'Alterou os dados da empresa',
  'tenant.created': 'Criou a empresa',
  'tenant.suspended': 'Suspendeu a empresa',
  'tenant.activated': 'Reativou a empresa',
  'tenant.archived': 'Arquivou a empresa',
  'branding.updated': 'Alterou a identidade visual',
  'branding.reset': 'Restaurou a identidade visual padrão',
  'membership.updated': 'Alterou o acesso de um usuário',
  'invitation.created': 'Convidou uma pessoa',
  'invitation.resent': 'Reenviou um convite',
  'invitation.revoked': 'Cancelou um convite',
  'team.created': 'Criou uma equipe',
  'team.updated': 'Alterou uma equipe',
  'team.deleted': 'Excluiu uma equipe',
  'role.created': 'Criou um perfil',
  'role.updated': 'Alterou um perfil',
  'role.deleted': 'Excluiu um perfil',
  'platform.bootstrapped': 'Configuração inicial da plataforma',
};

const FILTERS = [
  { value: '', label: 'Todas as ações' },
  { value: 'membership.', label: 'Acesso de usuários' },
  { value: 'invitation.', label: 'Convites' },
  { value: 'role.', label: 'Perfis' },
  { value: 'team.', label: 'Equipes' },
  { value: 'tenant.', label: 'Dados da empresa' },
  { value: 'branding.', label: 'Identidade visual' },
];

function who(e: Entry): string {
  if (e.actorType === 'system') return 'Sistema';
  if (e.actorType === 'platform') return `${e.actorName ?? 'Plataforma'} (plataforma)`;
  return e.actorName ?? 'Usuário removido';
}

function summary(e: Entry): string | null {
  const d = e.detail ?? {};
  if (typeof d.email === 'string') return d.email;
  if (typeof d.name === 'string') return d.name;
  if (typeof d.status === 'string') return d.status === 'disabled' ? 'Desativou o acesso' : 'Reativou o acesso';
  if (Array.isArray(d.roleIds)) return 'Trocou o perfil';
  if (typeof d.primary === 'string') return `Cor ${d.primary}`;
  return null;
}

export default function AuditPage() {
  const [filter, setFilter] = useState('');
  const { data, error, loading, reload, setData } = useLoad(
    () => api<Page>('GET', `/api/v1/audit?limit=50${filter ? `&action=${filter}` : ''}`), [filter]);
  const [more, setMore] = useState(false);
  const [moreErr, setMoreErr] = useState<string | null>(null);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setMore(true);
    try {
      const next = await api<Page>('GET', `/api/v1/audit?limit=50&before=${encodeURIComponent(data.nextCursor)}${filter ? `&action=${filter}` : ''}`);
      setData({ items: [...data.items, ...next.items], nextCursor: next.nextCursor });
    } catch (e) {
      setMoreErr(e instanceof ApiError ? e.title : 'Não foi possível carregar mais.');
    } finally {
      setMore(false);
    }
  }

  if (error) return <LoadError error={error} retry={reload} />;
  return (
    <Panel title="Auditoria" description="Ações administrativas registradas nesta empresa. O registro não pode ser alterado nem apagado."
      actions={<Select label="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56">
        {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </Select>}>
      {loading && !data ? <Loading /> : data!.items.length === 0 ? (
        <Empty title="Nenhum registro">{filter ? 'Não há ações desse tipo.' : 'As ações administrativas aparecem aqui.'}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="py-2 pr-3 font-medium">Quando</th>
                  <th className="py-2 pr-3 font-medium">Quem</th>
                  <th className="py-2 font-medium">O quê</th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map((e) => (
                  <tr key={e.id} className="border-b border-line align-top last:border-0">
                    <td className="whitespace-nowrap py-2.5 pr-3 text-[13px] tabular-nums text-muted">{dateTime.format(new Date(e.occurredAt))}</td>
                    <td className="py-2.5 pr-3">{who(e)}</td>
                    <td className="py-2.5">
                      <p>{ACTIONS[e.action] ?? e.action}</p>
                      {summary(e) ? <p className="text-[13px] text-muted">{summary(e)}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {moreErr ? <div className="mt-3"><Alert tone="error">{moreErr}</Alert></div> : null}
          {data!.nextCursor ? <Button variant="secondary" className="mt-4" loading={more} onClick={loadMore}>Carregar mais</Button> : null}
        </>
      )}
    </Panel>
  );
}
