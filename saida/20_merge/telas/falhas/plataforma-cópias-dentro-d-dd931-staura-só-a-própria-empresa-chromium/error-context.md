# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plataforma.spec.ts >> cópias dentro da empresa: o administrador faz, baixa e restaura só a própria empresa
- Location: e2e/plataforma.spec.ts:236:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'Cópias disponíveis' }).getByRole('row').nth(1)
Expected substring: "24/10/2026"
Received string:    "16/10/2026, 23:02120 KB23/10/2026Baixar a cópia de 16/10/2026, 23:02Restaurar a cópia de 16/10/2026, 23:02"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('region', { name: 'Cópias disponíveis' }).getByRole('row').nth(1) with timeout 5000ms
  - waiting for getByRole('region', { name: 'Cópias disponíveis' }).getByRole('row').nth(1)
    14 × locator resolved to <tr class="border-b border-line last:border-0">…</tr>
       - unexpected value "16/10/2026, 23:02120 KB23/10/2026Baixar a cópia de 16/10/2026, 23:02Restaurar a cópia de 16/10/2026, 23:02"

```

```yaml
- row "16/10/2026, 23:02 120 KB 23/10/2026 Baixar a cópia de 16/10/2026, 23:02 Restaurar a cópia de 16/10/2026, 23:02 Excluir a cópia de 16/10/2026, 23:02":
  - cell "16/10/2026, 23:02"
  - cell "120 KB"
  - cell "23/10/2026"
  - cell "Baixar a cópia de 16/10/2026, 23:02 Restaurar a cópia de 16/10/2026, 23:02 Excluir a cópia de 16/10/2026, 23:02":
    - link "Baixar a cópia de 16/10/2026, 23:02":
      - /url: /api/v1/backups/crm-20261017-020250-empresa.tar/download
    - button "Restaurar a cópia de 16/10/2026, 23:02"
    - button "Excluir a cópia de 16/10/2026, 23:02"
