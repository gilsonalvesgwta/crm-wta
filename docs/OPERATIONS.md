# Operação

Rotinas que já existem. Implantação em [`DEPLOYMENT.md`](DEPLOYMENT.md); cópia e restauração em [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).

## Aplicar migrações

```bash
DATABASE_URL=postgres://<superusuário>:<senha>@<host>:5432/<banco do CRM> packages/db/migrate.sh
```

- Uma transação por arquivo. Se um arquivo falhar, nada dele fica aplicado e os seguintes não rodam.
- O controle fica em `ctl.migrations`, com o checksum de cada arquivo. Arquivo já aplicado que mudou faz o script parar.
- Migração nunca é editada depois de aplicada em qualquer ambiente compartilhado. Correção vai em migração nova.

## Rodar os testes de banco

```bash
ADMIN_URL=postgres://<superusuário>:<senha>@<host>:5432/postgres packages/db/tests/run.sh
```

O script cria e apaga um banco temporário. Os papéis `crm_*` são do servidor inteiro e ficam criados depois do primeiro teste.

## Partições de log

`auth_events` e `audit_log` são particionadas por mês. A primeira migração cria o mês corrente e os dois seguintes. A criação mensal dos próximos meses passa a ser feita pelo worker na Fase 3; até lá, rodar como dono do banco:

```sql
set role crm_owner;
select app.ensure_month_partitions('audit_log', current_date, 3);
select app.ensure_month_partitions('auth_events', current_date, 3);
```

Linha com data sem partição é recusada, não perdida.

## Inventário da VPS

`deploy/inventario.sh`, só leitura. Ver [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Primeira configuração

Feita pelo serviço `migrate` quando `BOOTSTRAP_EMAIL` está definido na stack: cria a empresa WTA, os perfis padrão e o superadministrador, com a senha do segredo `crmwta_bootstrap_password`. Rodar de novo não duplica nada e não troca senha. Depois do primeiro acesso, apague `BOOTSTRAP_EMAIL` das variáveis da stack.

Fora da stack: `ADMIN_DATABASE_URL=... BOOTSTRAP_EMAIL=... BOOTSTRAP_PASSWORD=... node apps/api/dist/cli/bootstrap.js`.

## Saúde

- `GET /api/healthz`: o processo está no ar.
- `GET /api/readyz`: o processo e o banco estão no ar.
- As imagens têm verificação de saúde; o Swarm reinicia o contêiner que falhar e volta a versão anterior se a nova não ficar saudável.

## Desenvolvimento local

```bash
pnpm install
DATABASE_URL=postgres://postgres:senha@localhost:5432/crm API_DB_PASSWORD=dev packages/db/migrate.sh
ADMIN_DATABASE_URL=postgres://postgres:senha@localhost:5432/crm BOOTSTRAP_EMAIL=voce@wta.com.br BOOTSTRAP_PASSWORD='uma senha longa' pnpm --filter @crm/api build && node apps/api/dist/cli/bootstrap.js
DATABASE_URL=postgres://crm_api:dev@localhost:5432/crm APP_URL=http://localhost:3000 MASTER_KEYS="1:$(openssl rand -base64 32)" COOKIE_SECURE=false node apps/api/dist/main.js
pnpm --filter @crm/web dev
```
