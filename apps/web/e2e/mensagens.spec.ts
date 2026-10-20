import { test, expect, type Page } from '@playwright/test';
import { expectAccessible, loginAdmin, shot } from './util';

test.describe.configure({ mode: 'serial' });

const FAKE = process.env.FAKE_EVOLUTION_URL ?? 'http://127.0.0.1:8790';

type FakeState = { instances: { name: string; webhook: string; state: string }[]; sent: { instance: string; type: string; body: Record<string, unknown> }[] };
async function fake(page: Page): Promise<FakeState> {
  return (await page.request.get(`${FAKE}/__fake/state`)).json() as Promise<FakeState>;
}

async function openSettings(page: Page, tab: string) {
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab }).click();
}

test('WhatsApp: conectar pelo QR code, receber e responder pelas Conversas', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Canais');
  await page.getByRole('button', { name: 'Conectar número' }).click();
  await page.getByRole('dialog').getByLabel('Nome do número').fill('Comercial');
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar QR code' }).click();
  const qrDialog = page.getByRole('dialog', { name: 'Conectar Comercial' });
  await expect(qrDialog.getByRole('img', { name: 'QR code para conectar o WhatsApp' })).toBeVisible();
  await expect(qrDialog).toContainText('ABCD1234');
  await shot(page, '40-canais-qr');

  // O celular lê o QR: a Evolution passa a dizer "open" e a janela fecha sozinha.
  const st = await fake(page);
  const inst = st.instances.at(-1)!;
  expect(inst.name).toMatch(/^crmwta-wta-[0-9a-f]{8}$/);
  await page.request.post(`${FAKE}/__fake/state`, { data: { instance: inst.name, state: 'open', owner: '5511988887777@s.whatsapp.net' } });
  await expect(page.getByText('WhatsApp conectado.')).toBeVisible({ timeout: 15_000 });
  const item = page.getByRole('listitem').filter({ hasText: 'Comercial' });
  await expect(item).toContainText('Conectada');
  await expect(item).toContainText('(11) 98888-7777');
  await expectAccessible(page);
  await shot(page, '41-canais');

  // Chega uma mensagem de um número novo.
  const hook = new URL(inst.webhook).pathname;
  const r = await page.request.post(hook, {
    data: {
      event: 'messages.upsert', instance: inst.name,
      data: { key: { remoteJid: '5521977776666@s.whatsapp.net', fromMe: false, id: 'E2E-IN-1' }, pushName: 'Maria Cliente', message: { conversation: 'Oi! Vocês fazem entrega?' }, messageType: 'conversation' },
    },
  });
  expect(r.status()).toBe(200);

  await page.goto('/conversas');
  const conv = page.getByRole('button', { name: /Maria Cliente/ });
  await expect(conv).toContainText('Oi! Vocês fazem entrega?');
  await expect(conv).toContainText('1 não lidas');
  await conv.click();
  const thread = page.getByRole('list', { name: 'Mensagens' });
  await expect(thread).toContainText('Oi! Vocês fazem entrega?');
  await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: /Conversas/ })).not.toContainText('não lidas');
  await page.getByLabel('Mensagem', { exact: true }).fill('Olá, Maria! Fazemos sim.');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(thread).toContainText('Olá, Maria! Fazemos sim.');
  await expect(thread.getByText('Enviada')).toBeAttached();
  const sent = (await fake(page)).sent.at(-1)!;
  expect([sent.type, sent.body.number, sent.body.text]).toEqual(['text', '5521977776666', 'Olá, Maria! Fazemos sim.']);
  await expectAccessible(page);
  await shot(page, '42-conversas');

  // Áudio de voz: o aviso vem sem o arquivo; um chega e já toca, o outro é buscado no WhatsApp quando pedido.
  const OPUS = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(22), Buffer.from([1, 19]), Buffer.from('OpusHead'), Buffer.from([1, 1]), Buffer.alloc(73, 1)]).toString('base64');
  const voice = (id: string) => page.request.post(hook, {
    data: { event: 'messages.upsert', instance: inst.name,
      data: { key: { remoteJid: '5521977776666@s.whatsapp.net', fromMe: false, id }, pushName: 'Maria Cliente', message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }, messageType: 'audioMessage' } },
  });
  await page.request.post(`${FAKE}/__fake/state`, { data: { media: { 'E2E-PTT-1': { base64: OPUS, mimetype: 'audio/ogg; codecs=opus' } } } });
  expect((await voice('E2E-PTT-1')).status()).toBe(200);
  expect((await voice('E2E-PTT-2')).status()).toBe(200);
  await expect(async () => {
    await page.reload();
    await page.getByRole('button', { name: /Maria Cliente/ }).click();
    await expect(thread.locator('audio')).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await page.request.post(`${FAKE}/__fake/state`, { data: { media: { 'E2E-PTT-2': { base64: OPUS, mimetype: 'audio/ogg; codecs=opus' } } } });
  await thread.getByRole('button', { name: 'Ouvir áudio' }).click();
  await expect(thread.locator('audio')).toHaveCount(2);
  await expectAccessible(page);
});

