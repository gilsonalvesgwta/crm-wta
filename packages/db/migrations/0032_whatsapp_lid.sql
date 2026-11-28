-- 0032_whatsapp_lid
-- O WhatsApp passou a endereçar parte das conversas por um identificador
-- privado (@lid) em vez do número. Quando um aviso traz os dois, o CRM guarda a
-- relação para reconhecer as próximas mensagens (inclusive as mandadas pelo
-- celular) que chegarem só com o @lid.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

create table whatsapp_lids (
  channel_account_id uuid not null,
  lid                text not null check (lid ~ '^[0-9]{5,25}$'),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  e164               text not null check (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at         timestamptz not null default now(),
  primary key (channel_account_id, lid),
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete cascade
);
create index whatsapp_lids_e164_idx on whatsapp_lids (channel_account_id, e164);
alter table whatsapp_lids enable row level security;
alter table whatsapp_lids force row level security;
create policy tenant_isolation on whatsapp_lids for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on whatsapp_lids to crm_app;
