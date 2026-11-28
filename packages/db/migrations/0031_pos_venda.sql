-- 0031_pos_venda
-- Pós-venda: X dias depois do negócio ganho, avisa a equipe (WhatsApp e/ou
-- sininho do CRM) para entrar em contato com o cliente, e repete a cada Y dias
-- até marcarem "Feito" ou chegar no número de lembretes escolhido.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

create table aftersale_settings (
  tenant_id      uuid primary key references tenants (id) on delete cascade,
  enabled        boolean not null default false,
  -- Primeiro aviso X dias depois do fechamento; depois a cada Y dias (null: não repete), até N avisos.
  first_days     int not null default 30 check (first_days between 1 and 3650),
  repeat_days    int check (repeat_days is null or repeat_days between 1 and 3650),
  max_times      int not null default 3 check (max_times between 1 and 50),
  -- Hora do dia (no fuso da empresa) a partir da qual os avisos saem.
  send_at        time not null default '09:00',
  -- Funis que entram (vazio: todos) e só negócios fechados a partir desta data (evita avisar a base antiga toda).
  pipeline_ids   uuid[] not null default '{}',
  since          date,
  -- Quem recebe: o responsável pelo negócio, pessoas da equipe e números avulsos.
  notify_owner   boolean not null default true,
  member_ids     uuid[] not null default '{}',
  extra_phones   text[] not null default '{}' check (cardinality(extra_phones) <= 10),
  whatsapp       boolean not null default true,
  account_id     uuid,
  in_app         boolean not null default true,
  -- Texto do aviso para a equipe e mensagem sugerida para o cliente (com variáveis).
  alert_text     text not null check (length(alert_text) between 1 and 2000),
  customer_text  text not null check (length(customer_text) between 1 and 4000),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  foreign key (tenant_id, account_id) references channel_accounts (tenant_id, id) on delete set null (account_id),
  foreign key (tenant_id, updated_by) references memberships (tenant_id, id) on delete set null (updated_by)
);
create trigger aftersale_settings_updated_at before update on aftersale_settings
  for each row execute function app.set_updated_at();
alter table aftersale_settings enable row level security;
alter table aftersale_settings force row level security;
create policy tenant_isolation on aftersale_settings for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on aftersale_settings to crm_app;

-- Situação do pós-venda de cada negócio ganho.
create table deal_aftersale (
  deal_id           uuid primary key,
  tenant_id         uuid not null references tenants (id) on delete cascade,
  notified_count    int not null default 0 check (notified_count >= 0),
  last_notified_at  timestamptz,
  done_at           timestamptz,
  done_by           uuid,
  note              text check (note is null or length(note) <= 1000),
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references deals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, done_by) references memberships (tenant_id, id) on delete set null (done_by)
);
create index deal_aftersale_tenant_idx on deal_aftersale (tenant_id, done_at);
create trigger deal_aftersale_updated_at before update on deal_aftersale
  for each row execute function app.set_updated_at();
alter table deal_aftersale enable row level security;
alter table deal_aftersale force row level security;
create policy tenant_isolation on deal_aftersale for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on deal_aftersale to crm_app;

-- Negócios com aviso de pós-venda vencido (de todas as empresas ativas). Marca o
-- aviso na hora, então o mesmo lembrete não sai duas vezes.
create function app.claim_aftersale(p_limit int)
returns table (tenant_id uuid, deal_id uuid, notified_count int)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select d.tenant_id, d.id from deals d
    join tenants t on t.id = d.tenant_id and t.status = 'active'
    join aftersale_settings s on s.tenant_id = d.tenant_id and s.enabled
      and ((s.whatsapp and s.account_id is not null) or s.in_app)
      and (now() at time zone t.timezone)::time >= s.send_at
    left join deal_aftersale a on a.deal_id = d.id
    where d.status = 'won' and d.closed_at is not null
      and d.closed_at <= now() - make_interval(days => s.first_days)
      and (cardinality(s.pipeline_ids) = 0 or d.pipeline_id = any(s.pipeline_ids))
      and (s.since is null or d.closed_at >= s.since::timestamp at time zone t.timezone)
      and a.done_at is null
      and coalesce(a.notified_count, 0) < case when s.repeat_days is null then 1 else s.max_times end
      and (a.last_notified_at is null or a.last_notified_at <= now() - make_interval(days => coalesce(s.repeat_days, 36500)) + interval '1 hour')
    order by d.closed_at
    limit greatest(least(p_limit, 2000), 1)
    for update of d skip locked
  )
  insert into deal_aftersale as x (tenant_id, deal_id, notified_count, last_notified_at)
  select due.tenant_id, due.id, 1, now() from due
  on conflict (deal_id) do update set notified_count = x.notified_count + 1, last_notified_at = now()
  returning x.tenant_id, x.deal_id, x.notified_count
$$;
revoke all on function app.claim_aftersale(int) from public;
grant execute on function app.claim_aftersale(int) to crm_dispatch;
