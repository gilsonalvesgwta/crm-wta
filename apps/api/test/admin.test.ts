import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import type { MemoryMailer } from '../src/infra/mailer.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, tokenFromMail, type Fixture } from './helpers.js';

let f: Fixture;
let app: NestFastifyApplication;
let mailer: MemoryMailer;
let ip = 0;

/** Entra e ativa a verificação em duas etapas, deixando a sessão confirmada. */
async function withMfa(email: string): Promise<Browser> {
  const b = new Browser(app, `10.20.0.${++ip}`);
  const r = await b.login(email);
  assert.equal(r.status, 200, `login de ${email}`);
  const s = await b.post('/api/v1/auth/mfa/setup');
  assert.equal(s.status, 200);
  const e = await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) });
  assert.equal(e.status, 200);
  return b;
}

async function plain(email: string): Promise<Browser> {
  const b = new Browser(app, `10.20.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  return b;
}

let adminA: Browser;
let adminB: Browser;
let sales: Browser;

before(async () => {
  f = await createDatabase();
  ({ app, mailer } = await startApi(f));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'admin2@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'gestor@a.test', [{ tenant: f.tenantA, role: 'manager' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  await createUser(f, 'dono@plataforma.test', [{ tenant: f.tenantA, role: 'viewer' }], { platformAdmin: true });
  adminA = await withMfa('admin@a.test');
  adminB = await withMfa('admin@b.test');
  sales = await plain('vendas@a.test');
});

after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

const membershipOf = async (email: string, tenant: string) =>
  (await f.admin.query<{ id: string }>(
    'select m.id from memberships m join users u on u.id = m.user_id where u.email = $1 and m.tenant_id = $2', [email, tenant])).rows[0]!.id;

describe('acesso às rotas de administração', () => {
  test('administrador sem 2FA é barrado com explicação', async () => {
    const b = await plain('admin2@a.test');
    const r = await b.get('/api/v1/members');
    assert.equal(r.status, 403);
    assert.equal(r.body.type, 'mfa-required');
  });

  test('vendedor não administra usuários, mas lê os dados da empresa', async () => {
    assert.equal((await sales.get('/api/v1/members')).status, 403);
    assert.equal((await sales.get('/api/v1/roles')).status, 403);
    assert.equal((await sales.get('/api/v1/audit')).status, 403);
    const t = await sales.get('/api/v1/tenant');
    assert.equal(t.status, 200);
    assert.equal(t.body.name, 'Empresa A');
  });

  test('gestor vê auditoria mas não administra usuários', async () => {
    const g = await plain('gestor@a.test');
    assert.equal((await g.get('/api/v1/audit')).status, 200);
    assert.equal((await g.get('/api/v1/members')).status, 403);
  });
});

describe('empresa e identidade visual', () => {
  test('fuso inválido é recusado; válido é salvo e auditado', async () => {
    const bad = await adminA.req('PATCH', '/api/v1/tenant', { timezone: 'America/Lugar_Nenhum' });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.errors[0].field, 'timezone');
    const ok = await adminA.req('PATCH', '/api/v1/tenant', { name: 'Empresa A Ltda', timezone: 'America/Manaus' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.timezone, 'America/Manaus');
    const a = await f.admin.query("select count(*)::int as n from audit_log where action = 'tenant.updated' and tenant_id = $1", [f.tenantA]);
    assert.equal(a.rows[0].n, 1);
  });

  test('vendedor não altera a empresa', async () => {
    assert.equal((await sales.req('PATCH', '/api/v1/tenant', { name: 'Invasão' })).status, 403);
  });

  test('cor sem contraste é recusada; cor válida gera o tema e só vale para a empresa', async () => {
    const bad = await adminA.req('PUT', '/api/v1/branding', { productName: 'CRM A', primary: '#F5F5F5' });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.errors[0].field, 'primary');

    const ok = await adminA.req('PUT', '/api/v1/branding', { productName: 'CRM A', primary: '#0F766E', mode: 'dark' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.theme.primary, '#0F766E');
    assert.equal(ok.body.theme.primaryForeground, '#FFFFFF');
    assert.equal(ok.body.theme.mode, 'dark');

    assert.equal((await sales.get('/api/v1/branding')).body.theme.primary, '#0F766E', 'quem é da A vê o tema novo');
    const b = await adminB.get('/api/v1/branding');
    assert.equal(b.body.theme.primary, '#FF6600', 'a B continua com o padrão');
    assert.equal(b.body.customized, false);

    const reset = await adminA.post('/api/v1/branding/reset');
    assert.equal(reset.body.theme.primary, '#FF6600');
    const prev = await f.admin.query('select previous_theme from tenant_branding where tenant_id = $1', [f.tenantA]);
    assert.equal(prev.rows[0].previous_theme.primary, '#0F766E', 'a versão anterior fica guardada');
  });
});

describe('convites', () => {
  let inviteId: string;

  test('convidar envia e-mail e aparece na lista', async () => {
    const roles = await adminA.get('/api/v1/roles');
    const sup = roles.body.items.find((r: { key: string }) => r.key === 'support');
    const r = await adminA.post('/api/v1/invitations', { email: 'Novo.Suporte@A.test', roleId: sup.id });
    assert.equal(r.status, 201);
    inviteId = r.body.id;
    const mail = mailer.sent.at(-1)!;
    assert.equal(mail.to, 'novo.suporte@a.test');
    assert.match(mail.text, /admin convidou você para usar o CRM WTA na empresa Empresa A Ltda/);
    const list = await adminA.get('/api/v1/invitations');
    assert.equal(list.body.items[0].email, 'novo.suporte@a.test');
    assert.equal(list.body.items[0].roleName, 'Suporte');
  });

  test('reenviar invalida o link anterior', async () => {
    const old = tokenFromMail(mailer.sent.at(-1)!.text);
    const r = await adminA.post(`/api/v1/invitations/${inviteId}/resend`);
    assert.equal(r.status, 200);
    const fresh = tokenFromMail(mailer.sent.at(-1)!.text);
    assert.notEqual(fresh, old);
    const anon = new Browser(app);
    assert.equal((await anon.get(`/api/v1/auth/invitations/${old}`)).status, 404);
    assert.equal((await anon.get(`/api/v1/auth/invitations/${fresh}`)).status, 200);
    inviteId = r.body.id;
  });

  test('aceitar o convite cria a pessoa com o perfil escolhido', async () => {
    const token = tokenFromMail(mailer.sent.at(-1)!.text);
    const b = new Browser(app, '10.21.0.1');
    const r = await b.post('/api/v1/auth/invitations/accept', { token, name: 'Novo Suporte', password: 'senha comprida de teste' });
    assert.equal(r.status, 200);
    await b.login('novo.suporte@a.test', 'senha comprida de teste');
    const me = await b.get('/api/v1/auth/me');
    assert.equal(me.body.permissions['tickets:handle'], 'team');
  });

  test('não convida quem já tem acesso', async () => {
    const roles = await adminA.get('/api/v1/roles');
    const r = await adminA.post('/api/v1/invitations', { email: 'vendas@a.test', roleId: roles.body.items[0].id });
    assert.equal(r.status, 409);
  });

  test('cancelar convite', async () => {
    const roles = await adminA.get('/api/v1/roles');
    const r = await adminA.post('/api/v1/invitations', { email: 'cancelado@a.test', roleId: roles.body.items[0].id });
    const token = tokenFromMail(mailer.sent.at(-1)!.text);
    assert.equal((await adminA.del(`/api/v1/invitations/${r.body.id}`)).status, 204);
    assert.equal((await new Browser(app).get(`/api/v1/auth/invitations/${token}`)).status, 404);
    assert.equal((await adminA.del(`/api/v1/invitations/${r.body.id}`)).status, 404);
  });

  test('perfil de outra empresa não serve para convite', async () => {
    const rolesB = await adminB.get('/api/v1/roles');
    const r = await adminA.post('/api/v1/invitations', { email: 'x@a.test', roleId: rolesB.body.items[0].id });
    assert.equal(r.status, 422);
  });
});

describe('usuários', () => {
  test('a lista mostra perfis e situação da verificação', async () => {
    const r = await adminA.get('/api/v1/members');
    assert.equal(r.status, 200);
    const admin = r.body.items.find((m: { email: string }) => m.email === 'admin@a.test');
    assert.equal(admin.totpEnabled, true);
    assert.deepEqual(admin.roles.map((x: { name: string }) => x.name), ['Administrador']);
    assert.ok(!r.body.items.some((m: { email: string }) => m.email === 'admin@b.test'), 'ninguém da B aparece');
  });

  test('ninguém desativa o próprio acesso', async () => {
    const r = await adminA.req('PATCH', `/api/v1/members/${await membershipOf('admin@a.test', f.tenantA)}`, { status: 'disabled' });
    assert.equal(r.status, 409);
  });

  test('a empresa nunca fica sem administrador', async () => {
    const me = await membershipOf('admin@a.test', f.tenantA);
    const other = await membershipOf('admin2@a.test', f.tenantA);
    const roles = await adminA.get('/api/v1/roles');
    const viewer = roles.body.items.find((r: { key: string }) => r.key === 'viewer').id;
    assert.equal((await adminA.req('PATCH', `/api/v1/members/${other}`, { roleIds: [viewer] })).status, 200);
    const r = await adminA.req('PATCH', `/api/v1/members/${me}`, { roleIds: [viewer] });
    assert.equal(r.status, 409);
    assert.match(r.body.title, /pelo menos um administrador/);
    const admin = roles.body.items.find((x: { key: string }) => x.key === 'admin').id;
    assert.equal((await adminA.req('PATCH', `/api/v1/members/${other}`, { roleIds: [admin] })).status, 200);
  });

  test('desativar alguém derruba a sessão dele na hora', async () => {
    const victim = await plain('gestor@a.test');
    const id = await membershipOf('gestor@a.test', f.tenantA);
    assert.equal((await adminA.req('PATCH', `/api/v1/members/${id}`, { status: 'disabled' })).status, 200);
    assert.equal((await victim.get('/api/v1/auth/me')).status, 401);
    assert.equal((await adminA.req('PATCH', `/api/v1/members/${id}`, { status: 'active' })).status, 200);
  });

  test('trocar o perfil muda as permissões', async () => {
    const id = await membershipOf('vendas@a.test', f.tenantA);
    const roles = await adminA.get('/api/v1/roles');
    const mkt = roles.body.items.find((r: { key: string }) => r.key === 'marketing').id;
    const r = await adminA.req('PATCH', `/api/v1/members/${id}`, { roleIds: [mkt] });
    assert.equal(r.status, 200);
    assert.equal((await sales.get('/api/v1/auth/me')).body.permissions['campaigns:edit'], 'tenant');
    const back = roles.body.items.find((x: { key: string }) => x.key === 'sales').id;
    await adminA.req('PATCH', `/api/v1/members/${id}`, { roleIds: [back] });
  });

  test('vínculo de outra empresa é invisível', async () => {
    const idB = await membershipOf('admin@b.test', f.tenantB);
    const r = await adminA.req('PATCH', `/api/v1/members/${idB}`, { status: 'disabled' });
    assert.equal(r.status, 404);
    assert.equal((await adminB.get('/api/v1/auth/me')).status, 200);
  });
});

describe('equipes', () => {
  test('criar, nomes únicos, membros e exclusão', async () => {
    const c = await adminA.post('/api/v1/teams', { name: 'Comercial' });
    assert.equal(c.status, 201);
    assert.equal((await adminA.post('/api/v1/teams', { name: 'Comercial' })).status, 409);
    const v = await membershipOf('vendas@a.test', f.tenantA);
    const a = await membershipOf('admin@a.test', f.tenantA);
    const u = await adminA.req('PATCH', `/api/v1/teams/${c.body.id}`, {
      members: [{ membershipId: a, role: 'leader' }, { membershipId: v, role: 'member' }],
    });
    assert.equal(u.status, 200);
    assert.equal(u.body.members.length, 2);
    assert.equal(u.body.members[0].role, 'leader');

    const bMember = await membershipOf('admin@b.test', f.tenantB);
    const cross = await adminA.req('PATCH', `/api/v1/teams/${c.body.id}`, { members: [{ membershipId: bMember, role: 'member' }] });
    assert.equal(cross.status, 422, 'vínculo de outra empresa não entra na equipe');

    const list = await adminA.get('/api/v1/teams');
    assert.equal(list.body.items[0].members.length, 2, 'a tentativa recusada não apagou os membros');

    assert.equal((await adminB.req('PATCH', `/api/v1/teams/${c.body.id}`, { name: 'Roubada' })).status, 404);
    assert.equal((await adminB.del(`/api/v1/teams/${c.body.id}`)).status, 404);
    assert.equal((await adminA.del(`/api/v1/teams/${c.body.id}`)).status, 204);
  });
});

describe('perfis', () => {
  test('o catálogo informa os alcances permitidos', async () => {
    const r = await adminA.get('/api/v1/permissions');
    const settings = r.body.items.find((p: { key: string }) => p.key === 'settings:admin');
    assert.deepEqual(settings.scopes, ['tenant']);
    const deals = r.body.items.find((p: { key: string }) => p.key === 'deals:view');
    assert.deepEqual(deals.scopes, ['own', 'team', 'tenant']);
  });

  test('perfil personalizado: criar, aplicar, editar, proteger e excluir', async () => {
    const bad = await adminA.post('/api/v1/roles', { name: 'Errado', grants: { 'settings:admin': 'own' } });
    assert.equal(bad.status, 422);
    const unknown = await adminA.post('/api/v1/roles', { name: 'Errado', grants: { 'naoexiste:x': 'tenant' } });
    assert.equal(unknown.status, 422);

    const c = await adminA.post('/api/v1/roles', { name: 'Pré-vendas', grants: { 'leads:view': 'tenant', 'leads:work': 'team' } });
    assert.equal(c.status, 201);
    assert.equal(c.body.isSystem, false);
    assert.equal((await adminA.post('/api/v1/roles', { name: 'Pré-vendas' })).status, 409);

    const id = await membershipOf('vendas@a.test', f.tenantA);
    await adminA.req('PATCH', `/api/v1/members/${id}`, { roleIds: [c.body.id] });
    let me = await sales.get('/api/v1/auth/me');
    assert.deepEqual(me.body.permissions, { 'leads:view': 'tenant', 'leads:work': 'team' });

    const e = await adminA.req('PATCH', `/api/v1/roles/${c.body.id}`, { grants: { 'leads:view': 'own' } });
    assert.equal(e.status, 200);
    me = await sales.get('/api/v1/auth/me');
    assert.deepEqual(me.body.permissions, { 'leads:view': 'own' });

    assert.equal((await adminA.del(`/api/v1/roles/${c.body.id}`)).status, 409, 'em uso');
    const roles = await adminA.get('/api/v1/roles');
    const salesRole = roles.body.items.find((r: { key: string }) => r.key === 'sales');
    await adminA.req('PATCH', `/api/v1/members/${id}`, { roleIds: [salesRole.id] });
    assert.equal((await adminA.del(`/api/v1/roles/${c.body.id}`)).status, 204);

    const admin = roles.body.items.find((r: { key: string }) => r.key === 'admin');
    assert.equal((await adminA.req('PATCH', `/api/v1/roles/${admin.id}`, { grants: {} })).status, 409);
    assert.equal((await adminA.del(`/api/v1/roles/${salesRole.id}`)).status, 409, 'perfil padrão não sai');
  });

  test('perfil de outra empresa é invisível', async () => {
    const rolesB = await adminB.get('/api/v1/roles');
    const id = rolesB.body.items.find((r: { key: string }) => r.key === 'viewer').id;
    assert.equal((await adminA.req('PATCH', `/api/v1/roles/${id}`, { name: 'Roubado' })).status, 404);
  });
});

describe('auditoria', () => {
  test('lista as ações da empresa, da mais nova para a mais velha, com paginação', async () => {
    const r = await adminA.get('/api/v1/audit?limit=3');
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 3);
    assert.ok(r.body.nextCursor);
    const times = r.body.items.map((i: { occurredAt: string }) => Date.parse(i.occurredAt));
    assert.deepEqual([...times].sort((a, b) => b - a), times);
    const next = await adminA.get(`/api/v1/audit?limit=3&before=${encodeURIComponent(r.body.nextCursor)}`);
    assert.ok(Date.parse(next.body.items[0].occurredAt) < times[2]);
    const roles = await adminA.get('/api/v1/audit?action=role.');
    assert.ok(roles.body.items.length >= 3);
    assert.ok(roles.body.items.every((i: { action: string }) => i.action.startsWith('role.')));
  });

  test('a empresa B não vê nada da A', async () => {
    const r = await adminB.get('/api/v1/audit?limit=100');
    assert.ok(r.body.items.every((i: { action: string }) => !['tenant.updated', 'team.created'].includes(i.action)));
  });
});

describe('plataforma', () => {
  test('quem não é superadministrador nem sabe que a rota existe', async () => {
    assert.equal((await adminA.get('/api/v1/platform/tenants')).status, 404);
  });

  test('superadministrador sem 2FA é barrado', async () => {
    const b = await plain('dono@plataforma.test');
    const r = await b.get('/api/v1/platform/tenants');
    assert.equal(r.status, 403);
    assert.equal(r.body.type, 'mfa-required');
  });

  test('criar empresa prepara perfis e convida o administrador; suspender derruba o acesso', async () => {
    const p = await withMfa('dono@plataforma.test');
    const list = await p.get('/api/v1/platform/tenants');
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 2);

    const c = await p.post('/api/v1/platform/tenants', { name: 'Clínica Aurora', slug: 'aurora', adminEmail: 'diretora@aurora.test' });
    assert.equal(c.status, 201);
    assert.equal((await p.post('/api/v1/platform/tenants', { name: 'Outra', slug: 'aurora', adminEmail: 'x@y.test' })).status, 409);

    const token = tokenFromMail(mailer.sent.at(-1)!.text);
    const d = new Browser(app, '10.22.0.1');
    assert.equal((await d.post('/api/v1/auth/invitations/accept', { token, name: 'Diretora', password: 'senha da diretora 2026' })).status, 200);
    await d.login('diretora@aurora.test', 'senha da diretora 2026');
    const me = await d.get('/api/v1/auth/me');
    assert.equal(me.body.tenantId, c.body.id);
    assert.equal(me.body.permissions['users:admin'], 'tenant');

    const audit = await f.admin.query("select actor_type from audit_log where tenant_id = $1 and action = 'tenant.created'", [c.body.id]);
    assert.equal(audit.rows[0].actor_type, 'platform');

    const s = await p.req('PATCH', `/api/v1/platform/tenants/${c.body.id}`, { status: 'suspended' });
    assert.equal(s.status, 200);
    assert.equal((await d.get('/api/v1/auth/me')).status, 401, 'empresa suspensa derruba a sessão');
    assert.equal((await d.login('diretora@aurora.test', 'senha da diretora 2026')).status, 403);
  });
});
