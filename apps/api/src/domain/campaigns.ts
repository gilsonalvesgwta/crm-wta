// Campanhas: formato do público e do conteúdo, validado aqui e guardado no banco.
import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Escolha um item da lista.' });
const ids = z.array(uuid).max(500).default([]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use AAAA-MM-DD.' }).nullable().optional();

export const audience = z.object({
  tagIds: ids,
  excludeTagIds: ids,
  ownerIds: ids,
  teamIds: ids,
  pipelineId: uuid.nullable().optional(),
  stageId: uuid.nullable().optional(),
  sources: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  contactIds: z.array(uuid).max(5000).default([]),
  createdFrom: day,
  createdTo: day,
  consentOnly: z.boolean().default(false),
}).default({ tagIds: [], excludeTagIds: [], ownerIds: [], teamIds: [], sources: [], contactIds: [], consentOnly: false });
export type Audience = z.infer<typeof audience>;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use HH:MM.' });

export const campaignBody = z.object({
  name: z.string().trim().min(1, { message: 'Informe o nome da campanha.' }).max(120),
  description: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  channel: z.enum(['whatsapp', 'email'], { message: 'Escolha WhatsApp ou e-mail.' }),
  audience,
  accountId: uuid.nullable().optional(),
  subject: z.string().trim().max(998).nullable().optional().transform((v) => v || null),
  body: z.string().max(20000, { message: 'Texto longo demais.' }).nullable().optional().transform((v) => (v && v.trim() ? v : null)),
  perMinute: z.number().int().min(1, { message: 'Mínimo 1 por minuto.' }).max(120, { message: 'Máximo 120 por minuto.' }).default(10),
  windowStart: time.nullable().optional(),
  windowEnd: time.nullable().optional(),
  optOutHint: z.boolean().default(true),
  /** WhatsApp oficial: modelo aprovado e o valor de cada variável (aceita {{primeiro_nome}} etc.). */
  templateId: uuid.nullable().optional(),
  templateParams: z.array(z.string().trim().max(1000)).max(20).default([]),
}).refine((v) => !!v.windowStart === !!v.windowEnd, { message: 'Informe o início e o fim da janela.', path: ['windowEnd'] });
export type CampaignInput = z.infer<typeof campaignBody>;

export const startBody = z.object({
  /** Vazio: começa agora. */
  scheduledAt: z.string().datetime({ offset: true, message: 'Data e hora inválidas.' }).nullable().optional(),
});

export const OPT_OUT_HINT = '\n\nPara não receber mais mensagens, responda SAIR.';
