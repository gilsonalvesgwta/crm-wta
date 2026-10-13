import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import { CurrentActor, ExternalWebhook, PlatformAdmin, Public, Require } from '../access/decorators.js';
import type { Actor } from '../access/actor.js';
import { AdminService } from './admin.service.js';
import { PlatformService } from './platform.service.js';

const uuid = z.string().uuid({ message: 'Identificador inválido.' });
const name = (max: number, what: string) =>
  z.string().trim().min(1, { message: `Informe ${what}.` }).max(max, { message: `Use até ${max} caracteres.` });
const email = z.string().trim().toLowerCase().max(254).email({ message: 'Informe um e-mail válido.' });
const scope = z.enum(['own', 'team', 'tenant']);

const tenantPatch = z.object({
  name: name(200, 'o nome').optional(),
  timezone: z.string().max(64).optional(),
  locale: z.enum(['pt-BR', 'en-US', 'es']).optional(),
});
const brandingBody = z.object({
  sidebar: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'Use uma cor no formato #RRGGBB.' }).nullable().optional(),
  productName: name(80, 'o nome do produto'),
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'Use uma cor no formato #RRGGBB.' }),
  mode: z.enum(['light', 'dark']).default('light'),
});
const memberPatch = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  roleIds: z.array(uuid).max(10).optional(),
});
const inviteBody = z.object({ email, roleId: uuid });
const teamBody = z.object({ name: name(120, 'o nome da equipe') });
const teamPatch = z.object({
  name: name(120, 'o nome da equipe').optional(),
  members: z.array(z.object({ membershipId: uuid, role: z.enum(['leader', 'member']) })).max(500).optional(),
});
const roleBody = z.object({ name: name(80, 'o nome do perfil'), grants: z.record(z.string(), scope).default({}) });
const rolePatch = z.object({ name: name(80, 'o nome do perfil').optional(), grants: z.record(z.string(), scope).optional() });
const auditQuery = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().regex(/^[a-z_.]{1,60}$/).optional(),
});
const platformTenant = z.object({
  name: name(200, 'o nome da empresa'),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, { message: 'Use letras minúsculas, números e hífen.' }),
  adminEmail: email,
});
const statusBody = z.object({ status: z.enum(['active', 'suspended', 'archived']) });

@Controller('v1')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('tenant')
  tenant(@CurrentActor() a: Actor) {
    return this.admin.tenant(a);
  }

  @Require('settings:admin', 'tenant')
  @Patch('tenant')
  updateTenant(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.admin.updateTenant(a, parse(tenantPatch, b));
  }

  @Get('branding')
  branding(@CurrentActor() a: Actor) {
    return this.admin.branding(a);
  }

  @Require('settings:admin', 'tenant')
  @Put('branding')
  updateBranding(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.admin.updateBranding(a, parse(brandingBody, b));
  }

  @Require('settings:admin', 'tenant')
  @Post('branding/reset')
  @HttpCode(200)
  resetBranding(@CurrentActor() a: Actor) {
    return this.admin.resetBranding(a);
  }

  @Require('users:admin', 'tenant')
  @Get('members')
  async members(@CurrentActor() a: Actor) {
    return { items: await this.admin.members(a) };
  }

  @Require('users:admin', 'tenant')
  @Patch('members/:id')
  updateMember(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.admin.updateMember(a, parse(uuid, id), parse(memberPatch, b));
  }

  @Require('users:admin', 'tenant')
  @Get('invitations')
  async invitations(@CurrentActor() a: Actor) {
    return { items: await this.admin.invitations(a) };
  }

  @Require('users:admin', 'tenant')
  @Post('invitations')
  invite(@CurrentActor() a: Actor, @Body() b: unknown) {
    const x = parse(inviteBody, b);
    return this.admin.invite(a, x.email, x.roleId);
  }

  @Require('users:admin', 'tenant')
  @Post('invitations/:id/resend')
  @HttpCode(200)
  resend(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.admin.resendInvitation(a, parse(uuid, id));
  }

  @Require('users:admin', 'tenant')
  @Delete('invitations/:id')
  @HttpCode(204)
  async revoke(@CurrentActor() a: Actor, @Param('id') id: string) {
    await this.admin.revokeInvitation(a, parse(uuid, id));
  }

  @Require('users:admin', 'tenant')
  @Get('teams')
  async teams(@CurrentActor() a: Actor) {
    return { items: await this.admin.teams(a) };
  }

  @Require('users:admin', 'tenant')
  @Post('teams')
  createTeam(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.admin.createTeam(a, parse(teamBody, b).name);
  }

  @Require('users:admin', 'tenant')
  @Patch('teams/:id')
  updateTeam(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.admin.updateTeam(a, parse(uuid, id), parse(teamPatch, b));
  }

  @Require('users:admin', 'tenant')
  @Delete('teams/:id')
  @HttpCode(204)
  async deleteTeam(@CurrentActor() a: Actor, @Param('id') id: string) {
    await this.admin.deleteTeam(a, parse(uuid, id));
  }

  @Require('users:admin', 'tenant')
  @Get('permissions')
  permissions() {
    return { items: this.admin.catalog() };
  }

  @Require('users:admin', 'tenant')
  @Get('roles')
  async roles(@CurrentActor() a: Actor) {
    return { items: await this.admin.roles(a) };
  }

  @Require('users:admin', 'tenant')
  @Post('roles')
  createRole(@CurrentActor() a: Actor, @Body() b: unknown) {
    const x = parse(roleBody, b);
    return this.admin.createRole(a, x.name, x.grants);
  }

  @Require('users:admin', 'tenant')
  @Patch('roles/:id')
  updateRole(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.admin.updateRole(a, parse(uuid, id), parse(rolePatch, b));
  }

  @Require('users:admin', 'tenant')
  @Delete('roles/:id')
  @HttpCode(204)
  async deleteRole(@CurrentActor() a: Actor, @Param('id') id: string) {
    await this.admin.deleteRole(a, parse(uuid, id));
  }

  @Require('audit:view', 'tenant')
  @Get('audit')
  audit(@CurrentActor() a: Actor, @Query() query: unknown) {
    const x = parse(auditQuery, query);
    return this.admin.auditLog(a, { before: x.before ? new Date(x.before) : undefined, limit: x.limit, action: x.action });
  }
}

