-- Resultado das ligações e reuniões.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into activities (tenant_id, type, title, owner_membership_id, outcome)
  values (t.a(), 'call', 'Call', t.ma(), 'held')$$, '23514', 'atividade em aberto não tem resultado');
select t.throws($$insert into activities (tenant_id, type, title, owner_membership_id, status, done_at, outcome)
  values (t.a(), 'call', 'Call', t.ma(), 'done', now(), 'talvez')$$, '23514', 'resultado fora da lista é recusado');
select t.ok(t.affected($$insert into activities (tenant_id, type, title, owner_membership_id, status, done_at, outcome)
  values (t.a(), 'call', 'Call', t.ma(), 'done', now(), 'no_show')$$) = 1, 'call concluída com "não compareceu"');
select t.ctx(null, null);
reset role;
