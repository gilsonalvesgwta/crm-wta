# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mensagens.spec.ts >> KPIs: investimento lançado e importado da Meta, planilha por período e fator de escala
- Location: e2e/mensagens.spec.ts:313:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('4. Investimento necessário')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('4. Investimento necessário') with timeout 5000ms
  - waiting for getByText('4. Investimento necessário')

```

```yaml
- alert: Olá, Gilson
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
  - link "Agenda":
    - /url: /agenda
  - link "Plataforma":
    - /url: /plataforma
  - link "Configurações":
    - /url: /configuracoes
  - link "Minha conta":
    - /url: /conta
- banner:
  - 'button "Avisos: 2 não lidos"'
  - text: WTA Gestão e Automações
  - button "Menu de Gilson Alves": GA
- main:
  - heading "Olá, Gilson" [level=1]
  - paragraph: WTA Gestão e Automações · terça-feira, 20 de outubro
  - group "Visão do painel":
    - button "Visão comercial"
    - button "Indicadores comerciais"
    - button "Operação de atendimento"
    - button "KPIs" [pressed]
  - tablist "Painel do funil"
  - button "+ Novo funil"
  - combobox "Período dos KPIs":
    - option "Últimos 7 dias"
    - option "Últimos 14 dias"
    - option "Últimos 30 dias" [selected]
    - option "Últimos 60 dias"
    - option "Últimos 90 dias"
    - option "Este mês"
    - option "Mês passado"
    - option "Personalizado"
  - combobox "Agrupar a planilha":
    - option "Diário" [selected]
    - option "A cada 3 dias"
    - option "Semanal"
    - option "Quinzenal"
    - option "A cada 30 dias"
  - text: 21/09/2026 – 20/10/2026
  - status:
    - text: "Sem funil, os números misturam tudo: os leads contam"
    - strong: todo contato novo
    - text: .
    - button "Crie o primeiro funil"
    - text: "(ex.: \"Tráfego pago\", com a etiqueta dos leads de anúncio)."
  - region "Os números da escala":
    - heading "Os números da escala" [level=2]
    - paragraph: "Custo por reunião realizada, reuniões por venda e ticket médio: com eles, a meta vira investimento."
    - group "Conferir os números":
      - text: "Conferir o que foi contado:"
      - button "Leads"
      - button "Prospecções"
      - button "Reuniões agendadas"
      - button "Reuniões realizadas"
      - button "Não compareceram"
      - button "Vendas"
    - paragraph: Custo por reunião realizada
    - text: 1 realizada
    - paragraph: R$ 700,00
    - paragraph: "custo por agendada: R$ 175,00"
    - paragraph: Investimento em anúncios do período ÷ reuniões realizadas (sem no-show).
    - paragraph: Conversão na reunião
    - text: Sem venda na reunião
    - paragraph: 0,0%
    - paragraph: 0 vendas na reunião · 100% contando o follow-up
    - paragraph: Vendas fechadas no dia da reunião ÷ reuniões realizadas.
    - paragraph: Ticket médio
    - text: 1 venda
    - paragraph: R$ 18.500,00
    - paragraph: faturamento R$ 18.500,00
    - paragraph: Faturamento ÷ vendas do período.
    - paragraph: Taxa de no-show
    - text: Acima da meta de 20%
    - paragraph: 50,0%
    - paragraph: 1 não compareceu · 0 remarcadas
    - paragraph: "Não compareceu ÷ (realizadas + não compareceu). Meta: até 20%."
    - paragraph: Investimento
    - text: Google Ads
    - paragraph: R$ 700,00
    - paragraph: Google Ads R$ 700
    - paragraph: Gasto em anúncios lançado ou importado, dividido pelos dias de cada lançamento.
    - paragraph: Leads
    - text: Custo por lead R$ 58,33
    - paragraph: "12"
    - paragraph: 8 prospecções (pessoas abordadas)
    - paragraph: Contatos e leads novos no período (cada pessoa uma vez). Crie um funil para contar só os leads dele.
    - paragraph: Custo por venda
    - text: 1 venda
    - paragraph: R$ 700,00
    - paragraph: 0 na reunião · 0 no follow-up
    - paragraph: Investimento ÷ vendas do período (CAC de mídia).
    - paragraph: ROAS
    - text: Retorno acima do gasto
    - paragraph: 26,4x
    - paragraph: R$ 18.500,00 de R$ 700,00
    - paragraph: Faturamento ÷ investimento em anúncios.
  - heading "Funil do período" [level=2]
  - text: Quanto cada etapa pede da anterior.
  - list:
    - listitem:
      - text: Leads 12 custo R$ 58,33
      - button "Conferir Leads": Conferir
    - listitem:
      - text: Prospecções 8 pessoas abordadas
      - button "Conferir Prospecções": Conferir
    - listitem:
      - text: Reuniões agendadas 4 33% dos leads · 2 prospecções por agendada
      - button "Conferir Reuniões agendadas": Conferir
    - listitem:
      - text: Reuniões realizadas 1 no-show 50% (meta até 20%)
      - button "Conferir Reuniões realizadas": Conferir
    - listitem:
      - text: Vendas 1 100% das realizadas
      - button "Conferir Vendas": Conferir
  - heading "Fator de escala" [level=2]
  - text: Quanto investir para chegar à meta, com as taxas do período (pode mudar qualquer número). Meta de faturamento (R$)
  - textbox "Meta de faturamento (R$)":
    - /placeholder: "Ex.: 100.000,00"
    - text: 100.000,00
  - text: Prazo (dias)
  - textbox "Prazo (dias)": "30"
  - text: Ticket médio (R$)
  - textbox "Ticket médio (R$)": 18.500,00
  - paragraph: Do período
  - text: Conversão na reunião (%)
  - textbox "Conversão na reunião (%)": "0"
  - paragraph: Vendas na reunião ÷ realizadas
  - text: Custo por reunião realizada (R$)
  - textbox "Custo por reunião realizada (R$)": 50,00
  - paragraph: Investimento ÷ realizadas
  - text: No-show (%)
  - textbox "No-show (%)": "20"
  - paragraph: "Meta: até 20%"
  - paragraph: Informe a meta de faturamento. Ticket, conversão e custo por reunião vêm do período; se o período ainda não tem vendas ou investimento, preencha com os números que vocês usam.
  - heading "Planilha por período" [level=2]
  - text: "Diário: uma linha por período, com o total no fim. Fuso America/Sao_Paulo."
  - button "Copiar para planilha"
  - button "Baixar CSV"
  - region "Planilha de KPIs por período":
    - table:
      - rowgroup:
        - row "Período Investimento Leads Custo/lead Prospecções Agendadas Custo/agendada Realizadas No-show Custo/realizada Vendas Na reunião Conv. reunião Faturamento Ticket médio Custo/venda ROAS":
          - columnheader "Período"
          - columnheader "Investimento"
          - columnheader "Leads"
          - columnheader "Custo/lead"
          - columnheader "Prospecções"
          - columnheader "Agendadas"
          - columnheader "Custo/agendada"
          - columnheader "Realizadas"
          - columnheader "No-show"
          - columnheader "Custo/realizada"
          - columnheader "Vendas"
          - columnheader "Na reunião"
          - columnheader "Conv. reunião"
          - columnheader "Faturamento"
          - columnheader "Ticket médio"
          - columnheader "Custo/venda"
          - columnheader "ROAS"
      - rowgroup:
        - row "21/09 (seg) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "21/09 (seg)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "22/09 (ter) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "22/09 (ter)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "23/09 (qua) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "23/09 (qua)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "24/09 (qui) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "24/09 (qui)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "25/09 (sex) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "25/09 (sex)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "26/09 (sáb) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "26/09 (sáb)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "27/09 (dom) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "27/09 (dom)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "28/09 (seg) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "28/09 (seg)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "29/09 (ter) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "29/09 (ter)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "30/09 (qua) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "30/09 (qua)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "01/10 (qui) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "01/10 (qui)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "02/10 (sex) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "02/10 (sex)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "03/10 (sáb) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "03/10 (sáb)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "04/10 (dom) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "04/10 (dom)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "05/10 (seg) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "05/10 (seg)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "06/10 (ter) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "06/10 (ter)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "07/10 (qua) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "07/10 (qua)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "08/10 (qui) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "08/10 (qui)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "09/10 (sex) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "09/10 (sex)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "10/10 (sáb) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "10/10 (sáb)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "11/10 (dom) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "11/10 (dom)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "12/10 (seg) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "12/10 (seg)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "13/10 (ter) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "13/10 (ter)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "14/10 (qua) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "14/10 (qua)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "15/10 (qui) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "15/10 (qui)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "16/10 (sex) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "16/10 (sex)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "17/10 (sáb) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "17/10 (sáb)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "18/10 (dom) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "18/10 (dom)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "19/10 (seg) R$ 0,00 0 — 0 0 — 0 — — 0 0 — R$ 0,00 — — —":
          - rowheader "19/10 (seg)"
          - cell "R$ 0,00"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "0"
          - cell "—"
          - cell "—"
          - cell "0"
          - cell "0"
          - cell "—"
          - cell "R$ 0,00"
          - cell "—"
          - cell "—"
          - cell "—"
        - row "20/10 (ter) R$ 700,00 12 R$ 58,33 8 4 R$ 175,00 1 1 (50%) R$ 700,00 1 0 0% R$ 18.500,00 R$ 18.500,00 R$ 700,00 26,4x":
          - rowheader "20/10 (ter)"
          - cell "R$ 700,00"
          - cell "12"
          - cell "R$ 58,33"
          - cell "8"
          - cell "4"
          - cell "R$ 175,00"
          - cell "1"
          - cell "1 (50%)"
          - cell "R$ 700,00"
          - cell "1"
          - cell "0"
          - cell "0%"
          - cell "R$ 18.500,00"
          - cell "R$ 18.500,00"
          - cell "R$ 700,00"
          - cell "26,4x"
        - row "Total R$ 700,00 12 R$ 58,33 8 4 R$ 175,00 1 1 (50%) R$ 700,00 1 0 0% R$ 18.500,00 R$ 18.500,00 R$ 700,00 26,4x":
          - rowheader "Total"
          - cell "R$ 700,00"
          - cell "12"
          - cell "R$ 58,33"
          - cell "8"
          - cell "4"
          - cell "R$ 175,00"
          - cell "1"
          - cell "1 (50%)"
          - cell "R$ 700,00"
          - cell "1"
          - cell "0"
          - cell "0%"
          - cell "R$ 18.500,00"
          - cell "R$ 18.500,00"
          - cell "R$ 700,00"
          - cell "26,4x"
  - heading "Investimento em anúncios" [level=2]
  - text: Lançamentos que tocam o período de 21/09/2026 a 20/10/2026.
  - button "Importar da Meta"
  - button "Lançar investimento"
  - list "Contas da Meta Ads ligadas":
    - listitem:
      - text: "Anúncios Empresa Teste act_1234567 Importando Última importação: 20/10/2026, 23:31"
      - button "Importar agora"
      - button "Desligar"
  - region "Lançamentos de investimento":
    - table:
      - rowgroup:
        - row "Plataforma Período Origem Valor Ações":
          - columnheader "Plataforma"
          - columnheader "Período"
          - columnheader "Origem"
          - columnheader "Valor"
          - columnheader "Ações"
      - rowgroup:
        - row "Google Ads · Pesquisa consórcio 20/10/2026 Lançado por Gilson Alves R$ 700,00 Editar Google Ads de 20/10/2026 Apagar Google Ads de 20/10/2026":
          - cell "Google Ads · Pesquisa consórcio"
          - cell "20/10/2026"
          - cell "Lançado por Gilson Alves"
          - cell "R$ 700,00"
          - cell "Editar Google Ads de 20/10/2026 Apagar Google Ads de 20/10/2026":
            - button "Editar Google Ads de 20/10/2026"
            - button "Apagar Google Ads de 20/10/2026"
  - group: Como os KPIs são calculados
