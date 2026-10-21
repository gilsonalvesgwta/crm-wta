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

### Automações e integrações (lote 3)

| Método e caminho | Acesso | Função |
| --- | --- | --- |
| `GET /api/v1/automations` | `automations:view` | Regras, contagem de execuções em 30 dias e a lista de variáveis dos textos |
| `POST /api/v1/automations`, `PUT /api/v1/automations/:id` | `automations:admin` + 2FA se exigida | `{name, active, trigger, filters, actions}`. Gatilhos: `contact.created`, `lead.created`, `deal.created`, `deal.stage_changed` (`stageId?`), `deal.won`, `deal.lost`, `message.received`, `birthday` (`time`), `deal.inactive` (`days`). Ações: `send_whatsapp`, `send_email`, `create_task`, `add_tag`, `move_stage`, `webhook`, `wait` (`minutes`). Limite `max_automations` (ativas) |
| `PATCH /api/v1/automations/:id` | `automations:admin` | `{active}`; desligar cancela as execuções que esperavam |
| `DELETE /api/v1/automations/:id` | `automations:admin` | Exclui a regra e as execuções |
| `GET /api/v1/automations/runs?ruleId=` | `automations:view` | Últimas 100 execuções, com o que cada ação fez |
| `GET, POST /api/v1/api-keys`, `DELETE /api/v1/api-keys/:id` | `integrations:admin` + 2FA se exigida | Chaves de API; a chave inteira só volta na criação. Exige `api_access` no plano |
| `POST /api/v1/inbound` | Chave de API (`Authorization: Bearer crm_...` ou `X-Api-Key`) ou sessão, com `contacts:edit` | `{contact:{name|firstName, lastName, email, phone, tags[], ownerEmail, birthday, custom}, organization?:{name}, deal?:{title, value, pipeline|pipelineId, stage|stageId, ownerEmail, tags[]}, lead?:{title, source}, note?, touch?}` → `{contactId, created, organizationId, dealId, leadId}` |

Com chave de API não há cookie, então não há verificação de CSRF; chave inválida, revogada, de empresa suspensa ou de plano sem API responde 401.

### Cópias de segurança (Plataforma)

| Método e caminho | Acesso | Função |
| --- | --- | --- |
| `GET /api/v1/platform/backups` | Superadministrador + 2FA | Se a pasta está ligada, sinal do agente, cópias (com empresas e migrações) e os 20 últimos trabalhos |
| `POST /api/v1/platform/backups` | Superadministrador + 2FA | Pede uma cópia agora. Um trabalho por vez (409) |
| `GET /api/v1/platform/backups/:nome/download` | Superadministrador + 2FA | Baixa o arquivo da cópia |
| `POST /api/v1/platform/backups/upload` | Superadministrador + 2FA | Multipart `file` (.tar ou .dump, até `BACKUP_UPLOAD_MAX_MB`); o agente confere |
| `POST /api/v1/platform/backups/:nome/restore` | Superadministrador + 2FA | `{scope: "tenant" \| "full", tenantId?, confirm: "RESTAURAR"}` |
| `GET /api/v1/platform/backups/jobs/:id` | Superadministrador + 2FA | Andamento de um trabalho |
| `DELETE /api/v1/platform/backups/:nome` | Superadministrador + 2FA | Exclui uma cópia (não a que está em uso por um trabalho) |
| `GET /api/v1/backups` | `settings:admin` | Cópias da própria empresa (com `expiresAt`), prazo em dias e os últimos trabalhos dela |
| `POST /api/v1/backups` | `settings:admin` | Pede uma cópia da empresa (até 20 guardadas; um trabalho por vez, 409) |
| `GET /api/v1/backups/:nome/download` | `settings:admin` | Baixa a cópia da empresa |
| `POST /api/v1/backups/:nome/restore` | `settings:admin` | `{confirm: "RESTAURAR"}`; restaura só esta empresa |
| `GET /api/v1/backups/jobs/:id` | `settings:admin` | Andamento de um trabalho da empresa (de outra empresa: 404) |
| `DELETE /api/v1/backups/:nome` | `settings:admin` | Exclui uma cópia da empresa |

### Meta: WhatsApp oficial e Instagram (bloco 4 dos ajustes)

