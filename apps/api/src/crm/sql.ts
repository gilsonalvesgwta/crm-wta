import type { Actor } from '../access/actor.js';
import type { Permission, Scope } from '../domain/permissions.js';
import { Problem } from '../http/problem.js';
import type { Q } from '../infra/db.js';

/** Parâmetros posicionais de uma consulta montada aos pedaços. */
export class Params {
  readonly values: unknown[] = [];
  /** Acrescenta um valor e devolve o marcador ($n). */
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** Alcance do ator para uma permissão, com o necessário para filtrar. */
export type Reach = { scope: Scope; me: string; teams: string[] };

export function reachOf(actor: Actor, permission: Permission): Reach {
  const scope = actor.permissions.get(permission);
  if (!scope || !actor.membershipId) throw Problem.forbidden();
  return { scope, me: actor.membershipId, teams: actor.teamIds };
}

export function tryReach(actor: Actor, permission: Permission): Reach | null {
  const scope = actor.permissions.get(permission);
  if (!scope || !actor.membershipId) return null;
  return { scope, me: actor.membershipId, teams: actor.teamIds };
}

/**
 * Filtro de alcance sobre um registro com responsável (owner_membership_id) e
 * equipe (team_id).
 * - tenant: tudo.
 * - team: os próprios, os da equipe do registro e os de colegas de equipe.
 * - own: os próprios e o que `extraOwn` acrescentar (participação, vínculos).
 */
export function reachSql(p: Params, alias: string, r: Reach, extraOwn?: (me: string) => string): string {
  if (r.scope === 'tenant') return 'true';
  const me = p.add(r.me);
  const own = [`${alias}.owner_membership_id = ${me}`];
  if (extraOwn) own.push(extraOwn(me));
  if (r.scope === 'own' || r.teams.length === 0) return `(${own.join(' or ')})`;
  const teams = p.add(r.teams);
  return `(${own.join(' or ')} or ${alias}.team_id = any(${teams}::uuid[])
    or ${alias}.owner_membership_id in (select tm.membership_id from team_members tm where tm.team_id = any(${teams}::uuid[])))`;
}

/** O responsável escolhido precisa estar dentro do alcance de quem atribui. */
export async function assertOwnerInReach(q: Q, r: Reach, ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const m = await q.query<{ id: string; status: string }>('select id, status from memberships where id = $1', [ownerId]);
  if (!m.rows[0] || m.rows[0].status !== 'active') {
    throw Problem.badRequest('Responsável inválido.', [{ field: 'ownerId', message: 'Escolha uma pessoa ativa da empresa.' }]);
  }
  if (r.scope === 'tenant' || ownerId === r.me) return;
  if (r.scope === 'team' && r.teams.length > 0) {
    const t = await q.query('select 1 from team_members where membership_id = $1 and team_id = any($2::uuid[])', [ownerId, r.teams]);
    if (t.rowCount) return;
  }
  throw Problem.badRequest('Responsável fora do seu alcance.', [{ field: 'ownerId', message: 'Você só pode atribuir a si ou à sua equipe.' }]);
}

export async function assertTeamInReach(q: Q, r: Reach, teamId: string | null | undefined): Promise<void> {
  if (!teamId) return;
  const t = await q.query('select 1 from teams where id = $1', [teamId]);
  if (!t.rowCount) throw Problem.badRequest('Equipe inválida.', [{ field: 'teamId', message: 'Escolha uma equipe da empresa.' }]);
  if (r.scope !== 'tenant' && !r.teams.includes(teamId)) {
    throw Problem.badRequest('Equipe fora do seu alcance.', [{ field: 'teamId', message: 'Escolha uma das suas equipes.' }]);
  }
}

/** Registro na linha do tempo, na mesma transação da mudança. */
export async function timeline(
  q: Q, actor: Actor, kind: string,
  refs: { contactId?: string | null; organizationId?: string | null; dealId?: string | null; leadId?: string | null },
  data: Record<string, unknown> = {},
): Promise<void> {
  if (!refs.contactId && !refs.organizationId && !refs.dealId && !refs.leadId) return;
  await q.query(
    `insert into timeline_entries (tenant_id, kind, actor_membership_id, contact_id, organization_id, deal_id, lead_id, data)
     values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7)`,
    [kind, actor.membershipId, refs.contactId ?? null, refs.organizationId ?? null, refs.dealId ?? null, refs.leadId ?? null,
      JSON.stringify(data)]);
}

/** Campos alterados entre dois objetos, só pelos nomes (sem valores pessoais). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => after[k] !== undefined && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export function pageOf(page: number, pageSize: number): { limit: number; offset: number } {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

/** Escapa curingas para uso em LIKE. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
