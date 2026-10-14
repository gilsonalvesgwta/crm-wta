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

export type Conversation = {
  id: string; name: string; phone: string | null; email: string | null; unread: number;
  last: { id: string; channel: 'whatsapp' | 'email'; direction: 'in' | 'out'; status: string; kind: string; body: string | null; subject: string | null; createdAt: string };
};

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
