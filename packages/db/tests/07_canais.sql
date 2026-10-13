-- Canais e mensagens (lote 2).

-- O token do webhook leva à empresa e à conta certas, sem contexto de empresa.
set role crm_app;
select t.ctx(null, null);
select t.ok((select tenant_id from app.channel_by_webhook(sha256(convert_to('token-' || t.a()::text, 'UTF8')))) = t.a(),
  'o token do webhook identifica a empresa A');
select t.ok(t.count($$select 1 from app.channel_by_webhook(sha256(convert_to('token-errado', 'UTF8')))$$) = 0,
  'token desconhecido não identifica empresa');

-- A mesma mensagem não entra duas vezes na mesma conta.
select t.ctx(t.a(), t.ua());
select t.throws($$insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, external_id, remote)
  values (t.a(), t.id(t.a(), 18), 'whatsapp', 'in', 'received', t.id(t.a(), 2), 'MSG-1', '+5511999990000')$$, '23505',
  'mensagem repetida da mesma conta é recusada');
select t.throws($$insert into messages (tenant_id, channel_account_id, channel, direction, status, contact_id, remote)
  values (t.a(), t.id(t.b(), 18), 'whatsapp', 'out', 'sent', t.id(t.a(), 2), '+5511999990000')$$, '23503',
  'mensagem não usa a conta de outra empresa');
select t.throws($$insert into channel_accounts (tenant_id, kind, name, external_id) values (t.a(), 'whatsapp_evolution', 'X', 'outra-instancia')$$, '23514',
  'o CRM só usa instâncias com o prefixo crmwta-');
select t.ok(t.affected($$update messages set seen_at = now() where id = t.id(t.a(), 19)$$) = 1, 'a empresa marca a mensagem como vista');

-- Empresa suspensa não recebe pelo webhook.
select t.ctx(null, null);
reset role;
update tenants set status = 'suspended' where id = t.a();
set role crm_app;
select t.ok(t.count(format($$select 1 from app.channel_by_webhook(sha256(convert_to('token-%s', 'UTF8')))$$, t.a())) = 0,
  'empresa suspensa não recebe pelo webhook');
reset role;
update tenants set status = 'active' where id = t.a();

-- Remover a conta mantém o histórico.
reset role;
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.ok(t.affected($$delete from channel_accounts where id = t.id(t.a(), 18)$$) = 1, 'a empresa remove uma conta');
select t.ok((select channel_account_id from messages where id = t.id(t.a(), 19)) is null, 'o histórico fica, sem a conta');
select t.ctx(null, null);
reset role;