| Endpoint | Permissão | O que faz |
| --- | --- | --- |
| `POST /api/v1/channels/whatsapp-cloud`, `PATCH …/:id` | `channels:admin` + 2FA | `{name, phoneNumberId, wabaId, token?, appSecret?}`; confere na Meta e responde `{status, lastError, address, webhook: {url, verifyToken}}` |
| `POST /api/v1/channels/instagram`, `PATCH …/:id` | `channels:admin` + 2FA | `{name, igUserId, host: "instagram" \| "facebook", token?, appSecret?}` |
| `POST /api/v1/channels/:id/verify` | `channels:admin` + 2FA | Confere de novo a conta na Meta |
| `GET /api/v1/whatsapp-templates` | qualquer pessoa da empresa | Modelos (`accountId`, `approved=1`) |
| `POST /api/v1/whatsapp-templates` | `campaigns:edit` | `{accountId, name, language, category, header?, body, footer?, buttons[], examples[]}`; envia para a Meta aprovar |
| `POST /api/v1/whatsapp-templates/sync`, `DELETE /api/v1/whatsapp-templates/:id` | `campaigns:edit` | Sincronizar estados; excluir (na Meta e aqui) |
| `GET`, `POST /api/v1/webhooks/meta/:token` | Público (assinatura) | Verificação (`hub.challenge`) e avisos da Meta |

Envio com modelo: `POST /api/v1/conversations/:id/messages` com `{accountId, templateId, templateParams}`. Fora das 24 h sem modelo: 409 `outside-window`.

### Operação e ações agendadas (bloco 3 dos ajustes)

| Endpoint | Permissão | O que faz |
| --- | --- | --- |
| `GET /api/v1/dashboard/operation` | `reports:view` | `from`, `to` (até 1 ano), `channel?`, `assigneeId?`, `teamId?`. Mensagens recebidas e enviadas, tempo médio de resposta (da primeira mensagem da vez do cliente até a primeira resposta de uma pessoa), fila agora (ativas, sem responsável, esperando resposta), encerradas, follow-ups, séries por dia, mapa de calor (dia × hora no fuso da empresa), canais, atendentes e funil das conversas. Alcance: o das conversas; sem permissão de conversa, só com relatórios da empresa toda |
| `GET /api/v1/dashboard/sales` | `reports:view` | `from`, `to` (até 1 ano), `ownerId?`, `teamId?`. Indicadores comerciais: leads contatados (pessoas com mensagem de alguém da equipe, sem campanha nem automação, ou call realizada), calls (ligações e reuniões) agendadas, realizadas, não compareceu e remarcadas, comparecimento, vendas na call (ganho no mesmo dia, no fuso da empresa, de call realizada com a pessoa), no follow-up (depois) e sem call, valores, tempo médio até a venda no follow-up e conversão das pessoas com call no período. Traz o período anterior do mesmo tamanho, a série por dia e os números por vendedor. Alcance: o de `reports:view` |
| `GET /api/v1/dashboard/kpis` | `reports:view` (empresa toda) | `from`, `to` (AAAA-MM-DD, até 1 ano), `step` (dias por linha, 1–366, padrão 7). KPIs com investimento: leads (contatos e leads novos), prospecções, reuniões agendadas e realizadas, no-show (meta até 20%), vendas (na reunião e no follow-up), faturamento, ticket médio, custo por lead, por agendada, por realizada e por venda, ROAS, conversão na reunião e reuniões por venda. Traz `periods` (planilha) e `totals` (com o gasto por plataforma). Fuso da empresa |
| `GET /api/v1/ads/spend` | `reports:view` (empresa toda) | `from`, `to`: lançamentos de investimento que tocam o período (manuais e importados) |
| `POST /api/v1/ads/spend` · `PATCH`/`DELETE /api/v1/ads/spend/:id` | `reports:export` | Lançar, mudar ou apagar investimento: `platform` (`meta`, `google`, `tiktok`, `other`), `description?`, `firstDay`, `lastDay`, `amountCents`. Importados (409 `imported`) não mudam |
| `GET /api/v1/ads/accounts` | `reports:view` (empresa toda) | Contas da Meta Ads ligadas, com estado e última importação (sem o token) |
| `POST /api/v1/ads/accounts/meta` | `reports:export` | `accountId` (act_… ou número), `token` (ads_read). Confere na Graph API, guarda o token cifrado e importa 90 dias de gasto diário; depois, a cada 6 h, os últimos 7 dias |
| `POST /api/v1/ads/accounts/:id/sync` · `DELETE /api/v1/ads/accounts/:id` | `reports:export` | Importar agora; desligar (o gasto importado sai) |
| `GET /api/v1/scheduled` | qualquer pessoa da empresa (cada tipo pede a sua permissão) | Ações agendadas juntas: mensagens agendadas (`scheduled:manage`), próximos passos de automações (`automations:view`), campanhas (`campaigns:view`) e tarefas (`tasks:manage`). Filtros `kind`, `status` (pending, done, all), `from`, `to`, `ownerId`, `contactId`, `q`; `counts` por tipo |
| `POST /api/v1/scheduled-messages` | `scheduled:manage`, contato no alcance | `{contactId, accountId, to?, subject?, text, sendAt}`. Sai no horário em nome de quem agendou (não passa pela lista de supressão, como uma mensagem escrita na hora) |
| `GET`, `PATCH /api/v1/scheduled-messages/:id`, `POST …/:id/cancel` | `scheduled:manage` (alcance) | Ver, mudar texto, conta ou horário, e cancelar enquanto não saiu. Se falhar ao sair, quem agendou recebe um aviso |

