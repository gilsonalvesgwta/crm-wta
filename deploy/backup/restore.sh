#!/bin/sh
# Restaura uma cópia em um banco. Uso:
#   restore.sh <arquivo.dump> <banco de destino>
# O banco de destino precisa existir e estar vazio. Restaurar por cima do banco
# em uso é uma operação manual, feita com a stack parada e com aprovação.
set -eu
arquivo="$1"
destino="$2"
pg_restore --list "$arquivo" > /dev/null
existe=$(psql -X -At -d "$destino" -c "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$existe" != "0" ]; then
  echo "ERRO: o banco $destino não está vazio. Use um banco novo." >&2
  exit 1
fi
# Os papéis valem para o servidor inteiro. Num servidor novo eles ainda não existem.
psql -X -q -v ON_ERROR_STOP=1 -d "$destino" <<'SQL'
do $$
declare r text;
begin
  foreach r in array array['crm_owner', 'crm_app', 'crm_dispatch', 'crm_platform', 'crm_backup'] loop
    if not exists (select from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$$;
SQL
pg_restore --exit-on-error --no-owner --dbname="$destino" "$arquivo"
echo "restaurado em $destino: $(psql -X -At -d "$destino" -c 'select count(*) from ctl.migrations') migrações, $(psql -X -At -d "$destino" -c 'select count(*) from tenants') empresas"
