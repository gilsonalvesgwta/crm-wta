-- Canais da Meta.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into channel_accounts (tenant_id, kind, name, external_id) values (t.a(), 'whatsapp_cloud', 'X', 'crmwta-abc-1234')$$,
  '23514', 'o WhatsApp oficial usa o id numérico do número');
select t.throws($$insert into channel_accounts (tenant_id, kind, name, external_id) values (t.a(), 'whatsapp_evolution', 'X', '123456789')$$,
  '23514', 'a Evolution continua só com instâncias crmwta-');
select t.ok(t.affected($$insert into messages (tenant_id, channel, direction, status, contact_id, remote, body)
  values (t.a(), 'instagram', 'in', 'received', t.id(t.a(), 2), '17841400000001', 'oi')$$) = 1, 'mensagem do Instagram entra');
select t.ok((select count(*) from conversations where contact_id = t.id(t.a(), 2) and channel = 'instagram') = 1, 'e abre a conversa do Instagram');
select t.throws($$insert into contact_handles (tenant_id, contact_id, kind, value) values (t.a(), t.id(t.a(), 2), 'instagram', '17841400000001')$$,
  '23505', 'o mesmo Instagram não é de dois contatos');
select t.throws($$insert into whatsapp_templates (tenant_id, channel_account_id, name, language, category, body)
  values (t.a(), t.id(t.a(), 25), 'Com Espaço', 'pt_BR', 'MARKETING', 'x')$$, '23514', 'nome do modelo só minúsculas, números e _');
select t.throws($$insert into whatsapp_templates (tenant_id, channel_account_id, name, language, category, body)
  values (t.a(), t.id(t.b(), 25), 'outro', 'pt_BR', 'MARKETING', 'x')$$, '23503', 'modelo não usa conta de outra empresa');
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from whatsapp_templates where tenant_id = t.a()$$) = 0, 'a empresa B não vê modelos da A');
select t.ok(t.count($$select 1 from contact_handles where tenant_id = t.a()$$) = 0, 'nem o Instagram dos contatos da A');
select t.ctx(null, null);
reset role;

-- Renovação do token do Instagram: só contas com token de mais de 7 dias, uma vez por dia.
insert into channel_accounts (id, tenant_id, kind, name, status, external_id, secret, config, created_at)
values (t.id(t.a(), 26), t.a(), 'instagram', 'Insta', 'connected', '17841400000555', '\x00',
        jsonb_build_object('host', 'instagram', 'tokenRefreshedAt', now() - interval '10 days'), now() - interval '20 days');
insert into channel_accounts (id, tenant_id, kind, name, status, external_id, secret, config)
values (t.id(t.a(), 27), t.a(), 'instagram', 'Insta novo', 'connected', '17841400000556', '\x00',
        jsonb_build_object('host', 'instagram', 'tokenRefreshedAt', now()));
set role crm_dispatch;
select t.ok((select array_agg(account_id) from app.meta_token_refresh_due(10)) = array[t.id(t.a(), 26)], 'só o token antigo entra na renovação');
select t.ok((select count(*) from app.meta_token_refresh_due(10)) = 0, 'e não de novo no mesmo dia');
reset role;
