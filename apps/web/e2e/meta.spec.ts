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
