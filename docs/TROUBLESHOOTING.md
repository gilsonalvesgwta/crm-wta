# Problemas conhecidos

| Sintoma | Causa | O que fazer |
| --- | --- | --- |
| `contexto de empresa ausente (app.tenant_id)` | Consulta do papel `crm_app` sem empresa definida na transação | Abrir a transação com `set_config('app.tenant_id', <empresa>, true)`. É o comportamento esperado: sem contexto, nada é lido |
| `a migração X já foi aplicada e o arquivo mudou` | Um arquivo de migração foi editado depois de aplicado | Desfazer a edição e criar uma migração nova com a correção |
| `no partition of relation "audit_log" found for row` | Linha com data de um mês sem partição | Criar o mês com `app.ensure_month_partitions` (ver `OPERATIONS.md`) |
| `permission denied for function ...` no papel da aplicação | Função nova sem concessão explícita | Conceder `execute` só a quem precisa e incluir a função na lista de `03_catalogo.sql` |
| `a tabela audit_log só aceita inserção` | Tentativa de alterar ou apagar auditoria | Esperado. Retenção é feita descartando partições inteiras |

## "network ... is declared as external, but could not be found" ao implantar a stack

A rede do Traefik existe (`docker network ls` mostra `Wtatechor3Net`), mas a implantação não a encontra.

- Causa mais comum: variáveis coladas no modo avançado do Portainer a partir do Windows levam um caractere invisível de fim de linha (`\r`) no valor. O nome da rede passa a ser `Wtatechor3Net\r`, que não existe. O mesmo estraga o domínio e os nomes das imagens.
- Como conferir: no modo simples, clique no fim do valor e apague com Backspace; se nada visível sumir, havia o caractere.
- Como resolver: apagar e redigitar os valores no modo simples, ou colar no modo avançado a partir de um editor que salve com fim de linha do Linux.
- Conferência na VPS: `sudo docker network inspect Wtatechor3Net --format '{{.Name}} {{.Scope}} {{.Driver}}'` deve mostrar `Wtatechor3Net swarm overlay`.

