# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crm.spec.ts >> agenda e painel
- Location: e2e/crm.spec.ts:166:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Ligar para apresentar a proposta').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Ligar para apresentar a proposta').first() with timeout 5000ms
  - waiting for getByText('Ligar para apresentar a proposta').first()

```

```yaml
- alert: CRM WTA
- navigation "Menu principal":
  - img "WTA"
  - paragraph: Trabalho
  - link "Início":
    - /url: /inicio
  - link "Conversas":
    - /url: /conversas
  - link "Negócios":
    - /url: /negocios
  - link "Leads":
    - /url: /leads
  - link "Contatos":
    - /url: /contatos
  - link "Organizações":
    - /url: /organizacoes
  - link "Automações":
    - /url: /automacoes
  - link "Campanhas":
    - /url: /campanhas
  - link "Agenda":
    - /url: /agenda
  - link "Plataforma":
    - /url: /plataforma
  - link "Configurações":
    - /url: /configuracoes
  - link "Minha conta":
    - /url: /conta
- banner:
  - button "Avisos"
  - text: WTA Gestão e Automações
  - button "Menu de Gilson Alves": GA
- main:
  - heading "Agenda" [level=1]
  - button "Nova atividade"
  - group "Visão":
    - button "Dia"
    - button "Semana" [pressed]
    - button "Mês"
    - button "Tarefas"
  - button "Anterior"
  - button "Hoje"
  - button "Próximo"
  - heading "11 de out. – 17 de out. de 2026" [level=2]
  - combobox "Agenda de":
    - option "Minha agenda" [selected]
    - option "Rita Campos"
  - region "domingo, 11 de outubro":
    - text: dom 11
    - list:
      - listitem: Livre
  - region "segunda-feira, 12 de outubro":
    - text: seg 12
    - list:
      - listitem: Livre
  - region "terça-feira, 13 de outubro":
    - text: ter 13
    - list:
      - listitem: Livre
  - region "quarta-feira, 14 de outubro":
    - text: qua 14
    - list:
      - listitem: Livre
  - region "quinta-feira, 15 de outubro":
    - text: qui 15
    - list:
      - listitem: Livre
  - region "sexta-feira, 16 de outubro":
    - text: sex 16
    - list:
      - listitem: Livre
  - region "sábado, 17 de outubro":
    - text: sáb 17
    - list:
      - listitem: Livre
