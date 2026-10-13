import type { Actor } from '../access/actor.js';
import { mergeGrants, type Scope } from '../domain/permissions.js';
import type { Q } from '../infra/db.js';

/**
 * Ator de um processamento em segundo plano (importação), com as permissões
 * atuais de quem o iniciou. Se a pessoa perdeu o acesso, devolve null.
 * Roda numa transação já no contexto da empresa.
 */
export async function actorForMembership(q: Q, tenantId: string, membershipId: string): Promise<Actor | null> {
  const m = await q.query<{ user_id: string; status: string; email: string; name: string }>(
    `select m.user_id, m.status, u.email, u.name from memberships m join users u on u.id = m.user_id where m.id = $1`, [membershipId]);
  const row = m.rows[0];
  if (!row || row.status !== 'active') return null;
  const perms = await q.query<{ permission: string; scope: Scope }>(
    `select rp.permission, rp.scope from membership_roles mr join role_permissions rp on rp.role_id = mr.role_id where mr.membership_id = $1`,
    [membershipId]);
  const teams = await q.query<{ team_id: string }>('select team_id from team_members where membership_id = $1', [membershipId]);
  return {
    sessionId: 'background',
    userId: row.user_id,
    email: row.email,
    name: row.name,
    isPlatformAdmin: false,
    totpEnabled: false,
    mfaVerified: false,
    tenantId,
    membershipId,
    teamIds: teams.rows.map((t) => t.team_id),
    permissions: mergeGrants(perms.rows),
  };
}
