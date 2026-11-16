-- 0025_notas_audio_negocio_parado
-- Notas com áudio gravado e aviso de negócio parado (no card e por WhatsApp).
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

-- Nota pode ser só o áudio (texto opcional).
alter table notes add column file_id uuid;
alter table notes add constraint notes_file_fk foreign key (tenant_id, file_id) references files (tenant_id, id) on delete set null (file_id);
alter table notes drop constraint notes_body_check;
alter table notes alter column body set default '';
alter table notes add constraint notes_body_check check (length(body) <= 20000 and (length(btrim(body)) >= 1 or file_id is not null));

-- Negócio parado, por funil: depois de quantos dias sem movimentação aparece o aviso,
-- de quantos em quantos dias avisa por WhatsApp quem cadastrou e por qual número.
alter table pipelines add column stale_days integer check (stale_days is null or stale_days between 1 and 365);
alter table pipelines add column stale_notify_days integer check (stale_notify_days is null or stale_notify_days between 1 and 365);
alter table pipelines add column stale_account_id uuid;
alter table pipelines add constraint pipelines_stale_account_fk
  foreign key (tenant_id, stale_account_id) references channel_accounts (tenant_id, id) on delete set null (stale_account_id);
alter table deals add column stale_notified_at timestamptz;

-- Despachante: negócios parados que devem gerar aviso agora (marca o aviso).
-- Avisa de novo a cada "stale_notify_days" dias, ou logo depois de voltar a
-- ficar parado se o negócio andou desde o último aviso. Só em horário comercial
-- (8h às 20h no fuso da empresa).
create function app.claim_stale_deals(p_limit int)
returns table (tenant_id uuid, deal_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select d.id from deals d
    join tenants t on t.id = d.tenant_id and t.status = 'active'
    join pipelines pl on pl.id = d.pipeline_id and pl.archived_at is null and pl.stale_notify_days is not null and pl.stale_account_id is not null
    join pipeline_stages s on s.id = d.stage_id
    where d.status = 'open'
      and coalesce(s.rotting_days, pl.stale_days) is not null
      and greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at)) < now() - make_interval(days => coalesce(s.rotting_days, pl.stale_days))
      and (d.stale_notified_at is null
           or d.stale_notified_at < greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at))
           or d.stale_notified_at <= now() - make_interval(days => pl.stale_notify_days))
      and extract(hour from now() at time zone t.timezone) between 8 and 19
    order by d.stage_entered_at
    limit greatest(least(p_limit, 200), 1)
    for update of d skip locked
  )
  update deals d set stale_notified_at = now()
    from due where d.id = due.id
  returning d.tenant_id, d.id;
$$;
revoke all on function app.claim_stale_deals(int) from public;
grant execute on function app.claim_stale_deals(int) to crm_dispatch;
