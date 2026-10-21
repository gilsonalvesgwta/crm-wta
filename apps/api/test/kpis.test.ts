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

test('KPIs fiéis: um painel por funil, conferência e tirar da conta', async () => {
  const q = `from=${day(13)}&to=${day(0)}&step=7`;
  const traffic = (await admin.post('/api/v1/tags', { name: 'Lead anúncio' })).body;
  const prosp = (await admin.post('/api/v1/tags', { name: 'Prospecção' })).body;
  const contacts = (await admin.get('/api/v1/contacts?q=&limit=50')).body.items as { id: string; name: string }[];
  const by = (n: string) => contacts.find((c) => c.name.startsWith(n))!;
  const [ana, beto, caio] = [by('Ana'), by('Beto'), by('Caio')];
  assert.equal((await admin.patch(`/api/v1/contacts/${ana.id}`, { tagIds: [traffic.id] })).status, 200);
  assert.equal((await admin.patch(`/api/v1/contacts/${beto.id}`, { tagIds: [traffic.id] })).status, 200);
  assert.equal((await admin.patch(`/api/v1/contacts/${caio.id}`, { tagIds: [prosp.id] })).status, 200);

  // Sem funil: a empresa toda, com o aviso na tela.
  let r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.equal(r.body.leadRule, 'new-contacts');
  assert.equal(r.body.funnel, null);

  // Só quem gerencia relatórios cria funis; nome e etiqueta são obrigatórios.
  assert.equal((await viewer.post('/api/v1/dashboard/kpis/funnels', { name: 'X', tagIds: [traffic.id] })).status, 403);
  assert.equal((await admin.post('/api/v1/dashboard/kpis/funnels', { name: 'Sem etiqueta', tagIds: [] })).status, 422);
  const paid = (await admin.post('/api/v1/dashboard/kpis/funnels', { name: 'Tráfego pago', tagIds: [traffic.id], receivesAdSpend: true })).body;
  const active = (await admin.post('/api/v1/dashboard/kpis/funnels', { name: 'Prospecção ativa', tagIds: [prosp.id], manualProspecting: true })).body;
  assert.equal((await admin.post('/api/v1/dashboard/kpis/funnels', { name: 'tráfego PAGO', tagIds: [prosp.id] })).status, 422, 'nome repetido');

  // Tráfego pago (o primeiro, por receber o investimento): só os leads da etiqueta dele.
  r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.equal(r.body.funnel.id, paid.id);
  assert.deepEqual(r.body.funnels.map((x: { name: string }) => x.name), ['Tráfego pago', 'Prospecção ativa']);
  let t = r.body.totals;
  assert.deepEqual([t.leads, t.scheduled, t.held, t.noShow, t.sales, t.revenueCents], [2, 2, 1, 1, 1, 300_000], 'Ana e Beto; a reunião do Caio não entra');
  assert.equal(t.spendCents, 91_000, 'o investimento é do tráfego pago');
  assert.equal(t.costPerHeldCents, 91_000);

  // Prospecção ativa: o Caio, sem investimento, e a prospecção lançada pelo vendedor.
  r = await admin.get(`/api/v1/dashboard/kpis?${q}&funnelId=${active.id}`);
  t = r.body.totals;
  assert.deepEqual([t.leads, t.scheduled, t.held, t.noShow, t.sales, t.spendCents], [1, 1, 1, 0, 0, 0]);
  assert.equal(t.prospected, 1);
  const mine = await sales.get('/api/v1/dashboard/kpis/prospecting/mine');
  assert.deepEqual(mine.body.funnels.map((x: { name: string }) => x.name), ['Prospecção ativa'], 'só funis com prospecção lançada à mão');
  assert.equal((await sales.req('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: active.id, day: day(0), count: 40 })).status, 200);
  assert.equal((await sales.req('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: active.id, day: day(1), count: 25 })).status, 200);
  assert.equal((await sales.req('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: active.id, day: day(0), count: 45 })).status, 200, 'corrigir o dia troca o número');
  assert.equal((await sales.req('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: active.id, day: day(10), count: 5 })).status, 422, 'vendedor: até 7 dias para trás');
  assert.equal((await sales.req('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: paid.id, day: day(0), count: 5 })).status, 422, 'funil sem prospecção manual');
  const adminMember = (await f.admin.query("select m.id from memberships m join users u on u.id = m.user_id where u.email = 'admin@a.test'")).rows[0].id;
  assert.equal((await sales.req('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: active.id, day: day(0), count: 1, membershipId: adminMember })).status, 403, 'não lança pelo outro');
  assert.equal((await admin.req('PUT', '/api/v1/dashboard/kpis/prospecting', { funnelId: active.id, day: day(10), count: 10 })).status, 200, 'o gestor lança qualquer dia');
  assert.deepEqual((await sales.get('/api/v1/dashboard/kpis/prospecting/mine')).body.funnels[0].entries.map((e: { count: number }) => e.count).sort(), [25, 45]);
  r = await admin.get(`/api/v1/dashboard/kpis?${q}&funnelId=${active.id}`);
  assert.equal(r.body.totals.prospected, 1 + 45 + 25 + 10);
  assert.equal(r.body.totals.prospectedManual, 80);
  const pd = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=prospected&funnelId=${active.id}`);
  assert.deepEqual(pd.body.items.map((i: { title: string }) => i.title), ['Caio']);
  assert.equal(pd.body.manual.reduce((s: number, m: { count: number }) => s + m.count, 0), 80);
  // E nada disso entra no tráfego pago.
  assert.equal((await admin.get(`/api/v1/dashboard/kpis?${q}`)).body.totals.prospectedManual, 0);

  // Editar o contato não muda a data em que ele virou lead.
  const before = (await f.admin.query('select created_at from contact_tags where contact_id = $1', [ana.id])).rows[0].created_at;
  await admin.patch(`/api/v1/contacts/${ana.id}`, { jobTitle: 'Gerente', tagIds: [traffic.id] });
  assert.deepEqual((await f.admin.query('select created_at from contact_tags where contact_id = $1', [ana.id])).rows[0].created_at, before);

  // Conferência: a lista bate com o número do funil.
  const leads = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=leads`);
  assert.deepEqual(leads.body.items.map((i: { title: string }) => i.title).sort(), ['Ana', 'Beto']);
  const salesList = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=sales`);
  assert.equal(salesList.body.items.length, 1);
  assert.equal(salesList.body.items[0].valueCents, 300_000);
  const held = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=held`);
  assert.equal(held.body.items.length, 1);

  // Tirar da conta: o contato sai dos leads; o negócio sai das vendas e do ticket.
  assert.equal((await viewer.post('/api/v1/dashboard/kpis/exclusions', { kind: 'contact', id: beto.id, excluded: true })).status, 403);
  assert.equal((await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'contact', id: beto.id, excluded: true })).status, 204);
  assert.equal((await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'deal', id: salesList.body.items[0].id, excluded: true })).status, 204);
  r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.equal(r.body.totals.leads, 1);
  assert.equal(r.body.totals.sales, 0);
  assert.equal(r.body.totals.averageTicketCents, null);
  const again = await admin.get(`/api/v1/dashboard/kpis/details?from=${day(13)}&to=${day(0)}&metric=leads`);
  assert.deepEqual(again.body.items.map((i: { title: string; excluded: boolean }) => [i.title, i.excluded]), [['Ana', false], ['Beto', true]], 'o tirado aparece marcado, para voltar');
  assert.equal((await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'activity', id: held.body.items[0].id, excluded: true })).status, 204);
  assert.equal((await admin.get(`/api/v1/dashboard/kpis?${q}`)).body.totals.held, 0);
  await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'contact', id: beto.id, excluded: false });
  await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'deal', id: salesList.body.items[0].id, excluded: false });
  await admin.post('/api/v1/dashboard/kpis/exclusions', { kind: 'activity', id: held.body.items[0].id, excluded: false });
  r = await admin.get(`/api/v1/dashboard/kpis?${q}`);
  assert.deepEqual([r.body.totals.leads, r.body.totals.sales, r.body.totals.held], [2, 1, 1]);

  // Só um funil recebe o investimento: marcar outro tira do primeiro.
  const moved = await admin.patch(`/api/v1/dashboard/kpis/funnels/${active.id}`, { name: 'Prospecção ativa', tagIds: [prosp.id], manualProspecting: true, receivesAdSpend: true });
  assert.equal(moved.body.receivesAdSpend, true);
  assert.equal((await admin.get(`/api/v1/dashboard/kpis?${q}&funnelId=${paid.id}`)).body.totals.spendCents, 0);
  await admin.patch(`/api/v1/dashboard/kpis/funnels/${paid.id}`, { name: 'Tráfego pago', tagIds: [traffic.id], receivesAdSpend: true });
  assert.equal((await admin.get(`/api/v1/dashboard/kpis?${q}&funnelId=${active.id}`)).body.totals.spendCents, 0);

  // Funil de outra empresa não existe aqui; apagar o funil não apaga contatos.
  assert.equal((await adminB.get('/api/v1/dashboard/kpis/funnels')).body.length, 0);
  assert.equal((await adminB.get(`/api/v1/dashboard/kpis?${q}&funnelId=${paid.id}`)).status, 404);
  assert.equal((await admin.req('DELETE', `/api/v1/dashboard/kpis/funnels/${active.id}`)).status, 204);
  assert.equal((await admin.get(`/api/v1/contacts/${caio.id}`)).status, 200);
  assert.equal((await f.admin.query('select count(*)::int as n from kpi_prospecting where funnel_id = $1', [active.id])).rows[0].n, 0);
});

test('desligar a conta da Meta tira o gasto importado', async () => {
  const acc = (await admin.get('/api/v1/ads/accounts')).body[0];
  assert.equal((await admin.req('DELETE', `/api/v1/ads/accounts/${acc.id}`)).status, 204);
  const list = (await admin.get(`/api/v1/ads/spend?from=${day(30)}&to=${day(0)}`)).body as { account: unknown }[];
  assert.equal(list.filter((s) => s.account).length, 0);
  assert.equal(list.length, 1, 'o lançamento manual fica');
});
