import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../access/actor.js';
import { CurrentActor, Public, Require } from '../access/decorators.js';
import { CONFIG, type Config } from '../config.js';
import { Problem } from '../http/problem.js';
import { parse } from '../http/validate.js';
import { ActivitiesService } from './activities.service.js';
import { CatalogService } from './catalog.service.js';
import { ContactsService } from './contacts.service.js';
import { OperationService } from './operation.service.js';
import { SalesService } from './sales.service.js';
import { DashboardService } from './dashboard.service.js';
import { DealsService } from './deals.service.js';
import { FilesService } from './files.service.js';
import { ImportExportService } from './import-export.service.js';
import { LeadsService } from './leads.service.js';
import { OrganizationsService } from './organizations.service.js';
import { PipelinesService } from './pipelines.service.js';
import { PrivacyService } from './privacy.service.js';
import { RecordsService } from './records.service.js';
import * as S from './schemas.js';

const id = (v: string) => parse(S.uuid, v);

function sendCsv(res: FastifyReply, name: string, data: Buffer) {
  const date = new Date().toISOString().slice(0, 10);
  void res
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}-${date}.csv"`)
    .send(data);
}

/** Lê o arquivo de um envio multipart (campo "file"), com o limite de tamanho. */
export async function readUpload(req: FastifyRequest, maxMb: number): Promise<{ name: string; data: Buffer }> {
  const r = req as FastifyRequest & { isMultipart?: () => boolean; file?: (o?: unknown) => Promise<{ filename: string; toBuffer(): Promise<Buffer>; fieldname: string } | undefined> };
  if (!r.isMultipart?.() || !r.file) throw new Problem(415, 'Envie o arquivo como multipart/form-data.');
  const part = await r.file({ limits: { fileSize: maxMb * 1024 * 1024, files: 1 } });
  if (!part || part.fieldname !== 'file') throw Problem.badRequest('Arquivo ausente.', [{ field: 'file', message: 'Escolha um arquivo.' }]);
  try {
    return { name: part.filename || 'arquivo', data: await part.toBuffer() };
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new Problem(413, `O arquivo passa de ${maxMb} MB.`);
    throw err;
  }
}

// ---- Contatos -------------------------------------------------------------------

@Controller('v1/contacts')
export class ContactsController {
  constructor(
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(ImportExportService) private readonly io: ImportExportService,
  ) {}

  @Require('contacts:view')
  @Get()
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.contacts.list(a, parse(S.contactQuery, q));
  }

  @Require('contacts:import_export', 'tenant')
  @Get('export.csv')
  async export(@CurrentActor() a: Actor, @Query() q: unknown, @Res() res: FastifyReply) {
    const f = parse(z.object({ ownerId: S.uuid.optional(), tagId: S.uuid.optional(), organizationId: S.uuid.optional() }), q);
    sendCsv(res, 'contatos', (await this.io.exportContacts(a, f)).data);
  }

  @Require('contacts:edit')
  @Post()
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    const { allowDuplicate, touch, ...input } = parse(S.contactCreate, b);
    return this.contacts.create(a, input, { allowDuplicate, touch });
  }

  @Require('contacts:view')
  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.contacts.get(a, id(v));
  }

  @Require('contacts:edit')
  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.contacts.update(a, id(v), parse(S.contactPatch, b));
  }

  @Require('contacts:delete', 'tenant')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.contacts.remove(a, id(v));
  }

  @Require('contacts:view')
  @Get(':id/duplicates')
  duplicates(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.contacts.duplicatesOf(a, id(v));
  }

  @Require('contacts:delete', 'tenant')
  @Post(':id/merge')
  @HttpCode(200)
  merge(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.contacts.merge(a, id(v), parse(z.object({ mergeId: S.uuid }), b).mergeId);
  }

  @Require('contacts:view')
  @Get(':id/consents')
  consents(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.contacts.consentHistory(a, id(v));
  }

  @Require('contacts:edit')
  @Post(':id/consents')
  @HttpCode(200)
  consent(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.contacts.recordConsent(a, id(v), parse(S.consentBody, b));
  }

  @Require('contacts:edit')
  @Post(':id/attribution')
  @HttpCode(200)
  touch(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.contacts.addTouch(a, id(v), parse(S.touch, b));
  }
}

// ---- Organizações ---------------------------------------------------------------------

@Controller('v1/organizations')
export class OrganizationsController {
  constructor(
    @Inject(OrganizationsService) private readonly orgs: OrganizationsService,
    @Inject(ImportExportService) private readonly io: ImportExportService,
  ) {}

