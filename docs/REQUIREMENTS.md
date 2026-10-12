# Requisitos consolidados

Origem: o prompt mestre do produto (33 seções), de 11 de outubro de 2026. Este arquivo resume cada grupo de requisitos e diz em que fase ele é entregue. O detalhe verificável de cada item está em [`ACCEPTANCE_CRITERIA.md`](ACCEPTANCE_CRITERIA.md).

## Princípios inegociáveis

1. **Funcionalidade real.** Nada de botão decorativo, formulário sem persistência, gráfico com número fictício ou integração simulada apresentada como real.
2. **Arquitetura consistente.** Modelo de dados, contratos e regras de autorização definidos antes de multiplicar módulos.
3. **Segurança desde o início.** Isolamento entre empresas no banco, na API, nos arquivos, nas filas, nos webhooks e nos relatórios. Esconder na interface não é controle.
4. **Experiência premium.** Qualidade visual e funcional de produto SaaS profissional.
5. **Evolução controlada.** Fases com teste e critério de aceite; o projeto fica documentado e executável ao fim de cada uma.
6. **Preservação da infraestrutura.** Instalação isolada; nenhuma mudança destrutiva ou de alto impacto sem autorização explícita.

## Requisitos por módulo

| # | Módulo | Resumo | Fase |
| --- | --- | --- | --- |
| 1 | Multiempresa e white-label | Empresas isoladas, com identidade visual, domínio, módulos e limites próprios | 1 |
| 2 | Autenticação | Login, recuperação, convite, sessões revogáveis, proteção contra força bruta, 2FA, eventos registrados | 1 |
| 3 | Usuários, equipes e permissões | Perfis configuráveis, permissões por módulo, ação e alcance; conferidas na API | 1 |
| 4 | Auditoria | Ator, empresa, ação, objeto e horário das ações sensíveis | 1 |
| 5 | Contatos e empresas | Vários telefones e e-mails, tags, campos personalizados, duplicados, mesclagem, importação e exportação, busca | 2 |
| 6 | Atribuição e origem | Primeira e última origem, UTMs, identificadores de clique, histórico; nunca presumir dado ausente | 2 e 7 |
| 7 | Gestão comercial | Negócios, produtos, valores, motivos de ganho e perda, distribuição de leads, alertas de inatividade, metas | 2 |
| 8 | Funis | Quantos forem necessários, com etapas, regras de transição, campos obrigatórios e acesso por equipe | 2 |
| 9 | Tarefas e agenda | Tarefas, compromissos, recorrência, lembretes, calendário | 2 |
| 10 | Arquivos | Armazenamento com controle de acesso, validação e URLs assinadas | 2 |
| 11 | API pública e webhooks | API documentada, chaves com escopo, idempotência, webhooks assinados com histórico e reenvio | 3 |
| 12 | Integração com n8n | Eventos de saída e ações de entrada, sem acesso direto ao banco | 3 |
| 13 | Filas e workers | Processamento assíncrono persistente, retentativas, falhas definitivas visíveis | 3 |
| 14 | Caixa de entrada omnichannel | Conversas de vários canais em uma tela, com atribuição, notas internas e tempo real | 4 |
| 15 | WhatsApp pela Evolution API | Envio, recebimento, mídia, estados, várias contas por empresa, diagnóstico | 4 |
| 16 | E-mail | IMAP/SMTP e OAuth, sincronização, modelos, assinaturas, anexos | 5 |
| 17 | Agendador e mensagens comemorativas | Agendamento no servidor, regras de execução, campanhas por data, consentimento | 5 |
| 18 | Instagram Direct | Só pela API oficial | 6 |
| 19 | WhatsApp oficial e coexistência | Conector separado, condicionado à elegibilidade | 6 |
| 20 | Automações | Regras por evento com gatilho, condição e ação | 7 |
| 21 | Suporte e tickets | Categorias, prioridades, SLA, escalonamento, satisfação | 7 |
| 22 | Marketing | Captação, segmentos, sequências, relatórios de lead até venda | 7 |
| 23 | Dashboards e relatórios | Indicadores comerciais, de atendimento e de marketing, com filtros e permissões | 2 e 7 |
| 24 | Segurança e LGPD | Consentimento, opt-out, retenção, exportação e anonimização | 1 a 8 |
| 25 | Backup, recuperação e observabilidade | Cópias testadas, verificações de saúde, métricas, alertas | 1 e 8 |

## Pontos do documento que pediram definição

- **Leads e negócios.** O lead é a entrada ainda não qualificada. Ao qualificar, gera um negócio no funil.
- **Suporte como funil e como tickets.** Tickets têm estados e SLA próprios. Funis ficam para processos comerciais e de onboarding.
- **Coexistência do WhatsApp.** Só existe pela API oficial da Meta e exige que a WTA seja provedora de tecnologia ou use um parceiro. Não depende da Evolution API.
- **Instagram.** Funciona para contas da própria WTA com acesso padrão. Contas de clientes dependem de revisão da Meta.

## Fora do escopo inicial

Grupos do WhatsApp, rastreamento de abertura de e-mail por pixel, construtor visual de automações, aplicativo nativo e SSO. O SSO tem espaço previsto na arquitetura.
