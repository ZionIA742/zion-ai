begin;

create temp table p19a_store_payment_settings_test_results (
  test_name text primary key,
  result text not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_target public.stores%rowtype;
  v_other_store public.stores%rowtype;
  v_row public.store_payment_settings%rowtype;
  v_backfill_row public.store_payment_settings%rowtype;
  v_summary text;
  v_count_before bigint;
  v_count_after bigint;
  v_blocked boolean;
  v_answer jsonb;
  v_legacy_answer jsonb;
  v_nullable_question_key text;
  v_backfill_organization_id uuid;
  v_backfill_store_id uuid;
  v_created_at_before timestamptz;
  v_created_at_after timestamptz;
begin
  select *
  into v_target
  from public.stores
  order by created_at nulls last, id
  limit 1;

  if not found then
    raise exception 'FAIL: no store available to exercise store_payment_settings runner';
  end if;

  select *
  into v_other_store
  from public.stores
  where organization_id <> v_target.organization_id
  order by created_at nulls last, id
  limit 1;

  ---------------------------------------------------------------------------
  -- 1. Schema, defaults, trigger and structural constraints
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_payment_settings'
      and column_name = 'accepted_payment_methods'
      and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: accepted_payment_methods column missing or nullable';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_payment_settings'
      and column_name = 'down_payment_mode'
      and column_default = '''none''::text'
  ) then
    raise exception 'FAIL: down_payment_mode default missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.store_payment_settings'::regclass
      and trigger_row.tgname = 'store_payment_settings_touch_updated_at'
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception 'FAIL: updated_at trigger missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_payment_settings'::regclass
      and constraint_row.conname = 'store_payment_settings_down_payment_value_type_required'
  ) then
    raise exception 'FAIL: down-payment value-type required constraint is missing';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '01_schema_defaults_trigger_constraints',
    'PASS',
    'table, defaults, updated_at trigger and down-payment structural constraint exist'
  );

  ---------------------------------------------------------------------------
  -- 2. RLS, policies and table grants
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from pg_class class_row
    where class_row.oid = 'public.store_payment_settings'::regclass
      and class_row.relrowsecurity is true
  ) then
    raise exception 'FAIL: row level security is disabled on store_payment_settings';
  end if;

  if not has_table_privilege('authenticated', 'public.store_payment_settings', 'SELECT') then
    raise exception 'FAIL: authenticated cannot read store_payment_settings';
  end if;

  if has_table_privilege('authenticated', 'public.store_payment_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.store_payment_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.store_payment_settings', 'DELETE')
  then
    raise exception 'FAIL: authenticated can bypass canonical writer with direct table writes';
  end if;

  if has_table_privilege('service_role', 'public.store_payment_settings', 'SELECT')
     or has_table_privilege('service_role', 'public.store_payment_settings', 'INSERT')
     or has_table_privilege('service_role', 'public.store_payment_settings', 'UPDATE')
     or has_table_privilege('service_role', 'public.store_payment_settings', 'DELETE')
  then
    raise exception 'FAIL: service_role should not receive direct table grants';
  end if;

  if not exists (
    select 1
    from pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'store_payment_settings'
      and policy_row.policyname = 'store_payment_settings_select_by_active_membership'
      and policy_row.cmd = 'SELECT'
  ) then
    raise exception 'FAIL: tenant-scoped SELECT policy is missing';
  end if;

  if exists (
    select 1
    from pg_policies policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'store_payment_settings'
      and policy_row.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'FAIL: direct write policy exists on store_payment_settings';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '02_rls_policies_and_grants',
    'PASS',
    'authenticated has tenant-scoped SELECT only; direct writes and service-role table grants are absent'
  );

  ---------------------------------------------------------------------------
  -- 3. Writer grants
  ---------------------------------------------------------------------------

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_payment_settings_scoped(uuid,uuid,text[],text,text,text,text,text,numeric,integer,boolean,integer,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute canonical payment writer';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_store_payment_settings_with_legacy_mirror_scoped(uuid,uuid,text[],text,text,text,text,text,numeric,integer,boolean,integer,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated cannot execute transactional payment writer';
  end if;

  if has_function_privilege(
    'service_role',
    'public.upsert_store_payment_settings_scoped(uuid,uuid,text[],text,text,text,text,text,numeric,integer,boolean,integer,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role should not execute canonical payment writer';
  end if;

  if has_function_privilege(
    'service_role',
    'public.upsert_store_payment_settings_with_legacy_mirror_scoped(uuid,uuid,text[],text,text,text,text,text,numeric,integer,boolean,integer,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role should not execute transactional payment writer';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '03_writer_grants',
    'PASS',
    'writers are executable by authenticated human flow and not by service_role'
  );

  ---------------------------------------------------------------------------
  -- 4. Deterministic legacy backfill
  ---------------------------------------------------------------------------

  select
    answer_row.organization_id,
    answer_row.store_id,
    answer_row.answer
  into
    v_backfill_organization_id,
    v_backfill_store_id,
    v_legacy_answer
  from public.store_onboarding_answers answer_row
  where answer_row.question_key = 'accepted_payment_methods'
    and pg_catalog.jsonb_typeof(answer_row.answer) = 'array'
    and pg_catalog.jsonb_array_length(answer_row.answer) > 0
  order by answer_row.created_at nulls last, answer_row.store_id
  limit 1;

  if found then
    select *
    into v_backfill_row
    from public.store_payment_settings payment_row
    where payment_row.organization_id = v_backfill_organization_id
      and payment_row.store_id = v_backfill_store_id;

    if not found then
      raise exception 'FAIL: legacy accepted_payment_methods were not backfilled into canonical settings';
    end if;

    if coalesce(pg_catalog.array_length(v_backfill_row.accepted_payment_methods, 1), 0) = 0 then
      raise exception 'FAIL: canonical backfill row contains no accepted payment methods';
    end if;

    if v_legacy_answer ? 'financiamento'
       and not ('financiamento' = any(v_backfill_row.accepted_payment_methods))
    then
      raise exception 'FAIL: legacy financiamento value was lost during backfill';
    end if;

    if v_legacy_answer ? 'parcelado'
       and not ('parcelado' = any(v_backfill_row.accepted_payment_methods))
    then
      raise exception 'FAIL: legacy parcelado value was lost during backfill';
    end if;

    if v_legacy_answer ? 'sinal_mais_parcelas'
       and not ('sinal_mais_parcelas' = any(v_backfill_row.accepted_payment_methods))
    then
      raise exception 'FAIL: legacy sinal_mais_parcelas value was lost during backfill';
    end if;

    if v_legacy_answer ? 'p'
       and v_legacy_answer ? 'i'
       and v_legacy_answer ? 'x'
       and not ('pix' = any(v_backfill_row.accepted_payment_methods))
    then
      raise exception 'FAIL: split-Pix legacy artifact was not reconstructed as pix';
    end if;

    insert into p19a_store_payment_settings_test_results
    values (
      '04_legacy_backfill',
      'PASS',
      format(
        'legacy payment methods backfilled for store %s as %s',
        v_backfill_store_id,
        array_to_string(v_backfill_row.accepted_payment_methods, ',')
      )
    );
  else
    insert into p19a_store_payment_settings_test_results
    values (
      '04_legacy_backfill',
      'SKIP',
      'no legacy accepted_payment_methods array exists to exercise backfill'
    );
  end if;

  ---------------------------------------------------------------------------
  -- 5. Canonical writer normalization + idempotency
  ---------------------------------------------------------------------------

  select count(*)
  into v_count_before
  from public.store_payment_settings
  where organization_id = v_target.organization_id
    and store_id = v_target.id;

  select *
  into v_row
  from public.upsert_store_payment_settings_scoped(
    v_target.organization_id,
    v_target.id,
    array[
      'pix',
      'cartao_credito',
      'pix',
      'p',
      'i',
      'x',
      'financiamento',
      'parcelado',
      'sinal_mais_parcelas'
    ],
    'email',
    'financeiro@example.com',
    'Loja Teste',
    'required',
    'percent',
    30,
    null,
    true,
    10,
    'interest_free',
    'Aceita validacao manual do comprovante'
  );

  if v_row.organization_id <> v_target.organization_id
     or v_row.store_id <> v_target.id
     or v_row.accepted_payment_methods <> array[
       'pix',
       'cartao_credito',
       'financiamento',
       'parcelado',
       'sinal_mais_parcelas'
     ]
     or v_row.down_payment_mode <> 'required'
     or v_row.down_payment_value_type <> 'percent'
     or v_row.down_payment_percent <> 30
     or v_row.installments_enabled is not true
     or v_row.max_installments <> 10
  then
    raise exception 'FAIL: canonical writer did not persist the expected normalized row';
  end if;

  v_created_at_before := v_row.created_at;

  select *
  into v_row
  from public.upsert_store_payment_settings_scoped(
    v_target.organization_id,
    v_target.id,
    array[
      'pix',
      'cartao_credito',
      'financiamento',
      'parcelado',
      'sinal_mais_parcelas'
    ],
    'email',
    'financeiro@example.com',
    'Loja Teste',
    'required',
    'percent',
    30,
    null,
    true,
    10,
    'interest_free',
    'Aceita validacao manual do comprovante'
  );

  v_created_at_after := v_row.created_at;

  select count(*)
  into v_count_after
  from public.store_payment_settings
  where organization_id = v_target.organization_id
    and store_id = v_target.id;

  if v_count_before > 1
     or v_count_after <> 1
     or v_created_at_after is distinct from v_created_at_before
  then
    raise exception
      'FAIL: canonical writer is not idempotent: count before %, count after %, created_at % -> %',
      v_count_before,
      v_count_after,
      v_created_at_before,
      v_created_at_after;
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '05_writer_normalization_idempotency',
    'PASS',
    format(
      'one canonical row preserved for store %s; legacy-compatible methods normalized to %s',
      v_target.id,
      array_to_string(v_row.accepted_payment_methods, ',')
    )
  );

  ---------------------------------------------------------------------------
  -- 6. Child cleanup when Pix/down payment/installments are disabled
  ---------------------------------------------------------------------------

  select *
  into v_row
  from public.upsert_store_payment_settings_scoped(
    v_target.organization_id,
    v_target.id,
    array['boleto', 'transferencia'],
    'email',
    'should-clear@example.com',
    'Nao deveria permanecer',
    'none',
    'fixed',
    null,
    250000,
    false,
    12,
    'with_interest',
    'Somente boleto e transferencia'
  );

  if v_row.pix_key_type is not null
     or v_row.pix_key is not null
     or v_row.pix_holder_name is not null
     or v_row.down_payment_value_type is not null
     or v_row.down_payment_percent is not null
     or v_row.down_payment_amount_cents is not null
     or v_row.max_installments is not null
     or v_row.installment_interest_policy is not null
  then
    raise exception 'FAIL: child fields were not cleared when parent settings were disabled';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '06_child_cleanup',
    'PASS',
    'pix/down-payment/installment child fields are cleared when parents are disabled'
  );

  ---------------------------------------------------------------------------
  -- 7. Writer rejects invalid combinations
  ---------------------------------------------------------------------------

  v_blocked := false;
  begin
    perform public.upsert_store_payment_settings_scoped(
      v_target.organization_id,
      v_target.id,
      array['pix'],
      null,
      'missing-type',
      null,
      'required',
      'percent',
      0,
      null,
      true,
      0,
      'interest_free',
      null
    );
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL: invalid pix/down-payment/installment combination was accepted';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '07_invalid_writer_payload_blocked',
    'PASS',
    'writer blocks invalid pix/down-payment/installment payloads'
  );

  ---------------------------------------------------------------------------
  -- 8. Table-level down-payment integrity
  ---------------------------------------------------------------------------

  v_blocked := false;
  begin
    update public.store_payment_settings payment_row
    set
      down_payment_mode = 'required',
      down_payment_value_type = null,
      down_payment_percent = null,
      down_payment_amount_cents = null
    where payment_row.organization_id = v_target.organization_id
      and payment_row.store_id = v_target.id;
  exception
    when check_violation then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL: table accepted required down payment without value type';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '08_down_payment_constraint',
    'PASS',
    'table rejects optional/required down payment without a value type'
  );

  ---------------------------------------------------------------------------
  -- 9. Composite tenant FK
  ---------------------------------------------------------------------------

  if v_other_store.id is not null then
    v_blocked := false;
    begin
      insert into public.store_payment_settings (
        organization_id,
        store_id,
        accepted_payment_methods,
        down_payment_mode,
        installments_enabled
      )
      values (
        v_target.organization_id,
        v_other_store.id,
        array['pix'],
        'none',
        false
      );
    exception
      when foreign_key_violation then
        v_blocked := true;
    end;

    if not v_blocked then
      raise exception 'FAIL: composite store/organization FK did not block cross-tenant insert';
    end if;

    insert into p19a_store_payment_settings_test_results
    values (
      '09_composite_fk_blocked',
      'PASS',
      'cross-tenant organization/store mismatch was rejected by the composite FK'
    );
  else
    insert into p19a_store_payment_settings_test_results
    values (
      '09_composite_fk_blocked',
      'SKIP',
      'no second organization/store available to prove cross-tenant FK'
    );
  end if;

  ---------------------------------------------------------------------------
  -- 10. Transactional mirror writer and legacy answers
  ---------------------------------------------------------------------------

  select *
  into v_row
  from public.upsert_store_payment_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    array['pix', 'cartao_credito', 'boleto', 'financiamento'],
    'phone',
    '5511999998888',
    'Financeiro Loja',
    'optional',
    'fixed',
    null,
    840000,
    true,
    8,
    'case_by_case',
    'Entrada combinada conforme o projeto'
  );

  v_summary := public.store_payment_settings_build_legacy_summary(
    v_row.accepted_payment_methods,
    v_row.down_payment_mode,
    v_row.down_payment_value_type,
    v_row.down_payment_percent,
    v_row.down_payment_amount_cents,
    v_row.installments_enabled,
    v_row.max_installments,
    v_row.installment_interest_policy,
    v_row.payment_notes
  );

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'accepted_payment_methods_summary';

  if v_answer is null or trim(both '"' from v_answer::text) <> v_summary then
    raise exception 'FAIL: accepted_payment_methods_summary mirror mismatch: expected %, got %',
      v_summary,
      coalesce(v_answer::text, '<null>');
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'accepted_payment_methods';

  if v_answer is null or v_answer <> to_jsonb(v_row.accepted_payment_methods) then
    raise exception 'FAIL: accepted_payment_methods mirror mismatch';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'pix_key';

  if v_answer is null or trim(both '"' from v_answer::text) <> '5511999998888' then
    raise exception 'FAIL: pix_key mirror mismatch';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_percent';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: fixed down_payment_percent mirror must be empty string';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_amount_cents';

  if v_answer is null or v_answer <> to_jsonb(840000) then
    raise exception 'FAIL: fixed down_payment_amount_cents mirror must be JSON number 840000';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '10_transactional_mirror_fixed',
    'PASS',
    'fixed down-payment mirrors stay non-null safe and preserve 840000 cents'
  );

  ---------------------------------------------------------------------------
  -- 11. Percent mirrors
  ---------------------------------------------------------------------------

  perform public.upsert_store_payment_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    array['pix', 'cartao_credito'],
    'email',
    'financeiro@example.com',
    'Loja Teste',
    'required',
    'percent',
    30,
    null,
    true,
    10,
    'interest_free',
    'Aceita validacao manual do comprovante'
  );

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_percent';

  if v_answer is null or v_answer <> to_jsonb(30) then
    raise exception 'FAIL: percent down_payment_percent mirror must be JSON number 30';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_amount_cents';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: percent down_payment_amount_cents mirror must be empty string';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '11_transactional_mirror_percent',
    'PASS',
    'percent down-payment mirrors stay non-null safe and preserve numeric percent only'
  );

  ---------------------------------------------------------------------------
  -- 12. case_by_case mirrors
  ---------------------------------------------------------------------------

  perform public.upsert_store_payment_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    array['boleto', 'transferencia'],
    null,
    null,
    null,
    'optional',
    'case_by_case',
    null,
    null,
    true,
    6,
    'case_by_case',
    null
  );

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_percent';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: case_by_case down_payment_percent mirror must be empty string';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_amount_cents';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: case_by_case down_payment_amount_cents mirror must be empty string';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '12_transactional_mirror_case_by_case',
    'PASS',
    'case_by_case mirrors stay empty-string safe for percent and amount'
  );

  ---------------------------------------------------------------------------
  -- 13. Disabled mirrors stay heuristic-safe for legacy Sales AI readers
  ---------------------------------------------------------------------------

  perform public.upsert_store_payment_settings_with_legacy_mirror_scoped(
    v_target.organization_id,
    v_target.id,
    array['boleto'],
    'email',
    'should-clear@example.com',
    'Should clear',
    'none',
    'fixed',
    null,
    500000,
    false,
    12,
    'with_interest',
    null
  );

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'pix_key';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled Pix mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'pix_key_type';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled pix_key_type mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'pix_holder_name';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled pix_holder_name mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_mode';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled down-payment mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_value_type';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled down_payment_value_type mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_percent';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled down_payment_percent mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'down_payment_amount_cents';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled down_payment_amount_cents mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'installments_enabled';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled installments mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'max_installments';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled max_installments mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'installment_interest_policy';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: disabled installment_interest_policy mirror is not empty-string safe';
  end if;

  select answer
  into v_answer
  from public.store_onboarding_answers
  where organization_id = v_target.organization_id
    and store_id = v_target.id
    and question_key = 'payment_notes';

  if v_answer is null or trim(both '"' from v_answer::text) <> '' then
    raise exception 'FAIL: null payment_notes mirror must be empty-string safe';
  end if;

  insert into p19a_store_payment_settings_test_results
  values (
    '13_legacy_heuristic_safe_mirrors',
    'PASS',
    'disabled Pix/down-payment/installment mirrors and null payment_notes remain empty for legacy key-name heuristics'
  );

  ---------------------------------------------------------------------------
  -- 14. No mirrored answer can remain SQL NULL
  ---------------------------------------------------------------------------

  foreach v_nullable_question_key in array array[
    'pix_key_type',
    'pix_key',
    'pix_holder_name',
    'down_payment_value_type',
    'down_payment_percent',
    'down_payment_amount_cents',
    'max_installments',
    'installment_interest_policy',
    'payment_notes'
  ]
  loop
    select answer
    into v_answer
    from public.store_onboarding_answers
    where organization_id = v_target.organization_id
      and store_id = v_target.id
      and question_key = v_nullable_question_key;

    if v_answer is null then
      raise exception 'FAIL: mirrored answer % is SQL NULL', v_nullable_question_key;
    end if;
  end loop;

  insert into p19a_store_payment_settings_test_results
  values (
    '14_nullable_mirrors_not_null',
    'PASS',
    'all nullable legacy mirrors were persisted as non-null jsonb answers'
  );
end;
$runner$;

table p19a_store_payment_settings_test_results order by test_name;

rollback;
