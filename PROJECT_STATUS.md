# Situação do projeto

Atualizado em 12 de outubro de 2026.

## Fase atual

**Fase 1: Fundação.** Construída e testada no CI. Falta a instalação numa VPS, que depende do inventário e da sua aprovação, e os itens listados em Pendências.

## Concluído, com teste

| Item | Evidência |
| --- | --- |
| Banco: papéis, contexto de empresa, 18 tabelas com RLS forçado, funções de autenticação, nomes únicos | Migrações `0001` a `0003`; 180 verificações de banco no PostgreSQL 16 e 18; 12 testes de mutação pegos |
| Login, sessão no servidor, sair, "manter conectado", cookie `httpOnly`/`Secure`/`SameSite=Lax` | Testes de integração e de ponta a ponta |
| Bloqueio progressivo de login (por e-mail e por IP), contado no banco | Testes de integração |
| Proteção contra CSRF (cabeçalho obrigatório em mutações) | Teste de integração |
| Nova senha por link (1 hora, uso único, encerra as sessões) | Integração e ponta a ponta, com o e-mail lido de verdade |
| Troca de senha com a atual; regra de senha (10 caracteres, comuns e e-mail recusados) | Integração |
| Verificação em duas etapas (TOTP) com códigos de recuperação; obrigatória nas áreas administrativas; administrador não desliga | Vetores oficiais das RFC 4226 e 6238; integração; ponta a ponta |
| Sessões abertas: listar e encerrar as próprias | Integração e ponta a ponta |
| Convites: enviar, reenviar, cancelar, aceitar (conta nova ou existente) | Integração e ponta a ponta |
| Várias empresas por pessoa, com escolha da empresa | Integração |
| Matriz de permissões em código, oito perfis padrão, perfis personalizados com alcance | Testes de domínio e de integração |
| Usuários: perfis, desativar e reativar; a empresa nunca fica sem administrador | Integração e ponta a ponta |
| Equipes com líderes | Integração e ponta a ponta |
| Dados da empresa (nome, fuso, idioma) | Integração |
| Identidade visual por empresa: cor com contraste calculado, tema claro ou escuro, nome do produto, aplicada no primeiro HTML | Domínio (todas as cores), integração e ponta a ponta |
| Auditoria só de inserção, com tela paginada e filtro | Integração e ponta a ponta |
| Plataforma: criar, suspender e reativar empresas, sem acesso aos dados delas | Integração e ponta a ponta |
| Isolamento entre empresas no banco e na API | Banco: catálogo e acesso cruzado. API: membro, equipe, perfil, convite e tema de outra empresa devolvem 404 ou nada |
| Interface: login, verificação, escolha de empresa, esqueci a senha, convite, início, conta e segurança, configurações, plataforma | 13 testes de ponta a ponta com verificação de acessibilidade (axe, WCAG 2.2 AA) |
| Marca WTA vetorizada: logo, ícone e favicon | `packages/ui/brand/wta` |
| Stack de produção: imagens, Docker Swarm, segredos, Traefik, cópia diária com retenção, restauração | `deploy/teste-stack.sh` no CI: saúde, login pelo Traefik, cookie Secure, nenhuma porta publicada, reimplantação idempotente, cópia e restauração conferidas |

## Testes executados

Ramo `claude/fase1-api`, 12 de outubro de 2026.

| Conjunto | Onde | Resultado |
| --- | --- | --- |
| Banco | PostgreSQL 16 e 18 | 180 verificações aprovadas em cada |
| API (domínio e integração) | Node 24, PostgreSQL 18 | 79 de 79 |
| Ponta a ponta | Chromium, API e interface compiladas | 13 de 13 |
| Stack | Docker Swarm com Traefik de teste | Todas as conferências aprovadas |
| Dependências | `pnpm audit --prod` | Nenhuma vulnerabilidade conhecida |

## Pendências da Fase 1

- **Limite de requisições geral** por IP e por usuário. O login já tem bloqueio; o restante entra com o Redis, na Fase 3.
- **Logotipo e favicon por empresa**: dependem do armazenamento de arquivos (Fase 2). Hoje a empresa personaliza nome e cores.
- **Tela de login com a marca da empresa pelo domínio próprio**: as telas internas já usam o tema; a de login ainda mostra a WTA.
- **Lint** no CI.

## Bugs conhecidos

Nenhum.

## Dependências externas

| Item | De quem |
| --- | --- |
| Saída do inventário da VPS | Responsável pelo produto |
| Revisão da matriz de permissões | Responsável pelo produto |
| Endereço do CRM e caixa de e-mail para os e-mails do sistema | Responsável pelo produto |
| Endereço e chave da Evolution API, número de teste | Fase 4 |
| Aplicativo na Meta e verificação da empresa | Fase 6 |

## Mudanças de infraestrutura

Nenhuma. Nada foi instalado em servidor algum.

## Riscos

- **Capacidade da VPS desconhecida** até o inventário. A stack pede até 3 GB de memória nos limites.
- **Repositório público.** Recomendação: torná-lo privado. Nenhum segredo foi gravado nele.
- **Cópias só na VPS** até haver destino externo.
- **Ambiente de desenvolvimento sem o registro npm.** Instalar, compilar e testar a parte em TypeScript depende do GitHub Actions.

## Próximas ações

1. Instalar em homologação, depois do inventário e da sua aprovação (`docs/DEPLOYMENT.md`).
2. Fase 2: contatos, empresas, leads, funis, negócios, tarefas, arquivos, importação e exportação.

## Aprovações pendentes

- Onde instalar e os endereços de produção e homologação.
- Matriz de permissões.
- Tornar o repositório privado.
