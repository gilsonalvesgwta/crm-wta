import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, PlatformAdmin } from '../access/decorators.js';
import { CONFIG, type Config } from '../config.js';
import { Problem } from '../http/problem.js';
import { parse } from '../http/validate.js';
import { BackupsService } from './backups.service.js';

const restoreBody = z.object({
  scope: z.enum(['full', 'tenant']),
  tenantId: z.string().uuid().optional(),
  confirm: z.literal('RESTAURAR', { message: 'Digite RESTAURAR para confirmar.' }),
});

@Controller('v1/platform/backups')
export class BackupsController {
  constructor(@Inject(BackupsService) private readonly svc: BackupsService, @Inject(CONFIG) private readonly cfg: Config) {}

  @PlatformAdmin()
  @Get()
  list() {
    return this.svc.overview();
  }

  @PlatformAdmin()
  @Post()
  create(@CurrentActor() a: Actor) {
    return this.svc.backupNow(a);
  }

  @PlatformAdmin()
  @Get('jobs/:id')
  job(@Param('id') id: string) {
    return this.svc.job(id);
  }

  @PlatformAdmin()
  @Post('upload')
  async upload(@CurrentActor() a: Actor, @Req() req: FastifyRequest) {
    const r = req as FastifyRequest & {
      isMultipart?: () => boolean;
      file?: (o?: unknown) => Promise<{ filename: string; fieldname: string; file: Readable & { truncated?: boolean } } | undefined>;
    };
    if (!r.isMultipart?.() || !r.file) throw new Problem(415, 'Envie como multipart/form-data.');
    const part = await r.file({ limits: { fileSize: this.cfg.BACKUP_UPLOAD_MAX_MB * 1024 * 1024, files: 1 } });
    if (!part || part.fieldname !== 'file') throw Problem.badRequest('Arquivo ausente.', [{ field: 'file', message: 'Escolha o arquivo da cópia.' }]);
    return this.svc.upload(a, part.filename || 'copia', part.file);
  }

  @PlatformAdmin()
  @Get(':name/download')
  async download(@CurrentActor() a: Actor, @Param('name') name: string, @Res() res: FastifyReply) {
    const f = await this.svc.open(a, name);
    void res
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(f.size))
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(f.stream);
  }

  @PlatformAdmin()
  @Post(':name/restore')
  restore(@CurrentActor() a: Actor, @Param('name') name: string, @Body() b: unknown) {
    const body = parse(restoreBody, b);
    return this.svc.restore(a, name, body.scope, body.tenantId);
  }

  @PlatformAdmin()
  @Delete(':name')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('name') name: string) {
    await this.svc.remove(a, name);
  }
}
