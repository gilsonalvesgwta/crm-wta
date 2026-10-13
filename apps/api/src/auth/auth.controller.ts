import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { parse } from '../http/validate.js';
import { Problem } from '../http/problem.js';
import { ALL_PERMISSIONS } from '../domain/permissions.js';
import { CurrentActor, NoTenant, PendingMfa, Public } from '../access/decorators.js';
import { SESSION_COOKIE } from '../access/session.guard.js';
import type { Actor } from '../access/actor.js';
import { AuthService, type ClientInfo } from './auth.service.js';

const email = z.string().trim().toLowerCase().max(254).email({ message: 'Informe um e-mail válido.' });
const uuid = z.string().uuid({ message: 'Identificador inválido.' });

const loginBody = z.object({
  email,
  password: z.string().min(1, { message: 'Informe a senha.' }).max(200),
  remember: z.boolean().optional().default(false),
});
const codeBody = z.object({ code: z.string().trim().min(6, { message: 'Informe o código.' }).max(20) });
const tenantBody = z.object({ tenantId: uuid });
const forgotBody = z.object({ email });
const resetBody = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(200) });
const changeBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });
const disableBody = z.object({ password: z.string().min(1).max(200) });
const acceptBody = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(200).optional(),
});

/** Domínio pelo qual a pessoa acessou (o Traefik repassa em X-Forwarded-Host). */
export function requestHost(req: FastifyRequest): string | null {
  const fwd = req.headers['x-forwarded-host'];
  const raw = (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.headers.host ?? '';
  const host = String(raw).split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '');
  return /^[a-z0-9.-]{3,253}$/.test(host) ? host : null;
}

export function clientInfo(req: FastifyRequest): ClientInfo {
  const ua = req.headers['user-agent'];
  return { ip: req.ip || null, userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null, host: requestHost(req) };
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private setCookie(reply: FastifyReply, token: string, expiresAt: Date, remember: boolean) {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.cfg.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      ...(remember ? { expires: expiresAt } : {}),
    });
  }

  private clearCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const b = parse(loginBody, body);
    const r = await this.auth.login(b.email, b.password, b.remember, clientInfo(req));
    this.setCookie(reply, r.token, r.expiresAt, r.remember);
    return { mfaRequired: r.mfaRequired, tenantId: r.tenantId, tenants: r.tenants };
  }

  @PendingMfa()
  @NoTenant()
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: FastifyRequest) {
    return this.auth.verifyMfa(actor, parse(codeBody, body).code, clientInfo(req));
  }

  @PendingMfa()
  @NoTenant()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(actor, clientInfo(req));
    this.clearCookie(reply);
  }

  @PendingMfa()
  @NoTenant()
  @Get('me')
  async me(@CurrentActor() actor: Actor) {
    void this.auth.touch(actor).catch(() => undefined);
    const tenants = await this.auth.tenants(actor);
    return {
      user: { id: actor.userId, email: actor.email, name: actor.name, isPlatformAdmin: actor.isPlatformAdmin },
      mfa: {
        enabled: actor.totpEnabled, verified: actor.mfaVerified, pending: actor.totpEnabled && !actor.mfaVerified,
        // A verificação é exigida nas áreas administrativas (desligável pela variável EXIGIR_2FA da stack).
        adminRequired: this.cfg.REQUIRE_MFA,
      },
      tenantId: actor.tenantId,
      tenants,
      permissions: Object.fromEntries(ALL_PERMISSIONS.filter((p) => actor.permissions.has(p)).map((p) => [p, actor.permissions.get(p)])),
    };
  }

  @NoTenant()
  @Post('tenant')
  @HttpCode(204)
  async tenant(@Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: FastifyRequest) {
    await this.auth.selectTenant(actor, parse(tenantBody, body).tenantId, clientInfo(req));
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() body: unknown, @Req() req: FastifyRequest) {
    await this.auth.forgotPassword(parse(forgotBody, body).email, clientInfo(req));
    return { message: 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const b = parse(resetBody, body);
    await this.auth.resetPassword(b.token, b.password, clientInfo(req));
    this.clearCookie(reply);
  }

  @NoTenant()
  @Post('password/change')
  @HttpCode(204)
  async change(@Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: FastifyRequest) {
    const b = parse(changeBody, body);
    await this.auth.changePassword(actor, b.currentPassword, b.newPassword, clientInfo(req));
  }

  @NoTenant()
  @Post('mfa/setup')
  @HttpCode(200)
  setup(@CurrentActor() actor: Actor) {
    return this.auth.beginMfaSetup(actor);
  }

  @NoTenant()
  @Post('mfa/enable')
  @HttpCode(200)
  enable(@Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: FastifyRequest) {
    return this.auth.enableMfa(actor, parse(codeBody, body).code, clientInfo(req));
  }

  @NoTenant()
  @Post('mfa/disable')
  @HttpCode(204)
  async disable(@Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: FastifyRequest) {
    if (!actor.totpEnabled) throw Problem.badRequest('A verificação em duas etapas não está ativa.');
    await this.auth.disableMfa(actor, parse(disableBody, body).password, clientInfo(req));
  }

  @NoTenant()
  @Get('sessions')
  async sessions(@CurrentActor() actor: Actor) {
    return { items: await this.auth.sessions(actor) };
  }

  @NoTenant()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@Param('id') id: string, @CurrentActor() actor: Actor, @Req() req: FastifyRequest) {
    await this.auth.revokeSession(actor, parse(uuid, id), clientInfo(req));
  }

  @Public()
  @Get('invitations/:token')
  invitation(@Param('token') token: string) {
    return this.auth.invitationInfo(token);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(200)
  accept(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parse(acceptBody, body);
    return this.auth.acceptInvitation(b.token, req.actor, b.name, b.password, clientInfo(req));
  }
}
