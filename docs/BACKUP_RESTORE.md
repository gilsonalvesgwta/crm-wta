# Backup e restauração

Ainda não implementado. Este arquivo registra a proposta aprovada na Fase 0; os scripts entram em `deploy/` na Fase 1 e o ensaio cronometrado acontece na Fase 8.

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

- Destino das cópias fora da VPS.
- Ferramenta de arquivamento de WAL, a escolher na Fase 8 conforme o destino.
