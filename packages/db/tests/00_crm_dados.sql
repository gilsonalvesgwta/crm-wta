-- Dados do CRM para as empresas A e B, em todas as tabelas da Fase 2.
-- Os testes de isolamento percorrem toda tabela com tenant_id e exigem linhas
-- das duas empresas.

create function t.id(p_tenant uuid, p_n int) returns uuid
language sql immutable
as $$
  select md5(p_tenant::text || ':' || p_n)::uuid
$$;

-- Identificadores fixos: t.id(empresa, n), com n por tipo de registro.
-- 1 organização, 2 contato, 3 funil, 4 etapa aberta, 5 etapa ganha, 6 etapa
-- perdida, 7 negócio, 8 lead, 9 produto, 10 motivo, 11 atividade, 12 arquivo,
-- 13 importação, 14 etiqueta, 15 roteiro, 16 série, 17 campo.

create function t.seed_crm(p_tenant uuid, p_member uuid, p_team uuid) returns void
language plpgsql
as $$
begin
  insert into organizations (id, tenant_id, name, domain, owner_membership_id, team_id, created_by)
  values (t.id(p_tenant, 1), p_tenant, 'Organização', 'org.test', p_member, p_team, p_member);

  insert into contacts (id, tenant_id, first_name, last_name, organization_id, owner_membership_id, team_id, birth_day, birth_month)
  values (t.id(p_tenant, 2), p_tenant, 'José', 'da Silva', t.id(p_tenant, 1), p_member, p_team, 29, 2);
  insert into contact_emails (tenant_id, contact_id, email, is_primary) values (p_tenant, t.id(p_tenant, 2), 'jose@org.test', true);
  insert into contact_phones (tenant_id, contact_id, e164, is_primary) values (p_tenant, t.id(p_tenant, 2), '+5511999990000', true);

  insert into tags (id, tenant_id, name) values (t.id(p_tenant, 14), p_tenant, 'VIP');
  insert into contact_tags (tenant_id, contact_id, tag_id) values (p_tenant, t.id(p_tenant, 2), t.id(p_tenant, 14));
  insert into organization_tags (tenant_id, organization_id, tag_id) values (p_tenant, t.id(p_tenant, 1), t.id(p_tenant, 14));
  insert into custom_field_definitions (id, tenant_id, entity, key, label, type)
  values (t.id(p_tenant, 17), p_tenant, 'contact', 'cpf', 'CPF', 'text');

  insert into pipelines (id, tenant_id, name, restricted) values (t.id(p_tenant, 3), p_tenant, 'Vendas', true);
  insert into pipeline_access (tenant_id, pipeline_id, team_id) values (p_tenant, t.id(p_tenant, 3), p_team);
  insert into pipeline_stages (id, tenant_id, pipeline_id, name, position, kind, probability, required_fields) values
    (t.id(p_tenant, 4), p_tenant, t.id(p_tenant, 3), 'Proposta', 0, 'open', 50, '{}'),
    (t.id(p_tenant, 5), p_tenant, t.id(p_tenant, 3), 'Ganho', 1, 'won', 100, '{value}'),
    (t.id(p_tenant, 6), p_tenant, t.id(p_tenant, 3), 'Perdido', 2, 'lost', 0, '{}');
  insert into stage_transition_rules (tenant_id, pipeline_id, from_stage_id, to_stage_id)
  values (p_tenant, t.id(p_tenant, 3), t.id(p_tenant, 4), t.id(p_tenant, 5));

  insert into products (id, tenant_id, name, sku, price_cents) values (t.id(p_tenant, 9), p_tenant, 'Plano', 'PL-1', 10000);
  insert into outcome_reasons (id, tenant_id, kind, name) values (t.id(p_tenant, 10), p_tenant, 'lost', 'Preço');

  insert into leads (id, tenant_id, contact_id, title, source, owner_membership_id, team_id)
  values (t.id(p_tenant, 8), p_tenant, t.id(p_tenant, 2), 'Lead do site', 'site', p_member, p_team);
  insert into assignment_rules (id, tenant_id, name, team_id) values (t.id(p_tenant, 15), p_tenant, 'Rodízio', p_team);
  insert into assignment_rule_members (tenant_id, rule_id, membership_id, position) values (p_tenant, t.id(p_tenant, 15), p_member, 0);

  insert into deals (id, tenant_id, pipeline_id, stage_id, title, value_cents, contact_id, organization_id, lead_id, owner_membership_id, team_id)
  values (t.id(p_tenant, 7), p_tenant, t.id(p_tenant, 3), t.id(p_tenant, 4), 'Negócio', 10000, t.id(p_tenant, 2), t.id(p_tenant, 1), t.id(p_tenant, 8), p_member, p_team);
  update leads set deal_id = t.id(p_tenant, 7) where id = t.id(p_tenant, 8);
  insert into deal_participants (tenant_id, deal_id, membership_id) values (p_tenant, t.id(p_tenant, 7), p_member);
  insert into deal_tags (tenant_id, deal_id, tag_id) values (p_tenant, t.id(p_tenant, 7), t.id(p_tenant, 14));
  insert into deal_items (tenant_id, deal_id, product_id, name, quantity, unit_price_cents)
  values (p_tenant, t.id(p_tenant, 7), t.id(p_tenant, 9), 'Plano', 1, 10000);

  insert into notes (tenant_id, body, author_membership_id, contact_id) values (p_tenant, 'Ligou pedindo proposta', p_member, t.id(p_tenant, 2));
  insert into timeline_entries (tenant_id, kind, actor_membership_id, contact_id) values (p_tenant, 'contact.created', p_member, t.id(p_tenant, 2));
  insert into attribution_touches (tenant_id, contact_id, recorded_via, source, medium) values (p_tenant, t.id(p_tenant, 2), 'form', 'google', 'cpc');
  insert into consents (tenant_id, contact_id, channel, status, source) values (p_tenant, t.id(p_tenant, 2), 'email', 'granted', 'formulário do site');
  insert into suppression_list (tenant_id, channel, value, reason) values (p_tenant, 'email', 'saiu@org.test', 'opt_out');
  insert into contact_merges (tenant_id, kept_contact_id, merged_contact_id, snapshot)
  values (p_tenant, t.id(p_tenant, 2), gen_random_uuid(), '{"first_name":"Jose"}');

  insert into activity_series (id, tenant_id, rule, timezone, horizon_until)
  values (t.id(p_tenant, 16), p_tenant, '{"freq":"weekly","interval":1}', 'America/Sao_Paulo', now() + interval '1 year');
  insert into activities (id, tenant_id, type, title, starts_at, owner_membership_id, team_id, contact_id, deal_id, series_id, series_index, reminder_minutes)
  values (t.id(p_tenant, 11), p_tenant, 'call', 'Ligar', now() + interval '1 day', p_member, p_team, t.id(p_tenant, 2), t.id(p_tenant, 7), t.id(p_tenant, 16), 0, 30);
  insert into notifications (tenant_id, membership_id, kind, title, activity_id)
  values (p_tenant, p_member, 'activity.reminder', 'Ligar', t.id(p_tenant, 11));

  insert into files (id, tenant_id, storage_key, purpose, original_name, content_type, size_bytes, sha256, uploaded_by, contact_id)
  values (t.id(p_tenant, 12), p_tenant, p_tenant::text || '/2026/10/' || t.id(p_tenant, 12)::text, 'attachment', 'proposta.pdf', 'application/pdf', 10,
          sha256('x'), p_member, t.id(p_tenant, 2));
  insert into imports (id, tenant_id, entity, status, file_id, mapping, created_by)
  values (t.id(p_tenant, 13), p_tenant, 'contacts', 'done', t.id(p_tenant, 12), '{}', p_member);
  insert into import_rows (tenant_id, import_id, row_number, status, errors)
  values (p_tenant, t.id(p_tenant, 13), 2, 'error', '[{"field":"email","message":"inválido"}]');
  insert into exports (tenant_id, entity, row_count, created_by) values (p_tenant, 'contacts', 1, p_member);
  insert into saved_views (tenant_id, membership_id, entity, name, shared) values (p_tenant, p_member, 'contacts', 'Meus VIP', true);
end
$$;

select t.seed_crm(t.a(), t.ma(), t.team_a());
select t.seed_crm(t.b(), t.mb(), t.team_b());

-- Planos e assinaturas (Fase 2, venda do CRM).
insert into plans (id, name, limits) values
  ('00000000-0000-7000-8000-0000000000f1', 'Essencial', '{"max_users": 3, "custom_domain": false}');
insert into tenant_subscriptions (tenant_id, plan_id, status, current_period_end) values
  (t.a(), '00000000-0000-7000-8000-0000000000f1', 'active', now() + interval '30 days'),
  (t.b(), '00000000-0000-7000-8000-0000000000f1', 'active', now() + interval '30 days');
