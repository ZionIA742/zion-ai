begin;

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:checklist-progress-materializer:manual-checks:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Manual checks for Checklist Progress Materializer v1.
--
-- Rollback-only runner. It temporarily creates Profile/Policy/Checklist/Progress
-- projections on a generic development fixture and restores everything with the
-- final ROLLBACK. No hardcoded tenant/store/opportunity id is used.
-- ============================================================================

do $preflight$
declare
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)'
  );
  v_signature text;
  v_resolver oid;
begin
  if v_materializer is null then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist progress materializer migration is not installed';
  end if;

  if pg_catalog.has_function_privilege('anon', v_materializer, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_materializer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist progress materializer grants mismatch';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role', 'public.commercial_opportunity_checklist_progress_versions', 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.commercial_opportunity_checklist_progress_items', 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.commercial_opportunity_checklist_progress_current', 'INSERT'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: service_role gained direct progress INSERT';
  end if;

  foreach v_signature in array array[
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)'
  ] loop
    v_resolver := pg_catalog.to_regprocedure(v_signature);

    if v_resolver is null then
      raise exception using
        errcode = 'P0001',
        message = 'SUT_FAIL: required resolver missing: ' || v_signature;
    end if;

    if pg_catalog.has_function_privilege('anon', v_resolver, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_resolver, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_resolver, 'EXECUTE') then
      raise exception using
        errcode = 'P0001',
        message = 'SUT_FAIL: internal resolver leaked EXECUTE: ' || v_signature;
    end if;
  end loop;
end;
$preflight$;

do $behavior$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_customer_id uuid;
  v_opp_id uuid;

  v_policy_rules jsonb;
  v_policy_rules_v2 jsonb;
  v_policy_write record;
  v_profile_write record;
  v_checklist record;
  v_checklist_v2 record;
  v_progress record;
  v_replay record;
  v_unchanged record;
  v_progress_v2 record;
  v_stale record;

  v_current_before uuid;
  v_current_after uuid;
  v_count integer;
  v_expected_count integer;
  v_version_count_before integer;
  v_version_count_after integer;
  v_bad_count integer;
