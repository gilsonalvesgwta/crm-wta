// Tipos e formatação do CRM comercial, espelhando as respostas da API.

export type Ref = { id: string; name: string };
export type TagRef = { id: string; name: string; color: string };
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export type ContactItem = {
  id: string; firstName: string; lastName: string | null; name: string; jobTitle: string | null;
  organization: Ref | null; email: string | null; phone: string | null; owner: Ref | null; tags: TagRef[];
  createdAt: string; updatedAt: string; lastActivityAt: string | null;
};
export type Touch = {
  occurredAt: string; via: string; source: string | null; medium: string | null; campaign: string | null; term: string | null;
  content: string | null; clickIds: Record<string, string>; referrer: string | null; landingPage: string | null;
};
export type Contact = ContactItem & {
  taxId: string | null; address: Record<string, string>; custom: Record<string, unknown>; teamId: string | null; team: Ref | null;
  birthday: { day: number; month: number; year: number | null } | null; anonymizedAt: string | null;
  emails: { id: string; email: string; label: string; isPrimary: boolean }[];
  phones: { id: string; number: string; label: string; isPrimary: boolean }[];
  attribution: { first: Touch; last: Touch; touches: number } | null;
  consents: { channel: string; purpose: string; status: 'granted' | 'revoked'; source: string; recordedAt: string }[];
  counts: { deals: number; openDeals: number; leads: number; openActivities: number; files: number };
};
export type Duplicate = { id: string; name: string; matchedBy: ('email' | 'phone')[]; visible: boolean };

export type Organization = {
  id: string; name: string; legalName: string | null; taxId: string | null; domain: string | null; website: string | null;
  email: string | null; phone: string | null; industry: string | null; address: Record<string, string>; custom: Record<string, unknown>;
  teamId: string | null; createdAt: string; updatedAt: string; lastActivityAt: string | null; owner: Ref | null; contactCount: number;
  tags: TagRef[]; counts?: { deals: number; openDeals: number; openValueCents: number };
};

export type Stage = {
  id: string; name: string; position: number; color: string; probability: number; kind: 'open' | 'won' | 'lost';
  requiredFields: string[]; rottingDays: number | null; allowedTargets: string[];
};
export type Pipeline = {
  id: string; name: string; position: number; currency: string; restricted: boolean; archived: boolean; stages: Stage[];
  access?: { teamIds: string[]; membershipIds: string[] };
};
export type DealCard = {
  id: string; title: string; valueCents: number; currency: string; status: 'open' | 'won' | 'lost'; pipelineId: string; stageId: string;
  expectedCloseDate: string | null; stageEnteredAt: string; closedAt: string | null; lastActivityAt: string | null; createdAt: string;
  owner: Ref | null; contact: Ref | null; organization: Ref | null; tags: TagRef[]; openActivities: number; nextActivityAt: string | null;
  rotting: boolean; stage?: { id: string; name: string; color: string; kind: string }; pipeline?: Ref;
};
export type Deal = DealCard & {
  custom: Record<string, unknown>; teamId: string | null; leadId: string | null; outcomeNote: string | null;
  outcomeReason: { id: string; name: string; kind: string } | null;
  stage: { id: string; name: string; color: string; kind: 'open' | 'won' | 'lost'; probability: number };
  pipeline: Ref; participants: Ref[];
  items: { id: string; productId: string | null; name: string; quantity: number; unitPriceCents: number; discountCents: number }[];
  history: { movedAt: string; secondsInPrevious: number | null; from: Ref | null; to: Ref; movedBy: string | null }[];
};
export type Board = { pipeline: Pipeline; stages: (Stage & { count: number; totalCents: number; weightedCents: number; deals: DealCard[] })[] };

export type Lead = {
  id: string; title: string; status: 'new' | 'working' | 'qualified' | 'disqualified'; source: string | null; createdAt: string;
  updatedAt: string; assignedAt: string | null; qualifiedAt: string | null; lastActivityAt: string | null; disqualifyReason: string | null;
  dealId: string | null; teamId: string | null; custom: Record<string, unknown>; owner: Ref | null; team: Ref | null;
  contact: { id: string; name: string; email: string | null; phone: string | null };
};

