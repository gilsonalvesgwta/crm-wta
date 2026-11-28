import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { aftersaleBody, aftersaleQuery } from '../domain/aftersale.js';
import { parse } from '../http/validate.js';
import { AftersaleService } from './aftersale.service.js';
import { uuid } from './schemas.js';

/** Pós-venda: lista de clientes para contatar e a configuração dos lembretes. */
@Controller('v1/aftersale')
export class AftersaleController {
  constructor(@Inject(AftersaleService) private readonly svc: AftersaleService) {}

  @Require('deals:view')
  @Get()
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.svc.list(a, parse(aftersaleQuery, q));
  }

  @Require('deals:view')
  @Get('settings')
  settings(@CurrentActor() a: Actor) {
    return this.svc.settings(a);
  }

  @Require('pipelines:admin', 'tenant')
  @Put('settings')
  save(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.save(a, parse(aftersaleBody, b));
  }

  /** Marca o contato de pós-venda como feito (para os lembretes) ou desfaz. */
  @Require('deals:view')
  @Post(':dealId/done')
  @HttpCode(200)
  done(@CurrentActor() a: Actor, @Param('dealId') d: string, @Body() b: unknown) {
    const v = parse(z.object({ done: z.boolean().default(true), note: z.string().trim().max(1000).nullable().optional().transform((x) => x || null) }), b ?? {});
    return this.svc.setDone(a, parse(uuid, d), v.done, v.note);
  }
}
