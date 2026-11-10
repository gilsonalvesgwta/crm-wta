-- Modelos do WhatsApp oficial com cabeçalho de mídia.

set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into whatsapp_templates (tenant_id, channel_account_id, name, language, category, body, header_format)
  values (t.a(), t.id(t.a(), 25), 'com_gif', 'pt_BR', 'MARKETING', 'x', 'GIF')$$, '23514', 'formato de cabeçalho fora da lista é recusado');
select t.throws($$insert into whatsapp_templates (tenant_id, channel_account_id, name, language, category, body, header_format, header_media_url)
  values (t.a(), t.id(t.a(), 25), 'com_http', 'pt_BR', 'MARKETING', 'x', 'IMAGE', 'http://exemplo.com/a.jpg')$$, '23514', 'exemplo da mídia só com https');
select t.throws($$insert into whatsapp_templates (tenant_id, channel_account_id, name, language, category, body, header_format, header_file_id)
  values (t.a(), t.id(t.a(), 25), 'com_arquivo_b', 'pt_BR', 'MARKETING', 'x', 'IMAGE', gen_random_uuid())$$, '23503', 'o arquivo do cabeçalho precisa existir na empresa');
select t.ok(t.affected($$insert into whatsapp_templates (tenant_id, channel_account_id, name, language, category, body, header_format, header_media_url)
  values (t.a(), t.id(t.a(), 25), 'com_imagem', 'pt_BR', 'MARKETING', 'Oferta', 'IMAGE', 'https://scontent.whatsapp.net/a.jpg')$$) = 1, 'modelo com imagem no cabeçalho');
select t.ctx(null, null);
reset role;

-- Endereço da mídia das mensagens do Instagram.
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into messages (tenant_id, channel, direction, status, contact_id, remote, body, kind, media_url)
  values (t.a(), 'instagram', 'in', 'received', t.id(t.a(), 2), '17841400000001', null, 'image', 'javascript:alert(1)')$$, '23514', 'endereço da mídia só http(s)');
select t.ok(t.affected($$insert into messages (tenant_id, channel, direction, status, contact_id, remote, kind, media_url)
  values (t.a(), 'instagram', 'in', 'received', t.id(t.a(), 2), '17841400000001', 'audio', 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1')$$) = 1, 'mensagem com o endereço da mídia');
select t.ctx(null, null);
reset role;

-- WhatsApp da pessoa da equipe para os avisos.
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$update memberships set notify_phone = '47 99999-0000' where tenant_id = t.a()$$, '23514', 'WhatsApp do aviso no formato +DDI');
select t.ok(t.affected($$update memberships set notify_phone = '+5547999990000' where id = (select id from memberships where tenant_id = t.a() limit 1)$$) = 1, 'WhatsApp do aviso guardado');
select t.ctx(null, null);
reset role;

-- Importação de negócios.
set role crm_app;
select t.ctx(t.a(), t.ua());
select t.throws($$insert into imports (tenant_id, entity, file_id, mapping, total_rows) values (t.a(), 'tarefas', gen_random_uuid(), '{}', 1)$$, '23514', 'tipo de importação fora da lista');
select t.ctx(null, null);
reset role;
