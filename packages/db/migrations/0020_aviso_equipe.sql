-- 0020_aviso_equipe
-- WhatsApp de cada pessoa da equipe na empresa, para os avisos das automações
-- ("Avisar a equipe"). Só acrescenta uma coluna.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table memberships
  add column notify_phone text check (notify_phone is null or notify_phone ~ '^\+[1-9][0-9]{7,14}$');
