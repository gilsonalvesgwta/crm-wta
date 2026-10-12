import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Db } from '../infra/db.js';
import { tokenHash } from '../domain/secrets.js';
import { REQUIRES_MFA, mergeGrants, scopeCovers, type Permission, type Scope } from '../domain/permissions.js';
import { Problem } from '../http/problem.js';
import type { Actor } from './actor.js';
import { META_NO_TENANT, META_PENDING_MFA, META_PLATFORM, META_PUBLIC, META_REQUIRE } from './decorators.js';

export const SESSION_COOKIE = 'crm_session';
export const CSRF_HEADER = 'x-crm-request';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guarda global. Toda rota exige sessão, salvo as marcadas com @Public().
 * Mutações exigem o cabeçalho x-crm-request, que um site de terceiros não
 * consegue enviar sem CORS: é a proteção contra CSRF, somada a SameSite=Lax.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Db) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const flag = (key: string) => this.reflector.getAllAndOverride<boolean>(key, targets) === true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();

    if (!SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw Problem.forbidden('Requisição recusada.', 'csrf');
    }

    const token = req.cookies?.[SESSION_COOKIE];
    if (token) req.actor = (await this.loadActor(token)) ?? undefined;

    if (flag(META_PUBLIC)) return true;

    const actor = req.actor;
    if (!actor) throw Problem.unauthorized();

    if (actor.totpEnabled && !actor.mfaVerified && !flag(META_PENDING_MFA)) {
      throw Problem.forbidden('Confirme o código de verificação para continuar.', 'mfa-pending');
    }

    if (flag(META_PLATFORM)) {
      if (!actor.isPlatformAdmin) throw Problem.notFound();
      if (!actor.mfaVerified) throw Problem.forbidden('Ative a verificação em duas etapas para administrar a plataforma.', 'mfa-required');
      return true;
    }

    if (!actor.tenantId && !flag(META_NO_TENANT)) {
      throw Problem.forbidden('Escolha uma empresa para continuar.', 'tenant-required');
    }

    const need = this.reflector.getAllAndOverride<{ permission: Permission; scope: Scope } | undefined>(META_REQUIRE, targets);
    if (need) {
      if (!scopeCovers(actor.permissions.get(need.permission), need.scope)) throw Problem.forbidden();
      if (REQUIRES_MFA.has(need.permission) && !actor.mfaVerified) {
        throw Problem.forbidden('Ative a verificação em duas etapas para acessar esta área.', 'mfa-required');
      }
    }
    return true;
  }

  private async loadActor(token: string): Promise<Actor | null> {
    if (token.length > 100) return null;
    return this.db.auth(async (q) => {
      const s = await q.query<{
        session_id: string; user_id: string; tenant_id: string | null; membership_id: string | null; mfa_verified_at: Date | null;
      }>('select session_id, user_id, tenant_id, membership_id, mfa_verified_at from app.session_find($1)', [tokenHash(token)]);
      const row = s.rows[0];
      if (!row) return null;
      const p = await q.query<{ email: string; name: string; totp_enabled: boolean; is_platform_admin: boolean }>(
        'select email, name, totp_enabled, is_platform_admin from app.auth_user_profile($1)', [row.user_id]);
      const prof = p.rows[0];
      if (!prof) return null;

      let permissions = new Map<Permission, Scope>();
      let teamIds: string[] = [];
      if (row.tenant_id && row.membership_id) {
        await q.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [row.tenant_id, row.user_id]);
        const perms = await q.query<{ permission: string; scope: Scope }>(
          `select rp.permission, rp.scope
             from membership_roles mr
             join role_permissions rp on rp.role_id = mr.role_id
            where mr.membership_id = $1`, [row.membership_id]);
        permissions = mergeGrants(perms.rows);
        const teams = await q.query<{ team_id: string }>('select team_id from team_members where membership_id = $1', [row.membership_id]);
        teamIds = teams.rows.map((t) => t.team_id);
      }
      return {
        sessionId: row.session_id,
        userId: row.user_id,
        email: prof.email,
        name: prof.name,
        isPlatformAdmin: prof.is_platform_admin,
        totpEnabled: prof.totp_enabled,
        mfaVerified: row.mfa_verified_at !== null,
        tenantId: row.tenant_id,
        membershipId: row.membership_id,
        teamIds,
        permissions,
      };
    });
  }
}
