// Automações: formato das regras (gatilho, filtros e ações) e os textos com
// variáveis. Validado aqui e guardado em JSON no banco.
import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Escolha um item da lista.' });

export const EVENT_TRIGGERS = ['contact.created', 'lead.created', 'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost', 'message.received'] as const;

export const trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('contact.created') }),
  z.object({ type: z.literal('lead.created') }),
  z.object({ type: z.literal('deal.created') }),
  z.object({ type: z.literal('deal.stage_changed'), stageId: uuid.nullable().optional() }),
  z.object({ type: z.literal('deal.won') }),
  z.object({ type: z.literal('deal.lost') }),
  z.object({ type: z.literal('message.received') }),
  z.object({ type: z.literal('birthday'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use HH:MM.' }).default('09:00') }),
  z.object({ type: z.literal('deal.inactive'), days: z.number().int().min(1, { message: 'Mínimo 1 dia.' }).max(365) }),
]);
export type Trigger = z.infer<typeof trigger>;

export const filters = z.object({
  pipelineId: uuid.nullable().optional(),
  stageId: uuid.nullable().optional(),
  tagId: uuid.nullable().optional(),
  source: z.string().trim().max(200).nullable().optional(),
}).default({});
export type Filters = z.infer<typeof filters>;

const text = (max: number, what: string) => z.string().trim().min(1, { message: `Escreva ${what}.` }).max(max);

export const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_whatsapp'), accountId: uuid, text: text(4000, 'a mensagem') }),
  z.object({ type: z.literal('send_email'), accountId: uuid, subject: text(300, 'o assunto'), text: text(20000, 'o texto') }),
  z.object({
    type: z.literal('create_task'), title: text(200, 'o título da tarefa'), dueInDays: z.number().int().min(0).max(365).default(0),
    activityType: z.enum(['task', 'call', 'meeting', 'email', 'visit', 'other']).default('task'),
  }),
  z.object({ type: z.literal('add_tag'), tagId: uuid }),
  z.object({ type: z.literal('move_stage'), stageId: uuid }),
  z.object({ type: z.literal('webhook'), url: z.string().trim().url({ message: 'Informe o endereço completo (https://...).' }).max(2000) }),
  z.object({ type: z.literal('wait'), minutes: z.number().int().min(1).max(525_600) }),
]);
export type Action = z.infer<typeof action>;

export const ruleBody = z.object({
  name: text(120, 'o nome da automação'),
  active: z.boolean().default(true),
  trigger,
  filters,
  actions: z.array(action).min(1, { message: 'Inclua ao menos uma ação.' }).max(20),
});
export type RuleInput = z.infer<typeof ruleBody>;

/** Gatilhos que não têm negócio: ações de negócio não fazem sentido neles. */
export function dealActionsAllowed(t: Trigger): boolean {
  return t.type.startsWith('deal.');
}

export const VARIABLES: { key: string; label: string }[] = [
  { key: 'nome', label: 'Nome completo do contato' },
  { key: 'primeiro_nome', label: 'Primeiro nome do contato' },
  { key: 'empresa', label: 'Nome da sua empresa' },
  { key: 'negocio', label: 'Título do negócio' },
  { key: 'etapa', label: 'Etapa do negócio' },
  { key: 'valor', label: 'Valor do negócio' },
  { key: 'responsavel', label: 'Responsável pelo contato ou negócio' },
];

/** Troca {{variavel}} pelo valor; variável desconhecida ou vazia some. */
export function render(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '').replace(/[ \t]+\n/g, '\n');
}
