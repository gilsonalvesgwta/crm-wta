# Situação do projeto

Atualizado em 13 de outubro de 2026.

## Fase atual

**Fase 2: CRM comercial.** Construída e testada no ramo `claude/fase2-crm`. Falta o CI completo nas duas arquiteturas e a sua revisão. A Fase 1 está no `main`.

**Instalação:** a VPS foi inventariada em 12 de outubro. O endereço será `crm.wtatech.com.br`, direto no ambiente definitivo. Nada foi instalado ainda; o plano de instalação aguarda a sua aprovação.

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

13 de outubro de 2026, no ambiente de desenvolvimento, com as dependências exatas do CI.

| Conjunto | Onde | Resultado |
| --- | --- | --- |
| Banco | PostgreSQL 16 | 330 verificações aprovadas |
| API (domínio e integração) | Node 24, PostgreSQL 16 | 137 de 137 |
| Ponta a ponta | Chromium, API e interface compiladas | 19 de 19, com axe em cada tela |
| CI completo (PostgreSQL 18, stack amd64 e arm64) | GitHub Actions | Em execução; resultado será registrado aqui |

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

Nenhuma. O inventário da VPS foi só leitura. Nada foi instalado.

## Riscos

- **Repositório público.** Recomendação: torná-lo privado. Nenhum segredo foi gravado nele.
- **Cópias do banco e arquivos só na VPS** até haver destino externo.
- **VPS sem swap** e com muitos serviços em imagens `latest`, que podem mudar sozinhas numa reinicialização. Não é do CRM, mas afeta a máquina toda.

## Próximas ações

1. CI completo nas duas arquiteturas; abrir a revisão da Fase 2 para mesclar no `main`.
2. Instalar em `crm.wtatech.com.br`, depois da sua aprovação do plano.
3. Fase 3: API pública com chaves, webhooks, eventos, filas com Redis e integração com o n8n.

## Aprovações pendentes

- Plano de instalação em `crm.wtatech.com.br`.
- ADR 021: consultas em SQL, sem ORM.
- Usar o MinIO da VPS para os arquivos, ou manter o volume da stack (ADR 023).
- Matriz de permissões.
- Tornar o repositório privado.
