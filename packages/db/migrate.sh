#!/usr/bin/env bash
# Aplica as migrações pendentes, uma transação por arquivo.
#
# Uso: DATABASE_URL=postgres://... packages/db/migrate.sh
#
# A conexão precisa ser de superusuário do banco dedicado do CRM, porque a
# primeira migração cria os papéis. Migração já aplicada não pode mudar: o
# script confere o checksum e para se encontrar diferença.
set -euo pipefail

: "${DATABASE_URL:?defina DATABASE_URL}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/migrations"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" <<'SQL'
create schema if not exists ctl;
create table if not exists ctl.migrations (
  name        text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);
SQL

applied=0
shopt -s nullglob
for file in "$DIR"/*.sql; do
  name="$(basename "$file" .sql)"
  sum="$(sha256sum "$file" | cut -d' ' -f1)"
  known="$("${PSQL[@]}" -At -v name="$name" <<'SQL'
select checksum from ctl.migrations where name = :'name';
SQL
)"

  if [[ -n "$known" ]]; then
    if [[ "$known" != "$sum" ]]; then
      echo "ERRO: a migração $name já foi aplicada e o arquivo mudou." >&2
      exit 1
    fi
    continue
  fi

  echo "aplicando $name"
  "${PSQL[@]}" -v name="$name" -v sum="$sum" -v file="$file" <<'SQL'
begin;
\i :file
reset role;
insert into ctl.migrations (name, checksum) values (:'name', :'sum');
commit;
SQL
  applied=$((applied + 1))
done

echo "migrações aplicadas agora: $applied"
