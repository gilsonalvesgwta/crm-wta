import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, ExternalWebhook, Public, Require } from '../access/decorators.js';
import { Problem } from '../http/problem.js';
import { parse } from '../http/validate.js';
import { ChannelsService } from './channels.service.js';
import { MessagesService } from './messages.service.js';
import { optText, text, uuid } from './schemas.js';

const id = (v: string) => parse(uuid, v);

const host = z.string().trim().toLowerCase().regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^\d{1,3}(\.\d{1,3}){3}$/, { message: 'Use o endereço do servidor, como smtp.hostinger.com.' });
const emailAddr = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'E-mail inválido.' });
const emailAccount = z.object({
  name: text(120, 'um nome para a conta'),
  host,
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: text(254, 'o usuário'),
  pass: z.string().max(500).nullable().optional().transform((v) => (v ? v : null)),
  fromName: text(120, 'o nome do remetente'),
  address: emailAddr,
});
export const sendBody = z.object({
  accountId: uuid,
  to: optText(254),
  text: z.string().max(65536, { message: 'Mensagem longa demais.' }).nullable().optional(),
  subject: optText(998),
});

@Controller('v1/channels')
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly svc: ChannelsService) {}

  @Require('channels:admin', 'tenant')
  @Get()
  list(@CurrentActor() a: Actor) {
    return this.svc.list(a);
  }

  @Require('conversations:reply')
  @Get('available')
  available(@CurrentActor() a: Actor) {
    return this.svc.available(a);
  }

  @Require('channels:admin', 'tenant')
  @Post('whatsapp')
  createWhatsapp(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.createWhatsapp(a, parse(z.object({ name: text(120, 'um nome para o número') }), b).name);
  }

  @Require('channels:admin', 'tenant')
  @Get(':id/qr')
  qr(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.qr(a, id(i));
  }

  @Require('channels:admin', 'tenant')
  @Post(':id/refresh')
  @HttpCode(200)
  refresh(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.refresh(a, id(i));
  }

  @Require('channels:admin', 'tenant')
  @Post(':id/rewire')
  @HttpCode(200)
  rewire(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.rewire(a, id(i));
  }

  @Require('channels:admin', 'tenant')
  @Post(':id/disconnect')
  @HttpCode(200)
  disconnect(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.disconnect(a, id(i));
  }

  @Require('channels:admin', 'tenant')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.remove(a, id(i));
  }

  @Require('channels:admin', 'tenant')
  @Post('email')
  createEmail(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.saveEmail(a, null, parse(emailAccount, b));
  }

  @Require('channels:admin', 'tenant')
  @Patch('email/:id')
  updateEmail(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.saveEmail(a, id(i), parse(emailAccount, b));
  }

  @Require('channels:admin', 'tenant')
  @Post(':id/test')
  @HttpCode(200)
  test(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.testEmail(a, id(i));
  }
}

/** Lê um envio multipart com campos antes do arquivo (campo "file"). */
export async function readMessageUpload(req: FastifyRequest, maxMb: number) {
  const r = req as FastifyRequest & {
    isMultipart?: () => boolean;
    file?: (o?: unknown) => Promise<{ filename: string; fieldname: string; toBuffer(): Promise<Buffer>; fields: Record<string, unknown> } | undefined>;
  };
  if (!r.isMultipart?.() || !r.file) throw new Problem(415, 'Envie como multipart/form-data.');
  const part = await r.file({ limits: { fileSize: maxMb * 1024 * 1024, files: 1 } });
  if (!part || part.fieldname !== 'file') throw Problem.badRequest('Arquivo ausente.', [{ field: 'file', message: 'Escolha um arquivo.' }]);
  const field = (k: string) => {
    const f = part.fields[k] as { value?: unknown } | undefined;
    const v = Array.isArray(f) ? undefined : f?.value;
    return typeof v === 'string' ? v : undefined;
  };
  let data: Buffer;
  try {
    data = await part.toBuffer();
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new Problem(413, `O arquivo passa de ${maxMb} MB.`);
    throw err;
  }
  return {
    file: { name: part.filename || 'arquivo', data },
    body: { accountId: field('accountId'), to: field('to') ?? null, text: field('text') ?? null, subject: field('subject') ?? null },
  };
}

@Controller('v1')
export class MessagesController {
  constructor(@Inject(MessagesService) private readonly svc: MessagesService) {}

  @Require('contacts:view')
  @Get('contacts/:id/messages')
  history(@CurrentActor() a: Actor, @Param('id') i: string, @Query('before') before?: string) {
    const b = before ? parse(z.string().datetime({ offset: true }), before) : undefined;
    return this.svc.history(a, id(i), b);
  }

  @Require('conversations:reply')
  @Post('contacts/:id/messages')
  send(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.send(a, id(i), parse(sendBody, b));
  }

  @Require('conversations:reply')
  @Post('contacts/:id/messages/file')
  async sendFile(@CurrentActor() a: Actor, @Param('id') i: string, @Req() req: FastifyRequest) {
    const u = await readMessageUpload(req, 16);
    return this.svc.send(a, id(i), parse(sendBody, u.body), u.file);
  }

  @Require('contacts:view')
  @Post('contacts/:id/messages/seen')
  @HttpCode(200)
  seen(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.markSeen(a, id(i));
  }
}

/** Avisos da Evolution API. O token no endereço identifica a empresa e a conta. */
@Controller('v1/webhooks')
export class EvolutionWebhookController {
  constructor(@Inject(ChannelsService) private readonly svc: ChannelsService) {}

  @Public()
  @ExternalWebhook()
  @Post('evolution/:token')
  @HttpCode(200)
  evolution(@Param('token') token: string, @Body() b: unknown) {
    return this.svc.handleEvolution(token, b);
  }
}
