-- 0019_midia_instagram
-- Endereço da mídia das mensagens do Instagram (imagem, vídeo, áudio,
-- arquivo, reels e publicações compartilhados), para buscar o arquivo de novo
-- quando o download na hora do aviso falhar (só de domínios da Meta, conferido
-- na hora de baixar). Só acrescenta uma coluna.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table messages
  add column media_url text check (media_url is null or (length(media_url) <= 4000 and media_url ~ '^https?://'));
