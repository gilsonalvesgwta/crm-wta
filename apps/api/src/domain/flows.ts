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
  // WhatsApp por QR code: outras respostas que valem como esta opção ("sim", "quero", "claro").
  keywords: z.array(text(40)).max(10).default([]),
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
  // Passa o negócio aberto mais recente do contato para outra etapa (ou cria, se não houver).
  z.object({ kind: z.literal('move_deal'), pipelineId: z.string().default(''), stageId: z.string().default(''), title: text(200).default('') }),
  // Tira o contato das campanhas (pediu para não receber mais).
  z.object({ kind: z.literal('opt_out') }),
]);
export type FlowOp = z.infer<typeof op>;

const position = z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 });

const nodeSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('trigger'), position, data: triggerData }),
  z.object({ id, type: z.literal('comment_reply'), position, data: z.object({ variants: z.array(text(300)).max(3).default(['']) }) }),
  z.object({ id, type: z.literal('private_reply'), position, data: z.object({ text: text(640).default(''), buttons: z.array(button).max(3).default([]) }) }),
  z.object({
    id, type: z.literal('text'), position,
    data: z.object({
      text: text(1000).default(''),
      // Instagram e WhatsApp oficial: até 3 botões. WhatsApp por QR code: até 10 opções numeradas.
      buttons: z.array(button).max(10).default([]),
      // WhatsApp por QR code: o que mandar quando a resposta não bate com nenhuma opção (sem seta "Outra resposta").
      retryText: text(300).default('Não entendi 😅 Responda com o número de uma das opções:'),
      // Quanto esperar a escolha antes de seguir pela seta "Se não responder" (vazio: 7 dias).
      timeoutHours: z.number().int().min(1).max(168).nullable().default(null),
    }),
  }),
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
  // Sorteio (teste A/B): cada caminho tem um peso; a pessoa vai por um deles.
  z.object({ id, type: z.literal('random'), position, data: z.object({ weights: z.array(z.number().int().min(0).max(100)).min(2).max(5).default([50, 50]) }) }),
  z.object({ id, type: z.literal('action'), position, data: z.object({ ops: z.array(op).max(10).default([]) }) }),
]);
export type FlowNode = z.infer<typeof nodeSchema>;
export type NodeType = FlowNode['type'];

