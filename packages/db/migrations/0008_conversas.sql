-- 0008_conversas
-- Conversas com estado, responsável e equipe (uma por contato e canal) e o
-- banco de respostas prontas de WhatsApp e e-mail.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- ---------------------------------------------------------------------------
-- Conversas
-- ---------------------------------------------------------------------------

create table conversations (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants (id) on delete cascade,
  contact_id              uuid not null,
  channel                 text not null check (channel in ('whatsapp', 'email')),
  -- open: precisa de atenção; waiting: aguardando o cliente; closed: encerrada.
  status                  text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  assignee_membership_id  uuid,
  team_id                 uuid,
  -- Início do atendimento atual (reabre quando o cliente escreve numa encerrada).
  opened_at               timestamptz not null default now(),
  first_response_at       timestamptz,
  last_message_at         timestamptz not null default now(),
  last_in_at              timestamptz,
  last_out_at             timestamptz,
  closed_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, contact_id, channel),
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignee_membership_id) references memberships (tenant_id, id) on delete set null (assignee_membership_id),
  foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete set null (team_id)
);
create index conversations_inbox_idx on conversations (tenant_id, last_message_at desc);
create index conversations_assignee_idx on conversations (tenant_id, assignee_membership_id, status);
create trigger conversations_updated_at before update on conversations
  for each row execute function app.set_updated_at();

alter table conversations enable row level security;
alter table conversations force row level security;
create policy tenant_isolation on conversations for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on conversations to crm_app;

-- Cada mensagem nova atualiza (ou cria) a conversa do contato naquele canal.
-- Responsável inicial: o dono do contato; senão, quem responder primeiro.
create function app.conversation_touch()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into conversations as c (tenant_id, contact_id, channel, opened_at, last_message_at, last_in_at, last_out_at,
                                  first_response_at, assignee_membership_id, team_id)
  select new.tenant_id, new.contact_id, new.channel, new.created_at, new.created_at,
         case when new.direction = 'in' then new.created_at end,
         case when new.direction = 'out' then new.created_at end,
         case when new.direction = 'out' and new.sent_by is not null then new.created_at end,
         coalesce(k.owner_membership_id, case when new.direction = 'out' then new.sent_by end), k.team_id
    from contacts k where k.id = new.contact_id
  on conflict (tenant_id, contact_id, channel) do update set
    last_message_at = greatest(c.last_message_at, excluded.last_message_at),
    last_in_at = case when new.direction = 'in' then greatest(c.last_in_at, new.created_at) else c.last_in_at end,
    last_out_at = case when new.direction = 'out' then greatest(c.last_out_at, new.created_at) else c.last_out_at end,
    -- O cliente escreveu: a conversa volta a pedir atenção; se estava encerrada, começa um atendimento novo.
    status = case when new.direction = 'in' then 'open' else c.status end,
    opened_at = case when new.direction = 'in' and c.status = 'closed' then new.created_at else c.opened_at end,
    closed_at = case when new.direction = 'in' then null else c.closed_at end,
    first_response_at = case
      when new.direction = 'in' and c.status = 'closed' then null
      when new.direction = 'out' and new.sent_by is not null then coalesce(c.first_response_at, new.created_at)
      else c.first_response_at end,
    assignee_membership_id = coalesce(c.assignee_membership_id, case when new.direction = 'out' then new.sent_by end);
  return null;
end
$$;
revoke all on function app.conversation_touch() from public;
create trigger messages_conversation after insert on messages
  for each row execute function app.conversation_touch();

-- Conversas das mensagens que já existem.
insert into conversations (tenant_id, contact_id, channel, opened_at, last_message_at, last_in_at, last_out_at,
                           first_response_at, assignee_membership_id, team_id)
select m.tenant_id, m.contact_id, m.channel, min(m.created_at), max(m.created_at),
       max(m.created_at) filter (where m.direction = 'in'), max(m.created_at) filter (where m.direction = 'out'),
       min(m.created_at) filter (where m.direction = 'out' and m.sent_by is not null),
       coalesce(k.owner_membership_id, (array_agg(m.sent_by order by m.created_at) filter (where m.sent_by is not null))[1]), k.team_id
  from messages m join contacts k on k.id = m.contact_id
 group by m.tenant_id, m.contact_id, m.channel, k.owner_membership_id, k.team_id;

-- ---------------------------------------------------------------------------
-- Respostas prontas
-- ---------------------------------------------------------------------------

create table quick_replies (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  channel              text not null check (channel in ('whatsapp', 'email')),
  -- Atalho digitado depois da barra: /boasvindas
  shortcut             text not null check (shortcut ~ '^[a-z0-9_-]{1,40}$'),
  title                text not null check (length(btrim(title)) between 1 and 120),
  subject              text check (subject is null or length(subject) <= 998),
  body                 text not null check (length(body) between 1 and 20000),
  -- Vazio: da empresa toda; preenchido: só dessa pessoa.
  owner_membership_id  uuid,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, owner_membership_id) references memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create unique index quick_replies_shortcut_idx on quick_replies
  (tenant_id, channel, coalesce(owner_membership_id, '00000000-0000-0000-0000-000000000000'::uuid), shortcut);
create trigger quick_replies_updated_at before update on quick_replies
  for each row execute function app.set_updated_at();

alter table quick_replies enable row level security;
alter table quick_replies force row level security;
create policy tenant_isolation on quick_replies for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on quick_replies to crm_app;
