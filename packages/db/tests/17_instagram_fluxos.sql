-- Fluxos do Instagram.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft) values (t.a(), t.id(t.a(), 30), 'X', 'tiktok', '{}')$$, '23514', 'gatilho fora da lista é recusado');
select t.throws($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft, status) values (t.a(), t.id(t.a(), 30), 'X', 'comment', '{}', 'active')$$, '23514', 'ativo precisa estar publicado');
select t.throws($$insert into ig_flows (tenant_id, channel_account_id, name, trigger_type, draft) values (t.a(), t.id(t.b(), 30), 'X', 'comment', '{}')$$, '23503', 'não usa conta de outra empresa');
select t.throws($$insert into ig_flow_runs (tenant_id, flow_id, flow_version, channel_account_id, ig_user_id) values (t.a(), t.id(t.a(), 31), 1, t.id(t.a(), 30), 'abc')$$, '23514', 'id do Instagram só com números');
select t.throws($$insert into ig_trigger_log (tenant_id, flow_id, ig_user_id, scope) values (t.a(), t.id(t.a(), 31), '900000001', 'post-1')$$, '23505', 'a mesma pessoa e publicação entram uma vez');
select t.throws($$insert into ig_webhook_log (tenant_id, channel_account_id, event_key, kind) values (t.a(), t.id(t.a(), 30), 'comment:1', 'comment')$$, '23505', 'o mesmo aviso é tratado uma vez');
select t.ok(t.affected($$insert into files (tenant_id, storage_key, purpose, original_name, content_type, size_bytes, sha256)
  values (t.a(), t.a()::text || '/m/1', 'media', 'catalogo.pdf', 'application/pdf', 10, decode(repeat('ab', 32), 'hex'))$$) = 1, 'arquivo da biblioteca de mídia');
select t.ok(t.count($$select 1 from ig_flows$$) = 1, 'vê só os fluxos da empresa');
select t.ctx(null, null);
reset role;

-- Despachante: só execuções esperando com tempo vencido.
update ig_flow_runs set wake_at = now() - interval '1 minute' where id = t.id(t.a(), 32);
set role crm_dispatch;
select t.ok((select count(*) from app.ig_runs_due(10)) = 1, 'execução com tempo vencido entra');
select t.ok((select count(*) from app.ig_runs_due(10)) = 0, 'e fica reservada');
reset role;
