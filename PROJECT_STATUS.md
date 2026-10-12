# Situação do projeto

Atualizado em 11 de outubro de 2026.

## Fase atual

**Fase 1: Fundação**, em andamento. A Fase 0 (diagnóstico e plano) foi entregue e a stack e a arquitetura foram aprovadas em 11 de outubro de 2026.

## Concluído, com teste

| Item | Evidência |
| --- | --- |
| Base do banco: papéis, contexto de empresa, 17 tabelas de plataforma, identidade e acesso, RLS forçado, funções de sessão | `packages/db/migrations/0001_fundacao.sql`; 135 verificações aprovadas no PostgreSQL 16.15 local; 12 testes de mutação pegos (ver `docs/TEST_PLAN.md`) |
| Aplicador de migrações com checksum e transação por arquivo | `packages/db/migrate.sh`; os testes conferem que reaplicar não muda nada |
| Direção visual aprovada (prévia de quatro telas, temas claro, escuro e de outra empresa) | Aprovada pelo responsável em 11 de outubro de 2026 |
| Logo da WTA vetorizado: logo completo para fundo escuro e claro, marca, ícone e favicon | `packages/ui/brand/wta`; conferido lado a lado com o original |

## Em desenvolvimento

| Item | Situação |
| --- | --- |
| API (NestJS), interface (Next.js), worker | Não iniciados |

## Testes executados

| Data | Onde | O quê | Resultado |
| --- | --- | --- | --- |
| 2026-10-11 | PostgreSQL 16.15 local | `packages/db/tests/run.sh` | 135 verificações aprovadas |
| 2026-10-11 | PostgreSQL 16.15 local | 12 testes de mutação | Os 12 pegos |
| 2026-10-11 | GitHub Actions, PostgreSQL 16 e 18 | `packages/db/tests/run.sh` | Aprovado nas duas versões (execução 38193562249) |

## Bugs conhecidos

Nenhum.

## Pendências

- API, interface e worker da Fase 1.
- Matriz de permissões em código e testes gerados dela.
- Stack de implantação, backup e restauração.
- Criação mensal das partições de log pelo worker (até lá, manual; ver `docs/OPERATIONS.md`).

## Dependências externas

| Item | De quem |
| --- | --- |
| Revisão da matriz de permissões | Responsável pelo produto |
| Saída do inventário da VPS | Responsável pelo produto |
| Endereço e chave da Evolution API, número de teste | Fase 4 |
| Provedor de e-mail da WTA e caixa de teste | Fase 5 |
| Aplicativo na Meta e verificação da empresa | Fase 6 |

## Mudanças de infraestrutura

Nenhuma. Nada foi instalado ou alterado em servidor algum.

## Riscos

Os doze riscos da Fase 0 seguem válidos. Os que pedem atenção agora:

- **Ambiente de desenvolvimento sem acesso ao registro npm.** Instalar, compilar e testar a parte em TypeScript depende do GitHub Actions.
- **Repositório público.** O código de um produto comercial está visível para qualquer pessoa. Recomendação: torná-lo privado. Nenhum segredo foi ou será gravado nele.
- **Capacidade da VPS desconhecida** até o inventário.

## Próximas ações

1. Criar a estrutura da API e da interface, com instalação e testes no CI.
2. Implementar login, sessão, 2FA e seleção de empresa sobre as funções do banco.
3. Aplicar o design system aprovado nas telas da Fase 1.

## Aprovações pendentes

- Matriz de permissões.
- Onde instalar (depois do inventário) e endereços de produção e homologação.
- Tornar o repositório privado.
