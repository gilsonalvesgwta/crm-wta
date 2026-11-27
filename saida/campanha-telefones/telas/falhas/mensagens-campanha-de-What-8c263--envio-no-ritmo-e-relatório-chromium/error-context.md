# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mensagens.spec.ts >> campanha de WhatsApp: cinco passos, público, envio no ritmo e relatório
- Location: e2e/mensagens.spec.ts:222:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "color-contrast: fieldset:nth-child(1) > .self-start.text-primary.hover\\:bg-accent-soft, .border-bad\\/30 > .self-start.text-primary.hover\\:bg-accent-soft",
+ ]
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
        - link "Conversas" [ref=e13] [cursor=pointer]:
          - /url: /conversas
        - link "Negócios" [ref=e17] [cursor=pointer]:
          - /url: /negocios
        - link "Leads" [ref=e23] [cursor=pointer]:
          - /url: /leads
        - link "Contatos" [ref=e27] [cursor=pointer]:
          - /url: /contatos
        - link "Organizações" [ref=e33] [cursor=pointer]:
          - /url: /organizacoes
        - link "Automações" [ref=e37] [cursor=pointer]:
          - /url: /automacoes
        - link "Campanhas" [ref=e40] [cursor=pointer]:
          - /url: /campanhas
        - link "Instagram" [ref=e44] [cursor=pointer]:
          - /url: /instagram
        - link "WhatsApp" [ref=e49] [cursor=pointer]:
          - /url: /whatsapp
        - link "Agenda" [ref=e53] [cursor=pointer]:
          - /url: /agenda
      - generic [ref=e56]:
        - link "Plataforma" [ref=e57] [cursor=pointer]:
          - /url: /plataforma
        - link "Configurações" [ref=e62] [cursor=pointer]:
          - /url: /configuracoes
        - link "Minha conta" [ref=e66] [cursor=pointer]:
          - /url: /conta
        - paragraph [ref=e70]: versão dev
    - generic [ref=e71]:
      - banner [ref=e72]:
        - 'button "Avisos: 4 não lidos" [ref=e74]':
          - generic [aria-hidden] [ref=e78]: "4"
        - generic [ref=e79]: WTA Gestão e Automações
        - button "Menu de Gilson Alves" [ref=e81]: GA
      - main [ref=e82]:
        - generic [ref=e83]:
          - generic [ref=e84]:
            - link "Campanhas" [ref=e85] [cursor=pointer]:
              - /url: /campanhas
            - generic [ref=e89]:
              - heading "Nova Campanha" [level=1] [ref=e90]
              - generic [ref=e91]: Criar uma nova campanha de mensagens em massa
          - generic [ref=e92]:
            - region "Passos da campanha" [ref=e93]:
              - list [ref=e94]:
                - listitem [ref=e96]:
                  - 'button "Passo 1: Geral (feito)" [ref=e97]'
                  - generic [ref=e100]: Geral
                - listitem [ref=e101]:
                  - 'button "Passo 2: Audiência" [ref=e102]': "2"
                  - generic [ref=e103]: Audiência
                - listitem [ref=e104]:
                  - 'button "Passo 3: Conteúdo" [disabled] [ref=e105]': "3"
                  - generic [ref=e106]: Conteúdo
                - listitem [ref=e107]:
                  - 'button "Passo 4: Configurações" [disabled] [ref=e108]': "4"
                  - generic [ref=e109]: Configurações
                - listitem [ref=e110]:
                  - 'button "Passo 5: Revisão" [disabled] [ref=e111]': "5"
                  - generic [ref=e112]: Revisão
              - generic [ref=e113]:
                - generic [ref=e114]:
                  - paragraph [ref=e115]: Visualizando passo
                  - paragraph [ref=e116]: 2. Audiência
                - generic [ref=e117]:
                  - paragraph [ref=e118]: 20%
                  - paragraph [ref=e119]: Completo
            - region "Audiência" [ref=e120]:
              - paragraph [ref=e121]: "Quem recebe: os contatos que atendem a todos os filtros abaixo. Sem filtro, todos os contatos com telefone."
              - generic [ref=e122]:
                - generic [ref=e124]:
                  - generic [ref=e125]: Com alguma destas etiquetas
                  - generic "Com alguma destas etiquetas" [ref=e126]:
                    - button "Etiqueta" [ref=e127]
                - generic [ref=e129]:
                  - generic [ref=e130]: Sem estas etiquetas
                  - generic "Sem estas etiquetas" [ref=e131]:
                    - button "Etiqueta" [ref=e132]
                - generic [ref=e134]:
                  - generic [ref=e135]: Responsável
                  - combobox "Responsável" [ref=e136]:
                    - option "Qualquer um" [selected]
                    - option "Gilson Alves"
                    - option "Rita Campos"
                - generic [ref=e137]:
                  - generic [ref=e138]: Equipe
                  - combobox "Equipe" [ref=e139]:
                    - option "Qualquer uma" [selected]
                    - option "Comercial"
                - generic [ref=e140]:
                  - group "Incluir quem tem negócio em" [ref=e141]:
                    - paragraph [ref=e143]: Marque uma ou mais etapas (nenhuma marcada = o funil todo). Com mais de um funil, vale estar em qualquer um deles.
                    - button "Escolher funil e etapas" [ref=e144]
                  - group "Excluir quem tem negócio em" [ref=e146]:
                    - paragraph [ref=e148]: "Tira do público quem está nestes funis/etapas. Ex.: todo o funil X menos a etapa Y; ou etiqueta Z menos quem está na etapa Q."
                    - button "Excluir quem está num funil/etapa" [ref=e149]
                - generic [ref=e151]:
                  - generic [ref=e152]: Origem (separe por vírgula)
                  - textbox "Origem (separe por vírgula)" [ref=e154]:
                    - /placeholder: google, instagram, indicação
                - generic [ref=e155]:
                  - generic [ref=e156]:
                    - generic [ref=e157]: Cadastrados de
                    - textbox "Cadastrados de" [ref=e159]
                  - generic [ref=e160]:
                    - generic [ref=e161]: até
                    - textbox "até" [ref=e163]
              - generic [ref=e164]:
                - checkbox "Só quem deu consentimento para receber marketing por WhatsApp" [ref=e165]
                - text: Só quem deu consentimento para receber marketing por WhatsApp
              - generic [ref=e167]:
                - paragraph [ref=e168]:
                  - strong [ref=e169]: "10"
                  - text: contato(s) vão receber
                - paragraph [ref=e170]: "Por exemplo: Ana Souza, Bruno Prospect, Carla Dias, Drive Felipe, Drive Iury…"
                - list [ref=e171]:
                  - listitem [ref=e172]: 4 sem telefone
                - paragraph [ref=e173]: "Vale qualquer telefone do contato (celular, WhatsApp, trabalho, casa ou fixo): o tipo escolhido no cadastro não importa. Número que não tem WhatsApp aparece como falha no relatório da campanha."
                - group [ref=e174]:
                  - generic "Ver quem está sem telefone" [ref=e175] [cursor=pointer]
            - generic [ref=e176]:
              - button "Voltar" [ref=e177]
              - button "Continuar" [ref=e180]
