import { z } from 'zod';

/**
 * Fluxos do Instagram e do WhatsApp oficial (estilo Manychat): o desenho
 * guardado é um grafo com um bloco "gatilho" e os passos, ligados por setas.
 * Tudo aqui é puro (sem banco nem rede) para ser testado sozinho.
 */

export const IG_TRIGGERS = ['comment', 'live_comment', 'dm_keyword', 'story_reply', 'story_mention', 'reaction'] as const;
/** WhatsApp oficial: transmissão (campanha que manda um modelo) e palavra-chave na mensagem. */
export const WA_TRIGGERS = ['wa_broadcast', 'wa_keyword'] as const;
export const TRIGGERS = [...IG_TRIGGERS, ...WA_TRIGGERS] as const;
export type TriggerType = (typeof TRIGGERS)[number];
export type FlowChannel = 'instagram' | 'whatsapp';

/** Canal de um gatilho. */
export function channelOfTrigger(t: TriggerType): FlowChannel {
  return (WA_TRIGGERS as readonly string[]).includes(t) ? 'whatsapp' : 'instagram';
}

export const TRIGGER_NAME: Record<TriggerType, string> = {
  comment: 'Comentário em post ou reels',
  live_comment: 'Comentário em live',
  dm_keyword: 'Palavra no direct',
  story_reply: 'Resposta a story',
  story_mention: 'Menção em story',
  reaction: 'Reação a mensagem',
  wa_broadcast: 'Quando você envia uma transmissão',
  wa_keyword: 'Palavra na mensagem do WhatsApp',
};

/** Gatilhos que vêm de um comentário: a conversa privada só abre pela resposta no privado. */
export const COMMENT_TRIGGERS: readonly TriggerType[] = ['comment', 'live_comment'];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const text = (max: number) => z.string().max(max, { message: `Até ${max} caracteres.` });

const button = z.object({
  id,
  title: text(20).default(''),
  // Com endereço, abre o link; sem, o fluxo continua pela seta do botão.
  url: z.string().max(2000).nullable().optional(),
});
export type FlowButton = z.infer<typeof button>;

const triggerData = z.object({
  type: z.enum(TRIGGERS),
  // Comentários: em qualquer publicação ou só nas escolhidas (até 20).
  posts: z.enum(['any', 'chosen']).default('any'),
  postIds: z.array(z.string().regex(/^[0-9_]{1,40}$/)).max(20).default([]),
  // any: qualquer texto; contains: tem uma das palavras; exact: é exatamente uma delas.
  match: z.enum(['any', 'contains', 'exact']).default('contains'),
  keywords: z.array(text(60)).max(30).default([]),
  // every: sempre; once_per_contact: uma vez por pessoa; once_per_post: uma vez por pessoa em cada publicação.
  frequency: z.enum(['every', 'once_per_contact', 'once_per_post']).default('once_per_post'),
});
export type TriggerData = z.infer<typeof triggerData>;

const rule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('has_tag'), tagId: z.string().default('') }),
  z.object({ kind: z.literal('not_tag'), tagId: z.string().default('') }),
  z.object({ kind: z.literal('follows') }),
  z.object({ kind: z.literal('not_follows') }),
  z.object({ kind: z.literal('var_equals'), key: text(40).default(''), value: text(200).default('') }),
  z.object({ kind: z.literal('var_set'), key: text(40).default('') }),
]);
export type FlowRule = z.infer<typeof rule>;

const op = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add_tag'), tagId: z.string().default('') }),
  z.object({ kind: z.literal('remove_tag'), tagId: z.string().default('') }),
  z.object({ kind: z.literal('set_field'), key: text(40).default(''), value: text(500).default('') }),
  z.object({ kind: z.literal('create_lead'), title: text(200).default('') }),
  z.object({ kind: z.literal('create_deal'), pipelineId: z.string().default(''), title: text(200).default('') }),
  z.object({ kind: z.literal('notify'), membershipId: z.string().nullable().default(null), text: text(300).default('') }),
  z.object({ kind: z.literal('assign'), membershipId: z.string().default('') }),
]);
export type FlowOp = z.infer<typeof op>;

const position = z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 });

const nodeSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('trigger'), position, data: triggerData }),
  z.object({ id, type: z.literal('comment_reply'), position, data: z.object({ variants: z.array(text(300)).max(3).default(['']) }) }),
  z.object({ id, type: z.literal('private_reply'), position, data: z.object({ text: text(640).default(''), buttons: z.array(button).max(3).default([]) }) }),
  z.object({ id, type: z.literal('text'), position, data: z.object({ text: text(1000).default(''), buttons: z.array(button).max(3).default([]) }) }),
  // WhatsApp oficial: modelo aprovado pela Meta (chega mesmo fora das 24 h). Os botões são as respostas rápidas do modelo ("q" + posição).
  z.object({
    id, type: z.literal('template'), position,
    data: z.object({
      templateId: z.string().uuid().nullable().default(null),
      name: text(512).nullable().default(null),
      params: z.array(text(1000)).max(20).default([]),
      buttons: z.array(button).max(10).default([]),
    }),
  }),
  z.object({
    id, type: z.literal('media'), position,
    data: z.object({ fileId: z.string().nullable().default(null), name: text(255).nullable().default(null), kind: z.enum(['image', 'video', 'audio', 'file']).nullable().default(null) }),
  }),
  z.object({
    id, type: z.literal('wait'), position,
    data: z.object({ amount: z.number().int().min(1).max(10_000).default(5), unit: z.enum(['minutes', 'hours', 'days']).default('minutes') }),
  }),
  z.object({
    id, type: z.literal('question'), position,
    data: z.object({
      text: text(1000).default(''),
      // Onde guardar a resposta: variável do fluxo, campo do contato, e-mail ou telefone do contato.
      saveTo: z.enum(['var', 'field', 'email', 'phone']).default('var'),
      key: text(40).default('resposta'),
      validate: z.enum(['text', 'email', 'phone', 'number']).default('text'),
      retryText: text(300).default('Não entendi. Pode mandar de novo?'),
      timeoutHours: z.number().int().min(1).max(168).nullable().default(null),
    }),
  }),
  z.object({ id, type: z.literal('condition'), position, data: z.object({ match: z.enum(['all', 'any']).default('all'), rules: z.array(rule).max(10).default([]) }) }),
  z.object({ id, type: z.literal('action'), position, data: z.object({ ops: z.array(op).max(10).default([]) }) }),
]);
export type FlowNode = z.infer<typeof nodeSchema>;
export type NodeType = FlowNode['type'];

const edgeSchema = z.object({
  id: z.string().max(140),
  source: id,
  // next; btn:<id>; yes; no; timeout
  sourceHandle: z.string().regex(/^(next|yes|no|timeout|btn:[A-Za-z0-9_-]{1,64})$/).default('next'),
  target: id,
});
export type FlowEdge = z.infer<typeof edgeSchema>;

export const graphSchema = z.object({
  nodes: z.array(nodeSchema).min(1).max(200),
  edges: z.array(edgeSchema).max(400).default([]),
}).superRefine((g, ctx) => {
  const triggers = g.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'O fluxo precisa de exatamente um gatilho.' });
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) ctx.addIssue({ code: 'custom', path: ['nodes'], message: `Bloco repetido: ${n.id}.` });
    ids.add(n.id);
  }
  for (const e of g.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) ctx.addIssue({ code: 'custom', path: ['edges'], message: 'Seta ligada a um bloco que não existe.' });
  }
});
export type FlowGraph = z.infer<typeof graphSchema>;

export function triggerOf(g: FlowGraph): TriggerData {
  return (g.nodes.find((n) => n.type === 'trigger') as Extract<FlowNode, { type: 'trigger' }>).data;
}

// ---- Avisos -------------------------------------------------------------------------

/** Problema num bloco: "error" impede publicar; "warning" só avisa. */
export type FlowIssue = { nodeId: string | null; level: 'error' | 'warning'; message: string };

const DM_NODES: readonly NodeType[] = ['text', 'media', 'question'];
/** Botão de resposta rápida de um modelo: "q" + posição do botão no modelo. */
export const TEMPLATE_BUTTON_RE = /^q([0-9])$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;

