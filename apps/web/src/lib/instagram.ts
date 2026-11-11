// Fluxos do Instagram e do WhatsApp oficial (estilo Manychat): tipos e regras usadas pelas telas.
// O desenho é o mesmo grafo que a API guarda (apps/api/src/domain/flows.ts).

export type FlowChannel = 'instagram' | 'whatsapp';
export type TriggerType = 'comment' | 'live_comment' | 'dm_keyword' | 'story_reply' | 'story_mention' | 'reaction' | 'wa_broadcast' | 'wa_keyword';
export type NodeType = 'trigger' | 'comment_reply' | 'private_reply' | 'text' | 'template' | 'media' | 'wait' | 'question' | 'condition' | 'action';

export type FlowButton = { id: string; title: string; url?: string | null };
export type TriggerData = {
  type: TriggerType; posts: 'any' | 'chosen'; postIds: string[]; match: 'any' | 'contains' | 'exact'; keywords: string[];
  frequency: 'every' | 'once_per_contact' | 'once_per_post';
};
export type FlowRule =
  | { kind: 'has_tag' | 'not_tag'; tagId: string }
  | { kind: 'follows' | 'not_follows' }
  | { kind: 'var_equals'; key: string; value: string }
  | { kind: 'var_set'; key: string };
export type FlowOp =
  | { kind: 'add_tag' | 'remove_tag'; tagId: string }
  | { kind: 'set_field'; key: string; value: string }
  | { kind: 'create_lead'; title: string }
  | { kind: 'create_deal'; pipelineId: string; title: string }
  | { kind: 'notify'; membershipId: string | null; text: string }
  | { kind: 'assign'; membershipId: string };

export type NodeData = {
  trigger: TriggerData;
  comment_reply: { variants: string[] };
  private_reply: { text: string; buttons: FlowButton[] };
  text: { text: string; buttons: FlowButton[] };
  /** WhatsApp: modelo aprovado; os botões são as respostas rápidas do modelo (id "q" + posição). */
  template: { templateId: string | null; name: string | null; params: string[]; buttons: FlowButton[] };
  media: { fileId: string | null; name: string | null; kind: 'image' | 'video' | 'audio' | 'file' | null };
  wait: { amount: number; unit: 'minutes' | 'hours' | 'days' };
  question: {
    text: string; saveTo: 'var' | 'field' | 'email' | 'phone'; key: string; validate: 'text' | 'email' | 'phone' | 'number';
    retryText: string; timeoutHours: number | null;
  };
  condition: { match: 'all' | 'any'; rules: FlowRule[] };
  action: { ops: FlowOp[] };
};
export type FlowNode = { [K in NodeType]: { id: string; type: K; position: { x: number; y: number }; data: NodeData[K] } }[NodeType];
export type FlowEdge = { id: string; source: string; sourceHandle: string; target: string };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };
export type FlowIssue = { nodeId: string | null; level: 'error' | 'warning'; message: string };

export type FlowStatus = 'draft' | 'active' | 'paused';
export type FlowItem = {
  id: string; name: string; triggerType: TriggerType; status: FlowStatus; version: number; publishedAt: string | null; updatedAt: string;
  createdAt: string; accountId: string; accountName: string; unpublishedChanges: boolean; triggered7d: number; triggeredTotal: number; waiting: number;
};
export type Flow = Omit<FlowItem, 'triggered7d' | 'triggeredTotal' | 'waiting'> & { draft: FlowGraph; published: FlowGraph | null; issues: FlowIssue[] };
export type IgAccount = { id: string; name: string; status: string; igUserId: string; username: string | null };
export type WaAccount = { id: string; name: string; status: string; address: string | null; phoneNumberId: string };
export type IgPost = { id: string; caption: string; type: 'reels' | 'post' | 'story'; thumbnail: string | null; permalink: string | null; at: string | null };
export type MediaItem = { id: string; name: string; contentType: string; size: number; createdAt: string; uploadedBy?: string | null };

export const TRIGGERS: { type: TriggerType; title: string; desc: string }[] = [
  { type: 'comment', title: 'Comentário em post ou reels', desc: 'Alguém comenta uma palavra e recebe a resposta no comentário e no direct.' },
  { type: 'dm_keyword', title: 'Palavra no direct', desc: 'Alguém manda uma palavra-chave no direct.' },
  { type: 'live_comment', title: 'Comentário em live', desc: 'Alguém comenta durante a sua transmissão ao vivo.' },
  { type: 'story_reply', title: 'Resposta a story', desc: 'Alguém responde a um story seu.' },
  { type: 'story_mention', title: 'Menção em story', desc: 'Alguém marca você no story dela.' },
  { type: 'reaction', title: 'Reação a mensagem', desc: 'Alguém reage com um emoji a uma mensagem sua.' },
];
export const WA_TRIGGERS: { type: TriggerType; title: string; desc: string }[] = [
  { type: 'wa_broadcast', title: 'Quando você envia uma transmissão', desc: 'A campanha manda um modelo aprovado com botões; o clique continua a conversa.' },
  { type: 'wa_keyword', title: 'Palavra na mensagem', desc: 'Alguém manda uma palavra-chave para o seu WhatsApp.' },
];
export const TRIGGER_TITLE = Object.fromEntries([...TRIGGERS, ...WA_TRIGGERS].map((t) => [t.type, t.title])) as Record<TriggerType, string>;
export const COMMENT_TRIGGERS: TriggerType[] = ['comment', 'live_comment'];
export const KEYWORD_TRIGGERS: TriggerType[] = ['comment', 'live_comment', 'dm_keyword', 'story_reply', 'wa_keyword'];

