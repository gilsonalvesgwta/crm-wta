-- Fluxos do WhatsApp oficial (transmissão com botões).

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft) values (t.a(), t.id(t.a(), 25), 'X', 'wa_broadcast', '{}')$$,
  '23514', 'gatilho do WhatsApp precisa do canal whatsapp');
select t.throws($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft, channel) values (t.a(), t.id(t.a(), 25), 'X', 'comment', '{}', 'whatsapp')$$,
  '23514', 'gatilho do Instagram não vale no WhatsApp');
select t.throws($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft, channel) values (t.a(), t.id(t.a(), 25), 'X', 'wa_broadcast', '{}', 'sms')$$,
  '23514', 'canal fora da lista');
select t.ok(t.affected($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft, channel) values (t.a(), t.id(t.a(), 25), 'Transmissão', 'wa_broadcast', '{}', 'whatsapp')$$) = 1,
  'fluxo de transmissão no WhatsApp');
select t.ok(t.affected($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft, channel) values (t.a(), t.id(t.a(), 25), 'Palavra', 'wa_keyword', '{}', 'whatsapp')$$) = 1,
  'fluxo de palavra-chave no WhatsApp');
select t.ok(t.count($$select 1 from ig_flows where channel = 'instagram'$$) = 1, 'o fluxo que já existia continua no Instagram');
select t.ok(t.affected($$insert into ig_flow_runs (tenant_id, flow_id, flow_version, channel_account_id, ig_user_id)
  select t.a(), id, 1, t.id(t.a(), 25), '5531977772222' from ig_flows where name = 'Transmissão'$$) = 1, 'execução com o número do WhatsApp');
select t.ok(t.affected($$update campaigns set flow_id = (select id from ig_flows where name = 'Transmissão') where id = t.id(t.a(), 23)$$) = 1, 'campanha com fluxo de transmissão');
select t.throws($$update campaigns set flow_id = t.id(t.b(), 31) where id = t.id(t.a(), 23)$$, '23503', 'campanha não usa fluxo de outra empresa');
select t.ctx(null, null);
reset role;

set role crm_app;
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from ig_flows where channel = 'whatsapp'$$) = 0, 'outra empresa não vê os fluxos do WhatsApp');
select t.ctx(null, null);
reset role;
