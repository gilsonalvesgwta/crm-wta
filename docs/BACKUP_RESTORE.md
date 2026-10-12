# Backup e restauração

A cópia diária e a restauração estão implementadas (`deploy/backup`) e são testadas a cada envio no CI, dentro da stack. Falta o destino fora da VPS e o ensaio cronometrado (Fase 8).

## Como funciona

- O serviço `backup` da stack faz uma cópia por dia às 03:30 (`BACKUP_HORA`), com `pg_dump` em formato custom.
- A cópia só é aceita depois de `pg_restore --list` lê-la inteira; até lá ela fica como arquivo parcial.
- Retenção: as 7 mais recentes, 4 de domingo e 6 de dia 1.
- Cópia manual: `docker exec <contêiner do backup> sh -c 'export PGPASSWORD=$(cat $PGPASSWORD_FILE); /app/backup/backup-now.sh'`.
- Restauração: `deploy/backup/restore.sh <arquivo> <banco novo>`. Recusa banco que já tenha dados. Restaurar por cima do banco em uso é operação manual, com a stack parada e aprovação.

## Proposta

| Item | Proposta |
| --- | --- |
| Banco, início | `pg_dump` diário em formato custom, pelo papel `crm_backup`, cifrado antes de sair da máquina. RPO de 24 horas |
| Banco, antes do primeiro cliente pagante | Arquivamento contínuo de WAL. RPO de até 15 minutos |
| Arquivos | Versionamento no bucket; se ficarem na VPS, sincronização diária para fora |
| Retenção | 7 cópias diárias, 4 semanais e 6 mensais |
| Chave mestra | Guardada pelo responsável fora da VPS. Sem ela, as credenciais das integrações no backup são ilegíveis |
| Teste | Toda semana um job restaura a última cópia em banco descartável e confere contagens e migrações; falha gera alerta |
| RTO | Meta de 2 horas. Só vira número real depois do ensaio cronometrado |

## Regras

- Um backup só conta como válido depois de restaurado e conferido. Comando que terminou sem erro não basta.
- A restauração é ensaiada em homologação antes da primeira produção.
- Limite declarado: com uma única VPS não há réplica. O que for criado depois do último backup ou do último WAL arquivado se perde em uma falha total.

## Pendências

- Destino das cópias fora da VPS. Até ele existir, uma falha de disco da VPS leva as cópias junto.
- Ferramenta de arquivamento de WAL, a escolher na Fase 8 conforme o destino.
