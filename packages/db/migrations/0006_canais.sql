-- 0006_canais
-- Canais da empresa (WhatsApp pela Evolution API e e-mail por SMTP) e o
-- histórico de mensagens de cada contato.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- ---------------------------------------------------------------------------
-- Contas conectadas
-- ---------------------------------------------------------------------------

create table channel_accounts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  kind                text not null check (kind in ('whatsapp_evolution', 'email_smtp')),
  name                text not null check (length(name) between 1 and 120),
  status              text not null default 'pending'
                        check (status in ('pending', 'connecting', 'connected', 'disconnected', 'error')),
  -- Nome da instância na Evolution (WhatsApp). Único no servidor inteiro.
  external_id         text check (external_id is null or external_id ~ '^crmwta-[a-z0-9-]{4,60}$'),
  -- Número conectado (E.164) ou endereço de e-mail.
  address             text check (address is null or length(address) <= 254),
  -- Configuração sem segredo (servidor, porta, nome do remetente).
  config              jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  -- Segredo cifrado pela aplicação (senha do SMTP).
  secret              bytea,
  -- Webhook de entrada: o banco guarda só o SHA-256 do token do endereço.
  webhook_token_hash  bytea unique check (webhook_token_hash is null or length(webhook_token_hash) = 32),
  last_error          text check (last_error is null or length(last_error) <= 1000),
  connected_at        timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create unique index channel_accounts_external_idx on channel_accounts (external_id) where external_id is not null;
create index channel_accounts_tenant_idx on channel_accounts (tenant_id, kind);
create trigger channel_accounts_updated_at before update on channel_accounts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Mensagens (WhatsApp e e-mail), enviadas e recebidas
-- ---------------------------------------------------------------------------

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  channel_account_id  uuid,
  channel             text not null check (channel in ('whatsapp', 'email')),
  direction           text not null check (direction in ('in', 'out')),
  status              text not null check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  contact_id          uuid not null,
  deal_id             uuid,
  -- Identificador da mensagem no WhatsApp ou Message-ID do e-mail.
  external_id         text check (external_id is null or length(external_id) <= 300),
  -- Número ou e-mail do outro lado.
  remote              text not null check (length(remote) between 3 and 254),
  subject             text check (subject is null or length(subject) <= 998),
  body                text check (body is null or length(body) <= 65536),
  -- Tipo da mensagem: text, image, audio, video, document, sticker, location, contact, other.
  kind                text not null default 'text' check (kind ~ '^[a-z]{2,20}$'),
  file_id             uuid,
  error               text check (error is null or length(error) <= 1000),
  sent_by             uuid,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  -- Mensagem recebida já aberta por alguém da empresa.
  seen_at             timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete set null (channel_account_id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete set null (deal_id),
  foreign key (tenant_id, file_id) references files (tenant_id, id) on delete set null (file_id),
  foreign key (tenant_id, sent_by) references memberships (tenant_id, id) on delete set null (sent_by)
);
-- A mesma mensagem (eco do envio, aviso repetido) entra uma vez só.
create unique index messages_external_idx on messages (channel_account_id, external_id)
  where external_id is not null and channel_account_id is not null;
create index messages_contact_idx on messages (tenant_id, contact_id, created_at desc);
create index messages_recent_idx on messages (tenant_id, created_at desc);
create index messages_unseen_idx on messages (tenant_id, contact_id) where direction = 'in' and seen_at is null;

-- Arquivos que chegam ou saem nas mensagens.
alter table files drop constraint files_purpose_check;
alter table files add constraint files_purpose_check check (purpose in ('attachment', 'import', 'branding', 'message'));

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------

alter table channel_accounts enable row level security;
alter table channel_accounts force row level security;
alter table messages enable row level security;
alter table messages force row level security;

create policy tenant_isolation on channel_accounts for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
create policy tenant_isolation on messages for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on channel_accounts, messages to crm_app;

-- Exclusão de empresa pela plataforma leva junto contas e mensagens (cascata).

-- Webhook de entrada: de qual empresa e conta é o token. Só empresas ativas.
create function app.channel_by_webhook(p_token_hash bytea)
returns table (tenant_id uuid, account_id uuid, kind text, external_id text)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select a.tenant_id, a.id, a.kind, a.external_id
  from public.channel_accounts a
  join public.tenants t on t.id = a.tenant_id and t.status = 'active'
  where a.webhook_token_hash = p_token_hash
$$;
revoke all on function app.channel_by_webhook(bytea) from public;
grant execute on function app.channel_by_webhook(bytea) to crm_app;
