-- 0023_whatsapp_fluxos
-- Fluxos também no WhatsApp oficial (estilo Manychat): a transmissão manda um
-- modelo aprovado com botões e o clique continua a conversa pelo fluxo.
-- Reaproveita as tabelas dos fluxos do Instagram com a coluna "channel"; os
-- fluxos que já existem ficam no Instagram, sem mudança.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table ig_flows add column channel text not null default 'instagram' check (channel in ('instagram', 'whatsapp'));

-- Gatilhos do WhatsApp: transmissão (campanha) e palavra-chave na mensagem.
alter table ig_flows drop constraint ig_flows_trigger_type_check;
alter table ig_flows add constraint ig_flows_trigger_type_check check (trigger_type in (
  'comment', 'live_comment', 'dm_keyword', 'story_reply', 'story_mention', 'reaction', 'wa_broadcast', 'wa_keyword'));
alter table ig_flows add constraint ig_flows_channel_trigger_check check (
  (channel = 'whatsapp') = (trigger_type in ('wa_broadcast', 'wa_keyword')));
create index ig_flows_channel_idx on ig_flows (tenant_id, channel, updated_at desc);

-- Execução que começou por uma campanha (transmissão).
alter table ig_flow_runs add column campaign_id uuid;
alter table ig_flow_runs add constraint ig_flow_runs_campaign_fk
  foreign key (tenant_id, campaign_id) references campaigns (tenant_id, id) on delete set null (campaign_id);
create index ig_flow_runs_campaign_idx on ig_flow_runs (campaign_id) where campaign_id is not null;

-- Campanha do WhatsApp oficial que roda um fluxo de transmissão.
alter table campaigns add column flow_id uuid;
alter table campaigns add constraint campaigns_flow_fk
  foreign key (tenant_id, flow_id) references ig_flows (tenant_id, id) on delete set null (flow_id);