/** O que falta ou pode dar errado no desenho, por bloco. */
export function flowIssues(g: FlowGraph): FlowIssue[] {
  const out: FlowIssue[] = [];
  const t = triggerOf(g);
  const trig = g.nodes.find((n) => n.type === 'trigger')!;
  const wa = channelOfTrigger(t.type) === 'whatsapp';
  const fromComment = COMMENT_TRIGGERS.includes(t.type);
  const add = (nodeId: string | null, level: FlowIssue['level'], message: string) => out.push({ nodeId, level, message });

  // Gatilho
  if (['comment', 'live_comment', 'dm_keyword', 'story_reply', 'wa_keyword'].includes(t.type) && t.match !== 'any' && !t.keywords.some((k) => k.trim())) {
    add(trig.id, 'warning', 'Adicione pelo menos uma palavra-chave, ou escolha "qualquer".');
  }
  if (t.type === 'comment' && t.posts === 'chosen' && !t.postIds.length) add(trig.id, 'error', 'Escolha ao menos uma publicação, ou "qualquer post ou reels".');
  if (!g.edges.some((e) => e.source === trig.id)) add(trig.id, 'warning', 'Ligue o gatilho ao primeiro passo.');
  if (t.type === 'wa_broadcast') {
    const first = nextNode(g, trig.id, 'next');
    if (first && first.type !== 'template') {
      add(first.id, 'error', 'A transmissão começa com um modelo aprovado: fora das 24 h, o WhatsApp só entrega modelo.');
    }
  }

  const reach = reachable(g);
  // Blocos que podem rodar sem a conversa estar aberta (antes de qualquer clique ou resposta da pessoa).
  const closed = fromComment || t.type === 'wa_broadcast' ? closedWindowNodes(g) : new Set<string>();

  for (const n of g.nodes) {
    if (n.type === 'trigger') continue;
    if (!reach.has(n.id)) add(n.id, 'warning', 'Este bloco não está ligado ao fluxo e não vai rodar.');
    switch (n.type) {
      case 'template':
        if (!wa) { add(n.id, 'error', 'Modelo aprovado só existe no WhatsApp oficial.'); break; }
        if (!n.data.templateId) add(n.id, 'error', 'Escolha o modelo aprovado.');
        if (n.data.params.some((p) => !p.trim())) add(n.id, 'warning', 'Preencha todas as variáveis do modelo.');
        if (n.data.buttons.some((b) => !TEMPLATE_BUTTON_RE.test(b.id))) add(n.id, 'error', 'Escolha o modelo de novo: os botões não conferem.');
        if (n.data.buttons.length && !g.edges.some((e) => e.source === n.id && e.sourceHandle.startsWith('btn:'))) {
          add(n.id, 'warning', 'Ligue os botões do modelo aos próximos passos: o clique é o que continua a conversa.');
        }
        break;
      case 'comment_reply':
        if (wa) { add(n.id, 'error', 'Responder no comentário só existe no Instagram.'); break; }
        if (!fromComment) add(n.id, 'error', 'Responder no comentário só funciona com gatilho de comentário.');
        if (!n.data.variants.some((v) => v.trim())) add(n.id, 'warning', 'Escreva a resposta do comentário.');
        break;
      case 'private_reply':
        if (wa) { add(n.id, 'error', 'Responder no privado só existe no Instagram. Use "Texto".'); break; }
        if (!fromComment) add(n.id, 'error', 'Responder no privado só funciona com gatilho de comentário. Use "Texto".');
        if (!n.data.text.trim()) add(n.id, 'warning', 'Escreva a mensagem.');
        checkButtons(n.id, n.data.buttons, add);
        if (n.data.buttons.some((b) => !b.url) && !g.edges.some((e) => e.source === n.id && e.sourceHandle.startsWith('btn:'))) {
          add(n.id, 'warning', 'Ligue o botão ao próximo passo: sem o clique, a conversa para aqui.');
        }
        break;
      case 'text':
        if (!n.data.text.trim()) add(n.id, 'warning', 'Escreva a mensagem.');
        checkButtons(n.id, n.data.buttons, add);
        if (wa && n.data.buttons.some((b) => b.url)) add(n.id, 'warning', 'No WhatsApp, o botão de link vai como link no fim do texto.');
        break;
      case 'media':
        if (!n.data.fileId) add(n.id, 'warning', 'Escolha o arquivo na biblioteca de mídia.');
        break;
      case 'wait': {
        const minutes = n.data.amount * (n.data.unit === 'days' ? 1440 : n.data.unit === 'hours' ? 60 : 1);
        if (minutes > 23 * 60) {
          add(n.id, 'warning', wa
            ? 'O WhatsApp só deixa mandar mensagem livre até 24 h depois da última mensagem da pessoa: depois disso, use um bloco "Modelo aprovado".'
            : 'O Instagram só deixa mandar mensagem até 24 h depois da última mensagem da pessoa: depois disso, o próximo passo pode não chegar.');
        }
        break;
      }
      case 'question':
        if (!n.data.text.trim()) add(n.id, 'warning', 'Escreva a pergunta.');
        if ((n.data.saveTo === 'var' || n.data.saveTo === 'field') && !/^[a-z0-9_]{1,40}$/.test(n.data.key)) {
          add(n.id, 'warning', 'Dê um nome à resposta (letras minúsculas, números e _).');
        }
        break;
      case 'condition':
        if (!n.data.rules.length) add(n.id, 'warning', 'Adicione pelo menos uma regra.');
        if (n.data.rules.some((r) => ('tagId' in r && !r.tagId) || ('key' in r && !r.key))) add(n.id, 'warning', 'Complete as regras.');
        if (wa && n.data.rules.some((r) => r.kind === 'follows' || r.kind === 'not_follows')) add(n.id, 'error', '"Segue a conta" só existe no Instagram.');
        break;
      case 'action':
        if (!n.data.ops.length) add(n.id, 'warning', 'Adicione pelo menos uma ação.');
        if (n.data.ops.some((o) => ('tagId' in o && !o.tagId) || (o.kind === 'set_field' && !o.key) || (o.kind === 'create_deal' && !o.pipelineId) || (o.kind === 'assign' && !o.membershipId))) {
          add(n.id, 'warning', 'Complete as ações.');
        }
        break;
    }
    if (fromComment && DM_NODES.includes(n.type) && closed.has(n.id)) {
      add(n.id, 'warning', 'A conversa ainda não está aberta aqui: no comentário, o direct só abre pela "Resposta no privado" e o clique no botão.');
    }
    if (t.type === 'wa_broadcast' && DM_NODES.includes(n.type) && closed.has(n.id)) {
      add(n.id, 'warning', 'A pessoa ainda não respondeu aqui: fora das 24 h, só o modelo aprovado chega. Ligue este passo depois de um botão do modelo.');
    }
  }
  return out;
}

