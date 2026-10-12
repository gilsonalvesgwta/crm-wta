import { Inject, Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { CONFIG, type Config } from '../config.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { MAILER, type Mailer } from '../infra/mailer.js';
import { invitationEmail, passwordResetEmail } from '../infra/emails.js';
import { Problem } from '../http/problem.js';
import { LOCKOUT_WINDOW_MINUTES, remainingLockout } from '../domain/lockout.js';
import { passwordProblem } from '../domain/password-policy.js';
import {
  SecretBox, newRecoveryCodes, newToken, normalizeRecoveryCode, tokenHash,
} from '../domain/secrets.js';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from '../domain/totp.js';
import type { Actor } from '../access/actor.js';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
const RESET_MINUTES = 60;
const INVITE_DAYS = 7;

export type ClientInfo = { ip: string | null; userAgent: string | null };
export type TenantChoice = { id: string; name: string; slug: string };

export type LoginResult = {
  token: string;
  expiresAt: Date;
  remember: boolean;
  mfaRequired: boolean;
  tenantId: string | null;
  tenants: TenantChoice[];
};

@Injectable()
export class AuthService {
  private readonly box: SecretBox;
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {
    this.box = new SecretBox(cfg.masterKeys, cfg.currentKey);
  }

  hashPassword(password: string): Promise<string> {
    return argonHash(password, ARGON);
  }

  private async event(q: Q, kind: string, info: ClientInfo, p: { userId?: string | null; tenantId?: string | null; email?: string | null; detail?: object }) {
    await q.query('select app.auth_record_event($1, $2, $3, $4, $5, $6, $7)', [
      kind, p.userId ?? null, p.tenantId ?? null, p.email ?? null, info.ip, info.userAgent, JSON.stringify(p.detail ?? {}),
    ]);
  }

  async login(email: string, password: string, remember: boolean, info: ClientInfo): Promise<LoginResult> {
    const now = new Date();
    const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * 60_000);

    const counts = await this.db.auth((q) =>
      q.query<{ by_email: number; by_ip: number; last_failure_at: Date | null }>(
        'select by_email, by_ip, last_failure_at from app.auth_failure_counts($1, $2, $3)', [email, info.ip, since]),
    );
    const c = counts.rows[0]!;
    const wait = remainingLockout(c.by_email, c.by_ip, c.last_failure_at, now);
    if (wait > 0) {
      await this.db.auth((q) => this.event(q, 'login.blocked', info, { email }));
      const minutes = Math.ceil(wait / 60);
      throw new Problem(429, `Muitas tentativas. Tente de novo em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
        'rate-limited', undefined, undefined, { 'retry-after': String(wait) });
    }

    const found = await this.db.auth((q) =>
      q.query<{ id: string; password_hash: string | null; status: string; totp_enabled: boolean; is_platform_admin: boolean }>(
        'select id, password_hash, status, totp_enabled, is_platform_admin from app.auth_find_user($1)', [email]),
    );
    const user = found.rows[0];

    // Sem usuário, confere contra um hash qualquer para o tempo de resposta não
    // revelar se o e-mail existe.
    this.dummyHash ??= this.hashPassword('senha-que-ninguem-usa-' + newToken());
    const ok = user?.password_hash
      ? await argonVerify(user.password_hash, password).catch(() => false)
      : (await argonVerify(await this.dummyHash, password).catch(() => false)) && false;

    if (!user || !ok || user.status !== 'active') {
      await this.db.auth((q) => this.event(q, 'login.failed', info, {
        email, userId: user?.id ?? null, detail: { reason: !user ? 'unknown' : !ok ? 'password' : 'disabled' },
      }));
      throw new Problem(401, 'E-mail ou senha incorretos.', 'invalid-credentials');
    }

    const token = newToken();
    const expiresAt = new Date(now.getTime() + (remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * 3_600_000);

    return this.db.auth(async (q) => {
      const tenants = await this.tenantsOf(q, user.id);
      if (tenants.length === 0 && !user.is_platform_admin) {
        await this.event(q, 'login.no_tenant', info, { email, userId: user.id });
        throw Problem.forbidden('Sua conta não está ativa em nenhuma empresa. Fale com o administrador.', 'no-tenant');
      }
      const s = await q.query<{ id: string }>('select app.session_create($1, $2, $3, $4, $5) as id',
        [user.id, tokenHash(token), expiresAt, info.ip, info.userAgent]);
      const sessionId = s.rows[0]!.id;
      let tenantId: string | null = null;
      if (tenants.length === 1) {
        tenantId = tenants[0]!.id;
        await q.query('select app.session_set_tenant($1, $2)', [sessionId, tenantId]);
      }
      await this.event(q, 'login.ok', info, { email, userId: user.id, tenantId });
      return { token, expiresAt, remember, mfaRequired: user.totp_enabled, tenantId, tenants };
    });
  }

  private async tenantsOf(q: Q, userId: string): Promise<TenantChoice[]> {
    const r = await q.query<{ tenant_id: string; tenant_name: string; tenant_slug: string }>(
      'select tenant_id, tenant_name, tenant_slug from app.auth_user_tenants($1)', [userId]);
    return r.rows.map((t) => ({ id: t.tenant_id, name: t.tenant_name, slug: t.tenant_slug }));
  }

  async tenants(actor: Actor): Promise<TenantChoice[]> {
    return this.db.auth((q) => this.tenantsOf(q, actor.userId));
  }

  async selectTenant(actor: Actor, tenantId: string, info: ClientInfo): Promise<void> {
    await this.db.auth(async (q) => {
      try {
        await q.query('select app.session_set_tenant($1, $2)', [actor.sessionId, tenantId]);
      } catch (e) {
        if (pgCode(e) === '42501' || pgCode(e) === '22P02') throw Problem.notFound('Empresa não encontrada.');
        throw e;
      }
      await this.event(q, 'tenant.selected', info, { userId: actor.userId, tenantId });
    });
  }

  async logout(actor: Actor, info: ClientInfo): Promise<void> {
    await this.db.auth(async (q) => {
      await q.query('select app.session_revoke($1)', [actor.sessionId]);
      await this.event(q, 'logout', info, { userId: actor.userId, tenantId: actor.tenantId });
    });
  }

  // ---- Verificação em duas etapas -------------------------------------------

  private aad(userId: string) {
    return `totp:${userId}`;
  }

  async verifyMfa(actor: Actor, code: string, info: ClientInfo): Promise<{ usedRecoveryCode: boolean; recoveryCodesLeft: number }> {
    return this.db.auth(async (q) => {
      const r = await q.query<{ secret_enc: Buffer | null; enabled: boolean }>(
        'select secret_enc, enabled from app.auth_totp_secret($1)', [actor.userId]);
      const row = r.rows[0];
      if (!row?.enabled || !row.secret_enc) throw Problem.badRequest('A verificação em duas etapas não está ativa.');

      const secret = this.box.open(row.secret_enc, this.aad(actor.userId));
      let usedRecovery = false;
      let ok = verifyTotp(secret, code, Date.now()) !== null;
      if (!ok && /[a-z]/i.test(code)) {
        const used = await q.query<{ ok: boolean }>('select app.auth_use_recovery_code($1, $2) as ok',
          [actor.userId, tokenHash(normalizeRecoveryCode(code))]);
        ok = used.rows[0]!.ok;
        usedRecovery = ok;
      }
      if (!ok) {
        await this.event(q, 'mfa.failed', info, { userId: actor.userId, tenantId: actor.tenantId });
        throw new Problem(401, 'Código incorreto. Confira o aplicativo e tente de novo.', 'invalid-code');
      }
      await q.query('select app.session_mark_mfa($1)', [actor.sessionId]);
      await this.event(q, usedRecovery ? 'mfa.recovery_used' : 'mfa.ok', info, { userId: actor.userId, tenantId: actor.tenantId });
      const left = await q.query<{ n: number }>('select app.auth_recovery_codes_left($1) as n', [actor.userId]);
      return { usedRecoveryCode: usedRecovery, recoveryCodesLeft: left.rows[0]!.n };
    });
  }

  async beginMfaSetup(actor: Actor): Promise<{ secret: string; otpauthUri: string }> {
    if (actor.totpEnabled) throw Problem.conflict('A verificação em duas etapas já está ativa.');
    const secret = newTotpSecret();
    await this.db.auth((q) => q.query('select app.auth_totp_begin($1, $2)',
      [actor.userId, this.box.seal(secret, this.aad(actor.userId))]));
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, actor.email, this.cfg.APP_NAME) };
  }

  async enableMfa(actor: Actor, code: string, info: ClientInfo): Promise<{ recoveryCodes: string[] }> {
    return this.db.auth(async (q) => {
      const r = await q.query<{ secret_enc: Buffer | null; enabled: boolean }>(
        'select secret_enc, enabled from app.auth_totp_secret($1)', [actor.userId]);
      const row = r.rows[0];
      if (row?.enabled) throw Problem.conflict('A verificação em duas etapas já está ativa.');
      if (!row?.secret_enc) throw Problem.badRequest('Comece a configuração de novo.');
      const secret = this.box.open(row.secret_enc, this.aad(actor.userId));
      if (verifyTotp(secret, code, Date.now()) === null) {
        throw new Problem(401, 'Código incorreto. Confira o aplicativo e tente de novo.', 'invalid-code');
      }
      const codes = newRecoveryCodes();
      await q.query('select app.auth_totp_enable($1, $2)', [actor.userId, codes.map((c) => tokenHash(c))]);
      await q.query('select app.session_mark_mfa($1)', [actor.sessionId]);
      await this.event(q, 'mfa.enabled', info, { userId: actor.userId, tenantId: actor.tenantId });
      return { recoveryCodes: codes };
    });
  }

  async disableMfa(actor: Actor, password: string, info: ClientInfo): Promise<void> {
    await this.checkPassword(actor.userId, password);
    if (actor.permissions.has('users:admin') || actor.permissions.has('settings:admin') || actor.isPlatformAdmin) {
      throw Problem.forbidden('Administradores precisam manter a verificação em duas etapas.', 'mfa-mandatory');
    }
    await this.db.auth(async (q) => {
      await q.query('select app.auth_totp_disable($1)', [actor.userId]);
      await this.event(q, 'mfa.disabled', info, { userId: actor.userId, tenantId: actor.tenantId });
    });
  }

  // ---- Senha ------------------------------------------------------------------

  private async checkPassword(userId: string, password: string): Promise<void> {
    const r = await this.db.auth((q) => q.query<{ h: string | null }>('select app.auth_password_hash($1) as h', [userId]));
    const h = r.rows[0]?.h;
    if (!h || !(await argonVerify(h, password).catch(() => false))) {
      throw Problem.badRequest('Senha atual incorreta.', [{ field: 'currentPassword', message: 'Senha atual incorreta.' }]);
    }
  }

  async changePassword(actor: Actor, current: string, next: string, info: ClientInfo): Promise<void> {
    await this.checkPassword(actor.userId, current);
    const problem = passwordProblem(next, actor.email);
    if (problem) throw Problem.badRequest(problem, [{ field: 'newPassword', message: problem }]);
    const h = await this.hashPassword(next);
    await this.db.auth(async (q) => {
      await q.query('select app.auth_set_password($1, $2, $3)', [actor.userId, h, actor.sessionId]);
      await this.event(q, 'password.changed', info, { userId: actor.userId, tenantId: actor.tenantId });
    });
  }

  async forgotPassword(email: string, info: ClientInfo): Promise<void> {
    const token = newToken();
    const expires = new Date(Date.now() + RESET_MINUTES * 60_000);
    const status = await this.db.auth(async (q) => {
      const r = await q.query<{ s: string }>('select app.auth_password_reset_create($1, $2, $3) as s', [email, tokenHash(token), expires]);
      const s = r.rows[0]!.s;
      await this.event(q, `password.reset_${s}`, info, { email });
      return s;
    });
    if (status === 'created') {
      const url = `${this.cfg.APP_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
      await this.mailer.send(passwordResetEmail(this.cfg.APP_NAME, email.trim().toLowerCase(), url));
    }
  }

  async resetPassword(token: string, password: string, info: ClientInfo): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw Problem.badRequest(problem, [{ field: 'password', message: problem }]);
    const h = await this.hashPassword(password);
    await this.db.auth(async (q) => {
      const r = await q.query<{ u: string | null }>('select app.auth_password_reset_consume($1, $2) as u', [tokenHash(token), h]);
      const userId = r.rows[0]?.u ?? null;
      if (!userId) throw Problem.badRequest('Este link não vale mais. Peça um novo.', [{ field: 'token', message: 'Link inválido ou vencido.' }]);
      await this.event(q, 'password.reset_done', info, { userId });
    });
  }

  // ---- Convites -----------------------------------------------------------------

  async createInvitation(
    q: Q, tenantId: string, email: string, roleId: string | null, invitedBy: string | null,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const r = await q.query<{ id: string }>(
      `insert into invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [tenantId, email, roleId, tokenHash(token), invitedBy, expiresAt]);
    return { id: r.rows[0]!.id, token, expiresAt };
  }

  async sendInvitation(to: string, tenantName: string, inviter: string, token: string): Promise<void> {
    const url = `${this.cfg.APP_URL}/convite?token=${encodeURIComponent(token)}`;
    await this.mailer.send(invitationEmail(this.cfg.APP_NAME, to, tenantName, inviter, url));
  }

  async invitationInfo(token: string): Promise<{ tenantName: string; email: string; userExists: boolean }> {
    const r = await this.db.auth((q) => q.query<{ tenant_name: string; email: string; user_exists: boolean }>(
      'select tenant_name, email, user_exists from app.auth_invitation_info($1)', [tokenHash(token)]));
    const row = r.rows[0];
    if (!row) throw Problem.notFound('Este convite não vale mais. Peça um novo ao administrador.');
    return { tenantName: row.tenant_name, email: row.email, userExists: row.user_exists };
  }

  async acceptInvitation(
    token: string, actor: Actor | undefined, name: string | undefined, password: string | undefined, info: ClientInfo,
  ): Promise<{ tenantId: string; createdUser: boolean }> {
    const inv = await this.invitationInfo(token);
    let h: string | null = null;
    if (!inv.userExists) {
      if (!name?.trim() || !password) throw Problem.badRequest('Informe nome e senha.');
      const problem = passwordProblem(password, inv.email);
      if (problem) throw Problem.badRequest(problem, [{ field: 'password', message: problem }]);
      h = await this.hashPassword(password);
    }
    return this.db.auth(async (q) => {
      try {
        const r = await q.query<{ user_id: string; tenant_id: string }>(
          'select user_id, tenant_id from app.auth_invitation_accept($1, $2, $3, $4)',
          [tokenHash(token), actor?.userId ?? null, name ?? null, h]);
        const row = r.rows[0]!;
        await this.event(q, 'invitation.accepted', info, { userId: row.user_id, tenantId: row.tenant_id, email: inv.email });
        return { tenantId: row.tenant_id, createdUser: !inv.userExists };
      } catch (e) {
        if (pgCode(e) === '28000') throw Problem.forbidden('Entre com a conta do e-mail convidado para aceitar.', 'login-required');
        if (pgCode(e) === '42501') throw Problem.notFound('Este convite não vale mais. Peça um novo ao administrador.');
        throw e;
      }
    });
  }

  // ---- Sessões ----------------------------------------------------------------

  async sessions(actor: Actor) {
    const r = await this.db.app({ tenantId: null, userId: actor.userId }, (q) =>
      q.query<{ id: string; created_at: Date; last_seen_at: Date; expires_at: Date; ip: string | null; user_agent: string | null }>(
        `select id, created_at, last_seen_at, expires_at, host(ip) as ip, user_agent
           from sessions
          where revoked_at is null and expires_at > now()
          order by last_seen_at desc`));
    return r.rows.map((s) => ({
      id: s.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at,
      ip: s.ip, userAgent: s.user_agent, current: s.id === actor.sessionId,
    }));
  }

  async revokeSession(actor: Actor, sessionId: string, info: ClientInfo): Promise<void> {
    await this.db.auth(async (q) => {
      const r = await q.query<{ ok: boolean }>('select app.session_revoke_own($1, $2) as ok', [sessionId, actor.userId]);
      if (!r.rows[0]!.ok) throw Problem.notFound('Sessão não encontrada.');
      await this.event(q, 'session.revoked', info, { userId: actor.userId, tenantId: actor.tenantId, detail: { sessionId } });
    });
  }

  async touch(actor: Actor): Promise<void> {
    await this.db.auth((q) => q.query('select app.session_touch($1)', [actor.sessionId]));
  }
}
