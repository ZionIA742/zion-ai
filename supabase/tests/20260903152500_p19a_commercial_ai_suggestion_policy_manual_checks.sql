do $$
declare
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_result public.store_commercial_ai_settings%rowtype;
begin
  insert into public.organizations (id, name)
  values (v_org_a, 'P19A Suggestion Policy A'), (v_org_b, 'P19A Suggestion Policy B');

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P19A Store A'),
    (v_store_b, v_org_b, 'P19A Store B');

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_commercial_ai_settings'
      and column_name in (
        'complementary_suggestions_enabled',
        'complementary_scope_mode',
        'complementary_category_keys',
        'complementary_line_keys',
        'complementary_allowed_moments',
        'superior_option_suggestions_enabled',
        'superior_option_allowed_triggers'
      )
    having count(*) = 7
  ) then
    raise exception 'FAIL: suggestion policy columns are missing';
  end if;

  v_result := public.upsert_store_commercial_ai_suggestion_policy_scoped(
    v_org_a,
    v_store_a,
    false,
    'selected_scope',
    array['acessorios'],
    array['premium'],
    array['after_product_interest'],
    false,
    array['materially_relevant_advantage']
  );

  if v_result.complementary_suggestions_enabled is not false
     or v_result.complementary_scope_mode <> 'all_compatible'
     or v_result.complementary_category_keys <> '{}'::text[]
     or v_result.complementary_line_keys <> '{}'::text[]
     or v_result.complementary_allowed_moments <> '{}'::text[]
     or v_result.superior_option_suggestions_enabled is not false
     or v_result.superior_option_allowed_triggers <> '{}'::text[] then
    raise exception 'FAIL: disabled policy did not normalize dependent payload';
  end if;

  v_result := public.upsert_store_commercial_ai_suggestion_policy_scoped(
    v_org_a,
    v_store_a,
    true,
    'selected_scope',
    array['quimicos', 'quimicos'],
    array['tratamento', 'tratamento'],
    array['after_product_interest', 'during_proposal_preparation'],
    true,
    array['materially_relevant_advantage']
  );

  if v_result.complementary_suggestions_enabled is not true
     or v_result.complementary_scope_mode <> 'selected_scope'
     or v_result.complementary_category_keys <> array['quimicos']::text[]
     or v_result.complementary_line_keys <> array['tratamento']::text[]
     or v_result.complementary_allowed_moments <> array['after_product_interest', 'during_proposal_preparation']::text[]
     or v_result.superior_option_suggestions_enabled is not true
     or v_result.superior_option_allowed_triggers <> array['materially_relevant_advantage']::text[] then
    raise exception 'FAIL: enabled policy did not persist normalized canonical payload';
  end if;

  begin
    perform public.upsert_store_commercial_ai_suggestion_policy_scoped(
      v_org_a,
      v_store_a,
      true,
      'selected_scope',
      '{}'::text[],
      '{}'::text[],
      array['after_product_interest'],
      false,
      '{}'::text[]
    );
    raise exception 'FAIL: selected_scope without categories or lines was accepted';
  exception
    when check_violation or invalid_parameter_value then
      null;
  end;

  begin
    perform public.upsert_store_commercial_ai_suggestion_policy_scoped(
      v_org_a,
      v_store_a,
      true,
      'all_compatible',
      '{}'::text[],
      '{}'::text[],
      array['invalid_moment'],
      false,
      '{}'::text[]
    );
    raise exception 'FAIL: invalid complementary moment was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    perform public.upsert_store_commercial_ai_suggestion_policy_scoped(
      v_org_a,
      v_store_b,
      false,
      'all_compatible',
      '{}'::text[],
      '{}'::text[],
      '{}'::text[],
      false,
      '{}'::text[]
    );
    raise exception 'FAIL: mismatched organization/store scope was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  if exists (
    select 1
    from public.store_commercial_ai_settings settings_row
    where settings_row.organization_id = v_org_b
      and settings_row.store_id = v_store_b
  ) then
    raise exception 'FAIL: wrong-tenant row was written';
  end if;

  raise notice 'PASS: p19a commercial AI suggestion policy manual checks';
end $$;
