import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';

let f: Fixture;
let app: NestFastifyApplication;
let ip = 0;

async function login(email: string, mfa = false): Promise<Browser> {
  const b = new Browser(app, `10.30.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200, `login de ${email}`);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const membership = async (email: string, tenant = f.tenantA) =>
  (await f.admin.query<{ id: string }>(
    'select m.id from memberships m join users u on u.id = m.user_id where u.email = $1 and m.tenant_id = $2', [email, tenant])).rows[0]!.id;

let admin: Browser;
let manager: Browser;
let leader: Browser;
let sales1: Browser;
let sales2: Browser;
let sales3: Browser;
let viewer: Browser;
let adminB: Browser;
let teamAlpha: string;
let teamBeta: string;
const m: Record<string, string> = {};

before(async () => {
  f = await createDatabase();
  ({ app } = await startApi(f));
  const users: [string, string][] = [
    ['admin@a.test', 'admin'], ['gestor@a.test', 'manager'], ['lider@a.test', 'team_lead'], ['vendas1@a.test', 'sales'],
    ['vendas2@a.test', 'sales'], ['vendas3@a.test', 'sales'], ['leitor@a.test', 'viewer'],
  ];
  for (const [email, role] of users) await createUser(f, email, [{ tenant: f.tenantA, role }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  for (const [email] of users) m[email] = await membership(email);
  m['admin@b.test'] = await membership('admin@b.test', f.tenantB);
  const t = await f.admin.query<{ id: string }>(
    "insert into teams (tenant_id, name) values ($1, 'Alfa'), ($1, 'Beta') returning id", [f.tenantA]);
  teamAlpha = t.rows[0]!.id;
  teamBeta = t.rows[1]!.id;
  await f.admin.query(
    `insert into team_members (tenant_id, team_id, membership_id, role) values
       ($1, $2, $3, 'leader'), ($1, $2, $4, 'member'), ($1, $2, $5, 'member'), ($1, $6, $7, 'member')`,
    [f.tenantA, teamAlpha, m['lider@a.test'], m['vendas1@a.test'], m['vendas2@a.test'], teamBeta, m['vendas3@a.test']]);
  admin = await login('admin@a.test', true);
  manager = await login('gestor@a.test');
  leader = await login('lider@a.test');
  sales1 = await login('vendas1@a.test');
  sales2 = await login('vendas2@a.test');
  sales3 = await login('vendas3@a.test');
  viewer = await login('leitor@a.test');
  adminB = await login('admin@b.test', true);
});

after(async () => {
  await app?.close();
  if (f) await dropDatabase(f);
});

const dispatcher = () => app.get(DispatcherService);

// ---------------------------------------------------------------------------

describe('contatos', () => {
  let joao: string;

  test('cria com vários e-mails e telefones normalizados, etiquetas e campos personalizados', async () => {
    const tag = await sales1.post('/api/v1/tags', { name: 'Cliente VIP', color: '#ff6600' });
    assert.equal(tag.status, 201);
    assert.equal(tag.body.color, '#FF6600');
    const field = await admin.post('/api/v1/custom-fields', { entity: 'contact', key: 'plano', label: 'Plano', type: 'select', options: [{ value: 'ouro', label: 'Ouro' }, { value: 'prata', label: 'Prata' }] });
    assert.equal(field.status, 201);
    const r = await sales1.post('/api/v1/contacts', {
      firstName: 'João', lastName: 'Araújo',
      emails: [{ email: ' Joao@Exemplo.COM.br ', isPrimary: true }, { email: 'joao.pessoal@exemplo.com' }],
      phones: [{ number: '(11) 98765-4321' }, { number: '+1 202 555 0143', label: 'work' }],
      tagIds: [tag.body.id], custom: { plano: 'Ouro' }, birthday: { day: 29, month: 2 },
      touch: { source: 'google', medium: 'cpc', campaign: 'outubro' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    joao = r.body.id;
    assert.equal(r.body.name, 'João Araújo');
    assert.deepEqual(r.body.emails.map((e: { email: string }) => e.email), ['joao@exemplo.com.br', 'joao.pessoal@exemplo.com']);
    assert.deepEqual(r.body.phones.map((p: { number: string }) => p.number), ['+5511987654321', '+12025550143']);
    assert.equal(r.body.custom.plano, 'ouro');
    assert.equal(r.body.owner.id, m['vendas1@a.test'], 'quem cria é o responsável');
    assert.equal(r.body.attribution.first.source, 'google');
    assert.deepEqual(r.body.birthday, { day: 29, month: 2, year: null });
  });

  test('valida e-mail, telefone, campo personalizado e data', async () => {
    const r = await sales1.post('/api/v1/contacts', {
      firstName: 'X', emails: [{ email: 'sem-arroba' }], phones: [{ number: '123' }],
    });
    assert.equal(r.status, 422);
    assert.deepEqual(r.body.errors.map((e: { field: string }) => e.field).sort(), ['emails.0.email', 'phones.0.number']);
    const c = await sales1.post('/api/v1/contacts', { firstName: 'X', custom: { plano: 'bronze' } });
    assert.equal(c.status, 422);
    assert.equal(c.body.errors[0].field, 'custom.plano');
    const d = await sales1.post('/api/v1/contacts', { firstName: 'X', birthday: { day: 31, month: 4 } });
    assert.equal(d.status, 422);
    const u = await sales1.post('/api/v1/contacts', { firstName: 'X', custom: { naoexiste: 1 } });
    assert.equal(u.status, 422);
  });

  test('busca ignora acentos e acha por e-mail e telefone', async () => {
    for (const q of ['joao araujo', 'JOÃO', 'exemplo.com.br', '98765']) {
      const r = await sales1.get(`/api/v1/contacts?q=${encodeURIComponent(q)}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.total, 1, `busca "${q}"`);
      assert.equal(r.body.items[0].id, joao);
    }
  });

  test('duplicado por e-mail ou telefone é avisado, e pode ser criado de propósito', async () => {
    const r = await sales1.post('/api/v1/contacts', { firstName: 'Outro', phones: [{ number: '11 98765 4321' }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.type, 'duplicate');
    assert.equal(r.body.duplicates[0].id, joao);
    assert.deepEqual(r.body.duplicates[0].matchedBy, ['phone']);
    const ok = await sales1.post('/api/v1/contacts', { firstName: 'Outro', phones: [{ number: '11 98765 4321' }], allowDuplicate: true });
    assert.equal(ok.status, 201);
    const dups = await sales1.get(`/api/v1/contacts/${joao}/duplicates`);
    assert.equal(dups.body.length, 1);
    assert.equal(dups.body[0].id, ok.body.id);
  });

  test('duplicado fora do alcance não revela o nome', async () => {
    const r = await sales3.post('/api/v1/contacts', { firstName: 'Tentativa', emails: [{ email: 'joao@exemplo.com.br' }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.duplicates[0].visible, false);
    assert.notEqual(r.body.duplicates[0].name, 'João Araújo');
  });

  test('alcance: comercial vê os seus; líder vê os da equipe; outra equipe e outra empresa não veem', async () => {
    const own = await sales2.post('/api/v1/contacts', { firstName: 'Cliente da Vendas2' });
    assert.equal(own.status, 201);
    assert.equal((await sales1.get(`/api/v1/contacts/${own.body.id}`)).status, 404, 'colega não abre por identificador');
    assert.equal((await sales1.get('/api/v1/contacts?q=Vendas2')).body.total, 0, 'nem acha na lista');
    assert.equal((await leader.get(`/api/v1/contacts/${own.body.id}`)).status, 200, 'líder vê a equipe');
    assert.equal((await sales3.get(`/api/v1/contacts/${joao}`)).status, 404, 'outra equipe não vê');
    assert.equal((await manager.get(`/api/v1/contacts/${own.body.id}`)).status, 200, 'gestor vê a empresa');
    assert.equal((await adminB.get(`/api/v1/contacts/${joao}`)).status, 404, 'outra empresa não vê');
    assert.equal((await sales1.patch(`/api/v1/contacts/${own.body.id}`, { firstName: 'Mudado' })).status, 404, 'nem edita');
  });

  test('comercial não atribui contato a outra pessoa; líder atribui dentro da equipe', async () => {
    const r = await sales1.post('/api/v1/contacts', { firstName: 'Atribuição', ownerId: m['vendas2@a.test'] });
    assert.equal(r.status, 422);
    const ok = await leader.post('/api/v1/contacts', { firstName: 'Atribuição', ownerId: m['vendas2@a.test'] });
    assert.equal(ok.status, 201);
    const out = await leader.post('/api/v1/contacts', { firstName: 'Fora', ownerId: m['vendas3@a.test'] });
    assert.equal(out.status, 422, 'líder não atribui a outra equipe');
  });

  test('visualizador lê e não escreve; excluir exige permissão', async () => {
    assert.equal((await viewer.get(`/api/v1/contacts/${joao}`)).status, 200);
    assert.equal((await viewer.post('/api/v1/contacts', { firstName: 'X' })).status, 403);
    assert.equal((await sales1.del(`/api/v1/contacts/${joao}`)).status, 403);
  });

  test('edição registra na linha do tempo só os nomes dos campos', async () => {
    const r = await sales1.patch(`/api/v1/contacts/${joao}`, { jobTitle: 'Diretor', phones: [{ number: '11 98765-4321' }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.jobTitle, 'Diretor');
    assert.equal(r.body.phones.length, 1);
    const t = await sales1.get(`/api/v1/records/contact/${joao}/timeline`);
    const upd = t.body.find((e: { kind: string }) => e.kind === 'contact.updated');
    assert.ok(upd.data.fields.includes('job_title'));
    assert.ok(upd.data.fields.includes('phones'));
    assert.ok(!JSON.stringify(upd.data).includes('Diretor'), 'o valor não vai para a linha do tempo');
  });

  test('mesclagem preserva histórico, negócios e notas, e fica auditada', async () => {
    const a = await manager.post('/api/v1/contacts', { firstName: 'Maria', emails: [{ email: 'maria@x.com' }], touch: { source: 'indicação' } });
    const b = await manager.post('/api/v1/contacts', { firstName: 'Maria', lastName: 'Souza', phones: [{ number: '21 99999-0000' }], allowDuplicate: true, touch: { source: 'instagram' } });
    await manager.post(`/api/v1/records/contact/${b.body.id}/notes`, { body: 'Prefere contato à tarde' });
    const pipes = await manager.get('/api/v1/pipelines');
    const deal = await manager.post('/api/v1/deals', { pipelineId: pipes.body[0]?.id ?? (await manager.post('/api/v1/pipelines', { name: 'Vendas' })).body.id, title: 'Venda Maria', contactId: b.body.id });
    assert.equal(deal.status, 201, JSON.stringify(deal.body));
    const r = await admin.post(`/api/v1/contacts/${a.body.id}/merge`, { mergeId: b.body.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.lastName, 'Souza', 'o que faltava vem do outro');
    assert.equal(r.body.emails.length, 1);
    assert.equal(r.body.phones.length, 1);
    assert.equal(r.body.counts.deals, 1);
    assert.equal(r.body.attribution.first.source, 'indicação', 'a primeira origem é a mais antiga');
    assert.equal(r.body.attribution.touches, 2);
    assert.equal((await admin.get(`/api/v1/contacts/${b.body.id}`)).status, 404);
    const notes = await admin.get(`/api/v1/records/contact/${a.body.id}/notes`);
    assert.equal(notes.body[0].body, 'Prefere contato à tarde');
    const audit = await admin.get('/api/v1/audit?action=contact.merged');
    assert.equal(audit.body.items.length, 1);
    const snap = await f.admin.query('select snapshot from contact_merges where merged_contact_id = $1', [b.body.id]);
    assert.equal(snap.rows[0].snapshot.last_name, 'Souza', 'cópia do contato mesclado guardada');
    assert.equal((await manager.post(`/api/v1/contacts/${a.body.id}/merge`, { mergeId: b.body.id })).status, 404);
  });

  test('consentimento por canal com origem e data; opt-out entra na supressão', async () => {
    const r = await sales1.post(`/api/v1/contacts/${joao}/consents`, { channel: 'email', status: 'granted', source: 'Formulário do site' });
    assert.equal(r.status, 200);
    assert.equal(r.body.consents[0].status, 'granted');
    const out = await sales1.post(`/api/v1/contacts/${joao}/consents`, { channel: 'email', status: 'revoked', source: 'Pediu por telefone' });
    assert.equal(out.body.consents.find((c: { channel: string }) => c.channel === 'email').status, 'revoked');
    const sup = await f.admin.query("select value from suppression_list where tenant_id = $1 and channel = 'email' order by value", [f.tenantA]);
    // Ordenado aqui: a ordem do banco depende da collation do servidor.
    assert.deepEqual(sup.rows.map((x) => x.value).sort(), out.body.emails.map((x: { email: string }) => x.email).sort());
    const hist = await sales1.get(`/api/v1/contacts/${joao}/consents`);
    assert.equal(hist.body.length, 2, 'o histórico guarda as duas mudanças');
  });

  test('primeira origem nunca é sobrescrita; a última acompanha', async () => {
    await sales1.post(`/api/v1/contacts/${joao}/attribution`, { source: 'facebook', medium: 'social' });
    const r = await sales1.get(`/api/v1/contacts/${joao}`);
    assert.equal(r.body.attribution.first.source, 'google');
    assert.equal(r.body.attribution.last.source, 'facebook');
    assert.equal(r.body.attribution.last.campaign, null, 'campo ausente fica vazio');
  });

  test('paginação e ordenação', async () => {
    for (let i = 0; i < 12; i++) await manager.post('/api/v1/contacts', { firstName: `Paginado ${String(i).padStart(2, '0')}` });
    const p1 = await manager.get('/api/v1/contacts?q=Paginado&sort=name&dir=asc&pageSize=5');
    assert.equal(p1.body.total, 12);
    assert.equal(p1.body.items.length, 5);
    assert.equal(p1.body.items[0].firstName, 'Paginado 00');
    const p3 = await manager.get('/api/v1/contacts?q=Paginado&sort=name&dir=asc&pageSize=5&page=3');
    assert.equal(p3.body.items.length, 2);
    assert.equal(p3.body.items[1].firstName, 'Paginado 11');
  });
});

// ---------------------------------------------------------------------------

describe('funis e negócios', () => {
  let pipeline: { id: string; stages: { id: string; name: string; kind: string }[] };
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!.id;
  let deal: string;

  test('funil novo nasce com as etapas padrão e só administrador configura', async () => {
    assert.equal((await sales1.post('/api/v1/pipelines', { name: 'Proibido' })).status, 403);
    const r = await manager.post('/api/v1/pipelines', { name: 'Vendas B2B' });
    assert.equal(r.status, 201);
    pipeline = r.body;
    assert.deepEqual(pipeline.stages.map((s) => s.kind), ['open', 'open', 'open', 'open', 'won', 'lost']);
    const bad = await manager.put(`/api/v1/pipelines/${pipeline.id}/stages`, { stages: [{ name: 'A', kind: 'open' }, { name: 'B', kind: 'open' }, { name: 'C', kind: 'won' }] });
    assert.equal(bad.status, 422, 'sem etapa de perda é recusado');
  });

  test('negócio começa na primeira etapa, com histórico', async () => {
    const r = await sales1.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'Licenças anuais' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    deal = r.body.id;
    assert.equal(r.body.stage.name, 'Qualificação');
    assert.equal(r.body.history.length, 1);
    assert.equal(r.body.owner.id, m['vendas1@a.test']);
  });

  test('previsão de fechamento volta como data simples (AAAA-MM-DD) em todo lugar', async () => {
    const r = await sales1.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'Com previsão', expectedCloseDate: '2026-11-15', valueCents: 75_000_000 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.expectedCloseDate, '2026-11-15');
    assert.equal((await sales1.get(`/api/v1/deals/${r.body.id}`)).body.expectedCloseDate, '2026-11-15');
    const up = await sales1.patch(`/api/v1/deals/${r.body.id}`, { expectedCloseDate: '2026-12-01' });
    assert.equal(up.body.expectedCloseDate, '2026-12-01');
    const list = await sales1.get(`/api/v1/deals?pipelineId=${pipeline.id}&q=${encodeURIComponent('Com previsão')}`);
    const item = (list.body.items ?? list.body).find((d: { id: string }) => d.id === r.body.id);
    assert.equal(item.expectedCloseDate, '2026-12-01');
    assert.equal((await admin.req('DELETE', `/api/v1/deals/${r.body.id}`)).status, 204);
  });

  test('etapa com campo obrigatório barra a mudança e diz o que falta', async () => {
    const r = await sales1.post(`/api/v1/deals/${deal}/move`, { stageId: stage('Proposta') });
    assert.equal(r.status, 422);
    assert.equal(r.body.type, 'stage-requirements');
    assert.equal(r.body.errors[0].field, 'valueCents');
    const still = await sales1.get(`/api/v1/deals/${deal}`);
    assert.equal(still.body.stage.name, 'Qualificação', 'nada mudou');
    await sales1.patch(`/api/v1/deals/${deal}`, { valueCents: 150000 });
    const ok = await sales1.post(`/api/v1/deals/${deal}/move`, { stageId: stage('Proposta') });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.history.length, 2);
    assert.equal(ok.body.history[0].to.name, 'Proposta');
    assert.equal((await sales1.patch(`/api/v1/deals/${deal}`, { valueCents: 0 })).status, 422, 'a etapa atual continua exigindo o valor');
  });

  test('regra de transição limita os destinos', async () => {
    const r = await manager.put(`/api/v1/pipelines/${pipeline.id}/transitions`, { rules: [{ fromStageId: stage('Proposta'), toStageId: stage('Negociação') }] });
    assert.equal(r.status, 200);
    const bad = await sales1.post(`/api/v1/deals/${deal}/move`, { stageId: stage('Ganho') });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.type, 'transition-not-allowed');
    assert.equal((await sales1.post(`/api/v1/deals/${deal}/move`, { stageId: stage('Negociação') })).status, 200);
    await manager.put(`/api/v1/pipelines/${pipeline.id}/transitions`, { rules: [] });
  });

  test('perda exige motivo quando há motivos cadastrados; ganho fecha com data', async () => {
    const reason = await manager.post('/api/v1/outcome-reasons', { kind: 'lost', name: 'Preço' });
    assert.equal(reason.status, 201);
    const no = await sales1.post(`/api/v1/deals/${deal}/move`, { stageId: stage('Perdido') });
    assert.equal(no.status, 422);
    const lost = await sales1.post(`/api/v1/deals/${deal}/move`, { stageId: stage('Perdido'), reasonId: reason.body.id, note: 'Concorrente mais barato' });
    assert.equal(lost.status, 200);
    assert.equal(lost.body.status, 'lost');
    assert.equal(lost.body.outcomeReason.name, 'Preço');
    const won = await sales1.post(`/api/v1/deals/${deal}/move`, { stageId: stage('Ganho') });
    assert.equal(won.body.status, 'won');
    assert.ok(won.body.closedAt);
    assert.equal(won.body.outcomeReason, null);
    const tl = await sales1.get(`/api/v1/records/deal/${deal}/timeline`);
    assert.deepEqual(tl.body.slice(0, 2).map((e: { kind: string }) => e.kind), ['deal.won', 'deal.lost']);
  });

  test('itens de produto definem o valor', async () => {
    assert.equal((await sales1.post('/api/v1/products', { name: 'X' })).status, 403);
    const p = await manager.post('/api/v1/products', { name: 'Implantação', sku: 'IMP-1', priceCents: 250000 });
    assert.equal(p.status, 201);
    const d = await sales1.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'Com itens' });
    const r = await sales1.put(`/api/v1/deals/${d.body.id}/items`, { items: [{ productId: p.body.id, quantity: 2, discountCents: 50000 }, { name: 'Treinamento', quantity: 1, unitPriceCents: 80000 }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.valueCents, 2 * 250000 - 50000 + 80000);
    assert.equal(r.body.items[0].name, 'Implantação');
  });

  test('quadro: totais por etapa e alcance do comercial', async () => {
    await sales2.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'Do colega', valueCents: 1000 });
    const mine = await sales1.get(`/api/v1/deals/board?pipelineId=${pipeline.id}`);
    assert.equal(mine.status, 200);
    const titles = mine.body.stages.flatMap((s: { deals: { title: string }[] }) => s.deals.map((d) => d.title));
    assert.ok(!titles.includes('Do colega'));
    const all = await manager.get(`/api/v1/deals/board?pipelineId=${pipeline.id}`);
    const q = all.body.stages.find((s: { name: string }) => s.name === 'Qualificação');
    const direct = await f.admin.query<{ n: number; v: string }>(
      "select count(*)::int as n, coalesce(sum(value_cents), 0)::text as v from deals where stage_id = $1", [q.id]);
    assert.equal(q.count, direct.rows[0]!.n);
    assert.equal(q.totalCents, Number(direct.rows[0]!.v));
  });

  test('participante vê o negócio do colega', async () => {
    const d = await sales2.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'Compartilhado', participantIds: [m['vendas1@a.test']] });
    assert.equal((await sales1.get(`/api/v1/deals/${d.body.id}`)).status, 200);
    assert.equal((await sales3.get(`/api/v1/deals/${d.body.id}`)).status, 404);
  });

  test('comercial não troca o responsável; gestor troca e fica auditado', async () => {
    const d = await sales1.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'Atribuir' });
    assert.equal((await sales1.patch(`/api/v1/deals/${d.body.id}`, { ownerId: m['vendas2@a.test'] })).status, 403);
    const r = await manager.patch(`/api/v1/deals/${d.body.id}`, { ownerId: m['vendas2@a.test'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.owner.id, m['vendas2@a.test']);
    assert.equal((await sales1.get(`/api/v1/deals/${d.body.id}`)).status, 404, 'quem perdeu o negócio deixa de vê-lo');
  });

  test('funil restrito some da interface, da API e da exportação', async () => {
    const r = await manager.post('/api/v1/pipelines', { name: 'Diretoria' });
    const secret = r.body;
    const d = await manager.post('/api/v1/deals', { pipelineId: secret.id, title: 'Negócio sigiloso', ownerId: m['vendas3@a.test'] });
    assert.equal(d.status, 201);
    await manager.patch(`/api/v1/pipelines/${secret.id}`, { restricted: true, access: { teamIds: [teamAlpha], membershipIds: [] } });
    // vendas3 é responsável pelo negócio, mas a equipe dele não está na lista.
    assert.ok(!(await sales3.get('/api/v1/pipelines')).body.some((p: { id: string }) => p.id === secret.id), 'não aparece na lista');
    assert.equal((await sales3.get(`/api/v1/pipelines/${secret.id}`)).status, 404);
    assert.equal((await sales3.get(`/api/v1/deals/${d.body.id}`)).status, 404);
    assert.equal((await sales3.get(`/api/v1/deals/board?pipelineId=${secret.id}`)).status, 404);
    assert.equal((await sales3.get(`/api/v1/deals?q=sigiloso`)).body.total, 0);
    assert.equal((await sales3.post('/api/v1/deals', { pipelineId: secret.id, title: 'Entrar' })).status, 404);
    // O líder da equipe Alfa enxerga o funil.
    assert.ok((await leader.get('/api/v1/pipelines')).body.some((p: { id: string }) => p.id === secret.id));
    // Exportação: financeiro-like com deals:export, mas sem acesso ao funil.
    await createUser(f, 'financeiro@a.test', [{ tenant: f.tenantA, role: 'finance' }]);
    const fin = await login('financeiro@a.test');
    const csv = await fin.raw(`/api/v1/deals/export.csv`);
    assert.equal(csv.status, 200);
    assert.ok(!csv.body.toString().includes('sigiloso'));
    const filtered = await fin.raw(`/api/v1/deals/export.csv?pipelineId=${secret.id}`);
    assert.equal(filtered.body.toString().trim().split('\r\n').length, 1, 'só o cabeçalho');
    const managerCsv = await manager.raw(`/api/v1/deals/export.csv`);
    assert.ok(managerCsv.body.toString().includes('sigiloso'), 'quem administra funis exporta');
  });

  test('etapa com negócios não é removida', async () => {
    const stages = pipeline.stages.filter((s) => s.name !== 'Qualificação').map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
    const r = await manager.put(`/api/v1/pipelines/${pipeline.id}/stages`, { stages });
    assert.equal(r.status, 409);
  });

  test('outra empresa não usa funil nem negócio daqui', async () => {
    assert.equal((await adminB.get(`/api/v1/pipelines/${pipeline.id}`)).status, 404);
    assert.equal((await adminB.get(`/api/v1/deals/${deal}`)).status, 404);
    assert.equal((await adminB.post('/api/v1/deals', { pipelineId: pipeline.id, title: 'x' })).status, 404);
  });
});

