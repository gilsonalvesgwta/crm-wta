import { Inject, Injectable } from '@nestjs/common';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Problem } from '../http/problem.js';
import { ALL_PERMISSIONS, PERMISSIONS, scopeAllowed, type Permission, type Scope } from '../domain/permissions.js';
import { DEFAULT_THEME, buildTheme, type Theme } from '../domain/theme.js';
import { tenantCtx } from '../access/decorators.js';
import type { Actor } from '../access/actor.js';
import { AuthService } from '../auth/auth.service.js';
import { audit } from './audit.js';
import { CONFIG, type Config } from '../config.js';
import { assertWithin, seatsInUse, tenantBaseUrl } from '../crm/limits.js';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

/** Marca como a interface usa: tema validado, logotipo e ícone por endereço público. */
export function brandingView(row: { tenant_id: string; product_name: string | null; theme: Partial<Theme>; logo: string | null; icon: string | null } | null) {
  const built = row?.theme?.primary ? buildTheme({ primary: row.theme.primary, mode: row.theme.mode, sidebar: row.theme.sidebar }) : null;
  const theme = built && 'theme' in built ? built.theme : DEFAULT_THEME;
  const url = (kind: string, file: string | null) => (row && file ? `/api/v1/public/branding/${row.tenant_id}/${kind}/${file}` : null);
  return {
    productName: row?.product_name ?? 'CRM WTA',
    theme,
    customized: !!row?.theme?.primary,
    logoUrl: url('logo', row?.logo ?? null),
    iconUrl: url('icon', row?.icon ?? null),
  };
}

