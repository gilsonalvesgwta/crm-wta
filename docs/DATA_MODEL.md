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

### Fundação (Fase 1)

Migrações `0001_fundacao`, `0002_autenticacao` e `0003_nomes_unicos`. Todas com RLS ligado e forçado.

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
| `mfa_recovery_codes` | Códigos de recuperação do 2FA, só o hash | Nenhum acesso direto |

Perfis e equipes têm nome único por empresa, sem diferenciar maiúsculas.

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
| `app.session_mark_mfa`, `session_touch`, `session_revoke`, `session_revoke_all`, `session_revoke_own` | Ciclo de vida da sessão |
| `app.auth_user_profile`, `auth_password_hash`, `auth_set_password` | Perfil e senha |
| `app.auth_failure_counts` | Falhas recentes por e-mail e por IP, para o bloqueio |
| `app.auth_totp_*`, `auth_use_recovery_code`, `auth_recovery_codes_left` | Verificação em duas etapas |
| `app.auth_password_reset_create`, `auth_password_reset_consume` | Nova senha por link, com no máximo 3 pedidos em 10 minutos |
| `app.auth_invitation_info`, `auth_invitation_accept` | Convites |

### CRM comercial (Fase 2)

Migração `0004_crm`. Todas com RLS ligado e forçado, isolamento por `tenant_id` e chaves estrangeiras compostas.

| Tabela | Guarda | Acesso de `crm_app` |
| --- | --- | --- |
| `organizations` | Organizações: nome, razão social, documento, domínio, contato, endereço, responsável, equipe, campos | Isolamento padrão |
| `contacts` | Pessoas: nome e sobrenome (nome completo gerado), cargo, organização, documento, aniversário com ano opcional, endereço, responsável, equipe, campos, marca de anonimização | Isolamento padrão |
| `contact_emails`, `contact_phones` | Vários e-mails (minúsculos) e telefones (E.164) por contato, um principal | Isolamento padrão |
| `tags`, `contact_tags`, `organization_tags`, `deal_tags` | Etiquetas com cor, nome único por empresa | Isolamento padrão |
| `custom_field_definitions` | Campos personalizados por entidade: chave, tipo, opções, obrigatório, arquivado | Isolamento padrão |
| `pipelines`, `pipeline_access` | Funis e a lista de pessoas e equipes de um funil restrito | Isolamento padrão |
| `pipeline_stages`, `stage_transition_rules` | Etapas (posição, cor, probabilidade, tipo aberto, ganho ou perda, campos exigidos, prazo de inatividade) e transições permitidas | Isolamento padrão |
| `products`, `outcome_reasons` | Produtos com preço em centavos; motivos de ganho e perda | Isolamento padrão |
| `leads`, `assignment_rules`, `assignment_rule_members` | Leads ligados a um contato; roteiros de rodízio com a posição do último escolhido | Isolamento padrão |
| `deals`, `deal_participants`, `deal_items` | Negócios (a etapa precisa ser do funil do negócio, garantido por chave composta), participantes e itens | Isolamento padrão |
| `deal_stage_history` | Toda mudança de etapa, com tempo na anterior, gravada por gatilho | Lê e insere; nunca altera |
| `notes` | Notas de contato, organização, negócio ou lead | Isolamento padrão |
| `timeline_entries` | Linha do tempo: tipo do evento, ator e identificadores, sem valores pessoais | Lê, insere e apaga (anonimização); nunca altera |
| `attribution_touches` | Pontos de origem: UTMs, identificadores de clique, página. A primeira origem é a linha mais antiga | Lê, insere e apaga (anonimização); nunca altera |
| `consents` | Consentimento por canal e finalidade, com origem e evidência; vale o mais recente | Lê e insere; nunca altera nem apaga |
| `suppression_list` | Endereços que não recebem mensagem (opt-out, devolução, reclamação) | Isolamento padrão |
| `contact_merges` | Cópia do contato mesclado e quem mesclou | Lê e insere |
| `activities`, `activity_series` | Tarefas e compromissos, com lembrete calculado pelo banco; séries recorrentes e até onde já foram criadas | Isolamento padrão |
| `notifications` | Avisos para uma pessoa | Insere para qualquer pessoa da empresa; lê e marca como lidas só as próprias |
| `files` | Arquivos: chave de armazenamento iniciada pela empresa, tipo conferido, tamanho, hash, registro ao qual pertencem | Isolamento padrão |
| `imports`, `import_rows` | Importações em lotes, progresso e resultado de cada linha | Isolamento padrão |
| `exports` | Registro de cada exportação: quem, o quê, filtros e linhas | Lê e insere; nunca altera nem apaga |
| `saved_views` | Filtros salvos de uma pessoa, compartilháveis | Vê as próprias e as compartilhadas; altera só as próprias |

Gatilhos: o status, a data de fechamento e o histórico do negócio acompanham a etapa; o horário do lembrete acompanha o início da atividade e é rearmado quando ele muda.

### Despachante

O papel `crm_dispatch` não lê tabela alguma. Ele só executa três funções que escolhem o próximo item entre empresas e devolvem identificadores:

| Função | Para quê |
| --- | --- |
| `app.claim_due_reminders(limite)` | Lembretes vencidos, marcados como enviados na mesma operação |
| `app.claim_import(segundos)` | Próxima importação pendente, ou em andamento com a trava vencida |
| `app.series_needing_extension(até, limite)` | Séries recorrentes com o horizonte curto |

O processamento de cada item acontece depois, no contexto da empresa, como `crm_app`. Empresa suspensa não recebe lembrete nem tem importação processada.

### Busca

`app.norm(texto)` devolve o texto em minúsculas e sem acentos (extensão `unaccent`), com índice de trigramas (`pg_trgm`) em nomes de contato, organização e negócio.

## Tabelas planejadas

Entram com as migrações de cada fase e podem mudar quando as integrações forem testadas de verdade.

| Domínio | Tabelas | Fase |
| --- | --- | --- |
| CRM, depois da Fase 2 | `contact_identities` e `external_ids` (identidades de canal, Fase 4), `goals` (metas, Fase 7), `activity_participants` e `notification_preferences` | 4 e 7 |
| Integração | `outbox_events`, `webhook_endpoints`, `webhook_deliveries`, `idempotency_keys`, `failed_jobs` | 3 |
| Canais e caixa de entrada | `channel_accounts`, `channel_account_access`, `conversations`, `conversation_assignments`, `conversation_notes`, `messages`, `message_events`, `message_attachments`, `inbound_events`, `quick_replies` | 4 |
| E-mail e mensagens | `email_message_details`, `email_sync_state`, `email_signatures`, `message_templates`, `scheduled_messages`, `campaigns`, `campaign_runs`, `campaign_recipients`, `sequences`, `sequence_steps`, `sequence_enrollments` | 5 |
| Automação, suporte, marketing | `automation_rules`, `automation_runs`, `automation_run_steps`, `tickets`, `ticket_events`, `ticket_comments`, `ticket_statuses`, `ticket_categories`, `sla_policies`, `csat_responses`, `lead_sources`, `segments`, `segment_members` | 7 |
| Relatórios | `dashboards`, `dashboard_widgets`, `agg_deals_daily`, `agg_conversations_daily`, `agg_leads_daily` | 2 e 7 |