// ---------------------------------------------------------------------------

describe('leads e distribuição', () => {
  let pipelineId: string;

  before(async () => {
    pipelineId = (await manager.post('/api/v1/pipelines', { name: 'Leads do site' })).body.id;
  });

  test('rodízio distribui por igual mesmo com entradas simultâneas', async () => {
    const rule = await manager.post('/api/v1/assignment-rules', {
      name: 'Site', sourceFilter: 'site', teamId: teamAlpha, memberIds: [m['vendas1@a.test'], m['vendas2@a.test'], m['lider@a.test']],
    });
    assert.equal(rule.status, 201, JSON.stringify(rule.body));
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
      manager.post('/api/v1/leads', { title: `Lead ${i}`, source: 'site', contact: { firstName: `Pessoa ${i}`, email: `pessoa${i}@site.com` } })));
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.find((r) => r.status !== 201)?.body));
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.body.owner.id, (counts.get(r.body.owner.id) ?? 0) + 1);
    assert.deepEqual([...counts.values()].sort(), [10, 10, 10]);
    assert.ok(results.every((r) => r.body.team.id === teamAlpha));
    const n = await sales1.get('/api/v1/notifications?unread=true');
    assert.ok(n.body.unread >= 10, 'quem recebe o lead é avisado');
  });

  test('lead de outra origem não entra no rodízio do site', async () => {
    const r = await manager.post('/api/v1/leads', { title: 'Evento', source: 'feira', contact: { firstName: 'Visitante' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.owner, null);
  });

  test('contato existente é reaproveitado e a origem fica registrada', async () => {
    const r = await manager.post('/api/v1/leads', { title: 'Voltou', source: 'site', contact: { firstName: 'Repetido', email: 'PESSOA1@site.com' }, touch: { source: 'newsletter' } });
    const first = await f.admin.query<{ contact_id: string }>("select contact_id from leads where title = 'Lead 1'");
    assert.equal(r.body.contact.id, first.rows[0]!.contact_id);
    const c = await manager.get(`/api/v1/contacts/${r.body.contact.id}`);
    assert.equal(c.body.attribution.last.source, 'newsletter');
  });

  test('qualificar cria o negócio ligado ao lead e ao contato', async () => {
    const lead = (await sales1.get('/api/v1/leads')).body.items[0];
    const r = await sales1.post(`/api/v1/leads/${lead.id}/qualify`, { pipelineId, valueCents: 5000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.lead.status, 'qualified');
    const d = await sales1.get(`/api/v1/deals/${r.body.dealId}`);
    assert.equal(d.body.contact.id, lead.contact.id);
    assert.equal(d.body.leadId, lead.id);
    assert.equal((await sales1.post(`/api/v1/leads/${lead.id}/qualify`, { pipelineId })).status, 409);
  });

  test('comercial não vê nem atribui lead do colega', async () => {
    const other = (await sales2.get('/api/v1/leads')).body.items[0];
    assert.equal((await sales1.get(`/api/v1/leads/${other.id}`)).status, 404);
    assert.equal((await sales1.post(`/api/v1/leads/${other.id}/assign`, { ownerId: m['vendas1@a.test'] })).status, 403);
    const r = await leader.post(`/api/v1/leads/${other.id}/assign`, { ownerId: m['vendas1@a.test'] });
    assert.equal(r.status, 200);
    assert.equal((await sales1.get(`/api/v1/leads/${other.id}`)).status, 200);
  });

  test('descartar pede motivo e pode ser desfeito', async () => {
    const lead = (await sales1.get('/api/v1/leads')).body.items[0];
    assert.equal((await sales1.post(`/api/v1/leads/${lead.id}/disqualify`, {})).status, 422);
    const r = await sales1.post(`/api/v1/leads/${lead.id}/disqualify`, { reason: 'Sem orçamento' });
    assert.equal(r.body.status, 'disqualified');
    const back = await sales1.post(`/api/v1/leads/${lead.id}/reopen`);
    assert.equal(back.body.status, 'working');
  });
});

// ---------------------------------------------------------------------------

describe('tarefas e agenda', () => {
  test('recorrência semanal mantém o horário local e respeita a contagem', async () => {
    const r = await sales1.post('/api/v1/activities', {
      type: 'meeting', title: 'Reunião semanal', startsAt: '2030-01-07T12:00:00Z', endsAt: '2030-01-07T13:00:00Z',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3], count: 6 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const list = await sales1.get('/api/v1/activities?from=2030-01-01T00:00:00Z&to=2030-03-01T00:00:00Z');
    const series = list.body.filter((a: { title: string }) => a.title === 'Reunião semanal');
    assert.equal(series.length, 6);
    assert.deepEqual(series.map((a: { startsAt: string }) => a.startsAt.slice(0, 10)),
      ['2030-01-07', '2030-01-09', '2030-01-14', '2030-01-16', '2030-01-21', '2030-01-23']);
    assert.ok(series.every((a: { startsAt: string; endsAt: string }) => new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime() === 3_600_000));
  });

  test('editar "esta e as seguintes" desloca a série; excluir as seguintes encerra', async () => {
    const list = await sales1.get('/api/v1/activities?from=2030-01-01T00:00:00Z&to=2030-03-01T00:00:00Z');
    const third = list.body.filter((a: { title: string }) => a.title === 'Reunião semanal')[2];
    const r = await sales1.patch(`/api/v1/activities/${third.id}`, { startsAt: '2030-01-14T14:00:00Z', title: 'Reunião (nova hora)', scope: 'following' });
    assert.equal(r.status, 200);
    const after = (await sales1.get('/api/v1/activities?from=2030-01-01T00:00:00Z&to=2030-03-01T00:00:00Z')).body
      .filter((a: { seriesId: string }) => a.seriesId === third.seriesId);
    assert.deepEqual(after.map((a: { startsAt: string }) => a.startsAt.slice(11, 16)), ['12:00', '12:00', '14:00', '14:00', '14:00', '14:00']);
    assert.equal(after.filter((a: { title: string }) => a.title === 'Reunião (nova hora)').length, 4);
    assert.equal((await sales1.del(`/api/v1/activities/${after[4].id}?scope=following`)).status, 204);
    const left = (await sales1.get('/api/v1/activities?from=2030-01-01T00:00:00Z&to=2030-03-01T00:00:00Z')).body
      .filter((a: { seriesId: string }) => a.seriesId === third.seriesId);
    assert.equal(left.length, 4);
  });

  test('série sem fim é estendida pelo despachante', async () => {
    const start = new Date(Date.now() + 86_400_000);
    const r = await sales1.post('/api/v1/activities', { title: 'Diária', startsAt: start.toISOString(), recurrence: { freq: 'daily', interval: 1 } });
    const seriesId = r.body.seriesId;
    const before = await f.admin.query<{ n: number }>('select count(*)::int as n from activities where series_id = $1', [seriesId]);
    assert.ok(before.rows[0]!.n >= 300 && before.rows[0]!.n <= 500);
    await f.admin.query("update activity_series set horizon_until = now() + interval '30 days' where id = $1", [seriesId]);
    await f.admin.query("delete from activities where series_id = $1 and starts_at > now() + interval '30 days'", [seriesId]);
    const run = await dispatcher().runOnce();
    assert.ok(run.seriesExtended > 300);
    const idx = await f.admin.query<{ max: number; n: number }>('select max(series_index) as max, count(*)::int as n from activities where series_id = $1', [seriesId]);
    assert.equal(idx.rows[0]!.max, idx.rows[0]!.n - 1, 'os índices continuam sem buraco');
  });

  test('lembrete vira notificação uma vez; concluir atualiza o último contato', async () => {
    const c = await sales1.post('/api/v1/contacts', { firstName: 'Lembrar' });
    const a = await sales1.post('/api/v1/activities', {
      type: 'call', title: 'Ligar para o cliente', startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), reminderMinutes: 10, contactId: c.body.id,
    });
    assert.equal(a.status, 201);
    const before = (await sales1.get('/api/v1/notifications')).body.items.filter((n: { title: string }) => n.title === 'Ligar para o cliente').length;
    assert.ok((await dispatcher().runOnce()).reminders >= 1);
    await dispatcher().runOnce();
    const after = (await sales1.get('/api/v1/notifications')).body.items.filter((n: { title: string }) => n.title === 'Ligar para o cliente').length;
    assert.equal(after - before, 1);
    assert.equal((await sales2.get('/api/v1/notifications')).body.items.filter((n: { title: string }) => n.title === 'Ligar para o cliente').length, 0);
    const done = await sales1.post(`/api/v1/activities/${a.body.id}/status`, { status: 'done' });
    assert.equal(done.body.status, 'done');
    assert.ok((await sales1.get(`/api/v1/contacts/${c.body.id}`)).body.lastActivityAt);
  });

  test('tarefas de colega não aparecem; outra empresa não abre', async () => {
    const a = await sales2.post('/api/v1/activities', { title: 'Privada' });
    assert.equal((await sales1.get(`/api/v1/activities/${a.body.id}`)).status, 404);
    assert.equal((await leader.get(`/api/v1/activities/${a.body.id}`)).status, 200);
    assert.equal((await adminB.get(`/api/v1/activities/${a.body.id}`)).status, 404);
    assert.equal((await sales1.post('/api/v1/activities', { title: 'Sem data', reminderMinutes: 5 })).status, 422);
  });
});

// ---------------------------------------------------------------------------

describe('arquivos', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  let contact: string;
  let fileId: string;

  before(async () => {
    contact = (await sales1.post('/api/v1/contacts', { firstName: 'Com arquivo' })).body.id;
  });

  test('aceita pelo conteúdo e entrega só por endereço assinado', async () => {
    const r = await sales1.upload(`/api/v1/records/contact/${contact}/files`, 'proposta comercial.pdf', pdf);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    fileId = r.body.id;
    assert.equal(r.body.contentType, 'application/pdf');
    const url = await sales1.get(`/api/v1/files/${fileId}/url`);
    assert.equal(url.status, 200);
    const dl = await new Browser(app).raw(url.body.url);
    assert.equal(dl.status, 200, 'o endereço assinado basta, sem sessão');
    assert.deepEqual(dl.body, pdf);
    assert.match(String(dl.headers['content-disposition']), /^attachment/);
    // Troca um caractere do meio da assinatura (o último carrega bits de preenchimento).
    const sig = url.body.url.lastIndexOf('.') + 5;
    const tampered = url.body.url.slice(0, sig) + (url.body.url[sig] === 'A' ? 'B' : 'A') + url.body.url.slice(sig + 1);
    assert.equal((await new Browser(app).raw(tampered)).status, 404);
  });

  test('recusa HTML, executável e extensão falsa', async () => {
    const html = await sales1.upload(`/api/v1/records/contact/${contact}/files`, 'pagina.html', '<html><script>alert(1)</script></html>');
    assert.equal(html.status, 422);
    const fake = await sales1.upload(`/api/v1/records/contact/${contact}/files`, 'nota.pdf', '<script>alert(1)</script>');
    assert.equal(fake.status, 422, 'extensão .pdf sem conteúdo de PDF');
    const exe = await sales1.upload(`/api/v1/records/contact/${contact}/files`, 'x.exe', Buffer.from('4d5a90000300000004000000ffff0000', 'hex'));
    assert.equal(exe.status, 422);
  });

  test('arquivo de registro fora do alcance ou de outra empresa devolve 404', async () => {
    assert.equal((await sales3.get(`/api/v1/files/${fileId}/url`)).status, 404);
    assert.equal((await adminB.get(`/api/v1/files/${fileId}/url`)).status, 404);
    assert.equal((await sales3.get(`/api/v1/records/contact/${contact}/files`)).status, 404);
  });

  test('endereço vencido não serve; arquivo removido some', async () => {
    const url = (await sales1.get(`/api/v1/files/${fileId}/url`)).body.url as string;
    assert.equal((await sales1.del(`/api/v1/files/${fileId}`)).status, 204);
    assert.equal((await new Browser(app).raw(url)).status, 404);
    assert.equal((await sales1.get(`/api/v1/records/contact/${contact}/files`)).body.length, 0);
  });
});