export type MemberRow = {
  membershipId: string; userId: string; name: string; email: string; status: string;
  lastLoginAt: Date | null; totpEnabled: boolean; roles: { id: string; name: string }[]; teams: { id: string; name: string }[];
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  // ---- Empresa ---------------------------------------------------------------

  async tenant(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ id: string; name: string; slug: string; status: string; timezone: string; locale: string }>(
        'select id, name, slug, status, timezone, locale from tenants');
      return r.rows[0]!;
    });
  }

  async updateTenant(actor: Actor, patch: { name?: string; timezone?: string; locale?: string }) {
    if (patch.timezone && !TIMEZONES.has(patch.timezone)) {
      throw Problem.badRequest('Fuso horário desconhecido.', [{ field: 'timezone', message: 'Escolha um fuso da lista.' }]);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      const before = (await q.query('select name, timezone, locale from tenants')).rows[0]!;
      const r = await q.query<{ id: string; name: string; slug: string; status: string; timezone: string; locale: string }>(
        `update tenants set name = coalesce($1, name), timezone = coalesce($2, timezone), locale = coalesce($3, locale)
         where id = app.tenant_id() returning id, name, slug, status, timezone, locale`,
        [patch.name ?? null, patch.timezone ?? null, patch.locale ?? null]);
      await audit(q, actor, 'tenant.updated', 'tenant', actor.tenantId, { before, after: patch });
      return r.rows[0]!;
    });
  }

  // ---- Identidade visual -----------------------------------------------------

  async branding(actor: Actor) {
    return this.db.app(tenantCtx(actor), (q) => this.readBranding(q));
  }

  private async readBranding(q: Q) {
    const r = await q.query<{ tenant_id: string; product_name: string | null; theme: Partial<Theme>; logo: string | null; icon: string | null }>(
      'select tenant_id, product_name, theme, logo_file_key as logo, logo_compact_file_key as icon from tenant_branding');
    const row = r.rows[0];
    return brandingView(row ?? null);
  }

  async updateBranding(actor: Actor, input: { productName: string; primary: string; mode: 'light' | 'dark'; sidebar?: string | null }) {
    const built = buildTheme({ primary: input.primary, mode: input.mode, sidebar: input.sidebar });
    if ('problems' in built) throw Problem.badRequest('Ajuste as cores.', built.problems);
    return this.db.app(tenantCtx(actor), async (q) => {
      await q.query(
        `insert into tenant_branding (tenant_id, product_name, theme, updated_by)
         values (app.tenant_id(), $1, $2, $3)
         on conflict (tenant_id) do update
           set previous_theme = tenant_branding.theme, product_name = excluded.product_name,
               theme = excluded.theme, updated_by = excluded.updated_by`,
        [input.productName, JSON.stringify(built.theme), actor.userId]);
      await audit(q, actor, 'branding.updated', 'tenant', actor.tenantId, { primary: built.theme.primary, mode: built.theme.mode });
      return this.readBranding(q);
    });
  }

  async resetBranding(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await q.query(
        `update tenant_branding set previous_theme = theme, theme = '{}'::jsonb, product_name = null, updated_by = $1`, [actor.userId]);
      await audit(q, actor, 'branding.reset', 'tenant', actor.tenantId);
      return this.readBranding(q);
    });
  }

  // ---- Usuários --------------------------------------------------------------

  async members(actor: Actor): Promise<MemberRow[]> {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{
        membership_id: string; user_id: string; name: string; email: string; status: string;
        last_login_at: Date | null; totp_enabled_at: Date | null; roles: { id: string; name: string }[] | null; teams: { id: string; name: string }[] | null;
      }>(
        `select m.id as membership_id, u.id as user_id, u.name, u.email, m.status, u.last_login_at, u.totp_enabled_at,
                (select json_agg(json_build_object('id', r.id, 'name', r.name) order by r.name)
                   from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = m.id) as roles,
                (select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name)
                   from team_members tm join teams t on t.id = tm.team_id where tm.membership_id = m.id) as teams
           from memberships m
           join users u on u.id = m.user_id
          order by m.status = 'active' desc, u.name`);
      return r.rows.map((x) => ({
        membershipId: x.membership_id, userId: x.user_id, name: x.name, email: x.email, status: x.status,
        lastLoginAt: x.last_login_at, totpEnabled: x.totp_enabled_at !== null, roles: x.roles ?? [], teams: x.teams ?? [],
      }));
    });
  }

  /** Quantos vínculos ativos, fora o informado, ainda administram usuários. */
  private async otherAdmins(q: Q, exceptMembership: string): Promise<number> {
    const r = await q.query<{ n: number }>(
      `select count(distinct m.id)::int as n
         from memberships m
         join membership_roles mr on mr.membership_id = m.id
         join role_permissions rp on rp.role_id = mr.role_id and rp.permission = 'users:admin'
        where m.status = 'active' and m.id <> $1`, [exceptMembership]);
    return r.rows[0]!.n;
  }

  async updateMember(actor: Actor, membershipId: string, patch: { status?: 'active' | 'disabled'; roleIds?: string[] }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const m = await q.query<{ id: string; user_id: string; status: string }>('select id, user_id, status from memberships where id = $1 for update', [membershipId]);
      const row = m.rows[0];
      if (!row) throw Problem.notFound('Usuário não encontrado.');
      if (row.id === actor.membershipId && patch.status === 'disabled') {
        throw Problem.conflict('Você não pode desativar o próprio acesso.');
      }
      if (patch.roleIds) {
        const ids = [...new Set(patch.roleIds)];
        if (ids.length === 0) throw Problem.badRequest('Escolha pelo menos um perfil.', [{ field: 'roleIds', message: 'Escolha pelo menos um perfil.' }]);
        const found = await q.query<{ id: string }>('select id from roles where id = any($1::uuid[])', [ids]);
        if (found.rowCount !== ids.length) throw Problem.badRequest('Perfil desconhecido.', [{ field: 'roleIds', message: 'Perfil desconhecido.' }]);
        await q.query('delete from membership_roles where membership_id = $1', [membershipId]);
        for (const id of ids) {
          await q.query('insert into membership_roles (tenant_id, membership_id, role_id) values (app.tenant_id(), $1, $2)', [membershipId, id]);
        }
      }
      if (patch.status) {
        if (patch.status === 'active' && row.status !== 'active') await assertWithin(q, 'max_users', (await seatsInUse(q)) + 1);
        await q.query('update memberships set status = $1 where id = $2', [patch.status, membershipId]);
      }
      // Regra: a empresa nunca fica sem quem administre usuários.
      const stillAdmin = await q.query<{ ok: boolean }>(
        `select exists (select 1 from memberships m join membership_roles mr on mr.membership_id = m.id
           join role_permissions rp on rp.role_id = mr.role_id and rp.permission = 'users:admin'
          where m.id = $1 and m.status = 'active') as ok`, [membershipId]);
      if (!stillAdmin.rows[0]!.ok && (await this.otherAdmins(q, membershipId)) === 0) {
        throw Problem.conflict('A empresa precisa de pelo menos um administrador ativo.');
      }
      await audit(q, actor, 'membership.updated', 'membership', membershipId, { userId: row.user_id, ...patch });
    }).then(() => this.members(actor)).then((all) => all.find((x) => x.membershipId === membershipId)!);
  }

  // ---- Convites --------------------------------------------------------------

  async invitations(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ id: string; email: string; role_name: string | null; expires_at: Date; created_at: Date; inviter: string | null }>(
        `select i.id, i.email, r.name as role_name, i.expires_at, i.created_at, u.name as inviter
           from invitations i
           left join roles r on r.id = i.role_id
           left join memberships m on m.id = i.invited_by
           left join users u on u.id = m.user_id
          where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
          order by i.created_at desc`);
      return r.rows.map((x) => ({ id: x.id, email: x.email, roleName: x.role_name, expiresAt: x.expires_at, createdAt: x.created_at, invitedBy: x.inviter }));
    });
  }

  async invite(actor: Actor, email: string, roleId: string) {
    const out = await this.db.app(tenantCtx(actor), async (q) => {
      const role = await q.query<{ id: string }>('select id from roles where id = $1', [roleId]);
      if (!role.rowCount) throw Problem.badRequest('Perfil desconhecido.', [{ field: 'roleId', message: 'Escolha um perfil.' }]);
      const already = await q.query(`select 1 from memberships m join users u on u.id = m.user_id where u.email = $1 and m.status = 'active'`, [email]);
      if (already.rowCount) throw Problem.conflict('Essa pessoa já tem acesso a esta empresa.');
      await q.query(`update invitations set revoked_at = now() where email = $1 and accepted_at is null and revoked_at is null`, [email]);
      const hasMembership = await q.query(`select 1 from memberships m join users u on u.id = m.user_id where u.email = $1 and m.status = 'invited'`, [email]);
      if (!hasMembership.rowCount) await assertWithin(q, 'max_users', (await seatsInUse(q)) + 1);
      const inv = await this.auth.createInvitation(q, actor.tenantId!, email, roleId, actor.membershipId);
      const t = await q.query<{ name: string }>('select name from tenants');
      await audit(q, actor, 'invitation.created', 'invitation', inv.id, { email, roleId });
      return { ...inv, tenantName: t.rows[0]!.name, baseUrl: await tenantBaseUrl(q, this.cfg.APP_URL) };
    });
    await this.auth.sendInvitation(email, out.tenantName, actor.name, out.token, out.baseUrl);
    return { id: out.id, email, expiresAt: out.expiresAt };
  }

  async resendInvitation(actor: Actor, id: string) {
    const r = await this.db.app(tenantCtx(actor), async (q) => {
      const cur = await q.query<{ email: string; role_id: string | null }>(
        'select email, role_id from invitations where id = $1 and accepted_at is null and revoked_at is null for update', [id]);
      const row = cur.rows[0];
      if (!row) throw Problem.notFound('Convite não encontrado.');
      await q.query('update invitations set revoked_at = now() where id = $1', [id]);
      const inv = await this.auth.createInvitation(q, actor.tenantId!, row.email, row.role_id, actor.membershipId);
      const t = await q.query<{ name: string }>('select name from tenants');
      await audit(q, actor, 'invitation.resent', 'invitation', inv.id, { email: row.email, replaces: id });
      return { ...inv, email: row.email, tenantName: t.rows[0]!.name, baseUrl: await tenantBaseUrl(q, this.cfg.APP_URL) };
    });
    await this.auth.sendInvitation(r.email, r.tenantName, actor.name, r.token, r.baseUrl);
    return { id: r.id, email: r.email, expiresAt: r.expiresAt };
  }

  async revokeInvitation(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query('update invitations set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null', [id]);
      if (!r.rowCount) throw Problem.notFound('Convite não encontrado.');
      await audit(q, actor, 'invitation.revoked', 'invitation', id);
    });
  }

  // ---- Equipes ---------------------------------------------------------------

  async teams(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ id: string; name: string; members: { membershipId: string; name: string; role: string }[] | null }>(
        `select t.id, t.name,
                (select json_agg(json_build_object('membershipId', tm.membership_id, 'name', u.name, 'role', tm.role) order by tm.role, u.name)
                   from team_members tm join memberships m on m.id = tm.membership_id join users u on u.id = m.user_id
                  where tm.team_id = t.id) as members
           from teams t order by t.name`);
      return r.rows.map((t) => ({ id: t.id, name: t.name, members: t.members ?? [] }));
    });
  }

  async createTeam(actor: Actor, name: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      try {
        const r = await q.query<{ id: string }>('insert into teams (tenant_id, name) values (app.tenant_id(), $1) returning id', [name]);
        await audit(q, actor, 'team.created', 'team', r.rows[0]!.id, { name });
        return { id: r.rows[0]!.id, name, members: [] };
      } catch (e) {
        if (pgCode(e) === '23505') throw Problem.conflict('Já existe uma equipe com esse nome.');
        throw e;
      }
    });
  }

  async updateTeam(actor: Actor, id: string, patch: { name?: string; members?: { membershipId: string; role: 'leader' | 'member' }[] }) {
    await this.db.app(tenantCtx(actor), async (q) => {
      const t = await q.query('select 1 from teams where id = $1 for update', [id]);
      if (!t.rowCount) throw Problem.notFound('Equipe não encontrada.');
      if (patch.name) {
        try {
          await q.query('update teams set name = $1 where id = $2', [patch.name, id]);
        } catch (e) {
          if (pgCode(e) === '23505') throw Problem.conflict('Já existe uma equipe com esse nome.');
          throw e;
        }
      }
      if (patch.members) {
        await q.query('delete from team_members where team_id = $1', [id]);
        for (const m of patch.members) {
          try {
            await q.query('insert into team_members (tenant_id, team_id, membership_id, role) values (app.tenant_id(), $1, $2, $3)', [id, m.membershipId, m.role]);
          } catch (e) {
            if (pgCode(e) === '23503') throw Problem.badRequest('Usuário desconhecido na equipe.', [{ field: 'members', message: 'Usuário desconhecido.' }]);
            if (pgCode(e) === '23505') throw Problem.badRequest('Usuário repetido na equipe.', [{ field: 'members', message: 'Usuário repetido.' }]);
            throw e;
          }
        }
      }
      await audit(q, actor, 'team.updated', 'team', id, { name: patch.name, members: patch.members?.length });
    });
    return (await this.teams(actor)).find((t) => t.id === id)!;
  }

  async deleteTeam(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ name: string }>('delete from teams where id = $1 returning name', [id]);
      if (!r.rowCount) throw Problem.notFound('Equipe não encontrada.');
      await audit(q, actor, 'team.deleted', 'team', id, { name: r.rows[0]!.name });
    });
  }

  // ---- Perfis e permissões ---------------------------------------------------

  catalog() {
    return ALL_PERMISSIONS.map((p) => ({
      key: p, label: PERMISSIONS[p], scopes: (['own', 'team', 'tenant'] as Scope[]).filter((s) => scopeAllowed(p, s)),
    }));
  }

  async roles(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ id: string; key: string; name: string; is_system: boolean; grants: Record<string, Scope> | null; members: number }>(
        `select r.id, r.key, r.name, r.is_system,
                (select json_object_agg(rp.permission, rp.scope) from role_permissions rp where rp.role_id = r.id) as grants,
                (select count(*)::int from membership_roles mr join memberships m on m.id = mr.membership_id
                  where mr.role_id = r.id and m.status = 'active') as members
           from roles r
          order by r.is_system desc, r.created_at, r.name`);
      return r.rows.map((x) => ({ id: x.id, key: x.key, name: x.name, isSystem: x.is_system, grants: x.grants ?? {}, members: x.members }));
    });
  }

  private checkGrants(grants: Record<string, string>): [Permission, Scope][] {
    const out: [Permission, Scope][] = [];
    for (const [p, s] of Object.entries(grants)) {
      if (!(p in PERMISSIONS)) throw Problem.badRequest(`Permissão desconhecida: ${p}.`, [{ field: `grants.${p}`, message: 'Permissão desconhecida.' }]);
      if (!['own', 'team', 'tenant'].includes(s) || !scopeAllowed(p as Permission, s as Scope)) {
        throw Problem.badRequest('Alcance não permitido para esta permissão.', [{ field: `grants.${p}`, message: 'Alcance não permitido.' }]);
      }
      out.push([p as Permission, s as Scope]);
    }
    return out;
  }

  async createRole(actor: Actor, name: string, grants: Record<string, string>) {
    const list = this.checkGrants(grants);
    const id = await this.db.app(tenantCtx(actor), async (q) => {
      const key = 'custom_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
      let roleId: string;
      try {
        const r = await q.query<{ id: string }>('insert into roles (tenant_id, key, name) values (app.tenant_id(), $1, $2) returning id', [key, name]);
        roleId = r.rows[0]!.id;
      } catch (e) {
        if (pgCode(e) === '23505') throw Problem.conflict('Já existe um perfil com esse nome.');
        throw e;
      }
      for (const [p, s] of list) {
        await q.query('insert into role_permissions (tenant_id, role_id, permission, scope) values (app.tenant_id(), $1, $2, $3)', [roleId, p, s]);
      }
      await audit(q, actor, 'role.created', 'role', roleId, { name, grants });
      return roleId;
    });
    return (await this.roles(actor)).find((r) => r.id === id)!;
  }

  async updateRole(actor: Actor, id: string, patch: { name?: string; grants?: Record<string, string> }) {
    const list = patch.grants ? this.checkGrants(patch.grants) : null;
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ key: string }>('select key from roles where id = $1 for update', [id]);
      const role = r.rows[0];
      if (!role) throw Problem.notFound('Perfil não encontrado.');
      if (role.key === 'admin') throw Problem.conflict('O perfil Administrador não pode ser alterado.');
      if (patch.name) {
        try {
          await q.query('update roles set name = $1 where id = $2', [patch.name, id]);
        } catch (e) {
          if (pgCode(e) === '23505') throw Problem.conflict('Já existe um perfil com esse nome.');
          throw e;
        }
      }
      if (list) {
        await q.query('delete from role_permissions where role_id = $1', [id]);
        for (const [p, s] of list) {
          await q.query('insert into role_permissions (tenant_id, role_id, permission, scope) values (app.tenant_id(), $1, $2, $3)', [id, p, s]);
        }
        const left = await q.query<{ n: number }>(
          `select count(distinct m.id)::int as n from memberships m join membership_roles mr on mr.membership_id = m.id
             join role_permissions rp on rp.role_id = mr.role_id and rp.permission = 'users:admin' where m.status = 'active'`);
        if (left.rows[0]!.n === 0) throw Problem.conflict('A empresa precisa de pelo menos um administrador ativo.');
      }
      await audit(q, actor, 'role.updated', 'role', id, { name: patch.name, grants: patch.grants });
    });
    return (await this.roles(actor)).find((r) => r.id === id)!;
  }

  async deleteRole(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ is_system: boolean; name: string }>('select is_system, name from roles where id = $1', [id]);
      const role = r.rows[0];
      if (!role) throw Problem.notFound('Perfil não encontrado.');
      if (role.is_system) throw Problem.conflict('Perfis padrão não podem ser excluídos.');
      const used = await q.query('select 1 from membership_roles where role_id = $1 limit 1', [id]);
      if (used.rowCount) throw Problem.conflict('Há usuários com este perfil. Troque o perfil deles antes de excluir.');
      await q.query('update invitations set role_id = null where role_id = $1', [id]);
      await q.query('delete from roles where id = $1', [id]);
      await audit(q, actor, 'role.deleted', 'role', id, { name: role.name });
    });
  }

  // ---- Auditoria -------------------------------------------------------------

  async auditLog(actor: Actor, opts: { before?: Date; limit: number; action?: string }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query<{ id: string; occurred_at: Date; actor_type: string; actor_name: string | null; action: string; object_type: string | null; object_id: string | null; detail: object }>(
        `select a.id, a.occurred_at, a.actor_type, u.name as actor_name, a.action, a.object_type, a.object_id, a.detail
           from audit_log a
           left join users u on u.id = a.actor_id
          where ($1::timestamptz is null or a.occurred_at < $1)
            and ($2::text is null or a.action like $2 || '%')
          order by a.occurred_at desc
          limit $3`, [opts.before ?? null, opts.action ?? null, opts.limit + 1]);
      const items = r.rows.slice(0, opts.limit).map((x) => ({
        id: x.id, occurredAt: x.occurred_at, actorType: x.actor_type, actorName: x.actor_name, action: x.action,
        objectType: x.object_type, objectId: x.object_id, detail: x.detail,
      }));
      const more = r.rows.length > opts.limit;
      return { items, nextCursor: more ? items[items.length - 1]!.occurredAt.toISOString() : null };
    });
  }
}
