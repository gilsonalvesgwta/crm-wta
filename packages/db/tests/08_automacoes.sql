-- Automações (lote 3): eventos e agendamentos viram execuções uma vez só.

-- Evento novo do tipo da regra vira execução; evento anterior à regra, não.
insert into timeline_entries (tenant_id, kind, contact_id, occurred_at)
values (t.a(), 'contact.created', t.id(t.a(), 2), now() - interval '1 hour');
update automation_rules set last_event_at = now() - interval '30 minutes' where id = t.id(t.a(), 20);
insert into timeline_entries (tenant_id, kind, contact_id, occurred_at)
values (t.a(), 'contact.created', t.id(t.a(), 2), now() - interval '10 seconds');
set role crm_dispatch;
select t.ok(app.automation_scan_events() >= 1, 'evento novo vira execução');
select t.ok(app.automation_scan_events() = 0, 'e não de novo');
reset role;
select t.ok((select count(*) from automation_runs where rule_id = t.id(t.a(), 20) and source_key like 'evento:%') = 1,
  'só o evento depois da regra');

-- Aniversário: no dia, no fuso da empresa, uma vez por ano.
update contacts set birth_day = extract(day from (now() at time zone 'America/Sao_Paulo'))::int,
                    birth_month = extract(month from (now() at time zone 'America/Sao_Paulo'))::int
 where id = t.id(t.a(), 2);
update tenants set timezone = 'America/Sao_Paulo' where id = t.a();
insert into automation_rules (id, tenant_id, name, trigger, actions)
values (t.id(t.a(), 21), t.a(), 'Parabéns', '{"type": "birthday", "time": "00:00"}', '[{"type": "add_tag", "tagId": "x"}]');
set role crm_dispatch;
select t.ok(app.automation_scan_schedules() >= 1, 'aniversariante do dia vira execução');
select t.ok(app.automation_scan_schedules() = 0, 'uma vez por dia');
reset role;

-- Negócio parado há mais de N dias.
update deals set last_activity_at = now() - interval '10 days' where id = t.id(t.a(), 7);
insert into automation_rules (id, tenant_id, name, trigger, actions)
values (t.id(t.a(), 22), t.a(), 'Follow-up', '{"type": "deal.inactive", "days": 7}', '[{"type": "add_tag", "tagId": "x"}]');
set role crm_dispatch;
select t.ok(app.automation_scan_schedules() = 1, 'negócio parado vira execução');
select t.ok((select count(*) from app.automation_claim(50)) >= 3, 'execuções vencidas são reservadas');
select t.ok((select count(*) from app.automation_claim(50)) = 0, 'reservadas não saem de novo');
select t.throws('select count(*) from automation_runs', '42501', 'o despachante não lê a tabela');
reset role;

-- Chave de API: só pelo prefixo, de empresa ativa, não revogada.
insert into api_keys (tenant_id, name, prefix, key_hash) values (t.a(), 'n8n', 'abcd1234efgh', sha256('x'));
set role crm_app;
select t.ctx(null, null);
select t.ok((select tenant_id from app.api_key_lookup('abcd1234efgh')) = t.a(), 'a chave leva à empresa');
select t.ctx(t.a(), t.ua());
update api_keys set revoked_at = now() where prefix = 'abcd1234efgh';
select t.ctx(null, null);
select t.ok(t.count($$select 1 from app.api_key_lookup('abcd1234efgh')$$) = 0, 'chave revogada não vale');
reset role;
