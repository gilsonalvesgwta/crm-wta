-- Conversas e respostas prontas.

set role crm_app;
select t.ctx(t.a(), t.ua());
delete from conversations where contact_id = t.id(t.a(), 2);

-- Mensagem recebida cria a conversa do contato naquele canal, aberta.
insert into messages (tenant_id, channel, direction, status, contact_id, remote, body, created_at)
values (t.a(), 'whatsapp', 'in', 'received', t.id(t.a(), 2), '+5511988887777', 'oi', now() - interval '10 minutes');
select t.ok((select status from conversations where contact_id = t.id(t.a(), 2) and channel = 'whatsapp') = 'open',
  'mensagem recebida abre a conversa');
select t.ok((select first_response_at from conversations where contact_id = t.id(t.a(), 2) and channel = 'whatsapp') is null,
  'ainda sem resposta');

-- E-mail é outra conversa.
insert into messages (tenant_id, channel, direction, status, contact_id, remote, subject, body)
values (t.a(), 'email', 'out', 'sent', t.id(t.a(), 2), 'c3@cliente.test', 'Proposta', 'segue');
select t.ok((select count(*) from conversations where contact_id = t.id(t.a(), 2)) = 2, 'WhatsApp e e-mail em conversas separadas');

-- A primeira resposta de uma pessoa marca o tempo e vira responsável se não houver.
update conversations set assignee_membership_id = null where contact_id = t.id(t.a(), 2);
insert into messages (tenant_id, channel, direction, status, contact_id, remote, body, sent_by, created_at)
select t.a(), 'whatsapp', 'out', 'sent', t.id(t.a(), 2), '+5511988887777', 'olá', m.id, now() - interval '5 minutes'
  from memberships m where m.tenant_id = t.a() and m.user_id = t.ua();
select t.ok((select first_response_at is not null and assignee_membership_id is not null
               from conversations where contact_id = t.id(t.a(), 2) and channel = 'whatsapp'),
  'a primeira resposta conta o tempo e define o responsável');

-- Encerrada e o cliente escreve de novo: reabre, atendimento novo.
update conversations set status = 'closed', closed_at = now() where contact_id = t.id(t.a(), 2) and channel = 'whatsapp';
insert into messages (tenant_id, channel, direction, status, contact_id, remote, body)
values (t.a(), 'whatsapp', 'in', 'received', t.id(t.a(), 2), '+5511988887777', 'voltei');
select t.ok((select status = 'open' and closed_at is null and first_response_at is null and opened_at > now() - interval '1 minute'
               from conversations where contact_id = t.id(t.a(), 2) and channel = 'whatsapp'),
  'mensagem nova reabre a conversa encerrada');

-- Isolamento.
select t.throws($$update conversations set assignee_membership_id = t.mb()
                   where contact_id = t.id(t.a(), 2)$$, '23503', 'responsável de outra empresa é recusado');
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from conversations where tenant_id = t.a()$$) = 0, 'a empresa B não vê conversas da A');

-- Respostas prontas: atalho único por canal e por dono.
select t.ctx(t.a(), t.ua());
insert into quick_replies (tenant_id, channel, shortcut, title, body) values (t.a(), 'whatsapp', 'ola', 'Olá', 'Olá, {{primeiro_nome}}!');
select t.throws($$insert into quick_replies (tenant_id, channel, shortcut, title, body) values (t.a(), 'whatsapp', 'ola', 'Outro', 'x')$$,
  '23505', 'atalho repetido na empresa é recusado');
select t.ok(t.affected($$insert into quick_replies (tenant_id, channel, shortcut, title, body) values (t.a(), 'email', 'ola', 'Olá', 'x')$$) = 1,
  'o mesmo atalho vale em outro canal');
select t.ok(t.affected($$insert into quick_replies (tenant_id, channel, shortcut, title, body, owner_membership_id)
  select t.a(), 'whatsapp', 'ola', 'Meu olá', 'x', id from memberships where tenant_id = t.a() and user_id = t.ua()$$) = 1,
  'e uma pessoa pode ter o seu');
select t.throws($$insert into quick_replies (tenant_id, channel, shortcut, title, body) values (t.a(), 'whatsapp', 'Com Espaço', 'X', 'x')$$,
  '23514', 'atalho só com letras minúsculas, números, - e _');
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from quick_replies$$) = 0, 'a empresa B não vê as respostas da A');
select t.ctx(null, null);
reset role;