```

# Test source

```ts
  254 |   await shot(page, '51-campanha-relatorio');
  255 |   await page.getByRole('link', { name: 'Campanhas' }).first().click();
  256 |   await expect(page.getByRole('row').filter({ hasText: 'Oferta de outubro' })).toContainText('Concluída');
  257 | });
  258 | 
  259 | test('painel da operação: status agora, tendências, mapa de calor e atendentes', async ({ page }) => {
  260 |   await loginAdmin(page);
  261 |   await page.getByRole('button', { name: 'Operação de atendimento' }).click();
  262 |   await expect(page.getByRole('heading', { name: 'Status da operação agora' })).toBeVisible();
  263 |   await expect(page.getByText('Mensagens recebidas', { exact: true })).toBeVisible();
  264 |   await expect(page.getByText('Conversas sem responsável', { exact: true })).toBeVisible();
  265 |   await expect(page.getByRole('img', { name: 'Conversas por dia' })).toBeVisible();
  266 |   await expect(page.getByRole('region', { name: 'Mapa de calor por dia e hora' })).toBeVisible();
  267 |   await expect(page.getByRole('region', { name: 'Desempenho dos atendentes' })).toContainText('Gilson');
  268 |   await page.getByLabel('Canal', { exact: true }).selectOption('email');
  269 |   await expect(page.getByRole('heading', { name: 'Status da operação agora' })).toBeVisible();
  270 |   await page.getByLabel('Canal', { exact: true }).selectOption('');
  271 |   await expectAccessible(page);
  272 |   await shot(page, '52-painel-operacao');
  273 | });
  274 | 
  275 | test('indicadores comerciais: resultado da call e números de contato, calls e vendas', async ({ page }) => {
  276 |   await loginAdmin(page);
  277 |   const h = { 'x-crm-request': '1' };
  278 |   const c = await page.request.post('/api/v1/contacts', { data: { firstName: 'Otávio', lastName: 'Prado', allowDuplicate: true }, headers: h });
  279 |   const contactId = (await c.json()).id as string;
  280 |   const startsAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  281 |   for (const title of ['Call de diagnóstico', 'Call de retorno']) {
  282 |     expect((await page.request.post('/api/v1/activities', { data: { type: 'call', title, startsAt, contactId }, headers: h })).status()).toBe(201);
  283 |   }
  284 |   // Ao concluir a call pelo contato, o CRM pergunta como foi.
  285 |   await page.goto(`/contatos/${contactId}`);
  286 |   await page.getByRole('button', { name: 'Concluir: Call de diagnóstico' }).click();
  287 |   const how = page.getByRole('group', { name: 'Como foi: Call de diagnóstico' });
  288 |   await expect(how).toBeVisible();
  289 |   await expectAccessible(page);
  290 |   await how.getByRole('button', { name: 'Realizada' }).click();
  291 |   await expect(page.getByRole('button', { name: 'Reabrir: Call de diagnóstico' })).toBeVisible();
  292 |   await page.getByRole('button', { name: 'Concluir: Call de retorno' }).click();
  293 |   await page.getByRole('group', { name: 'Como foi: Call de retorno' }).getByRole('button', { name: 'Não compareceu' }).click();
  294 |   await expect(page.getByText('Não compareceu', { exact: true })).toBeVisible();
  295 | 
  296 |   await page.goto('/inicio');
  297 |   await page.getByRole('button', { name: 'Indicadores comerciais' }).click();
  298 |   await expect(page.getByRole('heading', { name: 'Números do período' })).toBeVisible();
  299 |   for (const t of ['Leads contatados', 'Calls agendadas', 'Calls realizadas', 'Vendas na call', 'Vendas no follow-up', 'Vendas no total']) {
  300 |     await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  301 |   }
  302 |   await expect(page.getByText(/Comparecimento \d+%/)).toBeVisible();
  303 |   await expect(page.getByRole('region', { name: 'Indicadores por vendedor' })).toContainText('Gilson');
  304 |   await page.getByLabel('Período', { exact: true }).selectOption('14');
  305 |   await expect(page.getByText('(14 dias)')).toBeVisible();
  306 |   await page.getByLabel('Período', { exact: true }).selectOption('custom');
  307 |   await expect(page.getByLabel('Data inicial', { exact: true })).toBeVisible();
  308 |   await page.getByLabel('Período', { exact: true }).selectOption('7');
  309 |   await expectAccessible(page);
  310 |   await shot(page, '53-indicadores-comerciais');
  311 | });
  312 | 
  313 | test('KPIs: investimento lançado e importado da Meta, planilha por período e fator de escala', async ({ page }) => {
  314 |   await loginAdmin(page);
  315 |   await page.getByRole('button', { name: 'KPIs', exact: true }).click();
  316 |   await expect(page.getByRole('heading', { name: 'Os números da escala' })).toBeVisible();
  317 |   for (const t of ['Custo por reunião realizada', 'Conversão na reunião', 'Ticket médio', 'Taxa de no-show', 'Investimento', 'ROAS']) {
  318 |     await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  319 |   }
  320 | 
  321 |   // Lançar o gasto do Google à mão.
  322 |   await page.getByRole('button', { name: 'Lançar investimento' }).click();
  323 |   const d = page.getByRole('dialog', { name: 'Lançar investimento' });
  324 |   await d.getByLabel('Plataforma').selectOption('google');
  325 |   await d.getByLabel('Descrição (opcional)').fill('Pesquisa consórcio');
  326 |   await d.getByLabel('Valor gasto (R$)').fill('700,00');
  327 |   await expectAccessible(page);
  328 |   await d.getByRole('button', { name: 'Lançar' }).click();
  329 |   const spend = page.getByRole('region', { name: 'Lançamentos de investimento' });
  330 |   await expect(spend).toContainText('Google Ads');
  331 |   await expect(spend).toContainText('R$ 700,00');
  332 |   await expect(page.getByText('Google Ads R$ 700').first()).toBeVisible();
  333 | 
  334 |   // Importar da Meta Ads.
  335 |   await page.getByRole('button', { name: 'Importar da Meta' }).click();
  336 |   const m = page.getByRole('dialog', { name: 'Importar gasto da Meta Ads' });
  337 |   await m.getByLabel('Conta de anúncios').fill('act_1234567');
  338 |   await m.getByLabel('Token de acesso (ads_read)').fill('token-e2e');
  339 |   await m.getByRole('button', { name: 'Ligar e importar' }).click();
  340 |   const accs = page.getByRole('list', { name: 'Contas da Meta Ads ligadas' });
  341 |   await expect(accs).toContainText('Anúncios Empresa Teste');
  342 |   await expect(accs).toContainText('Importando');
  343 | 
  344 |   // Planilha diária e fator de escala.
  345 |   await page.getByLabel('Agrupar a planilha').selectOption('1');
  346 |   const sheet = page.getByRole('region', { name: 'Planilha de KPIs por período' });
  347 |   await expect(sheet).toContainText('Total');
  348 |   await expect(sheet).toContainText('R$ 700,00');
  349 |   await page.getByLabel('Meta de faturamento (R$)').fill('100.000,00');
  350 |   await page.getByLabel('Ticket médio (R$)').fill('10.000,00');
  351 |   await page.getByLabel('Conversão na reunião (%)').fill('25');
  352 |   await page.getByLabel('Custo por reunião realizada (R$)').fill('50,00');
  353 |   await page.getByLabel('No-show (%)').fill('20');
> 354 |   await expect(page.getByText('4. Investimento necessário')).toBeVisible();
      |                                                              ^ Error: expect(locator).toBeVisible() failed
  355 |   await expect(page.getByText('R$ 2.000,00', { exact: true })).toBeVisible();
  356 |   await expectAccessible(page);
  357 |   await shot(page, '54-kpis');
  358 | 
  359 |   // Um painel por funil: aviso até criar o primeiro; cada funil reconhece os seus pela etiqueta.
  360 |   await expect(page.getByText('todo contato novo', { exact: false }).first()).toBeVisible();
  361 |   const h = { 'x-crm-request': '1' };
  362 |   const tag = await (await page.request.post('/api/v1/tags', { data: { name: 'Lead anúncio' }, headers: h })).json() as { id: string };
  363 |   const prosp = await (await page.request.post('/api/v1/tags', { data: { name: 'Prospecção' }, headers: h })).json() as { id: string };
  364 |   for (const [firstName, lastName, t] of [['Lívia', 'Anúncio', tag.id], ['Fornecedor', 'Papelaria', tag.id], ['Paulo', 'Prospectado', prosp.id]]) {
  365 |     expect((await page.request.post('/api/v1/contacts', { data: { firstName, lastName, allowDuplicate: true, tagIds: [t] }, headers: h })).status()).toBe(201);
  366 |   }
  367 |   await page.getByRole('button', { name: '+ Novo funil' }).click();
  368 |   let fd = page.getByRole('dialog', { name: 'Novo funil' });
  369 |   await fd.getByLabel('Nome do funil').fill('Tráfego pago');
  370 |   await fd.getByLabel('Lead anúncio').check();
  371 |   await fd.getByLabel(/Recebe o investimento em anúncios/).check();
  372 |   await expectAccessible(page);
  373 |   await fd.getByRole('button', { name: 'Criar funil' }).click();
  374 |   await expect(page.getByText('todo contato novo', { exact: false })).toHaveCount(0);
  375 |   const funis = page.getByRole('tablist', { name: 'Painel do funil' });
  376 |   await expect(funis.getByRole('tab', { name: /Tráfego pago/ })).toHaveAttribute('aria-selected', 'true');
  377 |   await expect(page.getByRole('region', { name: 'Lançamentos de investimento' })).toContainText('Google Ads');
  378 | 
  379 |   await page.getByRole('button', { name: '+ Novo funil' }).click();
  380 |   fd = page.getByRole('dialog', { name: 'Novo funil' });
  381 |   await fd.getByLabel('Nome do funil').fill('Prospecção ativa');
  382 |   await fd.getByLabel('Prospecção', { exact: true }).check();
  383 |   await fd.getByLabel(/Prospecção lançada pelo vendedor/).check();
  384 |   await fd.getByRole('button', { name: 'Criar funil' }).click();
  385 |   await expect(funis.getByRole('tab', { name: 'Prospecção ativa' })).toHaveAttribute('aria-selected', 'true');
  386 |   await expect(page.getByText('Este funil não recebe o investimento', { exact: false })).toBeVisible();
  387 |   await expect(page.getByRole('heading', { name: 'Prospecção lançada' })).toBeVisible();
  388 | 
  389 |   // O vendedor lança a prospecção do dia no Início.
  390 |   await page.getByRole('button', { name: 'Visão comercial' }).click();
  391 |   const card = page.locator('form', { hasText: 'Prospecção ativa' });
  392 |   await card.getByLabel('Prospecções em Prospecção ativa').fill('30');
  393 |   await card.getByRole('button', { name: 'Salvar' }).click();
  394 |   await expect(card.getByRole('status')).toContainText('Salvo: 30 em hoje');
  395 |   await expectAccessible(page);
  396 |   await shot(page, '56-prospeccao-do-dia');
  397 | 
  398 |   await page.getByRole('button', { name: 'KPIs', exact: true }).click();
  399 |   await funis.getByRole('tab', { name: 'Prospecção ativa' }).click();
  400 |   await expect(page.getByText('30 lançadas pelos vendedores').first()).toBeVisible();
  401 |   await page.getByRole('group', { name: 'Conferir os números' }).getByRole('button', { name: 'Leads' }).click();
  402 |   let chk = page.getByRole('dialog', { name: 'Conferir: Leads' });
  403 |   await expect(chk.getByRole('list', { name: 'Registros de Leads' })).toContainText('Paulo Prospectado');
  404 |   await expect(chk.getByRole('list', { name: 'Registros de Leads' })).not.toContainText('Lívia');
  405 |   await chk.getByRole('button', { name: 'Fechar' }).click();
  406 | 
  407 |   // Tráfego pago: conferir e tirar da conta o que não é lead.
  408 |   await funis.getByRole('tab', { name: /Tráfego pago/ }).click();
  409 |   await page.getByRole('group', { name: 'Conferir os números' }).getByRole('button', { name: 'Leads' }).click();
  410 |   chk = page.getByRole('dialog', { name: 'Conferir: Leads' });
  411 |   const items = chk.getByRole('list', { name: 'Registros de Leads' });
  412 |   await expect(items).toContainText('Lívia Anúncio');
  413 |   await expect(items).toContainText('Fornecedor Papelaria');
  414 |   await expect(items).not.toContainText('Paulo');
  415 |   await expectAccessible(page);
  416 |   await chk.getByRole('button', { name: 'Não contar nos KPIs: Fornecedor Papelaria' }).click();
  417 |   await expect(chk.getByRole('button', { name: 'Voltar a contar: Fornecedor Papelaria' })).toBeVisible();
  418 |   await expect(chk).toContainText('1 fora dos KPIs');
  419 |   await shot(page, '55-kpis-conferir');
  420 | });
  421 | 
  422 | test('ações agendadas: agendar pelo contato e pela conversa, mudar e cancelar', async ({ page }) => {
  423 |   await loginAdmin(page);
  424 |   await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Contatos' }).click();
  425 |   await page.getByRole('navigation', { name: 'Subopções de contatos' }).getByRole('link', { name: 'Ações agendadas' }).click();
  426 |   await page.getByRole('button', { name: 'Agendar mensagem' }).click();
  427 |   const d = page.getByRole('dialog', { name: 'Agendar mensagem' });
  428 |   await d.getByLabel('Contato').fill('Bruno');
  429 |   await d.getByRole('option', { name: 'Bruno Prospect' }).click();
  430 |   await d.getByLabel('Mensagem').fill('Bruno, passando para lembrar da proposta.');
  431 |   await expectAccessible(page);
  432 |   await d.getByRole('button', { name: 'Agendar' }).click();
  433 |   await expect(page.getByText('Mensagem agendada.')).toBeVisible();
  434 |   const item = page.getByRole('listitem').filter({ hasText: 'Bruno, passando para lembrar' });
  435 |   await expect(item).toContainText('Agendada');
  436 |   await expectAccessible(page);
  437 |   await shot(page, '53-acoes-agendadas');
  438 | 
  439 |   await item.getByRole('button', { name: /Mudar a mensagem/ }).click();
  440 |   const e = page.getByRole('dialog', { name: 'Mudar mensagem agendada' });
  441 |   await e.getByLabel('Mensagem').fill('Bruno, lembrete da proposta (atualizado).');
  442 |   await e.getByRole('button', { name: 'Salvar' }).click();
  443 |   await expect(page.getByText('Agendamento atualizado.')).toBeVisible();
  444 |   const updated = page.getByRole('listitem').filter({ hasText: 'lembrete da proposta (atualizado)' });
  445 |   await updated.getByRole('button', { name: /Cancelar a mensagem/ }).click();
  446 |   await page.getByRole('dialog').getByRole('button', { name: 'Cancelar mensagem' }).click();
  447 |   await expect(page.getByText('Mensagem cancelada.')).toBeVisible();
  448 |   await expect(updated).toHaveCount(0);
  449 | 
  450 |   // Pela conversa: escreve e agenda em vez de enviar.
  451 |   await page.goto('/conversas?st=all');
  452 |   await page.getByRole('region', { name: 'Lista de conversas' }).getByRole('button', { name: /Bruno Prospect/ }).first().click();
  453 |   await page.getByLabel('Mensagem', { exact: true }).fill('Mensagem para amanhã');
  454 |   await page.getByRole('button', { name: 'Agendar', exact: true }).click();
```