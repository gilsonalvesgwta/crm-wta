// Primeira configuração: cria a empresa WTA, o superadministrador e os perfis
// padrão. Idempotente: pode rodar de novo sem duplicar nada e sem trocar a
// senha de quem já existe.
//
// Variáveis: ADMIN_DATABASE_URL (superusuário do banco do CRM), BOOTSTRAP_EMAIL,
// BOOTSTRAP_NAME, BOOTSTRAP_PASSWORD, BOOTSTRAP_TENANT_NAME, BOOTSTRAP_TENANT_SLUG.
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { passwordProblem } from '../domain/password-policy.js';
import { seedRoleTemplates } from '../platform/seed.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`defina ${name}`);
  return v;
}

export async function bootstrap(env = process.env): Promise<{ tenantId: string; userId: string }> {
  const url = env.ADMIN_DATABASE_URL ?? need('ADMIN_DATABASE_URL');
  const email = (env.BOOTSTRAP_EMAIL ?? need('BOOTSTRAP_EMAIL')).trim().toLowerCase();
  const name = env.BOOTSTRAP_NAME?.trim() || 'Administrador';
  const password = env.BOOTSTRAP_PASSWORD ?? need('BOOTSTRAP_PASSWORD');
  const tenantName = env.BOOTSTRAP_TENANT_NAME?.trim() || 'WTA Gestão e Automações';
  const slug = env.BOOTSTRAP_TENANT_SLUG?.trim() || 'wta';

  const client = new pg.Client({ connectionString: url, application_name: 'crm-bootstrap' });
  await client.connect();
  try {
    await client.query('begin');
    const t = await client.query<{ id: string }>(
      `insert into tenants (name, slug) values ($1, $2)
       on conflict (slug) do update set slug = excluded.slug
       returning id`, [tenantName, slug]);
    const tenantId = t.rows[0]!.id;
    await client.query(
      `insert into tenant_branding (tenant_id, theme) values ($1, '{}')
       on conflict (tenant_id) do nothing`, [tenantId]);
    const roles = await seedRoleTemplates(client, tenantId);

    const existing = await client.query<{ id: string }>('select id from users where email = $1', [email]);
    let userId = existing.rows[0]?.id;
    if (!userId) {
      const problem = passwordProblem(password, email);
      if (problem) throw new Error(`BOOTSTRAP_PASSWORD: ${problem}`);
      const h = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      const u = await client.query<{ id: string }>(
        'insert into users (email, name, password_hash, is_platform_admin) values ($1, $2, $3, true) returning id',
        [email, name, h]);
      userId = u.rows[0]!.id;
    } else {
      await client.query('update users set is_platform_admin = true where id = $1', [userId]);
    }

    const m = await client.query<{ id: string }>(
      `insert into memberships (tenant_id, user_id, status) values ($1, $2, 'active')
       on conflict (tenant_id, user_id) do update set status = 'active'
       returning id`, [tenantId, userId]);
    await client.query(
      `insert into membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)
       on conflict do nothing`, [tenantId, m.rows[0]!.id, roles.get('admin')]);
    await client.query(
      `insert into audit_log (tenant_id, actor_type, action, object_type, object_id)
       values ($1, 'system', 'platform.bootstrapped', 'user', $2)`, [tenantId, userId]);
    await client.query('commit');
    return { tenantId, userId };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap()
    .then((r) => console.log(`pronto: empresa ${r.tenantId}, superadministrador ${r.userId}`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
