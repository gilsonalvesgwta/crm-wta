import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import type { MemoryMailer } from '../src/infra/mailer.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { PALETTES } from '../src/domain/theme.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';

const SECRET = 'segredo-da-greenn-de-teste-0123';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

let f: Fixture;
let app: NestFastifyApplication;
let mailer: MemoryMailer;
let ip = 0;
let owner: Browser;
let adminA: Browser;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.50.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const greenn = (body: unknown, secret = SECRET) => new Browser(app, '10.50.9.9').req('POST', `/api/v1/webhooks/greenn/${secret}`, body, { 'x-crm-request': 'x' });

before(async () => {
  f = await createDatabase();
  ({ app, mailer } = await startApi(f, { GREENN_SECRET: SECRET, CLIENT_DOMAIN_TARGET: 'crm.teste.local' }));
  await createUser(f, 'dono@plataforma.test', [{ tenant: f.tenantA, role: 'admin' }], { platformAdmin: true });
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }, { tenant: f.tenantB, role: 'admin' }]);
  owner = await login('dono@plataforma.test', true);
  adminA = await login('admin@a.test', true);
  await adminA.post('/api/v1/auth/tenant', { tenantId: f.tenantA });
});

after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

describe('empresas na plataforma', () => {
  test('edita nome e contato e reenvia o convite do administrador', async () => {
    const r = await owner.patch(`/api/v1/platform/tenants/${f.tenantB}`, { name: 'Empresa B Ltda', contactEmail: 'Financeiro@B.test', phone: '11 99999-0000' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.name, 'Empresa B Ltda');
    assert.equal(r.body.contactEmail, 'financeiro@b.test');
    const before = mailer.sent.length;
    const inv = await owner.post(`/api/v1/platform/tenants/${f.tenantB}/invite-admin`, { email: 'novo-admin@b.test' });
    assert.equal(inv.status, 200);
    assert.equal(mailer.sent.length, before + 1);
    assert.equal(mailer.sent.at(-1)!.to, 'novo-admin@b.test');
    assert.equal((await adminA.patch(`/api/v1/platform/tenants/${f.tenantB}`, { name: 'x' })).status, 404, 'quem não é da plataforma nem vê a rota');
  });

  test('exclui só com o identificador digitado; a empresa da WTA não sai', async () => {
    const c = await owner.post('/api/v1/platform/tenants', { name: 'Apagar', slug: 'apagar-ja', adminEmail: 'x@apagar.test' });
    assert.equal(c.status, 201);
    assert.equal((await owner.post(`/api/v1/platform/tenants/${c.body.id}/delete`, { confirm: 'errado' })).status, 422);
    assert.equal((await owner.post(`/api/v1/platform/tenants/${c.body.id}/delete`, { confirm: 'apagar-ja' })).status, 204);
    assert.equal((await owner.get(`/api/v1/platform/tenants/${c.body.id}`)).status, 404);
    const wta = await f.admin.query<{ id: string }>("insert into tenants (name, slug) values ('WTA', 'wta') returning id");
    assert.equal((await owner.post(`/api/v1/platform/tenants/${wta.rows[0]!.id}/delete`, { confirm: 'wta' })).status, 409);
  });
});

describe('planos e limites', () => {
  let basic: string;

  test('plano com limites; a empresa vê o próprio plano e o uso', async () => {
    const p = await owner.post('/api/v1/platform/plans', {
      name: 'Básico', priceCents: 9900, billingPeriod: 'monthly', durationDays: 30, limits: { max_users: 3, custom_domain: false },
    });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    basic = p.body.id;
    const s = await owner.put(`/api/v1/platform/tenants/${f.tenantA}/subscription`, {
      planId: basic, status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.subscription.planName, 'Básico');
    const mine = await adminA.get('/api/v1/subscription');
    assert.equal(mine.body.plan, 'Básico');
    const users = mine.body.limits.find((l: { key: string }) => l.key === 'max_users');
    assert.deepEqual([users.value, users.used], [3, 2], 'as duas pessoas da empresa A');
  });

  test('o limite de usuários barra o convite além do plano', async () => {
    const roles = await f.admin.query<{ id: string }>("select id from roles where tenant_id = $1 and key = 'sales'", [f.tenantA]);
    const ok = await adminA.post('/api/v1/invitations', { email: 'um@a.test', roleId: roles.rows[0]!.id });
    assert.equal(ok.status, 201);
    const over = await adminA.post('/api/v1/invitations', { email: 'dois@a.test', roleId: roles.rows[0]!.id });
    assert.equal(over.status, 403);
    assert.equal(over.body.type, 'plan-limit');
  });

  test('domínio próprio só no plano que permite', async () => {
    const no = await adminA.req('PUT', '/api/v1/domain', { domain: 'crm.cliente-a.test' });
    assert.equal(no.status, 403);
    await owner.patch(`/api/v1/platform/plans/${basic}`, { limits: { max_users: 10, custom_domain: true } });
    const yes = await adminA.req('PUT', '/api/v1/domain', { domain: 'https://CRM.Cliente-A.test/' });
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    assert.equal(yes.body.domain, 'crm.cliente-a.test');
    assert.equal(yes.body.target, 'crm.teste.local');
    const check = await adminA.post('/api/v1/domain/check');
    assert.equal(check.body.dnsOk, false);
    assert.ok(check.body.lastError);
    assert.equal((await adminA.req('PUT', '/api/v1/domain', { domain: 'crm.teste.local' })).status, 422, 'o endereço do CRM é reservado');
  });

  test('plano em uso não é excluído', async () => {
    assert.equal((await owner.del(`/api/v1/platform/plans/${basic}`)).status, 409);
  });
});

describe('marca e acesso pelo domínio', () => {
  test('paletas prontas passam no contraste; menu claro demais é recusado', async () => {
    for (const p of PALETTES) {
      const r = await adminA.req('PUT', '/api/v1/branding', { productName: 'CRM A', primary: p.primary, sidebar: p.sidebar, mode: p.mode });
      assert.equal(r.status, 200, `${p.name}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.theme.sidebar, p.sidebar);
    }
    const bad = await adminA.req('PUT', '/api/v1/branding', { productName: 'CRM A', primary: '#2563EB', sidebar: '#F1F5F9', mode: 'light' });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.errors[0].field, 'sidebar');
  });

  test('logotipo enviado aparece por endereço público; formato errado é recusado', async () => {
    const r = await adminA.upload('/api/v1/branding/logo', 'logo.png', PNG, 'image/png');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.logoUrl);
    const img = await new Browser(app).raw(r.body.logoUrl);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.deepEqual(img.body, PNG);
    const pdf = await adminA.upload('/api/v1/branding/icon', 'x.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'), 'application/pdf');
    assert.equal(pdf.status, 422);
    const swapped = r.body.logoUrl.replace(f.tenantA, f.tenantB);
    assert.equal((await new Browser(app).raw(swapped)).status, 404, 'o arquivo não aparece pelo endereço de outra empresa');
  });

  test('no domínio verificado, a tela de login recebe a marca e o login entra direto na empresa', async () => {
    const anon = new Browser(app);
    assert.equal((await anon.req('GET', '/api/v1/public/branding', undefined, { 'x-forwarded-host': 'crm.cliente-a.test' })).body.found, false,
      'antes da verificação, nada');
    await f.admin.query("update tenant_domains set verified_at = now(), dns_ok = true where domain = 'crm.cliente-a.test'");
    const b = await anon.req('GET', '/api/v1/public/branding', undefined, { 'x-forwarded-host': 'crm.cliente-a.test' });
    assert.equal(b.body.found, true);
    assert.equal(b.body.productName, 'CRM A');
    assert.ok(b.body.logoUrl);
    assert.equal((await anon.req('GET', '/api/v1/public/domain-check', undefined, { 'x-forwarded-host': 'crm.cliente-a.test' })).body.tenantId, f.tenantA);
    // Pessoa com acesso às duas empresas entra direto na A pelo domínio da A.
    const p = new Browser(app, '10.50.1.1');
    const r = await p.req('POST', '/api/v1/auth/login', { email: 'admin@a.test', password: 'senha forte de teste 2026' }, { 'x-forwarded-host': 'crm.cliente-a.test' });
    assert.equal(r.status, 200);
    assert.equal(r.body.tenantId, f.tenantA);
    const main = new Browser(app, '10.50.1.2');
    assert.equal((await main.login('admin@a.test')).body.tenantId, null, 'no endereço principal, escolhe a empresa');
  });
});

describe('Greenn', () => {
  let product: string;
  const sale = (status: string, extra: Record<string, unknown> = {}) => ({
    type: 'sale', event: 'saleUpdated', currentStatus: status,
    product: { id: 7001, name: 'CRM WTA Profissional', type: 'TRANSACTION' },
    sale: { id: 9001, status }, client: { name: 'Clínica Sorriso', email: 'Dono@Sorriso.test', cellphone: '11999998888' }, ...extra,
  });

  before(async () => {
    const p = await owner.post('/api/v1/platform/plans', { name: 'Profissional', billingPeriod: 'yearly', durationDays: 365, limits: { max_users: 10 } });
    product = p.body.id;
    assert.equal((await owner.post(`/api/v1/platform/plans/${product}/offers`, { externalProduct: '7001', label: 'Anual' })).status, 201);
    assert.equal((await owner.post(`/api/v1/platform/plans/${product}/offers`, { externalProduct: '7001' })).status, 409, 'produto já ligado');
  });

  test('segredo errado: 404; o endereço aparece para o superadministrador', async () => {
    assert.equal((await greenn(sale('paid'), 'errado-errado-errado-1234')).status, 404);
    const info = await owner.get('/api/v1/platform/greenn');
    assert.equal(info.body.configured, true);
    assert.ok(info.body.url.endsWith(`/api/v1/webhooks/greenn/${SECRET}`));
  });

  test('venda paga cria a empresa com o plano, convida o comprador, e repetir não duplica', async () => {
    const before = mailer.sent.length;
    const r = await greenn(sale('paid'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, 'created');
    assert.equal(mailer.sent.length, before + 1);
    assert.equal(mailer.sent.at(-1)!.to, 'dono@sorriso.test');
    const list = await owner.get('/api/v1/platform/tenants');
    const t = list.body.items.find((x: { contactEmail: string }) => x.contactEmail === 'dono@sorriso.test');
    assert.equal(t.name, 'Clínica Sorriso');
    assert.equal(t.subscription.planName, 'Profissional');
    assert.equal(t.subscription.status, 'active');
    const days = (new Date(t.subscription.currentPeriodEnd).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 364 && days < 366);
    assert.equal((await greenn(sale('paid'))).body.action, 'duplicate');
  });

  test('reembolso suspende na hora; nova compra reativa', async () => {
    const r = await greenn(sale('refunded'));
    assert.equal(r.body.action, 'deactivated');
    let t = (await owner.get('/api/v1/platform/tenants')).body.items.find((x: { contactEmail: string }) => x.contactEmail === 'dono@sorriso.test');
    assert.equal(t.status, 'suspended');
    assert.equal(t.subscription.status, 'canceled');
    const again = await greenn(sale('paid', { sale: { id: 9002, status: 'paid' } }));
    assert.equal(again.body.action, 'renewed');
    t = (await owner.get('/api/v1/platform/tenants')).body.items.find((x: { contactEmail: string }) => x.contactEmail === 'dono@sorriso.test');
    assert.equal(t.status, 'active');
  });

  test('assinatura: paga vale até o fim do contrato; cancelada vale até o fim e depois suspende', async () => {
    const contract = (status: string, end: string) => ({
      type: 'contract', currentStatus: status, product: { id: 7001, type: 'SUBSCRIPTION' }, currentSale: { id: 9100 },
      contract: { id: 555, status, current_period_end: end }, client: { name: 'Ótica Visão', email: 'otica@visao.test' },
    });
    const paid = await greenn(contract('paid', '2030-01-10 12:00:00'));
    assert.equal(paid.body.action, 'created');
    let t = (await owner.get('/api/v1/platform/tenants')).body.items.find((x: { contactEmail: string }) => x.contactEmail === 'otica@visao.test');
    assert.equal(t.subscription.currentPeriodEnd.slice(0, 10), '2030-01-10');
    const canceled = await greenn(contract('canceled', '2020-01-10 12:00:00'));
    assert.equal(canceled.body.action, 'canceled');
    t = (await owner.get('/api/v1/platform/tenants')).body.items.find((x: { contactEmail: string }) => x.contactEmail === 'otica@visao.test');
    assert.equal(t.status, 'active', 'continua ativa até o despachante passar');
    await app.get(DispatcherService).runOnce();
    t = (await owner.get('/api/v1/platform/tenants')).body.items.find((x: { contactEmail: string }) => x.contactEmail === 'otica@visao.test');
    assert.equal(t.status, 'suspended');
    assert.equal(t.subscription.status, 'expired');
  });

  test('produto sem plano, aguardando pagamento e corpo inválido ficam só registrados', async () => {
    assert.equal((await greenn({ ...sale('paid'), product: { id: 1234 }, sale: { id: 1 } })).body.action, 'unmatched');
    assert.equal((await greenn({ ...sale('waiting_payment'), sale: { id: 2 } })).body.action, 'ignored');
    assert.equal((await greenn({ foo: 'bar' })).body.action, 'invalid');
    const ev = await owner.get('/api/v1/platform/greenn');
    assert.ok(ev.body.events.length >= 6);
    assert.ok(ev.body.events.some((e: { action: string }) => e.action === 'unmatched'));
  });
});