test('e-mail da empresa: cadastrar, testar e enviar pelo contato', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Canais');
  await page.getByRole('button', { name: 'Adicionar e-mail' }).click();
  const d = page.getByRole('dialog', { name: 'Adicionar e-mail' });
  await d.getByLabel('Nome da conta').fill('Vendas');
  await d.getByLabel('E-mail', { exact: true }).fill('vendas@aurora.test');
  await d.getByLabel('Nome do remetente').fill('Aurora');
  await d.getByLabel('Servidor SMTP').fill('127.0.0.1');
  await d.getByLabel('Porta').selectOption('2525');
  await d.getByLabel('Senha', { exact: true }).fill('senha-da-caixa');
  await expectAccessible(page);
  await shot(page, '43-canais-email');
  await d.getByRole('button', { name: 'Salvar e testar' }).click();
  await expect(page.getByText(/Caixa salva e testada/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'vendas@aurora.test' })).toContainText('Conectada');

  // Contato com e-mail recebe pelo painel de mensagens.
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Conversas' }).click();
  await page.getByRole('button', { name: /Maria Cliente/ }).click();
  await page.getByRole('link', { name: 'Maria Cliente' }).click();
  await page.getByRole('button', { name: 'Editar' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByRole('button', { name: 'Adicionar e-mail' }).click();
  await edit.getByLabel('E-mail 1', { exact: true }).fill('maria@cliente.test');
  await edit.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('maria@cliente.test')).toBeVisible();

  await page.getByLabel('Enviar por').selectOption({ label: 'E-mail · Vendas · vendas@aurora.test' });
  await page.getByLabel('Assunto').fill('Catálogo de produtos');
  await page.getByLabel('Mensagem', { exact: true }).fill('Olá, Maria. Segue o catálogo.');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  const thread = page.getByRole('list', { name: 'Mensagens' });
  await expect(thread).toContainText('Catálogo de produtos');
  await expect(thread).toContainText('Oi! Vocês fazem entrega?');
  await expect(page.getByText('Mensagem enviada (E-mail)')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '44-contato-mensagens');
});

test('conversas: nova conversa com quem nunca escreveu, resposta pronta pelo atalho, estado e filtros', async ({ page }) => {
  await loginAdmin(page);
  // Banco de respostas: uma de WhatsApp para a empresa toda.
  await page.goto('/conversas');
  await page.getByRole('link', { name: 'Respostas prontas' }).click();
  await page.getByRole('button', { name: 'Nova resposta' }).click();
  const d = page.getByRole('dialog', { name: 'Nova resposta pronta' });
  await d.getByLabel('Atalho').fill('boasvindas');
  await d.getByLabel('Título').fill('Boas-vindas');
  await d.getByLabel('Texto').fill('Olá, {{primeiro_nome}}! Aqui é {{atendente}}. Como posso ajudar?');
  await expectAccessible(page);
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Resposta criada.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '/boasvindas' })).toContainText('Da empresa');
  await shot(page, '45-respostas-prontas');

  // Nova conversa com um contato que ainda não existe.
  await page.getByRole('link', { name: 'Conversas' }).first().click();
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  const n = page.getByRole('dialog', { name: 'Nova conversa' });
  await n.getByRole('button', { name: 'Contato novo' }).click();
  await n.getByLabel('Nome').fill('Bruno Prospect');
  await n.getByLabel('WhatsApp (com DDD)').fill('(31) 98888-7766');
  await expectAccessible(page);
  await n.getByRole('button', { name: 'Abrir conversa' }).click();
  await expect(page.getByText('Nenhuma mensagem ainda. Escreva abaixo para começar a conversa por WhatsApp.')).toBeVisible();

  // "/" abre as respostas prontas; Enter escolhe e preenche com as variáveis.
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill('/boas');
  await expect(page.getByRole('list', { name: 'Respostas prontas' })).toContainText('/boasvindas');
  await box.press('Enter');
  await expect(box).toHaveValue(/^Olá, Bruno! Aqui é .+\. Como posso ajudar\?$/);
  await expectAccessible(page);
  await shot(page, '46-conversa-nova-resposta-pronta');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  const thread = page.getByRole('list', { name: 'Mensagens' });
  await expect(thread).toContainText('Olá, Bruno!');
  const sent = (await fake(page)).sent.at(-1)!;
  expect(sent.body.number).toBe('5531988887766');

  // Estado: aguardando o cliente; a lista separa por estado e canal.
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('waiting');
  await expect(page.getByRole('main').getByText('Aguardando cliente').first()).toBeVisible();
  const list = page.getByRole('region', { name: 'Lista de conversas' });
  await page.getByRole('button', { name: /^Aguardando/ }).click();
  await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toBeVisible();
  await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'E-mail' }).click();
  await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toHaveCount(0);
  await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'Todos' }).click();
  await page.getByRole('button', { name: 'Filtros' }).click();
  await page.getByLabel('Responsável', { exact: true }).first().selectOption('me');
  await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toBeVisible();
  await page.getByLabel('Negócio').selectOption('open');
  await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toHaveCount(0);
  await expectAccessible(page);
  await shot(page, '47-conversas-filtros');
});

