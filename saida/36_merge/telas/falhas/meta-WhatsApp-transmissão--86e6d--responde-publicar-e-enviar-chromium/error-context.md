# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: meta.spec.ts >> WhatsApp: transmissão com fluxo — modelo com botões, o que cada botão responde, publicar e enviar
- Location: e2e/meta.spec.ts:324:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Transmissão com o fluxo/)
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText(/Transmissão com o fluxo/) with timeout 5000ms
  - waiting for getByText(/Transmissão com o fluxo/)

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
  - 'button "Avisos: 4 não lidos"'
  - text: WTA Gestão e Automações
  - button "Menu de Gilson Alves": GA
- main:
  - link "Campanhas":
    - /url: /campanhas
  - heading "Campanha (rascunho)" [level=1]
  - text: Transmissão Raio X
  - status: Rascunho salvo.
  - region "Passos da campanha":
    - list:
      - listitem:
        - 'button "Passo 1: Geral"': "1"
        - text: Geral
      - listitem:
        - 'button "Passo 2: Audiência (feito)"'
        - text: Audiência
      - listitem:
        - 'button "Passo 3: Conteúdo (feito)"'
        - text: Conteúdo
      - listitem:
        - 'button "Passo 4: Configurações"': "4"
        - text: Configurações
      - listitem:
        - 'button "Passo 5: Revisão" [disabled]': "5"
        - text: Revisão
    - paragraph: Visualizando passo
    - paragraph: 1. Geral
    - paragraph: 60%
    - paragraph: Completo
  - region "Geral":
    - text: Nome *
    - textbox "Nome *":
      - /placeholder: "Ex.: Campanha Black Friday 2026"
      - text: Transmissão Raio X
    - text: Descrição
    - textbox "Descrição":
      - /placeholder: Descreva brevemente o objetivo desta campanha…
    - paragraph: Opcional
    - text: Tipo de Campanha *
    - combobox "Tipo de Campanha *":
      - option "Selecione o tipo"
      - option "WhatsApp" [selected]
      - option "E-mail"
  - button "Voltar" [disabled]
  - button "Continuar"
