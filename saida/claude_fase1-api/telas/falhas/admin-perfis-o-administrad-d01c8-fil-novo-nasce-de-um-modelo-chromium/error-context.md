# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin.spec.ts >> perfis: o administrador é protegido; um perfil novo nasce de um modelo
- Location: e2e/admin.spec.ts:72:1

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator: getByLabel('Ver negócios')
Expected: "own"
Error: strict mode violation: getByLabel('Ver negócios') resolved to 2 elements:
    1) <select aria-label="Ver negócios" class="h-9 rounded-[6px] border border-line-strong bg-surface px-2 text-[13px]">…</select> aka getByLabel('Ver negócios', { exact: true })
    2) <select aria-label="Criar, editar e mover negócios" class="h-9 rounded-[6px] border border-line-strong bg-surface px-2 text-[13px]">…</select> aka getByLabel('Criar, editar e mover negócios')

Call log:
  - Expect "toHaveValue" getByLabel('Ver negócios') with timeout 5000ms
  - waiting for getByLabel('Ver negócios')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - alert [ref=e2]: CRM WTA
  - generic [ref=e3]:
    - navigation "Menu principal" [ref=e4]:
      - img "WTA" [ref=e6]
      - generic [ref=e7]:
        - paragraph [ref=e8]: Trabalho
        - link "Início" [ref=e9] [cursor=pointer]:
          - /url: /inicio
      - generic [ref=e13]:
        - link "Plataforma" [ref=e14] [cursor=pointer]:
          - /url: /plataforma
        - link "Configurações" [ref=e19] [cursor=pointer]:
          - /url: /configuracoes
        - link "Minha conta" [ref=e23] [cursor=pointer]:
          - /url: /conta
    - generic [ref=e27]:
      - banner [ref=e28]:
        - generic [ref=e29]: WTA Gestão e Automações
        - button "Menu de Gilson Alves" [ref=e31]: GA
      - main [ref=e32]:
        - generic [ref=e33]:
          - heading "Configurações" [level=1] [ref=e34]
          - navigation "Seções de configurações" [ref=e35]:
            - list [ref=e36]:
              - listitem [ref=e37]:
                - link "Empresa" [ref=e38] [cursor=pointer]:
                  - /url: /configuracoes/empresa
              - listitem [ref=e39]:
                - link "Identidade visual" [ref=e40] [cursor=pointer]:
                  - /url: /configuracoes/identidade-visual
              - listitem [ref=e41]:
                - link "Usuários" [ref=e42] [cursor=pointer]:
                  - /url: /configuracoes/usuarios
              - listitem [ref=e43]:
                - link "Equipes" [ref=e44] [cursor=pointer]:
                  - /url: /configuracoes/equipes
              - listitem [ref=e45]:
                - link "Perfis e permissões" [ref=e46] [cursor=pointer]:
                  - /url: /configuracoes/perfis
              - listitem [ref=e47]:
                - link "Auditoria" [ref=e48] [cursor=pointer]:
                  - /url: /configuracoes/auditoria
          - generic [ref=e49]:
            - generic [ref=e50]:
              - heading "Perfis" [level=2] [ref=e53]
              - generic [ref=e54]:
                - list [ref=e55]:
                  - listitem [ref=e56]:
                    - button "Administrador 1" [ref=e57]:
                      - generic [ref=e58]: Administrador
                      - generic [ref=e59]: "1"
                  - listitem [ref=e60]:
                    - button "Comercial 1" [ref=e61]:
                      - generic [ref=e62]: Comercial
                      - generic [ref=e63]: "1"
                  - listitem [ref=e64]:
                    - button "Financeiro 0" [ref=e65]:
                      - generic [ref=e66]: Financeiro
                      - generic [ref=e67]: "0"
                  - listitem [ref=e68]:
                    - button "Gestor 0" [ref=e69]:
                      - generic [ref=e70]: Gestor
                      - generic [ref=e71]: "0"
                  - listitem [ref=e72]:
                    - button "Líder de equipe 0" [ref=e73]:
                      - generic [ref=e74]: Líder de equipe
                      - generic [ref=e75]: "0"
                  - listitem [ref=e76]:
                    - button "Marketing 0" [ref=e77]:
                      - generic [ref=e78]: Marketing
                      - generic [ref=e79]: "0"
                  - listitem [ref=e80]:
                    - button "Suporte 0" [ref=e81]:
                      - generic [ref=e82]: Suporte
                      - generic [ref=e83]: "0"
                  - listitem [ref=e84]:
                    - button "Visualizador 0" [ref=e85]:
                      - generic [ref=e86]: Visualizador
                      - generic [ref=e87]: "0"
                  - listitem [ref=e88]:
                    - button "Pré-vendas 0" [ref=e89]:
                      - generic [ref=e90]: Pré-vendas
                      - generic [ref=e91]: "0"
                - button "Novo perfil" [ref=e92]
            - generic [ref=e93]:
              - generic [ref=e94]:
                - generic [ref=e95]:
                  - heading "Pré-vendas" [level=2] [ref=e96]
                  - generic [ref=e97]: 0 pessoas com este perfil
                - button "Excluir" [ref=e98]
              - generic [ref=e100]:
                - generic [ref=e101]:
                  - generic [ref=e102]: Nome do perfil
                  - textbox "Nome do perfil" [ref=e104]: Pré-vendas
                - group "Contatos e vendas" [ref=e105]:
                  - generic [ref=e107]:
                    - generic [ref=e108]: Ver contatos e organizações
                    - combobox "Ver contatos e organizações" [ref=e109]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e110]:
                    - generic [ref=e111]: Criar e editar contatos e organizações
                    - combobox "Criar e editar contatos e organizações" [ref=e112]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e113]:
                    - generic [ref=e114]: Excluir e mesclar contatos
                    - combobox "Excluir e mesclar contatos" [ref=e115]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e116]:
                    - generic [ref=e117]: Importar e exportar contatos
                    - combobox "Importar e exportar contatos" [ref=e118]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e119]:
                    - generic [ref=e120]: Ver leads
                    - combobox "Ver leads" [ref=e121]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e122]:
                    - generic [ref=e123]: Trabalhar leads
                    - combobox "Trabalhar leads" [ref=e124]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e125]:
                    - generic [ref=e126]: Ver negócios
                    - combobox "Ver negócios" [ref=e127]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e128]:
                    - generic [ref=e129]: Criar, editar e mover negócios
                    - combobox "Criar, editar e mover negócios" [ref=e130]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e131]:
                    - generic [ref=e132]: Atribuir negócios e leads
                    - combobox "Atribuir negócios e leads" [ref=e133]:
                      - option "Sem acesso" [selected]
                      - option "Próprios"
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e134]:
                    - generic [ref=e135]: Excluir negócios
                    - combobox "Excluir negócios" [ref=e136]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e137]:
                    - generic [ref=e138]: Exportar negócios
                    - combobox "Exportar negócios" [ref=e139]:
                      - option "Sem acesso"
                      - option "Toda a empresa" [selected]
                  - generic [ref=e140]:
                    - generic [ref=e141]: Administrar produtos e preços
                    - combobox "Administrar produtos e preços" [ref=e142]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e143]:
                    - generic [ref=e144]: Configurar funis e etapas
                    - combobox "Configurar funis e etapas" [ref=e145]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e146]:
                    - generic [ref=e147]: Definir metas
                    - combobox "Definir metas" [ref=e148]:
                      - option "Sem acesso" [selected]
                      - option "Próprios"
                      - option "Equipe"
                      - option "Toda a empresa"
                - group "Atendimento" [ref=e149]:
                  - generic [ref=e151]:
                    - generic [ref=e152]: Ver e responder conversas
                    - combobox "Ver e responder conversas" [ref=e153]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e154]:
                    - generic [ref=e155]: Atribuir e transferir conversas
                    - combobox "Atribuir e transferir conversas" [ref=e156]:
                      - option "Sem acesso" [selected]
                      - option "Próprios"
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e157]:
                    - generic [ref=e158]: Assumir conversas não atribuídas
                    - combobox "Assumir conversas não atribuídas" [ref=e159]:
                      - option "Sem acesso"
                      - option "Próprios"
                      - option "Equipe" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e160]:
                    - generic [ref=e161]: Tarefas e agenda
                    - combobox "Tarefas e agenda" [ref=e162]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e163]:
                    - generic [ref=e164]: Ver tickets
                    - combobox "Ver tickets" [ref=e165]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e166]:
                    - generic [ref=e167]: Tratar tickets
                    - combobox "Tratar tickets" [ref=e168]:
                      - option "Sem acesso" [selected]
                      - option "Próprios"
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e169]:
                    - generic [ref=e170]: Configurar SLA, categorias e estados
                    - combobox "Configurar SLA, categorias e estados" [ref=e171]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                - group "Marketing e mensagens" [ref=e172]:
                  - generic [ref=e174]:
                    - generic [ref=e175]: Mensagens agendadas
                    - combobox "Mensagens agendadas" [ref=e176]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e177]:
                    - generic [ref=e178]: Ver modelos, campanhas e segmentos
                    - combobox "Ver modelos, campanhas e segmentos" [ref=e179]:
                      - option "Sem acesso"
                      - option "Próprios"
                      - option "Equipe"
                      - option "Toda a empresa" [selected]
                  - generic [ref=e180]:
                    - generic [ref=e181]: Editar modelos, campanhas e segmentos
                    - combobox "Editar modelos, campanhas e segmentos" [ref=e182]:
                      - option "Sem acesso" [selected]
                      - option "Próprios"
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e183]:
                    - generic [ref=e184]: Aprovar envio de campanhas
                    - combobox "Aprovar envio de campanhas" [ref=e185]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e186]:
                    - generic [ref=e187]: Ver automações
                    - combobox "Ver automações" [ref=e188]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e189]:
                    - generic [ref=e190]: Administrar automações
                    - combobox "Administrar automações" [ref=e191]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                - group "Relatórios" [ref=e192]:
                  - generic [ref=e194]:
                    - generic [ref=e195]: Ver relatórios e dashboards
                    - combobox "Ver relatórios e dashboards" [ref=e196]:
                      - option "Sem acesso"
                      - option "Próprios" [selected]
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e197]:
                    - generic [ref=e198]: Exportar relatórios
                    - combobox "Exportar relatórios" [ref=e199]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                - group "Administração" [ref=e200]:
                  - generic [ref=e202]:
                    - generic [ref=e203]: Ver usuários e equipes
                    - combobox "Ver usuários e equipes" [ref=e204]:
                      - option "Sem acesso" [selected]
                      - option "Próprios"
                      - option "Equipe"
                      - option "Toda a empresa"
                  - generic [ref=e205]:
                    - generic [ref=e206]: Administrar usuários, equipes e perfis
                    - combobox "Administrar usuários, equipes e perfis" [ref=e207]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e208]:
                    - generic [ref=e209]: Ver estado das contas conectadas
                    - combobox "Ver estado das contas conectadas" [ref=e210]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e211]:
                    - generic [ref=e212]: Administrar contas conectadas e canais
                    - combobox "Administrar contas conectadas e canais" [ref=e213]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e214]:
                    - generic [ref=e215]: Administrar chaves de API e webhooks
                    - combobox "Administrar chaves de API e webhooks" [ref=e216]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e217]:
                    - generic [ref=e218]: Configurações e identidade visual da empresa
                    - combobox "Configurações e identidade visual da empresa" [ref=e219]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e220]:
                    - generic [ref=e221]: Ver auditoria
                    - combobox "Ver auditoria" [ref=e222]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                  - generic [ref=e223]:
                    - generic [ref=e224]: Exportar e anonimizar dados de um titular
                    - combobox "Exportar e anonimizar dados de um titular" [ref=e225]:
                      - option "Sem acesso" [selected]
                      - option "Toda a empresa"
                - button "Salvar perfil" [ref=e227]
