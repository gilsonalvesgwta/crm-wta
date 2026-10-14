import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { parse } from '../http/validate.js';
import { readMessageUpload, sendBody } from './channels.controller.js';
import { ConversationsService } from './conversations.service.js';
import { QuickRepliesService } from './quick-replies.service.js';
import { optText, text, uuid } from './schemas.js';

const id = (v: string) => parse(uuid, v);
const channel = z.enum(['whatsapp', 'email', 'instagram'], { message: 'Escolha WhatsApp, e-mail ou Instagram.' });
const flag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true');
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t.optional());

const inboxQuery = z.object({
  status: opt(z.enum(['open', 'waiting', 'closed', 'all'])),
  channel: opt(channel),
  unread: flag,
  q: z.string().trim().max(120).optional().transform((v) => v || undefined),
  tagId: opt(uuid),
  assignee: opt(z.union([z.literal('me'), z.literal('none'), uuid])),
  teamId: opt(uuid),
  deal: opt(z.union([z.literal('open'), z.literal('none'), uuid])),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

const updateBody = z.object({
  status: z.enum(['open', 'waiting', 'closed']).optional(),
  assigneeId: uuid.nullable().optional(),
  teamId: uuid.nullable().optional(),
});

const quickReply = z.object({
  channel,
  shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/, { message: 'Use letras sem acento, números, - ou _ (até 40).' }),
  title: text(120, 'o título'),
  subject: optText(998),
  body: text(20000, 'o texto'),
  shared: z.boolean().default(false),
});

@Controller('v1/conversations')
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly svc: ConversationsService) {}

  @Require('conversations:reply')
  @Get()
  inbox(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.svc.inbox(a, parse(inboxQuery, q));
  }

  @Require('conversations:reply')
  @Get('unread')
  unread(@CurrentActor() a: Actor) {
    return this.svc.unreadCount(a);
  }

  /** Começa (ou acha) a conversa com um contato, mesmo sem mensagem nenhuma. */
  @Require('conversations:reply')
  @Post()
  start(@CurrentActor() a: Actor, @Body() b: unknown) {
    const v = parse(z.object({ contactId: uuid, channel }), b);
    return this.svc.start(a, v.contactId, v.channel);
  }

  @Require('conversations:reply')
  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.get(a, id(i));
  }

  @Require('conversations:reply')
  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.update(a, id(i), parse(updateBody, b));
  }

  @Require('conversations:reply')
  @Get(':id/messages')
  history(@CurrentActor() a: Actor, @Param('id') i: string, @Query('before') before?: string) {
    const b = before ? parse(z.string().datetime({ offset: true }), before) : undefined;
    return this.svc.history(a, id(i), b);
  }

  @Require('conversations:reply')
  @Post(':id/messages')
  send(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.send(a, id(i), parse(sendBody, b));
  }

  @Require('conversations:reply')
  @Post(':id/messages/file')
  async sendFile(@CurrentActor() a: Actor, @Param('id') i: string, @Req() req: FastifyRequest) {
    const u = await readMessageUpload(req, 16);
    return this.svc.send(a, id(i), parse(sendBody, u.body), u.file);
  }

  @Require('conversations:reply')
  @Post(':id/seen')
  @HttpCode(200)
  seen(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.markSeen(a, id(i));
  }
}

@Controller('v1/quick-replies')
export class QuickRepliesController {
  constructor(@Inject(QuickRepliesService) private readonly svc: QuickRepliesService) {}

  @Require('conversations:reply')
  @Get()
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({ channel: opt(channel), q: z.string().trim().max(120).optional().transform((v) => v || undefined) }), q);
    return this.svc.list(a, f);
  }

  @Require('conversations:reply')
  @Post()
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(quickReply, b));
  }

  @Require('conversations:reply')
  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.update(a, id(i), parse(quickReply, b));
  }

  @Require('conversations:reply')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.remove(a, id(i));
  }
}
