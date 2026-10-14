import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { parse } from '../http/validate.js';
import { ApiKeysService } from './api-keys.service.js';
import { InboundService } from './inbound.service.js';

const uuid = z.string().uuid();
const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const tags = z.array(z.string().trim().min(1).max(60)).max(20).optional();

const inboundBody = z.object({
  contact: z.object({
    name: opt(240), firstName: opt(120), lastName: opt(120), email: opt(254), phone: opt(40), jobTitle: opt(120),
    birthday: z.object({ day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12), year: z.number().int().min(1900).max(2100).nullable().optional() }).nullable().optional(),
    custom: z.record(z.string(), z.unknown()).optional(), tags, ownerEmail: opt(254),
  }),
  organization: z.object({ name: z.string().trim().min(1).max(200) }).nullable().optional(),
  deal: z.object({
    title: z.string().trim().min(1, { message: 'Informe o título do negócio.' }).max(200),
    value: z.number().min(0).max(90_000_000_000).nullable().optional(),
    pipelineId: uuid.nullable().optional(), pipeline: opt(80), stageId: uuid.nullable().optional(), stage: opt(80),
    ownerEmail: opt(254), custom: z.record(z.string(), z.unknown()).optional(), tags,
  }).nullable().optional(),
  lead: z.object({ title: z.string().trim().min(1).max(200), source: opt(200), ownerEmail: opt(254) }).nullable().optional(),
  note: opt(10000),
  touch: z.object({
    source: opt(200), medium: opt(200), campaign: opt(200), term: opt(200), content: opt(200), referrer: opt(2000), landingPage: opt(2000),
  }).nullable().optional(),
});

@Controller('v1')
export class IntegrationsController {
  constructor(
    @Inject(ApiKeysService) private readonly keys: ApiKeysService,
    @Inject(InboundService) private readonly inbound: InboundService,
  ) {}

  @Require('integrations:admin', 'tenant')
  @Get('api-keys')
  async list(@CurrentActor() a: Actor) {
    return { items: await this.keys.list(a) };
  }

  @Require('integrations:admin', 'tenant')
  @Post('api-keys')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.keys.create(a, parse(z.object({ name: z.string().trim().min(1, { message: 'Dê um nome à chave.' }).max(120) }), b).name);
  }

  @Require('integrations:admin', 'tenant')
  @Delete('api-keys/:id')
  @HttpCode(204)
  async revoke(@CurrentActor() a: Actor, @Param('id') id: string) {
    await this.keys.revoke(a, parse(uuid, id));
  }

  /** Entrada do n8n: contato (e organização, etiquetas), negócio no funil e etapa escolhidos, ou lead. */
  @Require('contacts:edit')
  @Post('inbound')
  @HttpCode(200)
  receive(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.inbound.receive(a, parse(inboundBody, b));
  }
}
