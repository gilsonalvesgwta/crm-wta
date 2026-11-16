-- Notas com áudio e negócio parado.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into notes (tenant_id, body, contact_id) values (t.a(), '  ', t.id(t.a(), 1))$$, '23514', 'nota vazia sem áudio não vale');
select t.throws($$update pipelines set stale_days = 0 where tenant_id = t.a()$$, '23514', 'prazo de parado precisa ser de 1 a 365 dias');
select t.ok(t.affected($$update pipelines set stale_days = 7, stale_notify_days = 3 where tenant_id = t.a()$$) >= 1, 'prazo de negócio parado por funil');
select t.throws($$update pipelines set stale_recipients = 'todos' where tenant_id = t.a()$$, '23514', 'quem recebe o aviso fora da lista');
select t.ok(t.affected($$update pipelines set stale_recipients = 'owner_fixed', stale_member_ids = array[t.id(t.a(), 1)], stale_in_app = true where tenant_id = t.a()$$) >= 1,
  'aviso para o responsável e pessoas fixas, no CRM');
select t.ctx(null, null);
reset role;