begin
  -- Generic rollback fixture: borrow only an existing organization/store/customer
  -- scope, then create a brand-new temporary opportunity. This avoids depending
  -- on any pre-existing Profile/Checklist/Progress history or on a real pilot
  -- tenant. The final ROLLBACK removes the opportunity and every derived row.
  select
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.customer_id
  into v_org_id, v_store_id, v_customer_id
  from public.commercial_opportunities opportunity_row
  order by opportunity_row.id::text
  limit 1;

  if v_org_id is null or v_store_id is null or v_customer_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: runner requires one existing opportunity scope';
  end if;

  v_opp_id := '9f350545-0000-4000-8000-000000000101'::uuid;

  if exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_opp_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: progress materializer runner UUID collision';
  end if;

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage,
    lifecycle_cycle
  )
  values (
    v_opp_id,
    v_org_id,
    v_store_id,
    v_customer_id,
    'qualificacao',
    1
  );

  -- Authenticated callers must not execute the system materializer.
  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

    perform 1
    from public.materialize_commercial_opportunity_checklist_progress_by_system(
      v_org_id,
      v_store_id,
      v_opp_id,
      'runner:unauthorized:authenticated'
    );

    execute 'reset role';
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: authenticated role executed progress system materializer';
  exception
    when sqlstate '42501' then
      execute 'reset role';
  end;

  -- Keep technical-visit applicability deterministic for this rollback fixture.
  update public.store_operation_settings
  set offers_technical_visit = true
  where organization_id = v_org_id
    and store_id = v_store_id;

  -- Tiny policy intentionally covers four canonical resolver domains plus one
  -- unsupported domain. This validates orchestration without relying on a real
  -- pilot tenant or on the current development policy contents.
  v_policy_rules := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key','qualification.always.required','rule_priority',10,
      'item_kind','commercial_gate','item_key','qualification','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','required',
      'reason_code','runner_qualification_required','metadata','{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key','quote.always.optional','rule_priority',10,
      'item_kind','commercial_gate','item_key','quote','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','optional',
      'reason_code','runner_quote_optional','metadata','{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key','post_sale.always.required','rule_priority',10,
      'item_kind','commercial_gate','item_key','post_sale','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','required',
      'reason_code','runner_post_sale_required','metadata','{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key','technical_visit.always.required','rule_priority',10,
      'item_kind','commercial_gate','item_key','technical_visit','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','required',
      'reason_code','runner_technical_visit_required','metadata','{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key','payment.always.required','rule_priority',10,
      'item_kind','commercial_gate','item_key','payment','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','required',
      'reason_code','runner_payment_required','metadata','{}'::jsonb
    )
  );

  select * into v_policy_write
  from public.write_store_opportunity_gate_policy_internal(
    v_org_id,
    v_store_id,
    'p9:3.5:progress-runner:policy:v1',
    repeat('a', 64),
    v_policy_rules,
    'system',
    null,
    'manual_check_runner',
    'progress_materializer_runner_policy',
    'p9_progress_runner',
    '{"runner":true,"phase":"v1"}'::jsonb
  );

  if not coalesce(v_policy_write.changed, false) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: runner policy v1 was not created';
  end if;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select * into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:progress-runner:profile:v1',
    repeat('b', 64),
    'resolved',
    '[{"component_key":"runner_custom","component_kind":"custom","component_state":"resolved","pool_id":null,"catalog_item_id":null,"reference_text":"rollback progress runner","metadata":{}}]'::jsonb,
    '[]'::jsonb,
    'manual_check_runner',
    'progress_materializer_runner_profile',
    'p9_progress_runner',
    '{"runner":true}'::jsonb
  );

  if not coalesce(v_profile_write.changed, false) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: runner profile was not created';
  end if;

  select * into v_checklist
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:progress:checklist:v1'
  );

  if v_checklist.current_checklist_version_id is null then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: runner checklist v1 missing';
  end if;

  select pg_catalog.count(*)::integer
  into v_expected_count
  from public.commercial_opportunity_checklist_items checklist_item
  where checklist_item.organization_id = v_org_id
    and checklist_item.store_id = v_store_id
    and checklist_item.commercial_opportunity_id = v_opp_id
    and checklist_item.checklist_version_id = v_checklist.current_checklist_version_id
    and checklist_item.applicability_state in ('required', 'optional');

  if v_expected_count <> 5 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: runner checklist expected exactly five required/optional items';
  end if;

  select * into v_progress
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:progress:event:v1'
  );

  if not coalesce(v_progress.changed, false)
     or coalesce(v_progress.replayed, false)
     or v_progress.item_count <> v_expected_count
     or v_progress.checklist_version_id is distinct from v_checklist.current_checklist_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: initial Progress projection shape mismatch';
  end if;

  select pg_catalog.count(*)::integer
  into v_count
  from public.commercial_opportunity_checklist_progress_items progress_item
  where progress_item.organization_id = v_org_id
    and progress_item.store_id = v_store_id
    and progress_item.commercial_opportunity_id = v_opp_id
    and progress_item.progress_version_id = v_progress.current_progress_version_id;

  if v_count <> v_expected_count then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress projection is incomplete';
  end if;

  -- Canonical resolvers must be dispatched by their exact item keys.
  if exists (
    select 1
    from (
      values
        ('qualification'::text),
        ('quote'),
        ('post_sale'),
        ('technical_visit')
    ) expected(item_key)
    where not exists (
      select 1
      from public.commercial_opportunity_checklist_progress_items progress_item
      join public.commercial_opportunity_checklist_items checklist_item
        on checklist_item.id = progress_item.checklist_item_id
       and checklist_item.checklist_version_id = progress_item.checklist_version_id
      where progress_item.progress_version_id = v_progress.current_progress_version_id
        and checklist_item.item_key = expected.item_key
        and progress_item.resolver_key = expected.item_key
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: one or more canonical resolver domains were not dispatched exactly';
  end if;

  -- Unsupported payment authority must fail closed; it must never invent a
  -- not_started/in_progress/completed state just to complete the projection.
  if not exists (
    select 1
    from public.commercial_opportunity_checklist_progress_items progress_item
    join public.commercial_opportunity_checklist_items checklist_item
      on checklist_item.id = progress_item.checklist_item_id
     and checklist_item.checklist_version_id = progress_item.checklist_version_id
    where progress_item.progress_version_id = v_progress.current_progress_version_id
      and checklist_item.item_key = 'payment'
      and progress_item.assessment_state = 'needs_resolution'
      and progress_item.progress_state is null
      and progress_item.resolver_key = 'payment:unavailable'
      and progress_item.reason_code = 'canonical_progress_authority_unavailable'
      and progress_item.resolution_basis ->> 'item_key' = 'payment'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: unsupported payment authority did not fail closed';
  end if;

  if v_progress.projection_state not in ('needs_resolution', 'conflict') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: aggregate projection ignored unresolved/conflicting Assessment';
  end if;

  select pg_catalog.count(*)::integer
  into v_bad_count
  from public.commercial_opportunity_checklist_progress_items progress_item
  where progress_item.progress_version_id = v_progress.current_progress_version_id
    and (
      (progress_item.assessment_state = 'determined' and progress_item.progress_state is null)
      or (progress_item.assessment_state <> 'determined' and progress_item.progress_state is not null)
      or pg_catalog.length(progress_item.authority_fingerprint) <> 64
      or pg_catalog.jsonb_typeof(progress_item.resolution_basis) is distinct from 'object'
      or progress_item.resolution_basis = '{}'::jsonb
    );

  if v_bad_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress item resolver/evidence contract invalid';
  end if;

  -- Exact event replay must return the immutable original version without write.
  select pg_catalog.count(*)::integer
  into v_version_count_before
  from public.commercial_opportunity_checklist_progress_versions version_row
  where version_row.organization_id = v_org_id
    and version_row.store_id = v_store_id
    and version_row.commercial_opportunity_id = v_opp_id;

  select * into v_replay
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:progress:event:v1'
  );

  select pg_catalog.count(*)::integer
  into v_version_count_after
  from public.commercial_opportunity_checklist_progress_versions version_row
  where version_row.organization_id = v_org_id
    and version_row.store_id = v_store_id
    and version_row.commercial_opportunity_id = v_opp_id;

  if not coalesce(v_replay.replayed, false)
     or coalesce(v_replay.changed, false)
     or v_replay.outcome <> 'idempotent_replay_current'
     or v_replay.current_progress_version_id is distinct from v_progress.current_progress_version_id
     or v_version_count_after <> v_version_count_before then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: current event replay was not idempotent';
  end if;

  -- New event with unchanged authorities returns current and creates no version.
  select * into v_unchanged
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:progress:event:unchanged'
  );

  if coalesce(v_unchanged.changed, false)
     or coalesce(v_unchanged.replayed, false)
     or v_unchanged.outcome <> 'progress_unchanged'
     or v_unchanged.current_progress_version_id is distinct from v_progress.current_progress_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: unchanged authorities created Progress churn';
  end if;

  -- Change Applicability generically by replacing the rollback policy and
  -- rematerializing Checklist. Add fulfillment as a second unsupported domain.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);

  v_policy_rules_v2 := v_policy_rules || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key','fulfillment.always.required','rule_priority',10,
      'item_kind','commercial_gate','item_key','fulfillment','match_mode','always',
      'component_kind',null,'execution_kind',null,'applicability_state','required',
      'reason_code','runner_fulfillment_required','metadata','{}'::jsonb
    )
  );

  select * into v_policy_write
  from public.write_store_opportunity_gate_policy_internal(
    v_org_id,
    v_store_id,
    'p9:3.5:progress-runner:policy:v2',
    repeat('c', 64),
    v_policy_rules_v2,
    'system',
    null,
    'manual_check_runner',
    'progress_materializer_runner_policy',
    'p9_progress_runner',
    '{"runner":true,"phase":"v2"}'::jsonb
  );

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_checklist_v2
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:progress:checklist:v2'
  );

  if not coalesce(v_checklist_v2.changed, false)
     or v_checklist_v2.current_checklist_version_id is not distinct from v_checklist.current_checklist_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: policy change did not create a new Checklist current';
  end if;

  select current_progress_version_id
  into v_current_before
  from public.commercial_opportunity_checklist_progress_current
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opp_id;

  select * into v_progress_v2
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:progress:event:v2'
  );

  if not coalesce(v_progress_v2.changed, false)
     or v_progress_v2.previous_progress_version_id is distinct from v_current_before
     or v_progress_v2.checklist_version_id is distinct from v_checklist_v2.current_checklist_version_id
     or v_progress_v2.item_count <> 6 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: changed Checklist did not create complete child Progress version';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunity_checklist_progress_items progress_item
    join public.commercial_opportunity_checklist_items checklist_item
      on checklist_item.id = progress_item.checklist_item_id
     and checklist_item.checklist_version_id = progress_item.checklist_version_id
    where progress_item.progress_version_id = v_progress_v2.current_progress_version_id
      and checklist_item.item_key = 'fulfillment'
      and progress_item.assessment_state = 'needs_resolution'
      and progress_item.progress_state is null
      and progress_item.resolver_key = 'fulfillment:unavailable'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: generic unsupported domain did not materialize fail closed';
  end if;

  -- Replaying v1 after v2 must return stale v1 and leave current on v2.
  select current_progress_version_id
  into v_current_before
  from public.commercial_opportunity_checklist_progress_current
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opp_id;

  select * into v_stale
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:progress:event:v1'
  );

  select current_progress_version_id
  into v_current_after
  from public.commercial_opportunity_checklist_progress_current
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opp_id;

  if not coalesce(v_stale.replayed, false)
     or coalesce(v_stale.changed, false)
     or v_stale.outcome <> 'idempotent_replay_stale'
     or v_stale.current_progress_version_id is distinct from v_progress.current_progress_version_id
     or v_current_after is distinct from v_current_before then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: stale Progress replay regressed current';
  end if;

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
end;
$behavior$;

-- Structural safety: no forbidden current inference and no direct app mutation.
do $structure$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
  )
  into v_definition;

  if v_definition ~* 'order[[:space:]]+by[[:space:]].*(created_at|version_number)[[:space:]]+desc[[:space:]]+limit[[:space:]]+1'
     or v_definition ~* 'max[[:space:]]*\([[:space:]]*version_number' then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress materializer contains forbidden latest/max current inference';
  end if;

  if not (v_definition like '%commercial_opportunity_checklist_current%')
     or not (v_definition like '%commercial_opportunity_checklist_progress_current%')
     or not (v_definition like '%lifecycle_cycle%') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: Progress materializer does not anchor explicit current Checklist/lifecycle';
  end if;
end;
$structure$;

rollback;
