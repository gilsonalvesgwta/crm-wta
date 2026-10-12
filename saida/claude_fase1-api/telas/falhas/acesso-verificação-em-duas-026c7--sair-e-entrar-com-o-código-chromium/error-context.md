# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acesso.spec.ts >> verificação em duas etapas: ativar, sair e entrar com o código
- Location: e2e/acesso.spec.ts:99:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Configurar' })

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - alert [ref=f1e2]: Entrar
  - generic [ref=f1e3]:
    - complementary [ref=f1e4]:
      - img "WTA Gestão e Automações" [ref=f1e5]
      - generic [ref=f1e6]:
        - paragraph [ref=f1e7]: Vendas, atendimento e automações no mesmo lugar.
        - list [ref=f1e8]:
          - listitem [ref=f1e9]: Uma caixa de entrada para WhatsApp, Instagram e e-mail
          - listitem [ref=f1e12]: Funis, tarefas e agenda do time comercial
          - listitem [ref=f1e15]: Mensagens agendadas e automações ligadas ao n8n
      - paragraph [ref=f1e18]: WTA Gestão e Automações
    - main [ref=f1e19]:
      - generic [ref=f1e20]:
        - generic [ref=f1e21]:
          - paragraph [ref=f1e22]: CRM WTA
          - heading "Entrar" [level=1] [ref=f1e23]
          - generic [ref=f1e24]: Use o e-mail cadastrado pela sua empresa.
        - generic [ref=f1e25]:
          - status [ref=f1e26]: Sua sessão terminou. Entre de novo para continuar.
          - generic [ref=f1e27]:
            - generic [ref=f1e28]: E-mail
            - textbox "E-mail" [active] [ref=f1e30]
          - generic [ref=f1e31]:
            - generic [ref=f1e32]:
              - generic [ref=f1e33]: Senha
              - link "Esqueci minha senha" [ref=f1e34] [cursor=pointer]:
                - /url: /recuperar-senha
            - textbox "Senha" [ref=f1e35]
          - generic [ref=f1e36]:
            - checkbox "Manter conectado neste dispositivo" [ref=f1e37]
            - text: Manter conectado neste dispositivo
          - button "Entrar" [ref=f1e38]
```

# Test source

```ts
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
  75  |   await expect(page.getByRole('heading', { name: 'Esqueci minha senha' })).toBeVisible();
  76  |   await page.getByLabel('E-mail').fill(RITA);
  77  |   await page.getByRole('button', { name: 'Enviar link' }).click();
  78  |   await expect(page.getByText(`Se ${RITA} estiver cadastrado`)).toBeVisible();
  79  | 
  80  |   const mail = lastMailTo(RITA);
  81  |   expect(mail.subject).toContain('nova senha');
  82  |   await page.goto(linkFrom(mail.text));
  83  |   await expectAccessible(page);
  84  |   await page.getByLabel('Nova senha', { exact: true }).fill('senha redefinida pelo link');
  85  |   await page.getByLabel('Confirme a nova senha').fill('senha redefinida pelo link');
  86  |   await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  87  |   await expect(page.getByText('Senha redefinida. Entre com a senha nova.')).toBeVisible();
  88  | 
  89  |   await login(page, RITA, 'senha redefinida pelo link');
  90  |   await expect(page.getByRole('heading', { name: 'Olá, Rita' })).toBeVisible();
  91  | 
  92  |   await page.goto(linkFrom(mail.text));
  93  |   await page.getByLabel('Nova senha', { exact: true }).fill('outra senha qualquer longa');
  94  |   await page.getByLabel('Confirme a nova senha').fill('outra senha qualquer longa');
  95  |   await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  96  |   await expect(page.getByText('Este link não vale mais. Peça um novo.')).toBeVisible();
  97  | });
  98  | 
  99  | test('verificação em duas etapas: ativar, sair e entrar com o código', async ({ page }) => {
  100 |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  101 |   await page.goto('/conta');
> 102 |   await page.getByRole('button', { name: 'Configurar' }).click();
      |                                                          ^ Error: locator.click: Test timeout of 30000ms exceeded.
  103 |   const secret = (await page.locator('code').innerText()).replace(/\s/g, '');
  104 |   saveAdminSecret(secret);
  105 |   await shot(page, '04-dois-fatores');
  106 |   await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  107 |   await page.getByRole('button', { name: 'Ativar' }).click();
  108 |   await expect(page.getByText('Guarde estes códigos de recuperação em lugar seguro.')).toBeVisible();
  109 |   const codes = await page.locator('ul.font-mono li').allInnerTexts();
  110 |   expect(codes).toHaveLength(10);
  111 |   await page.getByRole('button', { name: 'Já guardei' }).click();
  112 |   await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  113 |   await expect(page.getByText('Administradores precisam manter a verificação ativa.')).toBeVisible();
  114 | 
  115 |   await page.getByRole('button', { name: /^Menu de / }).click();
  116 |   await page.getByRole('menuitem', { name: 'Sair' }).click();
  117 |   await expect(page).toHaveURL(/\/entrar/);
  118 | 
  119 |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  120 |   await expect(page).toHaveURL(/\/entrar\/verificacao/);
  121 |   await expectAccessible(page);
  122 |   await page.getByLabel('Código de 6 dígitos').fill('000000');
  123 |   await page.getByRole('button', { name: 'Confirmar' }).click();
  124 |   await expect(alertBox(page)).toContainText('Código incorreto');
  125 |   await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  126 |   await page.getByRole('button', { name: 'Confirmar' }).click();
  127 |   await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  128 |   await expect(page.getByText('Verificação em duas etapas ativa')).toBeVisible();
  129 | 
  130 |   await page.goto('/conta');
  131 |   await expect(page.getByText('Esta sessão')).toBeVisible();
  132 |   await expectAccessible(page);
  133 |   await shot(page, '05-conta');
  134 | });
  135 | 
```