test('campanha de WhatsApp: cinco passos, público, envio no ritmo e relatório', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Campanhas' }).click();
  await page.getByRole('link', { name: 'Nova campanha' }).click();
  await expect(page.getByText('1. Geral')).toBeVisible();
  await expect(page.getByText('0%')).toBeVisible();
  // Sem nome e tipo não segue.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Informe o nome da campanha.')).toBeVisible();
  await page.getByLabel('Nome *').fill('Oferta de outubro');
  await page.getByLabel('Descrição').fill('Clientes que já conversaram pelo WhatsApp');
  await page.getByLabel('Tipo de Campanha *').selectOption('whatsapp');
  await expectAccessible(page);
  await shot(page, '48-campanha-geral');
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByText('2. Audiência')).toBeVisible();
  await expect(page.getByText(/contato\(s\) vão receber/)).toBeVisible();
  await expect(page.getByText('Por exemplo:')).toContainText('Bruno');
  await expectAccessible(page);
  await shot(page, '49-campanha-audiencia');
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByText('3. Conteúdo')).toBeVisible();
  await page.getByLabel('Mensagem *').fill('Oi {{primeiro_nome}}! Temos novidades.');
  await expect(page.getByText('Oi Maria! Temos novidades.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByText('4. Configurações')).toBeVisible();
  await page.getByLabel('Ritmo de envio').selectOption('120');
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByText('5. Revisão')).toBeVisible();
  await expect(page.getByText('80%')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '50-campanha-revisao');
  const before = (await fake(page)).sent.length;
  await page.getByRole('button', { name: 'Enviar agora' }).click();
  await expect(page.getByRole('heading', { name: /Oferta de outubro/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Oferta de outubro/ })).toContainText('Concluída', { timeout: 60_000 });
  const sent = (await fake(page)).sent.slice(before);
  expect(sent.length).toBeGreaterThan(0);
  const bruno = sent.find((x) => x.body.number === '5531988887766');
  expect(bruno?.body.text).toBe('Oi Bruno! Temos novidades.\n\nPara não receber mais mensagens, responda SAIR.');
  await expect(page.getByRole('region', { name: 'Destinatários' }).or(page.getByText('Destinatários'))).toBeVisible();
  await expectAccessible(page);
  await shot(page, '51-campanha-relatorio');
  await page.getByRole('link', { name: 'Campanhas' }).first().click();
  await expect(page.getByRole('row').filter({ hasText: 'Oferta de outubro' })).toContainText('Concluída');
});

