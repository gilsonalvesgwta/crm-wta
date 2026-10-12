#!/bin/sh
# Serviço "backup" da stack: uma cópia por dia, no horário BACKUP_HORA (HH:MM, fuso TZ).
set -eu
export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
HORA="${BACKUP_HORA:-03:30}"
echo "backup: cópia diária às $HORA ($TZ)"
while true; do
  agora=$(date +%s)
  alvo=$(date -d "today $HORA" +%s)
  [ "$alvo" -le "$agora" ] && alvo=$(date -d "tomorrow $HORA" +%s)
  sleep $((alvo - agora))
  /app/backup/backup-now.sh || echo "backup: FALHOU em $(date -Is)"
done
