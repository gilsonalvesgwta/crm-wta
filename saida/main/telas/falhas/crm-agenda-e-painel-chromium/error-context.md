# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crm.spec.ts >> agenda e painel
- Location: e2e/crm.spec.ts:213:1

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
- alert: Agenda
- navigation "Menu principal":
  - img "WTA"
  - paragraph: Trabalho
  - link "Início":
    - /url: /inicio
  - link "Conversas":
    - /url: /conversas
  - link "Negócios":
    - /url: /negocios
  - link "Pós-venda":
    - /url: /pos-venda
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
  - link "Instagram":
    - /url: /instagram
  - link "WhatsApp":
    - /url: /whatsapp
  - link "Agenda":
    - /url: /agenda
  - link "Plataforma":
    - /url: /plataforma
  - link "Configurações":
    - /url: /configuracoes
  - link "Minha conta":
    - /url: /conta
  - paragraph: versão dev
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
  - heading "29 de nov. – 5 de dez. de 2026" [level=2]
  - combobox "Agenda de":
    - option "Minha agenda" [selected]
    - option "Rita Campos"
  - region "domingo, 29 de novembro":
    - text: dom 29
    - list:
      - listitem: Livre
  - region "segunda-feira, 30 de novembro":
    - text: seg 30
    - list:
      - listitem: Livre
  - region "terça-feira, 1 de dezembro":
    - text: ter 1
    - list:
      - listitem: Livre
  - region "quarta-feira, 2 de dezembro":
    - text: qua 2
    - list:
      - listitem: Livre
  - region "quinta-feira, 3 de dezembro":
    - text: qui 3
    - list:
      - listitem: Livre
  - region "sexta-feira, 4 de dezembro":
    - text: sex 4
    - list:
      - listitem: Livre
  - region "sábado, 5 de dezembro":
    - text: sáb 5
    - list:
      - listitem: Livre
