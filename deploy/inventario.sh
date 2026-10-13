#!/usr/bin/env bash
# Inventário da VPS. Só leitura: nenhum comando altera a máquina.
#
# Rode como root (sudo) e envie a saída. O script não mostra variáveis de
# ambiente, segredos, arquivos de stack nem o conteúdo dos agendamentos.

echo "== Sistema"; . /etc/os-release; echo "$PRETTY_NAME"; uname -r
echo "== Recursos"; nproc; free -h; df -h -x tmpfs -x overlay
echo "== Docker"; docker version --format 'servidor {{.Server.Version}}'
docker info --format 'swarm={{.Swarm.LocalNodeState}} nos={{.Swarm.Nodes}}'
echo "== Stacks"; docker stack ls
echo "== Servicos"; docker service ls --format 'table {{.Name}}\t{{.Replicas}}\t{{.Image}}\t{{.Ports}}'
echo "== Conteineres"; docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
echo "== Redes"; docker network ls --format 'table {{.Name}}\t{{.Driver}}\t{{.Scope}}'
echo "== Volumes"; docker volume ls --format '{{.Name}}'
echo "== Uso do Docker"; docker system df
echo "== Consumo"; docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
echo "== Portas"; ss -tlnH | awk '{print $4}' | sort -u
echo "== Firewall"; ufw status 2>/dev/null || echo "ufw ausente"
echo "== Agendamentos"; ls /etc/cron.d 2>/dev/null; echo "linhas no crontab do root: $(crontab -l 2>/dev/null | grep -cv '^#')"
echo "== Traefik (só entradas e resolvedores de certificado)"
for s in $(docker service ls --format '{{.Name}} {{.Image}}' | awk '$2 ~ /traefik/ {print $1}'); do
  echo "servico: $s"
  docker service inspect "$s" --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}' 2>/dev/null \
    | tr ',' '\n' | grep -oE -- '--(entrypoints\.[a-z0-9_-]+\.address|certificatesresolvers\.[a-z0-9_-]+\.acme\.(tlschallenge|httpchallenge|dnschallenge)|providers\.(docker|swarm)\.(network|endpoint|swarmMode|exposedbydefault))[^"]*'
  docker service inspect "$s" --format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}' 2>/dev/null \
    | xargs -r -n1 docker network inspect --format 'rede: {{.Name}}' 2>/dev/null
done
