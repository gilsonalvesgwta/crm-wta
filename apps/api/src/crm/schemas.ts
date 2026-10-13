import { z } from 'zod';
import { CUSTOM_FIELD_TYPES } from '../domain/custom-fields.js';

export const uuid = z.string().uuid({ message: 'Identificador inválido.' });
export const text = (max: number, what: string) =>
  z.string().trim().min(1, { message: `Informe ${what}.` }).max(max, { message: `Use até ${max} caracteres.` });
export const optText = (max: number) =>
  z.string().trim().max(max, { message: `Use até ${max} caracteres.` }).nullable().optional().transform((v) => (v === '' ? null : v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use AAAA-MM-DD.' });
const isoDateTime = z.string().datetime({ offset: true, message: 'Data e hora inválidas.' });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'Use #RRGGBB.' }).transform((v) => v.toUpperCase());
const cents = z.number().int({ message: 'Valor em centavos.' }).min(0).max(9_000_000_000_000);
const custom = z.record(z.string(), z.unknown()).optional();
const ownerId = uuid.nullable().optional();
const page = z.coerce.number().int().min(1).max(100_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);
const address = z.record(z.string().max(40), z.string().max(200)).optional();

export const touch = z.object({
  source: optText(200), medium: optText(200), campaign: optText(200), term: optText(200), content: optText(200),
  clickIds: z.record(z.string().regex(/^[a-z_]{2,20}$/), z.string().max(500)).optional(),
  referrer: optText(2000), landingPage: optText(2000),
});

export const contactBody = z.object({
  firstName: text(120, 'o nome'),
  lastName: optText(120),
  jobTitle: optText(120),
  organizationId: uuid.nullable().optional(),
  taxId: z.string().trim().regex(/^[0-9A-Za-z./-]{1,30}$/, { message: 'Documento inválido.' }).nullable().optional().or(z.literal('').transform(() => null)),
  birthday: z.object({
    day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12), year: z.number().int().min(1900).max(2100).nullable().optional(),
  }).nullable().optional(),
  address,
  ownerId,
  teamId: uuid.nullable().optional(),
  emails: z.array(z.object({ email: z.string().max(254), label: z.enum(['work', 'personal', 'other']).optional(), isPrimary: z.boolean().optional() })).max(10).optional(),
  phones: z.array(z.object({ number: z.string().max(40), label: z.enum(['mobile', 'whatsapp', 'work', 'home', 'other']).optional(), isPrimary: z.boolean().optional() })).max(10).optional(),
  tagIds: z.array(uuid).max(50).optional(),
  custom,
});
export const contactCreate = contactBody.extend({ allowDuplicate: z.boolean().default(false), touch: touch.optional() });
export const contactPatch = contactBody.partial();

export const contactQuery = z.object({
  q: z.string().trim().max(200).optional(),
  ownerId: z.union([uuid, z.literal('none')]).optional(),
  teamId: uuid.optional(),
  organizationId: uuid.optional(),
  tagId: uuid.optional(),
  createdFrom: isoDateTime.optional(),
  createdTo: isoDateTime.optional(),
  birthdayMonth: z.coerce.number().int().min(1).max(12).optional(),
  sort: z.enum(['name', 'created', 'updated', 'activity']).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page, pageSize,
});

export const consentBody = z.object({
  channel: z.enum(['email', 'whatsapp', 'sms', 'phone', 'instagram']),
  purpose: z.enum(['marketing', 'service']).default('marketing'),
  status: z.enum(['granted', 'revoked']),
  source: text(200, 'a origem do consentimento'),
  evidence: optText(2000),
});

