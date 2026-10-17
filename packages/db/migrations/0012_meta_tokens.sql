-- 0012_meta_tokens
-- Renovação automática dos tokens do Instagram (valem 60 dias): o
-- despachante pega as contas com token renovado há mais de 7 dias.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

create function app.meta_token_refresh_due(p_limit int)
returns table (tenant_id uuid, account_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select a.id from channel_accounts a
    join tenants t on t.id = a.tenant_id and t.status = 'active'
    where a.kind = 'instagram' and coalesce(a.config->>'host', 'instagram') = 'instagram' and a.secret is not null
      and coalesce((a.config->>'tokenRefreshedAt')::timestamptz, a.created_at) < now() - interval '7 days'
      -- Uma tentativa por dia, mesmo se falhar.
      and coalesce((a.config->>'tokenRefreshTriedAt')::timestamptz, '-infinity') < now() - interval '1 day'
    order by a.id
    limit greatest(least(p_limit, 100), 1)
    for update of a skip locked
  )
  update channel_accounts a set config = a.config || jsonb_build_object('tokenRefreshTriedAt', now())
  from due where a.id = due.id
  returning a.tenant_id, a.id
$$;
revoke all on function app.meta_token_refresh_due(int) from public;
grant execute on function app.meta_token_refresh_due(int) to crm_dispatch;
