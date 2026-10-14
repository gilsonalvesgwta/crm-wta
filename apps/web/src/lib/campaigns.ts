// Campanhas: tipos e rótulos da interface.
import type { Channel } from './messages';

export type Audience = {
  tagIds: string[]; excludeTagIds: string[]; ownerIds: string[]; teamIds: string[];
  pipelineId?: string | null; stageId?: string | null; sources: string[]; contactIds: string[];
  createdFrom?: string | null; createdTo?: string | null; consentOnly: boolean;
};

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'done' | 'canceled';

export type CampaignStats = { total: number; pending: number; sent: number; failed: number; skipped: number; delivered: number; read: number; replied: number };

export type Campaign = {
  id: string; name: string; description: string | null; channel: Channel; status: CampaignStatus; audience: Partial<Audience>;
  accountId: string | null; account: { id: string; name: string; kind: string; address: string | null; status: string } | null;
  subject: string | null; body: string | null; perMinute: number; windowStart: string | null; windowEnd: string | null; optOutHint: boolean;
  scheduledAt: string | null; startedAt: string | null; finishedAt: string | null; lastError: string | null;
  createdBy: { id: string; name: string } | null; startedBy: { id: string; name: string } | null;
  createdAt: string; updatedAt: string; stats: CampaignStats;
  templateId: string | null; templateParams: string[]; template: { id: string; name: string; language: string; body: string; header: string | null; status: string } | null;
};

export type AudiencePreview = { total: number; eligible: number; noAddress: number; revoked: number; noConsent: number; suppressed: number; sample: string[] };

export type Recipient = {
  id: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'; reason: string | null; address: string;
  sentAt: string | null; contactId: string; name: string; messageStatus: string | null;
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  scheduled: { label: 'Agendada', tone: 'info' },
  sending: { label: 'Enviando', tone: 'info' },
  paused: { label: 'Pausada', tone: 'warn' },
  done: { label: 'Concluída', tone: 'ok' },
  canceled: { label: 'Cancelada', tone: 'bad' },
};

export const RECIPIENT_STATUS: Record<Recipient['status'], string> = {
  pending: 'Na fila', sending: 'Enviando', sent: 'Enviada', failed: 'Falhou', skipped: 'Não enviada',
};

export const CAMPAIGN_VARIABLES: { key: string; label: string }[] = [
  { key: 'nome', label: 'Nome completo' },
  { key: 'primeiro_nome', label: 'Primeiro nome' },
  { key: 'empresa', label: 'Nome da sua empresa' },
  { key: 'responsavel', label: 'Responsável pelo contato' },
];

export const emptyAudience = (): Audience => ({
  tagIds: [], excludeTagIds: [], ownerIds: [], teamIds: [], pipelineId: null, stageId: null, sources: [], contactIds: [],
  createdFrom: null, createdTo: null, consentOnly: false,
});
