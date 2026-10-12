# Arquitetura

Um monólito modular em TypeScript, dividido em três processos que compartilham o mesmo código de domínio. O PostgreSQL é a única fonte da verdade; o Redis só transporta trabalho.

```
Navegador      n8n e integrações      Provedores de canal
    |                 |                       |   ^
    v                 v                       v   |
+---------------------------------------------------+   |
|  Traefik existente: HTTPS, roteia por domínio     |   |
+---------------------------------------------------+   |
    | páginas          | /api e /hooks                   |
    v                  v                                 |
+---------+      +-----------+      +-----------+        |
|   web   | ---> |    api    |      |  worker   | -------+  envios e webhooks de saída
+---------+      +-----------+      +-----------+
                       |                  |
        +--------------+---------+--------+
        v                        v                v
  PostgreSQL 18              Redis          Arquivos (API S3)
```

Só a API e o worker alcançam os dados. A interface nunca toca o banco.

## Processos

| Processo | Responsabilidade | Não faz |
| --- | --- | --- |
| `web` (Next.js 16) | Renderiza a interface, aplica o tema da empresa, chama a API | Não acessa o banco nem contém regra de negócio |
| `api` (NestJS 12 sobre Fastify) | Login, permissões, casos de uso, API REST `/api/v1`, entrada de webhooks, eventos em tempo real | Não chama provedores dentro da requisição |
| `worker` (NestJS, outro ponto de entrada) | Outbox, envios, webhooks de saída, sincronização de e-mail, agendador, automações, reconciliadores | Não atende tráfego externo |
| `db` (PostgreSQL 18) | Dados, RLS, outbox, agendamentos, auditoria | Não é compartilhado com outra aplicação |
| `redis` | Filas BullMQ, limites de taxa, distribuição dos eventos em tempo real | Não guarda nada que não possa ser reconstruído do banco |
| `migrate` | Aplica migrações pendentes e termina | Não roda migração destrutiva sem etapa manual |
| `backup` | Cópia do banco e envio para fora da máquina | |

## Módulos e camadas

Cada módulo expõe uma interface pública aos outros. Uma regra de lint barra importações que cruzem a fronteira.

| Camada | Conteúdo | Regra |
| --- | --- | --- |
| `http` | Controladores, validação de entrada, formato de resposta e de erro | Nenhuma regra de negócio |
| `application` | Casos de uso | Único lugar que abre transação, confere permissão e grava evento e auditoria |
| `domain` | Regras puras: transição de etapa, SLA, janela de canal, recorrência | Sem banco nem rede |
| `infra` | Repositórios, conectores, armazenamento, filas | Sempre atrás de interface |

Módulos previstos: `platform`, `identity`, `access`, `crm`, `activities`, `inbox`, `channels`, `messaging`, `automation`, `support`, `marketing`, `reporting`, `integration`, `files`, `audit`.

## Caminho de uma requisição

1. O Traefik entrega a chamada. `/api` e `/hooks` vão para a `api`; o resto, para a `web`. Tudo no mesmo domínio.
2. A sessão por cookie ou a chave de API vira um ator: usuário ou integração, empresa, perfis, equipes.
3. A entrada é validada contra o esquema do contrato.
4. O caso de uso confere a permissão e o alcance sobre o registro.
5. A transação abre com `app.tenant_id` e `app.user_id` definidos. O RLS vale para tudo o que ela tocar.
6. Dados, evento de outbox e linha de auditoria são gravados na mesma transação.
7. A resposta sai no formato padrão. Erros seguem RFC 9457.
8. O worker lê o outbox e alimenta automações, webhooks de saída e tempo real.

## Caixa de entrada unificada

Três colunas: lista de conversas, conversa e painel do contato. Os conceitos ficam em tabelas separadas.

| Conceito | Tabela | Observação |
| --- | --- | --- |
| Contato | `contacts` | A pessoa no CRM |
| Identidade no canal | `contact_identities` | Telefone, usuário do Instagram, endereço de e-mail |
| Conta conectada | `channel_accounts` | Um número, uma conta, uma caixa; dona: uma empresa |
| Conversa | `conversations` | Conta conectada + identidade; estado, prioridade, responsável, equipe |
| Mensagem | `messages` | Direção, tipo, corpo, estado, identificador externo |
| Evento de mensagem | `message_events` | Cada mudança de estado |
| Anexo | `message_attachments` | Aponta para `files` |
| Atribuição | `conversation_assignments` | Histórico auditável |
| Nota interna | `conversation_notes` | Tabela própria: não passa pelo caminho de envio |

**Entrada.** O provedor chama `POST /hooks/{provedor}/{conta}/{token}`. A API confere o segredo, grava o corpo bruto em `inbound_events` com chave única por provedor, conta e evento, e responde 200. O worker normaliza, localiza ou cria identidade e conversa, e insere a mensagem com chave única por conta e identificador externo. Evento repetido é reconhecido e ignorado.

**Saída.** A interface envia com chave de idempotência. A mensagem nasce `queued` e vai para a fila da conta, que respeita o limite daquele canal. Resultado: `sent`, `failed` (erro definitivo) ou nova tentativa com espera crescente. Se a conexão cair depois do envio e antes da confirmação, o estado é `unknown` e o reconciliador consulta o provedor. Não há reenvio automático nesse caso.

Estados: `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, `unknown`, `canceled`. Entrega e leitura só aparecem quando o conector declara suporte.

## Eventos, filas e agendador

- **Outbox.** O despachante lê com `FOR UPDATE SKIP LOCKED`. Entrega pelo menos uma vez; todo consumidor é idempotente pelo identificador do evento.
- **Filas.** `inbound-normalize`, `outbound-messages` (agrupada e limitada por conta), `webhooks-out`, `email-sync`, `automations`, `scheduler`, `imports-exports`, `maintenance`.
- **Agendador.** O agendamento vive em `scheduled_messages`, em UTC, com o fuso da empresa. A cada 30 segundos o worker seleciona os vencidos com trava de linha, marca `processing` com prazo e enfileira usando o próprio identificador como chave do job.
- **Recuperação.** Linha em `processing` com prazo vencido volta para o reconciliador. Reiniciar o worker ou perder o Redis não perde agendamento.
- **Falhas definitivas.** Ficam em `failed_jobs`, com tela para inspecionar, reenviar ou descartar.
- **Datas comemorativas.** Mês e dia, com ano opcional. Em ano não bissexto, 29 de fevereiro cai em 28, configurável.

## Tempo real

SSE (eventos do servidor) com retomada pelo último evento recebido. A caixa de entrada só precisa receber; o envio vai por HTTP. WebSocket fica para quando houver presença ou indicador de digitação.

## Situação

Em 11 de outubro de 2026 só a camada de banco da Fase 1 existe. Ver [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md).
