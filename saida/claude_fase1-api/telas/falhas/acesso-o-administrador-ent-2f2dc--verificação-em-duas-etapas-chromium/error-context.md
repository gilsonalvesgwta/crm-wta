# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acesso.spec.ts >> o administrador entra e vê o aviso para ativar a verificação em duas etapas
- Location: e2e/acesso.spec.ts:40:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "color-contrast: .rounded-full",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - alert [ref=e2]
  - generic [ref=e3]:
    - navigation "Menu principal" [ref=e4]:
      - generic [ref=e5]: CRM WTA
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
          - generic [ref=e34]:
            - heading "Olá, Gilson" [level=1] [ref=e35]
            - paragraph [ref=e36]: WTA Gestão e Automações · domingo, 11 de outubro
          - status [ref=e37]:
            - text: Você administra esta empresa. Ative a verificação em duas etapas para abrir as configurações.
            - link "Ativar agora" [ref=e38] [cursor=pointer]:
              - /url: /conta#dois-fatores
          - generic [ref=e39]:
            - generic [ref=e40]:
              - heading "Segurança da conta" [level=2] [ref=e43]
              - generic [ref=e48]:
                - paragraph [ref=e49]: Verificação em duas etapas desligada
                - paragraph [ref=e50]: Com ela, só a senha não basta para entrar na sua conta.
                - link "Abrir conta e segurança" [ref=e51] [cursor=pointer]:
                  - /url: /conta
            - generic [ref=e52]:
              - heading "Suas empresas" [level=2] [ref=e55]
              - list [ref=e57]:
                - listitem [ref=e58]:
                  - generic [ref=e59]: WTA Gestão e Automações
                  - generic [ref=e60]: Em uso
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
  63 |   const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  64 |   const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
> 65 |   expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
     |                                                                                               ^ Error: expect(received).toEqual(expected) // deep equality
  66 | }
  67 | 
  68 | export async function login(page: Page, email: string, password: string): Promise<void> {
  69 |   await page.goto('/entrar');
  70 |   await page.getByLabel('E-mail').fill(email);
  71 |   await page.getByLabel('Senha', { exact: true }).fill(password);
  72 |   await page.getByRole('button', { name: 'Entrar' }).click();
  73 | }
  74 | 
  75 | /** Avisos da página (o anunciador de rotas do Next também usa role="alert"). */
  76 | export function alertBox(page: Page) {
  77 |   return page.locator('[role="alert"]:not(#__next-route-announcer__)');
  78 | }
  79 | 
  80 | const SECRET_FILE = path.join(process.env.MAIL_DIR ?? '/tmp/crm-mail', '..', 'e2e-admin-totp.txt');
  81 | export function saveAdminSecret(secret: string): void {
  82 |   writeFileSync(SECRET_FILE, secret);
  83 | }
  84 | 
  85 | /** Entra como o administrador, que já tem a verificação em duas etapas ativa. */
  86 | export async function loginAdmin(page: Page): Promise<void> {
  87 |   const secret = readFileSync(SECRET_FILE, 'utf8').trim();
  88 |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  89 |   await expect(page).toHaveURL(/\/entrar\/verificacao/);
  90 |   await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  91 |   await page.getByRole('button', { name: 'Confirmar' }).click();
  92 |   await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  93 | }
  94 | 
```