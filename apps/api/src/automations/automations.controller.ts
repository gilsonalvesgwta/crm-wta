import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { ruleBody, VARIABLES } from '../domain/automations.js';
import { parse } from '../http/validate.js';
import { AutomationsService } from './automations.service.js';

const uuid = z.string().uuid();

@Controller('v1/automations')
export class AutomationsController {
  constructor(@Inject(AutomationsService) private readonly svc: AutomationsService) {}

  @Require('automations:view', 'tenant')
  @Get()
  async list(@CurrentActor() a: Actor) {
    return { ...(await this.svc.list(a)), variables: VARIABLES };
  }

  @Require('automations:view', 'tenant')
  @Get('runs')
  runs(@CurrentActor() a: Actor, @Query('ruleId') ruleId?: string) {
    return this.svc.runs(a, ruleId ? parse(uuid, ruleId) : undefined);
  }

  @Require('automations:admin', 'tenant')
  @Post()
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(ruleBody, b));
  }

  @Require('automations:admin', 'tenant')
  @Put(':id')
  update(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.svc.update(a, parse(uuid, id), parse(ruleBody, b));
  }

  @Require('automations:admin', 'tenant')
  @Patch(':id')
  toggle(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.svc.setActive(a, parse(uuid, id), parse(z.object({ active: z.boolean() }), b).active);
  }

  @Require('automations:admin', 'tenant')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') id: string) {
    await this.svc.remove(a, parse(uuid, id));
  }
}
