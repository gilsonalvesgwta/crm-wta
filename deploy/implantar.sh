#!/usr/bin/env bash
# Implanta ou atualiza a stack crmwta pela linha de comando da VPS (gerente do
# Swarm), lendo as variáveis de um arquivo. Usado quando o Portainer recusa a
# implantação (ver docs/TROUBLESHOOTING.md).
#
# Uso: sudo bash implantar.sh [arquivo de variáveis]   (padrão: /root/crmwta.env)
#
# O arquivo tem uma variável por linha, NOME=valor, sem aspas. Linhas vazias e
# iniciadas por # são ignoradas. Para mudar algo (a senha do e-mail, a versão),
# edite o arquivo e rode este script de novo: só os serviços afetados reiniciam.
set -euo pipefail

ENV_FILE="${1:-/root/crmwta.env}"
STACK_URL="${STACK_URL:-https://raw.githubusercontent.com/gilsonalvesgwta/crm-wta/main/deploy/stack.yml}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de variáveis não encontrado: $ENV_FILE" >&2
  exit 1
fi
chmod 600 "$ENV_FILE"

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  key="${key//[[:space:]]/}"
  if [[ ! "$key" =~ ^[A-Z_][A-Z0-9_]*$ || "$line" != *=* ]]; then
    echo "Linha inválida no arquivo de variáveis: $key" >&2
    exit 1
  fi
  export "$key=$value"
done < "$ENV_FILE"

for v in DOMINIO REDE_TRAEFIK IMAGEM_API IMAGEM_WEB; do
  if [[ -z "${!v:-}" ]]; then
    echo "Falta a variável $v em $ENV_FILE" >&2
    exit 1
  fi
done

net_scope="$(docker network inspect "$REDE_TRAEFIK" --format '{{.Scope}}' 2>/dev/null || true)"
if [[ "$net_scope" != "swarm" ]]; then
  echo "A rede $REDE_TRAEFIK não existe ou não é do Swarm (escopo: ${net_scope:-nenhum})." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$STACK_URL" -o "$tmp/stack.yml"

docker stack deploy --with-registry-auth --detach=true -c "$tmp/stack.yml" crmwta
echo
echo "Implantação enviada. Acompanhe com: sudo docker stack services crmwta"
