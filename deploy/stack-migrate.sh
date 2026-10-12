#!/bin/sh
# Serviço "migrate" da stack: aplica migrações, prepara o papel crm_api e, se
# BOOTSTRAP_EMAIL estiver definido, faz a configuração inicial (idempotente).
set -eu
DBPASS=$(cat /run/secrets/crmwta_db_password)
export DATABASE_URL="postgres://postgres:${DBPASS}@db:5432/crm"
export API_DB_PASSWORD=$(cat /run/secrets/crmwta_api_db_password)

for i in $(seq 1 30); do
  pg_isready -d "$DATABASE_URL" >/dev/null 2>&1 && break
  echo "aguardando o banco..."; sleep 2
done

/app/db/migrate.sh

if [ -n "${BOOTSTRAP_EMAIL:-}" ]; then
  ADMIN_DATABASE_URL="$DATABASE_URL" BOOTSTRAP_PASSWORD="$(cat /run/secrets/crmwta_bootstrap_password)" \
    node /app/dist/cli/bootstrap.js
fi
echo "migrate: concluído"