export const orgBody = z.object({
  name: text(200, 'o nome'),
  legalName: optText(200),
  taxId: z.string().trim().regex(/^[0-9A-Za-z./-]{1,30}$/, { message: 'Documento inválido.' }).nullable().optional().or(z.literal('').transform(() => null)),
  website: optText(500),
  email: optText(254),
  phone: optText(40),
  industry: optText(120),
  address,
  ownerId,
  teamId: uuid.nullable().optional(),
  tagIds: z.array(uuid).max(50).optional(),
  custom,
});
export const orgQuery = z.object({
  q: z.string().trim().max(200).optional(),
  ownerId: z.union([uuid, z.literal('none')]).optional(),
  tagId: uuid.optional(),
  sort: z.enum(['name', 'created', 'activity']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page, pageSize,
});

export const tagBody = z.object({ name: text(60, 'o nome da etiqueta'), color: color.optional() });
export const fieldBody = z.object({
  entity: z.enum(['contact', 'organization', 'deal', 'lead']),
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, { message: 'Use letras minúsculas, números e _.' }),
  label: text(80, 'o rótulo'),
  type: z.enum(CUSTOM_FIELD_TYPES as [string, ...string[]]).transform((v) => v as (typeof CUSTOM_FIELD_TYPES)[number]),
  options: z.array(z.object({ value: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(80) })).max(100).optional(),
  required: z.boolean().optional(),
});
export const fieldPatch = z.object({
  label: text(80, 'o rótulo').optional(),
  options: fieldBody.shape.options,
  required: z.boolean().optional(),
  archived: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
export const productBody = z.object({
  name: text(160, 'o nome'),
  sku: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,60}$/, { message: 'Código inválido.' }).nullable().optional().or(z.literal('').transform(() => null)),
  description: optText(2000),
  priceCents: cents.default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default('BRL'),
  active: z.boolean().optional(),
});
export const reasonBody = z.object({ kind: z.enum(['won', 'lost']), name: text(120, 'o motivo'), position: z.number().int().min(0).optional() });
export const reasonPatch = z.object({ name: text(120, 'o motivo').optional(), active: z.boolean().optional(), position: z.number().int().min(0).optional() });

const requiredField = z.string().regex(/^(value|expected_close_date|contact|organization|products|custom\.[a-z][a-z0-9_]{0,39})$/, { message: 'Campo inválido.' });
export const stageBody = z.object({
  id: uuid.optional(),
  name: text(80, 'o nome da etapa'),
  color: color.optional(),
  probability: z.number().int().min(0).max(100).optional(),
  kind: z.enum(['open', 'won', 'lost']),
  requiredFields: z.array(requiredField).max(20).optional(),
  rottingDays: z.number().int().min(1).max(365).nullable().optional(),
});
export const pipelineBody = z.object({
  name: text(80, 'o nome do funil'),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  stages: z.array(stageBody).min(3).max(30).optional(),
});
export const pipelinePatch = z.object({
  name: text(80, 'o nome do funil').optional(),
  position: z.number().int().min(0).optional(),
  restricted: z.boolean().optional(),
  archived: z.boolean().optional(),
  access: z.object({ teamIds: z.array(uuid).max(200), membershipIds: z.array(uuid).max(500) }).optional(),
});
export const stagesBody = z.object({ stages: z.array(stageBody).min(3).max(30) });
export const transitionsBody = z.object({ rules: z.array(z.object({ fromStageId: uuid, toStageId: uuid })).max(900) });

export const dealBody = z.object({
  pipelineId: uuid,
  stageId: uuid.optional(),
  title: text(200, 'o título'),
  valueCents: cents.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  contactId: uuid.nullable().optional(),
  organizationId: uuid.nullable().optional(),
  ownerId,
  teamId: uuid.nullable().optional(),
  expectedCloseDate: isoDate.nullable().optional(),
  tagIds: z.array(uuid).max(50).optional(),
  participantIds: z.array(uuid).max(50).optional(),
  custom,
});
export const dealPatch = dealBody.omit({ pipelineId: true, stageId: true }).partial();
export const dealMove = z.object({ stageId: uuid, pipelineId: uuid.optional(), reasonId: uuid.nullable().optional(), note: optText(1000) });
export const dealItems = z.object({
  items: z.array(z.object({
    productId: uuid.nullable().optional(), name: z.string().trim().min(1).max(160).optional(),
    quantity: z.number().positive().max(1_000_000), unitPriceCents: cents.optional(), discountCents: cents.optional(),
  })).max(100),
});
export const dealQuery = z.object({
  pipelineId: uuid.optional(), stageId: uuid.optional(), status: z.enum(['open', 'won', 'lost', 'all']).default('open'),
  ownerId: z.union([uuid, z.literal('none')]).optional(), tagId: uuid.optional(), q: z.string().trim().max(200).optional(),
  contactId: uuid.optional(), organizationId: uuid.optional(), closeFrom: isoDate.optional(), closeTo: isoDate.optional(),
  sort: z.enum(['created', 'value', 'close', 'activity', 'title']).default('created'), dir: z.enum(['asc', 'desc']).default('desc'),
  page, pageSize,
});
export const boardQuery = z.object({
  pipelineId: uuid, ownerId: z.union([uuid, z.literal('none')]).optional(), tagId: uuid.optional(), q: z.string().trim().max(200).optional(),
  status: z.enum(['open', 'all']).default('open'),
});

