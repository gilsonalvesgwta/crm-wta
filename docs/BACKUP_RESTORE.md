# Backup e restauração

Cópias com banco e arquivos, tela na Plataforma (aba Backups) para fazer, baixar, enviar e restaurar, e restauração do banco inteiro ou de uma empresa. Testado com PostgreSQL real (`apps/api/test/backup-agent.test.ts`, `backups.test.ts`), na tela (`apps/web/e2e/plataforma.spec.ts`) e dentro da stack em amd64 e arm64 (`deploy/teste-stack.sh`). Decisões do responsável em 13 out 2026: cópia externa por download manual; restauração das duas formas.

## Como funciona

- **Quem faz:** o serviço `backup` da stack roda o agente (`apps/api/src/backup/agent.ts`) com o usuário `postgres` do banco do CRM. A API não tem essa senha: ela só lê a pasta das cópias (volume `crmwta_backup`, montado nos dois serviços) e escreve pedidos em `/backups/.trabalhos`. O agente executa um pedido por vez e grava o andamento no mesmo arquivo.
- **Cópia:** um `.tar` com `banco.dump` (`pg_dump` custom, com donos e permissões), `arquivos.tar.gz` (todo o volume de arquivos) e `manifest.json` (empresas, migrações, tamanho). A cópia só é aceita depois de `pg_restore --list` ler o banco inteiro.
- **Automática:** uma por dia em `BACKUP_HORA` (padrão 03:30, fuso `TZ`). Retenção: 7 diárias, 4 de domingo, 6 de dia 1. As "antes de restaurar" ficam as 3 últimas; manuais e enviadas ficam até alguém excluir.
- **Cópia externa:** botão Baixar na Plataforma (só o administrador geral). O arquivo tem os dados de todas as empresas, inclusive senhas cifradas e hashes: guardar em local seguro. Para usar uma cópia guardada fora, "Enviar cópia guardada": o agente confere o arquivo antes de ele aparecer na lista; arquivo que não é cópia do CRM é apagado.
- **Cópias antigas** (`crm-*.dump`, só o banco, de antes desta versão) aparecem como "Automática (antiga)" e também restauram.

## Cópias dentro de cada empresa

Pedido do responsável em 14 out 2026. Em Configurações › Cópias de segurança (permissão `settings:admin`, com a verificação em duas etapas quando exigida), o administrador da empresa:

- **Faz** uma cópia só da empresa: `.tar` com `manifest.json` (empresa, tabelas, migrações), `dados/` (uma planilha TSV por tabela com as linhas da empresa) e `arquivos.tar.gz` (os arquivos dela). Das pessoas vão só identificador, e-mail e nome: **sem senhas**. Ficam em `/backups/empresas/<id da empresa>/`, no máximo 20 por empresa.
- **Baixa** o arquivo para guardar fora.
- **Restaura**: o agente confere que a cópia é da mesma empresa, faz antes uma cópia do estado atual e grava os dados de volta como na restauração de uma empresa pela Plataforma (as sessões continuam; senhas não mudam).
- **Exclui** uma cópia.

Cada cópia é apagada sozinha **7 dias** depois de criada (o agente confere a cada poucos segundos). O prazo muda com `DIAS_COPIAS_EMPRESA` no serviço `backup` e `TENANT_BACKUP_DAYS` na API (a tela mostra a data); sem as variáveis, 7. Uma empresa não vê, não baixa e não restaura cópias de outra (404). As cópias da Plataforma (todas as empresas) continuam só com o administrador geral.

## Restauração

Sempre com a palavra RESTAURAR digitada. Antes de qualquer restauração o agente faz uma cópia "antes de restaurar" do estado atual.

**Uma empresa:**
1. A cópia é restaurada num banco temporário (`crm_restaurar`), com os donos do banco atual e as migrações da versão em uso.
2. Numa única transação no banco em uso: a empresa atual (se existir) é excluída em cascata; os dados dela na cópia são gravados de volta tabela por tabela, sem disparar gatilhos; pessoas que não existem mais são recriadas (ou ligadas ao cadastro atual com o mesmo e-mail); referências a planos ou pessoas que sumiram ficam vazias. Sessões abertas na empresa continuam.
3. Os arquivos da empresa voltam da cópia (se ela tiver arquivos).
4. Não voltam: sessões e registros técnicos (`sessions`, `audit_log`, `auth_events`, `password_resets`).

**Banco inteiro:**
1. Restaurado em `crm_restaurar`, com donos e migrações, como acima.
2. O banco em uso é trocado pelo restaurado (renomeação, segundos fora do ar); o anterior fica guardado como `crm_anterior_<data>` (só o mais recente).
3. Os arquivos em uso vão para `/data/files/.anterior-<data>` e os da cópia entram no lugar.
4. Todos precisam entrar de novo se as sessões não existiam na cópia.

## Manual (terminal)

- Cópia: `docker exec <contêiner do backup> node /app/dist/cli/backup-agent.js` não é necessário; use o botão "Fazer cópia agora". O script `deploy/backup/restore.sh <arquivo.dump> <banco novo>` continua disponível para restaurar um `banco.dump` num banco vazio.
- Para desfazer uma restauração do banco inteiro sem a tela: renomear `crm_anterior_<data>` de volta para `crm` com a API parada.

## Regras

- Um backup só conta como válido depois de restaurado e conferido. O CI faz isso a cada versão, dentro da stack.
- Limite declarado: com uma única VPS não há réplica. Sem baixar cópias regularmente, uma falha de disco da VPS leva as cópias junto.

## Pendências

- Envio automático para fora da VPS (S3, Drive): por decisão do responsável, por enquanto é o download manual.
- Arquivamento contínuo de WAL (perda máxima menor que um dia), a decidir antes do primeiro cliente pagante.
- Ensaio cronometrado de restauração completa na VPS (tempo real de recuperação).
