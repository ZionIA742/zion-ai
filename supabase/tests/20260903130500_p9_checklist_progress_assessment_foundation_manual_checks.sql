begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:checklist-progress-assessment-foundation:manual-checks:v1', 0)
);

-- ============================================================================
-- ZION — Pilar 9 — Bloco 3 — Etapa 3.5
-- Manual checks — Checklist Progress / Assessment Foundation
--
-- Rollback-only runner. It creates temporary Profile/Checklist/Progress rows
-- inside this transaction, verifies frozen semantic invariants and then rolls
-- everything back.
-- ============================================================================

do $preflight$
declare
  v_function oid;
begin
  if pg_catalog.to_regclass(
       'public.commercial_opportunity_checklist_progress_versions'
     ) is null
     or pg_catalog.to_regclass(
       'public.commercial_opportunity_checklist_progress_items'
     ) is null
     or pg_catalog.to_regclass(
       'public.commercial_opportunity_checklist_progress_current'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress / Assessment foundation is not installed';
  end if;

  for v_function in
    select pg_catalog.to_regprocedure(signature)
    from (
      values
        ('public.p9_commercial_opportunity_checklist_progress_validate_item()'::text),
        ('public.p9_commercial_opportunity_checklist_progress_validate_current()'),
        ('public.p9_commercial_opportunity_checklist_progress_touch_current_updated_at()')
    ) as expected(signature)
  loop
    if v_function is null then
      raise exception using
        errcode = 'P0001',
        message = 'SUT_FAIL: one or more Progress internal functions are missing';
    end if;

    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception using
        errcode = 'P0001',
        message = 'SUT_FAIL: internal Progress function leaked EXECUTE';
    end if;
  end loop;

  if pg_catalog.has_table_privilege(
       'anon',
       'public.commercial_opportunity_checklist_progress_versions',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_checklist_progress_versions',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_checklist_progress_versions',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_checklist_progress_items',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_checklist_progress_items',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_checklist_progress_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_checklist_progress_current',
       'INSERT'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: direct Progress mutation privilege leaked';
  end if;
end;
$preflight$;

do $behavior$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_opp_id uuid;
  v_policy_version_id uuid;
  v_lifecycle_cycle integer;

  v_profile_version_id uuid := gen_random_uuid();
  v_checklist_version_id uuid := gen_random_uuid();

  v_required_item_id uuid := gen_random_uuid();
  v_optional_item_id uuid := gen_random_uuid();
  v_not_applicable_item_id uuid := gen_random_uuid();
  v_unresolved_item_id uuid := gen_random_uuid();
  v_conflict_item_id uuid := gen_random_uuid();

  v_progress_v1_id uuid := gen_random_uuid();
  v_progress_v2_id uuid := gen_random_uuid();
  v_progress_v3_id uuid := gen_random_uuid();

  v_profile_version_number integer;
  v_checklist_version_number integer;
  v_progress_version_number integer;

  v_error_seen boolean;
  v_before_updated_at timestamptz;
  v_after_updated_at timestamptz;
begin
  -- Real tenant scope, but all inserted fixture rows are rolled back.
  select
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.id,
    opportunity_row.lifecycle_cycle,
    policy_current.current_policy_version_id
  into
    v_org_id,
    v_store_id,
    v_opp_id,
    v_lifecycle_cycle,
    v_policy_version_id
  from public.commercial_opportunities opportunity_row
  join public.store_opportunity_gate_policy_current policy_current
    on policy_current.organization_id = opportunity_row.organization_id
   and policy_current.store_id = opportunity_row.store_id
  order by
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.id
  limit 1;

  if v_opp_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no opportunity under a store with current Gate Policy';
  end if;

  select coalesce(max(profile_row.version_number), 0) + 1000000
  into v_profile_version_number
  from public.commercial_opportunity_profile_versions profile_row
  where profile_row.organization_id = v_org_id
    and profile_row.store_id = v_store_id
    and profile_row.commercial_opportunity_id = v_opp_id;

  select coalesce(max(checklist_row.version_number), 0) + 1000000
  into v_checklist_version_number
  from public.commercial_opportunity_checklist_versions checklist_row
  where checklist_row.organization_id = v_org_id
    and checklist_row.store_id = v_store_id
    and checklist_row.commercial_opportunity_id = v_opp_id;

  select coalesce(max(progress_row.version_number), 0) + 1000000
  into v_progress_version_number
  from public.commercial_opportunity_checklist_progress_versions progress_row
  where progress_row.organization_id = v_org_id
    and progress_row.store_id = v_store_id
    and progress_row.commercial_opportunity_id = v_opp_id;

  insert into public.commercial_opportunity_profile_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_profile_version_id,
    profile_state,
    operation_key,
    request_fingerprint,
    actor_type,
    actor_user_id,
    source_type,
    reason_code,
    created_by,
    metadata
  )
  values (
    v_profile_version_id,
    v_org_id,
    v_store_id,
    v_opp_id,
    v_profile_version_number,
    null,
    'resolved',
    'p9_progress_foundation_runner:profile',
    repeat('1', 64),
    'system',
    null,
    'p9_progress_foundation_runner',
    'fixture_profile',
    'p9_progress_foundation_runner',
    '{"runner":true}'::jsonb
  );

  insert into public.commercial_opportunity_checklist_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_checklist_version_id,
    profile_version_id,
    gate_policy_version_id,
    checklist_state,
    settings_snapshot,
    settings_fingerprint,
    operation_key,
    request_fingerprint,
    actor_type,
    actor_user_id,
    source_type,
    reason_code,
    created_by,
    metadata
  )
  values (
    v_checklist_version_id,
    v_org_id,
    v_store_id,
    v_opp_id,
    v_checklist_version_number,
    null,
    v_profile_version_id,
    v_policy_version_id,
    'conflict',
    '{}'::jsonb,
    repeat('2', 64),
    'p9_progress_foundation_runner:checklist',
    repeat('3', 64),
    'system',
    null,
    'p9_progress_foundation_runner',
    'fixture_checklist',
    'p9_progress_foundation_runner',
    '{"runner":true}'::jsonb
  );

  insert into public.commercial_opportunity_checklist_items (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    checklist_version_id,
    item_key,
    item_kind,
    applicability_state,
    reason_code,
    decision_basis,
    metadata
  )
  values
    (
      v_required_item_id,
      v_org_id,
      v_store_id,
      v_opp_id,
      v_checklist_version_id,
      'runner_required',
      'commercial_gate',
      'required',
      'runner_required',
      '{"runner":true}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_optional_item_id,
      v_org_id,
      v_store_id,
      v_opp_id,
      v_checklist_version_id,
      'runner_optional',
      'technical_requirement',
      'optional',
      'runner_optional',
      '{"runner":true}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_not_applicable_item_id,
      v_org_id,
      v_store_id,
      v_opp_id,
      v_checklist_version_id,
      'runner_not_applicable',
      'commercial_gate',
      'not_applicable',
      'runner_not_applicable',
      '{"runner":true}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_unresolved_item_id,
      v_org_id,
      v_store_id,
      v_opp_id,
      v_checklist_version_id,
      'runner_unresolved',
      'technical_requirement',
      'needs_resolution',
      'runner_unresolved',
      '{"runner":true}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_conflict_item_id,
      v_org_id,
      v_store_id,
      v_opp_id,
      v_checklist_version_id,
      'runner_conflict',
      'commercial_gate',
      'conflict',
      'runner_conflict',
      '{"runner":true}'::jsonb,
      '{}'::jsonb
    );

  insert into public.commercial_opportunity_checklist_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_checklist_version_id,
    last_operation_key
  )
  values (
    v_org_id,
    v_store_id,
    v_opp_id,
    v_checklist_version_id,
    'p9_progress_foundation_runner:checklist'
  )
  on conflict (organization_id, store_id, commercial_opportunity_id)
  do update
     set current_checklist_version_id = excluded.current_checklist_version_id,
         last_operation_key = excluded.last_operation_key;

  -- V1: determined projection with real Progress states.
  insert into public.commercial_opportunity_checklist_progress_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_progress_version_id,
    checklist_version_id,
    lifecycle_cycle,
    projection_state,
    operation_key,
    request_fingerprint,
    source_type,
    reason_code,
    created_by,
    metadata
  )
  values (
    v_progress_v1_id,
    v_org_id,
    v_store_id,
    v_opp_id,
    v_progress_version_number,
    null,
    v_checklist_version_id,
    v_lifecycle_cycle,
    'determined',
    'p9_progress_foundation_runner:v1',
    repeat('4', 64),
    'p9_progress_foundation_runner',
    'fixture_progress_v1',
    'p9_progress_foundation_runner',
    '{"runner":true}'::jsonb
  );

  insert into public.commercial_opportunity_checklist_progress_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    progress_version_id,
    checklist_version_id,
    checklist_item_id,
    assessment_state,
    progress_state,
    resolver_key,
    resolver_version,
    authority_fingerprint,
    resolution_basis,
    reason_code,
    metadata
  )
  values
    (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v1_id,
      v_checklist_version_id,
      v_required_item_id,
      'determined',
      'not_started',
      'runner_required_resolver',
      1,
      repeat('5', 64),
      '{"authority":"runner","state":"not_started"}'::jsonb,
      'runner_not_started',
      '{}'::jsonb
    ),
    (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v1_id,
      v_checklist_version_id,
      v_optional_item_id,
      'determined',
      'completed',
      'runner_optional_resolver',
      1,
      repeat('6', 64),
      '{"authority":"runner","state":"completed"}'::jsonb,
      'runner_completed',
      '{}'::jsonb
    );

  if (
    select count(*)
    from public.commercial_opportunity_checklist_progress_items progress_item
    where progress_item.progress_version_id = v_progress_v1_id
  ) <> 2 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: determined Progress rows were not persisted';
  end if;

  -- Applicability remains a separate dimension: non-applicable/unresolved/
  -- conflict checklist items cannot receive Progress rows.
  v_error_seen := false;
  begin
    insert into public.commercial_opportunity_checklist_progress_items (
      organization_id,
      store_id,
      commercial_opportunity_id,
      progress_version_id,
      checklist_version_id,
      checklist_item_id,
      assessment_state,
      progress_state,
      resolver_key,
      resolver_version,
      authority_fingerprint,
      resolution_basis,
      reason_code
    )
    values (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v1_id,
      v_checklist_version_id,
      v_not_applicable_item_id,
      'determined',
      'completed',
      'runner_invalid_resolver',
      1,
      repeat('7', 64),
      '{"authority":"runner"}'::jsonb,
      'runner_should_fail'
    );
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: not_applicable item incorrectly accepted Progress';
  end if;

  v_error_seen := false;
  begin
    insert into public.commercial_opportunity_checklist_progress_items (
      organization_id,
      store_id,
      commercial_opportunity_id,
      progress_version_id,
      checklist_version_id,
      checklist_item_id,
      assessment_state,
      progress_state,
      resolver_key,
      resolver_version,
      authority_fingerprint,
      resolution_basis,
      reason_code
    )
    values (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v1_id,
      v_checklist_version_id,
      v_unresolved_item_id,
      'needs_resolution',
      null,
      'runner_invalid_resolver',
      1,
      repeat('8', 64),
      '{"authority":"runner"}'::jsonb,
      'runner_should_fail'
    );
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: applicability needs_resolution incorrectly accepted Progress row';
  end if;

  v_error_seen := false;
  begin
    insert into public.commercial_opportunity_checklist_progress_items (
      organization_id,
      store_id,
      commercial_opportunity_id,
      progress_version_id,
      checklist_version_id,
      checklist_item_id,
      assessment_state,
      progress_state,
      resolver_key,
      resolver_version,
      authority_fingerprint,
      resolution_basis,
      reason_code
    )
    values (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v1_id,
      v_checklist_version_id,
      v_conflict_item_id,
      'conflict',
      null,
      'runner_invalid_resolver',
      1,
      repeat('9', 64),
      '{"authority":"runner"}'::jsonb,
      'runner_should_fail'
    );
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: applicability conflict incorrectly accepted Progress row';
  end if;

  -- Assessment uncertainty must never fabricate a Progress value.
  v_progress_version_number := v_progress_version_number + 1;

  insert into public.commercial_opportunity_checklist_progress_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_progress_version_id,
    checklist_version_id,
    lifecycle_cycle,
    projection_state,
    operation_key,
    request_fingerprint,
    source_type,
    reason_code,
    created_by,
    metadata
  )
  values (
    v_progress_v2_id,
    v_org_id,
    v_store_id,
    v_opp_id,
    v_progress_version_number,
    v_progress_v1_id,
    v_checklist_version_id,
    v_lifecycle_cycle,
    'needs_resolution',
    'p9_progress_foundation_runner:v2',
    repeat('a', 64),
    'p9_progress_foundation_runner',
    'fixture_progress_v2',
    'p9_progress_foundation_runner',
    '{"runner":true}'::jsonb
  );

  insert into public.commercial_opportunity_checklist_progress_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    progress_version_id,
    checklist_version_id,
    checklist_item_id,
    assessment_state,
    progress_state,
    resolver_key,
    resolver_version,
    authority_fingerprint,
    resolution_basis,
    reason_code
  )
  values (
    v_org_id,
    v_store_id,
    v_opp_id,
    v_progress_v2_id,
    v_checklist_version_id,
    v_required_item_id,
    'needs_resolution',
    null,
    'runner_required_resolver',
    2,
    repeat('b', 64),
    '{"authority":"runner","problem":"insufficient_authority"}'::jsonb,
    'runner_needs_resolution'
  );

  v_error_seen := false;
  begin
    insert into public.commercial_opportunity_checklist_progress_items (
      organization_id,
      store_id,
      commercial_opportunity_id,
      progress_version_id,
      checklist_version_id,
      checklist_item_id,
      assessment_state,
      progress_state,
      resolver_key,
      resolver_version,
      authority_fingerprint,
      resolution_basis,
      reason_code
    )
    values (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v2_id,
      v_checklist_version_id,
      v_optional_item_id,
      'needs_resolution',
      'in_progress',
      'runner_invalid_shape',
      1,
      repeat('c', 64),
      '{"authority":"runner"}'::jsonb,
      'runner_should_fail'
    );
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: needs_resolution incorrectly retained a Progress value';
  end if;

  v_error_seen := false;
  begin
    insert into public.commercial_opportunity_checklist_progress_items (
      organization_id,
      store_id,
      commercial_opportunity_id,
      progress_version_id,
      checklist_version_id,
      checklist_item_id,
      assessment_state,
      progress_state,
      resolver_key,
      resolver_version,
      authority_fingerprint,
      resolution_basis,
      reason_code
    )
    values (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v2_id,
      v_checklist_version_id,
      v_optional_item_id,
      'determined',
      null,
      'runner_invalid_shape',
      1,
      repeat('d', 64),
      '{"authority":"runner"}'::jsonb,
      'runner_should_fail'
    );
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: determined Assessment accepted NULL Progress';
  end if;

  -- Empty Evidence Basis is forbidden.
  v_error_seen := false;
  begin
    insert into public.commercial_opportunity_checklist_progress_items (
      organization_id,
      store_id,
      commercial_opportunity_id,
      progress_version_id,
      checklist_version_id,
      checklist_item_id,
      assessment_state,
      progress_state,
      resolver_key,
      resolver_version,
      authority_fingerprint,
      resolution_basis,
      reason_code
    )
    values (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v2_id,
      v_checklist_version_id,
      v_optional_item_id,
      'determined',
      'in_progress',
      'runner_invalid_basis',
      1,
      repeat('e', 64),
      '{}'::jsonb,
      'runner_should_fail'
    );
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: empty Evidence Basis was accepted';
  end if;

  -- A partial projection may exist historically, but cannot become current.
  v_error_seen := false;
  begin
    insert into public.commercial_opportunity_checklist_progress_current (
      organization_id,
      store_id,
      commercial_opportunity_id,
      current_progress_version_id,
      last_operation_key
    )
    values (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v2_id,
      'p9_progress_foundation_runner:v2'
    )
    on conflict (organization_id, store_id, commercial_opportunity_id)
    do update
       set current_progress_version_id = excluded.current_progress_version_id,
           last_operation_key = excluded.last_operation_key;
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: incomplete Progress projection became current';
  end if;

  -- V3 proves that Progress can legitimately regress under a new authority
  -- fingerprint: completed in V1 -> in_progress in V3.
  v_progress_version_number := v_progress_version_number + 1;

  insert into public.commercial_opportunity_checklist_progress_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    previous_progress_version_id,
    checklist_version_id,
    lifecycle_cycle,
    projection_state,
    operation_key,
    request_fingerprint,
    source_type,
    reason_code,
    created_by,
    metadata
  )
  values (
    v_progress_v3_id,
    v_org_id,
    v_store_id,
    v_opp_id,
    v_progress_version_number,
    v_progress_v2_id,
    v_checklist_version_id,
    v_lifecycle_cycle,
    'determined',
    'p9_progress_foundation_runner:v3',
    repeat('f', 64),
    'p9_progress_foundation_runner',
    'fixture_progress_v3',
    'p9_progress_foundation_runner',
    '{"runner":true}'::jsonb
  );

  insert into public.commercial_opportunity_checklist_progress_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    progress_version_id,
    checklist_version_id,
    checklist_item_id,
    assessment_state,
    progress_state,
    resolver_key,
    resolver_version,
    authority_fingerprint,
    resolution_basis,
    reason_code
  )
  values
    (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v3_id,
      v_checklist_version_id,
      v_required_item_id,
      'determined',
      'not_started',
      'runner_required_resolver',
      3,
      repeat('1', 64),
      '{"authority":"runner","state":"not_started","reevaluated":true}'::jsonb,
      'runner_not_started'
    ),
    (
      v_org_id,
      v_store_id,
      v_opp_id,
      v_progress_v3_id,
      v_checklist_version_id,
      v_optional_item_id,
      'determined',
      'in_progress',
      'runner_optional_resolver',
      2,
      repeat('0', 64),
      '{"authority":"runner","state":"in_progress","superseded_previous":true}'::jsonb,
      'runner_regression_allowed'
    );

  if not exists (
    select 1
    from public.commercial_opportunity_checklist_progress_items old_item
    join public.commercial_opportunity_checklist_progress_items new_item
      on new_item.checklist_item_id = old_item.checklist_item_id
    where old_item.progress_version_id = v_progress_v1_id
      and new_item.progress_version_id = v_progress_v3_id
      and old_item.progress_state = 'completed'
      and new_item.progress_state = 'in_progress'
      and old_item.authority_fingerprint <> new_item.authority_fingerprint
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: legitimate Progress regression was not representable';
  end if;

  -- Explicit current pointer, with operation_key bound to the target version.
  insert into public.commercial_opportunity_checklist_progress_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_progress_version_id,
    last_operation_key
  )
  values (
    v_org_id,
    v_store_id,
    v_opp_id,
    v_progress_v1_id,
    'p9_progress_foundation_runner:v1'
  )
  on conflict (organization_id, store_id, commercial_opportunity_id)
  do update
     set current_progress_version_id = excluded.current_progress_version_id,
         last_operation_key = excluded.last_operation_key;

  select current_row.updated_at
  into v_before_updated_at
  from public.commercial_opportunity_checklist_progress_current current_row
  where current_row.organization_id = v_org_id
    and current_row.store_id = v_store_id
    and current_row.commercial_opportunity_id = v_opp_id;

  perform pg_catalog.pg_sleep(0.01);

  update public.commercial_opportunity_checklist_progress_current current_row
     set current_progress_version_id = v_progress_v3_id,
         last_operation_key = 'p9_progress_foundation_runner:v3'
   where current_row.organization_id = v_org_id
     and current_row.store_id = v_store_id
     and current_row.commercial_opportunity_id = v_opp_id;

  select current_row.updated_at
  into v_after_updated_at
  from public.commercial_opportunity_checklist_progress_current current_row
  where current_row.organization_id = v_org_id
    and current_row.store_id = v_store_id
    and current_row.commercial_opportunity_id = v_opp_id;

  if v_after_updated_at <= v_before_updated_at then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress current updated_at was not touched';
  end if;

  if (
    select current_row.current_progress_version_id
    from public.commercial_opportunity_checklist_progress_current current_row
    where current_row.organization_id = v_org_id
      and current_row.store_id = v_store_id
      and current_row.commercial_opportunity_id = v_opp_id
  ) is distinct from v_progress_v3_id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: explicit Progress current pointer did not move';
  end if;

  v_error_seen := false;
  begin
    update public.commercial_opportunity_checklist_progress_current current_row
       set current_progress_version_id = v_progress_v2_id,
           last_operation_key = 'wrong-operation-key'
     where current_row.organization_id = v_org_id
       and current_row.store_id = v_store_id
       and current_row.commercial_opportunity_id = v_opp_id;
  exception
    when check_violation then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress current accepted mismatched operation_key';
  end if;

  -- Historical projection rows are immutable.
  v_error_seen := false;
  begin
    update public.commercial_opportunity_checklist_progress_versions version_row
       set reason_code = 'runner_mutation_should_fail'
     where version_row.id = v_progress_v1_id;
  exception
    when raise_exception then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress version was mutable';
  end if;

  v_error_seen := false;
  begin
    update public.commercial_opportunity_checklist_progress_items progress_item
       set reason_code = 'runner_mutation_should_fail'
     where progress_item.progress_version_id = v_progress_v1_id
       and progress_item.checklist_item_id = v_required_item_id;
  exception
    when raise_exception then
      v_error_seen := true;
  end;

  if not v_error_seen then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress item was mutable';
  end if;

end;
$behavior$;

rollback;
