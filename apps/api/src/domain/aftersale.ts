// Pós-venda: configuração dos lembretes e textos padrão.
import { z } from 'zod';

const uuid = z.string().uuid();

export const ALERT_DEFAULT = '🤝 Pós-venda: há {{dias}} dias {{cliente}} fechou "{{negocio}}" ({{valor}}).\n'
  + '📞 {{telefone}}\nResponsável: {{responsavel}}\nEntre em contato com a mensagem de pós-venda: {{link}}';
export const CUSTOMER_DEFAULT = 'Olá {{primeiro_nome}}! Aqui é {{responsavel}}, da {{empresa}}. '
  + 'Já faz {{dias}} dias que você fechou com a gente e quero saber como está sendo a sua experiência. Posso ajudar em alguma coisa?';

/** Variáveis do aviso para a equipe. */
export const ALERT_VARIABLES = ['cliente', 'telefone', 'dias', 'negocio', 'valor', 'data_fechamento', 'responsavel', 'funil', 'vez', 'link'] as const;
/** Variáveis da mensagem para o cliente. */
export const CUSTOMER_VARIABLES = ['nome', 'primeiro_nome', 'negocio', 'dias', 'responsavel', 'empresa'] as const;

export const aftersaleBody = z.object({
  enabled: z.boolean(),
  firstDays: z.number().int().min(1, { message: 'Mínimo 1 dia.' }).max(3650),
  repeatDays: z.number().int().min(1, { message: 'Mínimo 1 dia.' }).max(3650).nullable(),
  maxTimes: z.number().int().min(1).max(50, { message: 'No máximo 50 lembretes.' }),
  sendAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use HH:MM.' }),
  pipelineIds: z.array(uuid).max(50).default([]),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use uma data válida.' }).nullable(),
  notifyOwner: z.boolean(),
  memberIds: z.array(uuid).max(50).default([]),
  extraPhones: z.array(z.string().trim().min(8).max(30)).max(10, { message: 'No máximo 10 números.' }).default([]),
  whatsapp: z.boolean(),
  accountId: uuid.nullable(),
  inApp: z.boolean(),
  alertText: z.string().trim().min(1, { message: 'Escreva o aviso para a equipe.' }).max(2000),
  customerText: z.string().trim().min(1, { message: 'Escreva a mensagem para o cliente.' }).max(4000),
});
export type AftersaleInput = z.infer<typeof aftersaleBody>;

export const aftersaleQuery = z.object({
  tab: z.enum(['due', 'upcoming', 'done']).default('due'),
  q: z.string().trim().max(120).optional().transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
