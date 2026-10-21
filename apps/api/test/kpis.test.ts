import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeMeta } from './fakes.js';

const TOKEN = 'EAAtokenDeAnunciosDeTeste123456';
let f: Fixture;
let app: NestFastifyApplication;
let meta: FakeMeta;
let ip = 0;
let admin: Browser;
let sales: Browser;
let viewer: Browser;
let adminB: Browser;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.65.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

/** Dia (AAAA-MM-DD) no fuso de São Paulo, n dias atrás. */
const day = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() - n * 86_400_000));
/** Meio-dia de São Paulo, n dias atrás. */
const noon = (n: number, h = 12) => new Date(`${day(n)}T${String(h).padStart(2, '0')}:00:00-03:00`).toISOString();

before(async () => {
  f = await createDatabase();
  meta = new FakeMeta([TOKEN]);
  await meta.start();
  ({ app } = await startApi(f, { META_GRAPH_URL: meta.url, META_INSTAGRAM_URL: meta.url }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'leitor@a.test', [{ tenant: f.tenantA, role: 'viewer' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  viewer = await login('leitor@a.test', false);
  adminB = await login('admin@b.test', true);
});

after(async () => {
  await app?.close();
  await meta?.stop();
  if (f) await dropDatabase(f);
});

test('investimento lançado à mão: criar, mudar, apagar e quem pode', async () => {
  const bad = await admin.post('/api/v1/ads/spend', { platform: 'google', firstDay: day(1), lastDay: day(3), amountCents: 100 });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.errors[0].field, 'lastDay');
  const r = await admin.post('/api/v1/ads/spend', { platform: 'google', description: 'Pesquisa', firstDay: day(13), lastDay: day(7), amountCents: 70_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.amountCents, 70_000);
  const tmp = await admin.post('/api/v1/ads/spend', { platform: 'other', firstDay: day(2), lastDay: day(2), amountCents: 5_000 });
  const up = await admin.patch(`/api/v1/ads/spend/${tmp.body.id}`, { platform: 'tiktok', firstDay: day(2), lastDay: day(2), amountCents: 6_000 });
  assert.equal(up.body.platform, 'tiktok');
  assert.equal(up.body.amountCents, 6_000);
  assert.equal((await admin.req('DELETE', `/api/v1/ads/spend/${tmp.body.id}`)).status, 204);

  // Leitor vê, mas não lança; o comercial (só os próprios números) não vê os KPIs da empresa.
  assert.equal((await viewer.get(`/api/v1/ads/spend?from=${day(30)}&to=${day(0)}`)).body.length, 1);
  assert.equal((await viewer.post('/api/v1/ads/spend', { platform: 'meta', firstDay: day(1), lastDay: day(1), amountCents: 1 })).status, 403);
  assert.equal((await sales.get(`/api/v1/dashboard/kpis?from=${day(13)}&to=${day(0)}&step=7`)).status, 403);
  assert.equal((await adminB.get(`/api/v1/ads/spend?from=${day(30)}&to=${day(0)}`)).body.length, 0, 'outra empresa não vê');
});

test('Meta Ads: liga a conta, importa o gasto por dia e atualiza', async () => {
  meta.adSpend.set(day(3), 150);
  meta.adSpend.set(day(2), 50.5);
  meta.adSpend.set(day(200), 999); // fora dos 90 dias da primeira importação
  const wrong = await admin.post('/api/v1/ads/accounts/meta', { accountId: 'act_1234567', token: 'token-errado-com-mais-de-20' });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.errors[0].field, 'token');
  assert.equal((await admin.post('/api/v1/ads/accounts/meta', { accountId: 'abc', token: TOKEN })).status, 422);
  const ok = await admin.post('/api/v1/ads/accounts/meta', { accountId: 'act_1234567', token: TOKEN });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.name, 'Anúncios Empresa Teste');
  assert.equal(ok.body.status, 'connected');
  assert.ok(ok.body.lastSyncAt);
  assert.equal(JSON.stringify(ok.body).includes(TOKEN), false, 'o token não volta');
  const stored = (await f.admin.query('select secret from ad_accounts where id = $1', [ok.body.id])).rows[0];
  assert.equal(stored.secret.toString('utf8').includes(TOKEN), false, 'o token fica cifrado');
  assert.equal((await admin.post('/api/v1/ads/accounts/meta', { accountId: '1234567', token: TOKEN })).status, 422, 'a mesma conta não entra duas vezes');

  let list = (await admin.get(`/api/v1/ads/spend?from=${day(300)}&to=${day(0)}`)).body as { platform: string; amountCents: number; firstDay: string; account: unknown }[];
  const imported = list.filter((s) => s.account);
  assert.deepEqual(imported.map((s) => [s.firstDay, s.amountCents]).sort(), [[day(3), 15_000], [day(2), 5_050]].sort());
  const one = imported[0] as unknown as { id: string };
  assert.equal((await admin.patch(`/api/v1/ads/spend/${one.id}`, { platform: 'meta', firstDay: day(2), lastDay: day(2), amountCents: 1 })).status, 409);

  // A Meta ajustou o gasto de um dia: a próxima importação troca o valor.
  meta.adSpend.set(day(2), 60);
  assert.equal((await admin.post(`/api/v1/ads/accounts/${ok.body.id}/sync`)).status, 200);
  list = (await admin.get(`/api/v1/ads/spend?from=${day(30)}&to=${day(0)}`)).body;
  assert.equal(list.find((s) => s.account && s.firstDay === day(2))!.amountCents, 6_000);

  // O despachante importa sozinho quando a conta vence; token inválido fica registrado.
  await f.admin.query("update ad_accounts set sync_after = now() - interval '1 minute'");
  meta.tokens.delete(TOKEN);
  await app.get(DispatcherService).runOnce();
  const acc = (await admin.get('/api/v1/ads/accounts')).body.find((a: { id: string }) => a.id === ok.body.id);
  assert.equal(acc.status, 'error');
  assert.match(acc.lastError, /token/i);
  meta.tokens.add(TOKEN);
  assert.equal((await admin.post(`/api/v1/ads/accounts/${ok.body.id}/sync`)).body.status, 'connected');
});

test('KPIs por período: funil, no-show, custos, ROAS e conversão', async () => {
  const pipes = await admin.get('/api/v1/pipelines');
  const pipelineId = pipes.body[0]?.id ?? (await admin.post('/api/v1/pipelines', { name: 'Vendas' })).body.id;
  const person = async (name: string) => (await admin.post('/api/v1/contacts', { firstName: name })).body.id as string;
  const call = async (contactId: string, outcome: 'held' | 'no_show') => {
    const a = await admin.post('/api/v1/activities', { type: 'meeting', title: 'Reunião', startsAt: noon(1), contactId });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    await admin.post(`/api/v1/activities/${a.body.id}/status`, { status: 'done', outcome });
  };
  const [c1, c2, c3] = [await person('Ana'), await person('Beto'), await person('Caio')];
  await call(c1, 'held');
  await call(c2, 'no_show');
  await call(c3, 'held');
  const d = await admin.post('/api/v1/deals', { pipelineId, title: 'Consórcio', contactId: c1 });
  await f.admin.query("update deals set status = 'won', closed_at = $2, value_cents = 300000 where id = $1", [d.body.id, noon(1, 15)]);

  const r = await admin.get(`/api/v1/dashboard/kpis?from=${day(13)}&to=${day(0)}&step=7`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.periods.length, 2);
  const [p1, p2] = r.body.periods;
  assert.deepEqual([p1.from, p1.to, p2.from, p2.to], [day(13), day(7), day(6), day(0)]);
  assert.equal(p1.spendCents, 70_000, 'Google: R$ 700 em 7 dias, todo na primeira semana');
  assert.equal(p2.spendCents, 21_000, 'Meta: R$ 150 + R$ 60 na segunda semana');
  assert.equal(p2.leads, 3);
  assert.equal(p2.prospected, 2);
  assert.equal(p2.scheduled, 3);
  assert.equal(p2.held, 2);
  assert.equal(p2.noShow, 1);
  assert.equal(p2.noShowRate, 1 / 3);
  assert.equal(p2.sales, 1);
  assert.equal(p2.salesOnCall, 1);
  assert.equal(p2.revenueCents, 300_000);
  assert.equal(p2.averageTicketCents, 300_000);
  assert.equal(p2.costPerLeadCents, 7_000);
  assert.equal(p2.costPerHeldCents, 10_500);
  assert.equal(p2.costPerSaleCents, 21_000);
  assert.equal(p2.onCallConversion, 0.5);
  assert.equal(p2.meetingsPerSale, 2);
  assert.equal(p2.roas, 300_000 / 21_000);
  const t = r.body.totals;
  assert.equal(t.spendCents, 91_000);
  assert.deepEqual(t.spendByPlatform.map((x: { platform: string }) => x.platform).sort(), ['google', 'meta']);
  assert.equal(t.leads, 3);

  // Planilha diária: 14 linhas; o gasto de R$ 700 vira R$ 100 por dia.
  const daily = await admin.get(`/api/v1/dashboard/kpis?from=${day(13)}&to=${day(0)}&step=1`);
  assert.equal(daily.body.periods.length, 14);
  assert.equal(daily.body.periods[0].spendCents, 10_000);
  assert.equal(daily.body.periods.at(-2).held, 2);

  // A cada 3 dias: o último período fica mais curto.
  const three = await admin.get(`/api/v1/dashboard/kpis?from=${day(13)}&to=${day(0)}&step=3`);
  assert.equal(three.body.periods.length, 5);
  assert.equal(three.body.periods.at(-1).days, 2);

  // Outra empresa não vê nada; período inválido é recusado.
  const other = await adminB.get(`/api/v1/dashboard/kpis?from=${day(13)}&to=${day(0)}&step=7`);
  assert.equal(other.body.totals.leads, 0);
  assert.equal(other.body.totals.spendCents, 0);
  assert.equal((await admin.get(`/api/v1/dashboard/kpis?from=${day(0)}&to=${day(3)}&step=7`)).status, 422);
});

test('KPIs fiéis: lead pela etiqueta, conferência e tirar da conta', async () => {
  const q = `from=${day(13)}&to=${day(0)}&step=7`;
  const tag = (await admin.post('/api/v1/tags', { name: 'Lead anúncio' })).body;
  const contacts = (await admin.get('/api/v1/contacts?q=&limit=50')).body.items as { id: string; name: string }[];
  const ana = contacts.find((c) => c.name.startsWith('Ana'))!;
  const beto = contacts.find((c) => c.name.startsWith('Beto'))!;
  assert.equal((await admin.patch(`/api/v1/contacts/${ana.id}`, { tagIds: [tag.id] })).status, 200);
  assert.equal((await admin.patch(`/api/v1/contacts/${beto.id}`, { tagIds: [tag.id] })).status, 200);

  // Só quem gerencia relatórios escolhe a etiqueta; antes disso, todo contato novo conta.
  assert.equal((await viewer.req('PATCH', '/api/v1/dashboard/kpis/settings', { leadTagIds: [tag.id] })).status, 403);
  let r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.equal(r.body.leadRule, 'new-contacts');
  assert.equal((await admin.patch('/api/v1/dashboard/kpis/settings', { leadTagIds: [tag.id] })).status, 200);
  r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.equal(r.body.leadRule, 'tag');
  assert.equal(r.body.totals.leads, 2, 'só Ana e Beto têm a etiqueta');

  // Editar o contato não muda a data em que ele virou lead.
  const before = (await f.admin.query('select created_at from contact_tags where contact_id = $1', [ana.id])).rows[0].created_at;
  await admin.patch(`/api/v1/contacts/${ana.id}`, { jobTitle: 'Gerente', tagIds: [tag.id] });
  assert.deepEqual((await f.admin.query('select created_at from contact_tags where contact_id = $1', [ana.id])).rows[0].created_at, before);

  // Conferência: a lista bate com o número.
  const leads = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=leads`);
  assert.deepEqual(leads.body.items.map((i: { title: string }) => i.title).sort(), ['Ana', 'Beto']);
  const sales = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=sales`);
  assert.equal(sales.body.items.length, 1);
  assert.equal(sales.body.items[0].valueCents, 300_000);
  const held = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=held`);
  assert.equal(held.body.items.length, 2);

  // Tirar da conta: o contato sai dos leads e das prospecções; o negócio sai das vendas e do ticket.
  assert.equal((await viewer.post('/api/v1/dashboard/kpis/exclusions', { kind: 'contact', id: beto.id, excluded: true })).status, 403);
  assert.equal((await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'contact', id: beto.id, excluded: true })).status, 204);
  assert.equal((await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'deal', id: sales.body.items[0].id, excluded: true })).status, 204);
  r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.equal(r.body.totals.leads, 1);
  assert.equal(r.body.totals.sales, 0);
  assert.equal(r.body.totals.averageTicketCents, null);
  const again = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=leads`);
  assert.deepEqual(again.body.items.map((i: { title: string; excluded: boolean }) => [i.title, i.excluded]), [['Ana', false], ['Beto', true]], 'o tirado aparece marcado, para voltar');
  // Uma reunião tirada da conta não conta como realizada.
  assert.equal((await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'activity', id: held.body.items[0].id, excluded: true })).status, 204);
  assert.equal((await admin.get(`/api/v1/dashboard/kpis?${q}`)).body.totals.held, 1);

  // Voltar a contar.
  await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'contact', id: beto.id, excluded: false });
  await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'deal', id: sales.body.items[0].id, excluded: false });
  await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'activity', id: held.body.items[0].id, excluded: false });
  r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.deepEqual([r.body.totals.leads, r.body.totals.sales, r.body.totals.held], [2, 1, 2]);
  assert.equal((await adminB.get('/api/v1/dashboard/kpis/settings')).body.leadTagIds.length, 0, 'configuração é de cada empresa');
});

test('desligar a conta da Meta tira o gasto importado', async () => {
  const acc = (await admin.get('/api/v1/ads/accounts')).body[0];
  assert.equal((await admin.req('DELETE', `/api/v1/ads/accounts/${acc.id}`)).status, 204);
  const list = (await admin.get(`/api/v1/ads/spend?from=${day(30)}&to=${day(0)}`)).body as { account: unknown }[];
  assert.equal(list.filter((s) => s.account).length, 0);
  assert.equal(list.length, 1, 'o lançamento manual fica');
});
