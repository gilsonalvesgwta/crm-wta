# Operação

Rotinas que já existem. As de produção (implantação, backup, alertas, resposta a incidentes) entram aqui conforme forem implementadas.

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
