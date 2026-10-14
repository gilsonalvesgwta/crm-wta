-- 0007_automacoes
-- Automações (regras com gatilho, filtros e ações, executadas pelo
-- despachante) e chaves de API para integrações como o n8n.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- ---------------------------------------------------------------------------
-- Regras e execuções
-- ---------------------------------------------------------------------------

create table automation_rules (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 120),
  active         boolean not null default true,
  -- {"type": "deal.stage_changed", "stageId": "..."} | {"type": "birthday", "time": "09:00"} | ...
  trigger        jsonb not null check (jsonb_typeof(trigger) = 'object' and trigger ? 'type'),
  -- {"pipelineId": ..., "stageId": ..., "source": ..., "tagId": ...}
  filters        jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  -- [{"type": "send_whatsapp", ...}, {"type": "wait", "minutes": 60}, ...]
  actions        jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 20),
  -- Eventos da linha do tempo já considerados (a regra não age sobre o passado).
  last_event_at  timestamptz not null default now(),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index automation_rules_active_idx on automation_rules ((trigger->>'type')) where active;
create trigger automation_rules_updated_at before update on automation_rules
  for each row execute function app.set_updated_at();

create table automation_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  rule_id      uuid not null,
  -- O que disparou: o evento da linha do tempo ou a chave do agendamento. Uma vez só.
  source_key   text not null check (length(source_key) between 1 and 200),
  contact_id   uuid,
  deal_id      uuid,
  lead_id      uuid,
  status       text not null default 'pending'
                 check (status in ('pending', 'waiting', 'running', 'done', 'failed', 'skipped')),
  step         int not null default 0 check (step >= 0),
  next_at      timestamptz not null default now(),
  log          jsonb not null default '[]'::jsonb check (jsonb_typeof(log) = 'array'),
  error        text check (error is null or length(error) <= 1000),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  unique (tenant_id, id),
  unique (rule_id, source_key),
  foreign key (tenant_id, rule_id) references automation_rules (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references leads (tenant_id, id) on delete cascade
);
create index automation_runs_due_idx on automation_runs (next_at) where status in ('pending', 'waiting', 'running');
create index automation_runs_rule_idx on automation_runs (tenant_id, rule_id, created_at desc);

-- Mensagem enviada por uma automação.
alter table messages add column automation_rule_id uuid;
alter table messages add constraint messages_automation_fk
  foreign key (tenant_id, automation_rule_id) references automation_rules (tenant_id, id) on delete set null (automation_rule_id);

alter table automation_rules enable row level security;
alter table automation_rules force row level security;
alter table automation_runs enable row level security;
alter table automation_runs force row level security;
create policy tenant_isolation on automation_rules for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
create policy tenant_isolation on automation_runs for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on automation_rules, automation_runs to crm_app;

-- ---------------------------------------------------------------------------
-- Despachante: eventos viram execuções, agendamentos viram execuções, e as
-- execuções vencidas são reservadas (SKIP LOCKED).
-- ---------------------------------------------------------------------------

-- Gatilhos de evento: cada evento novo da linha do tempo, do tipo da regra,
-- vira uma execução (uma vez só, pela chave). O cursor da regra avança.
create function app.automation_scan_events()
returns int
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  v_until timestamptz := clock_timestamp() - interval '2 seconds';
  v_n int := 0;
  v_c int;
begin
  for r in
    select a.id, a.tenant_id, a.trigger->>'type' as kind, a.last_event_at
      from automation_rules a
      join tenants t on t.id = a.tenant_id and t.status = 'active'
     where a.active and a.trigger->>'type' in
       ('contact.created', 'lead.created', 'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost', 'message.received')
     for update of a skip locked
  loop
    insert into automation_runs (tenant_id, rule_id, source_key, contact_id, deal_id, lead_id)
    select e.tenant_id, r.id, 'evento:' || e.id::text, e.contact_id, e.deal_id, e.lead_id
      from timeline_entries e
     where e.tenant_id = r.tenant_id and e.kind = r.kind
       and e.occurred_at > r.last_event_at and e.occurred_at <= v_until
       -- Mensagem que uma automação mandou não dispara outra automação.
       and not (e.kind = 'message.received' and coalesce(e.data->>'automation', '') <> '')
    on conflict (rule_id, source_key) do nothing;
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
    update automation_rules set last_event_at = v_until where id = r.id and last_event_at < v_until;
  end loop;
  return v_n;
end
$$;

