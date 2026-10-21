-- 0016_kpi_funis
-- Um painel de KPIs para cada funil (tráfego pago, prospecção ativa...), sem
-- misturar os números: cada funil reconhece os seus pela etiqueta do contato.
-- Prospecção lançada à mão pelo vendedor, por dia.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

create table kpi_funnels (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 60),
  -- Contato com uma destas etiquetas é deste funil (lead na data em que recebeu a etiqueta).
  tag_ids             uuid[] not null check (cardinality(tag_ids) between 1 and 20),
  -- O investimento em anúncios entra só no funil que recebe investimento (um por empresa).
  receives_ad_spend   boolean not null default false,
  -- O vendedor lança quantos prospectou no dia.
  manual_prospecting  boolean not null default false,
  position            int not null default 0,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create unique index kpi_funnels_name_uq on kpi_funnels (tenant_id, lower(name));
create unique index kpi_funnels_spend_uq on kpi_funnels (tenant_id) where receives_ad_spend;
create trigger kpi_funnels_updated_at before update on kpi_funnels
  for each row execute function app.set_updated_at();
alter table kpi_funnels enable row level security;
alter table kpi_funnels force row level security;
create policy tenant_isolation on kpi_funnels for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on kpi_funnels to crm_app;

-- Prospecções lançadas à mão: quantas o vendedor fez no dia, naquele funil.
create table kpi_prospecting (
  tenant_id       uuid not null references tenants (id) on delete cascade,
  funnel_id       uuid not null,
  membership_id   uuid not null,
  day             date not null,
  count           int not null check (count between 0 and 10000),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  primary key (funnel_id, membership_id, day),
  foreign key (tenant_id, funnel_id) references kpi_funnels (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, updated_by) references memberships (tenant_id, id) on delete set null (updated_by)
);
create index kpi_prospecting_day_idx on kpi_prospecting (tenant_id, funnel_id, day);
create trigger kpi_prospecting_updated_at before update on kpi_prospecting
  for each row execute function app.set_updated_at();
alter table kpi_prospecting enable row level security;
alter table kpi_prospecting force row level security;
create policy tenant_isolation on kpi_prospecting for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on kpi_prospecting to crm_app;

-- A etiqueta de lead já escolhida vira o funil principal, que recebe o investimento.
-- (kpi_settings fica no banco, sem uso, para não apagar dados.)
insert into kpi_funnels (tenant_id, name, tag_ids, receives_ad_spend, position, created_by)
select s.tenant_id, 'Tráfego pago', s.lead_tag_ids, true, 0, s.updated_by
  from kpi_settings s where cardinality(s.lead_tag_ids) > 0;