  @Require('contacts:view')
  @Get()
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.orgs.list(a, parse(S.orgQuery, q));
  }

  @Require('contacts:import_export', 'tenant')
  @Get('export.csv')
  async export(@CurrentActor() a: Actor, @Res() res: FastifyReply) {
    sendCsv(res, 'organizacoes', (await this.io.exportOrganizations(a)).data);
  }

  @Require('contacts:edit')
  @Post()
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.orgs.create(a, parse(S.orgBody, b));
  }

  @Require('contacts:view')
  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.orgs.get(a, id(v));
  }

  @Require('contacts:edit')
  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.orgs.update(a, id(v), parse(S.orgBody.partial(), b));
  }

  @Require('contacts:delete', 'tenant')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.orgs.remove(a, id(v));
  }
}

// ---- Cadastros de apoio -------------------------------------------------------------------

@Controller('v1')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('directory')
  directory(@CurrentActor() a: Actor) {
    return this.catalog.directory(a);
  }

  @Get('tags')
  tags(@CurrentActor() a: Actor) {
    return this.catalog.tags(a);
  }

  @Require('contacts:edit')
  @Post('tags')
  createTag(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.catalog.createTag(a, parse(S.tagBody, b));
  }

  @Require('contacts:delete', 'tenant')
  @Patch('tags/:id')
  updateTag(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.catalog.updateTag(a, id(v), parse(S.tagBody.partial(), b));
  }

  @Require('contacts:delete', 'tenant')
  @Delete('tags/:id')
  @HttpCode(204)
  async deleteTag(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.catalog.deleteTag(a, id(v));
  }

  @Get('custom-fields')
  fields(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.catalog.fields(a, parse(z.object({ entity: z.enum(['contact', 'organization', 'deal', 'lead']).optional() }), q).entity);
  }

  @Require('pipelines:admin', 'tenant')
  @Post('custom-fields')
  createField(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.catalog.createField(a, parse(S.fieldBody, b));
  }

  @Require('pipelines:admin', 'tenant')
  @Patch('custom-fields/:id')
  updateField(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.catalog.updateField(a, id(v), parse(S.fieldPatch, b));
  }

  @Get('products')
  products(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({ q: z.string().max(100).optional(), includeInactive: z.enum(['true', 'false']).optional() }), q);
    return this.catalog.products(a, { q: f.q, includeInactive: f.includeInactive === 'true' });
  }

  @Require('products:admin', 'tenant')
  @Post('products')
  createProduct(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.catalog.saveProduct(a, null, parse(S.productBody, b));
  }

  @Require('products:admin', 'tenant')
  @Patch('products/:id')
  updateProduct(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.catalog.saveProduct(a, id(v), parse(S.productBody.partial().omit({ priceCents: true }).extend({ priceCents: S.productBody.shape.priceCents.optional() }), b));
  }

  @Get('outcome-reasons')
  reasons(@CurrentActor() a: Actor) {
    return this.catalog.reasons(a);
  }

  @Require('pipelines:admin', 'tenant')
  @Post('outcome-reasons')
  createReason(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.catalog.saveReason(a, null, parse(S.reasonBody, b));
  }

  @Require('pipelines:admin', 'tenant')
  @Patch('outcome-reasons/:id')
  updateReason(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.catalog.saveReason(a, id(v), parse(S.reasonPatch, b));
  }

  @Get('views')
  views(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.catalog.views(a, parse(z.object({ entity: S.viewBody.shape.entity }), q).entity);
  }

  @Post('views')
  createView(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.catalog.createView(a, parse(S.viewBody, b));
  }

  @Delete('views/:id')
  @HttpCode(204)
  async deleteView(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.catalog.deleteView(a, id(v));
  }
}

// ---- Funis ----------------------------------------------------------------------------

@Controller('v1/pipelines')
export class PipelinesController {
  constructor(@Inject(PipelinesService) private readonly pipelines: PipelinesService) {}

