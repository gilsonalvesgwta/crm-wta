-- 0011_meta
-- Canais da Meta: WhatsApp pela API oficial (Cloud API) com modelos de
-- mensagem, e Instagram (mensagens diretas). O contato do Instagram é
-- identificado pelo id da pessoa no Instagram (IGSID), guardado à parte.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- Tipos de conta e canais novos.
alter table channel_accounts drop constraint channel_accounts_kind_check;
alter table channel_accounts add constraint channel_accounts_kind_check
  check (kind in ('whatsapp_evolution', 'whatsapp_cloud', 'email_smtp', 'instagram'));
alter table channel_accounts drop constraint channel_accounts_external_id_check;
alter table channel_accounts add constraint channel_accounts_external_id_check check (
  external_id is null
  or (kind = 'whatsapp_evolution' and external_id ~ '^crmwta-[a-z0-9-]{4,60}$')
  or (kind in ('whatsapp_cloud', 'instagram') and external_id ~ '^[0-9]{5,30}$'));

alter table messages drop constraint messages_channel_check;
alter table messages add constraint messages_channel_check check (channel in ('whatsapp', 'email', 'instagram'));
alter table conversations drop constraint conversations_channel_check;
alter table conversations add constraint conversations_channel_check check (channel in ('whatsapp', 'email', 'instagram'));
alter table quick_replies drop constraint quick_replies_channel_check;
alter table quick_replies add constraint quick_replies_channel_check check (channel in ('whatsapp', 'email', 'instagram'));
alter table scheduled_messages drop constraint scheduled_messages_channel_check;
alter table scheduled_messages add constraint scheduled_messages_channel_check check (channel in ('whatsapp', 'email', 'instagram'));

-- ---------------------------------------------------------------------------
-- Identidades do contato em redes sociais (Instagram)
-- ---------------------------------------------------------------------------

create table contact_handles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  contact_id  uuid not null,
  kind        text not null check (kind in ('instagram')),
  -- Id da pessoa no canal (IGSID): é para ele que a resposta vai.
  value       text not null check (value ~ '^[0-9]{5,40}$'),
  username    text check (username is null or username ~ '^[A-Za-z0-9._]{1,60}$'),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, kind, value),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade
);
create index contact_handles_contact_idx on contact_handles (contact_id);

alter table contact_handles enable row level security;
alter table contact_handles force row level security;
create policy tenant_isolation on contact_handles for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on contact_handles to crm_app;

-- ---------------------------------------------------------------------------
-- Modelos de mensagem do WhatsApp oficial (aprovados pela Meta)
-- ---------------------------------------------------------------------------

create table whatsapp_templates (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  channel_account_id  uuid not null,
  meta_id             text check (meta_id is null or meta_id ~ '^[0-9]{1,40}$'),
  name                text not null check (name ~ '^[a-z0-9_]+$' and length(name) <= 512),
  language            text not null check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  category            text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  header              text check (header is null or length(header) <= 60),
  body                text not null check (length(body) between 1 and 1024),
  footer              text check (footer is null or length(footer) <= 60),
  -- [{"type": "QUICK_REPLY", "text": "Quero saber mais"}]
  buttons             jsonb not null default '[]'::jsonb check (jsonb_typeof(buttons) = 'array'),
  -- Exemplos das variáveis {{1}}, {{2}}… (a Meta pede para aprovar).
  examples            jsonb not null default '[]'::jsonb check (jsonb_typeof(examples) = 'array'),
  status              text not null default 'PENDING'
                        check (status in ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'LIMIT_EXCEEDED', 'DELETED')),
  reason              text check (reason is null or length(reason) <= 1000),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (channel_account_id, name, language),
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create trigger whatsapp_templates_updated_at before update on whatsapp_templates
  for each row execute function app.set_updated_at();

alter table whatsapp_templates enable row level security;
alter table whatsapp_templates force row level security;
create policy tenant_isolation on whatsapp_templates for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on whatsapp_templates to crm_app;

-- Campanha pelo WhatsApp oficial: sai com um modelo aprovado.
alter table campaigns add column template_id uuid;
alter table campaigns add column template_params jsonb not null default '[]'::jsonb check (jsonb_typeof(template_params) = 'array');
alter table campaigns add constraint campaigns_template_fk
  foreign key (tenant_id, template_id) references whatsapp_templates (tenant_id, id) on delete set null (template_id);
