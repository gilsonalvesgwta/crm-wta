# Situação do projeto

Atualizado em 13 de outubro de 2026.

## Fase atual

**Fase 2: CRM comercial.** Construída e testada, com o CI verde nas duas arquiteturas.

**Instalação:** no ar em `https://crm.wtatech.com.br` desde 13 de outubro de 2026, versão `2026.10.13-40971d2`, stack `crmwta` criada pelo Portainer da VPS. Migrações aplicadas, administrador criado, `/api/readyz` respondendo.

## Concluído, com teste

### Fase 1: fundação

| Item | Evidência |
| --- | --- |
| Banco: papéis, contexto de empresa, RLS forçado, funções de autenticação | Migrações `0001` a `0003`; testes de banco no PostgreSQL 16 e 18 |
| Login, sessão no servidor, bloqueio progressivo, CSRF, nova senha, troca de senha | Integração e ponta a ponta |
| Verificação em duas etapas com códigos de recuperação, obrigatória nas áreas administrativas | Vetores das RFC 4226 e 6238; integração; ponta a ponta |
| Convites, várias empresas por pessoa, sessões abertas | Integração e ponta a ponta |
| Matriz de permissões, oito perfis padrão, perfis personalizados com alcance | Domínio e integração |
| Usuários, equipes, dados da empresa, identidade visual com contraste calculado | Integração e ponta a ponta |
| Auditoria só de inserção; plataforma para criar e suspender empresas | Integração e ponta a ponta |
| Stack de produção com Traefik, segredos, cópia diária e restauração | `deploy/teste-stack.sh` no CI |

### Fase 2: CRM comercial

| Item | Evidência |
| --- | --- |
| Contatos e organizações: vários e-mails e telefones normalizados (E.164), etiquetas, campos personalizados, responsável e equipe, aniversário com ano opcional | Integração; ponta a ponta |
| Busca sem acento por nome, e-mail, telefone e documento; filtros, ordenação e paginação | Integração |
| Duplicados por e-mail e telefone, sem revelar o nome de cadastro fora do alcance; mesclagem que preserva negócios, notas, histórico, origem e consentimento, auditada | Integração; ponta a ponta |
| Alcance: comercial vê os próprios (e os contatos dos seus negócios e leads), líder vê a equipe, gestor vê a empresa; fora do alcance responde 404 | Integração, por perfil |
| Funis configuráveis: etapas, ordem, cores, probabilidade, campos exigidos, prazo de inatividade, regras de transição | Integração; ponta a ponta |
| Negócios em quadro com arrastar (também pelo teclado), totais e valor ponderado por etapa; ganho e perda com motivo; itens de produto | Integração; ponta a ponta |
| Histórico de etapas gravado pelo banco, com tempo em cada etapa | Banco; integração |
| Funil restrito: some da lista, da API, do quadro e da exportação para quem não está na lista | Integração |
| Leads: contato existente reaproveitado, rodízio por origem e equipe (30 entradas simultâneas, 10 para cada um), atribuição auditada com aviso, qualificar em negócio, descartar e reabrir | Integração; ponta a ponta |
| Tarefas e agenda: tipos, prioridade, recorrência que mantém o horário local, editar ou excluir "esta e as seguintes", lembrete que vira aviso uma única vez, visões de dia, semana, mês e lista | Integração; ponta a ponta |
| Linha do tempo de cada registro, com nomes dos campos alterados e nunca os valores pessoais | Integração |
| Origem: primeira e última, UTMs e identificadores de clique; a primeira nunca é sobrescrita; campo ausente fica vazio | Banco; integração |
| Arquivos: tipo conferido pelo conteúdo (HTML, SVG e executáveis recusados), limite de tamanho, download só por endereço assinado de 5 minutos, 404 fora do alcance | Integração; ponta a ponta |
| Importação de CSV: 10 mil linhas em lotes, sugestão de colunas, duplicados pulados ou completados, aviso por linha, retomada sem repetir depois de queda | Integração; ponta a ponta |
| Exportação em CSV para o Excel em português, no alcance de quem exporta, registrada | Integração |
| Consentimento por canal e finalidade com origem e evidência; opt-out vai para a lista de supressão | Banco; integração |
| Direitos do titular: exportar tudo e anonimizar, com 2FA e auditoria | Integração |
| Painel inicial: negócios em aberto, ganhos, taxa de ganho, perdas por motivo, leads por origem, agenda do dia; números conferidos contra consulta direta e no alcance de quem vê | Integração; ponta a ponta |
| Imagens para amd64 e arm64 (a VPS é ARM), com o teste da stack nas duas | CI |

