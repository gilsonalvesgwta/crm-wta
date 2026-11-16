-- 0026_aviso_parado_destinatarios
-- Aviso de negócio parado: quem recebe (quem cadastrou, o responsável e/ou
-- pessoas fixas) e por onde (WhatsApp e/ou aviso no próprio CRM). O envio
-- junta os negócios de cada pessoa numa mensagem só.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table pipelines add column stale_recipients text not null default 'creator'
  check (stale_recipients in ('creator', 'owner', 'fixed', 'owner_fixed'));
alter table pipelines add column stale_member_ids uuid[] not null default '{}';
alter table pipelines add column stale_whatsapp boolean not null default true;
alter table pipelines add column stale_in_app boolean not null default false;

create or replace function app.claim_stale_deals(p_limit int)
returns table (tenant_id uuid, deal_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select d.id from deals d
    join tenants t on t.id = d.tenant_id and t.status = 'active'
    join pipelines pl on pl.id = d.pipeline_id and pl.archived_at is null and pl.stale_notify_days is not null
      and ((pl.stale_whatsapp and pl.stale_account_id is not null) or pl.stale_in_app)
    join pipeline_stages s on s.id = d.stage_id
    where d.status = 'open'
      and coalesce(s.rotting_days, pl.stale_days) is not null
      and greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at)) < now() - make_interval(days => coalesce(s.rotting_days, pl.stale_days))
      and (d.stale_notified_at is null
           or d.stale_notified_at < greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at))
           or d.stale_notified_at <= now() - make_interval(days => pl.stale_notify_days))
      and extract(hour from now() at time zone t.timezone) between 8 and 19
    order by d.tenant_id, d.stage_entered_at
    limit greatest(least(p_limit, 2000), 1)
    for update of d skip locked
  )
  update deals d set stale_notified_at = now()
    from due where d.id = due.id
  returning d.tenant_id, d.id;
$$;
