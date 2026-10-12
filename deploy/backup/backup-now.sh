#!/bin/sh
# Faz uma cópia agora e aplica a retenção: 7 diárias, 4 semanais (domingo) e 6
# mensais (dia 1). Usa as variáveis PGHOST, PGDATABASE, PGUSER e PGPASSWORD.
set -eu
DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$DIR"
nome="crm-$(date +%Y%m%d-%H%M%S).dump"
tmp="$DIR/.$nome.parcial"
pg_dump --format=custom --compress=9 --no-owner --file="$tmp"
# Confere se o arquivo é uma cópia legível antes de aceitá-lo.
pg_restore --list "$tmp" > /dev/null
mv "$tmp" "$DIR/$nome"
echo "backup: $nome ($(du -h "$DIR/$nome" | cut -f1))"

# Retenção
manter=$(mktemp)
ls -1 "$DIR"/crm-*.dump 2>/dev/null | sort -r | head -n 7 >> "$manter"
for f in $(ls -1 "$DIR"/crm-*.dump 2>/dev/null | sort -r); do
  d=$(basename "$f" | sed -E 's/crm-([0-9]{8}).*/\1/')
  dia_semana=$(date -d "$d" +%u)
  dia_mes=$(date -d "$d" +%d)
  [ "$dia_semana" = 7 ] && echo "$f" >> "$manter.semanal"
  [ "$dia_mes" = 01 ] && echo "$f" >> "$manter.mensal"
done
[ -f "$manter.semanal" ] && sort -ru "$manter.semanal" | head -n 4 >> "$manter"
[ -f "$manter.mensal" ] && sort -ru "$manter.mensal" | head -n 6 >> "$manter"
for f in "$DIR"/crm-*.dump; do
  [ -e "$f" ] || continue
  grep -qxF "$f" "$manter" || { rm -f "$f"; echo "backup: removida $(basename "$f")"; }
done
rm -f "$manter" "$manter.semanal" "$manter.mensal"