function checkButtons(nodeId: string, buttons: FlowButton[], add: (n: string, l: FlowIssue['level'], m: string) => void) {
  if (buttons.some((b) => !b.title.trim())) add(nodeId, 'warning', 'Dê um nome a cada botão.');
  if (buttons.some((b) => b.url && !URL_RE.test(b.url))) add(nodeId, 'warning', 'Confira o link do botão (comece com https://).');
}

/** Blocos que alguma seta alcança a partir do gatilho. */
export function reachable(g: FlowGraph): Set<string> {
  const trig = g.nodes.find((n) => n.type === 'trigger')!;
  const seen = new Set<string>([trig.id]);
  const stack = [trig.id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of g.edges) if (e.source === cur && !seen.has(e.target)) { seen.add(e.target); stack.push(e.target); }
  }
  return seen;
}

/** Blocos alcançados sem passar por um clique de botão nem por uma resposta (pergunta). */
function closedWindowNodes(g: FlowGraph): Set<string> {
  const trig = g.nodes.find((n) => n.type === 'trigger')!;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [trig.id];
  while (stack.length) {
    const cur = stack.pop()!;
    const node = byId.get(cur);
    for (const e of g.edges) {
      if (e.source !== cur) continue;
      // Clique em botão ou resposta à pergunta abre a conversa: o que vem depois está liberado.
      if (e.sourceHandle.startsWith('btn:') || node?.type === 'question') continue;
      if (!seen.has(e.target)) { seen.add(e.target); stack.push(e.target); }
    }
  }
  return seen;
}

// ---- Execução -----------------------------------------------------------------------

/** Próximo bloco pela seta que sai de um ponto do bloco. */
export function nextNode(g: FlowGraph, nodeId: string, handle = 'next'): FlowNode | null {
  const e = g.edges.find((x) => x.source === nodeId && x.sourceHandle === handle);
  return e ? g.nodes.find((n) => n.id === e.target) ?? null : null;
}

/** Texto comparável: minúsculo, sem acento e sem espaços sobrando. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * O texto dispara o gatilho? Devolve a "força" do acerto (para escolher entre
 * fluxos): 3 exato, 2 contém, 1 qualquer; 0 não dispara.
 */
