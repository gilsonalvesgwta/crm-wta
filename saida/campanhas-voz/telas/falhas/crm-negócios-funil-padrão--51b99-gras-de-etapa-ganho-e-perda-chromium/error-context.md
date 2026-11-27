# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crm.spec.ts >> negócios: funil padrão, quadro, regras de etapa, ganho e perda
- Location: e2e/crm.spec.ts:91:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Etapa Negociação' }).getByRole('article').filter({ hasText: 'Clínica Aurora' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Etapa Negociação' }).getByRole('article').filter({ hasText: 'Clínica Aurora' }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'Etapa Negociação' }).getByRole('article').filter({ hasText: 'Clínica Aurora' })

```

```yaml
- alert
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
  - heading "Negócios" [level=1]
  - link "Importar":
    - /url: /contatos/importar?tipo=negocios&funil=a1894b87-cea3-4055-91fc-d317f3480f7e
  - link "Exportar":
    - /url: /api/v1/deals/export.csv?pipelineId=a1894b87-cea3-4055-91fc-d317f3480f7e&status=all
  - link "Funis":
    - /url: /configuracoes/funis
  - button "Trocar responsável"
  - button "Novo negócio"
  - combobox "Funil":
    - option "Vendas" [selected]
  - searchbox "Buscar negócios"
  - combobox "Responsável":
    - option "Todos os responsáveis" [selected]
    - option "Meus negócios"
    - option "Rita Campos"
  - 'link "Ver ganhos: 0 nos últimos 30 dias"':
    - /url: /negocios?funil=a1894b87-cea3-4055-91fc-d317f3480f7e&visao=lista&status=won
    - text: Ganhos 0 R$ 0
  - 'link "Ver perdidos: 0 nos últimos 30 dias"':
    - /url: /negocios?funil=a1894b87-cea3-4055-91fc-d317f3480f7e&visao=lista&status=lost
    - text: Perdidos 0 R$ 0
  - group "Visão":
    - button "Quadro" [pressed]
    - button "Lista"
  - region "Etapa Qualificação":
    - heading "Qualificação" [level=2]
    - text: "0"
    - paragraph: R$ 0 · 10%
    - list
  - region "Etapa Contato feito":
    - heading "Contato feito" [level=2]
    - text: "0"
    - paragraph: R$ 0 · 25%
    - list
  - region "Etapa Proposta":
    - heading "Proposta" [level=2]
    - text: "1"
    - paragraph: R$ 18,5 mil · 50%
    - list:
      - listitem:
        - article:
          - link "Implantação do CRM — Clínica Aurora":
            - /url: /negocios/d867feeb-80c8-47cc-8790-8f9e7ff43cf6
          - button "Mover Implantação do CRM — Clínica Aurora"
          - paragraph: Mari Rocha
          - text: R$ 18.500,00 Gilson Sem próxima atividade
  - region "Etapa Negociação":
    - heading "Negociação" [level=2]
    - text: "0"
    - paragraph: R$ 0 · 75%
    - list
  - status
