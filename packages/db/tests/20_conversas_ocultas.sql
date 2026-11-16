-- Conversas ocultas.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.ok(t.count($$select 1 from conversations where hidden_at is not null$$) = 0, 'nenhuma conversa oculta por padrão');
select t.ok(t.affected($$update conversations set hidden_at = now(), hidden_by = t.id(t.a(), 1) where tenant_id = t.a()$$) >= 0, 'ocultar conversa');
select t.ctx(null, null);
reset role;
