-- Mensagens agendadas: só as vencidas saem, uma vez; reserva vencida volta.

set role crm_dispatch;
select t.ok((select count(*) from app.scheduled_claim(10)) = 0, 'agendada para amanhã não sai');
reset role;
update scheduled_messages set send_at = now() - interval '1 minute' where id = t.id(t.a(), 24);
set role crm_dispatch;
select t.ok((select scheduled_id from app.scheduled_claim(10)) = t.id(t.a(), 24), 'vencida sai');
select t.ok((select count(*) from app.scheduled_claim(10)) = 0, 'reservada não sai de novo');
select t.throws('select count(*) from scheduled_messages', '42501', 'o despachante não lê a tabela');
reset role;
update scheduled_messages set locked_until = now() - interval '1 second' where id = t.id(t.a(), 24);
set role crm_dispatch;
select t.ok((select count(*) from app.scheduled_claim(10)) = 1, 'reserva vencida (processo caiu) volta');
reset role;
update scheduled_messages set status = 'canceled' where id = t.id(t.a(), 24);
set role crm_dispatch;
select t.ok((select count(*) from app.scheduled_claim(10)) = 0, 'cancelada não sai');
reset role;

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into scheduled_messages (tenant_id, contact_id, channel, body, send_at) values (t.a(), t.id(t.b(), 2), 'whatsapp', 'x', now())$$,
  '23503', 'não agenda para contato de outra empresa');
select t.throws($$insert into scheduled_messages (tenant_id, contact_id, channel, body, send_at) values (t.a(), t.id(t.a(), 2), 'whatsapp', '', now())$$,
  '23514', 'mensagem vazia é recusada');
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from scheduled_messages where tenant_id = t.a()$$) = 0, 'a empresa B não vê as agendadas da A');
select t.ctx(null, null);
reset role;
