import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { audit } from '../admin/audit.js';
import { newToken, tokenHash } from '../domain/secrets.js';
import { Problem } from '../http/problem.js';
import { Db } from '../infra/db.js';
import { assertFeature } from '../crm/limits.js';
import { memberJson } from '../crm/fields.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Chaves de API da empresa (n8n e outras integrações). A chave aparece uma vez só. */
@Injectable()
export class ApiKeysService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async list(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => (await q.query(
      `select k.id, k.name, k.prefix, k.created_at as "createdAt", k.last_used_at as "lastUsedAt", k.revoked_at as "revokedAt",
              k.expires_at as "expiresAt", ${memberJson('k.created_by')} as "createdBy"
         from api_keys k order by k.revoked_at nulls first, k.created_at desc`)).rows);
  }

  async create(actor: Actor, name: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await assertFeature(q, 'api_access');
      const prefix = Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('');
      const key = `crm_${prefix}_${newToken()}`;
      const r = await q.query<{ id: string }>(
        `insert into api_keys (tenant_id, name, prefix, key_hash, created_by) values (app.tenant_id(), $1, $2, $3, $4) returning id`,
        [name, prefix, tokenHash(key), actor.membershipId]);
      await audit(q, actor, 'api_key.created', 'api_key', r.rows[0]!.id, { name, prefix });
      return { id: r.rows[0]!.id, name, prefix, key };
    });
  }

  async revoke(actor: Actor, id: string): Promise<void> {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query('update api_keys set revoked_at = now() where id = $1 and revoked_at is null', [id]);
      if (!r.rowCount) throw Problem.notFound('Chave não encontrada.');
      await audit(q, actor, 'api_key.revoked', 'api_key', id);
    });
  }
}
