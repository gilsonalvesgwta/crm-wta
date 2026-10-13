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

## Endpoints implementados (Fases 1 e 2)

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
| `GET /api/v1/platform/tenants/:id` | Superadministrador + 2FA | Empresa com contato, assinatura e domínio próprio |
| `PATCH /api/v1/platform/tenants/:id` | Superadministrador + 2FA | Com `status`: suspende, reativa ou arquiva. Sem `status`: nome, responsável, e-mail, telefone, documento, observações |
| `POST /api/v1/platform/tenants/:id/delete` | Superadministrador + 2FA | Exclui a empresa e tudo dela, inclusive arquivos. Corpo `{confirm: "<identificador>"}`; a empresa `wta` é recusada |
| `POST /api/v1/platform/tenants/:id/invite-admin` | Superadministrador + 2FA | Novo convite de administrador (`{email?}`; sem e-mail, vai para o de contato) |
| `PUT /api/v1/platform/tenants/:id/subscription` | Superadministrador + 2FA | Plano, situação e vigência manuais. Em dia reativa a empresa; `inactive` ou `expired` suspende |
| `GET, POST /api/v1/platform/plans` | Superadministrador + 2FA | Planos com preço, período, dias de acesso e limites (`max_users`, `max_whatsapp`, `max_email_accounts`, `max_automations`, `custom_domain`, `api_access`; número vazio = sem limite) |
| `PATCH, DELETE /api/v1/platform/plans/:id` | Superadministrador + 2FA | Plano em uso não é excluído (409) |
| `POST /api/v1/platform/plans/:id/offers`, `DELETE /api/v1/platform/offers/:id` | Superadministrador + 2FA | Liga e desliga códigos de produto da Greenn ao plano |
| `GET /api/v1/platform/greenn` | Superadministrador + 2FA | Endereço do webhook (quando `GREENN_SECRET` existe) e os 100 últimos avisos |
| `POST /api/v1/webhooks/greenn/:segredo` | Público; o segredo no caminho é a autorização | Avisos da Greenn (ver INTEGRATIONS.md). Segredo errado: 404 |

Para quem não é superadministrador, as rotas da plataforma respondem 404.

### Marca, domínio próprio e plano da empresa

| Método e caminho | Acesso | Função |
| --- | --- | --- |
| `POST, DELETE /api/v1/branding/logo` e `/branding/icon` | `settings:admin` | Logotipo e ícone (PNG, JPG ou WebP até 2 MB, tipo conferido pelo conteúdo). Devolvem a marca atualizada |
| `PUT /api/v1/branding` | `settings:admin` | Aceita também `sidebar` (cor do menu, `#RRGGBB` escura ou `null`) |
| `GET, PUT, DELETE /api/v1/domain` | `settings:admin` | Domínio próprio (um por empresa). `PUT` exige o recurso `custom_domain` no plano (403 `plan-limit`) |
| `POST /api/v1/domain/check` | `settings:admin` | Confere o DNS (CNAME para o alvo ou os mesmos IPs) e a rota (`https://<domínio>/api/v1/public/domain-check` responde com esta empresa) |
| `GET /api/v1/subscription` | Qualquer pessoa da empresa | Plano, situação, vigência, limites e uso |
| `GET /api/v1/public/branding` | Público | Marca da empresa dona do domínio acessado (verificado e empresa ativa); `{found:false}` no endereço principal |
| `GET /api/v1/public/branding/:empresa/:tipo/:arquivo` | Público | Imagem atual da marca, com cache longo; outra imagem qualquer responde 404 |
| `GET /api/v1/public/domain-check` | Público | Qual empresa este endereço identifica (teste de rota) |

No login, se o endereço acessado é o domínio próprio de uma empresa da pessoa, essa empresa já fica escolhida.

### CRM comercial (Fase 2)

O alcance (próprios, equipe, empresa) vem do perfil. Registro fora do alcance responde 404, como se não existisse. Listas são paginadas com `page` e `pageSize` (até 100) e devolvem `total`.

