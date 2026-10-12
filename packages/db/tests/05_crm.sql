-- Regras do CRM comercial (Fase 2).

grant usage on schema t to crm_dispatch;
grant execute on all functions in schema t to crm_dispatch;
grant select, insert on t.results to crm_dispatch;
grant usage on sequence t.results_n_seq to crm_dispatch;

set role crm_app;
select t.ctx(t.a(), t.ua());

-- Relações não cruzam empresas. ----------------------------------------------
select t.throws(
  $$insert into contacts (tenant_id, first_name, organization_id) values (t.a(), 'X', t.id(t.b(), 1))$$,
  '23503', 'contato de A não aponta para organização de B');
select t.throws(
  $$insert into deals (tenant_id, pipeline_id, stage_id, title) values (t.a(), t.id(t.a(), 3), t.id(t.b(), 4), 'X')$$,
  '23503', 'negócio de A não usa etapa de B');
select t.throws(
  $$insert into notes (tenant_id, body, deal_id) values (t.a(), 'x', t.id(t.b(), 7))$$,
  '23503', 'nota de A não aponta para negócio de B');
select t.throws(
  $$insert into contact_tags (tenant_id, contact_id, tag_id) values (t.a(), t.id(t.a(), 2), t.id(t.b(), 14))$$,
  '23503', 'contato de A não usa etiqueta de B');
select t.throws(
  $$insert into files (tenant_id, storage_key, purpose, original_name, content_type, size_bytes, sha256)
    values (t.a(), t.b()::text || '/x', 'attachment', 'a.txt', 'text/plain', 1, sha256('a'))$$,
  '23514', 'a chave do arquivo começa pela própria empresa');

-- Etapa precisa ser do funil do negócio. ---------------------------------------
insert into pipelines (id, tenant_id, name) values (t.id(t.a(), 103), t.a(), 'Pós-venda');
insert into pipeline_stages (id, tenant_id, pipeline_id, name, kind) values (t.id(t.a(), 104), t.a(), t.id(t.a(), 103), 'Início', 'open');
select t.throws(
  $$update deals set stage_id = t.id(t.a(), 104) where id = t.id(t.a(), 7)$$,
  '23503', 'negócio não vai para etapa de outro funil sem trocar o funil');

-- Status, fechamento e histórico acompanham a etapa. --------------------------
select t.ok((select status from deals where id = t.id(t.a(), 7)) = 'open', 'negócio em etapa aberta está aberto');
select t.ok(t.count($$select 1 from deal_stage_history where deal_id = t.id(t.a(), 7)$$) = 1, 'a criação registra a etapa inicial');
update deals set stage_id = t.id(t.a(), 6), outcome_reason_id = t.id(t.a(), 10) where id = t.id(t.a(), 7);
select t.ok((select status = 'lost' and closed_at is not null and outcome_reason_id is not null from deals where id = t.id(t.a(), 7)),
  'ir para etapa de perda marca perdido, com data e motivo');
select t.ok(t.count($$select 1 from deal_stage_history where deal_id = t.id(t.a(), 7) and from_stage_id = t.id(t.a(), 4) and to_stage_id = t.id(t.a(), 6) and seconds_in_previous >= 0$$) = 1,
  'a mudança de etapa fica no histórico com o tempo na anterior');
update deals set stage_id = t.id(t.a(), 4) where id = t.id(t.a(), 7);
select t.ok((select status = 'open' and closed_at is null and outcome_reason_id is null from deals where id = t.id(t.a(), 7)),
  'reabrir limpa fechamento e motivo');
update deals set title = 'Negócio renomeado' where id = t.id(t.a(), 7);
select t.ok(t.count($$select 1 from deal_stage_history where deal_id = t.id(t.a(), 7)$$) = 3, 'editar sem mudar de etapa não gera histórico');
select t.throws($$update deal_stage_history set moved_at = now()$$, '42501', 'histórico de etapas não é alterável');
select t.throws($$delete from deal_stage_history$$, '42501', 'histórico de etapas não é apagável pela aplicação');

-- Registros que só crescem. -----------------------------------------------------
select t.throws($$update consents set status = 'revoked'$$, '42501', 'consentimento não é alterado: muda com linha nova');
select t.throws($$delete from consents$$, '42501', 'consentimento não é apagado pela aplicação');
select t.throws($$update attribution_touches set source = 'outra'$$, '42501', 'a origem registrada não é sobrescrita');
select t.throws($$update timeline_entries set kind = 'x.y'$$, '42501', 'a linha do tempo não é alterada');
select t.throws($$update exports set row_count = 0$$, '42501', 'registro de exportação não é alterado');

