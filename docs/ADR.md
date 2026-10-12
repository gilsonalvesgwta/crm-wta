# Registro de decisões de arquitetura

Todas as decisões abaixo foram aprovadas pelo responsável pelo produto em 11 de outubro de 2026, junto com o relatório da Fase 0. Decisão nova entra no fim, com data, contexto, escolha e alternativa descartada.

| ADR | Decisão | Motivo | Alternativa descartada |
| --- | --- | --- | --- |
| 001 | Monólito modular com três processos (`web`, `api`, `worker`) em um repositório pnpm | Um código, um banco, uma implantação; o worker separa o que não pode depender do navegador | Microsserviços: custo operacional sem ganho em uma VPS |
| 002 | Next.js 16 para a interface e NestJS 12 sobre Fastify para a API, com OpenAPI gerado do código | Fronteiras de módulo, guardas de permissão e um só contrato para interface, n8n e terceiros | API dentro do Next.js: mistura interface com webhooks, filas e conexões longas |
| 003 | Node.js 24 LTS | Suporte de segurança até abril de 2028 | Node 22, já em manutenção |
| 004 | PostgreSQL 18 dedicado | Suporte até novembro de 2030; RLS, JSONB e busca textual nativos | Supabase da VPS, compartilhado com outros projetos |
| 005 | Multiempresa por `tenant_id` com RLS forçado e chaves estrangeiras compostas | Isolamento garantido pelo banco; uma migração serve a todos | Um esquema ou um banco por empresa |
| 006 | Migrações em SQL versionado e revisado; Drizzle ORM para as consultas | As políticas RLS ficam explícitas e testáveis em SQL puro | Prisma: RLS exige contornos em toda consulta |
| 007 | Redis com BullMQ como transporte; o banco é a fonte da verdade dos agendamentos | Atrasos, limites por conta e retentativas prontos; se o Redis perder dados, o reconciliador recria os jobs | Fila em memória ou cron no contêiner |
| 008 | Outbox transacional para todo evento externo | O registro e o evento são gravados juntos | Publicar na fila depois de salvar |
| 009 | SSE para tempo real | A caixa de entrada só recebe; passa pelo Traefik sem ajuste | WebSocket, por enquanto |
| 010 | Autenticação própria: Argon2id, sessão no servidor em cookie `httpOnly`, TOTP | Peça pequena e auditável, sem acoplar o modelo de empresas a um serviço externo | Keycloak (pesado) e GoTrue (não conhece empresas nem papéis) |
| 011 | Um conector por provedor de canal, com capacidades declaradas | Cada canal tem regras próprias; o núcleo não conhece nenhum | Tabela genérica com campos por provedor misturados |
| 012 | Armazenamento por API S3, provedor a definir | Troca de provedor sem tocar no CRM | MinIO novo: repositório arquivado em abril de 2026 |
| 013 | Stack própria em Docker Swarm atrás do Traefik existente, sem portas publicadas | Segue o padrão da VPS, a confirmar no inventário | Docker Compose solto |
| 014 | GitHub Actions como ambiente de instalação, compilação e teste | O ambiente das sessões de desenvolvimento não alcança o registro npm | Validar só por compilação local |

## Detalhes que as migrações já fixaram

- **Papéis do banco.** `crm_owner` é dono dos objetos e roda as funções de autenticação. `crm_app` é o papel da aplicação: sem `BYPASSRLS`, sem DDL. `crm_platform` administra empresas. `crm_dispatch` fica reservado para o despachante do outbox. `crm_backup` lê tudo para o `pg_dump`.
- **Contexto.** `app.tenant_id()` gera erro quando não há empresa definida. Uma consulta sem contexto falha em vez de devolver dados de todas as empresas.
- **Funções.** Função criada por `crm_owner` não é executável por todos; a permissão é dada pelo nome. Os testes conferem a lista fechada do que `crm_app` executa.
- **Compatibilidade.** As migrações rodam no PostgreSQL 16 ou superior, para que os testes de banco rodem também no ambiente de desenvolvimento.
