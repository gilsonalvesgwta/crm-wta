# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: meta.spec.ts >> WhatsApp oficial: cadastrar, avisos da Meta, modelo aprovado
- Location: e2e/meta.spec.ts:33:1

# Error details

```
Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: 'Novo modelo de mensagem' }).getByLabel('Texto') resolved to 5 elements:
    1) <button type="button" title="Negrito (*texto*)" aria-label="Negrito (*texto*)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Negrito (*texto*)' })
    2) <button type="button" title="Itálico (_texto_)" aria-label="Itálico (_texto_)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Itálico (_texto_)' })
    3) <button type="button" title="Tachado (~texto~)" aria-label="Tachado (~texto~)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Tachado (~texto~)' })
    4) <button type="button" title="Monoespaçado (```texto```)" aria-label="Monoespaçado (```texto```)" class="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">…</button> aka getByRole('button', { name: 'Monoespaçado (```texto```)' })
    5) <textarea rows="5" id="_r_f_" maxlength="1024" aria-describedby="_r_f_-dica" class="min-h-[88px] rounded-[6px] border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted border-line-strong"></textarea> aka getByRole('textbox', { name: 'Texto' })

Call log:
  - waiting for getByRole('dialog', { name: 'Novo modelo de mensagem' }).getByLabel('Texto')

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - alert [ref=e2]: CRM WTA
  - generic [ref=e3]:
    - navigation "Menu principal" [ref=e4]:
      - img "WTA" [ref=e6]
      - generic [ref=e7]:
        - paragraph [ref=e8]: Trabalho
        - link "Início" [ref=e9] [cursor=pointer]:
          - /url: /inicio
        - link "Conversas" [ref=e13] [cursor=pointer]:
          - /url: /conversas
        - link "Negócios" [ref=e17] [cursor=pointer]:
          - /url: /negocios
        - link "Pós-venda" [ref=e23] [cursor=pointer]:
          - /url: /pos-venda
        - link "Leads" [ref=e26] [cursor=pointer]:
          - /url: /leads
        - link "Contatos" [ref=e30] [cursor=pointer]:
          - /url: /contatos
        - link "Organizações" [ref=e36] [cursor=pointer]:
          - /url: /organizacoes
        - link "Automações" [ref=e40] [cursor=pointer]:
          - /url: /automacoes
        - link "Campanhas" [ref=e43] [cursor=pointer]:
          - /url: /campanhas
        - link "Instagram" [ref=e47] [cursor=pointer]:
          - /url: /instagram
        - link "WhatsApp" [ref=e52] [cursor=pointer]:
          - /url: /whatsapp
        - link "Agenda" [ref=e56] [cursor=pointer]:
          - /url: /agenda
      - generic [ref=e59]:
        - link "Plataforma" [ref=e60] [cursor=pointer]:
          - /url: /plataforma
        - link "Configurações" [ref=e65] [cursor=pointer]:
          - /url: /configuracoes
        - link "Minha conta" [ref=e69] [cursor=pointer]:
          - /url: /conta
        - paragraph [ref=e73]: versão dev
    - generic [ref=e74]:
      - banner [ref=e75]:
        - 'button "Avisos: 4 não lidos" [ref=e77]':
          - generic [aria-hidden] [ref=e81]: "4"
        - generic [ref=e82]: WTA Gestão e Automações
        - button "Menu de Gilson Alves" [ref=e84]: GA
      - main [ref=e85]:
        - generic [ref=e86]:
          - heading "Configurações" [level=1] [ref=e87]
          - navigation "Seções de configurações" [ref=e88]:
            - list [ref=e89]:
              - listitem [ref=e90]:
                - link "Empresa" [ref=e91] [cursor=pointer]:
                  - /url: /configuracoes/empresa
              - listitem [ref=e92]:
                - link "Identidade visual" [ref=e93] [cursor=pointer]:
                  - /url: /configuracoes/identidade-visual
              - listitem [ref=e94]:
                - link "Domínio próprio" [ref=e95] [cursor=pointer]:
                  - /url: /configuracoes/dominio
              - listitem [ref=e96]:
                - link "Canais" [ref=e97] [cursor=pointer]:
                  - /url: /configuracoes/canais
              - listitem [ref=e98]:
                - link "API e n8n" [ref=e99] [cursor=pointer]:
                  - /url: /configuracoes/integracoes
              - listitem [ref=e100]:
                - link "Usuários" [ref=e101] [cursor=pointer]:
                  - /url: /configuracoes/usuarios
              - listitem [ref=e102]:
                - link "Equipes" [ref=e103] [cursor=pointer]:
                  - /url: /configuracoes/equipes
              - listitem [ref=e104]:
                - link "Perfis e permissões" [ref=e105] [cursor=pointer]:
                  - /url: /configuracoes/perfis
              - listitem [ref=e106]:
                - link "Funis" [ref=e107] [cursor=pointer]:
                  - /url: /configuracoes/funis
              - listitem [ref=e108]:
                - link "Campos" [ref=e109] [cursor=pointer]:
                  - /url: /configuracoes/campos
              - listitem [ref=e110]:
                - link "Ganho e perda" [ref=e111] [cursor=pointer]:
                  - /url: /configuracoes/motivos
              - listitem [ref=e112]:
                - link "Produtos" [ref=e113] [cursor=pointer]:
                  - /url: /configuracoes/produtos
              - listitem [ref=e114]:
                - link "Etiquetas" [ref=e115] [cursor=pointer]:
                  - /url: /configuracoes/etiquetas
              - listitem [ref=e116]:
                - link "Distribuição de leads" [ref=e117] [cursor=pointer]:
                  - /url: /configuracoes/distribuicao
              - listitem [ref=e118]:
                - link "Auditoria" [ref=e119] [cursor=pointer]:
                  - /url: /configuracoes/auditoria
              - listitem [ref=e120]:
                - link "Cópias de segurança" [ref=e121] [cursor=pointer]:
                  - /url: /configuracoes/backup
          - generic [ref=e122]:
            - link "Canais" [ref=e123] [cursor=pointer]:
              - /url: /configuracoes/canais
            - generic [ref=e126]:
              - generic [ref=e127]:
                - generic [ref=e128]:
                  - heading "Modelos de mensagem do WhatsApp oficial" [level=2] [ref=e129]
                  - generic [ref=e130]: Para começar uma conversa (ou responder depois de 24 horas) e para campanhas, o WhatsApp oficial só aceita modelos aprovados pela Meta. A aprovação costuma levar de minutos a algumas horas.
                - generic [ref=e131]:
                  - button "Sincronizar com a Meta" [ref=e132]
                  - button "Novo modelo" [ref=e138]
              - paragraph [ref=e142]: Nenhum modelo ainda. Crie um ou sincronize os que já existem na Meta.
            - dialog [ref=e143]:
              - generic [ref=e144]:
                - generic [ref=e145]:
                  - generic [ref=e146]:
                    - heading "Novo modelo de mensagem" [level=2] [ref=e147]
                    - generic [ref=e148]: A Meta analisa cada modelo antes de liberar o uso.
                  - button "Fechar" [ref=e149]
                - generic [ref=e154]:
                  - generic [ref=e155]:
                    - generic [ref=e156]:
                      - generic [ref=e157]:
                        - generic [ref=e158]: Nome
                        - textbox "Nome" [active] [ref=e160]:
                          - /placeholder: promocao_outubro
                          - text: retorno_contato
                        - paragraph [ref=e161]: Minúsculas, números e _.
                      - generic [ref=e162]:
                        - generic [ref=e163]: Categoria
                        - combobox "Categoria" [ref=e164]:
                          - option "Marketing (ofertas, novidades)"
                          - option "Utilidade (pedidos, lembretes)" [selected]
                          - option "Autenticação (códigos)"
                      - generic [ref=e165]:
                        - generic [ref=e166]: Idioma
                        - combobox "Idioma" [ref=e167]:
                          - option "Português (Brasil)" [selected]
                          - option "Espanhol"
                          - option "Inglês (EUA)"
                    - group "Cabeçalho (opcional)" [ref=e168]:
                      - radiogroup "Tipo de cabeçalho" [ref=e170]:
                        - radio "Nenhum" [checked] [ref=e171]
                        - radio "Título" [ref=e175]
                        - radio "Imagem" [ref=e178]
                        - radio "Vídeo" [ref=e183]
                        - radio "Documento" [ref=e186]
                    - generic [ref=e190]:
                      - generic [ref=e191]: Texto
                      - toolbar "Formatação do WhatsApp" [ref=e192]:
                        - button "Negrito (*texto*)" [ref=e193]
                        - button "Itálico (_texto_)" [ref=e196]
                        - button "Tachado (~texto~)" [ref=e199]
                        - 'button "Monoespaçado (```texto```)" [ref=e203]'
                        - button "Lista com marcadores (- )" [ref=e207]
                        - button "Lista numerada (1. )" [ref=e209]
                        - button "Citação (> )" [ref=e213]
                        - button "Prévia" [ref=e217]
                      - textbox "Texto" [ref=e221]
                      - paragraph [ref=e222]: "Use {{1}}, {{2}}… onde entram os dados de cada pessoa (nome, pedido…). Não comece nem termine com variável."
                    - 'button "Inserir variável {{1}}" [ref=e224]'
                    - generic [ref=e226]:
                      - generic [ref=e227]: Rodapé (opcional)
                      - textbox "Rodapé (opcional)" [ref=e229]
                      - paragraph [ref=e230]: 0/60
                    - 'group "Botões (opcional): respostas rápidas, até 2 links e 1 telefone" [ref=e231]':
                      - button "Botão" [ref=e233]
                      - paragraph [ref=e235]: Deixe as respostas rápidas juntas (todas antes ou todas depois dos links e do telefone).
                    - generic [ref=e236]:
                      - button "Cancelar" [ref=e237]
                      - button "Enviar para aprovação" [disabled] [ref=e238]
                  - complementary "Prévia no celular" [ref=e239]:
                    - paragraph [ref=e240]: Como chega
                    - generic [ref=e241]:
                      - generic [ref=e242]: Sua empresa
                      - generic [ref=e247]:
                        - paragraph [ref=e248]: O texto do modelo aparece aqui.
                        - paragraph [ref=e249]: 10:30
```

