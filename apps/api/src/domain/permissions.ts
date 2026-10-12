// Matriz de permissões: fonte única. Os perfis padrão de cada empresa são
// criados a partir daqui, os testes são gerados daqui e
// docs/PERMISSIONS_MATRIX.md descreve esta mesma tabela.

export type Scope = 'own' | 'team' | 'tenant';

export const PERMISSIONS = {
  'contacts:view': 'Ver contatos e organizações',
  'contacts:edit': 'Criar e editar contatos e organizações',
  'contacts:delete': 'Excluir e mesclar contatos',
  'contacts:import_export': 'Importar e exportar contatos',
  'leads:view': 'Ver leads',
  'leads:work': 'Trabalhar leads',
  'deals:view': 'Ver negócios',
  'deals:edit': 'Criar, editar e mover negócios',
  'deals:assign': 'Atribuir negócios e leads',
  'deals:delete': 'Excluir negócios',
  'deals:export': 'Exportar negócios',
  'products:admin': 'Administrar produtos e preços',
  'pipelines:admin': 'Configurar funis e etapas',
  'conversations:reply': 'Ver e responder conversas',
  'conversations:assign': 'Atribuir e transferir conversas',
  'conversations:take': 'Assumir conversas não atribuídas',
  'tasks:manage': 'Tarefas e agenda',
  'tickets:view': 'Ver tickets',
  'tickets:handle': 'Tratar tickets',
  'support:admin': 'Configurar SLA, categorias e estados',
  'scheduled:manage': 'Mensagens agendadas',
  'campaigns:view': 'Ver modelos, campanhas e segmentos',
  'campaigns:edit': 'Editar modelos, campanhas e segmentos',
  'campaigns:approve': 'Aprovar envio de campanhas',
  'automations:view': 'Ver automações',
  'automations:admin': 'Administrar automações',
  'reports:view': 'Ver relatórios e dashboards',
  'reports:export': 'Exportar relatórios',
  'goals:manage': 'Definir metas',
  'users:view': 'Ver usuários e equipes',
  'users:admin': 'Administrar usuários, equipes e perfis',
  'channels:view': 'Ver estado das contas conectadas',
  'channels:admin': 'Administrar contas conectadas e canais',
  'integrations:admin': 'Administrar chaves de API e webhooks',
  'settings:admin': 'Configurações e identidade visual da empresa',
  'audit:view': 'Ver auditoria',
  'privacy:execute': 'Exportar e anonimizar dados de um titular',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Ações administrativas: só com a verificação em duas etapas confirmada na sessão. */
export const REQUIRES_MFA: ReadonlySet<Permission> = new Set<Permission>([
  'users:admin',
  'settings:admin',
  'integrations:admin',
  'channels:admin',
  'privacy:execute',
]);

/** Permissões que não fazem sentido com alcance menor que a empresa. */
const TENANT_ONLY: ReadonlySet<Permission> = new Set<Permission>([
  'contacts:delete', 'contacts:import_export', 'deals:delete', 'deals:export', 'products:admin',
  'pipelines:admin', 'support:admin', 'campaigns:approve', 'automations:view', 'automations:admin',
  'reports:export', 'users:admin', 'channels:view', 'channels:admin', 'integrations:admin',
  'settings:admin', 'audit:view', 'privacy:execute',
]);

export function scopeAllowed(permission: Permission, scope: Scope): boolean {
  return TENANT_ONLY.has(permission) ? scope === 'tenant' : true;
}

export type RoleTemplate = {
  key: string;
  name: string;
  grants: Partial<Record<Permission, Scope>>;
};

const all = (scope: Scope, perms: Permission[]): Partial<Record<Permission, Scope>> =>
  Object.fromEntries(perms.map((p) => [p, scope]));

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: 'admin',
    name: 'Administrador',
    grants: all('tenant', ALL_PERMISSIONS.filter((p) => p !== 'users:view' && p !== 'channels:view' && p !== 'conversations:take')),
  },
  {
    key: 'manager',
    name: 'Gestor',
    grants: {
      ...all('tenant', [
        'contacts:view', 'contacts:edit', 'contacts:delete', 'contacts:import_export', 'leads:view', 'leads:work',
        'deals:view', 'deals:edit', 'deals:assign', 'deals:delete', 'deals:export', 'products:admin',
        'pipelines:admin', 'conversations:reply', 'conversations:assign', 'tasks:manage', 'tickets:view',
        'tickets:handle', 'support:admin', 'scheduled:manage', 'campaigns:view', 'campaigns:edit',
        'campaigns:approve', 'automations:view', 'automations:admin', 'reports:view', 'reports:export',
        'goals:manage', 'users:view', 'channels:view', 'audit:view',
      ]),
    },
  },
  {
    key: 'team_lead',
    name: 'Líder de equipe',
    grants: all('team', [
      'contacts:view', 'contacts:edit', 'leads:view', 'leads:work', 'deals:view', 'deals:edit', 'deals:assign',
      'conversations:reply', 'conversations:assign', 'tasks:manage', 'tickets:view', 'tickets:handle',
      'scheduled:manage', 'campaigns:view', 'reports:view', 'goals:manage', 'users:view',
    ]),
  },
  {
    key: 'sales',
    name: 'Comercial',
    grants: {
      ...all('own', [
        'contacts:view', 'contacts:edit', 'leads:view', 'leads:work', 'deals:view', 'deals:edit',
        'conversations:reply', 'tasks:manage', 'tickets:view', 'scheduled:manage', 'reports:view',
      ]),
      'conversations:take': 'team',
      'campaigns:view': 'tenant',
    },
  },
  {
    key: 'support',
    name: 'Suporte',
    grants: {
      ...all('team', ['contacts:view', 'conversations:reply', 'conversations:assign', 'tickets:view', 'tickets:handle', 'reports:view']),
      ...all('own', ['contacts:edit', 'tasks:manage', 'scheduled:manage']),
      'conversations:take': 'team',
      'campaigns:view': 'tenant',
    },
  },
  {
    key: 'marketing',
    name: 'Marketing',
    grants: {
      ...all('tenant', [
        'contacts:view', 'contacts:edit', 'contacts:import_export', 'leads:view', 'leads:work', 'deals:view',
        'scheduled:manage', 'campaigns:view', 'campaigns:edit', 'automations:view', 'reports:view',
        'reports:export',
      ]),
      'tasks:manage': 'own',
    },
  },
  {
    key: 'finance',
    name: 'Financeiro',
    grants: {
      ...all('tenant', ['contacts:view', 'deals:view', 'deals:export', 'products:admin', 'reports:view', 'reports:export']),
      'tasks:manage': 'own',
    },
  },
  {
    key: 'viewer',
    name: 'Visualizador',
    grants: all('tenant', ['contacts:view', 'leads:view', 'deals:view', 'reports:view']),
  },
];

const RANK: Record<Scope, number> = { own: 1, team: 2, tenant: 3 };

/** União das permissões de vários perfis: vale o maior alcance. */
export function mergeGrants(rows: { permission: string; scope: Scope }[]): Map<Permission, Scope> {
  const out = new Map<Permission, Scope>();
  for (const r of rows) {
    if (!(r.permission in PERMISSIONS)) continue;
    const p = r.permission as Permission;
    const cur = out.get(p);
    if (!cur || RANK[r.scope] > RANK[cur]) out.set(p, r.scope);
  }
  return out;
}

export function scopeCovers(granted: Scope | undefined, needed: Scope): boolean {
  return granted !== undefined && RANK[granted] >= RANK[needed];
}