```

# Test source

```ts
  40  |   await page.getByRole('listitem').filter({ has: page.getByLabel('Editar a nota') }).getByRole('button', { name: 'Salvar', exact: true }).click();
  41  |   await expect(page.getByText('Pediu proposta para 3 unidades.')).toBeVisible();
  42  | 
  43  |   await page.getByRole('button', { name: 'Agendar' }).click();
  44  |   const act = page.getByRole('dialog', { name: 'Nova atividade' });
  45  |   await act.getByLabel('Tipo').selectOption('call');
  46  |   await act.getByLabel('Título').fill('Ligar para apresentar a proposta');
  47  |   // Amanhã no fuso do navegador (São Paulo), não no da máquina que roda o teste.
  48  |   const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 86400000));
  49  |   await act.getByLabel('Início').fill(`${tomorrow}T10:00`);
  50  |   await act.getByLabel('Lembrete').selectOption('30');
  51  |   await act.getByRole('button', { name: 'Criar atividade' }).click();
  52  |   await expect(page.getByRole('button', { name: 'Ligar para apresentar a proposta', exact: true })).toBeVisible();
  53  | 
  54  |   await page.locator('input[type=file]').setInputFiles({ name: 'proposta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });
  55  |   await expect(page.getByText('proposta.pdf')).toBeVisible();
  56  |   const html = await page.locator('input[type=file]').setInputFiles({ name: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
  57  |   void html;
  58  |   await expect(page.getByText(/não são aceitos|Envie PDF/)).toBeVisible();
  59  | 
  60  |   await expect(page.getByText('Adicionou uma nota')).toBeVisible();
  61  |   await expectAccessible(page);
  62  |   await shot(page, '20-contato');
  63  | 
  64  |   // Cadastro com o mesmo e-mail: o sistema avisa e oferece abrir o existente.
  65  |   await nav(page, 'Contatos');
  66  |   await page.getByRole('button', { name: 'Novo contato' }).click();
  67  |   const d2 = page.getByRole('dialog', { name: 'Novo contato' });
  68  |   await d2.getByLabel('Nome', { exact: true }).fill('Mari');
  69  |   await d2.getByLabel('E-mail 1', { exact: true }).fill('MARIANA@clinicaaurora.com.br');
  70  |   await d2.getByRole('button', { name: 'Criar contato' }).click();
  71  |   await expect(d2.getByText('Já existe cadastro com este e-mail ou telefone')).toBeVisible();
  72  |   await expect(d2.getByText('Mariana Rocha')).toBeVisible();
  73  |   await d2.getByRole('button', { name: 'Criar mesmo assim' }).click();
  74  |   await expect(page.getByRole('heading', { name: 'Mari', exact: true })).toBeVisible();
  75  |   await expect(page.getByText('Possível cadastro duplicado')).toBeVisible();
  76  |   await page.getByRole('button', { name: 'Mesclar aqui' }).click();
  77  |   await page.getByRole('dialog').getByRole('button', { name: 'Mesclar' }).click();
  78  |   await expect(page.getByText('Possível cadastro duplicado')).toHaveCount(0);
  79  |   // Fica o cadastro aberto, completado com o que faltava; nota e arquivo vêm junto.
  80  |   await expect(page.getByRole('heading', { name: 'Mari Rocha', exact: true })).toBeVisible();
  81  |   await expect(page.getByText('Pediu proposta para 3 unidades.')).toBeVisible();
  82  |   await expect(page.getByText('proposta.pdf')).toBeVisible();
  83  | 
  84  |   await nav(page, 'Contatos');
  85  |   await page.getByLabel('Buscar contatos').fill('clinicaaurora');
  86  |   await expect(page.getByText('1 contato encontrados')).toBeVisible();
  87  |   await expectAccessible(page);
  88  |   await shot(page, '21-contatos');
  89  | });
  90  | 
  91  | test('negócios: funil padrão, quadro, regras de etapa, ganho e perda', async ({ page }) => {
  92  |   await loginAdmin(page);
  93  |   await nav(page, 'Negócios');
  94  |   await expect(page.getByRole('region', { name: 'Etapa Qualificação' })).toBeVisible();
  95  |   await page.getByRole('button', { name: 'Novo negócio' }).click();
  96  |   const dlg = page.getByRole('dialog', { name: 'Novo negócio' });
  97  |   await dlg.getByLabel('Título').fill('Implantação do CRM — Clínica Aurora');
  98  |   await dlg.getByLabel('Contato').fill('Mari');
  99  |   await dlg.getByRole('option', { name: /Mari/ }).first().click();
  100 |   await dlg.getByRole('button', { name: 'Criar negócio' }).click();
  101 |   await expect(page.getByRole('heading', { name: /Implantação do CRM/ })).toBeVisible();
  102 |   await expect(page.getByRole('button', { name: 'Qualificação' })).toHaveAttribute('aria-current', 'step');
  103 | 
  104 |   // Proposta exige valor: a mudança é recusada com a explicação.
  105 |   await page.getByRole('navigation', { name: 'Etapas do funil' }).getByRole('button', { name: 'Proposta' }).click();
  106 |   await expect(page.getByText(/exige campos que faltam.*Informe o valor/)).toBeVisible();
  107 |   await page.getByRole('button', { name: 'Editar' }).click();
  108 |   await page.getByRole('dialog', { name: 'Editar negócio' }).getByLabel(/^Valor/).fill('18.500,00');
  109 |   // Com previsão de fechamento: a página continua abrindo (antes a data quebrava a tela).
  110 |   await page.getByRole('dialog', { name: 'Editar negócio' }).getByLabel('Previsão de fechamento').fill('2026-11-15');
  111 |   await page.getByRole('dialog', { name: 'Editar negócio' }).getByRole('button', { name: 'Salvar' }).click();
  112 |   await expect(page.getByText('R$ 18.500,00').first()).toBeVisible();
  113 |   await expect(page.getByText('15 de nov. de 2026')).toBeVisible();
  114 |   // Editar de novo mantém a data no formulário.
  115 |   await page.getByRole('button', { name: 'Editar' }).click();
  116 |   await expect(page.getByRole('dialog', { name: 'Editar negócio' }).getByLabel('Previsão de fechamento')).toHaveValue('2026-11-15');
  117 |   await page.getByRole('dialog', { name: 'Editar negócio' }).getByRole('button', { name: 'Cancelar' }).click();
  118 |   await page.getByRole('navigation', { name: 'Etapas do funil' }).getByRole('button', { name: 'Proposta' }).click();
  119 |   await expect(page.getByRole('button', { name: 'Proposta' })).toHaveAttribute('aria-current', 'step');
  120 |   await expect(page.getByText('Qualificação → Proposta')).toBeVisible();
  121 |   await expectAccessible(page);
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
> 140 |   await expect(page.getByRole('region', { name: 'Etapa Negociação' }).getByRole('article').filter({ hasText: 'Clínica Aurora' })).toBeVisible();
      |                                                                                                                                   ^ Error: expect(locator).toBeVisible() failed
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
  222 |   await expect(page.getByText('Ligar para apresentar a proposta').first()).toBeVisible();
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
```