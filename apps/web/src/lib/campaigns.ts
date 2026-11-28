// Campanhas: tipos e rótulos da interface.
import type { Channel } from './messages';

/** Negócios num funil: etapas marcadas (vazio = todas) e a situação. */
export type DealGroup = { pipelineId: string; stageIds: string[]; status: 'open' | 'won' | 'lost' | 'any' };

export type Audience = {
  tagIds: string[]; tagMode?: 'any' | 'all'; excludeTagIds: string[]; ownerIds: string[]; teamIds: string[];
  deals?: DealGroup[]; excludeDeals?: DealGroup[];
  pipelineId?: string | null; stageId?: string | null; sources: string[]; contactIds: string[];
  createdFrom?: string | null; createdTo?: string | null; consentOnly: boolean;
};

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'done' | 'canceled';

export type CampaignStats = {
  total: number; pending: number; sent: number; failed: number; skipped: number; delivered: number; read: number; replied: number;
  /** Voz: atenderam, apertaram tecla, não atenderam (inclui ocupado/falha) e caixa postal. */
  answered?: number; pressed?: number; noAnswer?: number; machine?: number;
};

/** Canal da campanha: WhatsApp, e-mail ou ligação (voz). */
export type CampaignChannel = Channel | 'voice';

export type KeyAction = { label: string; tagId?: string | null; optOut: boolean; whatsapp: boolean; sms: boolean; notifyOwner: boolean };
export type ExtraWhen = 'with_call' | 'answered' | 'not_answered' | 'key';
export type VoiceSettings = {
  digits: boolean; keys: Record<string, KeyAction>; ringSeconds: number; machineDetection: boolean;
  whatsapp: { accountId: string; text: string; when: ExtraWhen } | null;
  sms: { text: string; when: ExtraWhen } | null;
  /** Recursos da Velip. */
  tts: { text: string; voice: string | null } | null;
  providerAudioId: string | null;
  transfer: { to: string; key: string | null; record: boolean } | null;
  retries: { times: number; everyMinutes: number } | null;
  dddHours: boolean;
};
export const emptyVoice = (): VoiceSettings => ({
  digits: false, keys: {}, ringSeconds: 30, machineDetection: false, whatsapp: null, sms: null,
  tts: null, providerAudioId: null, transfer: null, retries: null, dddHours: false,
});

export const EXTRA_WHEN: Record<ExtraWhen, string> = {
  with_call: 'Junto com a ligação (para todos)',
  answered: 'Só se atender',
  not_answered: 'Só se não atender',
  key: 'Só se apertar uma tecla marcada',
};

export type CallStatus = 'queued' | 'answered' | 'no_answer' | 'busy' | 'failed' | 'machine' | 'canceled';
export const CALL_STATUS: Record<CallStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  queued: { label: 'Chamando', tone: 'info' },
  answered: { label: 'Atendeu', tone: 'ok' },
  no_answer: { label: 'Não atendeu', tone: 'warn' },
  busy: { label: 'Ocupado', tone: 'warn' },
  failed: { label: 'Falhou', tone: 'bad' },
  machine: { label: 'Caixa postal', tone: 'neutral' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
};

export type Campaign = {
  id: string; name: string; description: string | null; channel: CampaignChannel; status: CampaignStatus; audience: Partial<Audience>;
  accountId: string | null; account: { id: string; name: string; kind: string; address: string | null; status: string } | null;
  subject: string | null; body: string | null; perMinute: number; windowStart: string | null; windowEnd: string | null; optOutHint: boolean;
  windowDays?: number[]; maxPerHour?: number | null; maxPerDay?: number | null; pauseAt?: string | null;
  /** Etiqueta posta em quem recebeu com sucesso. */
  successTagId?: string | null; successTag?: { id: string; name: string; color: string } | null;
  scheduledAt: string | null; startedAt: string | null; finishedAt: string | null; lastError: string | null;
  createdBy: { id: string; name: string } | null; startedBy: { id: string; name: string } | null;
  createdAt: string; updatedAt: string; stats: CampaignStats;
  templateId: string | null; templateParams: string[]; template: { id: string; name: string; language: string; body: string; header: string | null; status: string } | null;
  /** WhatsApp oficial: fluxo de transmissão (o modelo e os botões vêm dele). */
  flowId?: string | null; flow?: { id: string; name: string; status: string } | null;
  flowStats?: { clicked: number; completed: number; waiting: number } | null;
  /** Voz: operadora, áudio e opções da ligação. */
  voiceProviderId?: string | null; voiceProvider?: { id: string; name: string; provider: string; status: string } | null;
  audioFileId?: string | null; audio?: { id: string; name: string; contentType: string } | null;
  voice?: Partial<VoiceSettings>;
};

export type AudiencePreview = {
  total: number; eligible: number; noAddress: number; revoked: number; noConsent: number; suppressed: number; sample: string[];
  /** Vão receber pelo telefone (ou e-mail) da organização, porque o contato não tem. */
  fromOrganization?: number;
  /** Sem telefone, mas há outro contato com o mesmo nome que tem (provável duplicado). */
  duplicates?: number;
  /** Os que ficam de fora por falta de endereço (até 50), com o possível duplicado. */
  missing?: { id: string; name: string; twin: string | null }[];
  /** Contatos cujo nome no cadastro não parece nome ("sem nome", números, frase). */
  oddNames?: OddName[]; oddCount?: number;
};

export type OddName = { id: string; name: string; problem: string };

export type Recipient = {
  id: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'; reason: string | null; address: string;
  sentAt: string | null; contactId: string; name: string; messageStatus: string | null;
  callStatus?: CallStatus | null; callSeconds?: number | null; callDigits?: string | null; callExtras?: { whatsapp?: string; sms?: string };
  callRecordingUrl?: string | null;
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
  tagIds: [], tagMode: 'any', excludeTagIds: [], ownerIds: [], teamIds: [], deals: [], excludeDeals: [], pipelineId: null, stageId: null, sources: [], contactIds: [],
  createdFrom: null, createdTo: null, consentOnly: false,
});
