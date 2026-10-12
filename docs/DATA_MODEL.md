# Modelo de dados e isolamento

Um banco, um esquema, e `tenant_id` com política RLS forçada em toda tabela que guarda dado de cliente. Uma consulta sem contexto de empresa falha em vez de devolver tudo.

## Estratégia de isolamento

### Papéis

| Papel | Quem usa | O que pode |
| --- | --- | --- |
| `crm_owner` | Serviço `migrate`; dono das funções de autenticação | Dono das tabelas; único que altera estrutura |
| `crm_app` | API e worker | Ler e gravar dentro da empresa do contexto; sem `BYPASSRLS`, sem DDL |
| `crm_dispatch` | Despachante do outbox e agendador (Fase 3) | Escolher o próximo item entre empresas, só nas tabelas de infraestrutura |
| `crm_platform` | Administração global | Gerir `tenants` e `tenant_domains`; não lê dado de cliente |
| `crm_backup` | Serviço `backup` | Leitura completa para o `pg_dump` |

### Política padrão

```sql
alter table teams enable row level security;
alter table teams force row level security;

create policy tenant_isolation on teams for all to crm_app
  using      (tenant_id = (select app.tenant_id()))
  with check (tenant_id = (select app.tenant_id()));

-- Relações não cruzam empresas: a chave estrangeira leva a empresa junto.
foreign key (tenant_id, team_id) references teams (tenant_id, id)
```

O RLS cuida do isolamento entre empresas. O alcance dentro da empresa (próprios, equipe, todos) é conferido no caso de uso e nos filtros do repositório.

### Onde mais o contexto é obrigatório

| Camada | Regra |
| --- | --- |
| API | A empresa vem da sessão ou da chave de API, nunca do corpo ou da URL |
| Filas | Todo job carrega `tenant_id`; o processador abre o contexto antes de qualquer leitura |
| Arquivos | Chave do objeto prefixada pela empresa; URL assinada só depois de ler o registro sob RLS |
| Webhooks de entrada | O token do endereço identifica uma conta conectada, e dela sai a empresa |
| Webhooks de saída | Endereço, segredo e histórico pertencem a uma empresa |
| Tempo real | Canal por empresa, com filtro de permissão antes de cada envio |
| Relatórios e cache | Agregações sob RLS; a chave de cache inclui empresa e alcance |
| Logs | Campo `tenant_id` em toda linha |

## Convenções

- Identificadores UUID; a aplicação gera UUID v7 e o banco tem `gen_random_uuid()` como padrão de segurança.
- Datas em `timestamptz`, sempre UTC. Dinheiro em centavos inteiros com moeda. Telefones em E.164. E-mails em minúsculas.
- Campos personalizados: definições em tabela e valores em coluna `custom` (JSONB).
- Tabelas de log particionadas por mês, para aplicar retenção descartando partições. Cada partição nasce com RLS forçado e sem concessões: o acesso é pela tabela mãe.
- Todo índice de tabela de cliente começa por `tenant_id`.

## Tabelas implementadas

Migração `0001_fundacao`. Todas com RLS ligado e forçado.

| Tabela | Guarda | Acesso de `crm_app` |
| --- | --- | --- |
| `tenants` | Empresa: nome, slug, estado, fuso, idioma, módulos, limites | Lê a própria linha; altera nome, fuso e idioma |
| `tenant_domains` | Domínios e subdomínios de cada empresa | Isolamento padrão |
| `tenant_branding` | Nome do produto, tema atual e anterior, chaves dos arquivos de marca | Isolamento padrão |
| `users` | Identidade global por e-mail | Lê quem divide a empresa; não lê senha nem segredo de 2FA; altera só o próprio nome |
| `business_units` | Unidades | Isolamento padrão |
| `memberships` | Vínculo de um usuário com uma empresa | Isolamento padrão |
| `teams`, `team_members` | Equipes e papel na equipe | Isolamento padrão |
| `roles`, `role_permissions`, `membership_roles` | Perfis, permissões com alcance, perfis de cada vínculo | Isolamento padrão |
| `sessions` | Sessões: hash do token, validade, empresa escolhida, 2FA | Lista as próprias; criar, validar e revogar só por função |
| `invitations` | Convites, só com o hash do token | Isolamento padrão |
| `password_resets` | Pedidos de nova senha, só com o hash | Nenhum acesso direto |
| `api_keys` | Chaves de integração: prefixo, hash, escopos | Isolamento padrão |
| `auth_events` | Eventos de autenticação, por mês | Lê os da própria empresa; inserção só por função |
| `audit_log` | Auditoria, por mês | Lê e insere os da própria empresa; nunca altera ou apaga |

### Funções de autenticação

Rodam com os direitos de `crm_owner`, porque precisam olhar antes de existir contexto de empresa.

| Função | Para quê |
| --- | --- |
| `app.auth_find_user(email)` | Busca o usuário e o hash da senha no login |
| `app.auth_user_tenants(user_id)` | Empresas ativas em que a pessoa tem vínculo ativo |
| `app.auth_resolve_domain(domínio)` | Empresa e estado a partir do domínio |
| `app.auth_record_event(...)` | Registra evento de autenticação |
| `app.session_create(...)` | Abre sessão para usuário ativo |
| `app.session_find(hash)` | Devolve a sessão só se válida, com usuário, vínculo e empresa ativos |
| `app.session_set_tenant(sessão, empresa)` | Entra em uma empresa onde há vínculo ativo |
| `app.session_mark_mfa`, `session_touch`, `session_revoke`, `session_revoke_all` | Ciclo de vida da sessão |

## Tabelas planejadas

Entram com as migrações de cada fase e podem mudar quando as integrações forem testadas de verdade.

| Domínio | Tabelas | Fase |
| --- | --- | --- |
| CRM | `contacts`, `organizations`, `contact_emails`, `contact_phones`, `contact_addresses`, `contact_identities`, `external_ids`, `tags`, `taggings`, `custom_field_definitions`, `notes`, `consents`, `suppression_list`, `contact_merges`, `leads`, `attribution_touches`, `pipelines`, `pipeline_stages`, `pipeline_access`, `stage_transition_rules`, `deals`, `deal_participants`, `deal_stage_history`, `products`, `deal_items`, `outcome_reasons`, `assignment_rules`, `goals`, `saved_views`, `imports`, `import_rows`, `exports` | 2 |
| Atividades | `activities`, `activity_participants`, `activity_links`, `timeline_entries`, `notifications`, `notification_preferences` | 2 |
| Arquivos | `files` | 2 |
| Integração | `outbox_events`, `webhook_endpoints`, `webhook_deliveries`, `idempotency_keys`, `failed_jobs` | 3 |
| Canais e caixa de entrada | `channel_accounts`, `channel_account_access`, `conversations`, `conversation_assignments`, `conversation_notes`, `messages`, `message_events`, `message_attachments`, `inbound_events`, `quick_replies` | 4 |
| E-mail e mensagens | `email_message_details`, `email_sync_state`, `email_signatures`, `message_templates`, `scheduled_messages`, `campaigns`, `campaign_runs`, `campaign_recipients`, `sequences`, `sequence_steps`, `sequence_enrollments` | 5 |
| Automação, suporte, marketing | `automation_rules`, `automation_runs`, `automation_run_steps`, `tickets`, `ticket_events`, `ticket_comments`, `ticket_statuses`, `ticket_categories`, `sla_policies`, `csat_responses`, `lead_sources`, `segments`, `segment_members` | 7 |
| Relatórios | `dashboards`, `dashboard_widgets`, `agg_deals_daily`, `agg_conversations_daily`, `agg_leads_daily` | 2 e 7 |
