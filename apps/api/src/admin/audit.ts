import type { Q } from '../infra/db.js';
import type { Actor } from '../access/actor.js';

/** Registra ação sensível na auditoria, na mesma transação da mudança. */
export async function audit(
  q: Q, actor: Actor, action: string, objectType: string | null, objectId: string | null,
  detail: Record<string, unknown> = {}, opts: { tenantId?: string; actorType?: 'user' | 'platform' } = {},
): Promise<void> {
  await q.query(
    `insert into audit_log (tenant_id, actor_type, actor_id, action, object_type, object_id, detail)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [opts.tenantId ?? actor.tenantId, opts.actorType ?? 'user', actor.userId, action, objectType, objectId, JSON.stringify(detail)]);
}