### Campanhas (bloco 2 dos ajustes)

| Endpoint | Permissão | O que faz |
| --- | --- | --- |
| `GET /api/v1/campaigns` | `campaigns:view` | Campanhas com números (`stats`: total, pending, sent, failed, skipped, delivered, read, replied). Filtros `status`, `q` |
| `POST /api/v1/campaigns/preview` | `campaigns:edit` | `{channel, audience}` → quantos recebem e por que alguns ficam de fora (sem endereço, supressão, consentimento revogado ou ausente) |
| `POST /api/v1/campaigns`, `PATCH /api/v1/campaigns/:id` | `campaigns:edit` | Rascunho: `{name, description?, channel, audience, accountId?, subject?, body?, perMinute, windowStart?, windowEnd?, optOutHint}`. Edita só antes de o envio começar |
| `GET /api/v1/campaigns/:id`, `GET /api/v1/campaigns/:id/recipients` | `campaigns:view` | Campanha e destinatários (filtro `status`, paginado) |
| `POST /api/v1/campaigns/:id/duplicate`, `DELETE /api/v1/campaigns/:id` | `campaigns:edit` | Duplicar; excluir rascunho, concluída ou cancelada |
| `POST /api/v1/campaigns/:id/start` | `campaigns:approve` (empresa) | `{scheduledAt?}`: aprova o envio agora ou na data. Confere conta, texto, assunto e público |
| `POST /api/v1/campaigns/:id/pause`, `/resume`, `/cancel` | `campaigns:approve` (empresa) | Pausar, retomar, cancelar (quem não recebeu fica como "não enviada") |
| `GET` ou `POST /api/v1/public/descadastrar/:token` | Público (link assinado) | Descadastro dos e-mails de campanha (também pelo cabeçalho List-Unsubscribe, um clique) |

O despachante monta o público na hora do envio (snapshot), envia no ritmo escolhido (mensagens por minuto, com pequena variação) e dentro da janela de horário no fuso da empresa. Fica de fora quem não tem endereço, está na lista de supressão ou revogou o consentimento; com `consentOnly`, só quem consentiu. WhatsApp desconectado no meio pausa a campanha sem perder ninguém. Responder "SAIR" (ou "PARAR", "STOP"…) põe o número na supressão.

### Canais e mensagens (lote 2)

