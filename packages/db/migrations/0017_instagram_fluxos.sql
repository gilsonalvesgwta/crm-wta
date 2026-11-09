-- 0017_instagram_fluxos
-- Fluxos de conversa automáticos no Instagram (estilo Manychat): um gatilho
-- (comentário em post/reels, comentário em live, palavra no direct, resposta a
-- story, menção em story, reação a mensagem) e os passos ligados entre si.
-- Execuções por pessoa, eventos para os resultados, registro dos avisos para o
-- diagnóstico e a biblioteca de mídia.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- ---------------------------------------------------------------------------
-- Biblioteca de mídia: arquivos guardados no CRM para os blocos dos fluxos.
-- ---------------------------------------------------------------------------

alter table files drop constraint files_purpose_check;
alter table files add constraint files_purpose_check check (purpose in ('attachment', 'import', 'branding', 'message', 'media'));
create index files_media_idx on files (tenant_id, created_at desc) where purpose = 'media' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Fluxos
-- ---------------------------------------------------------------------------

create table ig_flows (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  -- Conta do Instagram (Configurações › Canais) onde o fluxo funciona.
  channel_account_id  uuid not null,
  name                text not null check (length(btrim(name)) between 1 and 80),
  trigger_type        text not null check (trigger_type in ('comment', 'live_comment', 'dm_keyword', 'story_reply', 'story_mention', 'reaction')),
  -- Rascunho: o que está na tela, salvo sozinho. {"trigger": {...}, "nodes": [...], "edges": [...]}
  draft               jsonb not null check (jsonb_typeof(draft) = 'object'),
  -- Publicado: o que roda. Nulo enquanto nunca foi publicado.
  published           jsonb check (published is null or jsonb_typeof(published) = 'object'),
  version             int not null default 0,
  -- draft: nunca publicado; active: rodando; paused: publicado mas parado.
  status              text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  published_at        timestamptz,
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  check (status = 'draft' or published is not null),
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by),
  foreign key (tenant_id, updated_by) references memberships (tenant_id, id) on delete set null (updated_by)
);
create index ig_flows_active_idx on ig_flows (channel_account_id, trigger_type) where status = 'active';
create trigger ig_flows_updated_at before update on ig_flows
  for each row execute function app.set_updated_at();
alter table ig_flows enable row level security;
alter table ig_flows force row level security;
create policy tenant_isolation on ig_flows for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on ig_flows to crm_app;

-- ---------------------------------------------------------------------------
-- Execuções: uma pessoa passando por um fluxo.
-- ---------------------------------------------------------------------------

create table ig_flow_runs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  flow_id             uuid not null,
  flow_version        int not null,
  channel_account_id  uuid not null,
  contact_id          uuid,
  -- Id da pessoa no Instagram (IGSID).
  ig_user_id          text not null check (ig_user_id ~ '^[0-9]{3,40}$'),
  -- running: andando; waiting: esperando clique, resposta ou tempo; done; failed; canceled.
  status              text not null default 'running' check (status in ('running', 'waiting', 'done', 'failed', 'canceled')),
  node_id             text check (node_id is null or length(node_id) <= 64),
  wait_kind           text check (wait_kind is null or wait_kind in ('click', 'reply', 'delay')),
  wake_at             timestamptz,
  -- Comentário, publicação, texto que disparou e respostas guardadas.
  context             jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  vars                jsonb not null default '{}'::jsonb check (jsonb_typeof(vars) = 'object'),
  attempts            int not null default 0,
  last_error          text check (last_error is null or length(last_error) <= 1000),
  locked_until        timestamptz,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, flow_id) references ig_flows (tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete set null (contact_id)
);
create index ig_flow_runs_waiting_idx on ig_flow_runs (channel_account_id, ig_user_id) where status = 'waiting';
create index ig_flow_runs_due_idx on ig_flow_runs (wake_at) where status = 'waiting' and wake_at is not null;
create index ig_flow_runs_flow_idx on ig_flow_runs (tenant_id, flow_id, started_at desc);
create trigger ig_flow_runs_updated_at before update on ig_flow_runs
  for each row execute function app.set_updated_at();
alter table ig_flow_runs enable row level security;
alter table ig_flow_runs force row level security;
create policy tenant_isolation on ig_flow_runs for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on ig_flow_runs to crm_app;

