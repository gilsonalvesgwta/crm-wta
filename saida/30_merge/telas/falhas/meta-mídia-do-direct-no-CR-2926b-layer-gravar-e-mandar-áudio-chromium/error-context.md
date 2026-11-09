# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: meta.spec.ts >> mídia do direct no CRM: imagem ampliada, PDF e vídeo na janela, áudio no player; gravar e mandar áudio
- Location: e2e/meta.spec.ts:281:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('list', { name: 'Mensagens' }).locator('audio').last()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('list', { name: 'Mensagens' }).locator('audio').last() with timeout 5000ms
  - waiting for getByRole('list', { name: 'Mensagens' }).locator('audio').last()

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
  - link "Instagram":
    - /url: /instagram
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
  - 'button "Avisos: 2 não lidos"'
  - text: WTA Gestão e Automações
  - button "Menu de Gilson Alves": GA
- main:
  - heading "Conversas" [level=1]
  - text: WhatsApp e e-mail dos contatos que você atende.
  - link "Respostas prontas":
    - /url: /conversas/respostas
  - button "Nova conversa"
  - region "Lista de conversas":
    - searchbox "Buscar conversa pelo nome"
    - group "Canal":
      - button "Todos"
      - button "WhatsApp"
      - button "E-mail"
      - button "Instagram" [pressed]
      - button "Filtros"
    - group "Filtrar por estado":
      - button "Abertas 2"
      - button "Aguardando 0"
      - button "Encerradas 0"
      - button "Todas 2" [pressed]
    - list:
      - listitem:
        - button "Instagram Cliente Insta agora Documento Gilson Alves Aberta":
          - img "Instagram"
          - text: Cliente Insta agora Documento Gilson Alves Aberta
      - listitem:
        - 'button "Instagram @ana.e2e agora Você: Oi, ! Que bom que você comentou 😊 Toque no botão abaixo que eu te mando tudo por aqui. [Quero] Sem responsável Aberta"':
          - img "Instagram"
          - text: "@ana.e2e agora Você: Oi, ! Que bom que você comentou 😊 Toque no botão abaixo que eu te mando tudo por aqui. [Quero] Sem responsável Aberta"
  - region "Conversa":
    - paragraph:
      - link "Cliente Insta":
        - /url: /contatos/6e97184f-cdb9-4476-acae-aa6f3c8fa0b1
      - text: Instagram Aberta
    - paragraph: "@cliente.insta"
    - text: Estado
    - combobox "Estado":
      - option "Aberta" [selected]
      - option "Aguardando cliente"
      - option "Encerrada"
    - text: Responsável
    - combobox "Responsável":
      - option "Sem responsável"
      - option "Gilson Alves (você)" [selected]
      - option "Rita Campos"
    - text: Equipe
    - combobox "Equipe":
      - option "Sem equipe" [selected]
      - option "Comercial"
    - list "Mensagens":
      - listitem:
        - paragraph: Instagram · Insta da loja
        - paragraph: Vocês entregam em Curitiba?
        - paragraph:
          - time: 09 de nov., 20:46
      - listitem:
        - paragraph: Instagram · Insta da loja · Gilson Alves
        - paragraph: Entregamos sim!
        - paragraph:
          - time: 09 de nov., 20:46
          - text: Enviada
      - listitem:
        - paragraph: Instagram · Insta da loja
        - button "Ampliar a imagem instagram-image.png":
          - img "instagram-image.png"
        - button "Baixar 70 B"
        - paragraph:
          - time: 09 de nov., 20:47
      - listitem:
        - paragraph: Instagram · Insta da loja
        - button "instagram-document.pdf PDF · 125 B · Ver documento"
        - button "Baixar 125 B"
        - paragraph:
          - time: 09 de nov., 20:47
    - alert: Grave de novo.
    - text: Enviar por
    - combobox "Enviar por":
      - option "Instagram · Insta da loja · @empresa.teste" [selected]
    - text: Mensagem
    - textbox "Mensagem":
      - /placeholder: Escreva a mensagem (/ para respostas prontas, Ctrl+Enter envia)
    - text: Digite barra para buscar uma resposta pronta; use as setas e Enter para escolher.
    - button "Anexar arquivo à mensagem"
    - button "Descartar a gravação"
    - button "Respostas"
    - button "Enviar"