| Método e caminho | Acesso | Função |
| --- | --- | --- |
| `GET /api/v1/channels` | `channels:admin` + 2FA | Contas (WhatsApp e e-mail), uso dos limites do plano e se a Evolution está configurada. A senha nunca volta (`smtp.hasPassword`) |
| `POST /api/v1/channels/whatsapp` | `channels:admin` + 2FA | `{name}`. Cria a instância na Evolution e devolve `{account, qr, pairingCode}`. Limite `max_whatsapp`; sem Evolution, 409 `evolution-not-configured` |
| `GET /api/v1/channels/:id/qr` | `channels:admin` + 2FA | QR code novo (ou `qr: null` se já conectado) |
| `POST /api/v1/channels/:id/refresh`, `/rewire`, `/disconnect` | `channels:admin` + 2FA | Estado atual; webhook refeito com token novo; desconectar o celular |
| `DELETE /api/v1/channels/:id` | `channels:admin` + 2FA | Apaga a instância na Evolution e a conta; o histórico fica |
| `POST /api/v1/channels/email`, `PATCH /api/v1/channels/email/:id` | `channels:admin` + 2FA | `{name, address, fromName, host, port, secure, user, pass}`; `pass: null` na edição mantém a senha. Limite `max_email_accounts` |
| `POST /api/v1/channels/:id/test` | `channels:admin` + 2FA | Confere o SMTP e manda um e-mail de teste para quem pediu; grava o estado |
| `GET /api/v1/channels/available` | `conversations:reply` | Contas que podem enviar agora |
| `GET /api/v1/conversations` | `conversations:reply` | Conversas visíveis (uma por contato e canal), com contato, responsável, equipe, última mensagem, não lidas e `counts` por estado. Filtros: `status` (open, waiting, closed, all), `channel`, `assignee` (me, none ou id), `teamId`, `tagId`, `deal` (open, none ou id do funil), `unread=1`, `q`, `page` |
| `GET /api/v1/conversations/unread` | `conversations:reply` | Quantas conversas visíveis têm mensagem não lida |
| `POST /api/v1/conversations` | `conversations:reply`, contato no alcance | `{contactId, channel}`: abre (ou acha) a conversa, mesmo sem mensagem nenhuma. 422 se o contato não tem telefone ou e-mail |
| `GET /api/v1/conversations/:id` | `conversations:reply` | Uma conversa |
| `PATCH /api/v1/conversations/:id` | `conversations:reply` | `{status?, assigneeId?, teamId?}`. Atribuir a outra pessoa ou trocar a equipe pede `conversations:assign`; assumir uma sem responsável, `conversations:take` |
| `GET /api/v1/conversations/:id/messages` | `conversations:reply` | Mensagens só do canal da conversa |
| `POST /api/v1/conversations/:id/messages` (e `/messages/file`) | `conversations:reply` | Envia pelo canal da conversa (conta de outro canal: 422) |
| `POST /api/v1/conversations/:id/seen` | `conversations:reply` | Marca as recebidas como vistas |
| `GET /api/v1/quick-replies` | `conversations:reply` | Respostas prontas da empresa e as suas (`channel`, `q`); `canShare` diz se pode criar para a empresa |
| `POST /api/v1/quick-replies`, `PATCH /api/v1/quick-replies/:id` | `conversations:reply` | `{channel, shortcut, title, subject?, body, shared}`. `shared` pede `campaigns:edit`; atalho repetido no canal: 422 |
| `DELETE /api/v1/quick-replies/:id` | `conversations:reply` | As suas; as da empresa, com `campaigns:edit` |
| `GET /api/v1/contacts/:id/messages` | `contacts:view`, no alcance | Histórico (200 mais recentes; `before` para as anteriores) com conta, quem enviou, estado e arquivo |
| `POST /api/v1/contacts/:id/messages` | `conversations:reply`, no alcance | `{accountId, to?, text, subject?}` (assunto obrigatório no e-mail). Responde 201 com a mensagem; falha de entrega volta como `status: "failed"` e `error` |
| `POST /api/v1/contacts/:id/messages/file` | `conversations:reply`, no alcance | Multipart: campos `accountId`, `to`, `text`, `subject` antes do arquivo `file` (até 16 MB) |
| `POST /api/v1/contacts/:id/messages/seen` | `contacts:view` | Marca as recebidas como vistas |
| `POST /api/v1/messages/:id/media` | `contacts:view` | Busca no WhatsApp (Evolution) o arquivo de uma mensagem de mídia que chegou sem ele; devolve a mensagem com `file`. 409 `media-unavailable` se o WhatsApp não tiver mais o arquivo |
| `POST /api/v1/webhooks/evolution/:token` | Público; o token é a autorização | Avisos da Evolution. Token errado: 404 |

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
| `POST /api/v1/activities/:id/status` | `tasks:manage` | Concluir, reabrir ou cancelar; concluir marca o último contato dos registros ligados. Ligação e reunião aceitam `outcome` (`held`, `no_show`, `rescheduled`); sem ele, conta como realizada. Reabrir apaga o resultado |
| `GET /api/v1/notifications`; `POST /api/v1/notifications/read` | A própria pessoa | Avisos (lembretes, leads, importações) |
| `GET, POST /api/v1/records/:tipo/:id/notes`; `PATCH, DELETE /api/v1/notes/:id` | Ver ou editar o registro | Notas de contato, organização, negócio ou lead; só o autor edita o texto |
| `GET /api/v1/records/:tipo/:id/timeline` | Ver o registro | Linha do tempo, em ordem |
| `GET, POST /api/v1/records/:tipo/:id/files` | Ver ou editar o registro | Anexos (multipart, campo `file`): tipo conferido pelo conteúdo, até `UPLOAD_MAX_MB` |
| `GET /api/v1/files/:id/url`; `DELETE /api/v1/files/:id` | Ver ou editar o registro | Endereço assinado válido por 5 minutos; remoção |
| `GET /api/v1/files/download/:token` | Pública (o endereço assinado é a autorização) | Download sempre como anexo, com `sandbox` |
| `POST /api/v1/imports/upload?entity=`; `POST, GET /api/v1/imports`; `GET /api/v1/imports/:id`, `/errors`; `POST .../cancel` | `contacts:import_export` | Importação de CSV em lotes, com sugestão de colunas, opção para duplicados e aviso por linha |
| `GET /api/v1/privacy/contacts/:id/export`; `POST .../anonymize` | `privacy:execute` + 2FA | Direitos do titular, auditados |
| `GET /api/v1/dashboard?from=&to=&pipelineId=&ownerId=` | Cada bloco com a sua permissão | Indicadores de negócios, leads, agenda e contatos no alcance de quem vê |

