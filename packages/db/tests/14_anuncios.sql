-- Investimento em anúncios.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into ad_spend (tenant_id, platform, first_day, last_day, amount_cents)
  values (t.a(), 'meta', current_date, current_date - 1, 100)$$, '23514', 'período ao contrário é recusado');
select t.throws($$insert into ad_spend (tenant_id, platform, first_day, last_day, amount_cents)
  values (t.a(), 'meta', current_date, current_date, -1)$$, '23514', 'valor negativo é recusado');
select t.throws($$insert into ad_spend (tenant_id, platform, ad_account_id, first_day, last_day, amount_cents)
  values (t.a(), 'meta', t.id(t.a(), 28), current_date - 1, current_date - 1, 100)$$, '23505', 'importado: um por conta e dia');
select t.throws($$insert into ad_spend (tenant_id, platform, ad_account_id, first_day, last_day, amount_cents)
  values (t.a(), 'meta', t.id(t.a(), 28), current_date - 9, current_date - 8, 100)$$, '23514', 'importado é sempre de um dia');
select t.throws($$insert into ad_spend (tenant_id, platform, ad_account_id, first_day, last_day, amount_cents)
  values (t.a(), 'meta', t.id(t.b(), 28), current_date - 20, current_date - 20, 100)$$, '23503', 'não usa conta de outra empresa');
select t.throws($$insert into ad_accounts (tenant_id, platform, external_id, name, secret) values (t.a(), 'meta', 'act_123', 'X', '\x00')$$,
  '23514', 'id da conta só com números');
select t.ctx(null, null);
reset role;

select t.ok((select count(*) from ad_accounts a join tenants t2 on t2.id = a.tenant_id where t2.status = 'active') >= 1, 'há conta de empresa ativa');
create temp table due_n as select (select count(*) from ad_accounts a join tenants t2 on t2.id = a.tenant_id where t2.status = 'active') as n;
grant select on due_n to crm_dispatch;
set role crm_dispatch;
select t.ok((select count(*) from app.ad_sync_due(10)) = (select n from due_n), 'as contas de empresas ativas entram na importação');
select t.ok((select count(*) from app.ad_sync_due(10)) = 0, 'e ficam reservadas');
reset role;
