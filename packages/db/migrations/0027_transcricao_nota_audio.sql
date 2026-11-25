-- 0027_transcricao_nota_audio
-- Transcrição das notas de áudio: no próprio servidor (Whisper, sem serviço
-- pago) ou, se a empresa preferir, pela OpenAI com a chave da própria empresa.
-- O texto fica guardado junto da nota.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table notes add column transcript text check (transcript is null or length(transcript) <= 20000);
alter table notes add column transcript_status text check (transcript_status in ('pending', 'done', 'failed'));
alter table notes add column transcript_at timestamptz;
alter table notes add column transcript_by text check (transcript_by in ('local', 'openai'));

-- Como a empresa transcreve. Sem linha aqui: no servidor (local).
create table transcription_settings (
  tenant_id    uuid primary key references tenants (id) on delete cascade,
  provider     text not null default 'local' check (provider in ('local', 'openai')),
  -- Chave da OpenAI cifrada (nunca volta para a tela; só os 4 últimos caracteres).
  openai_key   bytea,
  openai_hint  text check (openai_hint is null or length(openai_hint) <= 8),
  openai_model text not null default 'gpt-4o-mini-transcribe'
    check (openai_model in ('gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1')),
  check (provider = 'local' or openai_key is not null),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  foreign key (tenant_id, updated_by) references memberships (tenant_id, id) on delete set null (updated_by)
);
create trigger transcription_settings_updated_at before update on transcription_settings
  for each row execute function app.set_updated_at();
alter table transcription_settings enable row level security;
alter table transcription_settings force row level security;
create policy tenant_isolation on transcription_settings for all to crm_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on transcription_settings to crm_app;
