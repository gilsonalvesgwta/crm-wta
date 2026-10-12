#!/usr/bin/env bash
# Inventário da VPS. Só leitura: nenhum comando altera a máquina.
#
# Rode como root e envie a saída. Antes de enviar, releia o trecho de
# agendamentos, que pode conter senha em linha de comando.
# Não envie a saída de "docker service inspect", variáveis de ambiente nem
# arquivos de stack.

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
echo "== Agendamentos"; ls /etc/cron.d 2>/dev/null; crontab -l 2>/dev/null | grep -v '^#'