| Método e caminho | Permissão | Função |
| --- | --- | --- |
| `GET, POST /api/v1/contacts` | `contacts:view`, `contacts:edit` | Lista com busca sem acento (nome, e-mail, telefone, documento), filtros e ordenação; criação com vários e-mails e telefones, etiquetas, campos e origem. Duplicado por e-mail ou telefone responde 409 com os candidatos, salvo `allowDuplicate` |
| `GET, PATCH /api/v1/contacts/:id` | `contacts:view`, `contacts:edit` | Detalhe com origem (primeira e última), consentimentos e contagens; edição registrada na linha do tempo só pelos nomes dos campos |
| `DELETE /api/v1/contacts/:id` | `contacts:delete` (empresa) | Exclusão auditada |
| `GET /api/v1/contacts/:id/duplicates` | `contacts:view` | Contatos com o mesmo e-mail ou telefone |
| `POST /api/v1/contacts/:id/merge` | `contacts:delete` (empresa) | Mescla outro contato neste, preservando negócios, notas, histórico, origem e consentimento; cópia do mesclado guardada |
| `GET, POST /api/v1/contacts/:id/consents` | `contacts:view`, `contacts:edit` | Histórico e registro de consentimento por canal e finalidade; opt-out alimenta a lista de supressão |
| `POST /api/v1/contacts/:id/attribution` | `contacts:edit` | Novo ponto de origem (UTMs, identificadores de clique) |
| `GET /api/v1/contacts/export.csv` | `contacts:import_export` | CSV no alcance de quem exporta, registrado |
| `GET, POST /api/v1/organizations`, `GET, PATCH, DELETE /api/v1/organizations/:id`, `GET /api/v1/organizations/export.csv` | Como contatos | Organizações |
| `GET /api/v1/directory` | Qualquer pessoa da empresa | Pessoas ativas e equipes, para escolher responsável |
| `GET, POST /api/v1/tags`; `PATCH, DELETE /api/v1/tags/:id` | Ver: todos; criar: `contacts:edit`; alterar e excluir: `contacts:delete` | Etiquetas |
| `GET, POST /api/v1/custom-fields`; `PATCH /api/v1/custom-fields/:id` | Ver: todos; configurar: `pipelines:admin` | Campos personalizados de contato, organização, negócio e lead; tipo e chave não mudam depois de criados |
| `GET, POST /api/v1/products`; `PATCH /api/v1/products/:id` | Ver: todos; configurar: `products:admin` | Produtos e preços |
| `GET, POST /api/v1/outcome-reasons`; `PATCH .../:id` | Ver: todos; configurar: `pipelines:admin` | Motivos de ganho e perda |
| `GET, POST /api/v1/views`; `DELETE /api/v1/views/:id` | Qualquer pessoa | Visões salvas, próprias ou compartilhadas |
| `GET, POST /api/v1/pipelines`; `GET, PATCH, DELETE /api/v1/pipelines/:id` | Ver: quem tem acesso ao funil; configurar: `pipelines:admin` | Funis, com acesso restrito por pessoa ou equipe |
| `PUT /api/v1/pipelines/:id/stages` | `pipelines:admin` | Etapas na ordem, com cor, probabilidade, tipo, campos exigidos e prazo de inatividade; etapa com negócios não é removida |
| `PUT /api/v1/pipelines/:id/transitions` | `pipelines:admin` | Regras de transição entre etapas |
| `GET /api/v1/deals/board?pipelineId=` | `deals:view` | Quadro: etapas com total, valor ponderado e cartões |
| `GET, POST /api/v1/deals`; `GET, PATCH, DELETE /api/v1/deals/:id` | `deals:view`, `deals:edit`, `deals:delete` | Negócios; trocar o responsável exige `deals:assign` |
| `POST /api/v1/deals/:id/move` | `deals:edit` | Muda de etapa ou de funil conferindo regra de transição, campos exigidos e motivo de perda; histórico gravado pelo banco |
| `PUT /api/v1/deals/:id/items` | `deals:edit` | Itens de produto; o valor do negócio passa a ser a soma |
| `GET /api/v1/deals/export.csv` | `deals:export` | Só funis acessíveis, mesmo com filtro |
| `GET, POST /api/v1/leads`; `GET, PATCH /api/v1/leads/:id` | `leads:view`, `leads:work` | Leads; contato existente com o mesmo e-mail ou telefone é reaproveitado; sem responsável informado, o rodízio escolhe |
| `POST /api/v1/leads/:id/assign` | `deals:assign` | Atribuição auditada, com aviso para quem recebe |
| `POST /api/v1/leads/:id/qualify`, `/disqualify`, `/reopen` | `leads:work` | Qualificar cria o negócio ligado ao lead e ao contato |
| `GET, POST /api/v1/assignment-rules`; `PATCH, DELETE .../:id` | `deals:assign` (empresa) | Roteiros de rodízio por origem e equipe |
| `GET, POST /api/v1/activities`; `GET, PATCH, DELETE /api/v1/activities/:id` | `tasks:manage` | Tarefas e compromissos, com recorrência e lembrete; editar ou excluir "esta e as seguintes" numa série |
| `POST /api/v1/activities/:id/status` | `tasks:manage` | Concluir, reabrir ou cancelar; concluir marca o último contato dos registros ligados |
| `GET /api/v1/notifications`; `POST /api/v1/notifications/read` | A própria pessoa | Avisos (lembretes, leads, importações) |
| `GET, POST /api/v1/records/:tipo/:id/notes`; `PATCH, DELETE /api/v1/notes/:id` | Ver ou editar o registro | Notas de contato, organização, negócio ou lead; só o autor edita o texto |
| `GET /api/v1/records/:tipo/:id/timeline` | Ver o registro | Linha do tempo, em ordem |
| `GET, POST /api/v1/records/:tipo/:id/files` | Ver ou editar o registro | Anexos (multipart, campo `file`): tipo conferido pelo conteúdo, até `UPLOAD_MAX_MB` |
| `GET /api/v1/files/:id/url`; `DELETE /api/v1/files/:id` | Ver ou editar o registro | Endereço assinado válido por 5 minutos; remoção |
| `GET /api/v1/files/download/:token` | Pública (o endereço assinado é a autorização) | Download sempre como anexo, com `sandbox` |
| `POST /api/v1/imports/upload?entity=`; `POST, GET /api/v1/imports`; `GET /api/v1/imports/:id`, `/errors`; `POST .../cancel` | `contacts:import_export` | Importação de CSV em lotes, com sugestão de colunas, opção para duplicados e aviso por linha |
| `GET /api/v1/privacy/contacts/:id/export`; `POST .../anonymize` | `privacy:execute` + 2FA | Direitos do titular, auditados |
| `GET /api/v1/dashboard?from=&to=&pipelineId=&ownerId=` | Cada bloco com a sua permissão | Indicadores de negócios, leads, agenda e contatos no alcance de quem vê |

