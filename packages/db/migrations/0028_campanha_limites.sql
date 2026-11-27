-- 0028_campanha_limites
-- Campanhas: dias da semana em que envia, limite de envios por hora e por dia
-- (ao chegar no limite, espera e continua de onde parou) e pausa automática
-- numa data e hora.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table campaigns add column window_days smallint[] not null default '{}'
  check (window_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);
alter table campaigns add column max_per_hour int check (max_per_hour is null or max_per_hour between 1 and 100000);
alter table campaigns add column max_per_day int check (max_per_day is null or max_per_day between 1 and 1000000);
alter table campaigns add column pause_at timestamptz;
create index campaign_recipients_sent_idx on campaign_recipients (campaign_id, sent_at) where sent_at is not null;

-- Também respeita os dias da semana escolhidos (no fuso da empresa).
create or replace function app.campaign_claim(p_limit int)
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
      and (cardinality(c.window_days) = 0 or extract(isodow from now() at time zone t.timezone)::smallint = any(c.window_days))
    order by coalesce(c.next_at, c.scheduled_at)
    limit greatest(least(p_limit, 50), 1)
    for update of c skip locked
  )
  update campaigns c set status = 'sending', next_at = now() + interval '2 minutes',
                         started_at = coalesce(c.started_at, now())
  from due where c.id = due.id
  returning c.tenant_id, c.id
$$;
