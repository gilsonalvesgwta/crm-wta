import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, NoTenant, Public, Require } from '../access/decorators.js';
import { requestHost } from '../auth/auth.controller.js';
import { readUpload } from '../crm/crm.controller.js';
import { parse } from '../http/validate.js';
import { TenantFeaturesService } from './tenant-features.service.js';

const kind = z.enum(['logo', 'icon']);
const uuid = z.string().uuid();

@Controller('v1')
export class TenantFeaturesController {
  constructor(@Inject(TenantFeaturesService) private readonly svc: TenantFeaturesService) {}

  @Require('settings:admin', 'tenant')
  @Post('branding/:kind')
  async upload(@CurrentActor() a: Actor, @Param('kind') k: string, @Req() req: FastifyRequest) {
    const f = await readUpload(req, 2);
    return this.svc.uploadBrandAsset(a, parse(kind, k), f.name, f.data);
  }

  @Require('settings:admin', 'tenant')
  @Delete('branding/:kind')
  remove(@CurrentActor() a: Actor, @Param('kind') k: string) {
    return this.svc.removeBrandAsset(a, parse(kind, k));
  }

  @Require('settings:admin', 'tenant')
  @Get('domain')
  domain(@CurrentActor() a: Actor) {
    return this.svc.domain(a);
  }

  @Require('settings:admin', 'tenant')
  @Put('domain')
  setDomain(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.setDomain(a, parse(z.object({ domain: z.string().max(253) }), b).domain);
  }

  @Require('settings:admin', 'tenant')
  @Delete('domain')
  removeDomain(@CurrentActor() a: Actor) {
    return this.svc.removeDomain(a);
  }

  @Require('settings:admin', 'tenant')
  @Post('domain/check')
  @HttpCode(200)
  check(@CurrentActor() a: Actor) {
    return this.svc.checkDomain(a);
  }

  @Get('subscription')
  subscription(@CurrentActor() a: Actor) {
    return this.svc.subscription(a);
  }

  // ---- Públicas ------------------------------------------------------------------

  /** Marca da empresa pelo domínio acessado (tela de login). 404 no endereço principal. */
  @Public()
  @NoTenant()
  @Get('public/branding')
  async publicBranding(@Req() req: FastifyRequest) {
    const host = typeof req.headers['x-crm-host'] === 'string' ? req.headers['x-crm-host'].toLowerCase() : requestHost(req);
    const b = await this.svc.publicBranding(host);
    if (!b) return { found: false };
    return { found: true, ...b };
  }

  @Public()
  @NoTenant()
  @Get('public/branding/:tenantId/:kind/:fileId')
  async asset(@Param('tenantId') t: string, @Param('kind') k: string, @Param('fileId') f: string, @Res() res: FastifyReply) {
    const a = await this.svc.openBrandAsset(parse(uuid, t), parse(kind, k), parse(uuid, f));
    void res
      .header('content-type', a.contentType)
      .header('content-length', String(a.size))
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(a.stream);
  }

  /** Teste de rota do domínio próprio: o CRM diz qual empresa reconhece neste endereço. */
  @Public()
  @NoTenant()
  @Get('public/domain-check')
  domainCheck(@Req() req: FastifyRequest) {
    return this.svc.domainEcho(requestHost(req));
  }
}