  @Get()
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.pipelines.list(a, parse(z.object({ archived: z.enum(['true', 'false']).optional() }), q).archived === 'true');
  }

  @Require('pipelines:admin', 'tenant')
  @Post()
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.pipelines.create(a, parse(S.pipelineBody, b));
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.pipelines.get(a, id(v));
  }

  @Require('pipelines:admin', 'tenant')
  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.pipelines.update(a, id(v), parse(S.pipelinePatch, b));
  }

  @Require('pipelines:admin', 'tenant')
  @Put(':id/stages')
  stages(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.pipelines.saveStages(a, id(v), parse(S.stagesBody, b).stages);
  }

  @Require('pipelines:admin', 'tenant')
  @Put(':id/transitions')
  transitions(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.pipelines.saveTransitions(a, id(v), parse(S.transitionsBody, b).rules);
  }

  @Require('pipelines:admin', 'tenant')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.pipelines.remove(a, id(v));
  }
}

// ---- Negócios ----------------------------------------------------------------------------

@Controller('v1/deals')
export class DealsController {
  constructor(
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(ImportExportService) private readonly io: ImportExportService,
  ) {}

  @Require('deals:view')
  @Get()
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.deals.list(a, parse(S.dealQuery, q));
  }

  @Require('deals:view')
  @Get('board')
  board(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(S.boardQuery, q);
    return this.deals.board(a, f.pipelineId, f);
  }

  @Require('deals:export', 'tenant')
  @Get('export.csv')
  async export(@CurrentActor() a: Actor, @Query() q: unknown, @Res() res: FastifyReply) {
    const f = parse(z.object({ pipelineId: S.uuid.optional(), status: z.enum(['open', 'won', 'lost', 'all']).optional() }), q);
    sendCsv(res, 'negocios', (await this.io.exportDeals(a, f)).data);
  }

  @Require('deals:edit')
  @Post()
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.deals.create(a, parse(S.dealBody, b));
  }

  @Require('deals:view')
  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.deals.get(a, id(v));
  }

  @Require('deals:edit')
  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.deals.update(a, id(v), parse(S.dealPatch, b));
  }

  @Require('deals:edit')
  @Post(':id/move')
  @HttpCode(200)
  move(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.deals.move(a, id(v), parse(S.dealMove, b));
  }

  @Require('deals:edit')
  @Put(':id/items')
  items(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.deals.setItems(a, id(v), parse(S.dealItems, b).items);
  }

  @Require('deals:delete', 'tenant')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.deals.remove(a, id(v));
  }
}

// ---- Leads ---------------------------------------------------------------------------------

@Controller('v1')
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  @Require('leads:view')
  @Get('leads')
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.leads.list(a, parse(S.leadQuery, q));
  }

  @Require('leads:work')
  @Post('leads')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.leads.create(a, parse(S.leadBody, b));
  }

  @Require('leads:view')
  @Get('leads/:id')
  get(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.leads.get(a, id(v));
  }

  @Require('leads:work')
  @Patch('leads/:id')
  update(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.leads.update(a, id(v), parse(S.leadPatch, b));
  }

  @Require('deals:assign')
  @Post('leads/:id/assign')
  @HttpCode(200)
  assign(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.leads.assign(a, id(v), parse(S.leadAssign, b));
  }

  @Require('leads:work')
  @Post('leads/:id/qualify')
  @HttpCode(200)
  qualify(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.leads.qualify(a, id(v), parse(S.leadQualify, b));
  }

  @Require('leads:work')
  @Post('leads/:id/disqualify')
  @HttpCode(200)
  disqualify(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.leads.disqualify(a, id(v), parse(S.leadDisqualify, b).reason);
  }

  @Require('leads:work')
  @Post('leads/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.leads.reopen(a, id(v));
  }

  @Require('deals:assign', 'tenant')
  @Get('assignment-rules')
  rules(@CurrentActor() a: Actor) {
    return this.leads.rules(a);
  }

  @Require('deals:assign', 'tenant')
  @Post('assignment-rules')
  createRule(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.leads.saveRule(a, null, parse(S.ruleBody, b));
  }

  @Require('deals:assign', 'tenant')
  @Patch('assignment-rules/:id')
  updateRule(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.leads.saveRule(a, id(v), parse(S.rulePatch, b));
  }

  @Require('deals:assign', 'tenant')
  @Delete('assignment-rules/:id')
  @HttpCode(204)
  async deleteRule(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.leads.deleteRule(a, id(v));
  }
}

// ---- Atividades e notificações ----------------------------------------------------------------

@Controller('v1')
export class ActivitiesController {
  constructor(@Inject(ActivitiesService) private readonly activities: ActivitiesService) {}

  @Require('tasks:manage')
  @Get('activities')
  list(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.activities.list(a, parse(S.activityQuery, q));
  }

