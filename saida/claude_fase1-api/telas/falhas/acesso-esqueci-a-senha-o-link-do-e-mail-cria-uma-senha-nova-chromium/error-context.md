# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acesso.spec.ts >> esqueci a senha: o link do e-mail cria uma senha nova
- Location: e2e/acesso.spec.ts:72:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Se rita@wta.test estiver cadastrado')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Se rita@wta.test estiver cadastrado') with timeout 5000ms
  - waiting for getByText('Se rita@wta.test estiver cadastrado')

```

```yaml
- alert: CRM WTA
- complementary:
  - img "WTA Gestão e Automações"
  - paragraph: Vendas, atendimento e automações no mesmo lugar.
  - list:
    - listitem: Uma caixa de entrada para WhatsApp, Instagram e e-mail
    - listitem: Funis, tarefas e agenda do time comercial
    - listitem: Mensagens agendadas e automações ligadas ao n8n
  - paragraph: WTA Gestão e Automações
- main:
  - paragraph: CRM WTA
  - heading "Esqueci minha senha" [level=1]
  - text: Enviamos um link para você criar uma nova senha. E-mail
  - textbox "E-mail" [invalid]
  - paragraph: Informe um e-mail válido.
  - button "Enviar link"
  - link "Voltar para o login":
    - /url: /entrar
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import {
  3   |   ADMIN_EMAIL, ADMIN_PASSWORD, alertBox, expectAccessible, saveAdminSecret, lastMailTo, linkFrom, login, sha256Hex, shot, sql, totp,
  4   | } from './util';
  5   | 
  6   | const RITA = 'rita@wta.test';
  7   | const RITA_PASSWORD = 'minha senha de teste longa';
  8   | const INVITE_TOKEN = 'convite-e2e-rita-0123456789abcdefghij';
  9   | 
  10  | test.describe.configure({ mode: 'serial' });
  11  | 
  12  | test('a tela de login é acessível, no computador e no celular', async ({ page }) => {
  13  |   await page.goto('/entrar');
  14  |   await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  15  |   await expectAccessible(page);
  16  |   await shot(page, '01-login');
  17  |   await page.setViewportSize({ width: 390, height: 844 });
  18  |   await page.reload();
  19  |   const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  20  |   expect(overflow).toBeLessThanOrEqual(0);
  21  |   await shot(page, '01-login-celular');
  22  | });
  23  | 
  24  | test('senha errada mostra a mensagem e não entra', async ({ page }) => {
  25  |   await login(page, ADMIN_EMAIL, 'senha errada de propósito');
  26  |   await expect(alertBox(page)).toHaveText('E-mail ou senha incorretos.');
  27  |   await expect(page).toHaveURL(/\/entrar/);
  28  | });
  29  | 
  30  | test('sem sessão, a área interna manda para o login e volta depois', async ({ page }) => {
  31  |   await page.goto('/conta');
  32  |   await expect(page).toHaveURL(/\/entrar\?motivo=sessao&voltar=%2Fconta/);
  33  |   await expect(page.getByText('Sua sessão terminou')).toBeVisible();
  34  |   await page.getByLabel('E-mail').fill(ADMIN_EMAIL);
  35  |   await page.getByLabel('Senha', { exact: true }).fill(ADMIN_PASSWORD);
  36  |   await page.getByRole('button', { name: 'Entrar' }).click();
  37  |   await expect(page.getByRole('heading', { name: 'Conta e segurança' })).toBeVisible();
  38  | });
  39  | 
  40  | test('o administrador entra e vê o aviso para ativar a verificação em duas etapas', async ({ page }) => {
  41  |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  42  |   await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  43  |   await expect(page.getByText('Ative a verificação em duas etapas para abrir as configurações.')).toBeVisible();
  44  |   await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
  45  |   await expectAccessible(page);
  46  |   await shot(page, '02-inicio');
  47  | });
  48  | 
  49  | test('convite: a pessoa cria a conta e entra', async ({ page }) => {
  50  |   const tenant = sql("select id from tenants where slug = 'wta'").trim();
  51  |   const role = sql(`select id from roles where tenant_id = '${tenant}' and key = 'sales'`).trim();
  52  |   sql(`insert into invitations (tenant_id, email, role_id, token_hash, expires_at)
  53  |        values ('${tenant}', '${RITA}', '${role}', decode('${sha256Hex(INVITE_TOKEN)}', 'hex'), now() + interval '7 days')`);
  54  | 
  55  |   await page.goto(`/convite?token=${INVITE_TOKEN}`);
  56  |   await expect(page.getByLabel('E-mail')).toHaveValue(RITA);
  57  |   await expectAccessible(page);
  58  |   await shot(page, '03-convite');
  59  |   await page.getByLabel('Seu nome').fill('Rita Campos');
  60  |   await page.getByLabel('Crie uma senha').fill('curta');
  61  |   await page.getByLabel('Confirme a senha').fill('curta');
  62  |   await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  63  |   await expect(page.getByText('A senha precisa ter pelo menos 10 caracteres.')).toBeVisible();
  64  | 
  65  |   await page.getByLabel('Crie uma senha').fill(RITA_PASSWORD);
  66  |   await page.getByLabel('Confirme a senha').fill(RITA_PASSWORD);
  67  |   await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  68  |   await expect(page.getByRole('heading', { name: 'Olá, Rita' })).toBeVisible();
  69  |   await expect(page.getByText('Ative a verificação em duas etapas para abrir as configurações.')).toHaveCount(0);
  70  | });
  71  | 
  72  | test('esqueci a senha: o link do e-mail cria uma senha nova', async ({ page }) => {
  73  |   await page.goto('/entrar');
  74  |   await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  75  |   await page.getByLabel('E-mail').fill(RITA);
  76  |   await page.getByRole('button', { name: 'Enviar link' }).click();
> 77  |   await expect(page.getByText(`Se ${RITA} estiver cadastrado`)).toBeVisible();
      |                                                                 ^ Error: expect(locator).toBeVisible() failed
  78  | 
  79  |   const mail = lastMailTo(RITA);
  80  |   expect(mail.subject).toContain('nova senha');
  81  |   await page.goto(linkFrom(mail.text));
  82  |   await expectAccessible(page);
  83  |   await page.getByLabel('Nova senha', { exact: true }).fill('senha redefinida pelo link');
  84  |   await page.getByLabel('Confirme a nova senha').fill('senha redefinida pelo link');
  85  |   await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  86  |   await expect(page.getByText('Senha redefinida. Entre com a senha nova.')).toBeVisible();
  87  | 
  88  |   await login(page, RITA, 'senha redefinida pelo link');
  89  |   await expect(page.getByRole('heading', { name: 'Olá, Rita' })).toBeVisible();
  90  | 
  91  |   await page.goto(linkFrom(mail.text));
  92  |   await page.getByLabel('Nova senha', { exact: true }).fill('outra senha qualquer longa');
  93  |   await page.getByLabel('Confirme a nova senha').fill('outra senha qualquer longa');
  94  |   await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  95  |   await expect(page.getByText('Este link não vale mais. Peça um novo.')).toBeVisible();
  96  | });
  97  | 
  98  | test('verificação em duas etapas: ativar, sair e entrar com o código', async ({ page }) => {
  99  |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  100 |   await page.goto('/conta');
  101 |   await page.getByRole('button', { name: 'Configurar' }).click();
  102 |   const secret = (await page.locator('code').innerText()).replace(/\s/g, '');
  103 |   saveAdminSecret(secret);
  104 |   await shot(page, '04-dois-fatores');
  105 |   await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  106 |   await page.getByRole('button', { name: 'Ativar' }).click();
  107 |   await expect(page.getByText('Guarde estes códigos de recuperação em lugar seguro.')).toBeVisible();
  108 |   const codes = await page.locator('ul.font-mono li').allInnerTexts();
  109 |   expect(codes).toHaveLength(10);
  110 |   await page.getByRole('button', { name: 'Já guardei' }).click();
  111 |   await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  112 |   await expect(page.getByText('Administradores precisam manter a verificação ativa.')).toBeVisible();
  113 | 
  114 |   await page.getByRole('button', { name: /^Menu de / }).click();
  115 |   await page.getByRole('menuitem', { name: 'Sair' }).click();
  116 |   await expect(page).toHaveURL(/\/entrar/);
  117 | 
  118 |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  119 |   await expect(page).toHaveURL(/\/entrar\/verificacao/);
  120 |   await expectAccessible(page);
  121 |   await page.getByLabel('Código de 6 dígitos').fill('000000');
  122 |   await page.getByRole('button', { name: 'Confirmar' }).click();
  123 |   await expect(alertBox(page)).toContainText('Código incorreto');
  124 |   await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  125 |   await page.getByRole('button', { name: 'Confirmar' }).click();
  126 |   await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  127 |   await expect(page.getByText('Verificação em duas etapas ativa')).toBeVisible();
  128 | 
  129 |   await page.goto('/conta');
  130 |   await expect(page.getByText('Esta sessão')).toBeVisible();
  131 |   await expectAccessible(page);
  132 |   await shot(page, '05-conta');
  133 | });
  134 | 
```