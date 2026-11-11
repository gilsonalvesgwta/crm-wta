-- 0022_funis_arquivados
-- O nome do funil precisa ser único só entre os funis ativos: um funil
-- arquivado não impede criar outro com o mesmo nome. Troca só o índice.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

drop index pipelines_tenant_name_uq;
create unique index pipelines_tenant_name_uq on pipelines (tenant_id, lower(name)) where archived_at is null;
