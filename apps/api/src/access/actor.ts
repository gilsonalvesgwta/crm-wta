import type { Permission, Scope } from '../domain/permissions.js';

/** Quem está fazendo a requisição, resolvido pela sessão. */
export type Actor = {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  totpEnabled: boolean;
  mfaVerified: boolean;
  tenantId: string | null;
  membershipId: string | null;
  teamIds: string[];
  permissions: Map<Permission, Scope>;
};

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}
