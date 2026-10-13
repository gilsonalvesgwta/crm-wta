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
