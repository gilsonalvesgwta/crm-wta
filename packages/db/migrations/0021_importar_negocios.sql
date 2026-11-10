-- 0021_importar_negocios
-- Importação de negócios por planilha (ex.: exportação do Pipedrive), além de
-- contatos e organizações. Só amplia a lista de tipos aceitos.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table imports drop constraint imports_entity_check;
alter table imports add constraint imports_entity_check check (entity in ('contacts', 'organizations', 'deals'));