  @Require('tasks:manage')
  @Post('activities')
  create(@CurrentActor() a: Actor, @Body() b: unknown) {
    const { recurrence, ...input } = parse(S.activityBody, b);
    return this.activities.create(a, input, recurrence);
  }

  @Require('tasks:manage')
  @Get('activities/:id')
  get(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.activities.get(a, id(v));
  }

  @Require('tasks:manage')
  @Patch('activities/:id')
  update(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    const { scope, ...input } = parse(S.activityPatch, b);
    return this.activities.update(a, id(v), input, scope);
  }

  @Require('tasks:manage')
  @Post('activities/:id/status')
  @HttpCode(200)
  status(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    const body = parse(z.object({ status: z.enum(['open', 'done', 'canceled']), outcome: z.enum(['held', 'no_show', 'rescheduled']).optional() }), b);
    return this.activities.setStatus(a, id(v), body.status, body.outcome);
  }

  @Require('tasks:manage')
  @Delete('activities/:id')
  @HttpCode(204)
  async remove(@CurrentActor() a: Actor, @Param('id') v: string, @Query() q: unknown) {
    await this.activities.remove(a, id(v), parse(z.object({ scope: z.enum(['this', 'following']).default('this') }), q).scope);
  }

  @Get('notifications')
  notifications(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.activities.notifications(a, parse(z.object({ unread: z.enum(['true', 'false']).optional() }), q).unread === 'true');
  }

  @Post('notifications/read')
  @HttpCode(204)
  async read(@CurrentActor() a: Actor, @Body() b: unknown) {
    const f = parse(z.object({ ids: z.union([z.array(S.uuid).max(200), z.literal('all')]) }), b);
    await this.activities.markRead(a, f.ids);
  }
}

// ---- Notas, histórico e arquivos de um registro ----------------------------------------------------

@Controller('v1')
export class RecordsController {
  constructor(
    @Inject(RecordsService) private readonly records: RecordsService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private ref(kind: string, v: string) {
    return { kind: parse(S.recordKind, kind), id: id(v) };
  }

  @Get('records/:kind/:id/notes')
  notes(@CurrentActor() a: Actor, @Param('kind') k: string, @Param('id') v: string) {
    return this.records.notes(a, this.ref(k, v));
  }

  @Post('records/:kind/:id/notes')
  addNote(@CurrentActor() a: Actor, @Param('kind') k: string, @Param('id') v: string, @Body() b: unknown) {
    return this.records.addNote(a, this.ref(k, v), parse(S.noteBody, b).body);
  }

  @Patch('notes/:id')
  updateNote(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    return this.records.updateNote(a, id(v), parse(S.notePatch, b));
  }

  @Delete('notes/:id')
  @HttpCode(204)
  async deleteNote(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.records.deleteNote(a, id(v));
  }

  @Get('records/:kind/:id/timeline')
  timeline(@CurrentActor() a: Actor, @Param('kind') k: string, @Param('id') v: string, @Query() q: unknown) {
    return this.records.timeline(a, this.ref(k, v), parse(z.object({ before: z.string().datetime({ offset: true }).optional() }), q).before);
  }

  @Get('records/:kind/:id/files')
  listFiles(@CurrentActor() a: Actor, @Param('kind') k: string, @Param('id') v: string) {
    return this.files.list(a, this.ref(k, v));
  }

  @Post('records/:kind/:id/files')
  async upload(@CurrentActor() a: Actor, @Param('kind') k: string, @Param('id') v: string, @Req() req: FastifyRequest) {
    const ref = this.ref(k, v);
    const f = await readUpload(req, this.cfg.UPLOAD_MAX_MB);
    return this.files.upload(a, ref, f.name, f.data);
  }

  @Get('files/:id/url')
  url(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.files.signedUrl(a, id(v));
  }

  @Delete('files/:id')
  @HttpCode(204)
  async removeFile(@CurrentActor() a: Actor, @Param('id') v: string) {
    await this.files.remove(a, id(v));
  }

  /** Download pelo endereço assinado. Público: o endereço é a autorização, e vence em minutos. */
  @Public()
  @Get('files/download/:token')
  async download(@Param('token') token: string, @Req() req: FastifyRequest, @Res() res: FastifyReply) {
    // Pedido por partes (Range): o player de áudio e vídeo usa para saber a duração e avançar.
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? '').trim());
    const wanted = m && (m[1] || m[2]) ? { start: m[1] ? Number(m[1]) : null, end: m[2] ? Number(m[2]) : null } : null;
    const head = await this.files.openSigned(token, wanted ? { start: 0, end: 0 } : undefined);
    const size = head.size;
    let range: { start: number; end: number } | null = null;
    if (wanted) {
      head.stream.destroy();
      const start = wanted.start === null ? Math.max(0, size - (wanted.end ?? 0)) : wanted.start;
      const end = wanted.start === null ? size - 1 : Math.min(wanted.end ?? size - 1, size - 1);
      if (start >= size || start > end) {
        void res.status(416).header('content-range', `bytes */${size}`).send();
        return;
      }
      range = { start, end };
    }
    const f = range ? await this.files.openSigned(token, range) : head;
    const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    if (range) void res.status(206).header('content-range', `bytes ${range.start}-${range.end}/${size}`);
    void res
      .header('content-type', f.contentType)
      .header('content-length', String(range ? range.end - range.start + 1 : size))
      .header('accept-ranges', 'bytes')
      .header('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, no-store')
      .send(f.stream);
  }
}

