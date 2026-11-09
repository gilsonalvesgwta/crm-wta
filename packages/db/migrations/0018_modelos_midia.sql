-- 0018_modelos_midia
-- Modelos do WhatsApp oficial com cabeçalho de imagem, vídeo ou documento e
-- botões de link e de telefone (além das respostas rápidas). Só acrescenta
-- colunas: os modelos que já existem continuam iguais.
-- Compatível com PostgreSQL 16 ou superior.

set local role crm_owner;

alter table whatsapp_templates
  add column header_format   text check (header_format is null or header_format in ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT')),
  -- Arquivo da biblioteca de mídia mandado no cabeçalho (modelos criados aqui).
  add column header_file_id  uuid,
  -- Exemplo de mídia guardado na Meta (modelos trazidos de lá): usado no envio quando não há arquivo.
  add column header_media_url text check (header_media_url is null or (length(header_media_url) <= 2000 and header_media_url ~ '^https://')),
  add constraint whatsapp_templates_header_file_fk foreign key (tenant_id, header_file_id) references files (tenant_id, id) on delete set null (header_file_id);

update whatsapp_templates set header_format = 'TEXT' where header is not null and header_format is null;
