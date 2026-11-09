import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { parse } from '../http/validate.js';
import { TRIGGERS } from '../domain/flows.js';
import { readUpload } from './crm.controller.js';
import { IgFlowsService } from './ig-flows.service.js';
import * as S from './schemas.js';

const id = (v: string) => parse(S.uuid, v);

/** Fluxos do Instagram (estilo Manychat), mídias, contatos e diagnóstico. */
@Controller('v1/instagram')
export class IgFlowsController {
  constructor(@Inject(IgFlowsService) private readonly svc: IgFlowsService) {}

  @Require('campaigns:view')
  @Get('accounts')
  accounts(@CurrentActor() a: Actor) {
    return this.svc.accounts(a);
  }

  @Require('campaigns:view')
  @Get('flows')
  list(@CurrentActor() a: Actor) {
    return this.svc.list(a);
  }

  @Require('campaigns:edit')
  @Post('flows')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(z.object({
      accountId: S.uuid,
      name: z.string().trim().max(80, { message: 'Até 80 caracteres.' }).default(''),
      triggerType: z.enum(TRIGGERS, { message: 'Escolha o que dispara o fluxo.' }),
    }), b));
  }

  @Require('campaigns:view')
  @Get('flows/:id')
  get(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.get(a, id(i));
  }

  /** Salva o rascunho (o desenho da tela) e o nome. */
  @Require('campaigns:edit')
  @Patch('flows/:id')
  save(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.save(a, id(i), parse(z.object({
      name: z.string().trim().min(1, { message: 'Dê um nome ao fluxo.' }).max(80, { message: 'Até 80 caracteres.' }).optional(),
      draft: z.unknown().optional(),
      accountId: S.uuid.optional(),
    }), b));
  }

  @Require('campaigns:edit')
  @Post('flows/:id/publish')
  @HttpCode(200)
  publish(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.publish(a, id(i));
  }

  @Require('campaigns:edit')
  @Post('flows/:id/pause')
  @HttpCode(200)
  pause(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.setStatus(a, id(i), 'paused');
  }

  @Require('campaigns:edit')
  @Post('flows/:id/resume')
  @HttpCode(200)
  resume(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.setStatus(a, id(i), 'active');
  }

  @Require('campaigns:edit')
  @Post('flows/:id/duplicate')
  duplicate(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.duplicate(a, id(i));
  }

  @Require('campaigns:edit')
  @Delete('flows/:id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.remove(a, id(i));
  }

  @Require('campaigns:view')
  @Get('flows/:id/results')
  results(@CurrentActor() a: Actor, @Param('id') i: string, @Query() q: unknown) {
    const f = parse(z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }), q);
    return this.svc.results(a, id(i), f);
  }

  /** Publicações recentes da conta (para escolher em quais o fluxo funciona). */
  @Require('campaigns:view')
  @Get('posts')
  posts(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.svc.posts(a, parse(z.object({ accountId: S.uuid }), q).accountId);
  }

  @Require('campaigns:view')
  @Get('media')
  media(@CurrentActor() a: Actor) {
    return this.svc.media(a);
  }

  @Require('campaigns:edit')
  @Post('media')
  async upload(@CurrentActor() a: Actor, @Req() req: FastifyRequest) {
    const f = await readUpload(req, 25);
    return this.svc.uploadMedia(a, f.name, f.data);
  }

  @Require('campaigns:view')
  @Get('media/:id/url')
  mediaUrl(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.svc.mediaUrl(a, id(i));
  }

  @Require('campaigns:edit')
  @Delete('media/:id')
  @HttpCode(204)
  async removeMedia(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.removeMedia(a, id(i));
  }

  @Require('contacts:view')
  @Get('contacts')
  contacts(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.svc.contacts(a, parse(z.object({
      q: z.string().max(100).optional(), tagId: S.uuid.optional(), page: z.coerce.number().int().min(1).max(10_000).default(1),
    }), q));
  }

  @Require('campaigns:view')
  @Get('diagnostics')
  diagnostics(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.svc.diagnostics(a, parse(z.object({ accountId: S.uuid }), q).accountId);
  }

  @Require('campaigns:edit')
  @Post('diagnostics/subscribe')
  @HttpCode(200)
  subscribe(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.subscribe(a, parse(z.object({ accountId: S.uuid }), b).accountId);
  }
}