## Testes executados

Ramo `claude/fase2-crm`, 13 de outubro de 2026, no GitHub Actions (os mesmos conjuntos também rodam no ambiente de desenvolvimento).

| Conjunto | Onde | Resultado |
| --- | --- | --- |
| Banco | PostgreSQL 16 e 18 | 330 verificações aprovadas em cada |
| API (domínio e integração) | Node 24, PostgreSQL 18 | 137 de 137 |
| Ponta a ponta | Chromium, API e interface compiladas | 19 de 19, com axe em cada tela |
| Stack | Docker Swarm com Traefik 3.5 configurado como o da VPS, em amd64 e em arm64 | Todas as conferências aprovadas nas duas, incluindo arquivo gravado no volume e baixado pelo endereço assinado |
| Dependências | `pnpm audit --prod` | Nenhuma vulnerabilidade conhecida |

## Pendências

- **Limite de requisições geral** por IP e por usuário: entra com o Redis, na Fase 3. O login já tem bloqueio.
- **Logotipo e favicon por empresa**: o armazenamento de arquivos já existe; falta a tela de envio e o uso no tema.
- **Tela de login com a marca da empresa pelo domínio próprio.**
- **Visões salvas**: a API existe; falta a tela para salvar e escolher filtros.
- **Lembretes só dentro do CRM.** Lembrete por e-mail ou WhatsApp entra com os canais (Fases 4 e 5).
- **Metas comerciais**: Fase 7, junto com os dashboards avançados.
- **Lint** no CI.

## Bugs conhecidos

Nenhum.

## Dependências externas

| Item | De quem |
| --- | --- |
| Registro DNS `crm` (tipo A) para o IP da VPS, no Cloudflare | Responsável pelo produto |
| Revisão da matriz de permissões | Responsável pelo produto |
| Caixa de e-mail na Hostinger para os e-mails do sistema | Responsável pelo produto (endereço e senha só na instalação) |
| Endereço e chave da Evolution API, número de teste | Fase 4 |
| Aplicativo na Meta e verificação da empresa | Fase 6 |

## Mudanças de infraestrutura

13 de outubro de 2026, com aprovação do responsável, na VPS `Wtatechor3`:

- Registro DNS `crm.wtatech.com.br` (Cloudflare).
- Segredos `crmwta_db_password`, `crmwta_api_db_password`, `crmwta_master_keys`, `crmwta_smtp_pass`, `crmwta_bootstrap_password`.
- Stack `crmwta` (serviços `db`, `migrate`, `api`, `web`, `backup`; volumes `crmwta_db`, `crmwta_backup`, `crmwta_arquivos`), ligada à rede existente `Wtatechor3Net` só pelos serviços `api` e `web`.
- Nenhum serviço, rede, volume ou configuração existente foi alterado.

## Riscos

- **Verificação em duas etapas desligada nas áreas administrativas** durante os testes (`EXIGIR_2FA=false`). Religar antes de receber clientes.
- **Toda versão mesclada no `main` vai para o ar sozinha.** O CI completo (banco, API, telas, stack nas duas arquiteturas) precisa passar antes; a versão anterior pode ser fixada pela stack.

- **Repositório público.** Recomendação: torná-lo privado. Nenhum segredo foi gravado nele.
- **Cópias do banco e arquivos só na VPS** até haver destino externo.
- **VPS sem swap** e com muitos serviços em imagens `latest`, que podem mudar sozinhas numa reinicialização. Não é do CRM, mas afeta a máquina toda.

## Próximas ações

1. Recriar a stack `crmwta` pelo ramo `implantacao`, com atualização automática e `EXIGIR_2FA=false` durante os testes.
2. Primeiro acesso: trocar a senha, testar o e-mail e remover `BOOTSTRAP_EMAIL` da stack.
3. Fase 3: API pública com chaves, webhooks, eventos, filas com Redis e integração com o n8n.

## Aprovações pendentes

- ADR 021: consultas em SQL, sem ORM.
- Usar o MinIO da VPS para os arquivos, ou manter o volume da stack (ADR 023).
- Matriz de permissões.
- Tornar o repositório privado.
