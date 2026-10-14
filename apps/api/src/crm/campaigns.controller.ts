import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, ExternalWebhook, Public, Require } from '../access/decorators.js';
import { audience, campaignBody, startBody } from '../domain/campaigns.js';
import { parse } from '../http/validate.js';
import { CampaignsService } from './campaigns.service.js';
import { MessagesService } from './messages.service.js';
import { uuid } from './schemas.js';

const id = (v: string) => parse(uuid, v);
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t.optional());

@Controller('v1/campaigns')
export class CampaignsController {
  constructor(@Inject(CampaignsService) private readonly svc: CampaignsService) {}

  @Require('campaigns:view')
  @Get()
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({
      status: opt(z.enum(['draft', 'scheduled', 'sending', 'paused', 'done', 'canceled'])),
      q: z.string().trim().max(120).optional().transform((v) => v || undefined),
    }), q);
    return this.svc.list(a, f);
  }

  @Require('campaigns:edit')
  @Post('preview')
  @HttpCode(200)
  preview(@CurrentActor() a: Actor, @Body() b: unknown) {
    const v = parse(z.object({ channel: z.enum(['whatsapp', 'email']), audience }), b);
    return this.svc.preview(a, v.channel, v.audience);
  }

  @Require('campaigns:edit')
  @Post()
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(campaignBody, b));
  }

  @Require('campaigns:view')
  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.get(a, id(i));
  }

  @Require('campaigns:view')
  @Get(':id/recipients')
  recipients(@CurrentActor() a: Actor, @Param('id') i: string, @Query() q: unknown) {
    const f = parse(z.object({
      status: opt(z.enum(['pending', 'sending', 'sent', 'failed', 'skipped'])),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }), q);
    return this.svc.recipients(a, id(i), f);
  }

  @Require('campaigns:edit')
  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.update(a, id(i), parse(campaignBody, b));
  }

  @Require('campaigns:edit')
  @Post(':id/duplicate')
  duplicate(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.duplicate(a, id(i));
  }

  @Require('campaigns:edit')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.remove(a, id(i));
  }

  @Require('campaigns:approve', 'tenant')
  @Post(':id/start')
  @HttpCode(200)
  start(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.start(a, id(i), parse(startBody, b ?? {}).scheduledAt);
  }

  @Require('campaigns:approve', 'tenant')
  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.setStatus(a, id(i), 'pause');
  }

  @Require('campaigns:approve', 'tenant')
  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.setStatus(a, id(i), 'resume');
  }

  @Require('campaigns:approve', 'tenant')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.setStatus(a, id(i), 'cancel');
  }
}

const PAGE = (title: string, text: string) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:system-ui,Arial,sans-serif;background:#f5f5f4;color:#111;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:28px;max-width:420px}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#444;line-height:1.5}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

/** Link de descadastro dos e-mails de campanha (abre no navegador ou um clique do provedor). */
@Controller('v1/public/descadastrar')
export class UnsubscribeController {
  constructor(@Inject(MessagesService) private readonly messages: MessagesService) {}

  private async handle(token: string, reply: FastifyReply) {
    const t = this.messages.readUnsubscribeToken(token);
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store');
    if (!t) return reply.status(404).send(PAGE('Link inválido', 'Este link de descadastro não é válido. Responda o e-mail pedindo para sair da lista.'));
    await this.messages.unsubscribe(t.t, t.c, t.v);
    return reply.status(200).send(PAGE('Pronto', 'Você não vai mais receber estes e-mails.'));
  }

  @Public()
  @Get(':token')
  get(@Param('token') token: string, @Res() reply: FastifyReply) {
    return this.handle(token, reply);
  }

  @Public()
  @ExternalWebhook()
  @Post(':token')
  post(@Param('token') token: string, @Res() reply: FastifyReply) {
    return this.handle(token, reply);
  }
}
