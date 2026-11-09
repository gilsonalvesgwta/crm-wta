# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: meta.spec.ts >> WhatsApp oficial: cadastrar, avisos da Meta, modelo aprovado
- Location: e2e/meta.spec.ts:33:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "color-contrast: .text-right",
+ ]
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
        - link "Agenda" [ref=e49] [cursor=pointer]:
          - /url: /agenda
      - generic [ref=e52]:
        - link "Plataforma" [ref=e53] [cursor=pointer]:
          - /url: /plataforma
        - link "Configurações" [ref=e58] [cursor=pointer]:
          - /url: /configuracoes
        - link "Minha conta" [ref=e62] [cursor=pointer]:
          - /url: /conta
        - paragraph [ref=e66]: versão dev
    - generic [ref=e67]:
      - banner [ref=e68]:
        - 'button "Avisos: 2 não lidos" [ref=e70]':
          - generic [aria-hidden] [ref=e74]: "2"
        - generic [ref=e75]: WTA Gestão e Automações
        - button "Menu de Gilson Alves" [ref=e77]: GA
      - main [ref=e78]:
        - generic [ref=e79]:
          - heading "Configurações" [level=1] [ref=e80]
          - navigation "Seções de configurações" [ref=e81]:
            - list [ref=e82]:
              - listitem [ref=e83]:
                - link "Empresa" [ref=e84] [cursor=pointer]:
                  - /url: /configuracoes/empresa
              - listitem [ref=e85]:
                - link "Identidade visual" [ref=e86] [cursor=pointer]:
                  - /url: /configuracoes/identidade-visual
              - listitem [ref=e87]:
                - link "Domínio próprio" [ref=e88] [cursor=pointer]:
                  - /url: /configuracoes/dominio
              - listitem [ref=e89]:
                - link "Canais" [ref=e90] [cursor=pointer]:
                  - /url: /configuracoes/canais
              - listitem [ref=e91]:
                - link "API e n8n" [ref=e92] [cursor=pointer]:
                  - /url: /configuracoes/integracoes
              - listitem [ref=e93]:
                - link "Usuários" [ref=e94] [cursor=pointer]:
                  - /url: /configuracoes/usuarios
              - listitem [ref=e95]:
                - link "Equipes" [ref=e96] [cursor=pointer]:
                  - /url: /configuracoes/equipes
              - listitem [ref=e97]:
                - link "Perfis e permissões" [ref=e98] [cursor=pointer]:
                  - /url: /configuracoes/perfis
              - listitem [ref=e99]:
                - link "Funis" [ref=e100] [cursor=pointer]:
                  - /url: /configuracoes/funis
              - listitem [ref=e101]:
                - link "Campos" [ref=e102] [cursor=pointer]:
                  - /url: /configuracoes/campos
              - listitem [ref=e103]:
                - link "Ganho e perda" [ref=e104] [cursor=pointer]:
                  - /url: /configuracoes/motivos
              - listitem [ref=e105]:
                - link "Produtos" [ref=e106] [cursor=pointer]:
                  - /url: /configuracoes/produtos
              - listitem [ref=e107]:
                - link "Etiquetas" [ref=e108] [cursor=pointer]:
                  - /url: /configuracoes/etiquetas
              - listitem [ref=e109]:
                - link "Distribuição de leads" [ref=e110] [cursor=pointer]:
                  - /url: /configuracoes/distribuicao
              - listitem [ref=e111]:
                - link "Auditoria" [ref=e112] [cursor=pointer]:
                  - /url: /configuracoes/auditoria
              - listitem [ref=e113]:
                - link "Cópias de segurança" [ref=e114] [cursor=pointer]:
                  - /url: /configuracoes/backup
          - generic [ref=e115]:
            - link "Canais" [ref=e116] [cursor=pointer]:
              - /url: /configuracoes/canais
            - generic [ref=e119]:
              - generic [ref=e120]:
                - generic [ref=e121]:
                  - heading "Modelos de mensagem do WhatsApp oficial" [level=2] [ref=e122]
                  - generic [ref=e123]: Para começar uma conversa (ou responder depois de 24 horas) e para campanhas, o WhatsApp oficial só aceita modelos aprovados pela Meta. A aprovação costuma levar de minutos a algumas horas.
                - generic [ref=e124]:
                  - button "Sincronizar com a Meta" [ref=e125]
                  - button "Novo modelo" [ref=e131]
              - paragraph [ref=e135]: Nenhum modelo ainda. Crie um ou sincronize os que já existem na Meta.
            - dialog [ref=e136]:
              - generic [ref=e137]:
                - generic [ref=e138]:
                  - generic [ref=e139]:
                    - heading "Novo modelo de mensagem" [level=2] [ref=e140]
                    - generic [ref=e141]: A Meta analisa cada modelo antes de liberar o uso.
                  - button "Fechar" [ref=e142]
                - generic [ref=e147]:
                  - generic [ref=e148]:
                    - generic [ref=e149]:
                      - generic [ref=e150]:
                        - generic [ref=e151]: Nome
                        - textbox "Nome" [ref=e153]:
                          - /placeholder: promocao_outubro
                          - text: retorno_contato
                        - paragraph [ref=e154]: Minúsculas, números e _.
                      - generic [ref=e155]:
                        - generic [ref=e156]: Categoria
                        - combobox "Categoria" [ref=e157]:
                          - option "Marketing (ofertas, novidades)"
                          - option "Utilidade (pedidos, lembretes)" [selected]
                          - option "Autenticação (códigos)"
                      - generic [ref=e158]:
                        - generic [ref=e159]: Idioma
                        - combobox "Idioma" [ref=e160]:
                          - option "Português (Brasil)" [selected]
                          - option "Espanhol"
                          - option "Inglês (EUA)"
                    - group "Cabeçalho (opcional)" [ref=e161]:
                      - radiogroup "Tipo de cabeçalho" [ref=e163]:
                        - radio "Nenhum" [checked] [ref=e164]
                        - radio "Título" [ref=e168]
                        - radio "Imagem" [ref=e171]
                        - radio "Vídeo" [ref=e176]
                        - radio "Documento" [ref=e179]
                    - generic [ref=e183]:
                      - generic [ref=e184]: Texto
                      - textbox "Texto" [ref=e185]: "Olá {{1}}, podemos falar sobre o seu pedido?"
                      - paragraph [ref=e186]: "Use {{1}}, {{2}}… onde entram os dados de cada pessoa (nome, pedido…). Não comece nem termine com variável."
                    - 'button "Inserir variável {{2}}" [ref=e188]'
                    - group "Exemplos das variáveis (a Meta pede para aprovar)" [ref=e190]:
                      - generic [ref=e192]:
                        - generic [ref=e193]: "Exemplo de {{1}}"
                        - 'textbox "Exemplo de {{1}}" [active] [ref=e195]':
                          - /placeholder: Maria
                          - text: Maria
                    - generic [ref=e196]:
                      - generic [ref=e197]: Rodapé (opcional)
                      - textbox "Rodapé (opcional)" [ref=e199]
                      - paragraph [ref=e200]: 0/60
                    - 'group "Botões (opcional): respostas rápidas, até 2 links e 1 telefone" [ref=e201]':
                      - button "Botão" [ref=e203]
                      - paragraph [ref=e205]: Deixe as respostas rápidas juntas (todas antes ou todas depois dos links e do telefone).
                    - generic [ref=e206]:
                      - button "Cancelar" [ref=e207]
                      - button "Enviar para aprovação" [ref=e208]
                  - complementary "Prévia no celular" [ref=e209]:
                    - paragraph [ref=e210]: Como chega
                    - generic [ref=e211]:
                      - generic [ref=e212]: Sua empresa
                      - generic [ref=e217]:
                        - paragraph [ref=e218]: Olá Maria, podemos falar sobre o seu pedido?
                        - paragraph [ref=e219]: 10:30
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