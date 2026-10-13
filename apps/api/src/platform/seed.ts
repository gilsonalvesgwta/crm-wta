import type { Q } from '../infra/db.js';
import { ROLE_TEMPLATES } from '../domain/permissions.js';
import { DEFAULT_STAGES } from '../crm/pipelines.service.js';

/**
 * Cria os perfis padrão de uma empresa a partir da matriz. Idempotente: perfil
 * existente não é alterado, para não desfazer o que a empresa ajustou.
 */
export async function seedRoleTemplates(q: Q, tenantId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const t of ROLE_TEMPLATES) {
    const r = await q.query<{ id: string; created: boolean }>(
      `with ins as (
         insert into roles (tenant_id, key, name, is_system) values ($1, $2, $3, true)
         on conflict (tenant_id, key) do nothing
         returning id
       )
       select id, true as created from ins
       union all
       select id, false from roles where tenant_id = $1 and key = $2 and not exists (select 1 from ins)`,
      [tenantId, t.key, t.name]);
    const row = r.rows[0]!;
    ids.set(t.key, row.id);
    if (row.created) {
      for (const [permission, scope] of Object.entries(t.grants)) {
        await q.query('insert into role_permissions (tenant_id, role_id, permission, scope) values ($1, $2, $3, $4)',
          [tenantId, row.id, permission, scope]);
      }
    }
  }
  return ids;
}

const DEFAULT_LOST_REASONS = ['Preço', 'Escolheu um concorrente', 'Sem resposta', 'Sem orçamento', 'Fora do perfil'];

/**
 * Ponto de partida do CRM de uma empresa nova: um funil "Vendas" com as etapas
 * padrão e motivos de perda comuns. Só cria o que ainda não existe.
 */
export async function seedCrmDefaults(q: Q, tenantId: string): Promise<void> {
  const has = await q.query('select 1 from pipelines where tenant_id = $1 limit 1', [tenantId]);
  if (!has.rowCount) {
    const p = await q.query<{ id: string }>(
      "insert into pipelines (tenant_id, name, position) values ($1, 'Vendas', 0) returning id", [tenantId]);
    for (const [i, s] of DEFAULT_STAGES.entries()) {
      await q.query(
        `insert into pipeline_stages (tenant_id, pipeline_id, name, position, color, probability, kind, required_fields)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, p.rows[0]!.id, s.name, i, s.color, s.probability, s.kind, s.requiredFields ?? []]);
    }
  }
  const reasons = await q.query('select 1 from outcome_reasons where tenant_id = $1 limit 1', [tenantId]);
  if (!reasons.rowCount) {
    for (const [i, name] of DEFAULT_LOST_REASONS.entries()) {
      await q.query("insert into outcome_reasons (tenant_id, kind, name, position) values ($1, 'lost', $2, $3)", [tenantId, name, i]);
    }
  }
}
