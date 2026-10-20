-- 0013_resultado_das_calls
-- Resultado de uma ligação ou reunião concluída (realizada, não compareceu,
-- remarcada), para os indicadores comerciais.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table activities add column outcome text
  check (outcome is null or outcome in ('held', 'no_show', 'rescheduled'));
-- Só atividade concluída tem resultado; reabrir apaga o resultado.
alter table activities add constraint activities_outcome_done check (outcome is null or status = 'done');

create index activities_calls_idx on activities (tenant_id, coalesce(starts_at, done_at))
  where type in ('call', 'meeting');