-- Gatilhos agendados: aniversário (no horário da regra, no fuso da empresa) e
-- negócio parado há N dias.
create function app.automation_scan_schedules()
returns int
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  v_local timestamp;
  v_today date;
  v_n int := 0;
  v_c int;
begin
  for r in
    select a.id, a.tenant_id, a.trigger, a.filters, t.timezone
      from automation_rules a
      join tenants t on t.id = a.tenant_id and t.status = 'active'
     where a.active and a.trigger->>'type' in ('birthday', 'deal.inactive')
  loop
    v_local := now() at time zone r.timezone;
    v_today := v_local::date;
    if r.trigger->>'type' = 'birthday' then
      if v_local::time >= coalesce(nullif(r.trigger->>'time', '')::time, time '09:00') then
        insert into automation_runs (tenant_id, rule_id, source_key, contact_id)
        select c.tenant_id, r.id, 'aniversario:' || v_today::text || ':' || c.id::text, c.id
          from contacts c
         where c.tenant_id = r.tenant_id and c.anonymized_at is null and c.birth_day is not null
           and ((c.birth_month = extract(month from v_today) and c.birth_day = extract(day from v_today))
             -- 29 de fevereiro comemora no dia 28 nos anos que não são bissextos.
             or (c.birth_month = 2 and c.birth_day = 29 and extract(month from v_today) = 2 and extract(day from v_today) = 28
                 and extract(day from (date_trunc('year', v_today) + interval '2 months' - interval '1 day')) = 28))
        on conflict (rule_id, source_key) do nothing;
        get diagnostics v_c = row_count;
        v_n := v_n + v_c;
      end if;
    else
      insert into automation_runs (tenant_id, rule_id, source_key, contact_id, deal_id)
      select d.tenant_id, r.id, 'parado:' || d.id::text || ':' || coalesce(d.last_activity_at, d.created_at)::date::text, d.contact_id, d.id
        from deals d
       where d.tenant_id = r.tenant_id and d.status = 'open'
         and coalesce(d.last_activity_at, d.created_at) < now() - make_interval(days => greatest(coalesce((r.trigger->>'days')::int, 7), 1))
         and (r.filters->>'pipelineId' is null or d.pipeline_id = (r.filters->>'pipelineId')::uuid)
         and (r.filters->>'stageId' is null or d.stage_id = (r.filters->>'stageId')::uuid)
      on conflict (rule_id, source_key) do nothing;
      get diagnostics v_c = row_count;
      v_n := v_n + v_c;
    end if;
  end loop;
  return v_n;
end
$$;

-- Execuções vencidas, reservadas por 10 minutos (se o processo cair, voltam).
create function app.automation_claim(p_limit int)
returns table (tenant_id uuid, run_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select r.id from automation_runs r
    join tenants t on t.id = r.tenant_id and t.status = 'active'
    where r.status in ('pending', 'waiting', 'running') and r.next_at <= now()
    order by r.next_at
    limit greatest(least(p_limit, 200), 1)
    for update of r skip locked
  )
  update automation_runs r set status = 'running', next_at = now() + interval '10 minutes'
  from due where r.id = due.id
  returning r.tenant_id, r.id
$$;

revoke all on function app.automation_scan_events() from public;
revoke all on function app.automation_scan_schedules() from public;
revoke all on function app.automation_claim(int) from public;
grant execute on function app.automation_scan_events() to crm_dispatch;
grant execute on function app.automation_scan_schedules() to crm_dispatch;
grant execute on function app.automation_claim(int) to crm_dispatch;

-- ---------------------------------------------------------------------------
-- Chaves de API: a chave é "crm_<prefixo>_<segredo>"; o banco guarda o
-- SHA-256 dela. A busca pelo prefixo vem antes de haver empresa no contexto.
-- ---------------------------------------------------------------------------

create function app.api_key_lookup(p_prefix text)
returns table (id uuid, tenant_id uuid, key_hash bytea, created_by uuid, scopes text[])
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select k.id, k.tenant_id, k.key_hash, k.created_by, k.scopes
    from public.api_keys k
    join public.tenants t on t.id = k.tenant_id and t.status = 'active'
   where k.prefix = p_prefix and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
$$;

create function app.api_key_touch(p_id uuid)
returns void
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  update public.api_keys set last_used_at = now()
   where id = p_id and (last_used_at is null or last_used_at < now() - interval '1 minute')
$$;

revoke all on function app.api_key_lookup(text) from public;
revoke all on function app.api_key_touch(uuid) from public;
grant execute on function app.api_key_lookup(text) to crm_app;
grant execute on function app.api_key_touch(uuid) to crm_app;
