-- 0009_campanhas
-- Campanhas: envio em massa de WhatsApp ou e-mail para um público escolhido,
-- espaçado no tempo, respeitando a lista de supressão (e o consentimento,
-- quando pedido). Executadas pelo despachante.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

create table campaigns (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 120),
  description         text check (description is null or length(description) <= 1000),
  channel             text not null check (channel in ('whatsapp', 'email')),
  -- draft → scheduled → sending → done; sending ↔ paused; qualquer um (menos done) → canceled.
  status              text not null default 'draft'
                        check (status in ('draft', 'scheduled', 'sending', 'paused', 'done', 'canceled')),
  -- {"tagIds": [], "excludeTagIds": [], "ownerIds": [], "teamIds": [], "pipelineId": null, "stageId": null,
  --  "sources": [], "contactIds": [], "createdFrom": null, "createdTo": null, "consentOnly": false}
  audience            jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  channel_account_id  uuid,
  subject             text check (subject is null or length(subject) <= 998),
  body                text check (body is null or length(body) <= 20000),
  file_id             uuid,
  -- Ritmo: mensagens por minuto e janela de horário (no fuso da empresa).
  per_minute          int not null default 10 check (per_minute between 1 and 120),
  window_start        time,
  window_end          time,
  -- WhatsApp: acrescenta "responda SAIR para não receber mais" ao fim da mensagem.
  opt_out_hint        boolean not null default true,
  scheduled_at        timestamptz,
  -- Motivo da última pausa automática (conta desconectada, por exemplo).
  last_error          text check (last_error is null or length(last_error) <= 1000),
  next_at             timestamptz,
  prepared_at         timestamptz,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_by          uuid,
  started_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  check ((window_start is null) = (window_end is null)),
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete set null (channel_account_id),
  foreign key (tenant_id, file_id) references files (tenant_id, id) on delete set null (file_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by),
  foreign key (tenant_id, started_by) references memberships (tenant_id, id) on delete set null (started_by)
);
create index campaigns_tenant_idx on campaigns (tenant_id, created_at desc);
create index campaigns_due_idx on campaigns (next_at) where status in ('scheduled', 'sending');
create trigger campaigns_updated_at before update on campaigns
  for each row execute function app.set_updated_at();

create table campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  campaign_id  uuid not null,
  contact_id   uuid not null,
  -- Telefone (E.164) ou e-mail no momento em que o público foi montado.
  address      text not null check (length(address) between 3 and 254),
  status       text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  reason       text check (reason is null or length(reason) <= 500),
  message_id   uuid,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (campaign_id, contact_id),
  foreign key (tenant_id, campaign_id) references campaigns (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, message_id) references messages (tenant_id, id) on delete set null (message_id)
);
create index campaign_recipients_status_idx on campaign_recipients (campaign_id, status);

alter table messages add column campaign_id uuid;
alter table messages add constraint messages_campaign_fk
  foreign key (tenant_id, campaign_id) references campaigns (tenant_id, id) on delete set null (campaign_id);
create index messages_campaign_idx on messages (campaign_id) where campaign_id is not null;

alter table campaigns enable row level security;
alter table campaigns force row level security;
alter table campaign_recipients enable row level security;
alter table campaign_recipients force row level security;
create policy tenant_isolation on campaigns for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
create policy tenant_isolation on campaign_recipients for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on campaigns, campaign_recipients to crm_app;

-- Campanhas na vez: agendadas cuja hora chegou e em envio cujo próximo lote
-- venceu, de empresa ativa e dentro da janela de horário. Reservadas por 2
-- minutos (o serviço marca a próxima vez ao terminar o lote).
create function app.campaign_claim(p_limit int)
returns table (tenant_id uuid, campaign_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select c.id from campaigns c
    join tenants t on t.id = c.tenant_id and t.status = 'active'
    where ((c.status = 'scheduled' and c.scheduled_at <= now()) or (c.status = 'sending' and coalesce(c.next_at, now()) <= now()))
      and (c.window_start is null or (
        case when c.window_start <= c.window_end
          then (now() at time zone t.timezone)::time between c.window_start and c.window_end
          else (now() at time zone t.timezone)::time >= c.window_start or (now() at time zone t.timezone)::time <= c.window_end end))
    order by coalesce(c.next_at, c.scheduled_at)
    limit greatest(least(p_limit, 50), 1)
    for update of c skip locked
  )
  update campaigns c set status = 'sending', next_at = now() + interval '2 minutes',
                         started_at = coalesce(c.started_at, now())
  from due where c.id = due.id
  returning c.tenant_id, c.id
$$;
revoke all on function app.campaign_claim(int) from public;
grant execute on function app.campaign_claim(int) to crm_dispatch;
