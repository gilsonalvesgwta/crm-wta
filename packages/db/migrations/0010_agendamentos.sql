-- 0010_agendamentos
-- Mensagens agendadas: WhatsApp ou e-mail escrito por alguém da empresa para
-- sair numa data e hora. Enviadas pelo despachante.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

create table scheduled_messages (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants (id) on delete cascade,
  contact_id            uuid not null,
  channel_account_id    uuid,
  channel               text not null check (channel in ('whatsapp', 'email')),
  -- Telefone ou e-mail escolhido (vazio: o principal na hora do envio).
  remote                text check (remote is null or length(remote) between 3 and 254),
  subject               text check (subject is null or length(subject) <= 998),
  body                  text not null check (length(body) between 1 and 20000),
  send_at               timestamptz not null,
  status                text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'canceled')),
  error                 text check (error is null or length(error) <= 1000),
  message_id            uuid,
  -- Quem agendou (alcance de "scheduled:manage").
  owner_membership_id   uuid,
  team_id               uuid,
  locked_until          timestamptz,
  sent_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete set null (channel_account_id),
  foreign key (tenant_id, message_id) references messages (tenant_id, id) on delete set null (message_id),
  foreign key (tenant_id, owner_membership_id) references memberships (tenant_id, id) on delete set null (owner_membership_id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id)
);
create index scheduled_messages_due_idx on scheduled_messages (send_at) where status = 'pending';
create index scheduled_messages_tenant_idx on scheduled_messages (tenant_id, send_at);
create trigger scheduled_messages_updated_at before update on scheduled_messages
  for each row execute function app.set_updated_at();

alter table scheduled_messages enable row level security;
alter table scheduled_messages force row level security;
create policy tenant_isolation on scheduled_messages for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on scheduled_messages to crm_app;

-- Mensagens agendadas vencidas, de empresa ativa, reservadas por 5 minutos.
create function app.scheduled_claim(p_limit int)
returns table (tenant_id uuid, scheduled_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select s.id from scheduled_messages s
    join tenants t on t.id = s.tenant_id and t.status = 'active'
    where (s.status = 'pending' and s.send_at <= now())
       or (s.status = 'sending' and s.locked_until < now())
    order by s.send_at
    limit greatest(least(p_limit, 200), 1)
    for update of s skip locked
  )
  update scheduled_messages s set status = 'sending', locked_until = now() + interval '5 minutes'
  from due where s.id = due.id
  returning s.tenant_id, s.id
$$;
revoke all on function app.scheduled_claim(int) from public;
grant execute on function app.scheduled_claim(int) to crm_dispatch;