```

# Test source

```ts
  217 |   expect((out[1]!.body.recipient as { comment_id: string }).comment_id).toBe('18000000000777001');
  218 | 
  219 |   await page.goto('/instagram');
  220 |   await expect(page.getByRole('listitem').filter({ hasText: 'Reels — eu quero' })).toContainText('Ativo');
  221 |   await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Resultados' }).click();
  222 |   await expect(page.getByText('Disparos', { exact: true })).toBeVisible();
  223 |   await expect(page.getByRole('region', { name: 'Últimas pessoas' })).toContainText('Esperando');
  224 |   await expectAccessible(page);
  225 |   await shot(page, '73-instagram-resultados');
  226 | 
  227 |   await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Contatos' }).click();
  228 |   await expect(page.getByText('Quem conversou com você')).toBeVisible();
  229 |   await expect(page.getByText('JANELA ABERTA').first()).toBeVisible();
  230 |   await expectAccessible(page);
  231 | 
  232 |   await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Mídias' }).click();
  233 |   await page.getByLabel('Escolher arquivos').setInputFiles({ name: 'catalogo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  234 |   await expect(page.getByText('Arquivo enviado.')).toBeVisible();
  235 |   await expect(page.getByRole('button', { name: 'catalogo.pdf', exact: true })).toBeVisible();
  236 |   await expectAccessible(page);
  237 |   await shot(page, '74-instagram-midias');
  238 | 
  239 |   await page.getByRole('navigation', { name: 'Subopções do Instagram' }).getByRole('link', { name: 'Diagnóstico' }).click();
  240 |   await expect(page.getByText('Comentários em posts e reels')).toBeVisible();
  241 |   await expect(page.getByRole('region', { name: 'Últimos avisos' })).toContainText('Reels — eu quero');
  242 |   await expectAccessible(page);
  243 |   await shot(page, '75-instagram-diagnostico');
  244 | });
  245 | 
  246 | test('modelo do WhatsApp oficial com imagem, rodapé e botões de link e telefone, com prévia no celular', async ({ page }) => {
  247 |   await loginAdmin(page);
  248 |   await page.goto('/configuracoes/canais/modelos');
  249 |   await page.getByRole('button', { name: 'Novo modelo' }).click();
  250 |   const t = page.getByRole('dialog', { name: 'Novo modelo de mensagem' });
  251 |   await t.getByLabel('Nome', { exact: true }).fill('oferta_com_imagem');
  252 |   await t.getByRole('radio', { name: 'Imagem' }).click();
  253 |   await t.getByLabel('Arquivo do cabeçalho').setInputFiles({ name: 'oferta.png', mimeType: 'image/png',
  254 |     buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64') });
  255 |   await expect(t.getByText('Escolhido:')).toContainText('oferta.png');
  256 |   await t.getByLabel('Texto').fill('Oi! Chegou a oferta da semana. Toque abaixo para ver.');
  257 |   await t.getByLabel('Rodapé (opcional)').fill('Responda SAIR para não receber');
  258 |   await t.getByRole('button', { name: 'Botão', exact: true }).click();
  259 |   await t.getByLabel('Tipo do botão 1').selectOption('URL');
  260 |   await t.getByLabel('Texto do botão 1').fill('Ver a loja');
  261 |   await t.getByLabel('Link do botão 1').fill('https://exemplo.com/loja');
  262 |   await t.getByRole('button', { name: 'Botão', exact: true }).click();
  263 |   await t.getByLabel('Tipo do botão 2').selectOption('PHONE_NUMBER');
  264 |   await t.getByLabel('Texto do botão 2').fill('Ligar');
  265 |   await t.getByLabel('Telefone do botão 2').fill('+55 11 3333-4444');
  266 |   const preview = t.getByRole('complementary', { name: 'Prévia no celular' });
  267 |   await expect(preview).toContainText('Oi! Chegou a oferta da semana.');
  268 |   await expect(preview).toContainText('Ver a loja');
  269 |   await expect(preview.locator('img')).toBeVisible();
  270 |   await expectAccessible(page);
  271 |   await shot(page, '76-modelo-com-imagem');
  272 |   await t.getByRole('button', { name: 'Enviar para aprovação' }).click();
  273 |   await expect(page.getByText('Modelo enviado para a Meta aprovar.')).toBeVisible();
  274 |   await expect(page.getByText('Cabeçalho: imagem (oferta.png)')).toBeVisible();
  275 |   const state = (await (await page.request.get(`${FAKE}/__fake/state`)).json()) as { templates: { name: string; components: { type: string; format?: string; buttons?: { type: string }[] }[] }[] };
  276 |   const tpl = state.templates.find((x) => x.name === 'oferta_com_imagem')!;
  277 |   expect(tpl.components[0]!.format).toBe('IMAGE');
  278 |   expect(tpl.components.at(-1)!.buttons!.map((b) => b.type)).toEqual(['URL', 'PHONE_NUMBER']);
  279 | });
  280 | 
  281 | test('mídia do direct no CRM: imagem ampliada, PDF e vídeo na janela, áudio no player; gravar e mandar áudio', async ({ page }) => {
  282 |   await loginAdmin(page);
  283 |   const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  284 |   const fake = async (id: string, base64: string, type: string) =>
  285 |     ((await (await page.request.post(`${FAKE}/__fake/media`, { data: { id, base64, type } })).json()) as { url: string }).url;
  286 |   const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');
  287 |   const urls = { img: await fake('e2e-img', PNG, 'image/png'), pdf: await fake('e2e-pdf', PDF, 'application/pdf') };
  288 |   let n = 0;
  289 |   for (const [type, url] of [['image', urls.img], ['file', urls.pdf]] as const) {
  290 |     await hook(page, igHook, { object: 'instagram', entry: [{ id: '17841400000777', time: Date.now(), messaging: [
  291 |       { sender: { id: '955500011122' }, recipient: { id: '17841400000777' }, timestamp: Date.now() + ++n, message: { mid: `mid.E2EMEDIA${n}`, attachments: [{ type, payload: { url } }] } }] }] });
  292 |   }
  293 |   await page.goto('/conversas?st=all');
  294 |   await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'Instagram' }).click();
  295 |   await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Cliente Insta/ }).click();
  296 |   const thread = page.getByRole('list', { name: 'Mensagens' });
  297 | 
  298 |   await thread.getByRole('button', { name: /Ampliar a imagem/ }).click();
  299 |   const viewer = page.getByRole('dialog', { name: /^Ver / });
  300 |   await expect(viewer.locator('img')).toBeVisible();
  301 |   await shot(page, '77-imagem-ampliada');
  302 |   await viewer.getByRole('button', { name: 'Fechar' }).click();
  303 |   await thread.getByRole('button', { name: /Ver documento/ }).click();
  304 |   await expect(page.getByRole('dialog', { name: /^Ver / }).locator('iframe')).toBeVisible();
  305 |   await shot(page, '78-pdf-no-crm');
  306 |   await page.getByRole('dialog', { name: /^Ver / }).getByRole('button', { name: 'Fechar' }).click();
  307 | 
  308 |   // Gravar áudio (microfone falso do navegador) e mandar pelo Instagram.
  309 |   await page.getByRole('button', { name: 'Gravar áudio' }).click();
  310 |   await expect(page.getByText(/Gravando/)).toBeVisible();
  311 |   await page.waitForTimeout(1500);
  312 |   await page.getByRole('button', { name: 'Parar a gravação' }).click();
  313 |   await expect(page.getByLabel('Ouvir a gravação antes de enviar')).toBeVisible();
  314 |   await expectAccessible(page);
  315 |   await shot(page, '79-gravacao-pronta');
  316 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
> 317 |   await expect(thread.locator('audio').last()).toBeVisible();
      |                                                ^ Error: expect(locator).toBeVisible() failed
  318 |   const last = (await sent(page)).at(-1)!;
  319 |   expect((last.body.message as { attachment: { type: string } }).attachment.type).toBe('audio');
  320 |   await expectAccessible(page);
  321 | });
  322 | 
```