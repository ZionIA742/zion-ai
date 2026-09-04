begin;

do $$
declare
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_result public.store_operation_settings%rowtype;
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'P19A Technical Visit Pricing A'),
    (v_org_b, 'P19A Technical Visit Pricing B');

  insert into public.stores (id, organization_id, name)
  values
    (v_store_a, v_org_a, 'P19A Store A'),
    (v_store_b, v_org_b, 'P19A Store B');

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_operation_settings'
      and column_name in (
        'technical_visit_pricing_mode',
        'technical_visit_fixed_fee_cents',
        'technical_visit_case_by_case_rule',
        'technical_visit_fee_deductible_from_purchase'
      )
    having count(*) = 4
  ) then
    raise exception 'FAIL: technical visit pricing columns are missing';
  end if;

  begin
    insert into public.store_operation_settings (
      organization_id,
      store_id,
      technical_visit_pricing_mode
    )
    values (v_org_a, v_store_a, 'invalid_mode');

    raise exception 'FAIL: invalid pricing mode bypassed constraint';
  exception
    when check_violation then
      null;
  end;

  insert into public.store_operation_settings (
    organization_id,
    store_id,
    offers_installation,
    average_installation_time_days,
    installation_days_rule,
    installation_process_notes,
    offers_technical_visit,
    technical_visit_days_rule,
    technical_visit_rules,
    technical_visit_rules_other
  )
  values (
    v_org_a,
    v_store_a,
    true,
    3,
    'Instalacao preservada',
    'Notas preservadas',
    true,
    'Dias preservados',
    array['precisa_agendar', 'pode_ter_taxa']::text[],
    'Outro preservado'
  );

  v_result := public.upsert_store_operation_technical_visit_pricing_scoped(
    v_org_a,
    v_store_a,
    'free',
    10000,
    'residual case rule',
    true
  );

  if v_result.technical_visit_pricing_mode <> 'free'
     or v_result.technical_visit_fixed_fee_cents is not null
     or v_result.technical_visit_case_by_case_rule is not null
     or v_result.technical_visit_fee_deductible_from_purchase is not null then
    raise exception 'FAIL: free mode did not clear dependent fields';
  end if;

  if v_result.offers_installation is not true
     or v_result.average_installation_time_days <> 3
     or v_result.installation_days_rule <> 'Instalacao preservada'
     or v_result.installation_process_notes <> 'Notas preservadas'
     or v_result.offers_technical_visit is not true
     or v_result.technical_visit_days_rule <> 'Dias preservados'
     or v_result.technical_visit_rules <> array['precisa_agendar', 'pode_ter_taxa']::text[]
     or v_result.technical_visit_rules_other <> 'Outro preservado' then
    raise exception 'FAIL: focused writer did not preserve other operation fields';
  end if;

  v_result := public.upsert_store_operation_technical_visit_pricing_scoped(
    v_org_a,
    v_store_a,
    null,
    19900,
    'residual null rule',
    true
  );

  if v_result.technical_visit_pricing_mode is not null
     or v_result.technical_visit_fixed_fee_cents is not null
     or v_result.technical_visit_case_by_case_rule is not null
     or v_result.technical_visit_fee_deductible_from_purchase is not null then
    raise exception 'FAIL: null mode did not clear dependent fields';
  end if;

  v_result := public.upsert_store_operation_technical_visit_pricing_scoped(
    v_org_a,
    v_store_a,
    'fixed',
    25000,
    'residual case rule',
    false
  );

  if v_result.technical_visit_pricing_mode <> 'fixed'
     or v_result.technical_visit_fixed_fee_cents <> 25000
     or v_result.technical_visit_case_by_case_rule is not null
     or v_result.technical_visit_fee_deductible_from_purchase is not false then
    raise exception 'FAIL: fixed mode did not persist normalized payload';
  end if;

  begin
    perform public.upsert_store_operation_technical_visit_pricing_scoped(
      v_org_a,
      v_store_a,
      'fixed',
      0,
      null,
      true
    );

    raise exception 'FAIL: invalid fixed fee was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    perform public.upsert_store_operation_technical_visit_pricing_scoped(
      v_org_a,
      v_store_a,
      'fixed',
      25000,
      null,
      null
    );

    raise exception 'FAIL: fixed pricing without deductible was accepted';
  exception
    when check_violation then
      null;
  end;

  v_result := public.upsert_store_operation_technical_visit_pricing_scoped(
    v_org_a,
    v_store_a,
    'case_by_case',
    25000,
    'Calculada conforme distancia e acesso.',
    true
  );

  if v_result.technical_visit_pricing_mode <> 'case_by_case'
     or v_result.technical_visit_fixed_fee_cents is not null
     or v_result.technical_visit_case_by_case_rule <> 'Calculada conforme distancia e acesso.'
     or v_result.technical_visit_fee_deductible_from_purchase is not true then
    raise exception 'FAIL: case_by_case mode did not persist normalized payload';
  end if;

  begin
    perform public.upsert_store_operation_technical_visit_pricing_scoped(
      v_org_a,
      v_store_a,
      'case_by_case',
      null,
      '',
      true
    );

    raise exception 'FAIL: case_by_case without rule was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    perform public.upsert_store_operation_technical_visit_pricing_scoped(
      v_org_a,
      v_store_a,
      'case_by_case',
      null,
      'Calculada conforme distancia e acesso.',
      null
    );

    raise exception 'FAIL: case_by_case pricing without deductible was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    perform public.upsert_store_operation_technical_visit_pricing_scoped(
      v_org_a,
      v_store_b,
      'free',
      null,
      null,
      null
    );

    raise exception 'FAIL: mismatched organization/store scope was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  if exists (
    select 1
    from public.store_operation_settings settings_row
    where settings_row.organization_id = v_org_b
      and settings_row.store_id = v_store_b
  ) then
    raise exception 'FAIL: wrong-tenant row was written';
  end if;

  raise notice 'PASS: p19a technical visit pricing policy manual checks';
end $$;

rollback;
