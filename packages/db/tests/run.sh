#!/usr/bin/env bash
# Cria um banco descartável, aplica as migrações e roda os testes SQL.
#
# Uso: ADMIN_URL=postgres://postgres@host:5432/postgres packages/db/tests/run.sh
#
# ADMIN_URL é uma conexão de superusuário ao banco de manutenção. O banco de
# teste é criado e apagado por este script.
set -euo pipefail

: "${ADMIN_URL:?defina ADMIN_URL}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="crm_teste_$$_$RANDOM"
ADMIN=(psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1)

# Troca só o nome do banco na URL, preservando parâmetros depois de "?".
base="${ADMIN_URL%%\?*}"
query=""
[[ "$ADMIN_URL" == *\?* ]] && query="?${ADMIN_URL#*\?}"
TEST_URL="${base%/*}/${DB}${query}"

cleanup() {
  "${ADMIN[@]}" -c "drop database if exists \"$DB\" with (force)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${ADMIN[@]}" -c "create database \"$DB\""
echo "banco de teste: $DB ($("${ADMIN[@]}" -Atc 'show server_version'))"

DATABASE_URL="$TEST_URL" "$HERE/../migrate.sh"

again="$(DATABASE_URL="$TEST_URL" "$HERE/../migrate.sh" | tail -1)"
if [[ "$again" != "migrações aplicadas agora: 0" ]]; then
  echo "ERRO: rodar as migrações de novo deveria não aplicar nada. Saída: $again" >&2
  exit 1
fi

for file in "$HERE"/[0-9]*.sql; do
  echo "== $(basename "$file")"
  psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1 -f "$file" >/dev/null
done

total="$(psql "$TEST_URL" -X -At -c 'select count(*) from t.results')"
echo "verificações aprovadas: $total"
