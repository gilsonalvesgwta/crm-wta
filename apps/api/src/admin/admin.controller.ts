import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import { CurrentActor, PlatformAdmin, Require } from '../access/decorators.js';
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
  @Patch('tenants/:id')
  setStatus(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.platform.setStatus(a, parse(uuid, id), parse(statusBody, b).status);
  }
}
