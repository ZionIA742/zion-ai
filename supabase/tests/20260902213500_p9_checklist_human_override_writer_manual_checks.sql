begin;

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:checklist-human-override-writer:manual-checks:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Manual checks for Canonical Human Checklist Applicability Override Writer v1.
--
-- ROLLBACK ONLY. The runner temporarily creates Profile/Checklist history and
-- temporarily edits store_operation_settings on one real fixture, then rolls
-- every change back. Any broken invariant aborts with SUT_FAIL/FIXTURE_FAIL.
-- ============================================================================

do $preflight$
declare
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
begin
  if v_writer is null then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist human override writer migration is not installed';
  end if;

  if pg_catalog.has_function_privilege('anon', v_writer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_writer, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_writer, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist human override writer grants mismatch';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_versions', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_items', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_current', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_override_events', 'INSERT') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: authenticated gained direct checklist mutation privileges';
  end if;
end;
$preflight$;

do $behavior$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_opp_id uuid;
  v_user_id uuid;
  v_non_member_id uuid := gen_random_uuid();

  v_profile_write record;
  v_materialized record;
  v_override_one record;
  v_override_two record;
  v_replay record;
  v_stale_replay record;
  v_preserved record;

  v_base public.commercial_opportunity_checklist_versions%rowtype;
  v_result_one public.commercial_opportunity_checklist_versions%rowtype;
  v_result_two public.commercial_opportunity_checklist_versions%rowtype;
  v_event public.commercial_opportunity_checklist_override_events%rowtype;
  v_current public.commercial_opportunity_checklist_current%rowtype;

  v_base_item_count integer;
  v_result_item_count integer;
  v_changed_item_count integer;
  v_version_count_before integer;
  v_version_count_after integer;
  v_event_count_before integer;
  v_event_count_after integer;
begin
  -- Pick one real pilot opportunity but require zero Profile/Checklist history;
  -- all synthetic authority created below stays inside this rollback-only tx.
  select
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.id
  into v_org_id, v_store_id, v_opp_id
  from public.commercial_opportunities opportunity_row
  where exists (
      select 1
      from public.store_operation_settings operation_row
      where operation_row.organization_id = opportunity_row.organization_id
        and operation_row.store_id = opportunity_row.store_id
    )
    and exists (
      select 1
      from public.store_opportunity_gate_policy_current policy_current
      where policy_current.organization_id = opportunity_row.organization_id
        and policy_current.store_id = opportunity_row.store_id
    )
    and exists (
      select 1
      from public.memberships membership_row
      join auth.users user_row on user_row.id = membership_row.user_id
      where membership_row.organization_id = opportunity_row.organization_id
        and membership_row.is_active is true
    )
    and not exists (
      select 1
      from public.commercial_opportunity_profile_versions profile_version
      where profile_version.organization_id = opportunity_row.organization_id
        and profile_version.store_id = opportunity_row.store_id
        and profile_version.commercial_opportunity_id = opportunity_row.id
    )
    and not exists (
      select 1
      from public.commercial_opportunity_checklist_versions checklist_version
      where checklist_version.organization_id = opportunity_row.organization_id
        and checklist_version.store_id = opportunity_row.store_id
        and checklist_version.commercial_opportunity_id = opportunity_row.id
    )
  order by opportunity_row.organization_id, opportunity_row.store_id, opportunity_row.id
  limit 1;

  if v_opp_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no opportunity with operation Settings, current Gate Policy, active auth member, and empty Profile/Checklist history';
  end if;

  select membership_row.user_id
  into v_user_id
  from public.memberships membership_row
  join auth.users user_row on user_row.id = membership_row.user_id
  where membership_row.organization_id = v_org_id
    and membership_row.is_active is true
  order by membership_row.user_id
  limit 1;

  if v_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no active auth-backed member for human override scenario';
  end if;

  -- Force a deterministic conflict fixture: installation is included in the
  -- profile while the store temporarily says it does not offer installation.
  update public.store_operation_settings
  set offers_installation = false
  where organization_id = v_org_id
    and store_id = v_store_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select *
  into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:human-override-runner:profile',
    repeat('1', 64),
    'resolved',
    '[{"component_key":"runner_custom","component_kind":"custom","component_state":"resolved","pool_id":null,"catalog_item_id":null,"reference_text":"runner custom item","metadata":{}}]'::jsonb,
    '[{"execution_kind":"installation","intent_state":"included","reason_code":"runner_installation_included","metadata":{}}]'::jsonb,
    'manual_check_runner',
    'checklist_human_override_runner_profile',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  select *
  into v_materialized
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:human-override:base-conflict'
  );

  execute 'reset role';

  if not coalesce(v_materialized.changed, false)
     or v_materialized.checklist_state <> 'conflict' then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: conflict fixture checklist was not materialized';
  end if;

  select version_row.*
  into v_base
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_materialized.current_checklist_version_id
    and version_row.organization_id = v_org_id
    and version_row.store_id = v_store_id
    and version_row.commercial_opportunity_id = v_opp_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: materialized base checklist version missing';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_base.id
      and item_row.organization_id = v_org_id
      and item_row.store_id = v_store_id
      and item_row.commercial_opportunity_id = v_opp_id
      and item_row.item_key = 'fulfillment'
      and item_row.item_kind = 'commercial_gate'
      and item_row.applicability_state = 'conflict'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: conflict fixture did not expose fulfillment=conflict';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_base.id
      and item_row.item_key = 'quote'
      and item_row.item_kind = 'commercial_gate'
      and item_row.applicability_state = 'required'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: custom fixture did not expose quote=required';
  end if;

  -- Valid human override: resolve an existing system conflict to required.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select *
  into v_override_one
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id,
    v_store_id,
    v_opp_id,
    v_base.id,
    'p9:3.5:human-override-runner:resolve-conflict',
    repeat('a', 64),
    'fulfillment',
    'commercial_gate',
    'required',
    'human_confirmed_installation_fulfillment',
    'Human confirmed that this opportunity will use installation fulfillment.',
    '{"runner":true,"scenario":"resolve_conflict"}'::jsonb
  );

  execute 'reset role';

  if not coalesce(v_override_one.changed, false)
     or coalesce(v_override_one.replayed, true)
     or v_override_one.outcome <> 'override_created'
     or v_override_one.base_checklist_version_id is distinct from v_base.id
     or v_override_one.from_applicability_state <> 'conflict'
     or v_override_one.to_applicability_state <> 'required'
     or v_override_one.actor_user_id is distinct from v_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: valid human conflict resolution override contract mismatch';
  end if;

  select version_row.*
  into v_result_one
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_override_one.result_checklist_version_id;

  if not found
     or v_result_one.previous_checklist_version_id is distinct from v_base.id
     or v_result_one.version_number <> v_base.version_number + 1
     or v_result_one.actor_type <> 'human'
     or v_result_one.actor_user_id is distinct from v_user_id
     or v_result_one.profile_version_id is distinct from v_base.profile_version_id
     or v_result_one.gate_policy_version_id is distinct from v_base.gate_policy_version_id
     or v_result_one.settings_snapshot is distinct from v_base.settings_snapshot
     or v_result_one.settings_fingerprint is distinct from v_base.settings_fingerprint then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: human override result version did not preserve base authorities/lineage';
  end if;

  select pg_catalog.count(*)::integer
  into v_base_item_count
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = v_base.id;

  select pg_catalog.count(*)::integer
  into v_result_item_count
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = v_result_one.id;

  if v_result_item_count <> v_base_item_count then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: human override did not clone the complete checklist item set';
  end if;

  select pg_catalog.count(*)::integer
  into v_changed_item_count
  from public.commercial_opportunity_checklist_items base_item
  join public.commercial_opportunity_checklist_items result_item
    on result_item.checklist_version_id = v_result_one.id
   and result_item.item_key = base_item.item_key
   and result_item.item_kind = base_item.item_kind
  where base_item.checklist_version_id = v_base.id
    and (
      result_item.applicability_state,
      result_item.reason_code,
      result_item.decision_basis,
      result_item.metadata
    ) is distinct from (
      base_item.applicability_state,
      base_item.reason_code,
      base_item.decision_basis,
      base_item.metadata
    );

  if v_changed_item_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: human override changed more or less than exactly one checklist item';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result_one.id
      and item_row.item_key = 'fulfillment'
      and item_row.item_kind = 'commercial_gate'
      and item_row.applicability_state = 'required'
      and item_row.reason_code = 'human_confirmed_installation_fulfillment'
      and item_row.decision_basis ? 'human_override'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: target item did not receive the human override state/audit basis';
  end if;

  select event_row.*
  into v_event
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.organization_id = v_org_id
    and event_row.store_id = v_store_id
    and event_row.commercial_opportunity_id = v_opp_id
    and event_row.operation_key = 'p9:3.5:human-override-runner:resolve-conflict';

  if not found
     or v_event.base_checklist_version_id is distinct from v_base.id
     or v_event.result_checklist_version_id is distinct from v_result_one.id
     or v_event.from_applicability_state <> 'conflict'
     or v_event.to_applicability_state <> 'required'
     or v_event.actor_user_id is distinct from v_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: append-only human override event mismatch';
  end if;

  -- Exact retry: replay before stale-current check, no extra version/event.
  select pg_catalog.count(*)::integer
  into v_version_count_before
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = v_org_id
    and version_row.store_id = v_store_id
    and version_row.commercial_opportunity_id = v_opp_id;

  select pg_catalog.count(*)::integer
  into v_event_count_before
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.organization_id = v_org_id
    and event_row.store_id = v_store_id
    and event_row.commercial_opportunity_id = v_opp_id;

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select *
  into v_replay
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id,
    v_store_id,
    v_opp_id,
    v_base.id,
    'p9:3.5:human-override-runner:resolve-conflict',
    repeat('a', 64),
    'fulfillment',
    'commercial_gate',
    'required',
    'human_confirmed_installation_fulfillment',
    'Human confirmed that this opportunity will use installation fulfillment.',
    '{"runner":true,"scenario":"resolve_conflict"}'::jsonb
  );

  execute 'reset role';

  select pg_catalog.count(*)::integer
  into v_version_count_after
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = v_org_id
    and version_row.store_id = v_store_id
    and version_row.commercial_opportunity_id = v_opp_id;

  select pg_catalog.count(*)::integer
  into v_event_count_after
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.organization_id = v_org_id
    and event_row.store_id = v_store_id
    and event_row.commercial_opportunity_id = v_opp_id;

  if not coalesce(v_replay.replayed, false)
     or coalesce(v_replay.changed, true)
     or v_replay.outcome <> 'idempotent_replay_current'
     or v_replay.result_checklist_version_id is distinct from v_result_one.id
     or v_version_count_after <> v_version_count_before
     or v_event_count_after <> v_event_count_before then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: exact human override retry is not idempotent';
  end if;

  -- Same operation key with divergent payload must fail closed.
  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

    perform 1
    from public.override_commercial_opportunity_checklist_item_by_user(
      v_org_id,
      v_store_id,
      v_opp_id,
      v_base.id,
      'p9:3.5:human-override-runner:resolve-conflict',
      repeat('a', 64),
      'fulfillment',
      'commercial_gate',
      'optional',
      'human_confirmed_installation_fulfillment',
      'Human confirmed that this opportunity will use installation fulfillment.',
      '{"runner":true,"scenario":"resolve_conflict"}'::jsonb
    );

    execute 'reset role';
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: divergent idempotency payload was accepted';
  exception
    when sqlstate '23505' then
      execute 'reset role';
  end;

  -- A new operation based on the now-stale materializer version must fail.
  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

    perform 1
    from public.override_commercial_opportunity_checklist_item_by_user(
      v_org_id,
      v_store_id,
      v_opp_id,
      v_base.id,
      'p9:3.5:human-override-runner:stale-current',
      repeat('b', 64),
      'quote',
      'commercial_gate',
      'optional',
      'human_quote_exception',
      'Human reviewed this opportunity and made the quote optional.',
      '{"runner":true,"scenario":"stale"}'::jsonb
    );

    execute 'reset role';
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: stale expected current was accepted';
  exception
    when sqlstate 'P0001' then
      execute 'reset role';
      if sqlerrm <> 'ZION_CHECKLIST_OVERRIDE_STALE_CURRENT' then
        raise;
      end if;
  end;

  -- Frozen business rule: human cannot create conflict manually.
  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

    perform 1
    from public.override_commercial_opportunity_checklist_item_by_user(
      v_org_id,
      v_store_id,
      v_opp_id,
      v_result_one.id,
      'p9:3.5:human-override-runner:manual-conflict',
      repeat('c', 64),
      'quote',
      'commercial_gate',
      'conflict',
      'human_manual_conflict_attempt',
      'Human must not be able to create a conflict state manually.',
      '{"runner":true,"scenario":"manual_conflict"}'::jsonb
    );

    execute 'reset role';
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: human manually created conflict';
  exception
    when sqlstate '22023' then
      execute 'reset role';
      if sqlerrm <> 'ZION_CHECKLIST_OVERRIDE_TARGET_STATE_INVALID' then
        raise;
      end if;
  end;

  -- Authenticated identity without active membership must be denied.
  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', v_non_member_id::text, true);

    perform 1
    from public.override_commercial_opportunity_checklist_item_by_user(
      v_org_id,
      v_store_id,
      v_opp_id,
      v_result_one.id,
      'p9:3.5:human-override-runner:non-member',
      repeat('d', 64),
      'quote',
      'commercial_gate',
      'optional',
      'human_quote_exception',
      'A non-member must not be allowed to override the checklist.',
      '{"runner":true,"scenario":"non_member"}'::jsonb
    );

    execute 'reset role';
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: non-member executed human checklist override';
  exception
    when sqlstate '42501' then
      execute 'reset role';
  end;

  -- Second legitimate human child: required -> optional on quote.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select *
  into v_override_two
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id,
    v_store_id,
    v_opp_id,
    v_result_one.id,
    'p9:3.5:human-override-runner:quote-optional',
    repeat('e', 64),
    'quote',
    'commercial_gate',
    'optional',
    'human_quote_exception',
    'Human reviewed this opportunity and made the quote optional.',
    '{"runner":true,"scenario":"required_to_optional"}'::jsonb
  );

  execute 'reset role';

  if not coalesce(v_override_two.changed, false)
     or v_override_two.from_applicability_state <> 'required'
     or v_override_two.to_applicability_state <> 'optional'
     or v_override_two.base_checklist_version_id is distinct from v_result_one.id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: normal required-to-optional human override failed';
  end if;

  select version_row.*
  into v_result_two
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_override_two.result_checklist_version_id;

  if not found
     or v_result_two.previous_checklist_version_id is distinct from v_result_one.id
     or v_result_two.actor_type <> 'human'
     or v_result_two.actor_user_id is distinct from v_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: second human override lineage/actor mismatch';
  end if;

  -- First event replay is now stale and must never move current backwards.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select *
  into v_stale_replay
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id,
    v_store_id,
    v_opp_id,
    v_base.id,
    'p9:3.5:human-override-runner:resolve-conflict',
    repeat('a', 64),
    'fulfillment',
    'commercial_gate',
    'required',
    'human_confirmed_installation_fulfillment',
    'Human confirmed that this opportunity will use installation fulfillment.',
    '{"runner":true,"scenario":"resolve_conflict"}'::jsonb
  );

  execute 'reset role';

  if v_stale_replay.outcome <> 'idempotent_replay_stale'
     or not coalesce(v_stale_replay.replayed, false)
     or v_stale_replay.current_checklist_version_id is distinct from v_result_two.id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: old override replay did not remain stale/current-safe';
  end if;

  -- Materializer must preserve the human current authority exactly.
  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select *
  into v_preserved
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:human-override:after-human-authority'
  );

  execute 'reset role';

  if not coalesce(v_preserved.preserved, false)
     or v_preserved.outcome <> 'preserved_human_authority'
     or v_preserved.current_checklist_version_id is distinct from v_result_two.id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist materializer overwrote canonical human override authority';
  end if;

  select current_row.*
  into v_current
  from public.commercial_opportunity_checklist_current current_row
  where current_row.organization_id = v_org_id
    and current_row.store_id = v_store_id
    and current_row.commercial_opportunity_id = v_opp_id;

  if not found or v_current.current_checklist_version_id is distinct from v_result_two.id then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: final checklist current is not the latest human override version';
  end if;
end;
$behavior$;

do $definition_gate$
declare
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_writer)
  into v_definition;

  if pg_catalog.strpos(v_definition, 'auth.uid()') = 0
     or pg_catalog.strpos(v_definition, 'is_active is true') = 0
     or pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(v_definition, 'for update') = 0
     or pg_catalog.strpos(v_definition, 'ZION_CHECKLIST_OVERRIDE_STALE_CURRENT') = 0
     or pg_catalog.strpos(v_definition, 'idempotent_replay_stale') = 0
     or pg_catalog.strpos(v_definition, 'ZION_CHECKLIST_OVERRIDE_TARGET_STATE_INVALID') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_checklist_override_events') = 0
     or pg_catalog.strpos(v_definition, 'max(version_number)') > 0
     or pg_catalog.strpos(v_definition, 'order by created_at desc') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist human override writer static authority contract mismatch';
  end if;
end;
$definition_gate$;

rollback;