// ---------------------------------------------------------------------------

describe('importação e exportação', () => {
  test('CSV de 10 mil linhas com erro por linha, duplicados e etiquetas', async () => {
    const lines = ['Nome;E-mail;Telefone;Empresa;Etiquetas;Aniversário'];
    for (let i = 0; i < 10_000; i++) {
      const email = i === 17 ? 'invalido' : `importado${i}@lote.com`;
      const name = i === 42 ? '' : `Importado ${i}`;
      lines.push(`${name};${email};11 9${String(10000000 + i).slice(-8)};Empresa ${i % 50};lote, csv;${i === 99 ? '31/02' : '15/03'}`);
    }
    lines.push('Duplicado;importado5@lote.com;;;;');
    const up = await admin.upload('/api/v1/imports/upload?entity=contacts', 'contatos.csv', Buffer.from(lines.join('\r\n'), 'utf8'), 'text/csv');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.totalRows, 10_001);
    assert.deepEqual(up.body.suggestedMapping, { Nome: 'fullName', 'E-mail': 'email', Telefone: 'phone', Empresa: 'organization', Etiquetas: 'tags', 'Aniversário': 'birthday' });
    const start = await admin.post('/api/v1/imports', { fileId: up.body.fileId, entity: 'contacts', mapping: up.body.suggestedMapping, options: { duplicate: 'skip' } });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal(start.body.status, 'pending');
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      await dispatcher().runOnce(60_000);
      const s = await admin.get(`/api/v1/imports/${start.body.id}`);
      if (s.body.status === 'done') break;
    }
    const s = await admin.get(`/api/v1/imports/${start.body.id}`);
    assert.equal(s.body.status, 'done', JSON.stringify(s.body));
    assert.equal(s.body.processedRows, 10_001);
    assert.equal(s.body.createdCount, 9_999, 'todas menos a sem nome e a duplicada');
    assert.equal(s.body.errorCount, 1);
    assert.equal(s.body.skippedCount, 1);
    const errs = await admin.get(`/api/v1/imports/${start.body.id}/errors`);
    const byRow = new Map(errs.body.map((e: { row: number; errors: { message: string }[] }) => [e.row, e]));
    assert.ok(byRow.has(44), 'linha 44 da planilha (nome vazio)');
    assert.ok(byRow.has(10_002), 'a duplicada fica registrada');
    const warn = await f.admin.query<{ errors: { field: string }[] }>('select errors from import_rows where import_id = $1 and row_number = 19', [start.body.id]);
    assert.equal(warn.rows[0]!.errors[0]!.field, 'email', 'linha 19: e-mail inválido registrado, contato criado com o telefone');
    const tags = await f.admin.query<{ n: number }>("select count(*)::int as n from contact_tags ct join tags t on t.id = ct.tag_id where t.name = 'lote' and t.tenant_id = $1", [f.tenantA]);
    assert.equal(tags.rows[0]!.n, 9_999);
    const orgs = await f.admin.query<{ n: number }>("select count(*)::int as n from organizations where name like 'Empresa %' and tenant_id = $1", [f.tenantA]);
    assert.equal(orgs.rows[0]!.n, 50, 'organização repetida é reaproveitada');
    assert.ok(Date.now() - t0 < 240_000);
  });

  test('importação retomada depois de queda não repete linhas', async () => {
    const lines = ['Nome;E-mail'];
    for (let i = 0; i < 1200; i++) lines.push(`Retomada ${i};retomada${i}@x.com`);
    const up = await admin.upload('/api/v1/imports/upload?entity=contacts', 'retomada.csv', lines.join('\n'), 'text/csv');
    const start = await admin.post('/api/v1/imports', { fileId: up.body.fileId, entity: 'contacts', mapping: up.body.suggestedMapping });
    const io = app.get((await import('../src/crm/import-export.service.js')).ImportExportService);
    await f.admin.query("update imports set status = 'processing', locked_until = now() + interval '1 minute' where id = $1", [start.body.id]);
    await io.processBatch(f.tenantA, start.body.id);
    // Simula a queda: a trava vence com o progresso gravado no meio.
    await f.admin.query('update imports set locked_until = now() - interval \'1 second\' where id = $1', [start.body.id]);
    for (let i = 0; i < 10; i++) await dispatcher().runOnce(60_000);
    const s = await admin.get(`/api/v1/imports/${start.body.id}`);
    assert.equal(s.body.status, 'done');
    assert.equal(s.body.createdCount, 1200);
    const n = await f.admin.query<{ n: number }>("select count(*)::int as n from contacts where first_name = 'Retomada' and tenant_id = $1", [f.tenantA]);
    assert.equal(n.rows[0]!.n, 1200);
  });

  test('comercial não importa nem exporta', async () => {
    assert.equal((await sales1.upload('/api/v1/imports/upload', 'x.csv', 'Nome\nA', 'text/csv')).status, 403);
    assert.equal((await sales1.raw('/api/v1/contacts/export.csv')).status, 403);
  });

  test('exportação respeita o alcance e fica registrada', async () => {
    await createUser(f, 'mkt@a.test', [{ tenant: f.tenantA, role: 'marketing' }]);
    const mkt = await login('mkt@a.test');
    const r = await mkt.raw('/api/v1/contacts/export.csv');
    assert.equal(r.status, 200);
    const text = r.body.toString('utf8');
    assert.ok(text.startsWith('﻿ID;Nome'));
    const rows = text.trim().split('\r\n').length - 1;
    const total = await f.admin.query<{ n: number }>('select count(*)::int as n from contacts where tenant_id = $1 and anonymized_at is null', [f.tenantA]);
    assert.equal(rows, total.rows[0]!.n);
    const reg = await f.admin.query<{ row_count: number }>("select row_count from exports where entity = 'contacts' and tenant_id = $1 order by created_at desc limit 1", [f.tenantA]);
    assert.equal(reg.rows[0]!.row_count, rows);
  });
});