```

# Test source

```ts
  72  |   await page.getByRole('dialog').getByRole('button', { name: 'Mesclar' }).click();
  73  |   await expect(page.getByText('Possível cadastro duplicado')).toHaveCount(0);
  74  |   // Fica o cadastro aberto, completado com o que faltava; nota e arquivo vêm junto.
  75  |   await expect(page.getByRole('heading', { name: 'Mari Rocha', exact: true })).toBeVisible();
  76  |   await expect(page.getByText('Pediu proposta para 3 unidades.')).toBeVisible();
  77  |   await expect(page.getByText('proposta.pdf')).toBeVisible();
  78  | 
  79  |   await nav(page, 'Contatos');
  80  |   await page.getByLabel('Buscar contatos').fill('clinicaaurora');
  81  |   await expect(page.getByText('1 contato encontrados')).toBeVisible();
  82  |   await expectAccessible(page);
  83  |   await shot(page, '21-contatos');
  84  | });
  85  | 
  86  | test('negócios: funil padrão, quadro, regras de etapa, ganho e perda', async ({ page }) => {
  87  |   await loginAdmin(page);
  88  |   await nav(page, 'Negócios');
  89  |   await expect(page.getByRole('region', { name: 'Etapa Qualificação' })).toBeVisible();
  90  |   await page.getByRole('button', { name: 'Novo negócio' }).click();
  91  |   const dlg = page.getByRole('dialog', { name: 'Novo negócio' });
  92  |   await dlg.getByLabel('Título').fill('Implantação do CRM — Clínica Aurora');
  93  |   await dlg.getByLabel('Contato').fill('Mari');
  94  |   await dlg.getByRole('option', { name: /Mari/ }).first().click();
  95  |   await dlg.getByRole('button', { name: 'Criar negócio' }).click();
  96  |   await expect(page.getByRole('heading', { name: /Implantação do CRM/ })).toBeVisible();
  97  |   await expect(page.getByRole('button', { name: 'Qualificação' })).toHaveAttribute('aria-current', 'step');
  98  | 
  99  |   // Proposta exige valor: a mudança é recusada com a explicação.
  100 |   await page.getByRole('navigation', { name: 'Etapas do funil' }).getByRole('button', { name: 'Proposta' }).click();
  101 |   await expect(page.getByText(/exige campos que faltam.*Informe o valor/)).toBeVisible();
  102 |   await page.getByRole('button', { name: 'Editar' }).click();
  103 |   await page.getByRole('dialog', { name: 'Editar negócio' }).getByLabel(/^Valor/).fill('18.500,00');
  104 |   await page.getByRole('dialog', { name: 'Editar negócio' }).getByRole('button', { name: 'Salvar' }).click();
  105 |   await expect(page.getByText('R$ 18.500,00').first()).toBeVisible();
  106 |   await page.getByRole('navigation', { name: 'Etapas do funil' }).getByRole('button', { name: 'Proposta' }).click();
  107 |   await expect(page.getByRole('button', { name: 'Proposta' })).toHaveAttribute('aria-current', 'step');
  108 |   await expect(page.getByText('Qualificação → Proposta')).toBeVisible();
  109 |   await expectAccessible(page);
  110 |   await shot(page, '22-negocio');
  111 | 
  112 |   // Quadro: arrastar para Negociação.
  113 |   await nav(page, 'Negócios');
  114 |   const card = page.getByRole('region', { name: 'Etapa Proposta' }).getByRole('article').filter({ hasText: 'Clínica Aurora' });
  115 |   await expect(card).toBeVisible();
  116 |   const target = page.getByRole('region', { name: 'Etapa Negociação' });
  117 |   await page.setViewportSize({ width: 1600, height: 900 });
  118 |   const from = await card.boundingBox();
  119 |   const to = await target.boundingBox();
  120 |   // Segura pela parte de baixo do cartão (o título é um link).
  121 |   await page.mouse.move(from!.x + 40, from!.y + from!.height - 14);
  122 |   await page.mouse.down();
  123 |   await page.mouse.move(from!.x + 60, from!.y + from!.height - 4, { steps: 5 });
  124 |   await page.mouse.move(to!.x + 80, to!.y + 120, { steps: 15 });
  125 |   await page.mouse.up();
  126 |   await expect(target.getByRole('article').filter({ hasText: 'Clínica Aurora' })).toBeVisible();
  127 |   await page.reload();
  128 |   await expect(page.getByRole('region', { name: 'Etapa Negociação' }).getByRole('article').filter({ hasText: 'Clínica Aurora' })).toBeVisible();
  129 |   await expectAccessible(page);
  130 |   await shot(page, '23-quadro');
  131 | 
  132 |   // Perdido pede o motivo; depois reabre e ganha.
  133 |   await page.getByRole('link', { name: /Implantação do CRM/ }).click();
  134 |   await page.getByRole('button', { name: 'Perdido' }).click();
  135 |   const lost = page.getByRole('dialog', { name: 'Marcar como perdido' });
  136 |   await expect(lost.getByRole('button', { name: 'Marcar como perdido' })).toBeDisabled();
  137 |   await lost.getByLabel('Motivo da perda').selectOption({ label: 'Preço' });
  138 |   await lost.getByRole('button', { name: 'Marcar como perdido' }).click();
  139 |   await expect(page.getByText(/Perdido em .* Motivo: Preço/)).toBeVisible();
  140 |   await page.getByRole('button', { name: 'Reabrir' }).click();
  141 |   await page.getByRole('button', { name: 'Ganho', exact: true }).click();
  142 |   await page.getByRole('dialog', { name: 'Marcar como ganho' }).getByRole('button', { name: 'Marcar como ganho' }).click();
  143 |   await expect(page.getByText(/^Ganho em/)).toBeVisible();
  144 | });
  145 | 
  146 | test('leads: cadastrar e qualificar em negócio', async ({ page }) => {
  147 |   await loginAdmin(page);
  148 |   await nav(page, 'Leads');
  149 |   await page.getByRole('button', { name: 'Novo lead' }).click();
  150 |   const dlg = page.getByRole('dialog', { name: 'Novo lead' });
  151 |   await dlg.getByLabel('Título').fill('Orçamento pelo site');
  152 |   await dlg.getByLabel('Nome', { exact: true }).fill('Paulo');
  153 |   await dlg.getByLabel('E-mail').fill('paulo@padariapaulista.com.br');
  154 |   await dlg.getByLabel('Origem').fill('site');
  155 |   await dlg.getByRole('button', { name: 'Criar lead' }).click();
  156 |   await expect(page.getByRole('heading', { name: /Orçamento pelo site/ })).toBeVisible();
  157 |   await expectAccessible(page);
  158 |   await page.getByRole('button', { name: 'Qualificar' }).click();
  159 |   await page.getByRole('dialog', { name: 'Qualificar lead' }).getByLabel('Valor estimado (R$)').fill('4.800');
  160 |   await page.getByRole('dialog', { name: 'Qualificar lead' }).getByRole('button', { name: 'Qualificar e criar negócio' }).click();
  161 |   await expect(page).toHaveURL(/\/negocios\//);
  162 |   await expect(page.getByText('R$ 4.800,00').first()).toBeVisible();
  163 |   await expect(page.getByRole('link', { name: 'Lead qualificado' })).toBeVisible();
  164 | });
  165 | 
  166 | test('agenda e painel', async ({ page }) => {
  167 |   await loginAdmin(page);
  168 |   await nav(page, 'Agenda');
  169 |   await expect(page.getByRole('group', { name: 'Visão' })).toBeVisible();
  170 |   await page.getByRole('button', { name: 'Próximo' }).click();
  171 |   await page.getByRole('button', { name: 'Hoje' }).click();
> 172 |   await expect(page.getByText('Ligar para apresentar a proposta').first()).toBeVisible();
      |                                                                            ^ Error: expect(locator).toBeVisible() failed
  173 |   await page.getByRole('button', { name: 'Mês' }).click();
  174 |   await expectAccessible(page);
  175 |   await shot(page, '24-agenda');
  176 |   await nav(page, 'Início');
  177 |   await expect(page.getByText('Em negociação')).toBeVisible();
  178 |   await expect(page.getByRole('heading', { name: 'Funil em aberto' })).toBeVisible();
  179 |   await expectAccessible(page);
  180 |   await shot(page, '25-painel');
  181 | });
  182 | 
  183 | test('importar planilha CSV com erro por linha', async ({ page }) => {
  184 |   await loginAdmin(page);
  185 |   await page.goto('/contatos/importar');
  186 |   const csv = ['Nome;E-mail;Telefone;Empresa', 'Ana Souza;ana@lote.com;11 91111-2222;Lote A', 'Bruno Lima;bruno@lote.com;;Lote A',
  187 |     ';sem-nome@lote.com;;', 'Carla Dias;carla@;21 3333-4444;Lote B'].join('\n');
  188 |   await page.locator('input[type=file]').setInputFiles({ name: 'contatos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  189 |   await expect(page.getByRole('heading', { name: '2. Ligue as colunas aos campos' })).toBeVisible();
  190 |   await expect(page.getByLabel('Campo para a coluna Nome')).toHaveValue('fullName');
  191 |   await expectAccessible(page);
  192 |   await shot(page, '26-importar');
  193 |   await page.getByRole('button', { name: 'Importar 4 linhas' }).click();
  194 |   await expect(page.getByText('Concluída').first()).toBeVisible({ timeout: 20_000 });
  195 |   await expect(page.getByText('Linha 4')).toBeVisible();
  196 |   await expect(page.getByText(/Linha 5 .*E-mail inválido/)).toBeVisible();
  197 |   // Ana e Bruno pelo e-mail; Carla entrou só com o telefone, porque o e-mail era inválido.
  198 |   await page.goto('/contatos?q=lote.com');
  199 |   await expect(page.getByText('2 contatos encontrados')).toBeVisible();
  200 |   await page.goto('/contatos?q=Carla');
  201 |   await expect(page.getByText('1 contato encontrado')).toBeVisible();
  202 | });
  203 | 
  204 | test('planilha modelo: baixar, importar sem mexer em nada e reconhecer todas as colunas', async ({ page }) => {
  205 |   await loginAdmin(page);
  206 |   await page.goto('/contatos/importar');
  207 |   await expect(page.getByRole('table', { name: 'Exemplo de como preencher a planilha' })).toContainText('Primeiro nome');
  208 |   await expectAccessible(page);
  209 |   await shot(page, '27-planilha-modelo');
  210 |   const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar planilha modelo' }).click()]);
  211 |   expect(download.suggestedFilename()).toBe('modelo-contatos.csv');
  212 |   const buffer = readFileSync((await download.path())!);
  213 |   expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  214 |   await page.locator('input[type=file]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'text/csv', buffer });
  215 |   await expect(page.getByRole('heading', { name: '2. Ligue as colunas aos campos' })).toBeVisible();
  216 |   for (const [col, target] of [['Primeiro nome', 'firstName'], ['Sobrenome', 'lastName'], ['E-mail', 'email'], ['Telefone', 'phone'], ['Empresa', 'organization'],
  217 |     ['Aniversário', 'birthday'], ['Etiquetas', 'tags'], ['Responsável', 'ownerEmail'], ['Origem', 'source'], ['Cidade', 'city'], ['UF', 'state'], ['Cargo', 'jobTitle']] as const) {
  218 |     await expect(page.getByLabel(`Campo para a coluna ${col}`, { exact: true })).toHaveValue(target);
  219 |   }
  220 |   await page.getByRole('button', { name: 'Importar 2 linhas' }).click();
  221 |   // Os dois entram; o responsável do exemplo (e-mail fictício) vira só um aviso na linha.
  222 |   await expect(async () => {
  223 |     await page.goto('/contatos?q=exemplo.com.br');
  224 |     await expect(page.getByText('2 contatos encontrados')).toBeVisible({ timeout: 2000 });
  225 |   }).toPass({ timeout: 30_000 });
  226 | });
  227 | 
  228 | test('configurações do CRM: funis e campos', async ({ page }) => {
  229 |   await loginAdmin(page);
  230 |   await page.goto('/configuracoes/funis');
  231 |   await expect(page.getByRole('heading', { name: 'Etapas' })).toBeVisible();
  232 |   await expectAccessible(page);
  233 |   await shot(page, '27-funis');
  234 |   await page.goto('/configuracoes/campos');
  235 |   await page.getByRole('button', { name: 'Novo campo' }).click();
  236 |   const dlg = page.getByRole('dialog', { name: 'Novo campo' });
  237 |   await dlg.getByLabel('Rótulo').fill('Número de unidades');
  238 |   await expect(dlg.getByLabel('Chave')).toHaveValue('numero_de_unidades');
  239 |   await dlg.getByLabel('Tipo').selectOption('number');
  240 |   await dlg.getByRole('button', { name: 'Salvar' }).click();
  241 |   await expect(page.getByText('Número de unidades')).toBeVisible();
  242 |   await expectAccessible(page);
  243 | });
  244 | 
```