import { createHmac } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { expectAccessible, loginAdmin, shot } from './util';

test.describe.configure({ mode: 'serial' });

const FAKE = process.env.FAKE_META_URL ?? 'http://127.0.0.1:8791';
const TOKEN = 'token-e2e';
const SECRET = 'segredo-do-app-e2e';

type Sent = { path: string; body: Record<string, unknown> };
async function sent(page: Page): Promise<Sent[]> {
  return ((await (await page.request.get(`${FAKE}/__fake/state`)).json()) as { sent: Sent[] }).sent;
}

async function openSettings(page: Page, tab: string) {
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab }).click();
}

/** Aviso da Meta assinado, no endereço que a tela mostrou. */
async function hook(page: Page, url: string, body: unknown) {
  const raw = JSON.stringify(body);
  const r = await page.request.post(new URL(url).pathname, {
    data: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` },
  });
  expect(r.status()).toBe(200);
}

let cloudHook = '';
let igHook = '';

test('WhatsApp oficial: cadastrar, avisos da Meta, modelo aprovado', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Canais');
  // Passo a passo ao lado do canal, com as abas WhatsApp oficial e Instagram.
  await page.getByRole('button', { name: 'Passo a passo' }).first().click();
  const sheet = page.getByRole('complementary', { name: 'Passo a passo da conexão' });
  await expect(sheet.getByRole('heading', { name: 'Gerar o token permanente (usuário do sistema)' })).toBeVisible();
  await sheet.getByRole('checkbox', { name: 'Feito' }).first().check();
  await expectAccessible(page);
  await shot(page, '59-passo-a-passo-whatsapp');
  await sheet.getByRole('button', { name: 'Instagram' }).click();
  await expect(sheet.getByRole('heading', { name: 'Adicionar a conta do Instagram e gerar o token' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Fechar o passo a passo' }).click();
  await page.getByRole('button', { name: 'Adicionar número oficial' }).click();
  const d = page.getByRole('dialog', { name: 'Adicionar número oficial do WhatsApp' });
  // O formulário abre com o passo a passo ao lado.
  await expect(d.getByRole('region', { name: 'Passo a passo' }).getByRole('heading', { name: 'Definir o PIN de 6 dígitos' })).toBeVisible();
  await shot(page, '60-formulario-com-passo-a-passo');
  await d.getByLabel('Nome da conta').fill('Oficial');
  await d.getByLabel('ID do número de telefone').fill('100000000777');
  await d.getByLabel('ID da conta do WhatsApp Business').fill('200000000777');
  await d.getByLabel('Token de acesso permanente').fill(TOKEN);
  await d.getByLabel('Chave secreta do app', { exact: true }).fill(SECRET);
  await d.getByLabel('PIN (6 dígitos)').fill('123456');
  await expectAccessible(page);
  await d.getByRole('button', { name: 'Salvar e conferir' }).click();
  await expect(page.getByText(/Conta salva e conferida na Meta, com o número registrado na API/)).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Oficial' }).filter({ hasText: 'Empresa Teste' });
  await expect(row).toContainText('Conectada');
  await row.getByText('Configurar os avisos na Meta').click();
  cloudHook = (await row.locator('code').first().textContent())!;
  expect(cloudHook).toMatch(/\/api\/v1\/webhooks\/meta\/[A-Za-z0-9_-]{43}$/);
  await expectAccessible(page);
  await shot(page, '54-whatsapp-oficial');

  await row.getByRole('link', { name: 'Modelos' }).click();
  await page.getByRole('button', { name: 'Novo modelo' }).click();
  const t = page.getByRole('dialog', { name: 'Novo modelo de mensagem' });
  await t.getByLabel('Nome', { exact: true }).fill('retorno_contato');
  await t.getByLabel('Categoria').selectOption('UTILITY');
  await t.getByLabel('Texto').fill('Olá ');
  await t.getByRole('button', { name: /Inserir variável/ }).click();
  await t.getByLabel('Texto').press('End');
  await t.getByLabel('Texto').pressSequentially(', podemos falar sobre o seu pedido?');
  await t.getByLabel('Exemplo de {{1}}').fill('Maria');
  await expect(t.getByText('Olá Maria, podemos falar sobre o seu pedido?')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '55-modelo-novo');
  await t.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Modelo enviado para a Meta aprovar.')).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: 'retorno_contato' });
  await expect(item).toContainText('Em análise na Meta');
  await page.request.post(`${FAKE}/__fake/approve`);
  await page.getByRole('button', { name: 'Sincronizar com a Meta' }).click();
  await expect(item).toContainText('Aprovado');
  await expectAccessible(page);
  await shot(page, '56-modelos');
});

test('WhatsApp oficial nas Conversas: recebe, responde e usa modelo fora das 24 h', async ({ page }) => {
  await loginAdmin(page);
  await hook(page, cloudHook, { object: 'whatsapp_business_account', entry: [{ id: '200000000777', changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: '100000000777' }, contacts: [{ profile: { name: 'Carla Oficial' }, wa_id: '5541988887777' }],
    messages: [{ from: '5541988887777', id: 'wamid.E2E1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Bom dia! Tenho uma dúvida.' } }] } }] }] });
  await page.goto('/conversas?st=all&ch=whatsapp');
  await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Carla Oficial/ }).click();
  await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Tenho uma dúvida');
  await page.getByLabel('Enviar por').selectOption({ label: 'WhatsApp oficial · Oficial · (11) 3333-4444' });
  await page.getByLabel('Mensagem', { exact: true }).fill('Bom dia, Carla! Pode falar.');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Bom dia, Carla! Pode falar.');
  const last = (await sent(page)).at(-1)!;
  expect([last.path, last.body.type, last.body.to]).toEqual(['100000000777/messages', 'text', '5541988887777']);

  // Bruno nunca escreveu para o número oficial: só com modelo.
  await page.goto('/conversas?st=all&ch=whatsapp');
  await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Bruno Prospect/ }).first().click();
  await page.getByLabel('Enviar por').selectOption({ label: 'WhatsApp oficial · Oficial · (11) 3333-4444' });
  await page.getByLabel('Mensagem', { exact: true }).fill('Oi Bruno');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText(/comece com um modelo aprovado/)).toBeVisible();
  await page.getByLabel('Modelo', { exact: true }).selectOption({ label: 'retorno_contato (pt_BR)' });
  await expect(page.getByLabel('Valor de {{1}}')).toHaveValue('Bruno');
  await expectAccessible(page);
  await shot(page, '57-conversa-modelo');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Olá Bruno, podemos falar sobre o seu pedido?');
  const tpl = (await sent(page)).at(-1)!.body as { type: string; template: { name: string } };
  expect([tpl.type, tpl.template.name]).toEqual(['template', 'retorno_contato']);
});

test('Instagram: cadastrar, receber a mensagem direta e responder', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Canais');
  await page.getByRole('button', { name: 'Adicionar Instagram' }).click();
  const d = page.getByRole('dialog', { name: 'Adicionar Instagram' });
  await d.getByLabel('Nome da conta').fill('Insta da loja');
  await d.getByLabel('ID da conta do Instagram').fill('17841400000777');
  await d.getByLabel('Segunda chave secreta (opcional)').fill('outra-chave-e2e');
  await d.getByLabel('Token de acesso', { exact: true }).fill(TOKEN);
  await d.getByLabel('Chave secreta do app', { exact: true }).fill(SECRET);
  await d.getByRole('button', { name: 'Salvar e conferir' }).click();
  await expect(page.getByText(/Conta salva e conferida na Meta/)).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Insta da loja' });
  await expect(row).toContainText('@empresa.teste');
  await row.getByText('Configurar os avisos na Meta').click();
  igHook = (await row.locator('code').first().textContent())!;

  await hook(page, igHook, { object: 'instagram', entry: [{ id: '17841400000777', time: Date.now(), messaging: [
    { sender: { id: '955500011122' }, recipient: { id: '17841400000777' }, timestamp: Date.now(), message: { mid: 'mid.E2E1', text: 'Vocês entregam em Curitiba?' } }] }] });
  await page.goto('/conversas?st=all');
  await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Cliente Insta/ }).click();
  await expect(page.getByText('@cliente.insta').first()).toBeVisible();
  await page.getByLabel('Mensagem', { exact: true }).fill('Entregamos sim!');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Entregamos sim!');
  const last = (await sent(page)).at(-1)!;
  expect([last.path, (last.body.recipient as { id: string }).id]).toEqual(['17841400000777/messages', '955500011122']);
  await expectAccessible(page);
  await shot(page, '58-instagram');
});

test('passo a passo em página própria, para abrir ao lado do site da Meta', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/configuracoes/canais/guia?canal=instagram');
  await expect(page.getByRole('heading', { name: 'Passo a passo: Instagram' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Problemas comuns e como resolver' })).toBeVisible();
  await page.getByText('As mensagens não aparecem no CRM').click();
  await expect(page.getByText(/Permitir acesso às mensagens/).first()).toBeVisible();
  await page.getByRole('button', { name: 'WhatsApp oficial' }).click();
  await expect(page.getByRole('heading', { name: 'Passo a passo: WhatsApp oficial (API da Meta)' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '61-passo-a-passo-pagina');
});

test('Instagram: fluxo de comentário "eu quero" — criar, testar, publicar e rodar', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Instagram' }).click();
  await expect(page.getByRole('heading', { name: 'Instagram', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Novo fluxo' }).first().click();
  const d = page.getByRole('dialog', { name: 'Novo fluxo' });
  await expect(d.getByRole('radio', { name: /Comentário em post ou reels/ })).toHaveAttribute('aria-checked', 'true');
  await d.getByLabel('Nome do fluxo').fill('Reels — eu quero');
  await expectAccessible(page);
  await shot(page, '70-instagram-novo-fluxo');
  await d.getByRole('button', { name: 'Criar e abrir o editor' }).click();

  // Editor: o gatilho com a palavra-chave e um texto depois do botão "Quero".
  await expect(page.getByLabel('Nome do fluxo')).toHaveValue('Reels — eu quero');
  await page.getByRole('group', { name: 'Quando…' }).getByRole('button').first().click();
  await page.getByLabel('Nova palavra-chave').fill('eu quero');
  await page.getByLabel('Nova palavra-chave').press('Enter');
  await page.getByRole('group', { name: 'Responder no privado' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /^Texto/ }).click();
  await page.getByLabel('Mensagem', { exact: true }).fill('Aqui está o link, {{nome}}: https://exemplo.com');
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tudo certo' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '71-instagram-editor');

  // Visualizar: nada vai para o Instagram.
  await page.getByRole('button', { name: 'Visualizar' }).click();
  const sim = page.getByRole('dialog', { name: 'Visualizar o fluxo' });
  await sim.getByLabel('Comentário da pessoa').fill('Eu quero!!');
  await sim.getByRole('button', { name: 'Simular' }).click();
  await expect(sim.getByText('Resposta no comentário')).toBeVisible();
  await sim.getByRole('button', { name: 'Quero' }).click();
  await expect(sim.getByText('Aqui está o link, Maria: https://exemplo.com')).toBeVisible();
  await expect(sim.getByText('Fim do fluxo.')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '72-instagram-visualizar');
  await sim.getByRole('button', { name: 'Fechar', exact: true }).first().click();

  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Fluxo publicado: já está funcionando no Instagram.')).toBeVisible();

  // Um comentário de verdade (aviso da Meta) dispara o fluxo.
  const before = (await sent(page)).length;
  await hook(page, igHook, { object: 'instagram', entry: [{ id: '17841400000777', time: Math.floor(Date.now() / 1000), changes: [{
    field: 'comments', value: { from: { id: '955500033344', username: 'ana.e2e' }, media: { id: '17900000000000001', media_product_type: 'REELS' }, id: '18000000000777001', text: 'EU QUERO' },
  }] }] });
  const out = (await sent(page)).slice(before);
  expect(out.map((s) => s.path)).toEqual(['18000000000777001/replies', '17841400000777/messages']);
  expect((out[1]!.body.recipient as { comment_id: string }).comment_id).toBe('18000000000777001');

  await page.goto('/instagram');
  await expect(page.getByRole('listitem').filter({ hasText: 'Reels — eu quero' })).toContainText('Ativo');
  await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Resultados' }).click();
  await expect(page.getByText('Disparos', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Últimas pessoas' })).toContainText('Esperando');
  await expectAccessible(page);
  await shot(page, '73-instagram-resultados');

  await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Contatos' }).click();
  await expect(page.getByText('Quem conversou com você')).toBeVisible();
  await expect(page.getByText('JANELA ABERTA').first()).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Mídias' }).click();
  await page.getByLabel('Escolher arquivos').setInputFiles({ name: 'catalogo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await expect(page.getByText('Arquivo enviado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'catalogo.pdf', exact: true })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '74-instagram-midias');

  await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Diagnóstico' }).click();
  await expect(page.getByText('Comentários em posts e reels')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Últimos avisos' })).toContainText('Reels — eu quero');
  await expectAccessible(page);
  await shot(page, '75-instagram-diagnostico');
});

test('modelo do WhatsApp oficial com imagem, rodapé e botões de link e telefone, com prévia no celular', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/configuracoes/canais/modelos');
  await page.getByRole('button', { name: 'Novo modelo' }).click();
  const t = page.getByRole('dialog', { name: 'Novo modelo de mensagem' });
  await t.getByLabel('Nome', { exact: true }).fill('oferta_com_imagem');
  await t.getByRole('radio', { name: 'Imagem' }).click();
  await t.getByLabel('Arquivo do cabeçalho').setInputFiles({ name: 'oferta.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64') });
  await expect(t.getByText('Escolhido:')).toContainText('oferta.png');
  await t.getByLabel('Texto').fill('Oi! Chegou a oferta da semana. Toque abaixo para ver.');
  await t.getByLabel('Rodapé (opcional)').fill('Responda SAIR para não receber');
  await t.getByRole('button', { name: 'Botão', exact: true }).click();
  await t.getByLabel('Tipo do botão 1').selectOption('URL');
  await t.getByLabel('Texto do botão 1').fill('Ver a loja');
  await t.getByLabel('Link do botão 1').fill('https://exemplo.com/loja');
  await t.getByRole('button', { name: 'Botão', exact: true }).click();
  await t.getByLabel('Tipo do botão 2').selectOption('PHONE_NUMBER');
  await t.getByLabel('Texto do botão 2').fill('Ligar');
  await t.getByLabel('Telefone do botão 2').fill('+55 11 3333-4444');
  const preview = t.getByRole('complementary', { name: 'Prévia no celular' });
  await expect(preview).toContainText('Oi! Chegou a oferta da semana.');
  await expect(preview).toContainText('Ver a loja');
  await expect(preview.locator('img')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '76-modelo-com-imagem');
  await t.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Modelo enviado para a Meta aprovar.')).toBeVisible();
  await expect(page.getByText('Cabeçalho: imagem (oferta.png)')).toBeVisible();
  const state = (await (await page.request.get(`${FAKE}/__fake/state`)).json()) as { templates: { name: string; components: { type: string; format?: string; buttons?: { type: string }[] }[] }[] };
  const tpl = state.templates.find((x) => x.name === 'oferta_com_imagem')!;
  expect(tpl.components[0]!.format).toBe('IMAGE');
  expect(tpl.components.at(-1)!.buttons!.map((b) => b.type)).toEqual(['URL', 'PHONE_NUMBER']);
});

test('mídia do direct no CRM: imagem ampliada, PDF e vídeo na janela, áudio no player; gravar e mandar áudio', async ({ page }) => {
  await loginAdmin(page);
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  const fake = async (id: string, base64: string, type: string) =>
    ((await (await page.request.post(`${FAKE}/__fake/media`, { data: { id, base64, type } })).json()) as { url: string }).url;
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');
  const urls = { img: await fake('e2e-img', PNG, 'image/png'), pdf: await fake('e2e-pdf', PDF, 'application/pdf') };
  let n = 0;
  for (const [type, url] of [['image', urls.img], ['file', urls.pdf]] as const) {
    await hook(page, igHook, { object: 'instagram', entry: [{ id: '17841400000777', time: Date.now(), messaging: [
      { sender: { id: '955500011122' }, recipient: { id: '17841400000777' }, timestamp: Date.now() + ++n, message: { mid: `mid.E2EMEDIA${n}`, attachments: [{ type, payload: { url } }] } }] }] });
  }
  await page.goto('/conversas?st=all');
  await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'Instagram' }).click();
  // A conversa que acabou de receber a imagem e o PDF fica no topo da lista.
  await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Cliente Insta/ }).first().click();
  const thread = page.getByRole('list', { name: 'Mensagens' });

  await thread.getByRole('button', { name: /Ampliar a imagem/ }).click();
  const viewer = page.getByRole('dialog', { name: /^Ver / });
  await expect(viewer.locator('img')).toBeVisible();
  await shot(page, '77-imagem-ampliada');
  await viewer.getByRole('button', { name: 'Fechar' }).click();
  await thread.getByRole('button', { name: /Ver documento/ }).click();
  await expect(page.getByRole('dialog', { name: /^Ver / }).locator('iframe')).toBeVisible();
  await shot(page, '78-pdf-no-crm');
  await page.getByRole('dialog', { name: /^Ver / }).getByRole('button', { name: 'Fechar' }).click();

  // Gravar áudio (microfone falso do navegador) e mandar pelo Instagram.
  await page.getByRole('button', { name: 'Gravar áudio' }).click();
  await expect(page.getByText(/Gravando/)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Parar a gravação' }).click();
  await expect(page.getByLabel('Ouvir a gravação antes de enviar')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '79-gravacao-pronta');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(thread.locator('audio').last()).toBeVisible();
  const last = (await sent(page)).at(-1)!;
  expect((last.body.message as { attachment: { type: string } }).attachment.type).toBe('audio');
  await expectAccessible(page);
});

test('WhatsApp: transmissão com fluxo — modelo com botões, o que cada botão responde, publicar e enviar', async ({ page }) => {
  await loginAdmin(page);
  // Modelo com duas respostas rápidas, aprovado pela Meta.
  await page.goto('/configuracoes/canais/modelos');
  await page.getByRole('button', { name: 'Novo modelo' }).click();
  const t = page.getByRole('dialog', { name: 'Novo modelo de mensagem' });
  await t.getByLabel('Nome', { exact: true }).fill('raio_x_e2e');
  await t.getByLabel('Texto').fill('Quer receber o seu Raio X gratuito?');
  await t.getByRole('button', { name: 'Botão', exact: true }).click();
  await t.getByLabel('Texto do botão 1').fill('QUERO MEU RAIO X');
  await t.getByRole('button', { name: 'Botão', exact: true }).click();
  await t.getByLabel('Texto do botão 2').fill('COMO FUNCIONA?');
  await t.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Modelo enviado para a Meta aprovar.')).toBeVisible();
  await page.request.post(`${FAKE}/__fake/approve`);
  await page.getByRole('button', { name: 'Sincronizar com a Meta' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'raio_x_e2e' })).toContainText('Aprovado');

  // Novo fluxo de transmissão: já começa pelo bloco do modelo.
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'WhatsApp' }).click();
  await expect(page.getByRole('heading', { name: 'WhatsApp', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Novo fluxo' }).first().click();
  const d = page.getByRole('dialog', { name: 'Novo fluxo' });
  await expect(d.getByRole('radio', { name: /Quando você envia uma transmissão/ })).toHaveAttribute('aria-checked', 'true');
  await d.getByLabel('Nome do fluxo').fill('Raio X e2e');
  await expectAccessible(page);
  await shot(page, '80-whatsapp-novo-fluxo');
  await d.getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByLabel('Nome do fluxo')).toHaveValue('Raio X e2e');
  await page.getByRole('group', { name: 'Modelo aprovado' }).getByRole('button').first().click();
  await page.getByRole('combobox', { name: 'Modelo aprovado' }).selectOption({ label: 'raio_x_e2e (pt_BR)' });
  const node = page.getByRole('group', { name: 'Modelo aprovado' });
  await expect(node).toContainText('QUERO MEU RAIO X');
  await expect(node).toContainText('COMO FUNCIONA?');
  // O passo novo entra ligado ao primeiro botão.
  await page.getByRole('button', { name: /^Texto/ }).click();
  await page.getByLabel('Mensagem', { exact: true }).fill('Perfeito, {{nome}}! Já vamos preparar o seu Raio X.');
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tudo certo' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '81-whatsapp-editor');

  await page.getByRole('button', { name: 'Visualizar' }).click();
  const sim = page.getByRole('dialog', { name: 'Visualizar o fluxo' });
  await expect(sim.getByText('Nada é enviado ao WhatsApp.')).toBeVisible();
  await sim.getByRole('button', { name: 'Simular' }).click();
  await sim.getByRole('button', { name: 'QUERO MEU RAIO X' }).click();
  await expect(sim.getByText('Perfeito, Maria! Já vamos preparar o seu Raio X.')).toBeVisible();
  await expect(sim.getByText('Fim do fluxo.')).toBeVisible();
  await sim.getByRole('button', { name: 'Fechar', exact: true }).first().click();

  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Fluxo publicado: já pode ser usado numa transmissão.')).toBeVisible();

  // Enviar transmissão: a campanha já vem com o WhatsApp oficial e o fluxo.
  await page.getByRole('link', { name: 'Enviar transmissão' }).first().click();
  await page.getByLabel('Nome *').fill('Transmissão Raio X');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('radio', { name: /Transmissão com fluxo/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('combobox', { name: /Fluxo da transmissão/ }).locator('option:checked')).toHaveText(/Raio X e2e/);
  await expectAccessible(page);
  await shot(page, '82-whatsapp-transmissao');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Fluxo Raio X e2e')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText(/Transmissão com o fluxo/)).toBeVisible();

  await page.goto('/whatsapp/transmissoes');
  await expect(page.getByRole('region', { name: 'Transmissões' })).toContainText('Transmissão Raio X');
  await expectAccessible(page);
});
