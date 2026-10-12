import type { Q } from '../infra/db.js';
import { ROLE_TEMPLATES } from '../domain/permissions.js';

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
