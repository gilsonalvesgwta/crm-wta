# Plano de testes

Nenhuma fase é concluída só porque compilou. Cada item precisa do teste que o comprova passando no CI.

## Níveis

| Nível | Ferramenta | Onde roda | Cobre | Situação |
| --- | --- | --- | --- | --- |
| Banco | Scripts SQL em `packages/db/tests` | Desenvolvimento (PostgreSQL 16) e CI (16 e 18) | RLS, papéis, restrições, gatilhos, funções, catálogo | Em uso |
| Unidade | Vitest | CI | Regras de domínio: transições, SLA, janelas, recorrência | A partir da Fase 1 |
| Integração | Vitest com PostgreSQL e Redis reais em contêiner | CI | API, filas, conectores contra simuladores | A partir da Fase 1 |
| Ponta a ponta | Playwright | CI | Fluxos pela interface em três larguras, com axe | A partir da Fase 1 |
| Segurança | Suíte própria | CI | Isolamento, permissões, sessões, anexos, webhooks | Banco em uso; API a partir da Fase 1 |
| Confiabilidade | Scripts que derrubam serviços da stack | CI, em Docker Swarm | Reinício, duplicidade, atraso, restauração | A partir da Fase 3 |
| Real | Roteiro manual | Contas reais | Evolution, e-mail, n8n, Instagram | Fases 3 a 6 |

## Testes de banco

`packages/db/tests/run.sh` cria um banco descartável, aplica as migrações, confere que aplicá-las de novo não muda nada e roda os arquivos em ordem:

| Arquivo | Cobre |
| --- | --- |
| `00_base.sql` | Ferramentas de teste e dados de duas empresas |
| `01_isolamento.sql` | Sem contexto nada é lido; no contexto de A nada de B aparece; escrita cruzada recusada; tabelas de plataforma e identidade; auditoria só de inserção; papel da plataforma |
| `02_autenticacao.sql` | Busca de usuário, empresas do usuário, domínio, ciclo de vida da sessão e as condições que a derrubam |
| `03_catalogo.sql` | Toda tabela com RLS forçado e política; nenhuma função aberta a todos; `search_path` fixo; lista fechada do que a aplicação executa; partições mensais |

Resultado em 11 de outubro de 2026, PostgreSQL 16.15 local: 135 verificações aprovadas. O resultado do CI fica registrado em [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md).

### Testes de mutação

Para conferir que os testes pegam falhas de verdade, cada alteração abaixo foi aplicada sozinha em um banco já migrado, e o arquivo de teste indicado precisou falhar:

| Alteração indevida | Pego por |
| --- | --- |
| RLS sem `force` em `teams` | `03_catalogo.sql` |
| RLS desligado em `teams` | `01_isolamento.sql` |
| Política permissiva em `api_keys` | `01_isolamento.sql` |
| Leitura de `password_resets` concedida | `01_isolamento.sql` |
| Leitura de `users.password_hash` concedida | `01_isolamento.sql` |
| Função nova executável por todos | `03_catalogo.sql` |
| Função com direitos do dono sem `search_path` | `03_catalogo.sql` |
| Função extra liberada para a aplicação | `03_catalogo.sql` |
| Tabela nova sem RLS | `03_catalogo.sql` |
| `session_find` ignorando empresa suspensa e vínculo | `02_autenticacao.sql` |
| Gatilho de auditoria removido | `01_isolamento.sql` |
| Chave estrangeira simples no lugar da composta | `01_isolamento.sql` |

## Regra para objetos novos

- Tabela nova: RLS ligado e forçado, política e concessões explícitas; se tiver `tenant_id`, chave estrangeira composta para as tabelas da mesma empresa.
- Função nova em `app`: sem execução para todos; se rodar com os direitos do dono, `search_path` fixo; se a aplicação precisar dela, entra de propósito na lista de `03_catalogo.sql`.
