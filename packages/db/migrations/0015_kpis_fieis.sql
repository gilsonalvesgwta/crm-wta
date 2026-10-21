-- 0015_kpis_fieis
-- KPIs fiéis: lead = contato com a etiqueta escolhida (contado na data em que
-- recebeu a etiqueta) e registros que não devem entrar nos KPIs.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- Quando o contato recebeu a etiqueta. As que já existiam ficam com a data do contato.
alter table contact_tags add column created_at timestamptz;
update contact_tags ct set created_at = k.created_at from contacts k where k.id = ct.contact_id;
update contact_tags set created_at = now() where created_at is null;
alter table contact_tags alter column created_at set default now(), alter column created_at set not null;
create index contact_tags_tag_date_idx on contact_tags (tenant_id, tag_id, created_at);

-- Configuração dos KPIs da empresa.
create table kpi_settings (
  tenant_id     uuid primary key references tenants (id) on delete cascade,
  -- Etiquetas que marcam um contato como lead (vazio: todo contato novo conta).
  lead_tag_ids  uuid[] not null default '{}' check (cardinality(lead_tag_ids) <= 20),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  foreign key (tenant_id, updated_by) references memberships (tenant_id, id) on delete set null (updated_by)
);
create trigger kpi_settings_updated_at before update on kpi_settings
  for each row execute function app.set_updated_at();
alter table kpi_settings enable row level security;
alter table kpi_settings force row level security;
create policy tenant_isolation on kpi_settings for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on kpi_settings to crm_app;

-- Registros que não contam nos KPIs (sem apagar nada do CRM).
create table kpi_exclusions (
  tenant_id   uuid not null references tenants (id) on delete cascade,
  kind        text not null check (kind in ('contact', 'activity', 'deal')),
  record_id   uuid not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, kind, record_id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
alter table kpi_exclusions enable row level security;
alter table kpi_exclusions force row level security;
create policy tenant_isolation on kpi_exclusions for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on kpi_exclusions to crm_app;