-- ---------------------------------------------------------------------------
-- Eventos: o que aconteceu em cada passo (para os resultados).
-- ---------------------------------------------------------------------------

create table ig_flow_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references tenants (id) on delete cascade,
  flow_id     uuid not null,
  run_id      uuid,
  node_id     text check (node_id is null or length(node_id) <= 64),
  -- triggered, sent, clicked, answered, completed, failed, skipped
  kind        text not null check (kind in ('triggered', 'sent', 'clicked', 'answered', 'completed', 'failed', 'skipped')),
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, flow_id) references ig_flows (tenant_id, id) on delete cascade,
  foreign key (tenant_id, run_id) references ig_flow_runs (tenant_id, id) on delete cascade
);
create index ig_flow_events_flow_idx on ig_flow_events (tenant_id, flow_id, created_at desc);
alter table ig_flow_events enable row level security;
alter table ig_flow_events force row level security;
create policy tenant_isolation on ig_flow_events for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, delete on ig_flow_events to crm_app;
grant usage on sequence ig_flow_events_id_seq to crm_app;

-- Quem já passou pelo fluxo (para "uma vez por pessoa" ou "uma vez por publicação").
create table ig_trigger_log (
  tenant_id   uuid not null references tenants (id) on delete cascade,
  flow_id     uuid not null,
  ig_user_id  text not null,
  -- Vazio: por pessoa; preenchido: por publicação (id do post/reels).
  scope       text not null default '',
  created_at  timestamptz not null default now(),
  primary key (flow_id, ig_user_id, scope),
  foreign key (tenant_id, flow_id) references ig_flows (tenant_id, id) on delete cascade
);
alter table ig_trigger_log enable row level security;
alter table ig_trigger_log force row level security;
create policy tenant_isolation on ig_trigger_log for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, delete on ig_trigger_log to crm_app;

-- Avisos recebidos do Instagram (diagnóstico): os últimos de cada conta.
create table ig_webhook_log (
  id                  bigint generated always as identity primary key,
  tenant_id           uuid not null references tenants (id) on delete cascade,
  channel_account_id  uuid not null,
  -- Evento já tratado (o mesmo aviso pode chegar duas vezes).
  event_key           text not null check (length(event_key) between 1 and 200),
  kind                text not null check (length(kind) between 1 and 40),
  summary             text check (summary is null or length(summary) <= 300),
  flow_id             uuid,
  outcome             text check (outcome is null or length(outcome) <= 300),
  created_at          timestamptz not null default now(),
  unique (channel_account_id, event_key),
  foreign key (tenant_id, channel_account_id) references channel_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, flow_id) references ig_flows (tenant_id, id) on delete set null (flow_id)
);
create index ig_webhook_log_recent_idx on ig_webhook_log (tenant_id, channel_account_id, created_at desc);
alter table ig_webhook_log enable row level security;
alter table ig_webhook_log force row level security;
create policy tenant_isolation on ig_webhook_log for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on ig_webhook_log to crm_app;
grant usage on sequence ig_webhook_log_id_seq to crm_app;

-- Mensagem enviada por um fluxo (aparece em Conversas com o nome do fluxo).
alter table messages add column ig_flow_id uuid;
alter table messages add constraint messages_ig_flow_fk foreign key (tenant_id, ig_flow_id) references ig_flows (tenant_id, id) on delete set null (ig_flow_id);

-- Execuções com tempo vencido (passo "Esperar" ou tempo de espera de clique/resposta), de empresa ativa.
create function app.ig_runs_due(p_limit int)
returns table (tenant_id uuid, run_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select r.id from ig_flow_runs r
    join tenants t on t.id = r.tenant_id and t.status = 'active'
    where r.status = 'waiting' and r.wake_at is not null and r.wake_at <= now()
      and (r.locked_until is null or r.locked_until < now())
    order by r.wake_at
    limit greatest(least(p_limit, 200), 1)
    for update of r skip locked
  )
  update ig_flow_runs r set locked_until = now() + interval '2 minutes'
  from due where r.id = due.id
  returning r.tenant_id, r.id
$$;
revoke all on function app.ig_runs_due(int) from public;
grant execute on function app.ig_runs_due(int) to crm_dispatch;
