import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { expectAccessible, loginAdmin, shot } from './util';

test.describe.configure({ mode: 'serial' });

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name, exact: true }).click();

test('contatos: cadastrar, anotar, agendar, anexar e achar duplicado', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Contatos');
  await expect(page.getByRole('heading', { name: 'Contatos' })).toBeVisible();
  await expect(page.getByText('Nenhum contato ainda')).toBeVisible();

  await page.getByRole('button', { name: 'Novo contato' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo contato' });
  await dialog.getByLabel('Nome', { exact: true }).fill('Mariana');
  await dialog.getByLabel('Sobrenome').fill('Rocha');
  await dialog.getByLabel('Cargo').fill('Diretora comercial');
  await dialog.getByLabel('E-mail 1', { exact: true }).fill('mariana@clinicaaurora.com.br');
  await dialog.getByLabel('Telefone 1', { exact: true }).fill('(11) 98877-6655');
  await dialog.getByRole('button', { name: 'Etiqueta' }).click();
  await dialog.getByLabel('Buscar ou criar etiqueta').fill('Cliente VIP');
  await dialog.getByRole('button', { name: 'Criar “Cliente VIP”' }).click();
  await dialog.getByLabel('Origem').fill('indicação');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Criar contato' }).click();

  await expect(page.getByRole('heading', { name: /Mariana Rocha/ })).toBeVisible();
  await expect(page.getByText('mariana@clinicaaurora.com.br')).toBeVisible();
  await expect(page.getByText('(11) 98877-6655')).toBeVisible();
  await expect(page.getByText('indicação')).toBeVisible();

  await page.getByLabel('Nova nota').fill('Pediu proposta para 3 unidades.');
  await page.getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.getByText('Pediu proposta para 3 unidades.')).toBeVisible();

  await page.getByRole('button', { name: 'Agendar' }).click();
  const act = page.getByRole('dialog', { name: 'Nova atividade' });
  await act.getByLabel('Tipo').selectOption('call');
  await act.getByLabel('Título').fill('Ligar para apresentar a proposta');
  const tomorrow = new Date(Date.now() + 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await act.getByLabel('Início').fill(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T10:00`);
  await act.getByLabel('Lembrete').selectOption('30');
  await act.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByRole('button', { name: 'Ligar para apresentar a proposta', exact: true })).toBeVisible();

  await page.locator('input[type=file]').setInputFiles({ name: 'proposta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });
  await expect(page.getByText('proposta.pdf')).toBeVisible();
  const html = await page.locator('input[type=file]').setInputFiles({ name: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
  void html;
  await expect(page.getByText(/não são aceitos|Envie PDF/)).toBeVisible();

  await expect(page.getByText('Adicionou uma nota')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '20-contato');

  // Cadastro com o mesmo e-mail: o sistema avisa e oferece abrir o existente.
  await nav(page, 'Contatos');
  await page.getByRole('button', { name: 'Novo contato' }).click();
  const d2 = page.getByRole('dialog', { name: 'Novo contato' });
  await d2.getByLabel('Nome', { exact: true }).fill('Mari');
  await d2.getByLabel('E-mail 1', { exact: true }).fill('MARIANA@clinicaaurora.com.br');
  await d2.getByRole('button', { name: 'Criar contato' }).click();
  await expect(d2.getByText('Já existe cadastro com este e-mail ou telefone')).toBeVisible();
  await expect(d2.getByText('Mariana Rocha')).toBeVisible();
  await d2.getByRole('button', { name: 'Criar mesmo assim' }).click();
  await expect(page.getByRole('heading', { name: 'Mari', exact: true })).toBeVisible();
  await expect(page.getByText('Possível cadastro duplicado')).toBeVisible();
  await page.getByRole('button', { name: 'Mesclar aqui' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mesclar' }).click();
  await expect(page.getByText('Possível cadastro duplicado')).toHaveCount(0);
  // Fica o cadastro aberto, completado com o que faltava; nota e arquivo vêm junto.
  await expect(page.getByRole('heading', { name: 'Mari Rocha', exact: true })).toBeVisible();
  await expect(page.getByText('Pediu proposta para 3 unidades.')).toBeVisible();
  await expect(page.getByText('proposta.pdf')).toBeVisible();

  await nav(page, 'Contatos');
  await page.getByLabel('Buscar contatos').fill('clinicaaurora');
  await expect(page.getByText('1 contato encontrados')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '21-contatos');
});

test('negócios: funil padrão, quadro, regras de etapa, ganho e perda', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Negócios');
  await expect(page.getByRole('region', { name: 'Etapa Qualificação' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo negócio' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo negócio' });
  await dlg.getByLabel('Título').fill('Implantação do CRM — Clínica Aurora');
  await dlg.getByLabel('Contato').fill('Mari');
  await dlg.getByRole('option', { name: /Mari/ }).first().click();
  await dlg.getByRole('button', { name: 'Criar negócio' }).click();
  await expect(page.getByRole('heading', { name: /Implantação do CRM/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Qualificação' })).toHaveAttribute('aria-current', 'step');

  // Proposta exige valor: a mudança é recusada com a explicação.
  await page.getByRole('navigation', { name: 'Etapas do funil' }).getByRole('button', { name: 'Proposta' }).click();
  await expect(page.getByText(/exige campos que faltam.*Informe o valor/)).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('dialog', { name: 'Editar negócio' }).getByLabel(/^Valor/).fill('18.500,00');
  await page.getByRole('dialog', { name: 'Editar negócio' }).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('R$ 18.500,00').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Etapas do funil' }).getByRole('button', { name: 'Proposta' }).click();
  await expect(page.getByRole('button', { name: 'Proposta' })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('Qualificação → Proposta')).toBeVisible();
  await expectAccessible(page);
  await shot(page, '22-negocio');

  // Quadro: arrastar para Negociação.
  await nav(page, 'Negócios');
  const card = page.getByRole('region', { name: 'Etapa Proposta' }).getByRole('article').filter({ hasText: 'Clínica Aurora' });
  await expect(card).toBeVisible();
  const target = page.getByRole('region', { name: 'Etapa Negociação' });
  await page.setViewportSize({ width: 1600, height: 900 });
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  // Segura pela parte de baixo do cartão (o título é um link).
  await page.mouse.move(from!.x + 40, from!.y + from!.height - 14);
  await page.mouse.down();
  await page.mouse.move(from!.x + 60, from!.y + from!.height - 4, { steps: 5 });
  await page.mouse.move(to!.x + 80, to!.y + 120, { steps: 15 });
  await page.mouse.up();
  await expect(target.getByRole('article').filter({ hasText: 'Clínica Aurora' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Etapa Negociação' }).getByRole('article').filter({ hasText: 'Clínica Aurora' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '23-quadro');

  // Perdido pede o motivo; depois reabre e ganha.
  await page.getByRole('link', { name: /Implantação do CRM/ }).click();
  await page.getByRole('button', { name: 'Perdido' }).click();
  const lost = page.getByRole('dialog', { name: 'Marcar como perdido' });
  await expect(lost.getByRole('button', { name: 'Marcar como perdido' })).toBeDisabled();
  await lost.getByLabel('Motivo da perda').selectOption({ label: 'Preço' });
  await lost.getByRole('button', { name: 'Marcar como perdido' }).click();
  await expect(page.getByText(/Perdido em .* Motivo: Preço/)).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir' }).click();
  await page.getByRole('button', { name: 'Ganho', exact: true }).click();
  await page.getByRole('dialog', { name: 'Marcar como ganho' }).getByRole('button', { name: 'Marcar como ganho' }).click();
  await expect(page.getByText(/^Ganho em/)).toBeVisible();
});

test('leads: cadastrar e qualificar em negócio', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Leads');
  await page.getByRole('button', { name: 'Novo lead' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo lead' });
  await dlg.getByLabel('Título').fill('Orçamento pelo site');
  await dlg.getByLabel('Nome', { exact: true }).fill('Paulo');
  await dlg.getByLabel('E-mail').fill('paulo@padariapaulista.com.br');
  await dlg.getByLabel('Origem').fill('site');
  await dlg.getByRole('button', { name: 'Criar lead' }).click();
  await expect(page.getByRole('heading', { name: /Orçamento pelo site/ })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Qualificar' }).click();
  await page.getByRole('dialog', { name: 'Qualificar lead' }).getByLabel('Valor estimado (R$)').fill('4.800');
  await page.getByRole('dialog', { name: 'Qualificar lead' }).getByRole('button', { name: 'Qualificar e criar negócio' }).click();
  await expect(page).toHaveURL(/\/negocios\//);
  await expect(page.getByText('R$ 4.800,00').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lead qualificado' })).toBeVisible();
});

test('agenda e painel', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Agenda');
  await expect(page.getByRole('group', { name: 'Visão' })).toBeVisible();
  await page.getByRole('button', { name: 'Próximo' }).click();
  await page.getByRole('button', { name: 'Hoje' }).click();
  await expect(page.getByText('Ligar para apresentar a proposta').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mês' }).click();
  await expectAccessible(page);
  await shot(page, '24-agenda');
  await nav(page, 'Início');
  await expect(page.getByText('Em negociação')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Funil em aberto' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '25-painel');
});

test('importar planilha CSV com erro por linha', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/contatos/importar');
  const csv = ['Nome;E-mail;Telefone;Empresa', 'Ana Souza;ana@lote.com;11 91111-2222;Lote A', 'Bruno Lima;bruno@lote.com;;Lote A',
    ';sem-nome@lote.com;;', 'Carla Dias;carla@;21 3333-4444;Lote B'].join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'contatos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('heading', { name: '2. Ligue as colunas aos campos' })).toBeVisible();
  await expect(page.getByLabel('Campo para a coluna Nome')).toHaveValue('fullName');
  await expectAccessible(page);
  await shot(page, '26-importar');
  await page.getByRole('button', { name: 'Importar 4 linhas' }).click();
  await expect(page.getByText('Concluída').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Linha 4')).toBeVisible();
  await expect(page.getByText(/Linha 5 .*E-mail inválido/)).toBeVisible();
  // Ana e Bruno pelo e-mail; Carla entrou só com o telefone, porque o e-mail era inválido.
  await page.goto('/contatos?q=lote.com');
  await expect(page.getByText('2 contatos encontrados')).toBeVisible();
  await page.goto('/contatos?q=Carla');
  await expect(page.getByText('1 contato encontrado')).toBeVisible();
});

test('planilha modelo: baixar, importar sem mexer em nada e reconhecer todas as colunas', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/contatos/importar');
  await expect(page.getByRole('table', { name: 'Exemplo de como preencher a planilha' })).toContainText('Primeiro nome');
  await expectAccessible(page);
  await shot(page, '27-planilha-modelo');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar planilha modelo' }).click()]);
  expect(download.suggestedFilename()).toBe('modelo-contatos.csv');
  const buffer = readFileSync((await download.path())!);
  expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  await page.locator('input[type=file]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'text/csv', buffer });
  await expect(page.getByRole('heading', { name: '2. Ligue as colunas aos campos' })).toBeVisible();
  for (const [col, target] of [['Primeiro nome', 'firstName'], ['Sobrenome', 'lastName'], ['E-mail', 'email'], ['Telefone', 'phone'], ['Empresa', 'organization'],
    ['Aniversário', 'birthday'], ['Etiquetas', 'tags'], ['Responsável', 'ownerEmail'], ['Origem', 'source'], ['Cidade', 'city'], ['UF', 'state'], ['Cargo', 'jobTitle']] as const) {
    await expect(page.getByLabel(`Campo para a coluna ${col}`, { exact: true })).toHaveValue(target);
  }
  await page.getByRole('button', { name: 'Importar 2 linhas' }).click();
  // Os dois entram; o responsável do exemplo (e-mail fictício) vira só um aviso na linha.
  await expect(async () => {
    await page.goto('/contatos?q=exemplo.com.br');
    await expect(page.getByText('2 contatos encontrados')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
});

test('configurações do CRM: funis e campos', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/configuracoes/funis');
  await expect(page.getByRole('heading', { name: 'Etapas' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, '27-funis');
  await page.goto('/configuracoes/campos');
  await page.getByRole('button', { name: 'Novo campo' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo campo' });
  await dlg.getByLabel('Rótulo').fill('Número de unidades');
  await expect(dlg.getByLabel('Chave')).toHaveValue('numero_de_unidades');
  await dlg.getByLabel('Tipo').selectOption('number');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Número de unidades')).toBeVisible();
  await expectAccessible(page);
});
