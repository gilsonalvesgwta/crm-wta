#!/usr/bin/env bash
# Cria, uma única vez, os segredos da stack no Docker Swarm. Rode na VPS (manager).
# Segredo que já existe não é alterado. Nenhum valor é mostrado na tela, exceto a
# senha inicial do superadministrador, que deve ser trocada no primeiro acesso.
set -euo pipefail

criar() {
  local nome="$1" valor="$2"
  if docker secret inspect "$nome" >/dev/null 2>&1; then
    echo "já existe: $nome"
  else
    printf '%s' "$valor" | docker secret create "$nome" - >/dev/null
    echo "criado: $nome"
  fi
}

criar crmwta_db_password "$(openssl rand -hex 24)"
criar crmwta_api_db_password "$(openssl rand -hex 24)"
if ! docker secret inspect crmwta_master_keys >/dev/null 2>&1; then
  chave="1:$(openssl rand -base64 32)"
  criar crmwta_master_keys "$chave"
  echo
  echo "Chave mestra (guarde FORA da VPS, num cofre de senhas): $chave"
  echo "Sem ela, as credenciais de integração de um backup restaurado ficam ilegíveis."
  echo
else
  echo "já existe: crmwta_master_keys"
fi
criar crmwta_smtp_pass "${SMTP_PASS:-nao-configurado}"
if ! docker secret inspect crmwta_bootstrap_password >/dev/null 2>&1; then
  inicial="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  criar crmwta_bootstrap_password "$inicial"
  echo
  echo "Senha inicial do superadministrador: $inicial"
  echo "Anote agora. Ela não será mostrada de novo."
fi
