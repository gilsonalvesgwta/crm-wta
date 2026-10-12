#!/usr/bin/env bash
# Teste da stack de produção num Docker Swarm descartável (usado no CI):
# um Traefik de teste na frente, a stack inteira, e a conferência de saúde,
# login, sem portas abertas, cópia e restauração.
#
# Uso: IMAGEM_API=... IMAGEM_WEB=... deploy/teste-stack.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${IMAGEM_API:?}" "${IMAGEM_WEB:?}"
DOM=crm.teste.localhost
REDE=traefik-teste
SENHA_INICIAL='senha inicial do teste 2026'

docker swarm init >/dev/null 2>&1 || true
docker network create --driver overlay --attachable "$REDE" >/dev/null 2>&1 || true

printf '%s' "$(openssl rand -hex 24)" | docker secret create crmwta_db_password - >/dev/null
printf '%s' "$(openssl rand -hex 24)" | docker secret create crmwta_api_db_password - >/dev/null
printf '%s' "1:$(openssl rand -base64 32)" | docker secret create crmwta_master_keys - >/dev/null
printf '%s' "nao-configurado" | docker secret create crmwta_smtp_pass - >/dev/null
printf '%s' "$SENHA_INICIAL" | docker secret create crmwta_bootstrap_password - >/dev/null

# Traefik igual ao da VPS (Swarm, entrada websecure, resolvedor letsencryptresolver),
# mas com uma autoridade de certificação inexistente: vale o certificado padrão.
docker service create --name traefik-teste --network "$REDE" --publish 443:443 \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly \
  traefik:v3.5 \
  --providers.swarm=true --providers.swarm.exposedbydefault=false \
  --entrypoints.websecure.address=:443 \
  --certificatesresolvers.letsencryptresolver.acme.email=teste@example.com \
  --certificatesresolvers.letsencryptresolver.acme.storage=/tmp/acme.json \
  --certificatesresolvers.letsencryptresolver.acme.caserver=https://127.0.0.1:1/dir \
  --certificatesresolvers.letsencryptresolver.acme.tlschallenge=true >/dev/null

DOMINIO=$DOM REDE_TRAEFIK=$REDE IMAGEM_API=$IMAGEM_API IMAGEM_WEB=$IMAGEM_WEB \
BOOTSTRAP_EMAIL=dono@wta.test BOOTSTRAP_NAME='Dono do Teste' \
  docker stack deploy --detach=true -c stack.yml crmwta

echo "aguardando os serviços..."
for i in $(seq 1 90); do
  if curl -fsSk --resolve "$DOM:443:127.0.0.1" "https://$DOM/api/readyz" >/dev/null 2>&1 \
     && curl -fsSk --resolve "$DOM:443:127.0.0.1" -o /dev/null "https://$DOM/entrar"; then
    break
  fi
  sleep 3
done
docker service ls --format '{{.Name}} {{.Replicas}}' | sort

falhou=0
ok() { echo "OK   $1"; }
erro() { echo "ERRO $1"; falhou=1; }
c() { curl -sSk --resolve "$DOM:443:127.0.0.1" "$@"; }

[ "$(c -o /dev/null -w '%{http_code}' "https://$DOM/api/readyz")" = 200 ] && ok "API pronta atrás do Traefik" || erro "API pronta"
[ "$(c -o /dev/null -w '%{http_code}' "https://$DOM/entrar")" = 200 ] && ok "interface responde" || erro "interface"

cookie=$(mktemp)
code=$(c -c "$cookie" -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -H 'x-crm-request: 1' \
  -d "{\"email\":\"dono@wta.test\",\"password\":\"$SENHA_INICIAL\"}" "https://$DOM/api/v1/auth/login")
[ "$code" = 200 ] && ok "login do superadministrador criado na configuração inicial" || erro "login ($code)"
grep -q crm_session "$cookie" && ok "cookie de sessão" || erro "cookie"
grep -E 'crm_session' "$cookie" | grep -q TRUE && ok "cookie marcado como Secure" || erro "cookie sem Secure"
me=$(c -b "$cookie" "https://$DOM/api/v1/auth/me")
echo "$me" | grep -q '"isPlatformAdmin":true' && ok "sessão válida pela interface pública" || erro "me: $me"
[ "$(c -o /dev/null -w '%{http_code}' -b "$cookie" "https://$DOM/inicio")" = 200 ] && ok "página interna renderiza" || erro "página interna"

# Nenhuma porta da stack publicada no host.
pub=$(docker service ls --filter label=com.docker.stack.namespace=crmwta --format '{{.Ports}}' | tr -d ' ')
[ -z "$pub" ] && ok "nenhuma porta da stack publicada" || erro "portas publicadas: $pub"

# Rodar a stack de novo não muda nada (configuração inicial idempotente).
DOMINIO=$DOM REDE_TRAEFIK=$REDE IMAGEM_API=$IMAGEM_API IMAGEM_WEB=$IMAGEM_WEB \
BOOTSTRAP_EMAIL=dono@wta.test BOOTSTRAP_NAME='Dono do Teste' \
  docker stack deploy --detach=true -c stack.yml crmwta >/dev/null
sleep 5

# Cópia e restauração.
bk=$(docker ps -q -f name=crmwta_backup | head -n1)
db=$(docker ps -q -f name=crmwta_db | head -n1)
if docker exec -e PGHOST=db -e PGDATABASE=crm -e PGUSER=postgres -e PGPASSWORD_FILE=/run/secrets/crmwta_db_password "$bk" \
     sh -c 'export PGPASSWORD=$(cat $PGPASSWORD_FILE); /app/backup/backup-now.sh'; then
  ok "cópia do banco"
else
  erro "cópia do banco"
fi
arquivo=$(docker exec "$bk" sh -c 'ls -1 /backups/crm-*.dump | tail -n1')
docker exec "$db" sh -c 'createdb -U postgres crm_restaurado'
if docker exec "$bk" sh -c "export PGPASSWORD=\$(cat /run/secrets/crmwta_db_password); PGHOST=db PGUSER=postgres /app/backup/restore.sh $arquivo crm_restaurado"; then
  ok "restauração em banco novo"
else
  erro "restauração"
fi
n=$(docker exec "$db" psql -U postgres -d crm_restaurado -At -c "select count(*) from users where email = 'dono@wta.test'")
[ "$n" = 1 ] && ok "dados conferidos depois de restaurar" || erro "dados restaurados ($n)"
docker exec "$bk" sh -c "export PGPASSWORD=\$(cat /run/secrets/crmwta_db_password); PGHOST=db PGUSER=postgres /app/backup/restore.sh $arquivo crm_restaurado" >/dev/null 2>&1 \
  && erro "restaurar por cima de banco com dados deveria ser recusado" || ok "restauração recusa banco com dados"

docker service ls --format '{{.Name}} {{.Replicas}}' | sort
docker service logs --tail 30 crmwta_migrate 2>&1 | sed 's/^/migrate| /' | tail -n 15
exit $falhou
