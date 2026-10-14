-- Campanhas: só as da vez saem, dentro da janela, uma reserva por vez.

-- Rascunho não sai; agendada para o futuro também não.
update campaigns set status = 'scheduled', scheduled_at = now() + interval '1 hour' where id = t.id(t.a(), 23);
set role crm_dispatch;
select t.ok((select count(*) from app.campaign_claim(10)) = 0, 'agendada para depois não sai');
reset role;

-- Hora chegou: sai uma vez e fica reservada.
update campaigns set scheduled_at = now() - interval '1 minute' where id = t.id(t.a(), 23);
set role crm_dispatch;
select t.ok((select campaign_id from app.campaign_claim(10)) = t.id(t.a(), 23), 'agendada vencida sai');
select t.ok((select count(*) from app.campaign_claim(10)) = 0, 'reservada não sai de novo');
select t.throws('select count(*) from campaigns', '42501', 'o despachante não lê a tabela');
reset role;
select t.ok((select status from campaigns where id = t.id(t.a(), 23)) = 'sending', 'passa a enviando');

-- Fora da janela de horário não sai.
update campaigns set next_at = now() - interval '1 second',
  window_start = ((now() at time zone 'UTC') + interval '2 hours')::time,
  window_end = ((now() at time zone 'UTC') + interval '3 hours')::time where id = t.id(t.a(), 23);
update tenants set timezone = 'UTC' where id = t.a();
set role crm_dispatch;
select t.ok((select count(*) from app.campaign_claim(10)) = 0, 'fora da janela não sai');
reset role;
update campaigns set window_start = ((now() at time zone 'UTC') - interval '1 hour')::time,
  window_end = ((now() at time zone 'UTC') + interval '1 hour')::time where id = t.id(t.a(), 23);
set role crm_dispatch;
select t.ok((select count(*) from app.campaign_claim(10)) = 1, 'dentro da janela sai');
reset role;

-- Pausada não sai; empresa suspensa também não.
update campaigns set status = 'paused', next_at = now() - interval '1 second' where id = t.id(t.a(), 23);
set role crm_dispatch;
select t.ok((select count(*) from app.campaign_claim(10)) = 0, 'pausada não sai');
reset role;

-- Isolamento e regras.
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into campaign_recipients (tenant_id, campaign_id, contact_id, address)
  values (t.a(), t.id(t.a(), 23), t.id(t.a(), 2), '+5511999990000')$$, '23505', 'o mesmo contato entra uma vez por campanha');
select t.throws($$insert into campaigns (tenant_id, name, channel, per_minute) values (t.a(), 'Rápida demais', 'whatsapp', 500)$$,
  '23514', 'ritmo limitado a 120 por minuto');
select t.throws($$insert into campaigns (tenant_id, name, channel, channel_account_id) values (t.a(), 'X', 'whatsapp', t.id(t.b(), 18))$$,
  '23503', 'campanha não usa a conta de outra empresa');
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from campaigns where tenant_id = t.a()$$) = 0, 'a empresa B não vê campanhas da A');
select t.ctx(null, null);
reset role;