const edgeSchema = z.object({
  id: z.string().max(140),
  source: id,
  // next; btn:<id>; yes; no; timeout; other (resposta que não é nenhuma opção); r:<n> (sorteio)
  sourceHandle: z.string().regex(/^(next|yes|no|timeout|other|r:[0-9]|btn:[A-Za-z0-9_-]{1,64})$/).default('next'),
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
/** Opções de um bloco no WhatsApp por QR code (o WhatsApp não mostra botões fora da API oficial). */
export const QR_MAX_OPTIONS = 10;

/** Onde o fluxo roda: Instagram, WhatsApp oficial ou WhatsApp por QR code (Evolution). */
export type FlowMode = 'instagram' | 'cloud' | 'qr';
/** Botão de resposta rápida de um modelo: "q" + posição do botão no modelo. */
export const TEMPLATE_BUTTON_RE = /^q([0-9])$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;

/** O que falta ou pode dar errado no desenho, por bloco. */
export function flowIssues(g: FlowGraph, opts: { qr?: boolean } = {}): FlowIssue[] {
  const out: FlowIssue[] = [];
  const t = triggerOf(g);
  const trig = g.nodes.find((n) => n.type === 'trigger')!;
  const wa = channelOfTrigger(t.type) === 'whatsapp';
  const qr = wa && !!opts.qr;
  const fromComment = COMMENT_TRIGGERS.includes(t.type);
  const add = (nodeId: string | null, level: FlowIssue['level'], message: string) => out.push({ nodeId, level, message });

  // Gatilho
  if (['comment', 'live_comment', 'dm_keyword', 'story_reply', 'wa_keyword'].includes(t.type) && t.match !== 'any' && !t.keywords.some((k) => k.trim())) {
    add(trig.id, 'warning', 'Adicione pelo menos uma palavra-chave, ou escolha "qualquer".');
  }
  if (t.type === 'comment' && t.posts === 'chosen' && !t.postIds.length) add(trig.id, 'error', 'Escolha ao menos uma publicação, ou "qualquer post ou reels".');
  if (!g.edges.some((e) => e.source === trig.id)) add(trig.id, 'warning', 'Ligue o gatilho ao primeiro passo.');
  if (t.type === 'wa_broadcast' && !qr) {
    const first = nextNode(g, trig.id, 'next');
    if (first && first.type !== 'template') {
      add(first.id, 'error', 'A transmissão começa com um modelo aprovado: fora das 24 h, o WhatsApp só entrega modelo.');
    }
  }

  const reach = reachable(g);
  // Blocos que podem rodar sem a conversa estar aberta (antes de qualquer clique ou resposta da pessoa).
  const closed = fromComment || (t.type === 'wa_broadcast' && !qr) ? closedWindowNodes(g) : new Set<string>();

  for (const n of g.nodes) {
    if (n.type === 'trigger') continue;
    if (!reach.has(n.id)) add(n.id, 'warning', 'Este bloco não está ligado ao fluxo e não vai rodar.');
    switch (n.type) {
      case 'template':
        if (!wa || qr) { add(n.id, 'error', qr ? 'Modelo aprovado só existe no WhatsApp oficial. No QR code, use "Mensagem".' : 'Modelo aprovado só existe no WhatsApp oficial.'); break; }
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
        if (!qr && n.data.buttons.length > 3) add(n.id, 'error', 'Aqui cabem até 3 botões (no WhatsApp por QR code, até 10 opções).');
        if (wa && !qr && n.data.buttons.some((b) => b.url)) add(n.id, 'warning', 'No WhatsApp, o botão de link vai como link no fim do texto.');
        if (qr && postbackButtons(n.data.buttons).length && !g.edges.some((e) => e.source === n.id && e.sourceHandle.startsWith('btn:'))) {
          add(n.id, 'warning', 'Ligue as opções aos próximos passos: a resposta da pessoa é o que continua a conversa.');
        }
        break;
      case 'media':
        if (!n.data.fileId) add(n.id, 'warning', 'Escolha o arquivo na biblioteca de mídia.');
        break;
      case 'wait': {
        const minutes = n.data.amount * (n.data.unit === 'days' ? 1440 : n.data.unit === 'hours' ? 60 : 1);
        if (minutes > 23 * 60 && !qr) {
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
      case 'random':
        if (n.data.weights.every((w) => w === 0)) add(n.id, 'error', 'Dê peso a pelo menos um caminho.');
        if (!g.edges.some((e) => e.source === n.id)) add(n.id, 'warning', 'Ligue os caminhos do sorteio aos próximos passos.');
        break;
      case 'action':
        if (!n.data.ops.length) add(n.id, 'warning', 'Adicione pelo menos uma ação.');
        if (n.data.ops.some((o) => ('tagId' in o && !o.tagId) || (o.kind === 'set_field' && !o.key) || (o.kind === 'create_deal' && !o.pipelineId) || (o.kind === 'assign' && !o.membershipId) || (o.kind === 'move_deal' && (!o.pipelineId || !o.stageId)))) {
          add(n.id, 'warning', 'Complete as ações.');
        }
        break;
    }
    if (fromComment && DM_NODES.includes(n.type) && closed.has(n.id)) {
      add(n.id, 'warning', 'A conversa ainda não está aberta aqui: no comentário, o direct só abre pela "Resposta no privado" e o clique no botão.');
    }
    if (t.type === 'wa_broadcast' && !qr && DM_NODES.includes(n.type) && closed.has(n.id)) {
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

const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/**
 * WhatsApp por QR code: o texto com as opções numeradas (o WhatsApp só mostra
 * botões de verdade pela API oficial) e os links no fim.
 */
export function qrMessage(text: string, buttons: FlowButton[]): string {
  const opts = postbackButtons(buttons).slice(0, QR_MAX_OPTIONS);
  const links = buttons.filter((b) => b.url && b.title.trim());
  const parts = [text.trim()];
  if (opts.length) parts.push(opts.map((b, i) => `${KEYCAPS[i]} ${b.title.trim()}`).join('\n'));
  if (links.length) parts.push(links.map((l) => `🔗 ${l.title.trim()}: ${l.url}`).join('\n'));
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Qual opção a pessoa escolheu: o número ("2", "2️⃣", "opção 2"), o nome da
 * opção ou uma das palavras dela. Nulo se não deu para saber.
 */
export function pickOption(buttons: FlowButton[], raw: string | null | undefined): FlowButton | null {
  const opts = postbackButtons(buttons).slice(0, QR_MAX_OPTIONS);
  if (!opts.length || !raw) return null;
  const keycap = KEYCAPS.findIndex((k) => raw.includes(k));
  if (keycap >= 0 && keycap < opts.length) return opts[keycap]!;
  const s = normalize(raw).replace(/[!?.,;:*_~()"'“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const num = /^(?:opcao|opção|op|n|numero|número|#)?\s*([0-9]{1,2})(?:\s.*)?$/.exec(s);
  if (num) {
    const i = Number(num[1]) - 1;
    if (i >= 0 && i < opts.length) return opts[i]!;
  }
  // Nome exato da opção ou de uma palavra dela.
  for (const b of opts) {
    const words = [b.title, ...(b.keywords ?? [])].map(normalize).filter(Boolean);
    if (words.includes(s)) return b;
  }
  // A resposta começa com o nome da opção ou com uma palavra dela ("sim, quero saber").
  const hits = opts.filter((b) => [b.title, ...(b.keywords ?? [])].map(normalize).filter((w) => w.length >= 2)
    .some((w) => new RegExp(`^${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(s)));
  return hits.length === 1 ? hits[0]! : null;
}

/** Sorteio: índice do caminho escolhido pelos pesos (r é um número de 0 a 1). */
export function pickWeighted(weights: number[], r: number): number {
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= Math.max(0, weights[i]!);
    if (x < 0) return i;
  }
  return weights.length - 1;
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
export function starterGraph(type: TriggerType, opts: { qr?: boolean } = {}): FlowGraph {
  const trigger: FlowNode = {
    id: 'trigger', type: 'trigger', position: { x: 0, y: 0 },
    data: {
      type, posts: 'any', postIds: [], match: type === 'story_mention' || type === 'reaction' || type === 'wa_broadcast' ? 'any' : 'contains', keywords: [],
      frequency: COMMENT_TRIGGERS.includes(type) ? 'once_per_post' : 'every',
    },
  };
  if (opts.qr && (type === 'wa_broadcast' || type === 'wa_keyword')) return qrStarter(trigger);
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
        { id: 'n2', type: 'private_reply', position: { x: 760, y: 120 }, data: { text: 'Oi, {{nome}}! Que bom que você comentou 😊 Toque no botão abaixo que eu te mando tudo por aqui.', buttons: [{ id: 'b1', title: 'Quero', url: null, keywords: [] }] } },
      ],
      edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' }, { id: 'e2', source: 'n1', sourceHandle: 'next', target: 'n2' }],
    };
  }
  const greet = type === 'story_mention' ? 'Oi, {{nome}}! Obrigado por marcar a gente no seu story 💛'
    : type === 'story_reply' ? 'Oi, {{nome}}! Que bom que você respondeu nosso story 😊'
      : type === 'reaction' ? 'Oi, {{nome}}! Vi sua reação por aqui 😊' : 'Oi, {{nome}}! Que bom falar com você 😊';
  return {
    nodes: [trigger, { id: 'n1', type: 'text', position: { x: 380, y: 120 }, data: { text: greet, buttons: [], retryText: 'Não entendi 😅 Responda com o número de uma das opções:', timeoutHours: null } }],
    edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' }],
  };
}

/**
 * Exemplo pronto para o WhatsApp por QR code (estilo campanha de promoção):
 * pergunta com opções, caminho do "sim", do "não", de quem não responde e de
 * quem pede para sair. É só trocar os textos.
 */
function qrStarter(trigger: FlowNode): FlowGraph {
  const btn = (id: string, title: string, keywords: string[]) => ({ id, title, url: null, keywords });
  return {
    nodes: [
      trigger,
      {
        id: 'n1', type: 'text', position: { x: 380, y: 60 },
        data: {
          text: 'Oi, {{primeiro_nome}}! Tudo bem? 😊\nEstamos com uma condição especial de *Black Friday* só para clientes. Quer saber mais?',
          buttons: [btn('b1', 'Quero saber mais', ['sim', 'quero', 'claro', 'pode']), btn('b2', 'Agora não', ['nao', 'depois']), btn('b3', 'Não quero receber', ['sair', 'parar', 'pare'])],
          retryText: 'Não entendi 😅 Responda com o número de uma das opções:', timeoutHours: 24,
        },
      },
      {
        id: 'n2', type: 'text', position: { x: 820, y: -120 },
        data: { text: 'Que bom! 🎉 Vou te passar os detalhes. Qual é o melhor horário para falarmos?', buttons: [btn('c1', 'Manhã', []), btn('c2', 'Tarde', []), btn('c3', 'Noite', [])], retryText: 'Responda com o número do horário:', timeoutHours: null },
      },
      { id: 'n3', type: 'action', position: { x: 1260, y: -120 }, data: { ops: [{ kind: 'notify', membershipId: null, text: '{{nome}} quer saber da promoção de Black Friday.' }] } },
      { id: 'n4', type: 'text', position: { x: 1640, y: -120 }, data: { text: 'Perfeito! Alguém da equipe vai te chamar em instantes. 🙌', buttons: [], retryText: '', timeoutHours: null } },
      { id: 'n5', type: 'text', position: { x: 820, y: 160 }, data: { text: 'Tudo bem! Se mudar de ideia, é só responder *QUERO* aqui. 😉', buttons: [], retryText: '', timeoutHours: null } },
      { id: 'n6', type: 'action', position: { x: 1260, y: 340 }, data: { ops: [{ kind: 'opt_out' }] } },
      { id: 'n7', type: 'text', position: { x: 820, y: 340 }, data: { text: 'Pronto, você não vai mais receber nossas campanhas. Obrigado! 🙏', buttons: [], retryText: '', timeoutHours: null } },
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'n1' },
      { id: 'e2', source: 'n1', sourceHandle: 'btn:b1', target: 'n2' },
      { id: 'e3', source: 'n2', sourceHandle: 'btn:c1', target: 'n3' },
      { id: 'e4', source: 'n2', sourceHandle: 'btn:c2', target: 'n3' },
      { id: 'e5', source: 'n2', sourceHandle: 'btn:c3', target: 'n3' },
      { id: 'e6', source: 'n3', sourceHandle: 'next', target: 'n4' },
      { id: 'e7', source: 'n1', sourceHandle: 'btn:b2', target: 'n5' },
      // Primeiro confirma, depois tira das campanhas (depois disso, nenhuma mensagem automática chega).
      { id: 'e8', source: 'n1', sourceHandle: 'btn:b3', target: 'n7' },
      { id: 'e9', source: 'n7', sourceHandle: 'next', target: 'n6' },
    ],
  };
}