export type Activity = {
  id: string; type: ActivityType; title: string; description: string | null; startsAt: string | null; endsAt: string | null;
  allDay: boolean; status: 'open' | 'done' | 'canceled'; doneAt: string | null; outcome?: CallOutcome | null; priority: 'low' | 'normal' | 'high';
  reminderMinutes: number | null; seriesId: string | null; seriesIndex: number | null; createdAt: string; teamId: string | null;
  overdue: boolean; owner: Ref | null; contact: Ref | null; organization: Ref | null; deal: { id: string; title: string } | null;
  lead: { id: string; title: string } | null; recurrence: { freq: string; interval: number } | null;
};
export type ActivityType = 'task' | 'call' | 'meeting' | 'email' | 'visit' | 'other';
/** Resultado de ligação ou reunião concluída. */
export type CallOutcome = 'held' | 'no_show' | 'rescheduled';
export const OUTCOME_LABEL: Record<CallOutcome, string> = { held: 'Realizada', no_show: 'Não compareceu', rescheduled: 'Remarcada' };
/** Corpo do pedido para concluir (com resultado) ou reabrir uma atividade. */
export const statusBody = (a: { status: string }, outcome?: CallOutcome) =>
  a.status === 'done' ? { status: 'open' } : { status: 'done', ...(outcome ? { outcome } : {}) };

export type FieldDef = {
  id: string; entity: 'contact' | 'organization' | 'deal' | 'lead'; key: string; label: string;
  type: 'text' | 'long_text' | 'number' | 'currency' | 'date' | 'boolean' | 'select' | 'multi_select' | 'url' | 'email' | 'phone';
  options: { value: string; label: string }[]; required: boolean; position: number; archived: boolean;
};
export type Product = { id: string; name: string; sku: string | null; description: string | null; priceCents: number; currency: string; active: boolean };
export type Reason = { id: string; kind: 'won' | 'lost'; name: string; position: number; active: boolean };
export type Directory = { me: string; members: { id: string; name: string; email: string; teamIds: string[] }[]; teams: Ref[] };
export type Note = { id: string; body: string; pinned: boolean; createdAt: string; updatedAt: string; author: Ref | null; mine: boolean };
export type TimelineEntry = {
  id: string; kind: string; occurredAt: string; data: Record<string, unknown>; actor: Ref | null;
  deal: { id: string; title: string } | null; lead: { id: string; title: string } | null; contact: Ref | null;
};
export type FileItem = { id: string; originalName: string; contentType: string; sizeBytes: number; createdAt: string; uploadedBy: Ref | null };
export type Notification = { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: string; readAt: string | null };

// ---- Formatação --------------------------------------------------------------

const moneyFmt = new Map<string, Intl.NumberFormat>();
export function money(cents: number, currency = 'BRL', compact = false): string {
  const key = `${currency}:${compact}`;
  let f = moneyFmt.get(key);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', compact
      ? { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }
      : { style: 'currency', currency });
    moneyFmt.set(key, f);
  }
  return f.format(cents / 100);
}

/** "1.234,56" ou "1234.56" → centavos. Vazio → null. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[^\d,.-]/g, '').trim();
  if (!t) return null;
  // "1.234,56" e "4.800" (milhar com ponto) são o padrão brasileiro; "4.8" é decimal.
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function moneyInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const fmtDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
export const fmtDateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Data AAAA-MM-DD (sem fuso) para exibição. */
/** Data sem hora (AAAA-MM-DD). Aceita também data com hora; o que não for data aparece como veio, sem quebrar a tela. */
export function fmtIsoDate(s: string | null | undefined): string {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return String(s);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? String(s) : fmtDate.format(d);
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function relative(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'agora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate.format(new Date(iso));
}

/** Telefone E.164 em formato de leitura (Brasil detalhado, demais com DDI). */
export function phone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  task: 'Tarefa', call: 'Ligação', meeting: 'Reunião', email: 'E-mail', visit: 'Visita', other: 'Outro',
};
export const LEAD_STATUS: Record<Lead['status'], string> = {
  new: 'Novo', working: 'Em contato', qualified: 'Qualificado', disqualified: 'Descartado',
};
export const CHANNEL_LABEL: Record<string, string> = {
  email: 'E-mail', whatsapp: 'WhatsApp', sms: 'SMS', phone: 'Telefone', instagram: 'Instagram',
};
export const REQUIRED_LABEL: Record<string, string> = {
  value: 'Valor', expected_close_date: 'Previsão de fechamento', contact: 'Contato', organization: 'Organização', products: 'Produtos',
};

