import { test, expect, type Page } from '@playwright/test';
import { expectAccessible, lastMailTo, loginAdmin, shot, sql } from './util';

test.describe.configure({ mode: 'serial' });

// PNG 1×1, suficiente para o envio de logotipo (o tipo é conferido pelo conteúdo).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function openPlatform(page: Page, tab: 'Empresas' | 'Planos' | 'Greenn') {
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
