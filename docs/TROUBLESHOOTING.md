# Problemas conhecidos

| Sintoma | Causa | O que fazer |
| --- | --- | --- |
| `contexto de empresa ausente (app.tenant_id)` | Consulta do papel `crm_app` sem empresa definida na transação | Abrir a transação com `set_config('app.tenant_id', <empresa>, true)`. É o comportamento esperado: sem contexto, nada é lido |
| `a migração X já foi aplicada e o arquivo mudou` | Um arquivo de migração foi editado depois de aplicado | Desfazer a edição e criar uma migração nova com a correção |
| `no partition of relation "audit_log" found for row` | Linha com data de um mês sem partição | Criar o mês com `app.ensure_month_partitions` (ver `OPERATIONS.md`) |
| `permission denied for function ...` no papel da aplicação | Função nova sem concessão explícita | Conceder `execute` só a quem precisa e incluir a função na lista de `03_catalogo.sql` |
| `a tabela audit_log só aceita inserção` | Tentativa de alterar ou apagar auditoria | Esperado. Retenção é feita descartando partições inteiras |

## "network ... is declared as external, but could not be found" ao implantar pelo Portainer

Aconteceu na instalação de 13 de outubro de 2026 na VPS da WTA. A rede `Wtatechor3Net` existia e era do Swarm (`docker network inspect` mostrava `swarm overlay`), mas o Portainer recusava a stack com essa mensagem, mesmo com os valores das variáveis redigitados. A conferência da rede é feita pelo próprio Portainer, não pela stack; a causa provável é a combinação da versão do Portainer com o Docker 29.

- Primeira tentativa: conferir se não há caractere invisível no fim dos valores das variáveis (comum ao colar do Windows no modo avançado).
- Solução usada: implantar pela linha de comando da VPS com `deploy/implantar.sh`, que lê as variáveis de `/root/crmwta.env`. A stack aparece no Portainer como criada fora dele (controle limitado); para mudar uma variável, edite o arquivo e rode o script de novo.
