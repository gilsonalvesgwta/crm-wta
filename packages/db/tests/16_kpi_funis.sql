-- Funis de KPI.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into kpi_funnels (tenant_id, name, tag_ids) values (t.a(), 'Sem etiqueta', '{}')$$, '23514', 'funil precisa de etiqueta');
select t.throws($$insert into kpi_funnels (tenant_id, name, tag_ids) values (t.a(), 'prospecção ATIVA', array[t.id(t.a(), 14)])$$, '23505', 'nome não se repete');
select t.ok(t.affected($$insert into kpi_funnels (tenant_id, name, tag_ids, receives_ad_spend) values (t.a(), 'Tráfego', array[t.id(t.a(), 14)], true)$$) = 1, 'funil que recebe investimento');
select t.throws($$insert into kpi_funnels (tenant_id, name, tag_ids, receives_ad_spend) values (t.a(), 'Outro tráfego', array[t.id(t.a(), 14)], true)$$, '23505', 'só um funil recebe o investimento');
select t.throws($$insert into kpi_prospecting (tenant_id, funnel_id, membership_id, day, count) values (t.a(), t.id(t.a(), 29), t.ma(), current_date, 40)$$, '23505', 'um lançamento por vendedor e dia');
select t.throws($$insert into kpi_prospecting (tenant_id, funnel_id, membership_id, day, count) values (t.a(), t.id(t.a(), 29), t.ma(), current_date - 1, -1)$$, '23514', 'número negativo é recusado');
select t.throws($$insert into kpi_prospecting (tenant_id, funnel_id, membership_id, day, count) values (t.a(), t.id(t.b(), 29), t.ma(), current_date - 1, 1)$$, '23503', 'não lança em funil de outra empresa');
select t.ctx(null, null);
reset role;
