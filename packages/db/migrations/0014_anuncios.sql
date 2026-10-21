-- 0014_anuncios
-- Investimento em anúncios para os KPIs: lançado à mão (Meta, Google, outros)
-- ou importado todo dia de uma conta de anúncios da Meta.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- Contas de anúncios ligadas para importar o gasto (por enquanto, Meta Ads).
create table ad_accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  platform        text not null check (platform in ('meta')),
  -- Id numérico da conta de anúncios (sem o "act_").
  external_id     text not null check (external_id ~ '^[0-9]{5,25}$'),
  name            text not null check (length(btrim(name)) between 1 and 200),
  currency        text check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- Token de acesso cifrado (ads_read).
  secret          bytea not null,
  status          text not null default 'connected' check (status in ('connected', 'error')),
  last_error      text check (last_error is null or length(last_error) <= 1000),
  last_sync_at    timestamptz,
  sync_after      timestamptz not null default now(),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, platform, external_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create trigger ad_accounts_updated_at before update on ad_accounts
  for each row execute function app.set_updated_at();
alter table ad_accounts enable row level security;
alter table ad_accounts force row level security;
create policy tenant_isolation on ad_accounts for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on ad_accounts to crm_app;

-- Gasto num período (do primeiro ao último dia, inclusive). O valor é
-- distribuído por igual entre os dias para os KPIs por período.
create table ad_spend (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  platform        text not null check (platform in ('meta', 'google', 'tiktok', 'other')),
  ad_account_id   uuid,
  description     text check (description is null or length(description) <= 200),
  first_day       date not null,
  last_day        date not null,
  amount_cents    bigint not null check (amount_cents >= 0 and amount_cents <= 100000000000),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  check (last_day >= first_day and last_day - first_day <= 366),
  -- Importado: um dia por linha, um por conta e dia.
  check (ad_account_id is null or first_day = last_day),
  foreign key (tenant_id, ad_account_id) references ad_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create unique index ad_spend_imported_idx on ad_spend (ad_account_id, first_day) where ad_account_id is not null;
create index ad_spend_period_idx on ad_spend (tenant_id, first_day, last_day);
create trigger ad_spend_updated_at before update on ad_spend
  for each row execute function app.set_updated_at();
alter table ad_spend enable row level security;
alter table ad_spend force row level security;
create policy tenant_isolation on ad_spend for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on ad_spend to crm_app;

-- Contas de anúncios a importar (de empresa ativa, a cada 6 horas), reservadas por 10 minutos.
create function app.ad_sync_due(p_limit int)
returns table (tenant_id uuid, account_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select a.id from ad_accounts a
    join tenants t on t.id = a.tenant_id and t.status = 'active'
    where a.sync_after <= now()
    order by a.sync_after
    limit greatest(least(p_limit, 50), 1)
    for update of a skip locked
  )
  update ad_accounts a set sync_after = now() + interval '10 minutes'
  from due where a.id = due.id
  returning a.tenant_id, a.id
$$;
revoke all on function app.ad_sync_due(int) from public;
grant execute on function app.ad_sync_due(int) to crm_dispatch;
