import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { render } from '../src/domain/automations.js';
import { DispatcherService } from '../src/crm/dispatcher.service.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';
import { FakeEvolution, FakeSmtp } from './fakes.js';

const KEY = 'chave-global-automacoes';

let f: Fixture;
let app: NestFastifyApplication;
let evo: FakeEvolution;
let smtp: FakeSmtp;
let hookServer: Server;
let hookUrl = '';
const hooks: unknown[] = [];
let admin: Browser;
let sales: Browser;
let wa: string;
let mail: string;
let instance: string;
let token: string;
let pipelineId: string;
let stages: Record<string, string>;
let tagVip: string;
let ip = 0;

const tick = async () => {
  // Eventos com menos de 2 s ainda não são lidos (transações em andamento).
  await new Promise((r) => setTimeout(r, 2100));
  return app.get(DispatcherService).runOnce();
};

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.80.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

async function rule(body: Record<string, unknown>): Promise<string> {
  const r = await admin.post('/api/v1/automations', body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

async function runsOf(ruleId: string) {
  return (await admin.get(`/api/v1/automations/runs?ruleId=${ruleId}`)).body as { status: string; error: string | null; log: { action: string; ok: boolean; detail: string }[] }[];
}

before(async () => {
  f = await createDatabase();
  evo = new FakeEvolution(KEY);
  await evo.start();
  smtp = new FakeSmtp('auto@a.test', 'senha-da-caixa');
  await smtp.start();
  hookServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { hooks.push(JSON.parse(raw)); res.writeHead(200).end('{}'); });
  });
  await new Promise<void>((r) => hookServer.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/n8n`;
  ({ app } = await startApi(f, { EVOLUTION_URL: evo.url, EVOLUTION_API_KEY: KEY, CHANNEL_ALLOW_PRIVATE_HOSTS: 'true' }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);

  const w = await admin.post('/api/v1/channels/whatsapp', { name: 'Robô' });
  wa = w.body.account.id;
  instance = w.body.account.instance;
  token = /evolution\/([^/]+)$/.exec(evo.instances.get(instance)!.webhook)![1]!;
  await f.admin.query("update channel_accounts set status = 'connected', address = '+5511900000000' where id = $1", [wa]);
  const m = await admin.post('/api/v1/channels/email', {
    name: 'Auto', host: '127.0.0.1', port: smtp.port, secure: false, user: 'auto@a.test', pass: 'senha-da-caixa', fromName: 'Empresa A', address: 'auto@a.test',
  });
  mail = m.body.id;
  const p = await admin.post('/api/v1/pipelines', { name: 'Vendas Online' });
  pipelineId = p.body.id;
  const list = await admin.get('/api/v1/pipelines');
  const pipe = list.body.find((x: { id: string }) => x.id === pipelineId);
  stages = Object.fromEntries(pipe.stages.map((s: { name: string; id: string }) => [s.name, s.id]));
  tagVip = (await f.admin.query<{ id: string }>("insert into tags (tenant_id, name) values ($1, 'VIP') returning id", [f.tenantA])).rows[0]!.id;
});

after(async () => {
  await app?.close();
  await evo?.stop();
  await smtp?.stop();
  await new Promise<void>((r) => hookServer?.close(() => r()));
  if (f) await dropDatabase(f);
});

describe('variáveis', () => {
  test('troca as variáveis e some com as desconhecidas', () => {
    assert.equal(render('Olá, {{ primeiro_nome }}! {{x}}Equipe {{empresa}}', { primeiro_nome: 'Ana', empresa: 'WTA' }), 'Olá, Ana! Equipe WTA');
  });
});

describe('automações', () => {
  test('contato novo: WhatsApp com o nome, etiqueta e aviso ao n8n', async () => {
    const id = await rule({
      name: 'Boas-vindas', trigger: { type: 'contact.created' },
      actions: [
        { type: 'send_whatsapp', accountId: wa, text: 'Olá, {{primeiro_nome}}! Aqui é da {{empresa}}.' },
        { type: 'add_tag', tagId: tagVip },
        { type: 'webhook', url: hookUrl },
      ],
    });
    const c = await admin.post('/api/v1/contacts', { firstName: 'Ana', lastName: 'Souza', phones: [{ number: '+5521988887777' }], allowDuplicate: true });
    assert.equal(c.status, 201);
    const r = await tick();
    assert.ok(r.automations.executed >= 1, JSON.stringify(r));
    const sent = evo.sent.at(-1)!;
    assert.equal(sent.body.text, 'Olá, Ana! Aqui é da Empresa A.');
    assert.equal(sent.body.number, '5521988887777');
    const tags = await f.admin.query('select 1 from contact_tags where contact_id = $1 and tag_id = $2', [c.body.id, tagVip]);
    assert.equal(tags.rowCount, 1);
    const hook = hooks.at(-1) as { event: string; contact: { name: string }; automation: { name: string } };
    assert.equal(hook.event, 'contact.created');
    assert.equal(hook.contact.name, 'Ana Souza');
    assert.equal(hook.automation.name, 'Boas-vindas');
    const runs = await runsOf(id);
    assert.equal(runs[0]!.status, 'done', JSON.stringify(runs[0]));
    assert.equal(runs[0]!.log.length, 3);
    const h = await admin.get(`/api/v1/contacts/${c.body.id}/messages`);
    assert.equal(h.body.items[0].automation.name, 'Boas-vindas', 'o histórico mostra que foi a automação');
    assert.equal(h.body.items[0].sentBy, null);
    // Não roda de novo para o mesmo evento.
    await tick();
    assert.equal((await runsOf(id)).length, 1);
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('negócio entra na etapa: espera e depois cria a tarefa para o responsável', async () => {
    const id = await rule({
      name: 'Follow-up do contato feito', trigger: { type: 'deal.stage_changed', stageId: stages['Contato feito'] },
      actions: [{ type: 'wait', minutes: 60 }, { type: 'create_task', title: 'Ligar para {{nome}} ({{negocio}})', dueInDays: 1, activityType: 'call' }],
    });
    const c = await admin.post('/api/v1/contacts', { firstName: 'Bruno', allowDuplicate: true });
    const d = await admin.post('/api/v1/deals', { pipelineId, title: 'Site novo', contactId: c.body.id });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.equal((await admin.post(`/api/v1/deals/${d.body.id}/move`, { stageId: stages['Contato feito'] })).status, 200);
    await tick();
    let runs = await runsOf(id);
    assert.equal(runs[0]!.status, 'waiting');
    await f.admin.query('update automation_runs set next_at = now() where rule_id = $1', [id]);
    await tick();
    runs = await runsOf(id);
    assert.equal(runs[0]!.status, 'done', JSON.stringify(runs[0]));
    const t = await f.admin.query<{ title: string; type: string; owner_membership_id: string }>('select title, type, owner_membership_id from activities where deal_id = $1', [d.body.id]);
    assert.equal(t.rows[0]!.title, 'Ligar para Bruno (Site novo)');
    assert.equal(t.rows[0]!.type, 'call');
    // Outra etapa não dispara.
    assert.equal((await admin.post(`/api/v1/deals/${d.body.id}/move`, { stageId: stages['Qualificação'] })).status, 200);
    await tick();
    const after = await runsOf(id);
    assert.equal(after.filter((x) => x.status !== 'skipped').length, 1);
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('negócio ganho: avisa a equipe por WhatsApp e e-mail, com o PDF anexado', async () => {
    const members = (await admin.get('/api/v1/members')).body.items as { membershipId: string; email: string; name: string }[];
    const seller = members.find((m) => m.email === 'vendas@a.test')!;
    const me = members.find((m) => m.email === 'admin@a.test')!;
    assert.equal((await admin.patch(`/api/v1/members/${seller.membershipId}`, { notifyPhone: '47 99999-0000' })).body.notifyPhone, '+5547999990000');
    assert.equal((await admin.patch(`/api/v1/members/${seller.membershipId}`, { notifyPhone: '123' })).status, 422);
    const pdf = await admin.upload('/api/v1/automations/files', 'contrato.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'), 'application/pdf');
    assert.equal(pdf.status, 201, JSON.stringify(pdf.body));
    const bad = await admin.post('/api/v1/automations', {
      name: 'Sem canal', trigger: { type: 'deal.won' }, actions: [{ type: 'notify_team', membershipIds: [seller.membershipId], text: 'oi' }],
    });
    assert.equal(bad.status, 422);
    assert.match(bad.body.errors[0].message, /por onde avisar/);
    const id = await rule({
      name: 'Avisar venda', trigger: { type: 'deal.won' },
      actions: [{
        type: 'notify_team', membershipIds: [seller.membershipId, me.membershipId], phones: ['(11) 98888-1111'], emails: ['financeiro@a.test'],
        whatsappAccountId: wa, emailAccountId: mail, subject: 'Venda: {{negocio}}', text: 'Negócio {{negocio}} ganho, {{valor}}. Veja: {{link}}', fileIds: [pdf.body.id],
      }],
    });
    const c = await admin.post('/api/v1/contacts', { firstName: 'Clara', allowDuplicate: true });
    const d = await admin.post('/api/v1/deals', { pipelineId, title: 'Consultoria', contactId: c.body.id, valueCents: 150000 });
    const evoBefore = evo.sent.length;
    const mailsBefore = smtp.mails.length;
    assert.equal((await admin.post(`/api/v1/deals/${d.body.id}/move`, { stageId: stages['Ganho'] })).status, 200);
    await tick();
    const runs = await runsOf(id);
    assert.equal(runs[0]!.status, 'done', JSON.stringify(runs[0]));
    const wa2 = evo.sent.slice(evoBefore);
    // Vendedor (+5547999990000) e o número extra; o admin sem WhatsApp recebe só por e-mail.
    assert.deepEqual([...new Set(wa2.map((x) => x.body.number))].sort(), ['5511988881111', '5547999990000']);
    const txt = wa2.find((x) => x.type === 'text')!.body.text as string;
    assert.match(txt, /Negócio Consultoria ganho, R\$\s?1\.500,00\. Veja: http.*\/negocios\//);
    assert.equal(wa2.filter((x) => x.type === 'media').length, 2, 'o PDF vai para cada número');
    const mails = smtp.mails.slice(mailsBefore);
    assert.equal(mails.length, 3, 'vendedor, admin e financeiro');
    assert.ok(mails.every((m) => /Subject: .*Venda/.test(m.data) && /contrato\.pdf/.test(m.data)));
    // A conversa do cliente não recebe nada disso.
    assert.equal((await f.admin.query("select count(*)::int as n from messages where contact_id = $1", [c.body.id])).rows[0].n, 0);
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('filtro de etiqueta: contato sem a etiqueta é pulado, com o motivo', async () => {
    const id = await rule({ name: 'Só VIP', trigger: { type: 'contact.created' }, filters: { tagId: tagVip }, actions: [{ type: 'webhook', url: hookUrl }] });
    await admin.post('/api/v1/contacts', { firstName: 'Comum', allowDuplicate: true });
    await tick();
    const runs = await runsOf(id);
    assert.equal(runs[0]!.status, 'skipped');
    assert.match(runs[0]!.error!, /sem a etiqueta/);
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('aniversário: e-mail no dia, uma vez', async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const c = await admin.post('/api/v1/contacts', {
      firstName: 'Clara', emails: [{ email: 'clara@cliente.test' }], birthday: { day: now.getDate(), month: now.getMonth() + 1 }, allowDuplicate: true,
    });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const id = await rule({
      name: 'Parabéns', trigger: { type: 'birthday', time: '00:00' },
      actions: [{ type: 'send_email', accountId: mail, subject: 'Feliz aniversário, {{primeiro_nome}}!', text: 'Um abraço da {{empresa}}.' }],
    });
    await tick();
    const runs = await runsOf(id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.status, 'done', JSON.stringify(runs[0]));
    assert.match(smtp.mails.at(-1)!.data, /Subject: .*Feliz_anivers/);
    assert.deepEqual(smtp.mails.at(-1)!.to, ['clara@cliente.test']);
    await tick();
    assert.equal((await runsOf(id)).length, 1, 'uma vez por dia');
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('negócio parado: tarefa de follow-up depois de N dias sem atividade', async () => {
    const c = await admin.post('/api/v1/contacts', { firstName: 'Dora', allowDuplicate: true });
    const d = await admin.post('/api/v1/deals', { pipelineId, title: 'Consultoria', contactId: c.body.id });
    await f.admin.query("update deals set last_activity_at = now() - interval '5 days', created_at = now() - interval '6 days' where id = $1", [d.body.id]);
    const id = await rule({
      name: 'Parado 3 dias', trigger: { type: 'deal.inactive', days: 3 }, filters: { pipelineId },
      actions: [{ type: 'create_task', title: 'Retomar {{negocio}}', dueInDays: 0 }],
    });
    await tick();
    const runs = await runsOf(id);
    assert.ok(runs.some((r) => r.status === 'done'));
    const t = await f.admin.query("select 1 from activities where deal_id = $1 and title = 'Retomar Consultoria'", [d.body.id]);
    assert.equal(t.rowCount, 1);
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('mensagem recebida: resposta automática no máximo a cada 12 horas por contato', async () => {
    const id = await rule({ name: 'Fora do horário', trigger: { type: 'message.received' }, actions: [{ type: 'send_whatsapp', accountId: wa, text: 'Recebemos sua mensagem!' }] });
    const before = evo.sent.length;
    const send = (n: number) => new Browser(app, '10.80.9.9').req('POST', `/api/v1/webhooks/evolution/${token}`, {
      event: 'messages.upsert', instance,
      data: { key: { remoteJid: '5531977776666@s.whatsapp.net', fromMe: false, id: `AUTO-IN-${n}` }, pushName: 'Eva', message: { conversation: `oi ${n}` }, messageType: 'conversation' },
    }, { 'x-crm-request': 'x' });
    await send(1);
    await tick();
    await send(2);
    await tick();
    assert.equal(evo.sent.length - before, 1, 'respondeu uma vez só');
    const runs = await runsOf(id);
    assert.ok(runs.some((r) => r.status === 'skipped' && /12 horas/.test(r.error ?? '')));
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('opt-out: automação não envia para quem está na lista de supressão', async () => {
    const c = await admin.post('/api/v1/contacts', { firstName: 'Fabi', emails: [{ email: 'fabi@cliente.test' }], allowDuplicate: true });
    await f.admin.query("insert into suppression_list (tenant_id, channel, value, reason) values ($1, 'email', 'fabi@cliente.test', 'opt_out')", [f.tenantA]);
    const id = await rule({ name: 'Newsletter', trigger: { type: 'contact.created' }, actions: [{ type: 'send_email', accountId: mail, subject: 'Oi', text: 'Novidades' }] });
    await admin.post('/api/v1/contacts', { firstName: 'Outro', allowDuplicate: true });
    await f.admin.query("insert into timeline_entries (tenant_id, kind, contact_id) values ($1, 'contact.created', $2)", [f.tenantA, c.body.id]);
    await tick();
    const runs = await runsOf(id);
    const fabi = runs.find((r) => r.status === 'failed' && /não receber/.test(r.error ?? ''));
    assert.ok(fabi, JSON.stringify(runs));
    await admin.req('PATCH', `/api/v1/automations/${id}`, { active: false });
  });

  test('validação, limite do plano, desligar cancela as que esperam, permissão', async () => {
    const bad = await admin.post('/api/v1/automations', { name: 'Ruim', trigger: { type: 'contact.created' }, actions: [{ type: 'move_stage', stageId: stages['Proposta'] }] });
    assert.equal(bad.status, 422);
    assert.match(JSON.stringify(bad.body.errors), /gatilhos de negócio/);
    assert.equal((await admin.post('/api/v1/automations', { name: 'Só espera', trigger: { type: 'contact.created' }, actions: [{ type: 'wait', minutes: 5 }] })).status, 422);

    const plan = await f.admin.query<{ id: string }>(`insert into plans (name, limits) values ('Uma automação', '{"max_automations": 1}') returning id`);
    await f.admin.query("insert into tenant_subscriptions (tenant_id, plan_id, status) values ($1, $2, 'active')", [f.tenantA, plan.rows[0]!.id]);
    const one = await rule({ name: 'Espera longa', trigger: { type: 'contact.created' }, actions: [{ type: 'wait', minutes: 600 }, { type: 'webhook', url: hookUrl }] });
    const two = await admin.post('/api/v1/automations', { name: 'Segunda', trigger: { type: 'contact.created' }, actions: [{ type: 'webhook', url: hookUrl }] });
    assert.equal(two.status, 403);
    assert.equal(two.body.type, 'plan-limit');
    await admin.post('/api/v1/contacts', { firstName: 'Gabi', allowDuplicate: true });
    await tick();
    assert.equal((await runsOf(one))[0]!.status, 'waiting');
    await admin.req('PATCH', `/api/v1/automations/${one}`, { active: false });
    assert.equal((await runsOf(one))[0]!.status, 'skipped');
    await f.admin.query('delete from tenant_subscriptions where tenant_id = $1', [f.tenantA]);

    assert.equal((await sales.get('/api/v1/automations')).status, 403);
    const list = await admin.get('/api/v1/automations');
    assert.ok(list.body.items.length >= 5);
    assert.ok(list.body.variables.some((v: { key: string }) => v.key === 'primeiro_nome'));
  });
});

describe('n8n: chave de API e entrada de dados', () => {
  let key: string;

  test('cria a chave (mostrada uma vez) e cadastra contato e negócio no funil e etapa pelo nome', async () => {
    const k = await admin.post('/api/v1/api-keys', { name: 'n8n' });
    assert.equal(k.status, 201, JSON.stringify(k.body));
    key = k.body.key;
    assert.match(key, /^crm_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    const list = await admin.get('/api/v1/api-keys');
    assert.equal(JSON.stringify(list.body).includes(key), false, 'a chave não aparece de novo');

    const n8n = new Browser(app, '10.80.7.7');
    const body = {
      contact: { name: 'Helena Prado', email: 'Helena@Cliente.test', phone: '(11) 97654-3210', tags: ['Site', 'VIP'] },
      organization: { name: 'Prado Ltda' },
      deal: { title: 'Orçamento do site', value: 1500.5, pipeline: 'vendas online', stage: 'contato feito' },
      note: 'Veio do formulário do site.',
      touch: { source: 'google', medium: 'cpc', campaign: 'outubro' },
    };
    const r = await n8n.req('POST', '/api/v1/inbound', body, { authorization: `Bearer ${key}`, 'x-crm-request': 'x' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.created, true);
    const deal = await f.admin.query<{ stage_id: string; value_cents: string; contact_id: string; organization_id: string }>(
      'select stage_id, value_cents, contact_id, organization_id from deals where id = $1', [r.body.dealId]);
    assert.equal(deal.rows[0]!.stage_id, stages['Contato feito']);
    assert.equal(Number(deal.rows[0]!.value_cents), 150050);
    assert.equal(deal.rows[0]!.contact_id, r.body.contactId);
    assert.equal(deal.rows[0]!.organization_id, r.body.organizationId);
    const tags = await f.admin.query<{ name: string }>('select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 order by t.name', [r.body.contactId]);
    assert.deepEqual(tags.rows.map((x) => x.name), ['Site', 'VIP'], 'etiqueta nova criada e a existente reaproveitada');
    const src = await f.admin.query<{ source: string }>('select source from attribution_touches where contact_id = $1', [r.body.contactId]);
    assert.equal(src.rows[0]!.source, 'google');

    // O mesmo e-mail de novo: o mesmo contato, com um lead.
    const again = await n8n.req('POST', '/api/v1/inbound', { contact: { email: 'helena@cliente.test', phone: '+5511900001111' }, lead: { title: 'Pediu catálogo', source: 'site' } },
      { 'x-api-key': key });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.contactId, r.body.contactId);
    assert.equal(again.body.created, false);
    assert.ok(again.body.leadId);
    const phones = await f.admin.query('select e164 from contact_phones where contact_id = $1', [r.body.contactId]);
    assert.equal(phones.rowCount, 2, 'telefone novo acrescentado');
  });

  test('erros claros: etapa inexistente, chave errada, chave revogada, plano sem API', async () => {
    const n8n = new Browser(app, '10.80.7.8');
    const bad = await n8n.req('POST', '/api/v1/inbound', { contact: { name: 'X' }, deal: { title: 'Y', pipeline: 'Vendas Online', stage: 'Inexistente' } }, { authorization: `Bearer ${key}` });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.errors[0].field, 'deal.stage');
    assert.equal((await n8n.req('POST', '/api/v1/inbound', { contact: { name: 'X' } }, { authorization: `Bearer ${key.slice(0, -2)}xx` })).status, 401);
    assert.equal((await n8n.req('GET', '/api/v1/contacts', undefined, { authorization: `Bearer ${key}` })).status, 200, 'a chave usa a API inteira');

    const plan = await f.admin.query<{ id: string }>(`insert into plans (name, limits) values ('Sem API', '{"api_access": false}') returning id`);
    await f.admin.query("insert into tenant_subscriptions (tenant_id, plan_id, status) values ($1, $2, 'active')", [f.tenantA, plan.rows[0]!.id]);
    assert.equal((await n8n.req('GET', '/api/v1/contacts', undefined, { authorization: `Bearer ${key}` })).status, 401);
    assert.equal((await admin.post('/api/v1/api-keys', { name: 'outra' })).status, 403);
    await f.admin.query('delete from tenant_subscriptions where tenant_id = $1', [f.tenantA]);

    const id = (await admin.get('/api/v1/api-keys')).body.items[0].id;
    assert.equal((await admin.del(`/api/v1/api-keys/${id}`)).status, 204);
    assert.equal((await n8n.req('GET', '/api/v1/contacts', undefined, { authorization: `Bearer ${key}` })).status, 401);
  });
});