```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | import { alertBox, expectAccessible, lastMailTo, linkFrom, loginAdmin, shot } from './util';
  3   | 
  4   | test.describe.configure({ mode: 'serial' });
  5   | 
  6   | const LEO = 'leo@wta.test';
  7   | 
  8   | async function openSettings(page: Page, tab: string) {
  9   |   await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Configurações' }).click();
  10  |   await page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab }).click();
  11  |   await expect(page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
  12  | }
  13  | 
  14  | test('convidar, aceitar, trocar o perfil e desativar', async ({ page, browser }) => {
  15  |   await loginAdmin(page);
  16  |   await openSettings(page, 'Usuários');
  17  |   await expect(page.getByRole('heading', { name: 'Convidar pessoa' })).toBeVisible();
  18  |   await page.getByLabel('E-mail').fill(LEO);
  19  |   await page.getByLabel('Perfil').selectOption({ label: 'Suporte' });
  20  |   await page.getByRole('button', { name: 'Convidar' }).click();
  21  |   await expect(page.getByText(`Convite enviado para ${LEO}`)).toBeVisible();
  22  |   await expect(page.getByRole('heading', { name: 'Convites pendentes' })).toBeVisible();
  23  |   await expectAccessible(page);
  24  |   await shot(page, '10-usuarios');
  25  | 
  26  |   const ctx = await browser.newContext();
  27  |   const leo = await ctx.newPage();
  28  |   await leo.goto(linkFrom(lastMailTo(LEO).text));
  29  |   await leo.getByLabel('Seu nome').fill('Leonardo Prado');
  30  |   await leo.getByLabel('Crie uma senha').fill('senha comprida do leonardo');
  31  |   await leo.getByLabel('Confirme a senha').fill('senha comprida do leonardo');
  32  |   await leo.getByRole('button', { name: 'Criar conta e entrar' }).click();
  33  |   await expect(leo.getByRole('heading', { name: 'Olá, Leonardo' })).toBeVisible();
  34  |   await expect(leo.getByRole('link', { name: 'Configurações' })).toHaveCount(0);
  35  | 
  36  |   await page.reload();
  37  |   const row = page.getByRole('row', { name: /Leonardo Prado/ });
  38  |   await expect(row).toContainText('Suporte');
  39  |   await row.getByRole('button', { name: 'Alterar perfil' }).click();
  40  |   await row.getByLabel('Suporte').uncheck();
  41  |   await row.getByLabel('Comercial').check();
  42  |   await row.getByRole('button', { name: 'Salvar' }).click();
  43  |   await expect(row).toContainText('Comercial');
  44  | 
  45  |   await row.getByRole('button', { name: 'Desativar' }).click();
  46  |   await page.getByRole('dialog').getByRole('button', { name: 'Desativar' }).click();
  47  |   await expect(row).toContainText('Desativado');
  48  | 
  49  |   await leo.reload();
  50  |   await expect(leo).toHaveURL(/\/entrar/);
  51  |   await ctx.close();
  52  | });
  53  | 
  54  | test('equipes: criar e definir as pessoas', async ({ page }) => {
  55  |   await loginAdmin(page);
  56  |   await openSettings(page, 'Equipes');
  57  |   await expect(page.getByText('Nenhuma equipe ainda')).toBeVisible();
  58  |   await page.getByLabel('Nome da equipe').fill('Comercial');
  59  |   await page.getByRole('button', { name: 'Criar equipe' }).click();
  60  |   const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Comercial' }) });
  61  |   await card.getByRole('button', { name: 'Editar' }).click();
  62  |   await card.getByLabel('Gilson Alves').check();
  63  |   await card.getByLabel('Líder').check();
  64  |   await card.getByLabel('Rita Campos').check();
  65  |   await card.getByRole('button', { name: 'Salvar' }).click();
  66  |   await expect(card).toContainText('2 pessoas');
  67  |   await expect(card).toContainText('Líder');
  68  |   await expectAccessible(page);
  69  |   await shot(page, '11-equipes');
  70  | });
  71  | 
  72  | test('perfis: o administrador é protegido; um perfil novo nasce de um modelo', async ({ page }) => {
  73  |   await loginAdmin(page);
  74  |   await openSettings(page, 'Perfis e permissões');
  75  |   await page.getByRole('button', { name: /^Administrador/ }).click();
  76  |   await expect(page.getByText('não pode ser alterado')).toBeVisible();
  77  |   await page.getByRole('button', { name: 'Novo perfil' }).click();
  78  |   await page.getByLabel('Começar a partir de').selectOption({ label: 'Comercial' });
  79  |   await page.getByLabel('Nome do perfil').fill('Pré-vendas');
  80  |   await page.getByLabel('Exportar negócios').selectOption({ label: 'Toda a empresa' });
  81  |   await page.getByRole('button', { name: 'Salvar perfil' }).click();
  82  |   await expect(page.getByRole('heading', { name: 'Pré-vendas' })).toBeVisible();
> 83  |   await expect(page.getByLabel('Ver negócios')).toHaveValue('own');
      |                                                 ^ Error: expect(locator).toHaveValue(expected) failed
  84  |   await expect(page.getByLabel('Exportar negócios')).toHaveValue('tenant');
  85  |   await expectAccessible(page);
  86  |   await shot(page, '12-perfis');
  87  | });
  88  | 
  89  | test('identidade visual: recusa cor sem contraste, aplica a nova e restaura', async ({ page }) => {
  90  |   await loginAdmin(page);
  91  |   await openSettings(page, 'Identidade visual');
  92  |   await expectAccessible(page);
  93  |   const hex = page.getByLabel('Cor da marca em hexadecimal');
  94  |   await hex.fill('#F7F7F7');
  95  |   await expect(page.getByText('Essa cor quase não aparece contra o fundo.')).toBeVisible();
  96  |   await page.getByLabel('Nome exibido do produto').fill('Aurora CRM');
  97  |   await hex.fill('#0F766E');
  98  |   await shot(page, '13-identidade-previa');
  99  |   await page.getByRole('button', { name: 'Salvar' }).click();
  100 |   await expect(page.getByText('Identidade visual salva.')).toBeVisible();
  101 |   const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  102 |   expect(await primary()).toBe('#0F766E');
  103 |   await expect(page.getByRole('navigation', { name: 'Menu principal' })).toContainText('Aurora CRM');
  104 | 
  105 |   // O tema vem no primeiro HTML, antes de qualquer script.
  106 |   const html = await (await page.request.get('/inicio')).text();
  107 |   expect(html).toContain('--primary:#0F766E');
  108 |   await page.goto('/inicio');
  109 |   expect(await primary()).toBe('#0F766E');
  110 |   await shot(page, '14-inicio-com-tema');
  111 | 
  112 |   await openSettings(page, 'Identidade visual');
  113 |   await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  114 |   await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  115 |   await expect(page.getByText('Tema padrão restaurado.')).toBeVisible();
  116 |   expect(await primary()).toBe('#FF6600');
  117 | });
  118 | 
  119 | test('auditoria mostra o que foi feito, com filtro', async ({ page }) => {
  120 |   await loginAdmin(page);
  121 |   await openSettings(page, 'Auditoria');
  122 |   await expect(page.getByRole('cell', { name: /Convidou uma pessoa/ }).first()).toBeVisible();
  123 |   await page.getByLabel('Filtrar').selectOption({ label: 'Perfis' });
  124 |   await expect(page.getByRole('cell', { name: /Criou um perfil/ })).toBeVisible();
  125 |   await expect(page.getByRole('cell', { name: /Convidou uma pessoa/ })).toHaveCount(0);
  126 |   await expectAccessible(page);
  127 |   await shot(page, '15-auditoria');
  128 | });
  129 | 
  130 | test('plataforma: criar e suspender uma empresa', async ({ page }) => {
  131 |   await loginAdmin(page);
  132 |   await page.getByRole('link', { name: 'Plataforma' }).click();
  133 |   await page.getByLabel('Nome da empresa').fill('Clínica Aurora');
  134 |   await expect(page.getByLabel('Identificador')).toHaveValue('clinica-aurora');
  135 |   await page.getByLabel('E-mail do administrador').fill('diretora@aurora.test');
  136 |   await page.getByRole('button', { name: 'Criar empresa' }).click();
  137 |   await expect(page.getByText('Empresa criada.')).toBeVisible();
  138 |   const item = page.getByRole('listitem').filter({ hasText: 'Clínica Aurora' });
  139 |   await item.getByRole('button', { name: 'Suspender' }).click();
  140 |   await page.getByRole('dialog').getByRole('button', { name: 'Suspender' }).click();
  141 |   await expect(item).toContainText('Suspensa');
  142 |   expect(lastMailTo('diretora@aurora.test').subject).toContain('Clínica Aurora');
  143 |   await expect(alertBox(page)).toHaveCount(0);
  144 |   await expectAccessible(page);
  145 |   await shot(page, '16-plataforma');
  146 | });
  147 | 
```