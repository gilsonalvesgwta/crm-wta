import { test, expect, type Page } from '@playwright/test';
import { alertBox, expectAccessible, lastMailTo, linkFrom, loginAdmin, shot } from './util';

test.describe.configure({ mode: 'serial' });

const LEO = 'leo@wta.test';

async function openSettings(page: Page, tab: string) {
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab }).click();
  await expect(page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
}

test('convidar, aceitar, trocar o perfil e desativar', async ({ page, browser }) => {
  await loginAdmin(page);
  await openSettings(page, 'Usuários');
  await expect(page.getByRole('heading', { name: 'Convidar pessoa' })).toBeVisible();
  await page.getByLabel('E-mail').fill(LEO);
  await page.getByLabel('Perfil').selectOption({ label: 'Suporte' });
  await page.getByRole('button', { name: 'Convidar' }).click();
  await expect(page.getByText(`Convite enviado para ${LEO}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Convites pendentes' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '10-usuarios');

  const ctx = await browser.newContext();
  const leo = await ctx.newPage();
  await leo.goto(linkFrom(lastMailTo(LEO).text));
  await leo.getByLabel('Seu nome').fill('Leonardo Prado');
  await leo.getByLabel('Crie uma senha').fill('senha comprida do leonardo');
  await leo.getByLabel('Confirme a senha').fill('senha comprida do leonardo');
  await leo.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await expect(leo.getByRole('heading', { name: 'Olá, Leonardo' })).toBeVisible();
  await expect(leo.getByRole('link', { name: 'Configurações' })).toHaveCount(0);

  await page.reload();
  const row = page.getByRole('row', { name: /Leonardo Prado/ });
  await expect(row).toContainText('Suporte');
  await row.getByRole('button', { name: 'Alterar perfil' }).click();
  await row.getByLabel('Suporte').uncheck();
  await row.getByLabel('Comercial').check();
  await row.getByRole('button', { name: 'Salvar' }).click();
  await expect(row).toContainText('Comercial');

  await row.getByRole('button', { name: 'Desativar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Desativar' }).click();
  await expect(row).toContainText('Desativado');

  await leo.reload();
  await expect(leo).toHaveURL(/\/entrar/);
  await ctx.close();
});

test('equipes: criar e definir as pessoas', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Equipes');
  await expect(page.getByText('Nenhuma equipe ainda')).toBeVisible();
  await page.getByLabel('Nome da equipe').fill('Comercial');
  await page.getByRole('button', { name: 'Criar equipe' }).click();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Comercial' }) });
  await card.getByRole('button', { name: 'Editar' }).click();
  await card.getByLabel('Gilson Alves').check();
  await card.getByLabel('Líder').check();
  await card.getByLabel('Rita Campos').check();
  await card.getByRole('button', { name: 'Salvar' }).click();
  await expect(card).toContainText('2 pessoas');
  await expect(card).toContainText('Líder');
  await expectAccessible(page);
  await shot(page, '11-equipes');
});

test('perfis: o administrador é protegido; um perfil novo nasce de um modelo', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Perfis e permissões');
  await page.getByRole('button', { name: /^Administrador/ }).click();
  await expect(page.getByText('não pode ser alterado')).toBeVisible();
  await page.getByRole('button', { name: 'Novo perfil' }).click();
  await page.getByLabel('Começar a partir de').selectOption({ label: 'Comercial' });
  await page.getByLabel('Nome do perfil').fill('Pré-vendas');
  await page.getByLabel('Exportar negócios', { exact: true }).selectOption({ label: 'Toda a empresa' });
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('heading', { name: 'Pré-vendas' })).toBeVisible();
  await expect(page.getByLabel('Ver negócios', { exact: true })).toHaveValue('own');
  await expect(page.getByLabel('Exportar negócios', { exact: true })).toHaveValue('tenant');
  await expectAccessible(page);
  await shot(page, '12-perfis');
});

test('identidade visual: recusa cor sem contraste, aplica a nova e restaura', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Identidade visual');
  await expectAccessible(page);
  const hex = page.getByLabel('Cor da marca em hexadecimal');
  await hex.fill('#F7F7F7');
  await expect(page.getByText('Essa cor quase não aparece contra o fundo.')).toBeVisible();
  await page.getByLabel('Nome exibido do produto').fill('Aurora CRM');
  await hex.fill('#0F766E');
  await shot(page, '13-identidade-previa');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Identidade visual salva.')).toBeVisible();
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  expect(await primary()).toBe('#0F766E');
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toContainText('Aurora CRM');

  // O tema vem no primeiro HTML, antes de qualquer script.
  const html = await (await page.request.get('/inicio')).text();
  expect(html).toContain('--primary:#0F766E');
  await page.goto('/inicio');
  expect(await primary()).toBe('#0F766E');
  await shot(page, '14-inicio-com-tema');

  await openSettings(page, 'Identidade visual');
  await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Tema padrão restaurado.')).toBeVisible();
  expect(await primary()).toBe('#FF6600');
});

test('auditoria mostra o que foi feito, com filtro', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Auditoria');
  await expect(page.getByRole('cell', { name: /Convidou uma pessoa/ }).first()).toBeVisible();
  await page.getByLabel('Filtrar').selectOption({ label: 'Perfis' });
  await expect(page.getByRole('cell', { name: /Criou um perfil/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Convidou uma pessoa/ })).toHaveCount(0);
  await expectAccessible(page);
  await shot(page, '15-auditoria');
});

test('plataforma: criar e suspender uma empresa', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: 'Plataforma' }).click();
  await page.getByLabel('Nome da empresa').fill('Clínica Aurora');
  await expect(page.getByLabel('Identificador')).toHaveValue('clinica-aurora');
  await page.getByLabel('E-mail do administrador').fill('diretora@aurora.test');
  await page.getByRole('button', { name: 'Criar empresa' }).click();
  await expect(page.getByText('Empresa criada.')).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: 'Clínica Aurora' });
  await item.getByRole('button', { name: 'Suspender' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Suspender' }).click();
  await expect(item).toContainText('Suspensa');
  expect(lastMailTo('diretora@aurora.test').subject).toContain('Clínica Aurora');
  await expect(alertBox(page)).toHaveCount(0);
  await expectAccessible(page);
  await shot(page, '16-plataforma');
});
