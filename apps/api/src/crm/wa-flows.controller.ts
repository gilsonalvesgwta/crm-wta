import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { parse } from '../http/validate.js';
import { WA_TRIGGERS } from '../domain/flows.js';
import { IgFlowsService } from './ig-flows.service.js';
import * as S from './schemas.js';

const id = (v: string) => parse(S.uuid, v);

/**
 * Fluxos do WhatsApp oficial (estilo Manychat): a transmissão (campanha) manda
 * um modelo aprovado com botões e o clique continua a conversa pelo fluxo.
 * Mesmo desenho e motor dos fluxos do Instagram; a biblioteca de mídia é a mesma.
 */
@Controller('v1/whatsapp')
export class WaFlowsController {
  constructor(@Inject(IgFlowsService) private readonly svc: IgFlowsService) {}

  @Require('campaigns:view')
  @Get('accounts')
  accounts(@CurrentActor() a: Actor) {
    return this.svc.accounts(a, 'whatsapp');
  }

  @Require('campaigns:view')
  @Get('flows')
  list(@CurrentActor() a: Actor) {
    return this.svc.list(a, 'whatsapp');
  }

  @Require('campaigns:edit')
  @Post('flows')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(z.object({
      accountId: S.uuid,
      name: z.string().trim().max(80, { message: 'Até 80 caracteres.' }).default(''),
      triggerType: z.enum(WA_TRIGGERS, { message: 'Escolha o que dispara o fluxo.' }),
    }), b), 'whatsapp');
  }

  @Require('campaigns:view')
  @Get('flows/:id')
  get(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.get(a, id(i), 'whatsapp');
  }

  @Require('campaigns:edit')
  @Patch('flows/:id')
  save(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.save(a, id(i), parse(z.object({
      name: z.string().trim().min(1, { message: 'Dê um nome ao fluxo.' }).max(80, { message: 'Até 80 caracteres.' }).optional(),
      draft: z.unknown().optional(),
      accountId: S.uuid.optional(),
    }), b), 'whatsapp');
  }

  @Require('campaigns:edit')
  @Post('flows/:id/publish')
  @HttpCode(200)
  publish(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.publish(a, id(i), 'whatsapp');
  }

  @Require('campaigns:edit')
  @Post('flows/:id/pause')
  @HttpCode(200)
  pause(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.setStatus(a, id(i), 'paused', 'whatsapp');
  }

  @Require('campaigns:edit')
  @Post('flows/:id/resume')
  @HttpCode(200)
  resume(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.setStatus(a, id(i), 'active', 'whatsapp');
  }

  @Require('campaigns:edit')
  @Post('flows/:id/duplicate')
  duplicate(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.duplicate(a, id(i), 'whatsapp');
  }

  @Require('campaigns:edit')
  @Delete('flows/:id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.remove(a, id(i), 'whatsapp');
  }

  @Require('campaigns:view')
  @Get('flows/:id/results')
  results(@CurrentActor() a: Actor, @Param('id') i: string, @Query() q: unknown) {
    const f = parse(z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }), q);
    return this.svc.results(a, id(i), f, 'whatsapp');
  }
}