export const channelOfTrigger = (t: TriggerType): FlowChannel => (t === 'wa_broadcast' || t === 'wa_keyword' ? 'whatsapp' : 'instagram');

/** Onde ficam as telas e a API de cada canal. */
export const FLOW_BASE: Record<FlowChannel, { api: string; path: string; name: string }> = {
  instagram: { api: '/api/v1/instagram', path: '/instagram', name: 'Instagram' },
  whatsapp: { api: '/api/v1/whatsapp', path: '/whatsapp', name: 'WhatsApp' },
};

export const FLOW_STATUS: Record<FlowStatus, { label: string; tone: 'neutral' | 'ok' | 'warn' }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  active: { label: 'Ativo', tone: 'ok' },
  paused: { label: 'Pausado', tone: 'warn' },
};

export const NODE_TITLE: Record<NodeType, string> = {
  trigger: 'Quando…',
  comment_reply: 'Responder no comentário',
  private_reply: 'Responder no privado',
  text: 'Mandar no direct',
  template: 'Modelo aprovado',
  media: 'Mandar mídia',
  wait: 'Esperar',
  question: 'Pergunta',
  condition: 'Condição',
  action: 'Ações no CRM',
};

/** Título do bloco no canal (no WhatsApp não há "direct"). */
export function nodeTitle(type: NodeType, channel: FlowChannel): string {
  if (channel === 'whatsapp' && type === 'text') return 'Mandar mensagem';
  return NODE_TITLE[type];
}

export const VARIABLES: { key: string; label: string }[] = [
  { key: 'nome', label: 'Primeiro nome' },
  { key: 'nome_completo', label: 'Nome completo' },
  { key: 'usuario', label: '@ da pessoa' },
  { key: 'comentario', label: 'Comentário ou mensagem' },
];
export const WA_VARIABLES: { key: string; label: string }[] = [
  { key: 'nome', label: 'Primeiro nome' },
  { key: 'nome_completo', label: 'Nome completo' },
  { key: 'telefone', label: 'Telefone da pessoa' },
  { key: 'mensagem', label: 'Mensagem que disparou' },
];

const rid = () => Math.random().toString(36).slice(2, 8);
export const newId = (prefix = 'n') => `${prefix}${rid()}`;

/** Bloco novo com os valores iniciais. */
export function newNode(type: Exclude<NodeType, 'trigger'>, position: { x: number; y: number }): FlowNode {
  const id = newId();
  switch (type) {
    case 'comment_reply': return { id, type, position, data: { variants: [''] } };
    case 'private_reply': return { id, type, position, data: { text: '', buttons: [{ id: newId('b'), title: 'Quero', url: null }] } };
    case 'text': return { id, type, position, data: { text: '', buttons: [] } };
    case 'template': return { id, type, position, data: { templateId: null, name: null, params: [], buttons: [] } };
    case 'media': return { id, type, position, data: { fileId: null, name: null, kind: null } };
    case 'wait': return { id, type, position, data: { amount: 5, unit: 'minutes' } };
    case 'question': return { id, type, position, data: { text: '', saveTo: 'var', key: 'resposta', validate: 'text', retryText: 'Não entendi. Pode mandar de novo?', timeoutHours: null } };
    case 'condition': return { id, type, position, data: { match: 'all', rules: [{ kind: 'has_tag', tagId: '' }] } };
    case 'action': return { id, type, position, data: { ops: [{ kind: 'add_tag', tagId: '' }] } };
  }
}

/** Saídas de um bloco (cada uma pode ter uma seta). */
export function outputsOf(n: FlowNode): { handle: string; label: string | null; tone?: 'ok' | 'bad' | 'muted' }[] {
  switch (n.type) {
    case 'private_reply':
    case 'text': {
      const btns = n.data.buttons.filter((b) => !b.url).map((b) => ({ handle: `btn:${b.id}`, label: b.title || 'Botão' }));
      // Com botão, o fluxo segue pelo clique; texto sem botão segue direto.
      if (n.type === 'private_reply') return btns;
      return btns.length ? btns : [{ handle: 'next', label: null }];
    }
    case 'template': {
      const btns = n.data.buttons.map((b) => ({ handle: `btn:${b.id}`, label: b.title || 'Botão' }));
      return btns.length ? btns : [{ handle: 'next', label: null }];
    }
    case 'question': return [{ handle: 'next', label: 'Respondeu' }, { handle: 'timeout', label: 'Não respondeu', tone: 'muted' }];
    case 'condition': return [{ handle: 'yes', label: 'Sim', tone: 'ok' }, { handle: 'no', label: 'Não', tone: 'bad' }];
    default: return [{ handle: 'next', label: null }];
  }
}

export const UNIT_LABEL = { minutes: 'minutos', hours: 'horas', days: 'dias' } as const;

/** Texto comparável: minúsculo, sem acento e sem espaços sobrando (igual ao da API). */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function keywordMatches(t: Pick<TriggerData, 'match' | 'keywords'>, raw: string): boolean {
  if (t.match === 'any') return true;
  const s = normalize(raw);
  if (!s) return false;
  const words = t.keywords.map(normalize).filter(Boolean);
  if (t.match === 'exact') return words.includes(s.replace(/[!?.,;:]+$/g, ''));
  return words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(s));
}

export function renderText(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? '').replace(/[ \t]{2,}/g, ' ');
}

export function checkAnswer(kind: 'text' | 'email' | 'phone' | 'number', raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (kind === 'text') return s.slice(0, 500);
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s.toLowerCase() : null;
  if (kind === 'number') { const v = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? String(v) : null; }
  const d = s.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 13 ? d : null;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

export function mediaKind(contentType: string): NodeData['media']['kind'] {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'file';
}
