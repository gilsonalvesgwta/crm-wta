import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '../access/actor.js';
import { CurrentActor, ExternalWebhook, Public, Require } from '../access/decorators.js';
import { voiceProviderBody, voiceTestBody } from '../domain/voice.js';
import { parse } from '../http/validate.js';
import { readUpload } from './crm.controller.js';
import { uuid } from './schemas.js';
import { VoiceService } from './voice.service.js';

const id = (v: string) => parse(uuid, v);

/** Operadoras de voz e áudios das ligações. */
@Controller('v1/voice')
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly svc: VoiceService) {}

  @Require('campaigns:view')
  @Get('providers')
  list(@CurrentActor() a: Actor) {
    return this.svc.list(a);
  }

  @Require('channels:admin', 'tenant')
  @Post('providers')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(voiceProviderBody, b));
  }

  @Require('channels:admin', 'tenant')
  @Patch('providers/:id')
  update(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.update(a, id(i), parse(voiceProviderBody, b));
  }

  @Require('channels:admin', 'tenant')
  @Delete('providers/:id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') i: string) {
    await this.svc.remove(a, id(i));
  }

  /** Confere as credenciais e, com um telefone, faz uma ligação de teste. */
  @Require('channels:admin', 'tenant')
  @Post('providers/:id/test')
  @HttpCode(200)
  test(@CurrentActor() a: Actor, @Param('id') i: string, @Body() b: unknown) {
    return this.svc.test(a, id(i), parse(voiceTestBody, b ?? {}));
  }

  @Require('campaigns:view')
  @Get('audios')
  audios(@CurrentActor() a: Actor) {
    return this.svc.audios(a);
  }

  /** Áudio gravado na hora ou enviado: vira MP3 na biblioteca de mídia. */
  @Require('campaigns:edit')
  @Post('audios')
  async upload(@CurrentActor() a: Actor, @Req() req: FastifyRequest) {
    const f = await readUpload(req, 25);
    return this.svc.uploadAudio(a, f.name, f.data);
  }
}

/** Avisos das operadoras e o áudio que elas tocam (endereços assinados). */
@Controller('v1/public/voz')
export class VoiceWebhookController {
  constructor(@Inject(VoiceService) private readonly svc: VoiceService) {}

  @Public()
  @Get('audio/:token')
  async audio(@Param('token') token: string, @Res() reply: FastifyReply) {
    const a = await this.svc.openAudio(token);
    return reply.header('content-type', a.contentType).header('cache-control', 'public, max-age=3600').send(a.data);
  }

  private async reply(reply: FastifyReply, token: string, rid: string, kind: string, body: unknown) {
    const r = await this.svc.handle(token, rid, kind, body);
    return reply.status(200).header('content-type', r.type === 'xml' ? 'text/xml; charset=utf-8' : 'application/json').send(r.body);
  }

  @Public()
  @ExternalWebhook()
  @Post(':token/:rid/:kind')
  post(@Param('token') token: string, @Param('rid') rid: string, @Param('kind') kind: string, @Body() b: unknown, @Query() q: unknown, @Res() reply: FastifyReply) {
    // Algumas operadoras mandam parte dos dados no endereço.
    const body = { ...(q && typeof q === 'object' ? q : {}), ...(b && typeof b === 'object' ? b : {}) };
    return this.reply(reply, token, rid, kind, body);
  }

  /** Central Asterisk (CURL no roteiro) e operadoras que avisam por GET. */
  @Public()
  @Get(':token/:rid/:kind')
  get(@Param('token') token: string, @Param('rid') rid: string, @Param('kind') kind: string, @Query() q: unknown, @Res() reply: FastifyReply) {
    return this.reply(reply, token, rid, kind, q ?? {});
  }
}