// ---------------------------------------------------------------------------

describe('privacidade do titular', () => {
  test('exporta tudo e anonimiza, com auditoria; exige permissão e 2FA', async () => {
    const c = await manager.post('/api/v1/contacts', {
      firstName: 'Titular', lastName: 'Teste', emails: [{ email: 'titular@lgpd.com' }], phones: [{ number: '11 91234-5678' }],
      touch: { source: 'google', landingPage: 'https://site.com/?email=titular@lgpd.com' },
    });
    await manager.post(`/api/v1/records/contact/${c.body.id}/notes`, { body: 'CPF 123' });
    assert.equal((await manager.get(`/api/v1/privacy/contacts/${c.body.id}/export`)).status, 403);
    const ex = await admin.get(`/api/v1/privacy/contacts/${c.body.id}/export`);
    assert.equal(ex.status, 200);
    assert.equal(ex.body.emails[0].email, 'titular@lgpd.com');
    assert.equal(ex.body.notes[0].body, 'CPF 123');
    assert.equal((await admin.post(`/api/v1/privacy/contacts/${c.body.id}/anonymize`, {})).status, 422, 'exige confirmação');
    const an = await admin.post(`/api/v1/privacy/contacts/${c.body.id}/anonymize`, { confirm: true });
    assert.equal(an.status, 200);
    const after = await admin.get(`/api/v1/contacts/${c.body.id}`);
    assert.equal(after.body.name, 'Titular anonimizado');
    assert.equal(after.body.emails.length, 0);
    assert.equal(after.body.attribution.first.source, 'google', 'a origem sem dado pessoal continua para os números');
    assert.equal(after.body.attribution.first.landingPage, null);
    const left = await f.admin.query<{ n: number }>(
      `select (select count(*) from notes where contact_id = $1) + (select count(*) from contact_emails where contact_id = $1)
            + (select count(*) from timeline_entries where contact_id = $1) as n`, [c.body.id]);
    assert.equal(Number(left.rows[0]!.n), 0);
    assert.equal((await admin.patch(`/api/v1/contacts/${c.body.id}`, { firstName: 'Volta' })).status, 409);
    const audit = await admin.get('/api/v1/audit?action=privacy.anonymized');
    assert.equal(audit.body.items.length, 1);
  });
});