# Test source

```ts
  1   | import { createHmac } from 'node:crypto';
  2   | import { test, expect, type Page } from '@playwright/test';
  3   | import { expectAccessible, loginAdmin, shot } from './util';
  4   | 
  5   | test.describe.configure({ mode: 'serial' });
  6   | 
  7   | const FAKE = process.env.FAKE_META_URL ?? 'http://127.0.0.1:8791';
  8   | const TOKEN = 'token-e2e';
  9   | const SECRET = 'segredo-do-app-e2e';
  10  | 
  11  | type Sent = { path: string; body: Record<string, unknown> };
  12  | async function sent(page: Page): Promise<Sent[]> {
  13  |   return ((await (await page.request.get(`${FAKE}/__fake/state`)).json()) as { sent: Sent[] }).sent;
  14  | }
  15  | 
  16  | async function openSettings(page: Page, tab: string) {
  17  |   await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Configurações' }).click();
  18  |   await page.getByRole('navigation', { name: 'Seções de configurações' }).getByRole('link', { name: tab }).click();
  19  | }
  20  | 
  21  | /** Aviso da Meta assinado, no endereço que a tela mostrou. */
  22  | async function hook(page: Page, url: string, body: unknown) {
  23  |   const raw = JSON.stringify(body);
  24  |   const r = await page.request.post(new URL(url).pathname, {
  25  |     data: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` },
  26  |   });
  27  |   expect(r.status()).toBe(200);
  28  | }
  29  | 
  30  | let cloudHook = '';
  31  | let igHook = '';
  32  | 
  33  | test('WhatsApp oficial: cadastrar, avisos da Meta, modelo aprovado', async ({ page }) => {
  34  |   await loginAdmin(page);
  35  |   await openSettings(page, 'Canais');
  36  |   // Passo a passo ao lado do canal, com as abas WhatsApp oficial e Instagram.
  37  |   await page.getByRole('button', { name: 'Passo a passo' }).first().click();
  38  |   const sheet = page.getByRole('complementary', { name: 'Passo a passo da conexão' });
  39  |   await expect(sheet.getByRole('heading', { name: 'Gerar o token permanente (usuário do sistema)' })).toBeVisible();
  40  |   await sheet.getByRole('checkbox', { name: 'Feito' }).first().check();
  41  |   await expectAccessible(page);
  42  |   await shot(page, '59-passo-a-passo-whatsapp');
  43  |   await sheet.getByRole('button', { name: 'Instagram' }).click();
  44  |   await expect(sheet.getByRole('heading', { name: 'Adicionar a conta do Instagram e gerar o token' })).toBeVisible();
  45  |   await sheet.getByRole('button', { name: 'Fechar o passo a passo' }).click();
  46  |   await page.getByRole('button', { name: 'Adicionar número oficial' }).click();
  47  |   const d = page.getByRole('dialog', { name: 'Adicionar número oficial do WhatsApp' });
  48  |   // O formulário abre com o passo a passo ao lado.
  49  |   await expect(d.getByRole('region', { name: 'Passo a passo' }).getByRole('heading', { name: 'Definir o PIN de 6 dígitos' })).toBeVisible();
  50  |   await shot(page, '60-formulario-com-passo-a-passo');
  51  |   await d.getByLabel('Nome da conta').fill('Oficial');
  52  |   await d.getByLabel('ID do número de telefone').fill('100000000777');
  53  |   await d.getByLabel('ID da conta do WhatsApp Business').fill('200000000777');
  54  |   await d.getByLabel('Token de acesso permanente').fill(TOKEN);
  55  |   await d.getByLabel('Chave secreta do app', { exact: true }).fill(SECRET);
  56  |   await d.getByLabel('PIN (6 dígitos)').fill('123456');
  57  |   await expectAccessible(page);
  58  |   await d.getByRole('button', { name: 'Salvar e conferir' }).click();
  59  |   await expect(page.getByText(/Conta salva e conferida na Meta, com o número registrado na API/)).toBeVisible();
  60  |   const row = page.getByRole('listitem').filter({ hasText: 'Oficial' }).filter({ hasText: 'Empresa Teste' });
  61  |   await expect(row).toContainText('Conectada');
  62  |   await row.getByText('Configurar os avisos na Meta').click();
  63  |   cloudHook = (await row.locator('code').first().textContent())!;
  64  |   expect(cloudHook).toMatch(/\/api\/v1\/webhooks\/meta\/[A-Za-z0-9_-]{43}$/);
  65  |   await expectAccessible(page);
  66  |   await shot(page, '54-whatsapp-oficial');
  67  | 
  68  |   await row.getByRole('link', { name: 'Modelos' }).click();
  69  |   await page.getByRole('button', { name: 'Novo modelo' }).click();
  70  |   const t = page.getByRole('dialog', { name: 'Novo modelo de mensagem' });
  71  |   await t.getByLabel('Nome', { exact: true }).fill('retorno_contato');
  72  |   await t.getByLabel('Categoria').selectOption('UTILITY');
> 73  |   await t.getByLabel('Texto').fill('Olá ');
      |                               ^ Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: 'Novo modelo de mensagem' }).getByLabel('Texto') resolved to 5 elements:
  74  |   await t.getByRole('button', { name: /Inserir variável/ }).click();
  75  |   await t.getByLabel('Texto').press('End');
  76  |   await t.getByLabel('Texto').pressSequentially(', podemos falar sobre o seu pedido?');
  77  |   await t.getByLabel('Exemplo de {{1}}').fill('Maria');
  78  |   await expect(t.getByText('Olá Maria, podemos falar sobre o seu pedido?')).toBeVisible();
  79  |   await expectAccessible(page);
  80  |   await shot(page, '55-modelo-novo');
  81  |   await t.getByRole('button', { name: 'Enviar para aprovação' }).click();
  82  |   await expect(page.getByText('Modelo enviado para a Meta aprovar.')).toBeVisible();
  83  |   const item = page.getByRole('listitem').filter({ hasText: 'retorno_contato' });
  84  |   await expect(item).toContainText('Em análise na Meta');
  85  |   await page.request.post(`${FAKE}/__fake/approve`);
  86  |   await page.getByRole('button', { name: 'Sincronizar com a Meta' }).click();
  87  |   await expect(item).toContainText('Aprovado');
  88  |   await expectAccessible(page);
  89  |   await shot(page, '56-modelos');
  90  | });
  91  | 
  92  | test('WhatsApp oficial nas Conversas: recebe, responde e usa modelo fora das 24 h', async ({ page }) => {
  93  |   await loginAdmin(page);
  94  |   await hook(page, cloudHook, { object: 'whatsapp_business_account', entry: [{ id: '200000000777', changes: [{ field: 'messages', value: {
  95  |     metadata: { phone_number_id: '100000000777' }, contacts: [{ profile: { name: 'Carla Oficial' }, wa_id: '5541988887777' }],
  96  |     messages: [{ from: '5541988887777', id: 'wamid.E2E1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Bom dia! Tenho uma dúvida.' } }] } }] }] });
  97  |   await page.goto('/conversas?st=all&ch=whatsapp');
  98  |   await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Carla Oficial/ }).click();
  99  |   await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Tenho uma dúvida');
  100 |   await page.getByLabel('Enviar por').selectOption({ label: 'WhatsApp oficial · Oficial · (11) 3333-4444' });
  101 |   await page.getByLabel('Mensagem', { exact: true }).fill('Bom dia, Carla! Pode falar.');
  102 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  103 |   await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Bom dia, Carla! Pode falar.');
  104 |   const last = (await sent(page)).at(-1)!;
  105 |   expect([last.path, last.body.type, last.body.to]).toEqual(['100000000777/messages', 'text', '5541988887777']);
  106 | 
  107 |   // Bruno nunca escreveu para o número oficial: só com modelo.
  108 |   await page.goto('/conversas?st=all&ch=whatsapp');
  109 |   await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Bruno Prospect/ }).first().click();
  110 |   await page.getByLabel('Enviar por').selectOption({ label: 'WhatsApp oficial · Oficial · (11) 3333-4444' });
  111 |   await page.getByLabel('Mensagem', { exact: true }).fill('Oi Bruno');
  112 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  113 |   await expect(page.getByText(/comece com um modelo aprovado/)).toBeVisible();
  114 |   await page.getByLabel('Modelo', { exact: true }).selectOption({ label: 'retorno_contato (pt_BR)' });
  115 |   await expect(page.getByLabel('Valor de {{1}}')).toHaveValue('Bruno');
  116 |   await expectAccessible(page);
  117 |   await shot(page, '57-conversa-modelo');
  118 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  119 |   await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Olá Bruno, podemos falar sobre o seu pedido?');
  120 |   const tpl = (await sent(page)).at(-1)!.body as { type: string; template: { name: string } };
  121 |   expect([tpl.type, tpl.template.name]).toEqual(['template', 'retorno_contato']);
  122 | });
  123 | 
  124 | test('Instagram: cadastrar, receber a mensagem direta e responder', async ({ page }) => {
  125 |   await loginAdmin(page);
  126 |   await openSettings(page, 'Canais');
  127 |   await page.getByRole('button', { name: 'Adicionar Instagram' }).click();
  128 |   const d = page.getByRole('dialog', { name: 'Adicionar Instagram' });
  129 |   await d.getByLabel('Nome da conta').fill('Insta da loja');
  130 |   await d.getByLabel('ID da conta do Instagram').fill('17841400000777');
  131 |   await d.getByLabel('Segunda chave secreta (opcional)').fill('outra-chave-e2e');
  132 |   await d.getByLabel('Token de acesso', { exact: true }).fill(TOKEN);
  133 |   await d.getByLabel('Chave secreta do app', { exact: true }).fill(SECRET);
  134 |   await d.getByRole('button', { name: 'Salvar e conferir' }).click();
  135 |   await expect(page.getByText(/Conta salva e conferida na Meta/)).toBeVisible();
  136 |   const row = page.getByRole('listitem').filter({ hasText: 'Insta da loja' });
  137 |   await expect(row).toContainText('@empresa.teste');
  138 |   await row.getByText('Configurar os avisos na Meta').click();
  139 |   igHook = (await row.locator('code').first().textContent())!;
  140 | 
  141 |   await hook(page, igHook, { object: 'instagram', entry: [{ id: '17841400000777', time: Date.now(), messaging: [
  142 |     { sender: { id: '955500011122' }, recipient: { id: '17841400000777' }, timestamp: Date.now(), message: { mid: 'mid.E2E1', text: 'Vocês entregam em Curitiba?' } }] }] });
  143 |   await page.goto('/conversas?st=all');
  144 |   await page.getByRole('group', { name: 'Canal' }).getByRole('button', { name: 'Instagram' }).click();
  145 |   await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Cliente Insta/ }).click();
  146 |   await expect(page.getByText('@cliente.insta').first()).toBeVisible();
  147 |   await page.getByLabel('Mensagem', { exact: true }).fill('Entregamos sim!');
  148 |   await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  149 |   await expect(page.getByRole('list', { name: 'Mensagens' })).toContainText('Entregamos sim!');
  150 |   const last = (await sent(page)).at(-1)!;
  151 |   expect([last.path, (last.body.recipient as { id: string }).id]).toEqual(['17841400000777/messages', '955500011122']);
  152 |   await expectAccessible(page);
  153 |   await shot(page, '58-instagram');
  154 | });
  155 | 
  156 | test('passo a passo em página própria, para abrir ao lado do site da Meta', async ({ page }) => {
  157 |   await loginAdmin(page);
  158 |   await page.goto('/configuracoes/canais/guia?canal=instagram');
  159 |   await expect(page.getByRole('heading', { name: 'Passo a passo: Instagram' })).toBeVisible();
  160 |   await expect(page.getByRole('heading', { name: 'Problemas comuns e como resolver' })).toBeVisible();
  161 |   await page.getByText('As mensagens não aparecem no CRM').click();
  162 |   await expect(page.getByText(/Permitir acesso às mensagens/).first()).toBeVisible();
  163 |   await page.getByRole('button', { name: 'WhatsApp oficial' }).click();
  164 |   await expect(page.getByRole('heading', { name: 'Passo a passo: WhatsApp oficial (API da Meta)' })).toBeVisible();
  165 |   await expectAccessible(page);
  166 |   await shot(page, '61-passo-a-passo-pagina');
  167 | });
  168 | 
  169 | test('Instagram: fluxo de comentário "eu quero" — criar, testar, publicar e rodar', async ({ page }) => {
  170 |   await loginAdmin(page);
  171 |   await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Instagram' }).click();
  172 |   await expect(page.getByRole('heading', { name: 'Instagram', level: 1 })).toBeVisible();
  173 |   await page.getByRole('button', { name: 'Novo fluxo' }).first().click();
```