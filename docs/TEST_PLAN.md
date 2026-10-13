# Plano de testes

Nenhuma fase é concluída só porque compilou. Cada item precisa do teste que o comprova passando no CI.

## Níveis

| Nível | Ferramenta | Onde roda | Cobre | Situação |
| --- | --- | --- | --- | --- |
| Banco | Scripts SQL em `packages/db/tests` | Desenvolvimento (PostgreSQL 16) e CI (16 e 18) | RLS, papéis, restrições, gatilhos, funções, catálogo | Em uso |
| Unidade | `node:test` sobre o código compilado | Desenvolvimento e CI | TOTP, cifragem, senha, bloqueio, matriz de permissões, tema e contraste | Em uso: `apps/api/test/domain.test.ts` |
| Integração | `node:test` com PostgreSQL real, uma base por arquivo | CI | Toda a API: autenticação, sessões, 2FA, convites, administração, plataforma, isolamento | Em uso: `apps/api/test/*.test.ts` |
| Ponta a ponta | Playwright com axe | CI, contra a API e a interface compiladas | Fluxos pela interface, acessibilidade, celular | Em uso: `apps/web/e2e` |
| Segurança | Dentro dos testes de banco e de integração | CI | Isolamento, permissões, sessões, CSRF, bloqueio | Em uso |
| Stack | `deploy/teste-stack.sh` | CI, em Docker Swarm com Traefik | Imagens, saúde, login, cookie Secure, portas, reimplantação, cópia e restauração | Em uso |
| Confiabilidade | Scripts que derrubam serviços da stack | CI, em Docker Swarm | Reinício, duplicidade, atraso | A partir da Fase 3 |
| Real | Roteiro manual | Contas reais | Evolution, e-mail, n8n, Instagram | Fases 3 a 6 |

## Testes de banco

`packages/db/tests/run.sh` cria um banco descartável, aplica as migrações, confere que aplicá-las de novo não muda nada e roda os arquivos em ordem:

| Arquivo | Cobre |
| --- | --- |
| `00_base.sql` | Ferramentas de teste e dados de duas empresas |
| `01_isolamento.sql` | Sem contexto nada é lido; no contexto de A nada de B aparece; escrita cruzada recusada; tabelas de plataforma e identidade; auditoria só de inserção; papel da plataforma |
| `02_autenticacao.sql` | Busca de usuário, empresas do usuário, domínio, ciclo de vida da sessão e as condições que a derrubam |
| `03_catalogo.sql` | Toda tabela com RLS forçado e política; nenhuma função aberta a todos; `search_path` fixo; lista fechada do que a aplicação executa; partições mensais |
| `04_senha_convites_2fa.sql` | Troca de senha, contagem de falhas, 2FA e códigos de recuperação, nova senha por link, convites |
| `00_crm_dados.sql` | Dados do CRM das duas empresas em todas as tabelas da Fase 2, para o isolamento cobrir cada uma |
| `05_crm.sql` | Relações que não cruzam empresas, etapa do funil certo, status e histórico do negócio, registros só de inserção, lembrete, aniversário, avisos e visões por pessoa, busca sem acento, despachante |

Resultado em 13 de outubro de 2026: 330 verificações aprovadas no PostgreSQL 16 (local e CI) e 18 (CI). O resultado de cada execução fica registrado em [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md).

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

## Testes da Fase 2

- Integração (`apps/api/test/crm.test.ts`): contatos e duplicados, mesclagem, alcance por perfil, funis e regras de etapa, funil restrito, rodízio com 30 entradas simultâneas, recorrência e lembretes, arquivos, importação de 10 mil linhas e retomada, exportação, privacidade e painel conferido contra consulta direta. Domínio (`domain-crm.test.ts`): telefones, campos personalizados, recorrência com horário de verão.
- Ponta a ponta (`apps/web/e2e/crm.spec.ts`): contatos, negócios no quadro, leads, agenda e painel, importação e configurações, com axe em cada tela.

## Ambiente de desenvolvimento

O ambiente de desenvolvimento não alcança o registro npm. O workflow `deps.yml` instala as dependências como o CI e publica `node_modules` e o Node 24 no ramo `deps-cache`; com isso a checagem de tipos e todos os testes rodam também localmente, antes do envio.

## Como ler o resultado do CI

O ambiente de desenvolvimento não lê os registros do GitHub Actions. Cada execução publica a saída no ramo `ci-saida`, em `saida/<ramo>/` (API e interface) e `saida/<ramo>__stack/` (stack): resumo, tipos, testes, compilação, auditoria de dependências, capturas de tela dos testes de ponta a ponta e das falhas.