-- Lembrete acompanha o início. --------------------------------------------------
select t.ok((select reminder_at = starts_at - interval '30 minutes' from activities where id = t.id(t.a(), 11)),
  'o lembrete é calculado a partir do início');
update activities set reminder_sent_at = now() where id = t.id(t.a(), 11);
update activities set starts_at = starts_at + interval '1 hour' where id = t.id(t.a(), 11);
select t.ok((select reminder_sent_at is null from activities where id = t.id(t.a(), 11)), 'mudar o início rearma o lembrete');
select t.throws(
  $$insert into activities (tenant_id, title, owner_membership_id, status) values (t.a(), 'x', t.ma(), 'done')$$,
  '23514', 'atividade concluída precisa da data de conclusão');

-- Datas de aniversário. -----------------------------------------------------------
select t.throws($$insert into contacts (tenant_id, first_name, birth_day, birth_month) values (t.a(), 'X', 31, 2)$$,
  '22008', '31 de fevereiro é recusado');
select t.throws($$insert into contacts (tenant_id, first_name, birth_day, birth_month, birth_year) values (t.a(), 'X', 29, 2, 2023)$$,
  '22008', '29 de fevereiro de ano não bissexto é recusado');
select t.ok(t.affected($$insert into contacts (tenant_id, first_name, birth_day, birth_month) values (t.a(), 'Leap', 29, 2)$$) = 1,
  '29 de fevereiro sem ano é aceito');

-- Notificações e visões salvas: cada pessoa vê as suas. -----------------------------
select t.ctx(t.a(), t.uab());
select t.ok(t.count('select 1 from notifications') = 0, 'notificação de outra pessoa não aparece');
select t.ok(t.affected('update notifications set read_at = now()') = 0, 'nem pode ser marcada como lida');
select t.ok(t.count('select 1 from saved_views') = 1, 'visão compartilhada aparece para os colegas');
select t.ok(t.affected('delete from saved_views') = 0, 'mas só o dono apaga');
select t.ctx(t.a(), t.ua());
select t.ok(t.count('select 1 from notifications') = 1, 'a própria notificação aparece');
select t.throws($$update notifications set title = 'x'$$, '42501', 'notificação só muda o campo de lida');

-- Busca normalizada. ----------------------------------------------------------------
select t.ok(t.count($$select 1 from contacts where app.norm(first_name || ' ' || coalesce(last_name, '')) like '%jose da%'$$) = 1,
  'a busca ignora acentos e maiúsculas');

-- O despachante só alcança as funções. ---------------------------------------------
select t.ctx(null, null);
reset role;
set role crm_dispatch;
select t.throws('select count(*) from activities', '42501', 'o despachante não lê atividades direto');
select t.throws('select count(*) from contacts', '42501', 'o despachante não lê contatos');
reset role;

-- Lembretes vencidos são entregues uma vez. -------------------------------------------
update activities set starts_at = now() + interval '10 minutes', reminder_minutes = 30 where id in (t.id(t.a(), 11), t.id(t.b(), 11));
set role crm_dispatch;
select t.ok((select count(*) from app.claim_due_reminders(10)) = 2, 'os lembretes vencidos das duas empresas são pegos');
select t.ok((select count(*) from app.claim_due_reminders(10)) = 0, 'e não são pegos de novo');
reset role;
update tenants set status = 'suspended' where id = t.b();
update activities set reminder_sent_at = null where id in (t.id(t.a(), 11), t.id(t.b(), 11));
set role crm_dispatch;
select t.ok((select array_agg(tenant_id) from app.claim_due_reminders(10)) = array[t.a()], 'empresa suspensa não recebe lembrete');
reset role;
update tenants set status = 'active' where id = t.b();

-- Importação: pendente é pega uma vez; em andamento com trava vencida é retomada. ----
update imports set status = 'pending' where id = t.id(t.a(), 13);
set role crm_dispatch;
select t.ok((select import_id from app.claim_import(60)) = t.id(t.a(), 13), 'a importação pendente é pega');
select t.ok((select count(*) from app.claim_import(60)) = 0, 'e fica travada enquanto é processada');
reset role;
update imports set locked_until = now() - interval '1 second' where id = t.id(t.a(), 13);
set role crm_dispatch;
select t.ok((select import_id from app.claim_import(60)) = t.id(t.a(), 13), 'trava vencida: a importação é retomada');
reset role;
select t.ok((select attempts from imports where id = t.id(t.a(), 13)) = 2, 'cada retomada conta uma tentativa');

set role crm_dispatch;
select t.ok((select count(*) from app.series_needing_extension(now() + interval '2 years', 10)) = 2,
  'séries com horizonte curto aparecem para extensão');
reset role;