```

# Test source

```ts
  122 |   await shot(page, '22-negocio');
  123 | 
  124 |   // Quadro: arrastar para Negociação.
  125 |   await nav(page, 'Negócios');
  126 |   const card = page.getByRole('region', { name: 'Etapa Proposta' }).getByRole('article').filter({ hasText: 'Clínica Aurora' });
  127 |   await expect(card).toBeVisible();
  128 |   const target = page.getByRole('region', { name: 'Etapa Negociação' });
  129 |   await page.setViewportSize({ width: 1600, height: 900 });
  130 |   const from = await card.boundingBox();
  131 |   const to = await target.boundingBox();
  132 |   // Segura pela parte de baixo do cartão (o título é um link).
  133 |   await page.mouse.move(from!.x + 40, from!.y + from!.height - 14);
  134 |   await page.mouse.down();
  135 |   await page.mouse.move(from!.x + 60, from!.y + from!.height - 4, { steps: 5 });
  136 |   await page.mouse.move(to!.x + 80, to!.y + 120, { steps: 15 });
  137 |   await page.mouse.up();
  138 |   await expect(target.getByRole('article').filter({ hasText: 'Clínica Aurora' })).toBeVisible();
  139 |   await page.reload();
  140 |   await expect(page.getByRole('region', { name: 'Etapa Negociação' }).getByRole('article').filter({ hasText: 'Clínica Aurora' })).toBeVisible();
  141 |   await expectAccessible(page);
  142 |   await shot(page, '23-quadro');
  143 | 
  144 |   // Perdido pede o motivo; depois reabre e ganha. Abrir pelo quadro mostra o negócio (com a previsão).
  145 |   await page.getByRole('link', { name: /Implantação do CRM/ }).click();
  146 |   await expect(page.getByText('15 de nov. de 2026')).toBeVisible();
  147 |   await page.getByRole('button', { name: 'Perdido' }).click();
  148 |   const lost = page.getByRole('dialog', { name: 'Marcar como perdido' });
  149 |   await expect(lost.getByRole('button', { name: 'Marcar como perdido' })).toBeDisabled();
  150 |   await lost.getByLabel('Motivo da perda').selectOption({ label: 'Preço' });
  151 |   await lost.getByRole('button', { name: 'Marcar como perdido' }).click();
  152 |   await expect(page.getByText(/Perdido em .* Motivo: Preço/)).toBeVisible();
  153 |   await page.getByRole('button', { name: 'Reabrir' }).click();
  154 |   await page.getByRole('button', { name: 'Ganho', exact: true }).click();
  155 |   await page.getByRole('dialog', { name: 'Marcar como ganho' }).getByRole('button', { name: 'Marcar como ganho' }).click();
  156 |   await expect(page.getByText(/^Ganho em/)).toBeVisible();
  157 |   // Fechado sai do quadro, mas continua acessível com todo o histórico pelo "Ver ganhos".
  158 |   await page.goto('/negocios');
  159 |   await page.getByRole('link', { name: 'Ver ganhos' }).click();
  160 |   await expect(page.getByLabel('Situação')).toHaveValue('won');
  161 |   await page.getByRole('region', { name: 'Lista de negócios' }).getByRole('link', { name: /Implantação do CRM/ }).click();
  162 |   await expect(page.getByText(/^Ganho em/)).toBeVisible();
  163 | });
  164 | 
  165 | test('dado inesperado num negócio mostra um aviso, sem derrubar o CRM', async ({ page }) => {
  166 |   await loginAdmin(page);
  167 |   const list = await (await page.request.get(`/api/v1/deals?q=${encodeURIComponent('Implantação do CRM')}&status=all`)).json() as { items: { id: string }[] };
  168 |   const href = `/negocios/${list.items[0]!.id}`;
  169 |   // Datas inválidas não quebram mais a tela.
  170 |   await page.route(/\/api\/v1\/deals\/[0-9a-f-]{36}$/, async (route) => {
  171 |     const res = await route.fetch();
  172 |     const body = await res.json();
  173 |     await route.fulfill({ response: res, json: { ...body, expectedCloseDate: '2026-11-15T00:00:00.000Z', stageEnteredAt: 'data-quebrada', closedAt: 'x' } });
  174 |   });
  175 |   await page.goto(href!);
  176 |   await expect(page.getByRole('heading', { name: /Implantação do CRM/ })).toBeVisible();
  177 |   await expect(page.getByText('15 de nov. de 2026')).toBeVisible();
  178 |   await page.unroute(/\/api\/v1\/deals\/[0-9a-f-]{36}$/);
  179 |   // Qualquer outro erro de tela: aviso em português, com a mensagem, e o menu continua.
  180 |   await page.route(/\/api\/v1\/deals\/[0-9a-f-]{36}$/, async (route) => {
  181 |     const res = await route.fetch();
  182 |     await route.fulfill({ response: res, json: { ...(await res.json()), participants: null } });
  183 |   });
  184 |   await page.goto(href!);
  185 |   await expect(page.getByRole('heading', { name: 'Não foi possível mostrar esta tela' })).toBeVisible();
  186 |   await expect(page.getByText(/versão: /)).toBeVisible();
  187 |   await expect(page.getByRole('navigation').getByRole('link', { name: 'Negócios' })).toBeVisible();
  188 |   await expect(page.getByText(/^versão /)).toBeVisible();
  189 |   await page.unrouteAll({ behavior: 'ignoreErrors' });
  190 |   await expectAccessible(page);
  191 | });
  192 | 
  193 | test('leads: cadastrar e qualificar em negócio', async ({ page }) => {
  194 |   await loginAdmin(page);
  195 |   await nav(page, 'Leads');
  196 |   await page.getByRole('button', { name: 'Novo lead' }).click();
  197 |   const dlg = page.getByRole('dialog', { name: 'Novo lead' });
  198 |   await dlg.getByLabel('Título').fill('Orçamento pelo site');
  199 |   await dlg.getByLabel('Nome', { exact: true }).fill('Paulo');
  200 |   await dlg.getByLabel('E-mail').fill('paulo@padariapaulista.com.br');
  201 |   await dlg.getByLabel('Origem').fill('site');
  202 |   await dlg.getByRole('button', { name: 'Criar lead' }).click();
  203 |   await expect(page.getByRole('heading', { name: /Orçamento pelo site/ })).toBeVisible();
  204 |   await expectAccessible(page);
  205 |   await page.getByRole('button', { name: 'Qualificar' }).click();
  206 |   await page.getByRole('dialog', { name: 'Qualificar lead' }).getByLabel('Valor estimado (R$)').fill('4.800');
  207 |   await page.getByRole('dialog', { name: 'Qualificar lead' }).getByRole('button', { name: 'Qualificar e criar negócio' }).click();
  208 |   await expect(page).toHaveURL(/\/negocios\//);
  209 |   await expect(page.getByText('R$ 4.800,00').first()).toBeVisible();
  210 |   await expect(page.getByRole('link', { name: 'Lead qualificado' })).toBeVisible();
  211 | });
  212 | 
  213 | test('agenda e painel', async ({ page }) => {
  214 |   await loginAdmin(page);
  215 |   await nav(page, 'Agenda');
  216 |   await expect(page.getByRole('group', { name: 'Visão' })).toBeVisible();
  217 |   await page.getByRole('button', { name: 'Próximo' }).click();
  218 |   await page.getByRole('button', { name: 'Hoje' }).click();
  219 |   // A atividade é para amanhã: no sábado, amanhã já está na semana seguinte (a semana começa no domingo).
  220 |   const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date());
  221 |   if (weekday === 'Sat') await page.getByRole('button', { name: 'Próximo' }).click();
> 222 |   await expect(page.getByText('Ligar para apresentar a proposta').first()).toBeVisible();
      |                                                                            ^ Error: expect(locator).toBeVisible() failed
  223 |   await page.getByRole('button', { name: 'Mês' }).click();
  224 |   await expectAccessible(page);
  225 |   await shot(page, '24-agenda');
  226 |   await nav(page, 'Início');
  227 |   await expect(page.getByText('Em negociação')).toBeVisible();
  228 |   await expect(page.getByRole('heading', { name: 'Funil em aberto' })).toBeVisible();
  229 |   await expectAccessible(page);
  230 |   await shot(page, '25-painel');
  231 | });
  232 | 
  233 | test('importar planilha CSV com erro por linha', async ({ page }) => {
  234 |   await loginAdmin(page);
  235 |   await page.goto('/contatos/importar');
  236 |   const csv = ['Nome;E-mail;Telefone;Empresa', 'Ana Souza;ana@lote.com;11 91111-2222;Lote A', 'Bruno Lima;bruno@lote.com;;Lote A',
  237 |     ';sem-nome@lote.com;;', 'Carla Dias;carla@;21 3333-4444;Lote B'].join('\n');
  238 |   await page.locator('input[type=file]').setInputFiles({ name: 'contatos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  239 |   await expect(page.getByRole('heading', { name: '2. Ligue as colunas aos campos' })).toBeVisible();
  240 |   await expect(page.getByLabel('Campo para a coluna Nome')).toHaveValue('fullName');
  241 |   await expectAccessible(page);
  242 |   await shot(page, '26-importar');
  243 |   await page.getByRole('button', { name: 'Importar 4 linhas' }).click();
  244 |   await expect(page.getByText('Concluída').first()).toBeVisible({ timeout: 20_000 });
  245 |   await expect(page.getByText('Linha 4')).toBeVisible();
  246 |   await expect(page.getByText(/Linha 5 .*E-mail inválido/)).toBeVisible();
  247 |   // Ana e Bruno pelo e-mail; Carla entrou só com o telefone, porque o e-mail era inválido.
  248 |   await page.goto('/contatos?q=lote.com');
  249 |   await expect(page.getByText('2 contatos encontrados')).toBeVisible();
  250 |   await page.goto('/contatos?q=Carla');
  251 |   await expect(page.getByText('1 contato encontrado')).toBeVisible();
  252 | });
  253 | 
  254 | test('planilha modelo: baixar, importar sem mexer em nada e reconhecer todas as colunas', async ({ page }) => {
  255 |   await loginAdmin(page);
  256 |   await page.goto('/contatos/importar');
  257 |   await expect(page.getByRole('table', { name: 'Exemplo de como preencher a planilha' })).toContainText('Primeiro nome');
  258 |   await expectAccessible(page);
  259 |   await shot(page, '27-planilha-modelo');
  260 |   const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar planilha modelo' }).click()]);
  261 |   expect(download.suggestedFilename()).toBe('modelo-contatos.csv');
  262 |   const buffer = readFileSync((await download.path())!);
  263 |   expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  264 |   await page.locator('input[type=file]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'text/csv', buffer });
  265 |   await expect(page.getByRole('heading', { name: '2. Ligue as colunas aos campos' })).toBeVisible();
  266 |   for (const [col, target] of [['Primeiro nome', 'firstName'], ['Sobrenome', 'lastName'], ['E-mail', 'email'], ['Telefone', 'phone'], ['Empresa', 'organization'],
  267 |     ['Aniversário', 'birthday'], ['Etiquetas', 'tags'], ['Responsável', 'ownerEmail'], ['Origem', 'source'], ['Cidade', 'city'], ['UF', 'state'], ['Cargo', 'jobTitle']] as const) {
  268 |     await expect(page.getByLabel(`Campo para a coluna ${col}`, { exact: true })).toHaveValue(target);
  269 |   }
  270 |   await page.getByRole('button', { name: 'Importar 2 linhas' }).click();
  271 |   // Os dois entram; o responsável do exemplo (e-mail fictício) vira só um aviso na linha.
  272 |   await expect(async () => {
  273 |     await page.goto('/contatos?q=exemplo.com.br');
  274 |     await expect(page.getByText('2 contatos encontrados')).toBeVisible({ timeout: 2000 });
  275 |   }).toPass({ timeout: 30_000 });
  276 | });
  277 | 
  278 | test('Pipedrive: exportação de pessoas e de negócios entra sem erro', async ({ page }) => {
  279 |   test.setTimeout(120_000);
  280 |   await loginAdmin(page);
  281 |   const people = [
  282 |     '"Pessoa - Nome","Pessoa - Etiqueta","Pessoa - Organização","Pessoa - E-mail - Trabalho","Pessoa - E-mail - Residencial","Pessoa - E-mail - Outros","Pessoa - Telefone - Trabalho","Pessoa - Telefone - Residencial","Pessoa - Telefone - Celular","Pessoa - Telefone - Outros","Pessoa - Negócios fechados","Pessoa - Negócios em aberto","Pessoa - Próxima atividade em","Pessoa - Proprietário"',
  283 |     '"Drive Natty","","","natty.drive@hotmail.com","","","55 41 9794-7366","","","","0","1","","Servocar Consórcios"',
  284 |     '"Drive Iury","","","naopossuo@gmail.com","","","1 (774) 606-6570","","","","0","1","","Servocar Consórcios"',
  285 |     '"Drive Felipe","","","naopossuo@gmail.com","","","","","\'+55 83 9983-7655","","0","1","","Servocar Consórcios"',
  286 |   ].join('\n');
  287 |   await page.goto('/contatos/importar');
  288 |   await page.locator('input[type=file]').setInputFiles({ name: 'people-28381201-1.csv', mimeType: 'text/csv', buffer: Buffer.from(people) });
  289 |   await expect(page.getByLabel('Campo para a coluna Pessoa - Telefone - Trabalho', { exact: true })).toHaveValue('phone');
  290 |   await expect(page.getByLabel('Campo para a coluna Pessoa - Proprietário', { exact: true })).toHaveValue('ownerEmail');
  291 |   await page.getByRole('button', { name: 'Importar 3 linhas' }).click();
  292 |   await expect(page.getByText('Tudo certo')).toBeVisible({ timeout: 30_000 });
  293 | 
  294 |   // Negócios › Importar: a planilha do Pipedrive é reconhecida sozinha.
  295 |   await page.goto('/negocios');
  296 |   await page.getByRole('link', { name: 'Importar' }).click();
  297 |   const deals = [
  298 |     '"Negócio - Título","Negócio - Valor","Negócio - Organização","Negócio - Pessoa de contato","Negócio - Data de fechamento esperada","Negócio - Próxima atividade em","Negócio - Proprietário"',
  299 |     '"Drive Natty","200000","","Drive Natty","","","Servocar Consórcios"',
  300 |     '"Drive Iury","547812.9","","Drive Iury","","2026-12-12","Servocar Consórcios"',
  301 |     '"Drive Felipe","0","","Drive Felipe","","","Servocar Consórcios"',
  302 |   ].join('\n');
  303 |   await page.locator('input[type=file]').setInputFiles({ name: 'deals-28381201-3.csv', mimeType: 'text/csv', buffer: Buffer.from(deals) });
  304 |   await expect(page.getByLabel('Campo para a coluna Negócio - Valor', { exact: true })).toHaveValue('value');
  305 |   await expect(page.getByLabel('Campo para a coluna Negócio - Pessoa de contato', { exact: true })).toHaveValue('contactName');
  306 |   await expect(page.getByLabel('Funil que recebe os negócios')).toBeVisible();
  307 |   await expectAccessible(page);
  308 |   await shot(page, '28-importar-negocios-pipedrive');
  309 |   await page.getByRole('button', { name: 'Importar 3 linhas' }).click();
  310 |   await expect(page.getByText('Tudo certo')).toBeVisible({ timeout: 30_000 });
  311 |   await page.getByRole('link', { name: 'Ver negócios' }).click();
  312 |   const list = page.getByRole('region', { name: 'Lista de negócios' });
  313 |   await expect(list).toContainText('Drive Iury');
  314 |   await expect(list).toContainText('547.812,90');
  315 |   // A pessoa do negócio é a do contato importado, com o telefone arrumado.
  316 |   const r = await (await page.request.get('/api/v1/contacts?q=Drive%20Felipe')).json() as { items: { phone: string | null }[] };
  317 |   expect(r.items[0]!.phone).toBe('+5583999837655');
  318 | });
  319 | 
  320 | test('funis: arquivar, ver nos arquivados, renomear, desarquivar; limpar negócios e excluir', async ({ page }) => {
  321 |   await loginAdmin(page);
  322 |   const pipe = await (await page.request.post('/api/v1/pipelines', { data: { name: 'Funil de Teste E2E' }, headers: { 'x-crm-request': '1' } })).json() as { id: string };
```