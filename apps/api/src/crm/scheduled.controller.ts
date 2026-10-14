import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { parse } from '../http/validate.js';
import { ScheduledService } from './scheduled.service.js';
import { optText, uuid } from './schemas.js';

const id = (v: string) => parse(uuid, v);
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t.optional());
const when = z.string().datetime({ offset: true, message: 'Data e hora inválidas.' });
const body = z.string().trim().min(1, { message: 'Escreva a mensagem.' }).max(20000);

@Controller('v1')
export class ScheduledController {
  constructor(@Inject(ScheduledService) private readonly svc: ScheduledService) {}

  /** Ações agendadas: mensagens, passos de automação, campanhas e tarefas, no alcance de cada permissão. */
  @Get('scheduled')
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.svc.list(a, parse(z.object({
      kind: opt(z.enum(['message', 'automation', 'campaign', 'task'])),
      status: opt(z.enum(['pending', 'done', 'all'])).transform((v) => v ?? 'pending'),
      from: opt(when), to: opt(when), ownerId: opt(uuid), contactId: opt(uuid),
      q: z.string().trim().max(120).optional().transform((v) => v || undefined),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }), q));
  }

  @Require('scheduled:manage')
  @Post('scheduled-messages')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(z.object({ contactId: uuid, accountId: uuid, to: optText(254), subject: optText(998), text: body, sendAt: when }), b));
  }

  @Require('scheduled:manage')
  @Get('scheduled-messages/:id')
  get(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.get(a, id(i));
  }

  @Require('scheduled:manage')
  @Patch('scheduled-messages/:id')
  update(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.update(a, id(i), parse(z.object({ text: body.optional(), subject: optText(998), sendAt: when.optional(), accountId: uuid.optional() }), b));
  }

  @Require('scheduled:manage')
  @Post('scheduled-messages/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.cancel(a, id(i));
  }
}
