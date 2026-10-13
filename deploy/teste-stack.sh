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

# Traefik igual ao da VPS (inventário de 12 out 2026): v3.5, provedor "docker"
# lendo os rótulos dos contêineres, entradas web e websecure, resolvedor
# letsencryptresolver por desafio HTTP. A autoridade de certificação aponta para
# um endereço inexistente, então vale o certificado padrão.
docker service create --name traefik-teste --network "$REDE" --publish 443:443 --publish 80:80 \
  --constraint node.role==manager \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly \
  traefik:v3.5.3 \
  --providers.docker.endpoint=unix:///var/run/docker.sock \
  --providers.docker.exposedbydefault=false \
  --providers.docker.network="$REDE" \
  --entrypoints.web.address=:80 \
  --entrypoints.websecure.address=:443 \
  --certificatesresolvers.letsencryptresolver.acme.httpchallenge=true \
  --certificatesresolvers.letsencryptresolver.acme.httpchallenge.entrypoint=web \
  --certificatesresolvers.letsencryptresolver.acme.email=teste@example.com \
  --certificatesresolvers.letsencryptresolver.acme.storage=/tmp/acme.json \
  --certificatesresolvers.letsencryptresolver.acme.caserver=https://127.0.0.1:1/dir >/dev/null

DOMINIO=$DOM REDE_TRAEFIK=$REDE IMAGEM_API=$IMAGEM_API IMAGEM_WEB=$IMAGEM_WEB \
BOOTSTRAP_EMAIL=dono@wta.test BOOTSTRAP_NAME='Dono do Teste' \
  docker stack deploy --detach=true -c stack.yml crmwta 2>&1 | grep -v 'could not be accessed\|digest\|independently\|different nodes\|versions of the image' || true

echo "aguardando os serviços..."
for i in $(seq 1 90); do
  docker service logs crmwta_migrate 2>&1 | grep -q "migrate: concluído" && break
  sleep 3
done
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

# Arquivo enviado vai para o volume da stack e volta pelo endereço assinado.
cid=$(c -b "$cookie" -H 'content-type: application/json' -H 'x-crm-request: 1' -d '{"firstName":"Teste da stack"}' \
  "https://$DOM/api/v1/contacts" | jq -r .id)
printf '%%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%%%EOF\n' > /tmp/teste.pdf
fid=$(c -b "$cookie" -H 'x-crm-request: 1' -F "file=@/tmp/teste.pdf" "https://$DOM/api/v1/records/contact/$cid/files" | jq -r .id)
url=$(c -b "$cookie" "https://$DOM/api/v1/files/$fid/url" | jq -r .url)
c -o /tmp/baixado.pdf "https://$DOM$url"
cmp -s /tmp/teste.pdf /tmp/baixado.pdf && ok "arquivo gravado no volume e baixado pelo endereço assinado" || erro "arquivo (contato $cid, arquivo $fid)"

# Nenhuma porta da stack publicada no host.
pub=$(docker service ls --filter label=com.docker.stack.namespace=crmwta --format '{{.Ports}}' | tr -d ' ')
[ -z "$pub" ] && ok "nenhuma porta da stack publicada" || erro "portas publicadas: $pub"

# Rodar a stack de novo não muda nada (configuração inicial idempotente).
DOMINIO=$DOM REDE_TRAEFIK=$REDE IMAGEM_API=$IMAGEM_API IMAGEM_WEB=$IMAGEM_WEB \
BOOTSTRAP_EMAIL=dono@wta.test BOOTSTRAP_NAME='Dono do Teste' \
  docker stack deploy --detach=true -c stack.yml crmwta >/dev/null 2>&1
sleep 20
n=$(docker exec "$(docker ps -q -f name=crmwta_db | head -n1)" psql -U postgres -d crm -At -c "select count(*) from tenants")
[ "$n" = 1 ] && ok "reimplantar não duplica a configuração inicial" || erro "empresas depois de reimplantar: $n"

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
for s in db api web backup; do
  r=$(docker service ls --filter name=crmwta_$s --format '{{.Replicas}}')
  [ "$r" = 1/1 ] && ok "serviço $s em 1/1" || erro "serviço $s em $r"
done
docker service logs --tail 30 crmwta_migrate 2>&1 | sed 's/^/migrate| /' | tail -n 15
exit $falhou
