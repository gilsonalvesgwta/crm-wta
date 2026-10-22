import { safeFormat } from './crm';
export type RoleRef = { id: string; name: string };
export type Member = {
  membershipId: string; userId: string; name: string; email: string; status: 'active' | 'disabled' | 'invited';
  lastLoginAt: string | null; totpEnabled: boolean; roles: RoleRef[]; teams: RoleRef[];
};
export type Invitation = { id: string; email: string; roleName: string | null; expiresAt: string; createdAt: string; invitedBy: string | null };
export type Scope = 'own' | 'team' | 'tenant';
export type Role = { id: string; key: string; name: string; isSystem: boolean; grants: Record<string, Scope>; members: number };
export type PermissionInfo = { key: string; label: string; scopes: Scope[] };
export type Team = { id: string; name: string; members: { membershipId: string; name: string; role: 'leader' | 'member' }[] };

export const SCOPE_LABEL: Record<Scope, string> = { own: 'Próprios', team: 'Equipe', tenant: 'Toda a empresa' };

export const dateTime = safeFormat(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));
export const dateOnly = safeFormat(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }));
