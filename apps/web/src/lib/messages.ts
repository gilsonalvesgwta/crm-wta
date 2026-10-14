// Canais e mensagens: tipos e rótulos da interface.

export type Message = {
  id: string; channel: 'whatsapp' | 'email' | 'instagram'; direction: 'in' | 'out';
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  kind: string; remote: string; subject: string | null; body: string | null; error: string | null; contactId: string;
  createdAt: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null; seenAt: string | null;
  account: { id: string; name: string; kind: string; address: string | null } | null;
  sentBy: { id: string; name: string } | null;
  automation?: { id: string; name: string } | null;
  campaign?: { id: string; name: string } | null;
  file: { id: string; name: string; contentType: string; sizeBytes: number } | null;
};

export type AccountKind = 'whatsapp_evolution' | 'whatsapp_cloud' | 'email_smtp' | 'instagram';
export type SendAccount = { id: string; kind: AccountKind; name: string; address: string | null; status: string };

/** Canal de cada tipo de conta. */
export const channelOfKind = (k: AccountKind): Channel => (k === 'email_smtp' ? 'email' : k === 'instagram' ? 'instagram' : 'whatsapp');
export const KIND_NAME: Record<AccountKind, string> = {
  whatsapp_evolution: 'WhatsApp', whatsapp_cloud: 'WhatsApp oficial', email_smtp: 'E-mail', instagram: 'Instagram',
};
export const CHANNEL_NAME: Record<Channel, string> = { whatsapp: 'WhatsApp', email: 'E-mail', instagram: 'Instagram' };

export type WaTemplate = {
  id: string; accountId: string; accountName: string; metaId: string | null; name: string; language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'; header: string | null; body: string; footer: string | null;
  buttons: { type: string; text: string }[]; examples: string[]; status: string; reason: string | null; updatedAt: string;
};
export const TEMPLATE_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  APPROVED: { label: 'Aprovado', tone: 'ok' }, PENDING: { label: 'Em análise na Meta', tone: 'info' }, REJECTED: { label: 'Recusado', tone: 'bad' },
  PAUSED: { label: 'Pausado', tone: 'warn' }, DISABLED: { label: 'Desativado', tone: 'bad' }, IN_APPEAL: { label: 'Em recurso', tone: 'info' },
  LIMIT_EXCEEDED: { label: 'Limite excedido', tone: 'warn' },
};
export const templateVariables = (text: string): number => {
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
};
export const fillTemplate = (text: string, params: string[]) => text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] || `{{${n}}}`);

export type Channel = 'whatsapp' | 'email' | 'instagram';
export type ConversationStatus = 'open' | 'waiting' | 'closed';

export type Conversation = {
  id: string; channel: Channel; status: ConversationStatus; contactId: string;
  openedAt: string; firstResponseAt: string | null; lastMessageAt: string; lastInAt: string | null; lastOutAt: string | null; closedAt: string | null;
  assignee: { id: string; name: string } | null; team: { id: string; name: string } | null;
  contact: { id: string; name: string; phone: string | null; email: string | null; instagram?: string | null; tags: { id: string; name: string; color: string }[] };
  unread: number;
  last: { id: string; direction: 'in' | 'out'; status: string; kind: string; body: string | null; subject: string | null; createdAt: string } | null;
};

export const CONVERSATION_STATUS: Record<ConversationStatus, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'info' }> = {
  open: { label: 'Aberta', tone: 'info' },
  waiting: { label: 'Aguardando cliente', tone: 'warn' },
  closed: { label: 'Encerrada', tone: 'neutral' },
};

export type QuickReply = {
  id: string; channel: Channel; shortcut: string; title: string; subject: string | null; body: string; shared: boolean;
  updatedAt: string; createdBy: { id: string; name: string } | null;
};

/** Troca {{variavel}} pelo valor; variável desconhecida ou vazia some. */
export function renderTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');
}

export const REPLY_VARIABLES: { key: string; label: string }[] = [
  { key: 'nome', label: 'Nome completo do contato' },
  { key: 'primeiro_nome', label: 'Primeiro nome do contato' },
  { key: 'empresa', label: 'Nome da sua empresa' },
  { key: 'atendente', label: 'Seu nome' },
];

export type ChannelAccount = {
  id: string; kind: AccountKind; name: string;
  status: 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error';
  address: string | null; instance: string | null; lastError: string | null; connectedAt: string | null; createdAt: string;
  smtp?: { host: string; port: number; secure: boolean; user: string; fromName: string; hasPassword: boolean };
  cloud?: { phoneNumberId: string; wabaId: string; verifiedName: string | null; quality: string | null; hasToken: boolean };
  instagram?: { igUserId: string; host: 'instagram' | 'facebook'; hasToken: boolean };
  webhook?: { url: string; verifyToken: string } | null;
};

export const STATUS_LABEL: Record<Message['status'], string> = {
  queued: 'Enviando', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Não enviada', received: 'Recebida',
};

export const KIND_LABEL: Record<string, string> = {
  image: 'Imagem', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha', location: 'Localização', contact: 'Contato', other: 'Mensagem',
};

export const ACCOUNT_STATUS: Record<ChannelAccount['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  pending: { label: 'Não testada', tone: 'neutral' },
  connecting: { label: 'Aguardando QR code', tone: 'info' },
  connected: { label: 'Conectada', tone: 'ok' },
  disconnected: { label: 'Desconectada', tone: 'warn' },
  error: { label: 'Com erro', tone: 'bad' },
};

/** Resumo de uma mensagem numa linha. */
export function preview(m: { kind: string; body: string | null; subject?: string | null; channel?: string }): string {
  if (m.channel === 'email' && m.subject) return m.subject;
  if (m.body) return m.body;
  return KIND_LABEL[m.kind] ?? 'Mensagem';
}
