import { test, expect, type Page } from '@playwright/test';
import { expectAccessible, lastMailTo, linkFrom, login, loginAdmin, shot, sql } from './util';

test.describe.configure({ mode: 'serial' });

// PNG 1×1, suficiente para o envio de logotipo (o tipo é conferido pelo conteúdo).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function openPlatform(page: Page, tab: 'Empresas' | 'Planos' | 'Greenn' | 'Backups') {
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Plataforma' }).click();
  await page.getByRole('tab', { name: tab }).click();
}

async function openSettings(page: Page, tab: string) {
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab }).click();
}

test('plataforma: plano com limites, edição da empresa, assinatura e exclusão', async ({ page }) => {
  await loginAdmin(page);
  await openPlatform(page, 'Planos');
  await page.getByRole('button', { name: 'Novo plano' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nome').fill('Profissional');
  await dlg.getByLabel('Preço (R$)').fill('197,00');
  await dlg.getByLabel('Usuários').fill('5');
  await dlg.getByLabel('Domínio próprio').check();
  await dlg.getByRole('button', { name: 'Criar plano' }).click();
  await expect(dlg.getByText('Plano salvo.')).toBeVisible();
  await dlg.getByLabel('Código do produto').fill('123456');
  await dlg.getByRole('button', { name: 'Ligar' }).click();
  await expect(dlg.getByText('123456')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '30-plataforma-plano');
  await dlg.getByRole('button', { name: 'Fechar' }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'Profissional' });
  await expect(card).toContainText('R$ 197,00');
  await expect(card).toContainText('Greenn: 123456');

  // Empresa nova, editada e colocada no plano com vigência.
  await page.getByRole('tab', { name: 'Empresas' }).click();
  await page.getByLabel('Nome da empresa').fill('Ótica Horizonte');
  await page.getByLabel('E-mail do administrador').fill('dono@horizonte.test');
  await page.getByRole('button', { name: 'Criar empresa' }).click();
  await expect(page.getByText('Empresa criada.')).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: 'Ótica Horizonte' });
  await item.getByRole('button', { name: 'Editar Ótica Horizonte' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('E-mail do responsável').fill('gerente@horizonte.test');
  await edit.getByLabel('Telefone').fill('(11) 98888-7777');
  await edit.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(edit.getByText('Dados salvos.')).toBeVisible();
  await edit.getByRole('button', { name: 'Enviar convite de administrador' }).click();
  await expect(edit.getByText('Convite de administrador enviado para gerente@horizonte.test.')).toBeVisible();
  expect(lastMailTo('gerente@horizonte.test').subject).toContain('Ótica Horizonte');
  await edit.getByLabel('Plano').selectOption({ label: 'Profissional' });
  await edit.getByLabel('Situação').selectOption({ label: 'Ativa' });
  await edit.getByLabel('Vigência até').fill('2030-12-31');
  await edit.getByRole('button', { name: 'Salvar assinatura' }).click();
  await expect(edit.getByText('Assinatura salva.')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '31-plataforma-editar');
  await edit.getByRole('button', { name: 'Fechar' }).click();
  await expect(item).toContainText('Profissional');
  await expect(item).toContainText('até 31/12/2030');
  await expect(item).toContainText('gerente@horizonte.test');

  // Greenn sem segredo configurado: a tela explica o que falta.
  await page.getByRole('tab', { name: 'Greenn' }).click();
  await expect(page.getByText('Falta o segredo do webhook.')).toBeVisible();
  await expect(page.getByText('Nenhum aviso recebido ainda.')).toBeVisible();

  // Exclusão só com o identificador digitado.
  await page.getByRole('tab', { name: 'Empresas' }).click();
  await item.getByRole('button', { name: 'Excluir Ótica Horizonte' }).click();
  const del = page.getByRole('dialog');
  const go = del.getByRole('button', { name: 'Excluir definitivamente' });
  await expect(go).toBeDisabled();
  await del.getByLabel('Digite otica-horizonte para confirmar').fill('otica-horizonte');
  await go.click();
  await expect(page.getByText('Ótica Horizonte foi excluída.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Ótica Horizonte' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Excluir WTA' })).toHaveCount(0);
});

test('conta que perdeu a empresa entra e aceita o convite de uma empresa nova', async ({ page, browser }) => {
  const EMAIL = 'padeiro@sol.test';
  const PASS = 'forno quente de pao 2026';
  async function create(name: string) {
    await openPlatform(page, 'Empresas');
    await page.getByLabel('Nome da empresa').fill(name);
    await page.getByLabel('E-mail do administrador').fill(EMAIL);
    await page.getByRole('button', { name: 'Criar empresa' }).click();
    await expect(page.getByText('Empresa criada.')).toBeVisible();
  }
  await loginAdmin(page);
  await create('Padaria Sol');

  // A pessoa cria a conta pelo convite.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(linkFrom(lastMailTo(EMAIL).text));
  await p2.getByLabel('Seu nome').fill('Pedro Padeiro');
  await p2.getByLabel('Crie uma senha').fill(PASS);
  await p2.getByLabel('Confirme a senha').fill(PASS);
  await p2.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await expect(p2.getByRole('heading', { name: 'Olá, Pedro' })).toBeVisible();

  // A empresa é excluída: a conta continua, sem empresa.
  await openPlatform(page, 'Empresas');
  await page.getByRole('listitem').filter({ hasText: 'Padaria Sol' }).getByRole('button', { name: 'Excluir Padaria Sol' }).click();
  await page.getByRole('dialog').getByLabel('Digite padaria-sol para confirmar').fill('padaria-sol');
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir definitivamente' }).click();
  await expect(page.getByText('Padaria Sol foi excluída.')).toBeVisible();
  await p2.context().clearCookies();
  await login(p2, EMAIL, PASS);
  await expect(p2).toHaveURL(/\/entrar\/empresa/);
  await expect(p2.getByText(/não está ativa em nenhuma empresa/)).toBeVisible();
  await expectAccessible(p2);

  // Empresa nova com o mesmo e-mail: o convite pede só a senha e entra.
  await create('Padaria Sol Nova');
  await p2.context().clearCookies();
  await p2.goto(linkFrom(lastMailTo(EMAIL).text));
  await expect(p2.getByText(/já tem conta no CRM/)).toBeVisible();
  await expectAccessible(p2);
  await shot(p2, '35-convite-conta-existente');
  await p2.getByLabel('Senha', { exact: true }).fill('senha errada demais');
  await p2.getByRole('button', { name: 'Entrar e aceitar o convite' }).click();
  await expect(p2.getByText('E-mail ou senha incorretos.')).toBeVisible();
  await p2.getByLabel('Senha', { exact: true }).fill(PASS);
  await p2.getByRole('button', { name: 'Entrar e aceitar o convite' }).click();
  await expect(p2.getByRole('heading', { name: 'Olá, Pedro' })).toBeVisible();
  await ctx.close();
});

test('identidade visual: modelo de cores, menu e logotipo', async ({ page }) => {
  await loginAdmin(page);
  await openSettings(page, 'Identidade visual');
  await page.getByRole('button', { name: /Esmeralda/ }).click();
  await expect(page.getByLabel('Cor da marca em hexadecimal')).toHaveValue('#059669');
  await expect(page.getByLabel('Cor do menu lateral em hexadecimal')).toHaveValue('#062C26');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Identidade visual salva.')).toBeVisible();
  const side = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--side').trim());
  expect(await side()).toBe('#062C26');

  await page.getByLabel('Arquivo do logotipo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Logotipo atualizado.')).toBeVisible();
  const logo = page.getByRole('navigation', { name: 'Menu principal' }).getByRole('img');
  await expect(logo).toHaveAttribute('src', /\/api\/v1\/public\/branding\/.+\/logo\//);
  const r = await page.request.get((await logo.getAttribute('src'))!);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('image/png');
  await expectAccessible(page);
  await shot(page, '32-identidade-modelos');

  // Arquivo que não é imagem é recusado.
  await page.getByLabel('Arquivo do ícone (favicon)').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('não é imagem') });
  await expect(page.getByText(/Envie PDF|Envie PNG|não aceito/)).toBeVisible();
});

test('domínio próprio: instruções, cadastro e login com a marca da empresa', async ({ page, browser }) => {
  await loginAdmin(page);
  await openSettings(page, 'Domínio próprio');
  await page.getByLabel('Endereço').fill('https://crm.aurora-otica.test/');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByLabel('Endereço')).toHaveValue('crm.aurora-otica.test');
  await expect(page.getByRole('cell', { name: 'CNAME' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'crm', exact: true })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '33-dominio-proprio');

  // Com o DNS conferido, a tela de login nesse endereço sai com a marca da empresa.
  sql("update tenant_domains set dns_ok = true, verified_at = now() where domain = 'crm.aurora-otica.test'");
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-host': 'crm.aurora-otica.test' } });
  const p2 = await ctx.newPage();
  await p2.goto('/entrar');
  await expect(p2.locator('aside img')).toHaveAttribute('src', /\/logo\//);
  expect(await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--side').trim())).toBe('#062C26');
  await expect(p2).toHaveTitle(/WTA|CRM/);
  await shot(p2, '34-login-dominio-proprio');
  await ctx.close();

  // No endereço principal, a tela de login continua com a marca padrão.
  const fresh = await browser.newContext();
  const plain = await (await fresh.request.get('/entrar')).text();
  expect(plain).not.toContain('--side:#062C26');
  await fresh.close();

  // Limpeza: volta ao padrão para os outros testes.
  await page.getByRole('button', { name: 'Remover' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
  await expect(page.getByLabel('Endereço')).toHaveValue('');
  await openSettings(page, 'Identidade visual');
  await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Tema padrão restaurado.')).toBeVisible();
});

test('backups: fazer cópia agora, baixar e restaurar uma empresa', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await openPlatform(page, 'Backups');
  await expect(page.getByText('Serviço de cópias funcionando')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Fazer cópia agora' }).click();
  await expect(page.getByText('Cópia pedida.')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Manual' });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toContainText('Incluídos');
  const href = await row.getByRole('link', { name: /Baixar/ }).getAttribute('href');
  const dl = await page.request.get(href!);
  expect(dl.status()).toBe(200);
  expect((await dl.body()).length).toBeGreaterThan(1000);
  await expectAccessible(page);
  await shot(page, '36-backups');

  await row.getByRole('button', { name: /Restaurar/ }).click();
  const d = page.getByRole('dialog', { name: 'Restaurar cópia' });
  await d.getByLabel('Empresa', { exact: true }).selectOption({ index: 0 });
  const go = d.getByRole('button', { name: /^Restaurar / });
  await expect(go).toBeDisabled();
  await d.getByLabel('Digite RESTAURAR para confirmar').fill('RESTAURAR');
  await expectAccessible(page);
  await shot(page, '37-backups-restaurar');
  await go.click();
  await expect(page.getByText(/Restauração de .* pedida/)).toBeVisible();
  const job = page.getByRole('listitem').filter({ hasText: 'Restaurar uma empresa' }).first();
  await expect(job).toContainText('Concluído', { timeout: 90_000 });
  await expect(page.getByRole('row').filter({ hasText: 'Antes de restaurar' })).toBeVisible();
  // O CRM continua funcionando para quem está dentro.
  await page.goto('/inicio');
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
});
