# API e eventos

A API ainda não existe. Este arquivo fixa as convenções que ela vai seguir; os endpoints entram aqui conforme forem implementados e testados, com o contrato OpenAPI publicado em `/api/v1/openapi.json`.

## Convenções

| Tema | Regra |
| --- | --- |
| Base | `/api/v1`. Mudança incompatível cria `/api/v2`; a versão anterior é mantida por período anunciado |
| Autenticação de pessoas | Sessão no servidor, em cookie `httpOnly`, `Secure`, `SameSite=Lax` |
| Autenticação de integrações | `Authorization: Bearer <chave>`. A chave pertence a uma empresa e tem escopos por recurso |
| Empresa | Vem da sessão ou da chave. Nunca do corpo, da URL ou de cabeçalho enviado pelo cliente |
| Idempotência | `Idempotency-Key` obrigatório em criações e envios feitos por integração. A mesma chave devolve a mesma resposta, sem repetir a ação |
| Paginação | Por cursor: `?limit=` e `?cursor=`; a resposta traz `next_cursor` |
| Filtros e ordenação | `?filter[campo]=` e `?sort=campo,-outro` |
| Erros | RFC 9457 (`application/problem+json`), com `type`, `title`, `status`, `detail` e `errors[]` por campo |
| Limite de taxa | Por IP, usuário e chave. Excedente recebe 429 com `Retry-After` |
| Datas | ISO 8601 em UTC |
| Sem permissão | 403 para ação não permitida no módulo; 404 para registro fora do alcance |

## Eventos

Todo evento sai do outbox transacional. O envelope é o mesmo para webhooks, automações e tempo real.

```json
{
  "id": "evt_0199c1b2-7a3e-7c41-9d55-2f6a1b0c4e77",
  "type": "deal.stage_changed",
  "version": 1,
  "tenant_id": "0199b0aa-...",
  "occurred_at": "2026-10-11T22:18:04Z",
  "data": {
    "deal_id": "0199c1b0-...",
    "from_stage_id": "0199b0f2-...",
    "to_stage_id": "0199b0f3-..."
  }
}
```

- Nomes no padrão `entidade.fato`, com versão no envelope.
- O corpo leva identificadores, não dados pessoais. Quem recebe busca o detalhe pela API, com a própria chave.
- Lista inicial: `contact.created`, `contact.updated`, `lead.created`, `lead.assigned`, `deal.created`, `deal.updated`, `deal.stage_changed`, `deal.won`, `deal.lost`, `conversation.created`, `conversation.assigned`, `message.received`, `message.sent`, `message.failed`, `task.created`, `task.completed`, `appointment.created`, `email.received`, `email.sent`, `scheduled_job.completed`, `scheduled_job.failed`, `consent.updated`, `ticket.created`, `ticket.resolved`, `channel_account.disconnected`.

## Webhooks de saída

- Vários endereços por empresa, cada um com eventos selecionados, filtros e segredo próprio.
- Cabeçalhos: identificador do evento, horário e assinatura HMAC-SHA256 de `horário.corpo`. Tolerância de cinco minutos contra repetição maliciosa.
- Retentativas com espera crescente por até 24 horas. Depois, o endereço é marcado com falha e o evento fica disponível para reenvio manual.
- Histórico de cada tentativa, com código HTTP, duração e corpo enviado.

## Webhooks de entrada

`POST /hooks/{provedor}/{conta}/{token}`. O token identifica uma conta conectada, e dela sai a empresa. O corpo bruto é gravado antes de qualquer processamento, e evento repetido é ignorado pela chave única.
