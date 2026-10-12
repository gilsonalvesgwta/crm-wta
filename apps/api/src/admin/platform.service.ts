import { Inject, Injectable } from '@nestjs/common';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Problem } from '../http/problem.js';
import type { Actor } from '../access/actor.js';
import { AuthService } from '../auth/auth.service.js';
import { seedRoleTemplates } from '../platform/seed.js';
import { audit } from './audit.js';

type TenantRow = { id: string; name: string; slug: string; status: string; created_at: Date };

/**
 * Administração da plataforma. Roda como crm_platform, que vê só a tabela de
 * empresas. Para preparar uma empresa nova, a transação troca para crm_app no
 * contexto dela: a plataforma não ganha leitura dos dados de clientes.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private async asTenant(q: Q, tenantId: string, actor: Actor) {
    await q.query('set local role crm_app');
    await q.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenantId, actor.userId]);
  }

  async list(actor: Actor) {
    return this.db.platform(actor.userId, async (q) => {
      const r = await q.query<TenantRow>('select id, name, slug, status, created_at from tenants order by name');
      return r.rows.map((t) => ({ id: t.id, name: t.name, slug: t.slug, status: t.status, createdAt: t.created_at }));
    });
  }

  async create(actor: Actor, input: { name: string; slug: string; adminEmail: string }) {
    const out = await this.db.platform(actor.userId, async (q) => {
      let tenant: TenantRow;
      try {
        const r = await q.query<TenantRow>(
          'insert into tenants (name, slug) values ($1, $2) returning id, name, slug, status, created_at', [input.name, input.slug]);
        tenant = r.rows[0]!;
      } catch (e) {
        if (pgCode(e) === '23505') throw Problem.conflict('Já existe uma empresa com esse identificador.');
        throw e;
      }
      await this.asTenant(q, tenant.id, actor);
      const roles = await seedRoleTemplates(q, tenant.id);
      await q.query('insert into tenant_branding (tenant_id, theme) values ($1, $2)', [tenant.id, JSON.stringify({})]);
      const inv = await this.auth.createInvitation(q, tenant.id, input.adminEmail, roles.get('admin')!, null);
      await audit(q, actor, 'tenant.created', 'tenant', tenant.id, { name: input.name, slug: input.slug, adminEmail: input.adminEmail },
        { tenantId: tenant.id, actorType: 'platform' });
      return { tenant, token: inv.token };
    });
    await this.auth.sendInvitation(input.adminEmail, out.tenant.name, actor.name, out.token);
    return { id: out.tenant.id, name: out.tenant.name, slug: out.tenant.slug, status: out.tenant.status, createdAt: out.tenant.created_at };
  }

  async setStatus(actor: Actor, id: string, status: 'active' | 'suspended' | 'archived') {
    return this.db.platform(actor.userId, async (q) => {
      const r = await q.query<TenantRow>(
        'update tenants set status = $1 where id = $2 returning id, name, slug, status, created_at', [status, id]);
      const t = r.rows[0];
      if (!t) throw Problem.notFound('Empresa não encontrada.');
      await this.asTenant(q, id, actor);
      await audit(q, actor, `tenant.${status === 'active' ? 'activated' : status}`, 'tenant', id, {}, { tenantId: id, actorType: 'platform' });
      return { id: t.id, name: t.name, slug: t.slug, status: t.status, createdAt: t.created_at };
    });
  }
}