export function keywordScore(t: Pick<TriggerData, 'match' | 'keywords'>, raw: string | null | undefined): number {
  if (t.match === 'any') return 1;
  const s = normalize(raw ?? '');
  if (!s) return 0;
  const words = t.keywords.map(normalize).filter(Boolean);
  if (t.match === 'exact') return words.includes(s.replace(/[!?.,;:]+$/g, '')) ? 3 : 0;
  // Contém a palavra inteira (não pega "quero" dentro de "queroquero").
  return words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(s)) ? 2 : 0;
}

/** Variáveis do texto: {{nome}}, {{nome_completo}}, {{usuario}}, {{comentario}} e as respostas guardadas. */
export function renderText(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? '').replace(/[ \t]{2,}/g, ' ');
}

/** Valida e arruma a resposta de uma pergunta; nulo se não serve. */
export function checkAnswer(kind: 'text' | 'email' | 'phone' | 'number', raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (kind === 'text') return s.slice(0, 500);
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s.toLowerCase().slice(0, 254) : null;
  if (kind === 'number') { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? String(n) : null; }
  const d = s.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 13 ? d : null;
}

/** Minutos de um passo "Esperar". */
export function waitMinutes(d: { amount: number; unit: 'minutes' | 'hours' | 'days' }): number {
  return d.amount * (d.unit === 'days' ? 1440 : d.unit === 'hours' ? 60 : 1);
}

/** Botões que continuam o fluxo (sem link). */
export function postbackButtons(buttons: FlowButton[]): FlowButton[] {
  return buttons.filter((b) => !b.url && b.title.trim());
}

/** Dado de clique no botão: "f:<execução>:<botão>". */
export function payloadFor(runId: string, buttonId: string): string {
  return `f:${runId}:${buttonId}`;
}
export function parsePayload(p: string | null | undefined): { runId: string; buttonId: string } | null {
  const m = /^f:([0-9a-f-]{36}):([A-Za-z0-9_-]{1,64})$/.exec(p ?? '');
  return m ? { runId: m[1]!, buttonId: m[2]! } : null;
}

/** Desenho inicial de um fluxo novo, por gatilho (como no exemplo do comentário "Eu quero"). */
export function starterGraph(type: TriggerType): FlowGraph {
  const trigger: FlowNode = {
    id: 'trigger', type: 'trigger', position: { x: 0, y: 0 },
    data: {
      type, posts: 'any', postIds: [], match: type === 'story_mention' || type === 'reaction' || type === 'wa_broadcast' ? 'any' : 'contains', keywords: [],
      frequency: COMMENT_TRIGGERS.includes(type) ? 'once_per_post' : 'every',
    },
  };
  if (type === 'wa_broadcast') {
    return {
      nodes: [trigger, { id: 'n1', type: 'template', position: { x: 380, y: 80 }, data: { templateId: null, name: null, params: [], buttons: [] } }],
      edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' }],
    };
  }
  if (COMMENT_TRIGGERS.includes(type)) {
    return {
      nodes: [
        trigger,
        { id: 'n1', type: 'comment_reply', position: { x: 380, y: 200 }, data: { variants: ['Te mandei no direct! 📩', 'Acabei de te chamar no direct 😉', 'Olha seu direct! 💌'] } },
        { id: 'n2', type: 'private_reply', position: { x: 760, y: 120 }, data: { text: 'Oi, {{nome}}! Que bom que você comentou 😊 Toque no botão abaixo que eu te mando tudo por aqui.', buttons: [{ id: 'b1', title: 'Quero', url: null }] } },
      ],
      edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' }, { id: 'e2', source: 'n1', sourceHandle: 'next', target: 'n2' }],
    };
  }
  const greet = type === 'story_mention' ? 'Oi, {{nome}}! Obrigado por marcar a gente no seu story 💛'
    : type === 'story_reply' ? 'Oi, {{nome}}! Que bom que você respondeu nosso story 😊'
      : type === 'reaction' ? 'Oi, {{nome}}! Vi sua reação por aqui 😊' : 'Oi, {{nome}}! Que bom falar com você 😊';
  return {
    nodes: [trigger, { id: 'n1', type: 'text', position: { x: 380, y: 120 }, data: { text: greet, buttons: [] } }],
    edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' }],
  };
}
