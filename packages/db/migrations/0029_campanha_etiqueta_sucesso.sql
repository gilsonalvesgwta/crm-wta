-- 0029_campanha_etiqueta_sucesso
-- Campanha: etiqueta posta em quem recebeu com sucesso (para filtrar depois).
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table campaigns add column success_tag_id uuid;
alter table campaigns add constraint campaigns_success_tag_fk
  foreign key (tenant_id, success_tag_id) references tags (tenant_id, id) on delete set null (success_tag_id);
