-- Notas com áudio e negócio parado.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into notes (tenant_id, body, contact_id) values (t.a(), '  ', t.id(t.a(), 1))$$, '23514', 'nota vazia sem áudio não vale');
select t.throws($$update pipelines set stale_days = 0 where tenant_id = t.a()$$, '23514', 'prazo de parado precisa ser de 1 a 365 dias');
select t.ok(t.affected($$update pipelines set stale_days = 7, stale_notify_days = 3 where tenant_id = t.a()$$) >= 1, 'prazo de negócio parado por funil');
select t.throws($$update pipelines set stale_recipients = 'todos' where tenant_id = t.a()$$, '23514', 'quem recebe o aviso fora da lista');
select t.ok(t.affected($$update pipelines set stale_recipients = 'owner_fixed', stale_member_ids = array[t.id(t.a(), 1)], stale_in_app = true where tenant_id = t.a()$$) >= 1,
  'aviso para o responsável e pessoas fixas, no CRM');
select t.throws($$update notes set transcript_status = 'talvez' where tenant_id = t.a()$$, '23514', 'situação da transcrição fora da lista');
select t.ok(t.affected($$update notes set transcript = 'Olá', transcript_status = 'done', transcript_at = now(), transcript_by = 'local' where tenant_id = t.a()$$) >= 1, 'nota guarda a transcrição');
select t.throws($$update transcription_settings set provider = 'openai' where tenant_id = t.a()$$, '23514', 'OpenAI sem chave não vale');
select t.ok(t.affected($$update transcription_settings set provider = 'openai', openai_key = '\x01', openai_hint = 'abcd' where tenant_id = t.a()$$) = 1, 'transcrição pela OpenAI');
select t.throws($$insert into transcription_settings (tenant_id) values (t.b())$$, '42501', 'não grava a configuração de outra empresa');
select t.throws($$update transcription_settings set openai_model = 'gpt-9' where tenant_id = t.a()$$, '23514', 'modelo fora da lista');
select t.ctx(null, null);
reset role;

set role crm_app;
select t.ctx(t.b(), t.ub());
select t.ok(t.count($$select 1 from transcription_settings where openai_key is not null$$) = 0, 'outra empresa não vê a chave da OpenAI');
select t.ctx(null, null);
reset role;

-- Campanhas: dias da semana e limites.
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$update campaigns set window_days = array[8]::smallint[] where tenant_id = t.a()$$, '23514', 'dia da semana fora de 1 a 7');
select t.throws($$update campaigns set max_per_hour = 0 where tenant_id = t.a()$$, '23514', 'limite por hora precisa ser positivo');
select t.ok(t.affected($$update campaigns set window_days = array[1,2,3,4,5]::smallint[], max_per_day = 200 where tenant_id = t.a()$$) >= 0, 'dias úteis e limite por dia');
select t.ctx(null, null);
reset role;
