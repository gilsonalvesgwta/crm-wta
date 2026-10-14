import { test, expect, type Page } from '@playwright/test';
import { expectAccessible, loginAdmin, shot } from './util';

test.describe.configure({ mode: 'serial' });

async function openSettings(page: Page, tab: string) {
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab }).click();
}

test('automação: contato novo vira tarefa, com o histórico da execução', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await openSettings(page, 'Automações');
  await expect(page.getByText('Nenhuma automação ainda.')).toBeVisible();
  await page.getByRole('button', { name: 'Nova automação' }).click();
  const d = page.getByRole('dialog', { name: 'Nova automação' });
  await d.getByLabel('Nome', { exact: true }).fill('Ligar para quem chega');
  await d.getByLabel('Acontecimento').selectOption({ label: 'Contato novo' });
  await d.getByLabel('Título da tarefa').fill('Ligar para {{nome}}');
  await d.getByLabel('Tipo').selectOption({ label: 'Ligação' });
  await d.getByRole('button', { name: 'Mais uma ação' }).click();
  await expect(d.getByLabel('Ação 2', { exact: true })).toHaveValue('wait');
  await d.getByRole('button', { name: 'Tirar a ação 2' }).click();
  await expectAccessible(page);
  await shot(page, '50-automacao-editor');
  await d.getByRole('button', { name: 'Criar automação' }).click();
  await expect(page.getByText('Automação criada.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Ligar para quem chega' })).toContainText('Ligada');

  const c = await page.request.post('/api/v1/contacts', { data: { firstName: 'Rafaela', lastName: 'Lima', allowDuplicate: true }, headers: { 'x-crm-request': '1' } });
  expect(c.status()).toBe(201);
  const runs = page.getByRole('listitem').filter({ hasText: 'Rafaela Lima' });
  await expect(async () => {
    await page.getByRole('button', { name: 'Atualizar' }).click();
    await expect(runs.first()).toContainText('Concluída', { timeout: 1000 });
  }).toPass({ timeout: 40_000 });
  await expect(runs.first()).toContainText('tarefa "Ligar para Rafaela Lima" criada');
  await expectAccessible(page);
  await shot(page, '51-automacoes');

  // Desligar.
  await page.getByRole('listitem').filter({ hasText: 'Ligar para quem chega' }).first().getByRole('checkbox').click({ timeout: 5000 });
  await expect(page.getByRole('listitem').filter({ hasText: 'Ligar para quem chega' }).first()).toContainText('Desligada');
});

test('n8n: chave de API mostrada uma vez, cadastro de contato e negócio pela entrada, revogar', async ({ page, browser }) => {
  await loginAdmin(page);
  await openSettings(page, 'API e n8n');
  await page.getByLabel('Nome da chave').fill('n8n de teste');
  await page.getByRole('button', { name: 'Criar chave' }).click();
  await expect(page.getByText('Copie agora: ela não aparece de novo.')).toBeVisible();
  const key = (await page.locator('code').filter({ hasText: /^crm_/ }).textContent())!.trim();
  expect(key).toMatch(/^crm_[a-z0-9]{12}_/);
  await expect(page.getByText(/api\/v1\/inbound/)).toBeVisible();
  await expectAccessible(page);
  await shot(page, '52-api-n8n');

  // O n8n chama sem sessão, só com a chave.
  const ctx = await browser.newContext();
  const r = await ctx.request.post('/api/v1/inbound', {
    headers: { authorization: `Bearer ${key}` },
    data: { contact: { name: 'Lucas Pereira', email: 'lucas@cliente.test' }, deal: { title: 'Pedido via n8n', value: 900 } },
  });
  expect(r.status()).toBe(200);
  const body = await r.json() as { contactId: string; dealId: string };
  await page.goto(`/negocios/${body.dealId}`);
  await expect(page.getByRole('heading', { name: /Pedido via n8n/ })).toBeVisible();

  await openSettings(page, 'API e n8n');
  await page.getByRole('button', { name: 'Revogar n8n de teste' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revogar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'n8n de teste' })).toContainText('Revogada');
  const denied = await ctx.request.post('/api/v1/inbound', { headers: { authorization: `Bearer ${key}` }, data: { contact: { name: 'X' } } });
  expect(denied.status()).toBe(401);
  await ctx.close();
});