const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const tenantEdit = z.object({
  name: name(200, 'o nome da empresa').optional(),
  contactName: optText(200),
  contactEmail: email.nullable().optional(),
  phone: optText(40),
  document: optText(30),
  notes: optText(4000),
});
const limitsBody = z.object({
  max_users: z.number().int().min(1).max(100000).nullable().optional(),
  max_whatsapp: z.number().int().min(0).max(1000).nullable().optional(),
  max_email_accounts: z.number().int().min(0).max(1000).nullable().optional(),
  max_automations: z.number().int().min(0).max(100000).nullable().optional(),
  custom_domain: z.boolean().optional(),
  api_access: z.boolean().optional(),
});
const planBody = z.object({
  name: name(120, 'o nome do plano'),
  description: optText(2000),
  priceCents: z.number().int().min(0).max(1_000_000_000).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default('BRL'),
  billingPeriod: z.enum(['monthly', 'quarterly', 'yearly', 'one_time']).default('monthly'),
  durationDays: z.number().int().min(1).max(3660).default(30),
  limits: limitsBody.default({}),
  active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});
const offerBody = z.object({
  externalProduct: z.string().trim().regex(/^[0-9A-Za-z_-]{1,40}$/, { message: 'Use o código do produto na Greenn (números).' }),
  label: optText(120),
  durationDays: z.number().int().min(1).max(3660).nullable().optional(),
});
const subscriptionBody = z.object({
  planId: uuid.nullable(),
  status: z.enum(['trial', 'active', 'past_due', 'canceled', 'expired', 'inactive']),
  currentPeriodEnd: z.string().datetime({ offset: true }).nullable(),
  notes: optText(2000),
});

@Controller('v1/platform')
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @PlatformAdmin()
  @Get('tenants')
  async list(@CurrentActor() a: Actor) {
    return { items: await this.platform.list(a) };
  }

  @PlatformAdmin()
  @Post('tenants')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.platform.create(a, parse(platformTenant, b));
  }

  @PlatformAdmin()
  @Get('tenants/:id')
  get(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.platform.get(a, parse(uuid, id));
  }

  /** Situação (status) ou dados da empresa (nome, contato, documento, observações). */
  @PlatformAdmin()
  @Patch('tenants/:id')
  update(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    const tid = parse(uuid, id);
    if (b && typeof b === 'object' && 'status' in b) return this.platform.setStatus(a, tid, parse(statusBody, b).status);
    return this.platform.update(a, tid, parse(tenantEdit, b));
  }

  @PlatformAdmin()
  @Post('tenants/:id/delete')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    await this.platform.remove(a, parse(uuid, id), parse(z.object({ confirm: z.string().max(80) }), b).confirm);
  }

  @PlatformAdmin()
  @Post('tenants/:id/invite-admin')
  @HttpCode(200)
  inviteAdmin(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.platform.inviteAdmin(a, parse(uuid, id), parse(z.object({ email: email.optional() }), b).email);
  }

  @PlatformAdmin()
  @Put('tenants/:id/subscription')
  subscription(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.platform.setSubscription(a, parse(uuid, id), parse(subscriptionBody, b));
  }

  @PlatformAdmin()
  @Get('plans')
  async plans(@CurrentActor() a: Actor) {
    return { items: await this.platform.plans(a) };
  }

  @PlatformAdmin()
  @Post('plans')
  createPlan(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.platform.savePlan(a, null, parse(planBody, b));
  }

  @PlatformAdmin()
  @Patch('plans/:id')
  updatePlan(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.platform.savePlan(a, parse(uuid, id), parse(planBody.partial(), b));
  }

  @PlatformAdmin()
  @Delete('plans/:id')
  @HttpCode(204)
  async deletePlan(@CurrentActor() a: Actor, @Param('id') id: string) {
    await this.platform.deletePlan(a, parse(uuid, id));
  }

  @PlatformAdmin()
  @Post('plans/:id/offers')
  createOffer(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.platform.saveOffer(a, parse(uuid, id), parse(offerBody, b));
  }

  @PlatformAdmin()
  @Delete('offers/:id')
  @HttpCode(204)
  async deleteOffer(@CurrentActor() a: Actor, @Param('id') id: string) {
    await this.platform.deleteOffer(a, parse(uuid, id));
  }

  @PlatformAdmin()
  @Get('greenn')
  async greenn(@CurrentActor() a: Actor) {
    return { ...this.platform.greennInfo(), events: await this.platform.billingEvents(a) };
  }
}

/** Avisos da Greenn. O segredo no endereço é a autorização. */
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Public()
  @ExternalWebhook()
  @Post('greenn/:secret')
  @HttpCode(200)
  greenn(@Param('secret') secret: string, @Body() b: unknown) {
    return this.platform.handleGreenn(secret, b);
  }
}
