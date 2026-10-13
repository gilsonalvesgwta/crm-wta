# Problemas conhecidos

| Sintoma | Causa | O que fazer |
| --- | --- | --- |
| `contexto de empresa ausente (app.tenant_id)` | Consulta do papel `crm_app` sem empresa definida na transação | Abrir a transação com `set_config('app.tenant_id', <empresa>, true)`. É o comportamento esperado: sem contexto, nada é lido |
| `a migração X já foi aplicada e o arquivo mudou` | Um arquivo de migração foi editado depois de aplicado | Desfazer a edição e criar uma migração nova com a correção |
| `no partition of relation "audit_log" found for row` | Linha com data de um mês sem partição | Criar o mês com `app.ensure_month_partitions` (ver `OPERATIONS.md`) |
| `permission denied for function ...` no papel da aplicação | Função nova sem concessão explícita | Conceder `execute` só a quem precisa e incluir a função na lista de `03_catalogo.sql` |
| `a tabela audit_log só aceita inserção` | Tentativa de alterar ou apagar auditoria | Esperado. Retenção é feita descartando partições inteiras |

## "network ... is declared as external, but could not be found" ao implantar pelo Portainer

A rede do Traefik não existe no Swarm em que a stack está sendo implantada.

- Confira se o Portainer aberto é o da VPS certa. Em 13 de outubro de 2026 o erro apareceu porque a stack estava sendo criada no Portainer de outro servidor; no Portainer da VPS da WTA a implantação funcionou na primeira tentativa.
- Na VPS: `sudo docker network inspect Wtatechor3Net --format '{{.Name}} {{.Scope}} {{.Driver}}'` deve mostrar `Wtatechor3Net swarm overlay`.
- Valores colados no modo avançado a partir do Windows podem levar um caractere invisível no fim; redigite no modo simples se a rede existir e o erro continuar.
- Alternativa sem o Portainer: `deploy/implantar.sh`, que lê as variáveis de um arquivo e implanta pela linha de comando.
