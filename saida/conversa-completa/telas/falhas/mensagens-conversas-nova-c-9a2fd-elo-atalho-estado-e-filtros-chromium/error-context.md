# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mensagens.spec.ts >> conversas: nova conversa com quem nunca escreveu, resposta pronta pelo atalho, estado e filtros
- Location: e2e/mensagens.spec.ts:147:1

# Error details

```
Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: 'Nova resposta pronta' }).getByLabel('Texto') resolved to 5 elements:
    1) <button type="button" title="Negrito (*texto*)" aria-label="Negrito (*texto*)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Negrito (*texto*)' })
    2) <button type="button" title="Itálico (_texto_)" aria-label="Itálico (_texto_)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Itálico (_texto_)' })
    3) <button type="button" title="Tachado (~texto~)" aria-label="Tachado (~texto~)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Tachado (~texto~)' })
    4) <button type="button" title="Monoespaçado (```texto```)" aria-label="Monoespaçado (```texto```)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Monoespaçado (```texto```)' })
    5) <textarea rows="6" id="_r_5_" class="min-h-[88px] rounded-[6px] border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted border-line-strong"></textarea> aka getByRole('textbox', { name: 'Texto' })

Call log:
  - waiting for getByRole('dialog', { name: 'Nova resposta pronta' }).getByLabel('Texto')

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - alert [ref=f1e2]
  - generic [ref=f1e3]:
    - navigation "Menu principal" [ref=f1e4]:
      - img "WTA" [ref=f1e6]
      - generic [ref=f1e7]:
        - paragraph [ref=f1e8]: Trabalho
        - link "Início" [ref=f1e9] [cursor=pointer]:
          - /url: /inicio
        - link "Conversas" [ref=f1e13] [cursor=pointer]:
          - /url: /conversas
        - link "Negócios" [ref=f1e17] [cursor=pointer]:
          - /url: /negocios
        - link "Pós-venda" [ref=f1e23] [cursor=pointer]:
          - /url: /pos-venda
        - link "Leads" [ref=f1e26] [cursor=pointer]:
          - /url: /leads
        - link "Contatos" [ref=f1e30] [cursor=pointer]:
          - /url: /contatos
        - link "Organizações" [ref=f1e36] [cursor=pointer]:
          - /url: /organizacoes
        - link "Automações" [ref=f1e40] [cursor=pointer]:
          - /url: /automacoes
        - link "Campanhas" [ref=f1e43] [cursor=pointer]:
          - /url: /campanhas
        - link "Instagram" [ref=f1e47] [cursor=pointer]:
          - /url: /instagram
        - link "WhatsApp" [ref=f1e52] [cursor=pointer]:
          - /url: /whatsapp
        - link "Agenda" [ref=f1e56] [cursor=pointer]:
          - /url: /agenda
      - generic [ref=f1e59]:
        - link "Plataforma" [ref=f1e60] [cursor=pointer]:
          - /url: /plataforma
        - link "Configurações" [ref=f1e65] [cursor=pointer]:
          - /url: /configuracoes
        - link "Minha conta" [ref=f1e69] [cursor=pointer]:
          - /url: /conta
        - paragraph [ref=f1e73]: versão dev
    - generic [ref=f1e74]:
      - banner [ref=f1e75]:
        - 'button "Avisos: 4 não lidos" [ref=f1e77]':
          - generic [aria-hidden] [ref=f1e81]: "4"
        - generic [ref=f1e82]: WTA Gestão e Automações
        - button "Menu de Gilson Alves" [ref=f1e84]: GA
      - main [ref=f1e85]:
        - generic [ref=f1e86]:
          - generic [ref=f1e87]:
            - link "Conversas" [ref=f1e88] [cursor=pointer]:
              - /url: /conversas
            - generic [ref=f1e91]:
              - generic [ref=f1e92]:
                - heading "Respostas prontas" [level=1] [ref=f1e93]
                - generic [ref=f1e94]: "Mensagens prontas para usar nas conversas: digite / e o atalho na caixa de mensagem."
              - button "Nova resposta" [ref=f1e96]
          - group "Canal" [ref=f1e98]:
            - button "WhatsApp" [pressed] [ref=f1e99]
            - button "E-mail" [ref=f1e102]
            - button "Instagram" [ref=f1e106]
          - generic [ref=f1e110]:
            - generic [ref=f1e112]:
              - heading "Respostas de WhatsApp" [level=2] [ref=f1e113]
              - generic [ref=f1e114]: As da empresa aparecem para todos; as pessoais, só para quem criou.
            - paragraph [ref=f1e116]: Nenhuma resposta pronta de WhatsApp ainda.
          - dialog [ref=f1e117]:
            - generic [ref=f1e118]:
              - generic [ref=f1e119]:
                - heading "Nova resposta pronta" [level=2] [ref=f1e121]
                - button "Fechar" [ref=f1e122]
              - generic [ref=f1e127]:
                - group "Canal" [ref=f1e128]:
                  - generic [ref=f1e130]:
                    - radio "WhatsApp" [checked] [ref=f1e131]
                    - text: WhatsApp
                  - generic [ref=f1e132]:
                    - radio "E-mail" [ref=f1e133]
                    - text: E-mail
                  - generic [ref=f1e134]:
                    - radio "Instagram" [ref=f1e135]
                    - text: Instagram
                - generic [ref=f1e136]:
                  - generic [ref=f1e137]:
                    - generic [ref=f1e138]: Atalho
                    - textbox "Atalho" [ref=f1e140]: boasvindas
                    - paragraph [ref=f1e141]: "Ex.: boasvindas"
                  - generic [ref=f1e142]:
                    - generic [ref=f1e143]: Título
                    - textbox "Título" [active] [ref=f1e145]: Boas-vindas
                - generic [ref=f1e146]:
                  - generic [ref=f1e147]: Texto
                  - toolbar "Formatação do WhatsApp" [ref=f1e148]:
                    - button "Negrito (*texto*)" [ref=f1e149]
                    - button "Itálico (_texto_)" [ref=f1e152]
                    - button "Tachado (~texto~)" [ref=f1e155]
                    - 'button "Monoespaçado (```texto```)" [ref=f1e159]'
                    - button "Lista com marcadores (- )" [ref=f1e163]
                    - button "Lista numerada (1. )" [ref=f1e165]
                    - button "Citação (> )" [ref=f1e169]
                    - button "Prévia" [ref=f1e173]
                  - textbox "Texto" [ref=f1e177]
                - paragraph [ref=f1e178]:
                  - text: "Variáveis:"
                  - code [ref=f1e179]: "{{nome}}"
                  - code [ref=f1e180]: "{{primeiro_nome}}"
                  - code [ref=f1e181]: "{{empresa}}"
                  - code [ref=f1e182]: "{{atendente}}"
                - generic [ref=f1e183]:
                  - checkbox "Disponível para toda a empresa" [checked] [ref=f1e184]
                  - text: Disponível para toda a empresa
                - generic [ref=f1e185]:
                  - button "Cancelar" [ref=f1e186]
                  - button "Salvar" [disabled] [ref=f1e187]
```

