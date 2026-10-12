# API e eventos

Os endpoints da Fase 1 estão implementados e cobertos por testes de integração (`apps/api/test`). O contrato OpenAPI em `/api/v1/openapi.json` chega na Fase 3, junto com as chaves de API para integrações.

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

## Endpoints implementados (Fase 1)

Toda rota exige sessão, salvo as marcadas como pública. Mutações exigem o cabeçalho `x-crm-request: 1`.

### Saúde

| Método e caminho | Acesso | Função |
| --- | --- | --- |
| `GET /api/healthz` | Pública | Processo no ar |
| `GET /api/readyz` | Pública | Processo e banco no ar |

### Autenticação e conta

| Método e caminho | Acesso | Função |
| --- | --- | --- |
| `POST /api/v1/auth/login` | Pública | E-mail e senha; bloqueio progressivo por e-mail e IP; entra na empresa se houver só uma |
| `POST /api/v1/auth/mfa/verify` | Sessão com código pendente | Código do aplicativo ou de recuperação |
| `POST /api/v1/auth/logout` | Sessão | Encerra a sessão no servidor |
| `GET /api/v1/auth/me` | Sessão | Pessoa, empresas, empresa atual, permissões e estado do 2FA |
| `POST /api/v1/auth/tenant` | Sessão | Escolhe a empresa |
| `POST /api/v1/auth/password/forgot` | Pública | Envia link de nova senha (resposta igual para qualquer e-mail) |
| `POST /api/v1/auth/password/reset` | Pública | Troca a senha pelo link e encerra as sessões |
| `POST /api/v1/auth/password/change` | Sessão | Troca a senha e encerra as outras sessões |
| `POST /api/v1/auth/mfa/setup` | Sessão | Segredo e endereço `otpauth://` |
| `POST /api/v1/auth/mfa/enable` | Sessão | Ativa com um código; devolve 10 códigos de recuperação |
| `POST /api/v1/auth/mfa/disable` | Sessão | Exige a senha; recusado para administradores |
| `GET /api/v1/auth/sessions` | Sessão | Sessões abertas da pessoa |
| `DELETE /api/v1/auth/sessions/:id` | Sessão | Encerra uma sessão própria |
| `GET /api/v1/auth/invitations/:token` | Pública | Empresa e e-mail do convite |
| `POST /api/v1/auth/invitations/accept` | Pública | Cria a conta ou, para conta existente, exige estar logado como ela |

### Empresa

| Método e caminho | Permissão | Função |
| --- | --- | --- |
| `GET /api/v1/tenant` | Qualquer pessoa da empresa | Dados da empresa |
| `PATCH /api/v1/tenant` | `settings:admin` + 2FA | Nome, fuso, idioma |
| `GET /api/v1/branding` | Qualquer pessoa da empresa | Nome do produto e tema |
| `PUT /api/v1/branding` | `settings:admin` + 2FA | Cor da marca e modo; contraste conferido |
| `POST /api/v1/branding/reset` | `settings:admin` + 2FA | Volta ao padrão, guardando a versão anterior |
| `GET /api/v1/members` | `users:admin` + 2FA | Pessoas, perfis, equipes, 2FA, último acesso |
| `PATCH /api/v1/members/:id` | `users:admin` + 2FA | Perfis e situação; nunca deixa a empresa sem administrador |
| `GET, POST /api/v1/invitations` | `users:admin` + 2FA | Convites pendentes; convidar |
| `POST /api/v1/invitations/:id/resend` | `users:admin` + 2FA | Novo link; o anterior deixa de valer |
| `DELETE /api/v1/invitations/:id` | `users:admin` + 2FA | Cancela |
| `GET, POST /api/v1/teams` | `users:admin` + 2FA | Equipes |
| `PATCH, DELETE /api/v1/teams/:id` | `users:admin` + 2FA | Nome, pessoas e líderes; exclusão |
| `GET /api/v1/permissions` | `users:admin` + 2FA | Catálogo de permissões e alcances permitidos |
| `GET, POST /api/v1/roles` | `users:admin` + 2FA | Perfis |
| `PATCH, DELETE /api/v1/roles/:id` | `users:admin` + 2FA | Administrador protegido; perfil padrão não é excluído; perfil em uso não é excluído |
| `GET /api/v1/audit` | `audit:view` | Auditoria paginada por data, com filtro por ação |

### Plataforma

| Método e caminho | Acesso | Função |
| --- | --- | --- |
| `GET, POST /api/v1/platform/tenants` | Superadministrador + 2FA | Lista e cria empresas; a criação prepara os perfis e convida o administrador |
| `PATCH /api/v1/platform/tenants/:id` | Superadministrador + 2FA | Suspende, reativa ou arquiva |

Para quem não é superadministrador, as rotas da plataforma respondem 404.
