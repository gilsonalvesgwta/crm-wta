-- KPIs fiéis.

select t.ok((select count(*) from contact_tags where created_at is null) = 0, 'toda etiqueta tem data');
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into kpi_exclusions (tenant_id, kind, record_id) values (t.a(), 'lead', gen_random_uuid())$$, '23514', 'tipo fora da lista é recusado');
select t.throws($$insert into kpi_exclusions (tenant_id, kind, record_id) values (t.a(), 'contact', t.id(t.a(), 2))$$, '23505', 'o mesmo registro sai uma vez');
select t.throws($$insert into kpi_settings (tenant_id) values (t.b())$$, '42501', 'não grava a configuração de outra empresa');
select t.ok(t.count($$select 1 from kpi_settings$$) = 1, 'vê só a própria configuração');
select t.ctx(null, null);
reset role;
