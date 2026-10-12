#!/usr/bin/env bash
# Publica uma pasta de saída do CI no ramo ci-saida, em saida/<destino>/.
# Os registros do Actions não são legíveis pelo ambiente de desenvolvimento.
# Uso: publicar-saida.sh <pasta> <destino>
set -uo pipefail
origem="$1"; destino="$2"
dir=$(mktemp -d)
git config --global user.name "ci"
git config --global user.email "ci@users.noreply.github.com"
url="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
for attempt in 1 2 3 4 5 6; do
  rm -rf "$dir/r"
  if ! git clone -q --depth 1 --branch ci-saida "$url" "$dir/r" 2>/dev/null; then
    git init -q "$dir/r" && git -C "$dir/r" checkout -q -b ci-saida
  fi
  rm -rf "$dir/r/saida/$destino" && mkdir -p "$dir/r/saida/$destino"
  cp -r "$origem"/. "$dir/r/saida/$destino/"
  git -C "$dir/r" add -A
  git -C "$dir/r" commit -q -m "saida $destino $GITHUB_RUN_ID" || exit 0
  if git -C "$dir/r" push -q "$url" HEAD:ci-saida; then exit 0; fi
  sleep $((attempt * 4))
done
exit 1
