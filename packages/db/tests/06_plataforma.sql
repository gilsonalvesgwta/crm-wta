-- Venda do CRM: planos, assinaturas, domínio e exclusão de empresa.

-- A empresa lê o próprio plano e a própria assinatura, não a de outra.
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.ok(t.count('select 1 from plans') >= 1, 'a empresa lê os planos');
select t.ok(t.count('select 1 from tenant_subscriptions') = 1, 'a empresa vê só a própria assinatura');
select t.throws($$update tenant_subscriptions set status = 'active'$$, '42501', 'a empresa não altera a própria assinatura');
select t.throws($$insert into plans (name) values ('Pirata')$$, '42501', 'a empresa não cria plano');
select t.throws('select count(*) from billing_events', '42501', 'a empresa não lê os avisos de pagamento');
select t.throws('select count(*) from plan_offers', '42501', 'a empresa não lê as ofertas');

-- Marca pública: só domínio verificado de empresa ativa.
insert into tenant_domains (tenant_id, domain, kind) values (t.a(), 'crm.cliente-a.test', 'custom');
select t.ok(t.count($$select 1 from app.public_branding('crm.cliente-a.test')$$) = 0, 'domínio não verificado não mostra a marca');
select t.throws($$insert into tenant_domains (tenant_id, domain, kind) values (t.a(), 'outro.cliente-a.test', 'custom')$$, '23505',
  'uma empresa tem um domínio próprio só');
select t.ctx(null, null);
reset role;
update tenant_domains set verified_at = now(), dns_ok = true where domain = 'crm.cliente-a.test';
set role crm_app;
select t.ok((select tenant_id from app.public_branding('CRM.cliente-a.test ')) = t.a(), 'domínio verificado mostra a marca da empresa');
reset role;

-- Assinatura vencida suspende a empresa.
update tenant_subscriptions set current_period_end = now() - interval '1 minute' where tenant_id = t.b();
set role crm_dispatch;
select t.ok((select array_agg(tenant_id) from app.expire_subscriptions()) = array[t.b()], 'a assinatura vencida é encerrada');
select t.ok((select count(*) from app.expire_subscriptions()) = 0, 'e não de novo');
reset role;
select t.ok((select status from tenants where id = t.b()) = 'suspended', 'a empresa com assinatura vencida fica suspensa');
select t.ok((select status from tenant_subscriptions where tenant_id = t.b()) = 'expired', 'e a assinatura fica vencida');
select t.ok((select status from tenants where id = t.a()) = 'active', 'a outra empresa continua ativa');

-- A plataforma exclui uma empresa e tudo dela vai junto, inclusive exportações.
set role crm_platform;
select t.ok(t.affected($$delete from tenants where id = t.b()$$) = 1, 'a plataforma exclui uma empresa');
reset role;
select t.ok((select count(*) from contacts where tenant_id = t.b()) = 0, 'os contatos da empresa excluída somem');
select t.ok((select count(*) from exports where tenant_id = t.b()) = 0, 'as exportações também, na cascata');
select t.ok((select count(*) from contacts where tenant_id = t.a()) > 0, 'os da outra empresa ficam');
select t.throws($$delete from exports where tenant_id = t.a()$$, '42501', 'fora da cascata, exportação continua sem exclusão');