// ---- Importação, privacidade e painel -----------------------------------------------------------

@Controller('v1')
export class ImportsController {
  constructor(
    @Inject(ImportExportService) private readonly io: ImportExportService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  @Require('contacts:import_export', 'tenant')
  @Post('imports/upload')
  async upload(@CurrentActor() a: Actor, @Query() q: unknown, @Req() req: FastifyRequest) {
    const { entity } = parse(z.object({ entity: z.enum(['contacts', 'organizations']).default('contacts') }), q);
    const f = await readUpload(req, this.cfg.UPLOAD_MAX_MB);
    return this.io.upload(a, entity, f.name, f.data);
  }

  @Require('contacts:import_export', 'tenant')
  @Post('imports')
  start(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.io.start(a, parse(S.importStart, b));
  }

  @Require('contacts:import_export', 'tenant')
  @Get('imports')
  list(@CurrentActor() a: Actor) {
    return this.io.list(a);
  }

  @Require('contacts:import_export', 'tenant')
  @Get('imports/:id')
  get(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.io.get(a, id(v));
  }

  @Require('contacts:import_export', 'tenant')
  @Get('imports/:id/errors')
  errors(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.io.errors(a, id(v));
  }

  @Require('contacts:import_export', 'tenant')
  @Post('imports/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.io.cancel(a, id(v));
  }
}

@Controller('v1')
export class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  @Require('privacy:execute', 'tenant')
  @Get('privacy/contacts/:id/export')
  export(@CurrentActor() a: Actor, @Param('id') v: string) {
    return this.privacy.exportSubject(a, id(v));
  }

  @Require('privacy:execute', 'tenant')
  @Post('privacy/contacts/:id/anonymize')
  @HttpCode(200)
  anonymize(@CurrentActor() a: Actor, @Param('id') v: string, @Body() b: unknown) {
    parse(z.object({ confirm: z.literal(true, { message: 'Confirme a anonimização.' }) }), b);
    return this.privacy.anonymize(a, id(v));
  }
}

@Controller('v1')
export class DashboardController {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(OperationService) private readonly operation: OperationService,
    @Inject(SalesService) private readonly sales: SalesService,
  ) {}

  /** Indicadores comerciais: contatos, calls, vendas na call e no follow-up. */
  @Require('reports:view')
  @Get('dashboard/sales')
  salesSummary(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({
      from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
      ownerId: z.preprocess((v) => (v === '' ? undefined : v), S.uuid.optional()),
      teamId: z.preprocess((v) => (v === '' ? undefined : v), S.uuid.optional()),
    }).refine((v) => Date.parse(v.to) > Date.parse(v.from) && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000,
      { message: 'Período de até um ano.', path: ['to'] }), q);
    return this.sales.summary(a, f);
  }

  @Require('reports:view')
  @Get('dashboard/operation')
  operationSummary(@CurrentActor() a: Actor, @Query() q: unknown) {
    const f = parse(z.object({
      from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
      channel: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['whatsapp', 'email']).optional()),
      assigneeId: z.preprocess((v) => (v === '' ? undefined : v), S.uuid.optional()),
      teamId: z.preprocess((v) => (v === '' ? undefined : v), S.uuid.optional()),
    }).refine((v) => Date.parse(v.to) > Date.parse(v.from) && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000,
      { message: 'Período de até um ano.', path: ['to'] }), q);
    return this.operation.summary(a, f);
  }

  @Get('dashboard')
  summary(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.dashboard.summary(a, parse(S.dashboardQuery, q));
  }
}
