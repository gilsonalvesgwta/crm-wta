-- 0033_voz_velip
-- Velip como operadora de voz: ligação com áudio gravado, voz sintética (TTS),
-- teclas, transferência para atendente, gravação, novas tentativas e horário
-- permitido por DDD. O áudio da campanha é enviado à Velip uma vez e o
-- identificador dela fica guardado na operadora.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table voice_providers drop constraint voice_providers_provider_check;
alter table voice_providers add constraint voice_providers_provider_check
  check (provider in ('twilio', 'plivo', 'telnyx', 'zenvia', 'infobip', 'sip', 'http', 'velip'));
-- Identificadores dos áudios já enviados à operadora: {"<id do arquivo>": "tf12345"}.
alter table voice_providers add column audio_cache jsonb not null default '{}'::jsonb check (jsonb_typeof(audio_cache) = 'object');

-- Gravação da ligação (quando a operadora grava, ex.: transferência para atendente).
alter table campaign_recipients add column call_recording_url text check (call_recording_url is null or length(call_recording_url) <= 1000);
-- Aviso da operadora sem o nosso identificador: acha a ligação pelo dela.
create index campaign_recipients_call_ref_idx on campaign_recipients (call_ref) where call_ref is not null;