```

# Test source

```ts
  1  | import { createHash, createHmac } from 'node:crypto';
  2  | import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
  3  | import path from 'node:path';
  4  | import { execFileSync } from 'node:child_process';
  5  | import AxeBuilder from '@axe-core/playwright';
  6  | import { expect, type Page } from '@playwright/test';
  7  | 
  8  | export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'dono@wta.test';
  9  | export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'senha inicial forte 2026';
  10 | const MAIL_DIR = process.env.MAIL_DIR ?? '/tmp/crm-mail';
  11 | const SHOTS = process.env.E2E_SHOTS ?? 'e2e-shots';
  12 | 
  13 | /** Último e-mail enviado para o endereço, lido da pasta do MAIL_MODE=file. */
  14 | export function lastMailTo(to: string): { subject: string; text: string } {
  15 |   const files = readdirSync(MAIL_DIR).sort();
  16 |   for (const f of files.reverse()) {
  17 |     const m = JSON.parse(readFileSync(path.join(MAIL_DIR, f), 'utf8')) as { to: string; subject: string; text: string };
  18 |     if (m.to === to) return m;
  19 |   }
  20 |   throw new Error(`nenhum e-mail para ${to}`);
  21 | }
  22 | 
  23 | export function linkFrom(text: string): string {
  24 |   const m = /(https?:\/\/\S+)/.exec(text);
  25 |   if (!m) throw new Error('e-mail sem link');
  26 |   const u = new URL(m[1]!);
  27 |   return u.pathname + u.search;
  28 | }
  29 | 
  30 | /** Executa SQL no banco do CRM como superusuário (só preparo de dados de teste). */
  31 | export function sql(statement: string): string {
  32 |   return execFileSync('psql', [process.env.E2E_ADMIN_DATABASE_URL!, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' });
  33 | }
  34 | 
  35 | export function sha256Hex(s: string): string {
  36 |   return createHash('sha256').update(s).digest('hex');
  37 | }
  38 | 
  39 | const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  40 | export function totp(base32: string, at = Date.now()): string {
  41 |   let bits = 0, value = 0;
  42 |   const bytes: number[] = [];
  43 |   for (const ch of base32.replace(/\s/g, '').toUpperCase()) {
  44 |     value = (value << 5) | B32.indexOf(ch);
  45 |     bits += 5;
  46 |     if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  47 |   }
  48 |   const counter = Buffer.alloc(8);
  49 |   counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  50 |   const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  51 |   const o = mac[mac.length - 1]! & 15;
  52 |   const bin = ((mac[o]! & 127) << 24) | (mac[o + 1]! << 16) | (mac[o + 2]! << 8) | mac[o + 3]!;
  53 |   return (bin % 1_000_000).toString().padStart(6, '0');
  54 | }
  55 | 
  56 | export async function shot(page: Page, name: string): Promise<void> {
  57 |   mkdirSync(SHOTS, { recursive: true });
  58 |   await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  59 | }
  60 | 
  61 | /** Sem violações de acessibilidade graves ou críticas (axe, WCAG 2.2 AA). */
  62 | export async function expectAccessible(page: Page): Promise<void> {
  63 |   // Painéis que ainda carregam mudam a página no meio da análise.
  64 |   await page.waitForLoadState('networkidle').catch(() => undefined);
  65 |   const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  66 |   const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
> 67 |   expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
     |                                                                                               ^ Error: expect(received).toEqual(expected) // deep equality
  68 | }
  69 | 
  70 | export async function login(page: Page, email: string, password: string): Promise<void> {
  71 |   await page.goto('/entrar');
  72 |   await page.getByLabel('E-mail').fill(email);
  73 |   await page.getByLabel('Senha', { exact: true }).fill(password);
  74 |   await page.getByRole('button', { name: 'Entrar' }).click();
  75 | }
  76 | 
  77 | /** Avisos da página (o anunciador de rotas do Next também usa role="alert"). */
  78 | export function alertBox(page: Page) {
  79 |   return page.locator('[role="alert"]:not(#__next-route-announcer__)');
  80 | }
  81 | 
  82 | const SECRET_FILE = path.join(process.env.MAIL_DIR ?? '/tmp/crm-mail', '..', 'e2e-admin-totp.txt');
  83 | export function saveAdminSecret(secret: string): void {
  84 |   writeFileSync(SECRET_FILE, secret);
  85 | }
  86 | 
  87 | /** Entra como o administrador, que já tem a verificação em duas etapas ativa. */
  88 | export async function loginAdmin(page: Page): Promise<void> {
  89 |   const secret = readFileSync(SECRET_FILE, 'utf8').trim();
  90 |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  91 |   await expect(page).toHaveURL(/\/entrar\/verificacao/);
  92 |   await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  93 |   await page.getByRole('button', { name: 'Confirmar' }).click();
  94 |   await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  95 | }
  96 | 
```