/** Texto de um evento da linha do tempo. */
export function timelineText(e: TimelineEntry): string {
  const d = e.data as Record<string, string | string[] | null | undefined>;
  switch (e.kind) {
    case 'contact.created': return d.via === 'import' ? 'Contato criado pela importação' : d.via === 'whatsapp' ? 'Contato criado por uma mensagem de WhatsApp' : 'Contato criado';
    case 'contact.updated': return d.via === 'import' ? 'Dados completados pela importação' : `Editou ${fieldNames(d.fields)}`;
    case 'contact.owner_changed': return 'Trocou o responsável';
    case 'contact.merged': return 'Mesclou um contato duplicado';
    case 'organization.created': return 'Organização criada';
    case 'organization.updated': return `Editou ${fieldNames(d.fields)}`;
    case 'note.added': return 'Adicionou uma nota';
    case 'file.added': return 'Anexou um arquivo';
    case 'file.removed': return 'Removeu um arquivo';
    case 'deal.created': return `Criou o negócio "${d.title ?? e.deal?.title ?? ''}"`;
    case 'deal.updated': return `Editou o negócio (${fieldNames(d.fields)})`;
    case 'deal.stage_changed': return `Moveu de ${d.fromStage} para ${d.toStage}`;
    case 'deal.won': return `Negócio ganho${d.fromStage ? ` (estava em ${d.fromStage})` : ''}`;
    case 'deal.lost': return 'Negócio perdido';
    case 'deal.items_updated': return 'Atualizou os produtos do negócio';
    case 'lead.created': return `Lead criado${d.source ? ` (origem: ${d.source})` : ''}`;
    case 'lead.assigned': return d.ruleId ? 'Lead distribuído pelo rodízio' : 'Lead atribuído';
    case 'lead.qualified': return 'Lead qualificado: virou negócio';
    case 'lead.disqualified': return 'Lead descartado';
    case 'lead.reopened': return 'Lead reaberto';
    case 'lead.updated': return 'Editou o lead';
    case 'activity.created': return `Agendou: ${d.title ?? ''}`;
    case 'activity.done': return `Concluiu: ${d.title ?? ''}`;
    case 'consent.recorded': return `${d.status === 'granted' ? 'Consentimento registrado' : 'Consentimento retirado'}: ${CHANNEL_LABEL[String(d.channel)] ?? d.channel}`;
    case 'attribution.recorded': return `Nova origem registrada${d.source ? `: ${d.source}` : ''}`;
    case 'message.received': return `Mensagem recebida (${CHANNEL_LABEL[String(d.channel)] ?? d.channel})`;
    case 'message.sent': return `Mensagem enviada (${CHANNEL_LABEL[String(d.channel)] ?? d.channel})`;
    case 'message.failed': return `Mensagem não enviada (${CHANNEL_LABEL[String(d.channel)] ?? d.channel})`;
    default: return e.kind;
  }
}

const FIELD_NAMES: Record<string, string> = {
  first_name: 'nome', last_name: 'sobrenome', job_title: 'cargo', organization_id: 'organização', tax_id: 'documento',
  birth_day: 'aniversário', birth_month: 'aniversário', birth_year: 'aniversário', address: 'endereço', owner_membership_id: 'responsável',
  team_id: 'equipe', custom: 'campos personalizados', emails: 'e-mails', phones: 'telefones', tags: 'etiquetas', name: 'nome',
  legal_name: 'razão social', domain: 'site', website: 'site', email: 'e-mail', phone: 'telefone', industry: 'segmento',
  title: 'título', value_cents: 'valor', currency: 'moeda', contact_id: 'contato', expected_close_date: 'previsão',
  participants: 'participantes',
};
function fieldNames(f: string | string[] | null | undefined): string {
  const list = Array.isArray(f) ? [...new Set(f.map((x) => FIELD_NAMES[x] ?? x))] : [];
  return list.length ? list.join(', ') : 'dados';
}