```

# Test source

```ts
  291 |       { sender: { id: '955500011122' }, recipient: { id: '17841400000777' }, timestamp: Date.now() + ++n, message: { mid: `mid.E2EMEDIA${n}`, attachments: [{ type, payload: { url } }] } }] }] });
  292 |   }
  293 |   await page.goto('/conversas?st=all');
  294 |   await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'Instagram' }).click();
  295 |   // A conversa que acabou de receber a imagem e o PDF fica no topo da lista.
  296 |   await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Cliente Insta/ }).first().click();
  297 |   const thread = page.getByRole('list', { name: 'Mensagens' });
  298 | 
  299 |   await thread.getByRole('button', { name: /Ampliar a imagem/ }).click();
  300 |   const viewer = page.getByRole('dialog', { name: /^Ver / });
  301 |   await expect(viewer.locator('img')).toBeVisible();
  302 |   await shot(page, '77-imagem-ampliada');
  303 |   await viewer.getByRole('button', { name: 'Fechar' }).click();
  304 |   await thread.getByRole('button', { name: /Ver documento/ }).click();
  305 |   await expect(page.getByRole('dialog', { name: /^Ver / }).locator('iframe')).toBeVisible();
  306 |   await shot(page, '78-pdf-no-crm');
  307 |   await page.getByRole('dialog', { name: /^Ver / }).getByRole('button', { name: 'Fechar' }).click();
  308 | 
  309 |   // Gravar áudio (microfone falso do navegador) e mandar pelo Instagram.
  310 |   await page.getByRole('button', { name: 'Gravar áudio' }).click();
  311 |   await expect(page.getByText(/Gravando/)).toBeVisible();
  312 |   await page.waitForTimeout(1500);
  313 |   await page.getByRole('button', { name: 'Parar a gravação' }).click();
  314 |   await expect(page.getByLabel('Ouvir a gravação antes de enviar')).toBeVisible();
  315 |   await expectAccessible(page);
  316 |   await shot(page, '79-gravacao-pronta');
  317 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  318 |   await expect(thread.locator('audio').last()).toBeVisible();
  319 |   const last = (await sent(page)).at(-1)!;
  320 |   expect((last.body.message as { attachment: { type: string } }).attachment.type).toBe('audio');
  321 |   await expectAccessible(page);
  322 | });
  323 | 
  324 | test('WhatsApp: transmissão com fluxo — modelo com botões, o que cada botão responde, publicar e enviar', async ({ page }) => {
  325 |   await loginAdmin(page);
  326 |   // Modelo com duas respostas rápidas, aprovado pela Meta.
  327 |   await page.goto('/configuracoes/canais/modelos');
  328 |   await page.getByRole('button', { name: 'Novo modelo' }).click();
  329 |   const t = page.getByRole('dialog', { name: 'Novo modelo de mensagem' });
  330 |   await t.getByLabel('Nome', { exact: true }).fill('raio_x_e2e');
  331 |   await t.getByLabel('Texto').fill('Quer receber o seu Raio X gratuito?');
  332 |   await t.getByRole('button', { name: 'Botão', exact: true }).click();
  333 |   await t.getByLabel('Texto do botão 1').fill('QUERO MEU RAIO X');
  334 |   await t.getByRole('button', { name: 'Botão', exact: true }).click();
  335 |   await t.getByLabel('Texto do botão 2').fill('COMO FUNCIONA?');
  336 |   await t.getByRole('button', { name: 'Enviar para aprovação' }).click();
  337 |   await expect(page.getByText('Modelo enviado para a Meta aprovar.')).toBeVisible();
  338 |   await page.request.post(`${FAKE}/__fake/approve`);
  339 |   await page.getByRole('button', { name: 'Sincronizar com a Meta' }).click();
  340 |   await expect(page.getByRole('listitem').filter({ hasText: 'raio_x_e2e' })).toContainText('Aprovado');
  341 | 
  342 |   // Novo fluxo de transmissão: já começa pelo bloco do modelo.
  343 |   await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'WhatsApp' }).click();
  344 |   await expect(page.getByRole('heading', { name: 'WhatsApp', level: 1 })).toBeVisible();
  345 |   await page.getByRole('button', { name: 'Novo fluxo' }).first().click();
  346 |   const d = page.getByRole('dialog', { name: 'Novo fluxo' });
  347 |   await expect(d.getByRole('radio', { name: /Quando você envia uma transmissão/ })).toHaveAttribute('aria-checked', 'true');
  348 |   await d.getByLabel('Nome do fluxo').fill('Raio X e2e');
  349 |   await expectAccessible(page);
  350 |   await shot(page, '80-whatsapp-novo-fluxo');
  351 |   await d.getByRole('button', { name: 'Criar e abrir o editor' }).click();
  352 |   await expect(page.getByLabel('Nome do fluxo')).toHaveValue('Raio X e2e');
  353 |   await page.getByRole('group', { name: 'Modelo aprovado' }).getByRole('button').first().click();
  354 |   await page.getByRole('combobox', { name: 'Modelo aprovado' }).selectOption({ label: 'raio_x_e2e (pt_BR)' });
  355 |   const node = page.getByRole('group', { name: 'Modelo aprovado' });
  356 |   await expect(node).toContainText('QUERO MEU RAIO X');
  357 |   await expect(node).toContainText('COMO FUNCIONA?');
  358 |   // O passo novo entra ligado ao primeiro botão.
  359 |   await page.getByRole('button', { name: /^Texto/ }).click();
  360 |   await page.getByLabel('Mensagem', { exact: true }).fill('Perfeito, {{nome}}! Já vamos preparar o seu Raio X.');
  361 |   await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  362 |   await expect(page.getByRole('button', { name: 'Tudo certo' })).toBeVisible();
  363 |   await expectAccessible(page);
  364 |   await shot(page, '81-whatsapp-editor');
  365 | 
  366 |   await page.getByRole('button', { name: 'Visualizar' }).click();
  367 |   const sim = page.getByRole('dialog', { name: 'Visualizar o fluxo' });
  368 |   await expect(sim.getByText('Nada é enviado ao WhatsApp.')).toBeVisible();
  369 |   await sim.getByRole('button', { name: 'Simular' }).click();
  370 |   await sim.getByRole('button', { name: 'QUERO MEU RAIO X' }).click();
  371 |   await expect(sim.getByText('Perfeito, Maria! Já vamos preparar o seu Raio X.')).toBeVisible();
  372 |   await expect(sim.getByText('Fim do fluxo.')).toBeVisible();
  373 |   await sim.getByRole('button', { name: 'Fechar', exact: true }).first().click();
  374 | 
  375 |   await page.getByRole('button', { name: 'Publicar' }).click();
  376 |   await expect(page.getByText('Fluxo publicado: já pode ser usado numa transmissão.')).toBeVisible();
  377 | 
  378 |   // Enviar transmissão: a campanha já vem com o WhatsApp oficial e o fluxo.
  379 |   await page.getByRole('link', { name: 'Enviar transmissão' }).first().click();
  380 |   await page.getByLabel('Nome *').fill('Transmissão Raio X');
  381 |   await page.getByRole('button', { name: 'Continuar' }).click();
  382 |   await page.getByRole('button', { name: 'Continuar' }).click();
  383 |   await expect(page.getByRole('radio', { name: /Transmissão com fluxo/ })).toHaveAttribute('aria-checked', 'true');
  384 |   await expect(page.getByRole('combobox', { name: /Fluxo da transmissão/ }).locator('option:checked')).toHaveText(/Raio X e2e/);
  385 |   await expectAccessible(page);
  386 |   await shot(page, '82-whatsapp-transmissao');
  387 |   await page.getByRole('button', { name: 'Continuar' }).click();
  388 |   await page.getByRole('button', { name: 'Continuar' }).click();
  389 |   await expect(page.getByText('Fluxo Raio X e2e')).toBeVisible();
  390 |   await page.getByRole('button', { name: 'Salvar rascunho' }).click();
> 391 |   await expect(page.getByText(/Transmissão com o fluxo/)).toBeVisible();
      |                                                           ^ Error: expect(locator).toBeVisible() failed
  392 | 
  393 |   await page.goto('/whatsapp/transmissoes');
  394 |   await expect(page.getByRole('region', { name: 'Transmissões' })).toContainText('Transmissão Raio X');
  395 |   await expectAccessible(page);
  396 | });
  397 | 
```