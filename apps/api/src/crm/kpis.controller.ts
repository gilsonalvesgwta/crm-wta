import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Require } from '../access/decorators.js';
import { parse } from '../http/validate.js';
import { AdsService } from './ads.service.js';
import { KpisService } from './kpis.service.js';
import * as S from './schemas.js';

const id = (v: string) => parse(S.uuid, v);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use AAAA-MM-DD.' }).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: 'Data inválida.' });
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const range = z.object({ from: day, to: day })
  .refine((v) => days(v.from, v.to) >= 0, { message: 'A data final precisa ser igual ou depois da inicial.', path: ['to'] })
  .refine((v) => days(v.from, v.to) <= 366, { message: 'Período de até um ano.', path: ['to'] });

const spendBody = z.object({
  platform: z.enum(['meta', 'google', 'tiktok', 'other']),
  description: z.string().max(200, { message: 'Até 200 caracteres.' }).nullable().optional(),
  firstDay: day,
  lastDay: day,
  amountCents: z.number({ message: 'Informe o valor.' }).int().min(0, { message: 'O valor não pode ser negativo.' }).max(100_000_000_000),
}).refine((v) => days(v.firstDay, v.lastDay) >= 0, { message: 'O último dia precisa ser igual ou depois do primeiro.', path: ['lastDay'] })
  .refine((v) => days(v.firstDay, v.lastDay) <= 366, { message: 'Período de até um ano.', path: ['lastDay'] });

/** KPIs do funil com o investimento em anúncios. */
@Controller('v1')
export class KpisController {
  constructor(
    @Inject(KpisService) private readonly kpis: KpisService,
    @Inject(AdsService) private readonly ads: AdsService,
  ) {}

  @Require('reports:view')
  @Get('dashboard/kpis')
  summary(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({ from: day, to: day, step: z.coerce.number().int().min(1).max(366).default(7) }), q);
    parse(range, { from: f.from, to: f.to });
    return this.kpis.summary(a, f);
  }

  /** Os registros por trás de um número (conferência). */
  @Require('reports:view')
  @Get('dashboard/kpis/details')
  details(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({ from: day, to: day, metric: z.enum(['leads', 'prospected', 'scheduled', 'held', 'no_show', 'rescheduled', 'sales']) }), q);
    parse(range, { from: f.from, to: f.to });
    return this.kpis.details(a, f);
  }

  /** Tirar um registro dos KPIs (ou voltar a contar). Não apaga nada do CRM. */
  @Require('reports:export')
  @Post('dashboard/kpis/exclusions')
  @HttpCode(204)
  async exclude(@CurrentActor() a: Actor, @Body() b: unknown) {
    const x = parse(z.object({ kind: z.enum(['contact', 'activity', 'deal']), id: S.uuid, excluded: z.boolean() }), b);
    await this.kpis.setExcluded(a, x.kind, x.id, x.excluded);
  }

  @Require('reports:view')
  @Get('dashboard/kpis/settings')
  settings(@CurrentActor() a: Actor) {
    return this.kpis.settings(a);
  }

  @Require('reports:export')
  @Patch('dashboard/kpis/settings')
  saveSettings(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.kpis.saveSettings(a, parse(z.object({ leadTagIds: z.array(S.uuid).max(20) }), b).leadTagIds);
  }

  @Require('reports:view')
  @Get('ads/spend')
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(range, q);
    return this.ads.list(a, f.from, f.to);
  }

  @Require('reports:export')
  @Post('ads/spend')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.ads.create(a, parse(spendBody, b));
  }

  @Require('reports:export')
  @Patch('ads/spend/:id')
  update(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.ads.update(a, id(i), parse(spendBody, b));
  }

  @Require('reports:export')
  @Delete('ads/spend/:id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.ads.remove(a, id(i));
  }

  @Require('reports:view')
  @Get('ads/accounts')
  accounts(@CurrentActor() a: Actor) {
    return this.ads.accounts(a);
  }

  @Require('reports:export')
  @Post('ads/accounts/meta')
  connect(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.ads.connectMeta(a, parse(z.object({
      accountId: z.string().trim().min(1, { message: 'Informe o id da conta de anúncios.' }).max(40),
      token: z.string().trim().min(8, { message: 'Cole o token de acesso.' }).max(1000),
    }), b));
  }

  @Require('reports:export')
  @Post('ads/accounts/:id/sync')
  @HttpCode(200)
  sync(@CurrentActor() a: Actor, @Param('id') i: string) {
    return this.ads.syncNow(a, id(i));
  }

  @Require('reports:export')
  @Delete('ads/accounts/:id')
  @HttpCode(204)
  async disconnect(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.ads.disconnect(a, id(i));
  }
}
