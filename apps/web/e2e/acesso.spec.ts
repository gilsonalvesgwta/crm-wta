import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, ADMIN_PASSWORD, alertBox, expectAccessible, lastMailTo, linkFrom, login, sha256Hex, shot, sql, totp,
} from './util';

const RITA = 'rita@wta.test';
const RITA_PASSWORD = 'minha senha de teste longa';
const INVITE_TOKEN = 'convite-e2e-rita-0123456789abcdefghij';

test.describe.configure({ mode: 'serial' });

test('a tela de login é acessível, no computador e no celular', async ({ page }) => {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '01-login');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, '01-login-celular');
});

test('senha errada mostra a mensagem e não entra', async ({ page }) => {
  await login(page, ADMIN_EMAIL, 'senha errada de propósito');
  await expect(alertBox(page)).toHaveText('E-mail ou senha incorretos.');
  await expect(page).toHaveURL(/\/entrar/);
});

test('sem sessão, a área interna manda para o login e volta depois', async ({ page }) => {
  await page.goto('/conta');
  await expect(page).toHaveURL(/\/entrar\?motivo=sessao&voltar=%2Fconta/);
  await expect(page.getByText('Sua sessão terminou')).toBeVisible();
  await page.getByLabel('E-mail').fill(ADMIN_EMAIL);
  await page.getByLabel('Senha', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Conta e segurança' })).toBeVisible();
});

test('o administrador entra e vê o aviso para ativar a verificação em duas etapas', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  await expect(page.getByText('Ative a verificação em duas etapas para abrir as configurações.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page);
  await shot(page, '02-inicio');
});

test('convite: a pessoa cria a conta e entra', async ({ page }) => {
  const tenant = sql("select id from tenants where slug = 'wta'").trim();
  const role = sql(`select id from roles where tenant_id = '${tenant}' and key = 'sales'`).trim();
  sql(`insert into invitations (tenant_id, email, role_id, token_hash, expires_at)
       values ('${tenant}', '${RITA}', '${role}', decode('${sha256Hex(INVITE_TOKEN)}', 'hex'), now() + interval '7 days')`);

  await page.goto(`/convite?token=${INVITE_TOKEN}`);
  await expect(page.getByLabel('E-mail')).toHaveValue(RITA);
  await expectAccessible(page);
  await shot(page, '03-convite');
  await page.getByLabel('Seu nome').fill('Rita Campos');
  await page.getByLabel('Crie uma senha').fill('curta');
  await page.getByLabel('Confirme a senha').fill('curta');
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await expect(page.getByText('A senha precisa ter pelo menos 10 caracteres.')).toBeVisible();

  await page.getByLabel('Crie uma senha').fill(RITA_PASSWORD);
  await page.getByLabel('Confirme a senha').fill(RITA_PASSWORD);
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rita' })).toBeVisible();
  await expect(page.getByText('Ative a verificação em duas etapas para abrir as configurações.')).toHaveCount(0);
});

test('esqueci a senha: o link do e-mail cria uma senha nova', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill(RITA);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByText(`Se ${RITA} estiver cadastrado`)).toBeVisible();

  const mail = lastMailTo(RITA);
  expect(mail.subject).toContain('nova senha');
  await page.goto(linkFrom(mail.text));
  await expectAccessible(page);
  await page.getByLabel('Nova senha', { exact: true }).fill('senha redefinida pelo link');
  await page.getByLabel('Confirme a nova senha').fill('senha redefinida pelo link');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByText('Senha redefinida. Entre com a senha nova.')).toBeVisible();

  await login(page, RITA, 'senha redefinida pelo link');
  await expect(page.getByRole('heading', { name: 'Olá, Rita' })).toBeVisible();

  await page.goto(linkFrom(mail.text));
  await page.getByLabel('Nova senha', { exact: true }).fill('outra senha qualquer longa');
  await page.getByLabel('Confirme a nova senha').fill('outra senha qualquer longa');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByText('Este link não vale mais. Peça um novo.')).toBeVisible();
});

test('verificação em duas etapas: ativar, sair e entrar com o código', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/conta');
  await page.getByRole('button', { name: 'Configurar' }).click();
  const secret = (await page.locator('code').innerText()).replace(/\s/g, '');
  await shot(page, '04-dois-fatores');
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText('Guarde estes códigos de recuperação em lugar seguro.')).toBeVisible();
  const codes = await page.locator('ul.font-mono li').allInnerTexts();
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'Já guardei' }).click();
  await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  await expect(page.getByText('Administradores precisam manter a verificação ativa.')).toBeVisible();

  await page.getByRole('button', { name: /^Menu de / }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar/);

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/entrar\/verificacao/);
  await expectAccessible(page);
  await page.getByLabel('Código de 6 dígitos').fill('000000');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(alertBox(page)).toContainText('Código incorreto');
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  await expect(page.getByText('Verificação em duas etapas ativa')).toBeVisible();

  await page.goto('/conta');
  await expect(page.getByText('Esta sessão')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '05-conta');
});
