-- 0030_campanhas_voz
-- Campanhas de voz (torpedo de voz): ligação automática que toca um áudio
-- gravado, com teclas opcionais (1, 2…) e, se quiser, WhatsApp e SMS junto.
-- A empresa cadastra uma ou mais operadoras (Twilio, Plivo, Telnyx, Zenvia,
-- Infobip, a própria central SIP/Asterisk ou outra por API) e escolhe qual usar
-- em cada campanha.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

create table voice_providers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  provider      text not null check (provider in ('twilio', 'plivo', 'telnyx', 'zenvia', 'infobip', 'sip', 'http')),
  -- Dados sem segredo: número que aparece (bina), conta, endereço da central etc.
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  -- Token, senha ou chave da operadora, cifrados pela aplicação (nunca voltam para a tela).
  secret        bytea,
  secret_hint   text check (secret_hint is null or length(secret_hint) <= 8),
  -- untested: ainda sem ligação de teste atendida; ok: testada; error: o último teste falhou.
  status        text not null default 'untested' check (status in ('untested', 'ok', 'error')),
  last_error    text check (last_error is null or length(last_error) <= 500),
  tested_at     timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references memberships (tenant_id, id) on delete set null (created_by)
);
create index voice_providers_tenant_idx on voice_providers (tenant_id, created_at);
create trigger voice_providers_updated_at before update on voice_providers
  for each row execute function app.set_updated_at();
alter table voice_providers enable row level security;
alter table voice_providers force row level security;
create policy tenant_isolation on voice_providers for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on voice_providers to crm_app;

-- Campanha de voz: operadora escolhida, áudio (file_id) e as opções (teclas, WhatsApp, SMS).
alter table campaigns drop constraint campaigns_channel_check;
alter table campaigns add constraint campaigns_channel_check check (channel in ('whatsapp', 'email', 'voice'));
alter table campaigns add column voice_provider_id uuid;
alter table campaigns add constraint campaigns_voice_provider_fk
  foreign key (tenant_id, voice_provider_id) references voice_providers (tenant_id, id) on delete set null (voice_provider_id);
-- {"digits": true, "keys": {"1": {"label": "Quero saber mais", "tagId": "…", "whatsapp": true}}, "ringSeconds": 30,
--  "machineDetection": false, "whatsapp": {"accountId": "…", "text": "…", "when": "with_call"}, "sms": {"text": "…", "when": "not_answered"}}
alter table campaigns add column voice jsonb not null default '{}'::jsonb check (jsonb_typeof(voice) = 'object');

-- Resultado de cada ligação.
alter table campaign_recipients add column call_ref text check (call_ref is null or length(call_ref) <= 120);
alter table campaign_recipients add column call_status text
  check (call_status in ('queued', 'answered', 'no_answer', 'busy', 'failed', 'machine', 'canceled'));
alter table campaign_recipients add column call_seconds int check (call_seconds is null or call_seconds between 0 and 86400);
alter table campaign_recipients add column call_digits text check (call_digits is null or call_digits ~ '^[0-9*#]{0,20}$');
alter table campaign_recipients add column call_ended_at timestamptz;
alter table campaign_recipients add column call_checked_at timestamptz;
-- O que saiu junto: {"whatsapp": "sent" | "failed", "sms": "sent" | "failed"}.
alter table campaign_recipients add column call_extras jsonb not null default '{}'::jsonb check (jsonb_typeof(call_extras) = 'object');
create index campaign_recipients_call_wait_idx on campaign_recipients (sent_at) where call_status is not null and call_ended_at is null;

-- Aviso da operadora: de qual empresa é a operadora (o endereço já vem assinado). Só empresas ativas.
create function app.voice_provider_tenant(p_id uuid)
returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select v.tenant_id from public.voice_providers v
  join public.tenants t on t.id = v.tenant_id and t.status = 'active'
  where v.id = p_id
$$;
revoke all on function app.voice_provider_tenant(uuid) from public;
grant execute on function app.voice_provider_tenant(uuid) to crm_app;

-- Ligações sem resultado final ainda: o despachante pergunta à operadora (Zenvia)
-- ou encerra as que ficaram sem retorno. Marca a consulta para não repetir em seguida.
create function app.voice_pending_calls(p_limit int)
returns table (tenant_id uuid, recipient_id uuid)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with due as (
    select r.id from campaign_recipients r
    join tenants t on t.id = r.tenant_id and t.status = 'active'
    where r.call_status is not null and r.call_ended_at is null and r.sent_at < now() - interval '90 seconds'
      and (r.call_checked_at is null or r.call_checked_at < now() - interval '2 minutes')
    order by r.sent_at
    limit greatest(least(p_limit, 200), 1)
    for update of r skip locked
  )
  update campaign_recipients r set call_checked_at = now()
  from due where r.id = due.id
  returning r.tenant_id, r.id
$$;
revoke all on function app.voice_pending_calls(int) from public;
grant execute on function app.voice_pending_calls(int) to crm_dispatch;
