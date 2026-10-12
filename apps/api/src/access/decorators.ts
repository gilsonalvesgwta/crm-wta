import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Permission, Scope } from '../domain/permissions.js';
import { Problem } from '../http/problem.js';
import type { Actor } from './actor.js';

export const META_PUBLIC = 'crm:public';
export const META_NO_TENANT = 'crm:no-tenant';
export const META_PENDING_MFA = 'crm:pending-mfa';
export const META_REQUIRE = 'crm:require';
export const META_PLATFORM = 'crm:platform';

/** Rota sem login (login, nova senha, convite, saúde). */
export const Public = () => SetMetadata(META_PUBLIC, true);
/** Rota que funciona antes de escolher a empresa. */
export const NoTenant = () => SetMetadata(META_NO_TENANT, true);
/** Rota liberada antes de confirmar o código de 2FA (o próprio código, sair). */
export const PendingMfa = () => SetMetadata(META_PENDING_MFA, true);
/** Exige a permissão com pelo menos o alcance informado. */
export const Require = (permission: Permission, scope: Scope = 'own') =>
  SetMetadata(META_REQUIRE, { permission, scope });
/** Administração da plataforma: superadministrador com 2FA confirmado. */
export const PlatformAdmin = () => SetMetadata(META_PLATFORM, true);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!req.actor) throw Problem.unauthorized();
  return req.actor;
});

/** Contexto de banco do ator, exigindo empresa escolhida. */
export function tenantCtx(actor: Actor): { tenantId: string; userId: string } {
  if (!actor.tenantId) throw Problem.forbidden('Escolha uma empresa para continuar.', 'tenant-required');
  return { tenantId: actor.tenantId, userId: actor.userId };
}
