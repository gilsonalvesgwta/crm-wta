-- 0003_nomes_unicos
-- Perfis e equipes com nomes únicos por empresa, sem diferenciar maiúsculas.

set local role crm_owner;

alter table teams drop constraint teams_tenant_id_name_key;
create unique index teams_tenant_name_uq on teams (tenant_id, lower(name));
create unique index roles_tenant_name_uq on roles (tenant_id, lower(name));
