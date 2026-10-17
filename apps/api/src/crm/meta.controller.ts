import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, ExternalWebhook, Public, Require } from '../access/decorators.js';
import { templateBody } from '../domain/meta.js';
import { parse } from '../http/validate.js';
import { MetaService } from './meta.service.js';
import { text, uuid } from './schemas.js';

const id = (v: string) => parse(uuid, v);
const secret = z.string().trim().max(1000).nullable().optional().transform((v) => (v ? v : null));
const numericId = (what: string) => z.string().trim().regex(/^[0-9]{5,30}$/, { message: `Cole o ${what} (só números).` });

const cloudBody = z.object({
  name: text(120, 'um nome para o número'),
  phoneNumberId: numericId('ID do número de telefone'),
  wabaId: numericId('ID da conta do WhatsApp Business'),
  token: secret, appSecret: secret,
  /** PIN de 6 dígitos da verificação em duas etapas: registra o número na Cloud API. */
  pin: z.string().trim().regex(/^\d{6}$/, { message: 'O PIN tem 6 números.' }).nullable().optional().or(z.literal('').transform(() => null)),
});
const instagramBody = z.object({
  name: text(120, 'um nome para a conta'),
  igUserId: numericId('ID da conta do Instagram'),
  host: z.enum(['instagram', 'facebook']).default('instagram'),
  token: secret, appSecret: secret, appSecret2: secret,
});

@Controller('v1')
export class MetaController {
  constructor(@Inject(MetaService) private readonly svc: MetaService) {}

  @Require('channels:admin', 'tenant')
  @Post('channels/whatsapp-cloud')
  createCloud(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.saveCloud(a, null, parse(cloudBody, b));
  }

  @Require('channels:admin', 'tenant')
  @Patch('channels/whatsapp-cloud/:id')
  updateCloud(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.saveCloud(a, id(i), parse(cloudBody, b));
  }

  @Require('channels:admin', 'tenant')
  @Post('channels/instagram')
  createInstagram(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.saveInstagram(a, null, parse(instagramBody, b));
  }

  @Require('channels:admin', 'tenant')
  @Patch('channels/instagram/:id')
  updateInstagram(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.saveInstagram(a, id(i), parse(instagramBody, b));
  }

  @Require('channels:admin', 'tenant')
  @Post('channels/:id/verify')
  @HttpCode(200)
  verifyAccount(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.test(a, id(i));
  }

  // ---- Modelos ----

  /** Modelos do WhatsApp oficial (para escolher na conversa e na campanha). */
  @Get('whatsapp-templates')
  templates(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({
      accountId: z.preprocess((v) => (v === '' ? undefined : v), uuid.optional()),
      approved: z.enum(['1', '0', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'),
    }), q);
    return this.svc.templates(a, { accountId: f.accountId, approvedOnly: f.approved });
  }

  @Require('campaigns:edit')
  @Post('whatsapp-templates')
  createTemplate(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.createTemplate(a, parse(templateBody, b));
  }

  @Require('campaigns:edit')
  @Post('whatsapp-templates/sync')
  @HttpCode(200)
  sync(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.syncTemplates(a, parse(z.object({ accountId: uuid }), b).accountId);
  }

  @Require('campaigns:edit')
  @Delete('whatsapp-templates/:id')
  @HttpCode(204)
  async removeTemplate(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.removeTemplate(a, id(i));
  }
}

/** Avisos da Meta (WhatsApp oficial e Instagram). O token no endereço identifica a conta. */
@Controller('v1/webhooks/meta')
export class MetaWebhookController {
  constructor(@Inject(MetaService) private readonly svc: MetaService) {}

  @Public()
  @Get(':token')
  async verify(@Param('token') token: string, @Query() q: Record<string, string>, @Res() reply: FastifyReply) {
    const challenge = await this.svc.verify(token, q['hub.mode'], q['hub.verify_token'], q['hub.challenge']);
    return reply.header('content-type', 'text/plain; charset=utf-8').send(challenge);
  }

  @Public()
  @ExternalWebhook()
  @Post(':token')
  @HttpCode(200)
  receive(@Param('token') token: string, @Req() req: FastifyRequest & { rawBody?: Buffer }, @Headers('x-hub-signature-256') sig: string | undefined, @Body() b: unknown) {
    return this.svc.handle(token, req.rawBody, sig, b);
  }
}
