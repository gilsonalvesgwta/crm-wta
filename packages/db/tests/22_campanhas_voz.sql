-- Campanhas de voz: operadoras, resultado das ligações e as funções do aviso e do despachante.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into voice_providers (tenant_id, name, provider) values (t.a(), 'X', 'telefonica')$$, '23514', 'operadora fora da lista');
select t.throws($$insert into voice_providers (tenant_id, name, provider) values (t.b(), 'X', 'twilio')$$, '42501', 'não cadastra operadora em outra empresa');
select t.ok(t.affected($$update campaigns set channel = 'voice', voice = '{"digits": true}' where tenant_id = t.a()$$) >= 1, 'campanha de voz');
select t.throws($$update campaigns set voice = '[]' where tenant_id = t.a()$$, '23514', 'opções da voz precisam ser um objeto');
select t.ok(t.affected($$update campaigns set voice_provider_id = (select id from voice_providers where tenant_id = t.a() limit 1) where tenant_id = t.a()$$) >= 1,
  'campanha escolhe a operadora');
select t.throws($$update campaign_recipients set call_status = 'talvez' where tenant_id = t.a()$$, '23514', 'resultado da ligação fora da lista');
select t.throws($$update campaign_recipients set call_digits = 'abc' where tenant_id = t.a()$$, '23514', 'tecla só de 0 a 9, * e #');
select t.ok(t.affected($$update campaign_recipients set call_status = 'queued', status = 'sent', sent_at = now() - interval '5 minutes', call_ended_at = null where tenant_id = t.a()$$) >= 1,
  'ligações aguardando resultado');
select t.ctx(null, null);
reset role;

set role crm_app;
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from voice_providers where tenant_id = t.a()$$) = 0, 'outra empresa não vê as operadoras');
select t.ctx(null, null);
reset role;
select set_config('t.vp', (select id::text from voice_providers where tenant_id = t.a() limit 1), false);
set role crm_app;
select t.ok(app.voice_provider_tenant(current_setting('t.vp')::uuid) = t.a(), 'aviso da operadora acha a empresa');
reset role;

set role crm_dispatch;
select t.ok((select count(*) from app.voice_pending_calls(50)) >= 1, 'despachante acha as ligações sem resultado');
select t.ok((select count(*) from app.voice_pending_calls(50)) = 0, 'não pergunta de novo logo em seguida');
reset role;
