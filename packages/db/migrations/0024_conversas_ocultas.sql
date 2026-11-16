-- 0024_conversas_ocultas
-- Conversas ocultas: o administrador (ou gestor) tira da lista o que não é
-- atendimento (spam, contatos pessoais). Continuam guardadas e podem voltar;
-- mensagens novas não trazem a conversa de volta.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table conversations add column hidden_at timestamptz;
alter table conversations add column hidden_by uuid;
create index conversations_visible_idx on conversations (tenant_id, last_message_at desc) where hidden_at is null;

-- Filtro por número/conexão: conversas com mensagem de uma conta.
create index if not exists messages_account_contact_idx on messages (channel_account_id, contact_id, channel);
