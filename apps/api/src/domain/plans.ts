// Limites de um plano. Número ausente ou nulo é ilimitado; recurso ausente é negado.

export type PlanLimits = {
  max_users?: number | null;
  max_whatsapp?: number | null;
  max_email_accounts?: number | null;
  max_automations?: number | null;
  custom_domain?: boolean;
  api_access?: boolean;
};

export const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  max_users: 'Usuários',
  max_whatsapp: 'Números de WhatsApp',
  max_email_accounts: 'Contas de e-mail',
  max_automations: 'Automações ativas',
  custom_domain: 'Domínio próprio',
  api_access: 'API e integração com o n8n',
};

export type NumericLimit = 'max_users' | 'max_whatsapp' | 'max_email_accounts' | 'max_automations';
export type FeatureLimit = 'custom_domain' | 'api_access';

/** Empresa sem plano (uso interno, como a WTA) não tem limite. */
export function allows(limits: PlanLimits | null, feature: FeatureLimit): boolean {
  return limits === null || limits[feature] === true;
}

export function within(limits: PlanLimits | null, key: NumericLimit, wouldHave: number): boolean {
  if (limits === null) return true;
  const max = limits[key];
  return max === undefined || max === null || wouldHave <= max;
}