// ---------------------------------------------------------------------------

describe('painel', () => {
  test('números batem com a consulta direta e respeitam o alcance', async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const all = await manager.get(`/api/v1/dashboard?from=${from}&to=${to}`);
    assert.equal(all.status, 200);
    const d = await f.admin.query<Record<string, string>>(
      `select count(*) filter (where status = 'open') as open, count(*) filter (where status = 'won' and closed_at between $2 and $3) as won,
              coalesce(sum(value_cents) filter (where status = 'open'), 0) as open_value
         from deals where tenant_id = $1`, [f.tenantA, from, to]);
    assert.equal(all.body.deals.openCount, Number(d.rows[0]!.open));
    assert.equal(all.body.deals.wonCount, Number(d.rows[0]!.won));
    assert.equal(all.body.deals.openValueCents, Number(d.rows[0]!.open_value));
    const mine = await sales1.get(`/api/v1/dashboard?from=${from}&to=${to}`);
    const own = await f.admin.query<{ n: string }>(
      `select count(*) as n from deals d where tenant_id = $1 and status = 'open' and (owner_membership_id = $2
         or exists (select 1 from deal_participants p where p.deal_id = d.id and p.membership_id = $2))
         and exists (select 1 from pipelines pl where pl.id = d.pipeline_id and (not pl.restricted or exists (
           select 1 from pipeline_access pa where pa.pipeline_id = pl.id and (pa.membership_id = $2 or pa.team_id = $3))))`,
      [f.tenantA, m['vendas1@a.test'], teamAlpha]);
    assert.equal(mine.body.deals.openCount, Number(own.rows[0]!.n));
    assert.ok(mine.body.deals.openCount < all.body.deals.openCount);
    const pipe = (await manager.get('/api/v1/pipelines')).body[0];
    const byPipe = await manager.get(`/api/v1/dashboard?from=${from}&to=${to}&pipelineId=${pipe.id}&ownerId=${m['vendas1@a.test']}`);
    assert.equal(byPipe.status, 200, 'filtro por funil e pessoa');
    assert.ok(byPipe.body.deals.byStage.length > 0);
    const v = await viewer.get(`/api/v1/dashboard?from=${from}&to=${to}`);
    assert.equal(v.body.activities, undefined, 'sem permissão de tarefas, o bloco não aparece');
  });
});