# Test source

```ts
  56  |   await expect(conv).toContainText('Oi! Vocês fazem entrega?');
  57  |   await expect(conv).toContainText('1 não lidas');
  58  |   await conv.click();
  59  |   const thread = page.getByRole('list', { name: 'Mensagens' });
  60  |   await expect(thread).toContainText('Oi! Vocês fazem entrega?');
  61  |   await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: /Conversas/ })).not.toContainText('não lidas');
  62  |   await page.getByLabel('Mensagem', { exact: true }).fill('Olá, Maria! Fazemos sim.');
  63  |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  64  |   await expect(thread).toContainText('Olá, Maria! Fazemos sim.');
  65  |   await expect(thread.getByText('Enviada')).toBeAttached();
  66  |   const sent = (await fake(page)).sent.at(-1)!;
  67  |   expect([sent.type, sent.body.number, sent.body.text]).toEqual(['text', '5521977776666', 'Olá, Maria! Fazemos sim.']);
  68  |   await expectAccessible(page);
  69  |   await shot(page, '42-conversas');
  70  | 
  71  |   // Áudio de voz: o aviso vem sem o arquivo; um chega e já toca, o outro é buscado no WhatsApp quando pedido.
  72  |   const OPUS = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(22), Buffer.from([1, 19]), Buffer.from('OpusHead'), Buffer.from([1, 1]), Buffer.alloc(73, 1)]).toString('base64');
  73  |   const voice = (id: string) => page.request.post(hook, {
  74  |     data: { event: 'messages.upsert', instance: inst.name,
  75  |       data: { key: { remoteJid: '5521977776666@s.whatsapp.net', fromMe: false, id }, pushName: 'Maria Cliente', message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }, messageType: 'audioMessage' } },
  76  |   });
  77  |   await page.request.post(`${FAKE}/__fake/state`, { data: { media: { 'E2E-PTT-1': { base64: OPUS, mimetype: 'audio/ogg; codecs=opus' } } } });
  78  |   expect((await voice('E2E-PTT-1')).status()).toBe(200);
  79  |   expect((await voice('E2E-PTT-2')).status()).toBe(200);
  80  |   await expect(async () => {
  81  |     await page.reload();
  82  |     await page.getByRole('button', { name: /Maria Cliente/ }).click();
  83  |     await expect(thread.locator('audio')).toHaveCount(1, { timeout: 2000 });
  84  |   }).toPass({ timeout: 15_000 });
  85  |   await page.request.post(`${FAKE}/__fake/state`, { data: { media: { 'E2E-PTT-2': { base64: OPUS, mimetype: 'audio/ogg; codecs=opus' } } } });
  86  |   await thread.getByRole('button', { name: 'Ouvir áudio' }).click();
  87  |   await expect(thread.locator('audio')).toHaveCount(2);
  88  | 
  89  |   // Áudio de voz real (12 s): toca até o fim, mesmo com a conversa se atualizando sozinha no meio.
  90  |   const voz = readFileSync(new URL('./fixtures/voz.ogg', import.meta.url)).toString('base64');
  91  |   expect((await page.request.post(hook, {
  92  |     data: { event: 'messages.upsert', instance: inst.name,
  93  |       data: { key: { remoteJid: '5521977776666@s.whatsapp.net', fromMe: false, id: 'E2E-PTT-REAL' }, pushName: 'Maria Cliente', messageType: 'audioMessage',
  94  |         message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 12 }, base64: voz } } },
  95  |   })).status()).toBe(200);
  96  |   await expect(thread.locator('audio')).toHaveCount(3, { timeout: 15_000 });
  97  |   const player = thread.locator('audio').last();
  98  |   await expect.poll(() => player.evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 10_000 }).toBeGreaterThan(0);
  99  |   await player.evaluate((a: HTMLAudioElement) => { a.muted = true; void a.play(); });
  100 |   await expect.poll(() => player.evaluate((a: HTMLAudioElement) => a.ended), { timeout: 25_000, intervals: [1000] }).toBe(true);
  101 |   const played = await player.evaluate((a: HTMLAudioElement) => ({ t: a.currentTime, d: a.duration }));
  102 |   expect(played.t).toBeGreaterThan(11);
  103 |   expect(Math.round(played.d)).toBe(12);
  104 |   await expectAccessible(page);
  105 | });
  106 | 
  107 | test('e-mail da empresa: cadastrar, testar e enviar pelo contato', async ({ page }) => {
  108 |   await loginAdmin(page);
  109 |   await openSettings(page, 'Canais');
  110 |   await page.getByRole('button', { name: 'Adicionar e-mail' }).click();
  111 |   const d = page.getByRole('dialog', { name: 'Adicionar e-mail' });
  112 |   await d.getByLabel('Nome da conta').fill('Vendas');
  113 |   await d.getByLabel('E-mail', { exact: true }).fill('vendas@aurora.test');
  114 |   await d.getByLabel('Nome do remetente').fill('Aurora');
  115 |   await d.getByLabel('Servidor SMTP').fill('127.0.0.1');
  116 |   await d.getByLabel('Porta').selectOption('2525');
  117 |   await d.getByLabel('Senha', { exact: true }).fill('senha-da-caixa');
  118 |   await expectAccessible(page);
  119 |   await shot(page, '43-canais-email');
  120 |   await d.getByRole('button', { name: 'Salvar e testar' }).click();
  121 |   await expect(page.getByText(/Caixa salva e testada/)).toBeVisible();
  122 |   await expect(page.getByRole('listitem').filter({ hasText: 'vendas@aurora.test' })).toContainText('Conectada');
  123 | 
  124 |   // Contato com e-mail recebe pelo painel de mensagens.
  125 |   await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Conversas' }).click();
  126 |   await page.getByRole('button', { name: /Maria Cliente/ }).click();
  127 |   await page.getByRole('link', { name: 'Maria Cliente' }).click();
  128 |   await page.getByRole('button', { name: 'Editar' }).click();
  129 |   const edit = page.getByRole('dialog');
  130 |   await edit.getByRole('button', { name: 'Adicionar e-mail' }).click();
  131 |   await edit.getByLabel('E-mail 1', { exact: true }).fill('maria@cliente.test');
  132 |   await edit.getByRole('button', { name: 'Salvar' }).click();
  133 |   await expect(page.getByText('maria@cliente.test')).toBeVisible();
  134 | 
  135 |   await page.getByLabel('Enviar por').selectOption({ label: 'E-mail · Vendas · vendas@aurora.test' });
  136 |   await page.getByLabel('Assunto').fill('Catálogo de produtos');
  137 |   await page.getByLabel('Mensagem', { exact: true }).fill('Olá, Maria. Segue o catálogo.');
  138 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  139 |   const thread = page.getByRole('list', { name: 'Mensagens' });
  140 |   await expect(thread).toContainText('Catálogo de produtos');
  141 |   await expect(thread).toContainText('Oi! Vocês fazem entrega?');
  142 |   await expect(page.getByText('Mensagem enviada (E-mail)')).toBeVisible();
  143 |   await expectAccessible(page);
  144 |   await shot(page, '44-contato-mensagens');
  145 | });
  146 | 
  147 | test('conversas: nova conversa com quem nunca escreveu, resposta pronta pelo atalho, estado e filtros', async ({ page }) => {
  148 |   await loginAdmin(page);
  149 |   // Banco de respostas: uma de WhatsApp para a empresa toda.
  150 |   await page.goto('/conversas');
  151 |   await page.getByRole('link', { name: 'Respostas prontas' }).click();
  152 |   await page.getByRole('button', { name: 'Nova resposta' }).click();
  153 |   const d = page.getByRole('dialog', { name: 'Nova resposta pronta' });
  154 |   await d.getByLabel('Atalho').fill('boasvindas');
  155 |   await d.getByLabel('Título').fill('Boas-vindas');
> 156 |   await d.getByLabel('Texto').fill('Olá, {{primeiro_nome}}! Aqui é {{atendente}}. Como posso ajudar?');
      |                               ^ Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: 'Nova resposta pronta' }).getByLabel('Texto') resolved to 5 elements:
  157 |   await expectAccessible(page);
  158 |   await d.getByRole('button', { name: 'Salvar' }).click();
  159 |   await expect(page.getByText('Resposta criada.')).toBeVisible();
  160 |   await expect(page.getByRole('listitem').filter({ hasText: '/boasvindas' })).toContainText('Da empresa');
  161 |   await shot(page, '45-respostas-prontas');
  162 | 
  163 |   // Nova conversa com um contato que ainda não existe.
  164 |   await page.getByRole('link', { name: 'Conversas' }).first().click();
  165 |   await page.getByRole('button', { name: 'Nova conversa' }).click();
  166 |   const n = page.getByRole('dialog', { name: 'Nova conversa' });
  167 |   await n.getByRole('button', { name: 'Contato novo' }).click();
  168 |   await n.getByLabel('Nome').fill('Bruno Prospect');
  169 |   await n.getByLabel('WhatsApp (com DDD)').fill('(31) 98888-7766');
  170 |   await expectAccessible(page);
  171 |   await n.getByRole('button', { name: 'Abrir conversa' }).click();
  172 |   await expect(page.getByText('Nenhuma mensagem ainda. Escreva abaixo para começar a conversa por WhatsApp.')).toBeVisible();
  173 | 
  174 |   // "/" abre as respostas prontas; Enter escolhe e preenche com as variáveis.
  175 |   const box = page.getByLabel('Mensagem', { exact: true });
  176 |   await box.fill('/boas');
  177 |   await expect(page.getByRole('list', { name: 'Respostas prontas' })).toContainText('/boasvindas');
  178 |   await box.press('Enter');
  179 |   await expect(box).toHaveValue(/^Olá, Bruno! Aqui é .+\. Como posso ajudar\?$/);
  180 |   await expectAccessible(page);
  181 |   await shot(page, '46-conversa-nova-resposta-pronta');
  182 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  183 |   const thread = page.getByRole('list', { name: 'Mensagens' });
  184 |   await expect(thread).toContainText('Olá, Bruno!');
  185 |   const sent = (await fake(page)).sent.at(-1)!;
  186 |   expect(sent.body.number).toBe('5531988887766');
  187 | 
  188 |   // Estado: aguardando o cliente; a lista separa por estado e canal.
  189 |   await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('waiting');
  190 |   await expect(page.getByRole('main').getByText('Aguardando cliente').first()).toBeVisible();
  191 |   const list = page.getByRole('region', { name: 'Lista de conversas' });
  192 |   await page.getByRole('button', { name: /^Aguardando/ }).click();
  193 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toBeVisible();
  194 |   await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'E-mail' }).click();
  195 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toHaveCount(0);
  196 |   await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'Todos' }).click();
  197 |   await page.getByRole('button', { name: 'Filtros' }).click();
  198 |   await page.getByLabel('Responsável', { exact: true }).first().selectOption('me');
  199 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toBeVisible();
  200 |   await page.getByLabel('Negócio').selectOption('open');
  201 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toHaveCount(0);
  202 |   await expectAccessible(page);
  203 |   await shot(page, '47-conversas-filtros');
  204 | 
  205 |   // Ocultar a conversa (spam, contato pessoal): some da lista e fica em "Ocultas"; dá para mostrar de novo.
  206 |   await page.getByRole('button', { name: 'Limpar filtros' }).click();
  207 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toBeVisible();
  208 |   await page.getByRole('button', { name: 'Ocultar', exact: true }).click();
  209 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toHaveCount(0);
  210 |   await page.getByRole('button', { name: /^Ocultas/ }).click();
  211 |   await list.getByRole('button', { name: /Bruno Prospect/ }).click();
  212 |   await expect(page.getByText('Conversa oculta: não aparece na lista principal.')).toBeVisible();
  213 |   await expect(page.getByLabel('Número / conexão')).toBeVisible();
  214 |   await expectAccessible(page);
  215 |   await shot(page, '47b-conversas-ocultas');
  216 |   await page.getByRole('button', { name: 'Mostrar de novo' }).click();
  217 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toHaveCount(0);
  218 |   await page.getByRole('button', { name: /^Ocultas/ }).click();
  219 |   await expect(list.getByRole('button', { name: /Bruno Prospect/ })).toBeVisible();
  220 | });
  221 | 
  222 | test('campanha de WhatsApp: cinco passos, público, envio no ritmo e relatório', async ({ page }) => {
  223 |   test.setTimeout(120_000);
  224 |   await loginAdmin(page);
  225 |   await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Campanhas' }).click();
  226 |   await page.getByRole('link', { name: 'Nova campanha' }).click();
  227 |   await expect(page.getByText('1. Geral')).toBeVisible();
  228 |   await expect(page.getByText('0%')).toBeVisible();
  229 |   // Sem nome e tipo não segue.
  230 |   await page.getByRole('button', { name: 'Continuar' }).click();
  231 |   await expect(page.getByText('Informe o nome da campanha.')).toBeVisible();
  232 |   await page.getByLabel('Nome *').fill('Oferta de outubro');
  233 |   await page.getByLabel('Descrição').fill('Clientes que já conversaram pelo WhatsApp');
  234 |   await page.getByLabel('Tipo de Campanha *').selectOption('whatsapp');
  235 |   await expectAccessible(page);
  236 |   await shot(page, '48-campanha-geral');
  237 |   await page.getByRole('button', { name: 'Continuar' }).click();
  238 | 
  239 |   await expect(page.getByText('2. Audiência')).toBeVisible();
  240 |   await expect(page.getByText(/contato\(s\) vão receber/)).toBeVisible();
  241 |   await expect(page.getByText('Por exemplo:')).toContainText('Bruno');
  242 |   await expectAccessible(page);
  243 |   await shot(page, '49-campanha-audiencia');
  244 |   await page.getByRole('button', { name: 'Continuar' }).click();
  245 | 
  246 |   await expect(page.getByText('3. Conteúdo')).toBeVisible();
  247 |   await page.getByLabel('Mensagem *').fill('Oi {{primeiro_nome}}! Temos novidades.');
  248 |   await expect(page.getByText('Oi Maria! Temos novidades.')).toBeVisible();
  249 |   await expectAccessible(page);
  250 |   await page.getByRole('button', { name: 'Continuar' }).click();
  251 | 
  252 |   await expect(page.getByText('4. Configurações')).toBeVisible();
  253 |   await page.getByLabel('Ritmo de envio').selectOption('120');
  254 |   await page.getByRole('button', { name: 'Continuar' }).click();
  255 | 
  256 |   await expect(page.getByText('5. Revisão')).toBeVisible();
```