```

# Test source

```ts
  148 |   await page.getByLabel('Arquivo do logotipo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  149 |   await expect(page.getByText('Logotipo atualizado.')).toBeVisible();
  150 |   const logo = page.getByRole('navigation', { name: 'Menu principal' }).getByRole('img');
  151 |   await expect(logo).toHaveAttribute('src', /\/api\/v1\/public\/branding\/.+\/logo\//);
  152 |   const r = await page.request.get((await logo.getAttribute('src'))!);
  153 |   expect(r.status()).toBe(200);
  154 |   expect(r.headers()['content-type']).toBe('image/png');
  155 |   await expectAccessible(page);
  156 |   await shot(page, '32-identidade-modelos');
  157 | 
  158 |   // Arquivo que não é imagem é recusado.
  159 |   await page.getByLabel('Arquivo do ícone (favicon)').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('não é imagem') });
  160 |   await expect(page.getByText(/Envie PDF|Envie PNG|não aceito/)).toBeVisible();
  161 | });
  162 | 
  163 | test('domínio próprio: instruções, cadastro e login com a marca da empresa', async ({ page, browser }) => {
  164 |   await loginAdmin(page);
  165 |   await openSettings(page, 'Domínio próprio');
  166 |   await page.getByLabel('Endereço').fill('https://crm.aurora-otica.test/');
  167 |   await page.getByRole('button', { name: 'Salvar' }).click();
  168 |   await expect(page.getByLabel('Endereço')).toHaveValue('crm.aurora-otica.test');
  169 |   await expect(page.getByRole('cell', { name: 'CNAME' })).toBeVisible();
  170 |   await expect(page.getByRole('cell', { name: 'crm', exact: true })).toBeVisible();
  171 |   await expectAccessible(page);
  172 |   await shot(page, '33-dominio-proprio');
  173 | 
  174 |   // Com o DNS conferido, a tela de login nesse endereço sai com a marca da empresa.
  175 |   sql("update tenant_domains set dns_ok = true, verified_at = now() where domain = 'crm.aurora-otica.test'");
  176 |   const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-host': 'crm.aurora-otica.test' } });
  177 |   const p2 = await ctx.newPage();
  178 |   await p2.goto('/entrar');
  179 |   await expect(p2.locator('aside img')).toHaveAttribute('src', /\/logo\//);
  180 |   expect(await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--side').trim())).toBe('#062C26');
  181 |   await expect(p2).toHaveTitle(/WTA|CRM/);
  182 |   await shot(p2, '34-login-dominio-proprio');
  183 |   await ctx.close();
  184 | 
  185 |   // No endereço principal, a tela de login continua com a marca padrão.
  186 |   const fresh = await browser.newContext();
  187 |   const plain = await (await fresh.request.get('/entrar')).text();
  188 |   expect(plain).not.toContain('--side:#062C26');
  189 |   await fresh.close();
  190 | 
  191 |   // Limpeza: volta ao padrão para os outros testes.
  192 |   await page.getByRole('button', { name: 'Remover' }).click();
  193 |   await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
  194 |   await expect(page.getByLabel('Endereço')).toHaveValue('');
  195 |   await openSettings(page, 'Identidade visual');
  196 |   await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  197 |   await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  198 |   await expect(page.getByText('Tema padrão restaurado.')).toBeVisible();
  199 | });
  200 | 
  201 | test('backups: fazer cópia agora, baixar e restaurar uma empresa', async ({ page }) => {
  202 |   test.setTimeout(120_000);
  203 |   await loginAdmin(page);
  204 |   await openPlatform(page, 'Backups');
  205 |   await expect(page.getByText('Serviço de cópias funcionando')).toBeVisible({ timeout: 15_000 });
  206 |   await page.getByRole('button', { name: 'Fazer cópia agora' }).click();
  207 |   await expect(page.getByText('Cópia pedida.')).toBeVisible();
  208 |   const row = page.getByRole('row').filter({ hasText: 'Manual' });
  209 |   await expect(row).toBeVisible({ timeout: 60_000 });
  210 |   await expect(row).toContainText('Incluídos');
  211 |   const href = await row.getByRole('link', { name: /Baixar/ }).getAttribute('href');
  212 |   const dl = await page.request.get(href!);
  213 |   expect(dl.status()).toBe(200);
  214 |   expect((await dl.body()).length).toBeGreaterThan(1000);
  215 |   await expectAccessible(page);
  216 |   await shot(page, '36-backups');
  217 | 
  218 |   await row.getByRole('button', { name: /Restaurar/ }).click();
  219 |   const d = page.getByRole('dialog', { name: 'Restaurar cópia' });
  220 |   await d.getByLabel('Empresa', { exact: true }).selectOption({ index: 0 });
  221 |   const go = d.getByRole('button', { name: /^Restaurar / });
  222 |   await expect(go).toBeDisabled();
  223 |   await d.getByLabel('Digite RESTAURAR para confirmar').fill('RESTAURAR');
  224 |   await expectAccessible(page);
  225 |   await shot(page, '37-backups-restaurar');
  226 |   await go.click();
  227 |   await expect(page.getByText(/Restauração de .* pedida/)).toBeVisible();
  228 |   const job = page.getByRole('listitem').filter({ hasText: 'Restaurar uma empresa' }).first();
  229 |   await expect(job).toContainText('Concluído', { timeout: 90_000 });
  230 |   await expect(page.getByRole('row').filter({ hasText: 'Antes de restaurar' })).toBeVisible();
  231 |   // O CRM continua funcionando para quem está dentro.
  232 |   await page.goto('/inicio');
  233 |   await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  234 | });
  235 | 
  236 | test('cópias dentro da empresa: o administrador faz, baixa e restaura só a própria empresa', async ({ page }) => {
  237 |   test.setTimeout(120_000);
  238 |   const tenant = sql("select id from tenants where slug = 'wta'").trim();
  239 |   sql(`insert into contacts (tenant_id, first_name, last_name) values ('${tenant}', 'Cópia', 'de Teste')`);
  240 |   await loginAdmin(page);
  241 |   await openSettings(page, 'Cópias de segurança');
  242 |   await expect(page.getByText('Cada cópia fica guardada por 7 dias e depois é apagada sozinha.')).toBeVisible();
  243 |   await page.getByRole('button', { name: 'Fazer cópia agora' }).click();
  244 |   await expect(page.getByText('Cópia pedida.')).toBeVisible();
  245 |   const row = page.getByRole('region', { name: 'Cópias disponíveis' }).getByRole('row').nth(1);
  246 |   await expect(row).toBeVisible({ timeout: 60_000 });
  247 |   const expires = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('pt-BR');
> 248 |   await expect(row).toContainText(expires);
      |                     ^ Error: expect(locator).toContainText(expected) failed
  249 |   const href = await row.getByRole('link', { name: /Baixar/ }).getAttribute('href');
  250 |   const dl = await page.request.get(href!);
  251 |   expect(dl.status()).toBe(200);
  252 |   await expectAccessible(page);
  253 |   await shot(page, '38-copias-da-empresa');
  254 | 
  255 |   sql(`delete from contacts where tenant_id = '${tenant}' and first_name = 'Cópia' and last_name = 'de Teste'`);
  256 |   await row.getByRole('button', { name: /Restaurar/ }).click();
  257 |   const d = page.getByRole('dialog', { name: 'Restaurar cópia' });
  258 |   const go = d.getByRole('button', { name: 'Restaurar a empresa' });
  259 |   await expect(go).toBeDisabled();
  260 |   await d.getByLabel('Digite RESTAURAR para confirmar').fill('RESTAURAR');
  261 |   await expectAccessible(page);
  262 |   await go.click();
  263 |   await expect(page.getByText('Restauração pedida.')).toBeVisible();
  264 |   const job = page.getByRole('listitem').filter({ hasText: 'Restauração da empresa' }).first();
  265 |   await expect(job).toContainText('Concluído', { timeout: 90_000 });
  266 |   expect(sql(`select count(*) from contacts where tenant_id = '${tenant}' and first_name = 'Cópia' and last_name = 'de Teste'`).trim()).toBe('1');
  267 |   // Ficou a cópia de segurança feita antes de restaurar; o administrador continua dentro.
  268 |   await expect(page.getByRole('region', { name: 'Cópias disponíveis' }).getByRole('row')).toHaveCount(3);
  269 |   await page.goto('/inicio');
  270 |   await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
  271 | });
  272 | 
```