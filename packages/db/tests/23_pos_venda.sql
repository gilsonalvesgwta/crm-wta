-- Pós-venda: lembretes depois do negócio ganho, repetidos até o limite ou até "Feito".

-- Negócio ganho há 40 dias (a etapa "Ganho" do funil de teste exige valor, que o negócio tem).
update deals set stage_id = t.id(tenant_id, 5) where tenant_id = t.a();
update deals set closed_at = now() - interval '40 days' where tenant_id = t.a();
delete from deal_aftersale where tenant_id = t.a();
update aftersale_settings set enabled = true, first_days = 30, repeat_days = 7, max_times = 2, send_at = '00:00',
  in_app = true, whatsapp = false where tenant_id = t.a();

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$update aftersale_settings set first_days = 0 where tenant_id = t.a()$$, '23514', 'primeiro aviso a partir de 1 dia');
select t.throws($$update aftersale_settings set extra_phones = array_fill('+5511999990000'::text, array[11]) where tenant_id = t.a()$$, '23514', 'no máximo 10 números avulsos');
select t.throws($$insert into aftersale_settings (tenant_id, alert_text, customer_text) values (t.b(), 'a', 'b')$$, '42501', 'não configura outra empresa');
select t.ctx(null, null);
reset role;

set role crm_dispatch;
select t.ok((select count(*) from app.claim_aftersale(50) where tenant_id = t.a()) = 1, 'primeiro aviso depois de 30 dias');
select t.ok((select count(*) from app.claim_aftersale(50) where tenant_id = t.a()) = 0, 'não repete no mesmo dia');
reset role;
update deal_aftersale set last_notified_at = now() - interval '7 days' where tenant_id = t.a();
set role crm_dispatch;
select t.ok((select max(notified_count) from app.claim_aftersale(50) where tenant_id = t.a()) = 2, 'repete depois de 7 dias (2º aviso)');
reset role;
update deal_aftersale set last_notified_at = now() - interval '7 days' where tenant_id = t.a();
set role crm_dispatch;
select t.ok((select count(*) from app.claim_aftersale(50) where tenant_id = t.a()) = 0, 'para no limite de avisos');
reset role;
update aftersale_settings set max_times = 5 where tenant_id = t.a();
update deal_aftersale set done_at = now() where tenant_id = t.a();
set role crm_dispatch;
select t.ok((select count(*) from app.claim_aftersale(50) where tenant_id = t.a()) = 0, '"Feito" para os avisos');
reset role;
update deal_aftersale set done_at = null where tenant_id = t.a();
update aftersale_settings set since = (now() - interval '10 days')::date where tenant_id = t.a();
set role crm_dispatch;
select t.ok((select count(*) from app.claim_aftersale(50) where tenant_id = t.a()) = 0, 'negócio fechado antes da data "a partir de" não entra');
reset role;
update aftersale_settings set since = null, enabled = false where tenant_id = t.a();
set role crm_dispatch;
select t.ok((select count(*) from app.claim_aftersale(50) where tenant_id = t.a()) = 0, 'desligado não avisa');
reset role;
