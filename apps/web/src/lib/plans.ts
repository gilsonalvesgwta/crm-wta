// Planos e assinatura: rótulos comuns às telas da empresa e da plataforma.

export const SUB_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  trial: { label: 'Em teste', tone: 'info' },
  active: { label: 'Ativa', tone: 'ok' },
  past_due: { label: 'Pagamento pendente', tone: 'warn' },
  canceled: { label: 'Cancelada', tone: 'warn' },
  expired: { label: 'Vencida', tone: 'bad' },
  inactive: { label: 'Inativa', tone: 'bad' },
};

export const PERIODS: Record<string, string> = {
  monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual', one_time: 'Pagamento único',
};

/** Limites do plano. Número vazio = sem limite; booleano = recurso incluído ou não. */
export const LIMITS: { key: string; label: string; kind: 'number' | 'bool' }[] = [
  { key: 'max_users', label: 'Usuários', kind: 'number' },
  { key: 'max_whatsapp', label: 'Números de WhatsApp', kind: 'number' },
  { key: 'max_email_accounts', label: 'Contas de e-mail', kind: 'number' },
  { key: 'max_automations', label: 'Automações ativas', kind: 'number' },
  { key: 'custom_domain', label: 'Domínio próprio', kind: 'bool' },
  { key: 'api_access', label: 'API e webhooks (n8n)', kind: 'bool' },
];

export function limitText(value: unknown): string {
  if (value === null || value === undefined) return 'Sem limite';
  if (value === true) return 'Incluído';
  if (value === false) return 'Não incluído';
  return String(value);
}

export function money(cents: number, currency = 'BRL'): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency });
}

export function dateBR(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
}