export const leadBody = z.object({
  title: text(200, 'o título'),
  contactId: uuid.optional(),
  contact: z.object({
    firstName: text(120, 'o nome'), lastName: optText(120), email: optText(254), phone: optText(40), organizationId: uuid.nullable().optional(),
  }).optional(),
  source: optText(120),
  ownerId: uuid.nullable().optional(),
  teamId: uuid.nullable().optional(),
  custom,
  touch: touch.optional(),
});
export const leadPatch = z.object({ title: text(200, 'o título').optional(), source: optText(120), status: z.enum(['new', 'working']).optional(), custom });
export const leadAssign = z.object({ ownerId: uuid.nullable(), teamId: uuid.nullable().optional() });
export const leadQualify = z.object({ pipelineId: uuid, stageId: uuid.optional(), title: text(200, 'o título').optional(), valueCents: cents.optional(), organizationId: uuid.nullable().optional() });
export const leadDisqualify = z.object({ reason: text(500, 'o motivo') });
export const leadQuery = z.object({
  status: z.enum(['new', 'working', 'qualified', 'disqualified', 'active', 'all']).default('active'),
  ownerId: z.union([uuid, z.literal('none')]).optional(), teamId: uuid.optional(), source: z.string().max(120).optional(),
  q: z.string().trim().max(200).optional(), page, pageSize,
});
export const ruleBody = z.object({
  name: text(120, 'o nome'), active: z.boolean().optional(), position: z.number().int().min(0).optional(),
  sourceFilter: optText(120), teamId: uuid.nullable().optional(), memberIds: z.array(uuid).min(1, { message: 'Inclua ao menos uma pessoa.' }).max(200),
});
export const rulePatch = ruleBody.partial();

const recurrence = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(99).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: isoDate.nullable().optional(),
  count: z.number().int().min(1).max(500).nullable().optional(),
});
export const activityBody = z.object({
  type: z.enum(['task', 'call', 'meeting', 'email', 'visit', 'other']).default('task'),
  title: text(200, 'o título'),
  description: optText(10000),
  startsAt: isoDateTime.nullable().optional(),
  endsAt: isoDateTime.nullable().optional(),
  allDay: z.boolean().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  ownerId: uuid.optional(),
  teamId: uuid.nullable().optional(),
  contactId: uuid.nullable().optional(),
  organizationId: uuid.nullable().optional(),
  dealId: uuid.nullable().optional(),
  leadId: uuid.nullable().optional(),
  reminderMinutes: z.number().int().min(0).max(40320).nullable().optional(),
  recurrence: recurrence.optional(),
});
export const activityPatch = activityBody.omit({ recurrence: true, type: true }).partial()
  .extend({ type: activityBody.shape.type.optional(), scope: z.enum(['this', 'following']).default('this') });
export const activityQuery = z.object({
  from: isoDateTime.optional(), to: isoDateTime.optional(), ownerId: uuid.optional(), teamId: uuid.optional(),
  status: z.enum(['open', 'done', 'all']).default('open'), type: z.enum(['task', 'call', 'meeting', 'email', 'visit', 'other']).optional(),
  contactId: uuid.optional(), dealId: uuid.optional(), leadId: uuid.optional(), organizationId: uuid.optional(),
  due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const recordKind = z.enum(['contact', 'organization', 'deal', 'lead']);
export const noteBody = z.object({ body: text(20000, 'o texto') });
export const notePatch = z.object({ body: text(20000, 'o texto').optional(), pinned: z.boolean().optional() });

export const importStart = z.object({
  fileId: uuid,
  entity: z.enum(['contacts', 'organizations']),
  mapping: z.record(z.string().max(200), z.string().max(60)),
  options: z.object({
    duplicate: z.enum(['skip', 'update', 'create']).default('skip'),
    ownerId: uuid.nullable().optional(),
    tagIds: z.array(uuid).max(20).optional(),
    consentSource: optText(200),
  }).default({ duplicate: 'skip', consentSource: null }),
});

export const dashboardQuery = z.object({
  from: isoDateTime, to: isoDateTime, pipelineId: uuid.optional(), ownerId: uuid.optional(),
});

export const viewBody = z.object({
  entity: z.enum(['contacts', 'organizations', 'deals', 'leads', 'activities']),
  name: text(80, 'o nome'),
  filters: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])),
  shared: z.boolean().default(false),
});