test('painel da operação: status agora, tendências, mapa de calor e atendentes', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('button', { name: 'Operação de atendimento' }).click();
  await expect(page.getByRole('heading', { name: 'Status da operação agora' })).toBeVisible();
  await expect(page.getByText('Mensagens recebidas', { exact: true })).toBeVisible();
  await expect(page.getByText('Conversas sem responsável', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Conversas por dia' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mapa de calor por dia e hora' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Desempenho dos atendentes' })).toContainText('Gilson');
  await page.getByLabel('Canal', { exact: true }).selectOption('email');
  await expect(page.getByRole('heading', { name: 'Status da operação agora' })).toBeVisible();
  await page.getByLabel('Canal', { exact: true }).selectOption('');
  await expectAccessible(page);
  await shot(page, '52-painel-operacao');
});

test('indicadores comerciais: resultado da call e números de contato, calls e vendas', async ({ page }) => {
  await loginAdmin(page);
  const h = { 'x-crm-request': '1' };
  const c = await page.request.post('/api/v1/contacts', { data: { firstName: 'Otávio', lastName: 'Prado', allowDuplicate: true }, headers: h });
  const contactId = (await c.json()).id as string;
  const startsAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  for (const title of ['Call de diagnóstico', 'Call de retorno']) {
    expect((await page.request.post('/api/v1/activities', { data: { type: 'call', title, startsAt, contactId }, headers: h })).status()).toBe(201);
  }
  // Ao concluir a call pelo contato, o CRM pergunta como foi.
  await page.goto(`/contatos/${contactId}`);
  await page.getByRole('button', { name: 'Concluir: Call de diagnóstico' }).click();
  const how = page.getByRole('group', { name: 'Como foi: Call de diagnóstico' });
  await expect(how).toBeVisible();
  await expectAccessible(page);
  await how.getByRole('button', { name: 'Realizada' }).click();
  await expect(page.getByRole('button', { name: 'Reabrir: Call de diagnóstico' })).toBeVisible();
  await page.getByRole('button', { name: 'Concluir: Call de retorno' }).click();
  await page.getByRole('group', { name: 'Como foi: Call de retorno' }).getByRole('button', { name: 'Não compareceu' }).click();
  await expect(page.getByText('Não compareceu', { exact: true })).toBeVisible();

  await page.goto('/inicio');
  await page.getByRole('button', { name: 'Indicadores comerciais' }).click();
  await expect(page.getByRole('heading', { name: 'Números do período' })).toBeVisible();
  for (const t of ['Leads contatados', 'Calls agendadas', 'Calls realizadas', 'Vendas na call', 'Vendas no follow-up', 'Vendas no total']) {
    await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/Comparecimento \d+%/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Indicadores por vendedor' })).toContainText('Gilson');
  await page.getByLabel('Período', { exact: true }).selectOption('14');
  await expect(page.getByText('(14 dias)')).toBeVisible();
  await page.getByLabel('Período', { exact: true }).selectOption('custom');
  await expect(page.getByLabel('Data inicial', { exact: true })).toBeVisible();
  await page.getByLabel('Período', { exact: true }).selectOption('7');
  await expectAccessible(page);
  await shot(page, '53-indicadores-comerciais');
});

test('ações agendadas: agendar pelo contato e pela conversa, mudar e cancelar', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Contatos' }).click();
  await page.getByRole('navigation', { name: 'Subopções de contatos' }).getByRole('link', { name: 'Ações agendadas' }).click();
  await page.getByRole('button', { name: 'Agendar mensagem' }).click();
  const d = page.getByRole('dialog', { name: 'Agendar mensagem' });
  await d.getByLabel('Contato').fill('Bruno');
  await d.getByRole('option', { name: 'Bruno Prospect' }).click();
  await d.getByLabel('Mensagem').fill('Bruno, passando para lembrar da proposta.');
  await expectAccessible(page);
  await d.getByRole('button', { name: 'Agendar' }).click();
  await expect(page.getByText('Mensagem agendada.')).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: 'Bruno, passando para lembrar' });
  await expect(item).toContainText('Agendada');
  await expectAccessible(page);
  await shot(page, '53-acoes-agendadas');

  await item.getByRole('button', { name: /Mudar a mensagem/ }).click();
  const e = page.getByRole('dialog', { name: 'Mudar mensagem agendada' });
  await e.getByLabel('Mensagem').fill('Bruno, lembrete da proposta (atualizado).');
  await e.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Agendamento atualizado.')).toBeVisible();
  const updated = page.getByRole('listitem').filter({ hasText: 'lembrete da proposta (atualizado)' });
  await updated.getByRole('button', { name: /Cancelar a mensagem/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar mensagem' }).click();
  await expect(page.getByText('Mensagem cancelada.')).toBeVisible();
  await expect(updated).toHaveCount(0);

  // Pela conversa: escreve e agenda em vez de enviar.
  await page.goto('/conversas?st=all');
  await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Bruno Prospect/ }).first().click();
  await page.getByLabel('Mensagem', { exact: true }).fill('Mensagem para amanhã');
  await page.getByRole('button', { name: 'Agendar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Agendar mensagem' }).getByRole('button', { name: 'Agendar' }).click();
  await expect(page.getByText(/Agendada para .*Ações agendadas/)).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('');
});
