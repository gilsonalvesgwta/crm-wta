// Canais e mensagens: tipos e rótulos da interface.

export type Message = {
  id: string; channel: 'whatsapp' | 'email'; direction: 'in' | 'out';
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  kind: string; remote: string; subject: string | null; body: string | null; error: string | null; contactId: string;
  createdAt: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null; seenAt: string | null;
  account: { id: string; name: string; kind: string; address: string | null } | null;
  sentBy: { id: string; name: string } | null;
  automation?: { id: string; name: string } | null;
  file: { id: string; name: string; contentType: string; sizeBytes: number } | null;
};

export type SendAccount = { id: string; kind: 'whatsapp_evolution' | 'email_smtp'; name: string; address: string | null; status: string };

export type Channel = 'whatsapp' | 'email';
export type ConversationStatus = 'open' | 'waiting' | 'closed';

export type Conversation = {
  id: string; channel: Channel; status: ConversationStatus; contactId: string;
  openedAt: string; firstResponseAt: string | null; lastMessageAt: string; lastInAt: string | null; lastOutAt: string | null; closedAt: string | null;
  assignee: { id: string; name: string } | null; team: { id: string; name: string } | null;
  contact: { id: string; name: string; phone: string | null; email: string | null; tags: { id: string; name: string; color: string }[] };
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
  id: string; kind: 'whatsapp_evolution' | 'email_smtp'; name: string;
  status: 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error';
  address: string | null; instance: string | null; lastError: string | null; connectedAt: string | null; createdAt: string;
  smtp?: { host: string; port: number; secure: boolean; user: string; fromName: string; hasPassword: boolean };
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
