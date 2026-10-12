# CRM WTA

CRM multiempresa e white-label da WTA Gestão e Automações: vendas, atendimento omnichannel, agendamentos e automações em uma única plataforma.

O projeto está na **Fase 1 (Fundação)**. O que já funciona, o que falta e o que foi testado estão em [`PROJECT_STATUS.md`](PROJECT_STATUS.md). Nada aqui deve ser lido como pronto sem conferir esse arquivo.

## Estrutura

```
apps/
  web/        interface Next.js            (ainda não criada)
  api/        API NestJS                   (ainda não criada)
  worker/     processadores de fila        (ainda não criado)
packages/
  db/         migrações SQL, políticas RLS e testes de banco
  contracts/  esquemas e tipos compartilhados (ainda não criado)
  ui/         design system                (ainda não criado)
deploy/       inventário da VPS; stack, backup e restauração virão aqui
docs/         arquitetura, decisões, dados, permissões, integrações, operação
```

## Banco de dados

As migrações são arquivos SQL em `packages/db/migrations`, aplicados em ordem por `packages/db/migrate.sh`. Precisam de PostgreSQL 16 ou superior e de uma conexão de superusuário ao banco dedicado do CRM, porque a primeira migração cria os papéis.

```bash
# aplicar migrações
DATABASE_URL=postgres://postgres:senha@localhost:5432/crm packages/db/migrate.sh

# rodar os testes de banco em um banco descartável
ADMIN_URL=postgres://postgres:senha@localhost:5432/postgres packages/db/tests/run.sh
```

Os testes criam um banco temporário, aplicam as migrações, conferem que aplicá-las de novo não muda nada e rodam os arquivos de `packages/db/tests`. Eles cobrem isolamento entre empresas, autenticação e regras de catálogo que toda tabela ou função nova precisa cumprir.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Requisitos consolidados e fase de cada um |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Processos, camadas, caixa de entrada, eventos e filas |
| [`docs/ADR.md`](docs/ADR.md) | Decisões de arquitetura |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Modelo de dados e estratégia multiempresa |
| [`docs/PERMISSIONS_MATRIX.md`](docs/PERMISSIONS_MATRIX.md) | Perfis, ações e alcances |
| [`docs/API.md`](docs/API.md) | Convenções da API e dos eventos |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | Evolution API, WhatsApp oficial, Instagram, e-mail, n8n |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Controles de segurança e privacidade |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Tokens, temas por empresa, estados de tela |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Inventário, topologia da stack, sequência e reversão |
| [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md) | Cópias, retenção e teste de restauração |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | Níveis de teste e onde cada um roda |
| [`docs/ACCEPTANCE_CRITERIA.md`](docs/ACCEPTANCE_CRITERIA.md) | Critérios de aceite por fase |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Rotinas de operação |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Problemas conhecidos e como resolver |

## Regras do projeto

- Nenhuma funcionalidade é marcada como concluída só porque os arquivos existem. Precisa de comportamento implementado e de teste passando no CI.
- Integração externa só é "validada" depois de teste com conta real. Antes disso é "implementada, aguardando teste real".
- Segredos nunca entram no repositório, em documentos ou em conversas. Entram como segredos do GitHub ou do Portainer.
- Nenhuma alteração na infraestrutura existente (Evolution API, n8n, Traefik, outros serviços) sem aprovação explícita do responsável pelo produto.
