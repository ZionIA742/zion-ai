begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '360s';
set local idle_in_transaction_session_timeout = '360s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_policy_checklist_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_policy_checklist_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b_same_org uuid not null,
  store_c_other_org uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  user_inactive_a uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_a uuid not null,
  opp_peer uuid not null,
  opp_other_org uuid not null,
  profile_a uuid not null,
  profile_peer uuid not null,
  policy_v1 uuid not null,
  policy_v2 uuid not null,
  policy_store_b uuid not null,
  checklist_v1 uuid not null,
  checklist_v2 uuid not null
) on commit preserve rows;

insert into pg_temp._p9_policy_checklist_ctx (
  org_a,
  org_b,
  store_a,
  store_b_same_org,
  store_c_other_org,
  user_a,
  user_b,
  user_inactive_a,
  customer_a,
  customer_b,
  opp_a,
  opp_peer,
  opp_other_org,
  profile_a,
  profile_peer,
  policy_v1,
  policy_v2,
  policy_store_b,
  checklist_v1,
  checklist_v2
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_policy_checklist_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_policy_checklist_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set
    scenario_name = excluded.scenario_name,
    status = excluded.status,
    detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_policy_checklist_expect(
  p_scenario_number integer,
  p_scenario_name text,
  p_condition boolean,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp._p9_policy_checklist_record(
    p_scenario_number,
    p_scenario_name,
    case when p_condition then 'PASS' else 'SUT_FAIL' end,
    coalesce(p_detail, case when p_condition then 'ok' else 'condition returned false' end)
  );
exception
  when others then
    perform pg_temp._p9_policy_checklist_record(
      p_scenario_number,
      p_scenario_name,
      'HARNESS_ERROR',
      sqlstate || ': ' || sqlerrm
    );
end;
$function$;

create or replace function pg_temp._p9_policy_checklist_expect_fail(
  p_scenario_number integer,
  p_scenario_name text,
  p_sql text,
  p_expected_sqlstates text[],
  p_expected_constraint text default null,
  p_expected_message_contains text default null
)
returns void
language plpgsql
as $function$
declare
  v_state text;
  v_message text;
  v_constraint text;
  v_state_matches boolean;
  v_constraint_matches boolean;
  v_message_matches boolean;
begin
  if coalesce(pg_catalog.array_length(p_expected_sqlstates, 1), 0) = 0 then
    perform pg_temp._p9_policy_checklist_record(
      p_scenario_number,
      p_scenario_name,
      'HARNESS_ERROR',
      'expected SQLSTATE allowlist is empty'
    );
    return;
  end if;

  begin
    execute p_sql;

    perform pg_temp._p9_policy_checklist_record(
      p_scenario_number,
      p_scenario_name,
      'SUT_FAIL',
      'statement unexpectedly succeeded'
    );
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;

      v_state_matches := v_state = any(p_expected_sqlstates);
      v_constraint_matches :=
        p_expected_constraint is null
        or v_constraint is not distinct from p_expected_constraint;
      v_message_matches :=
        p_expected_message_contains is null
        or pg_catalog.strpos(coalesce(v_message, ''), p_expected_message_contains) > 0;

      perform pg_temp._p9_policy_checklist_record(
        p_scenario_number,
        p_scenario_name,
        case
          when v_state_matches
           and v_constraint_matches
           and v_message_matches
          then 'PASS'
          else 'SUT_FAIL'
        end,
        pg_catalog.format(
          'actual=%s constraint=%s message=%s / expected_states=%s expected_constraint=%s expected_message_contains=%s',
          coalesce(v_state, '<null>'),
          coalesce(v_constraint, '<null>'),
          coalesce(v_message, '<null>'),
          p_expected_sqlstates::text,
          coalesce(p_expected_constraint, '<any>'),
          coalesce(p_expected_message_contains, '<any>')
        )
      );
  end;
exception
  when others then
    perform pg_temp._p9_policy_checklist_record(
      p_scenario_number,
      p_scenario_name,
      'HARNESS_ERROR',
      sqlstate || ': ' || sqlerrm
    );
end;
$function$;

create or replace function pg_temp._p9_policy_checklist_index_columns(
  p_index_name text
)
returns name[]
language sql
stable
as $function$
  select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_class
    on index_class.oid = index_row.indexrelid
  join pg_catalog.pg_class table_class
    on table_class.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = table_class.relnamespace
  join pg_catalog.unnest(index_row.indkey) with ordinality as key_row(attnum, ordinality)
    on true
  join pg_catalog.pg_attribute attribute_row
    on attribute_row.attrelid = table_class.oid
   and attribute_row.attnum = key_row.attnum
  where namespace_row.nspname = 'public'
    and index_class.relname = p_index_name;
$function$;

create or replace function pg_temp._p9_policy_checklist_unique_index_is_exact(
  p_table_name text,
  p_index_name text,
  p_columns name[],
  p_expect_partial boolean default false
)
returns boolean
language sql
stable
as $function$
  select exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class
      on index_class.oid = index_row.indexrelid
    join pg_catalog.pg_class table_class
      on table_class.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_class.relnamespace
    where namespace_row.nspname = 'public'
      and table_class.relname = p_table_name
      and index_class.relname = p_index_name
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and (
        (p_expect_partial and index_row.indpred is not null)
        or (not p_expect_partial and index_row.indpred is null)
      )
      and pg_temp._p9_policy_checklist_index_columns(p_index_name) = p_columns
  );
$function$;

-- ============================================================================
-- Fixtures. All changes are rolled back.
-- ============================================================================

do $fixtures$
declare
  ctx pg_temp._p9_policy_checklist_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_policy_checklist_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 Policy Checklist Runner Org A', 'active'),
    (ctx.org_b, 'P9 Policy Checklist Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 Policy Checklist Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 Policy Checklist Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 Policy Checklist Store C');

  insert into auth.users (id)
  values
    (ctx.user_a),
    (ctx.user_b),
    (ctx.user_inactive_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (ctx.org_a, ctx.user_a, 'owner'::public.app_role, true),
    (ctx.org_b, ctx.user_b, 'owner'::public.app_role, true),
    (ctx.org_a, ctx.user_inactive_a, 'owner'::public.app_role, false);

  insert into public.customers (id, organization_id, display_name)
  values
    (ctx.customer_a, ctx.org_a, 'P9 Policy Checklist Customer A'),
    (ctx.customer_b, ctx.org_b, 'P9 Policy Checklist Customer B');

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values
    (ctx.opp_a, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_peer, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_other_org, ctx.org_b, ctx.store_c_other_org, ctx.customer_b, 'qualificacao');

  insert into public.commercial_opportunity_profile_versions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    version_number,
    profile_state,
    operation_key,
    request_fingerprint,
    actor_type,
    actor_user_id,
    source_type,
    reason_code,
    created_by
  )
  values
    (
      ctx.profile_a,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      1,
      'resolved',
      'p9_policy_checklist_profile:a:v1',
      repeat('1', 64),
      'system',
      null,
      'manual_check',
      'manual_check_seed',
      'p9_policy_checklist_manual_check'
    ),
    (
      ctx.profile_peer,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_peer,
      1,
      'resolved',
      'p9_policy_checklist_profile:peer:v1',
      repeat('2', 64),
      'system',
      null,
      'manual_check',
      'manual_check_seed',
      'p9_policy_checklist_manual_check'
    );

  insert into public.commercial_opportunity_profile_components (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    component_key,
    component_kind,
    component_state,
    reference_text
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.profile_a,
    'primary_pool',
    'pool',
    'partial',
    'Pool selected for policy/checklist fixture'
  );

  insert into public.commercial_opportunity_profile_execution_intents (
    organization_id,
    store_id,
    commercial_opportunity_id,
    profile_version_id,
    execution_kind,
    intent_state,
    reason_code
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.profile_a,
    'installation',
    'included',
    'manual_check_seed'
  );

  insert into public.store_opportunity_gate_policy_versions (
    id,
    organization_id,
    store_id,
    version_number,
    previous_policy_version_id,
    operation_key,
    request_fingerprint,
    actor_type,
    actor_user_id,
    source_type,
    reason_code,
    created_by
  )
  values
    (
      ctx.policy_v1,
      ctx.org_a,
      ctx.store_a,
      1,
      null,
      'p9_gate_policy_fixture:v1',
      repeat('3', 64),
      'system',
      null,
      'manual_check',
      'manual_check_seed',
      'p9_policy_checklist_manual_check'
    ),
    (
      ctx.policy_v2,
      ctx.org_a,
      ctx.store_a,
      2,
      ctx.policy_v1,
      'p9_gate_policy_fixture:v2',
      repeat('4', 64),
      'human',
      ctx.user_a,
      'crm_manual',
      'manual_policy_revision',
      'user:' || ctx.user_a::text
    ),
    (
      ctx.policy_store_b,
      ctx.org_a,
      ctx.store_b_same_org,
      1,
      null,
      'p9_gate_policy_fixture:store_b:v1',
      repeat('5', 64),
      'system',
      null,
      'manual_check',
      'manual_check_seed',
      'p9_policy_checklist_manual_check'
    );

  insert into public.store_opportunity_gate_policy_rules (
    organization_id,
    store_id,
    policy_version_id,
    rule_key,
    rule_priority,
    item_kind,
    item_key,
    match_mode,
    component_kind,
    execution_kind,
    applicability_state,
    reason_code
  )
  values
    (
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2,
      'default_quote_required',
      10,
      'commercial_gate',
      'quote',
      'always',
      null,
      null,
      'required',
      'default_commercial_document'
    ),
    (
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2,
      'pool_measurements_required',
      20,
      'technical_requirement',
      'measurements_confirmation',
      'component',
      'pool',
      null,
      'required',
      'pool_requires_measurements'
    ),
    (
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2,
      'installation_fulfillment_required',
      30,
      'commercial_gate',
      'fulfillment',
      'execution',
      null,
      'installation',
      'required',
      'installation_included'
    ),
    (
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2,
      'pool_installation_visit_optional',
      40,
      'commercial_gate',
      'technical_visit',
      'component_and_execution',
      'pool',
      'installation',
      'optional',
      'store_policy_allows_optional_visit'
    );

  insert into public.store_opportunity_gate_policy_current (
    organization_id,
    store_id,
    current_policy_version_id,
    last_operation_key
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.policy_v2,
    'p9_gate_policy_fixture:v2'
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
    created_by
  )
  values
    (
      ctx.checklist_v1,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      1,
      null,
      ctx.profile_a,
      ctx.policy_v1,
      'needs_resolution',
      pg_catalog.jsonb_build_object(
        'store_operation_settings', pg_catalog.jsonb_build_object(
          'offers_installation', true,
          'offers_technical_visit', true
        ),
        'store_payment_settings', pg_catalog.jsonb_build_object(
          'down_payment_mode', 'required'
        ),
        'store_quote_settings', pg_catalog.jsonb_build_object(
          'ai_can_generate_quote', true,
          'ai_can_send_quote_to_customer', false
        )
      ),
      repeat('6', 64),
      'p9_checklist_fixture:v1',
      repeat('7', 64),
      'system',
      null,
      'policy_materialization',
      'manual_check_seed',
      'p9_policy_checklist_manual_check'
    ),
    (
      ctx.checklist_v2,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      2,
      ctx.checklist_v1,
      ctx.profile_a,
      ctx.policy_v2,
      'resolved',
      pg_catalog.jsonb_build_object(
        'store_operation_settings', pg_catalog.jsonb_build_object(
          'offers_installation', true,
          'offers_technical_visit', true
        ),
        'store_payment_settings', pg_catalog.jsonb_build_object(
          'down_payment_mode', 'required'
        ),
        'store_quote_settings', pg_catalog.jsonb_build_object(
          'ai_can_generate_quote', true,
          'ai_can_send_quote_to_customer', false
        )
      ),
      repeat('8', 64),
      'p9_checklist_fixture:v2',
      repeat('9', 64),
      'human',
      ctx.user_a,
      'crm_manual_override',
      'measurements_confirmed_manually',
      'user:' || ctx.user_a::text
    );

  insert into public.commercial_opportunity_checklist_items (
    organization_id,
    store_id,
    commercial_opportunity_id,
    checklist_version_id,
    item_key,
    item_kind,
    applicability_state,
    reason_code,
    decision_basis
  )
  values
    (
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      'quote',
      'commercial_gate',
      'required',
      'default_commercial_document',
      pg_catalog.jsonb_build_object('fixture', true)
    ),
    (
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      'measurements_confirmation',
      'technical_requirement',
      'needs_resolution',
      'measurement_evidence_missing',
      pg_catalog.jsonb_build_object('fixture', true)
    ),
    (
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v2,
      'quote',
      'commercial_gate',
      'required',
      'default_commercial_document',
      pg_catalog.jsonb_build_object('fixture', true)
    ),
    (
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v2,
      'measurements_confirmation',
      'technical_requirement',
      'required',
      'manual_override_confirmed_requirement',
      pg_catalog.jsonb_build_object('fixture', true)
    );

  insert into public.commercial_opportunity_checklist_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    current_checklist_version_id,
    last_operation_key
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.checklist_v2,
    'p9_checklist_fixture:v2'
  );

  insert into public.commercial_opportunity_checklist_override_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    base_checklist_version_id,
    result_checklist_version_id,
    item_key,
    item_kind,
    from_applicability_state,
    to_applicability_state,
    reason_code,
    reason_text,
    actor_user_id,
    operation_key,
    request_fingerprint
  )
  values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    ctx.checklist_v1,
    ctx.checklist_v2,
    'measurements_confirmation',
    'technical_requirement',
    'needs_resolution',
    'required',
    'manual_requirement_override',
    'Human confirmed that measurements must be obtained before advancing.',
    ctx.user_a,
    'p9_checklist_fixture:v2',
    repeat('a', 64)
  );
end;
$fixtures$;

-- ============================================================================
-- Structural checks: 1-18.
-- ============================================================================

do $structural_checks$
declare
  v_tables text[] := array[
    'store_opportunity_gate_policy_versions',
    'store_opportunity_gate_policy_rules',
    'store_opportunity_gate_policy_current',
    'commercial_opportunity_checklist_versions',
    'commercial_opportunity_checklist_items',
    'commercial_opportunity_checklist_current',
    'commercial_opportunity_checklist_override_events'
  ];
  v_function regprocedure;
  v_function_scenario integer;
  v_function_names text[] := array[
    'public.p9_opportunity_gate_policy_checklist_prevent_mutation()',
    'public.p9_opportunity_gate_policy_validate_current_projection()',
    'public.p9_opportunity_gate_policy_touch_current_updated_at()',
    'public.p9_commercial_opportunity_checklist_validate_current_projection()',
    'public.p9_commercial_opportunity_checklist_touch_current_updated_at()',
    'public.p9_commercial_opportunity_checklist_validate_override_event()'
  ];
begin
  perform pg_temp._p9_policy_checklist_expect(
    1,
    'gate policy/checklist foundation tables exist',
    not exists (
      select 1
      from pg_catalog.unnest(v_tables) as table_name
      where pg_catalog.to_regclass('public.' || table_name) is null
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    2,
    'gate policy version keys and anti-branch index exist',
    pg_temp._p9_policy_checklist_unique_index_is_exact(
      'store_opportunity_gate_policy_versions',
      'p9_gate_policy_versions_scope_version_number_uidx',
      array['organization_id', 'store_id', 'version_number']::name[]
    )
    and pg_temp._p9_policy_checklist_unique_index_is_exact(
      'store_opportunity_gate_policy_versions',
      'p9_gate_policy_versions_scope_operation_uidx',
      array['organization_id', 'store_id', 'operation_key']::name[]
    )
    and pg_temp._p9_policy_checklist_unique_index_is_exact(
      'store_opportunity_gate_policy_versions',
      'p9_gate_policy_versions_scope_id_uidx',
      array['id', 'organization_id', 'store_id']::name[]
    )
    and pg_temp._p9_policy_checklist_unique_index_is_exact(
      'store_opportunity_gate_policy_versions',
      'p9_gate_policy_versions_previous_once_uidx',
      array['organization_id', 'store_id', 'previous_policy_version_id']::name[],
      true
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    3,
    'gate policy rule key index exists',
    pg_temp._p9_policy_checklist_unique_index_is_exact(
      'store_opportunity_gate_policy_rules',
      'p9_gate_policy_rules_version_rule_key_uidx',
      array['policy_version_id', 'rule_key']::name[]
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    4,
    'checklist version keys and anti-branch index exist',
    pg_temp._p9_policy_checklist_unique_index_is_exact(
      'commercial_opportunity_checklist_versions',
      'p9_checklist_versions_scope_version_number_uidx',
      array['organization_id', 'store_id', 'commercial_opportunity_id', 'version_number']::name[]
    )
    and pg_temp._p9_policy_checklist_unique_index_is_exact(
      'commercial_opportunity_checklist_versions',
      'p9_checklist_versions_scope_operation_uidx',
      array['organization_id', 'store_id', 'commercial_opportunity_id', 'operation_key']::name[]
    )
    and pg_temp._p9_policy_checklist_unique_index_is_exact(
      'commercial_opportunity_checklist_versions',
      'p9_checklist_versions_scope_id_uidx',
      array['id', 'organization_id', 'store_id', 'commercial_opportunity_id']::name[]
    )
    and pg_temp._p9_policy_checklist_unique_index_is_exact(
      'commercial_opportunity_checklist_versions',
      'p9_checklist_versions_previous_once_uidx',
      array['organization_id', 'store_id', 'commercial_opportunity_id', 'previous_checklist_version_id']::name[],
      true
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    5,
    'checklist item and override operation unique indexes exist',
    pg_temp._p9_policy_checklist_unique_index_is_exact(
      'commercial_opportunity_checklist_items',
      'p9_checklist_items_version_item_key_uidx',
      array['checklist_version_id', 'item_key']::name[]
    )
    and pg_temp._p9_policy_checklist_unique_index_is_exact(
      'commercial_opportunity_checklist_override_events',
      'p9_checklist_override_events_scope_operation_uidx',
      array['organization_id', 'store_id', 'commercial_opportunity_id', 'operation_key']::name[]
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    6,
    'composite foreign keys exist',
    not exists (
      select 1
      from (
        values
          ('store_opportunity_gate_policy_versions'::text, 'p9_gate_policy_versions_previous_scope_fk'::text),
          ('store_opportunity_gate_policy_rules', 'p9_gate_policy_rules_version_scope_fk'),
          ('store_opportunity_gate_policy_current', 'p9_gate_policy_current_version_scope_fk'),
          ('commercial_opportunity_checklist_versions', 'p9_checklist_versions_opp_scope_fk'),
          ('commercial_opportunity_checklist_versions', 'p9_checklist_versions_profile_scope_fk'),
          ('commercial_opportunity_checklist_versions', 'p9_checklist_versions_gate_policy_scope_fk'),
          ('commercial_opportunity_checklist_versions', 'p9_checklist_versions_previous_scope_fk'),
          ('commercial_opportunity_checklist_items', 'p9_checklist_items_version_scope_fk'),
          ('commercial_opportunity_checklist_current', 'p9_checklist_current_version_scope_fk'),
          ('commercial_opportunity_checklist_override_events', 'p9_checklist_override_events_base_scope_fk'),
          ('commercial_opportunity_checklist_override_events', 'p9_checklist_override_events_result_scope_fk')
      ) as expected(table_name, constraint_name)
      where not exists (
        select 1
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid = ('public.' || expected.table_name)::regclass
          and constraint_row.conname = expected.constraint_name
          and constraint_row.contype = 'f'
      )
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    7,
    'critical check constraints exist',
    not exists (
      select 1
      from (
        values
          ('p9_gate_policy_rules_item_kind_chk'::text),
          ('p9_gate_policy_rules_match_mode_chk'),
          ('p9_gate_policy_rules_match_shape_chk'),
          ('p9_gate_policy_rules_applicability_state_chk'),
          ('p9_checklist_versions_state_chk'),
          ('p9_checklist_versions_settings_snapshot_chk'),
          ('p9_checklist_versions_settings_fingerprint_chk'),
          ('p9_checklist_items_item_kind_chk'),
          ('p9_checklist_items_applicability_state_chk'),
          ('p9_checklist_override_events_versions_differ_chk'),
          ('p9_checklist_override_events_state_change_chk')
      ) as expected(constraint_name)
      where not exists (
        select 1
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conname = expected.constraint_name
      )
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    8,
    'append-only/current/override triggers exist',
    not exists (
      select 1
      from (
        values
          ('store_opportunity_gate_policy_versions'::text, 'p9_gate_policy_versions_append_only'::text),
          ('store_opportunity_gate_policy_rules', 'p9_gate_policy_rules_append_only'),
          ('store_opportunity_gate_policy_current', 'p9_gate_policy_current_validate_projection'),
          ('store_opportunity_gate_policy_current', 'p9_gate_policy_current_touch_updated_at'),
          ('commercial_opportunity_checklist_versions', 'p9_checklist_versions_append_only'),
          ('commercial_opportunity_checklist_items', 'p9_checklist_items_append_only'),
          ('commercial_opportunity_checklist_current', 'p9_checklist_current_validate_projection'),
          ('commercial_opportunity_checklist_current', 'p9_checklist_current_touch_updated_at'),
          ('commercial_opportunity_checklist_override_events', 'p9_checklist_override_events_validate'),
          ('commercial_opportunity_checklist_override_events', 'p9_checklist_override_events_append_only')
      ) as expected(table_name, trigger_name)
      where not exists (
        select 1
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid = ('public.' || expected.table_name)::regclass
          and trigger_row.tgname = expected.trigger_name
          and not trigger_row.tgisinternal
      )
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    9,
    'RLS enabled on all gate policy/checklist tables',
    not exists (
      select 1
      from pg_catalog.unnest(v_tables) as table_name
      where not exists (
        select 1
        from pg_catalog.pg_class class_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = class_row.relnamespace
        where namespace_row.nspname = 'public'
          and class_row.relname = table_name
          and class_row.relrowsecurity
      )
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    10,
    'authenticated/service_role have SELECT only and anon has no direct access',
    not exists (
      select 1
      from pg_catalog.unnest(v_tables) as table_name
      where not pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
         or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'SELECT')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'SELECT')
         or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'INSERT')
         or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE')
         or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'DELETE')
         or pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'INSERT')
         or pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'UPDATE')
         or pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'DELETE')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'INSERT')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'UPDATE')
         or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'DELETE')
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    11,
    'active-membership SELECT policies exist',
    not exists (
      select 1
      from (
        values
          ('store_opportunity_gate_policy_versions'::text, 'p9_gate_policy_versions_select_active_membership'::text),
          ('store_opportunity_gate_policy_rules', 'p9_gate_policy_rules_select_active_membership'),
          ('store_opportunity_gate_policy_current', 'p9_gate_policy_current_select_active_membership'),
          ('commercial_opportunity_checklist_versions', 'p9_checklist_versions_select_active_membership'),
          ('commercial_opportunity_checklist_items', 'p9_checklist_items_select_active_membership'),
          ('commercial_opportunity_checklist_current', 'p9_checklist_current_select_active_membership'),
          ('commercial_opportunity_checklist_override_events', 'p9_checklist_override_events_select_active_membership')
      ) as expected(table_name, policy_name)
      where not exists (
        select 1
        from pg_catalog.pg_policy policy_row
        where policy_row.polrelid = ('public.' || expected.table_name)::regclass
          and policy_row.polname = expected.policy_name
      )
    )
  );

  perform pg_temp._p9_policy_checklist_expect(
    12,
    'required snapshot and classification columns exist with expected types',
    not exists (
      select 1
      from (
        values
          ('store_opportunity_gate_policy_rules'::text, 'item_kind'::text, 'text'::text, 'NO'::text),
          ('store_opportunity_gate_policy_rules', 'item_key', 'text', 'NO'),
          ('store_opportunity_gate_policy_rules', 'match_mode', 'text', 'NO'),
          ('store_opportunity_gate_policy_rules', 'component_kind', 'text', 'YES'),
          ('store_opportunity_gate_policy_rules', 'execution_kind', 'text', 'YES'),
          ('store_opportunity_gate_policy_rules', 'applicability_state', 'text', 'NO'),
          ('commercial_opportunity_checklist_versions', 'profile_version_id', 'uuid', 'NO'),
          ('commercial_opportunity_checklist_versions', 'gate_policy_version_id', 'uuid', 'NO'),
          ('commercial_opportunity_checklist_versions', 'checklist_state', 'text', 'NO'),
          ('commercial_opportunity_checklist_versions', 'settings_snapshot', 'jsonb', 'NO'),
          ('commercial_opportunity_checklist_versions', 'settings_fingerprint', 'text', 'NO'),
          ('commercial_opportunity_checklist_items', 'item_kind', 'text', 'NO'),
          ('commercial_opportunity_checklist_items', 'applicability_state', 'text', 'NO'),
          ('commercial_opportunity_checklist_override_events', 'reason_text', 'text', 'NO'),
          ('commercial_opportunity_checklist_override_events', 'actor_user_id', 'uuid', 'NO')
      ) as expected(table_name, column_name, data_type, is_nullable)
      where not exists (
        select 1
        from information_schema.columns column_row
        where column_row.table_schema = 'public'
          and column_row.table_name = expected.table_name
          and column_row.column_name = expected.column_name
          and column_row.data_type = expected.data_type
          and column_row.is_nullable = expected.is_nullable
      )
    )
  );

  for v_function, v_function_scenario in
    select
      pg_catalog.to_regprocedure(function_row.function_name),
      (12 + function_row.ordinality)::integer
    from pg_catalog.unnest(v_function_names) with ordinality
      as function_row(function_name, ordinality)
    order by function_row.ordinality
  loop
    perform pg_temp._p9_policy_checklist_expect(
      v_function_scenario,
      'internal trigger function ownership/search_path/grants are hardened: ' || coalesce(v_function::text, '<missing>'),
      v_function is not null
      and exists (
        select 1
        from pg_catalog.pg_proc proc_row
        join pg_catalog.pg_roles owner_role
          on owner_role.oid = proc_row.proowner
        where proc_row.oid = v_function::oid
          and owner_role.rolname = 'postgres'
          and proc_row.prosecdef is false
          and proc_row.proconfig @> array['search_path=pg_catalog, pg_temp']
      )
      and not pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
    );
  end loop;
end;
$structural_checks$;

-- ============================================================================
-- Constraint/trigger behavior: 20-69.
-- ============================================================================

do $behavior_checks$
declare
  ctx pg_temp._p9_policy_checklist_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_policy_checklist_ctx;

  perform pg_temp._p9_policy_checklist_expect_fail(
    20,
    'gate policy version with mismatched store/organization scope fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_versions (
          organization_id, store_id, version_number, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, 1, 'bad_scope', %L,
          'system', 'manual_check', 'bad_scope', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_b,
      ctx.store_a,
      repeat('b', 64)
    ),
    array['23503'],
    'p9_gate_policy_versions_store_scope_fk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    21,
    'gate policy previous version cross-store fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_versions (
          organization_id, store_id, version_number, previous_policy_version_id,
          operation_key, request_fingerprint, actor_type, source_type,
          reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, 2, %L::uuid,
          'bad_previous_scope', %L, 'system', 'manual_check',
          'bad_previous_scope', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_b_same_org,
      ctx.policy_v1,
      repeat('c', 64)
    ),
    array['23503'],
    'p9_gate_policy_versions_previous_scope_fk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    22,
    'gate policy branching from same previous version fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_versions (
          organization_id, store_id, version_number, previous_policy_version_id,
          operation_key, request_fingerprint, actor_type, source_type,
          reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, 3, %L::uuid,
          'branch_from_v1', %L, 'system', 'manual_check',
          'branch_from_v1', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v1,
      repeat('d', 64)
    ),
    array['23505'],
    'p9_gate_policy_versions_previous_once_uidx'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    23,
    'invalid gate policy request_fingerprint fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_versions (
          organization_id, store_id, version_number, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, 3, 'bad_fingerprint', 'ABC',
          'system', 'manual_check', 'bad_fingerprint', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a
    ),
    array['23514'],
    'p9_gate_policy_versions_request_fingerprint_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    24,
    'gate policy human actor without actor_user_id fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_versions (
          organization_id, store_id, version_number, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, 3, 'bad_human_actor', %L,
          'human', 'manual_check', 'bad_human_actor', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      repeat('e', 64)
    ),
    array['23514'],
    'p9_gate_policy_versions_actor_user_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    25,
    'gate policy system actor with actor_user_id fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_versions (
          organization_id, store_id, version_number, operation_key,
          request_fingerprint, actor_type, actor_user_id, source_type,
          reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, 3, 'bad_system_actor', %L,
          'system', %L::uuid, 'manual_check', 'bad_system_actor',
          'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      repeat('f', 64),
      ctx.user_a
    ),
    array['23514'],
    'p9_gate_policy_versions_actor_user_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    26,
    'gate policy source_type outside canonical syntax fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_versions (
          organization_id, store_id, version_number, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, 3, 'bad_source_type', %L,
          'system', 'Bad Source', 'bad_source_type', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      repeat('0', 64)
    ),
    array['23514'],
    'p9_gate_policy_versions_source_type_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    27,
    'invalid policy rule item_kind fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_item_kind', 1,
          'stage', 'quote', 'always', 'required', 'bad_item_kind'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_item_kind_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    28,
    'policy rule item_key with invalid syntax fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_item_key', 1,
          'commercial_gate', 'Quote Required', 'always', 'required', 'bad_item_key'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_item_key_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    29,
    'invalid policy rule match_mode fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_match_mode', 1,
          'commercial_gate', 'payment', 'sale_type', 'required', 'bad_match_mode'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_match_mode_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    30,
    'always policy rule cannot carry component/execution selectors',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode, component_kind,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_always_shape', 1,
          'commercial_gate', 'payment', 'always', 'pool',
          'required', 'bad_always_shape'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_match_shape_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    31,
    'component policy rule requires component_kind',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_component_shape', 1,
          'technical_requirement', 'compatibility_confirmation', 'component',
          'required', 'bad_component_shape'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_match_shape_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    32,
    'invalid component_kind in policy rule fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode, component_kind,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_component_kind', 1,
          'technical_requirement', 'compatibility_confirmation', 'component', 'bundle',
          'required', 'bad_component_kind'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_component_kind_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    33,
    'invalid execution_kind in policy rule fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode, execution_kind,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_execution_kind', 1,
          'commercial_gate', 'fulfillment', 'execution', 'maintenance',
          'required', 'bad_execution_kind'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_execution_kind_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    34,
    'policy rule cannot emit conflict directly',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_policy_conflict', 1,
          'commercial_gate', 'payment', 'always', 'conflict', 'bad_policy_conflict'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_applicability_state_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    35,
    'negative policy rule priority fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'bad_priority', -1,
          'commercial_gate', 'payment', 'always', 'required', 'bad_priority'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23514'],
    'p9_gate_policy_rules_priority_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    36,
    'duplicate rule_key in same policy version fails',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_rules (
          organization_id, store_id, policy_version_id, rule_key,
          rule_priority, item_kind, item_key, match_mode,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'default_quote_required', 99,
          'commercial_gate', 'quote', 'always', 'optional', 'duplicate_rule_key'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.policy_v2
    ),
    array['23505'],
    'p9_gate_policy_rules_version_rule_key_uidx'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    37,
    'gate policy current cannot point to another store policy version',
    format(
      $sql$
        insert into public.store_opportunity_gate_policy_current (
          organization_id, store_id, current_policy_version_id, last_operation_key
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 'p9_gate_policy_fixture:v2'
        )
      $sql$,
      ctx.org_a,
      ctx.store_b_same_org,
      ctx.policy_v2
    ),
    array['23514'],
    null,
    'points to a version outside its scope'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    38,
    'gate policy current operation_key mismatch fails',
    format(
      $sql$
        update public.store_opportunity_gate_policy_current
        set last_operation_key = 'wrong_key'
        where organization_id = %L::uuid
          and store_id = %L::uuid
      $sql$,
      ctx.org_a,
      ctx.store_a
    ),
    array['23514'],
    null,
    'operation_key does not match current version'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    39,
    'gate policy current identity cannot move stores',
    format(
      $sql$
        update public.store_opportunity_gate_policy_current
        set store_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
      $sql$,
      ctx.store_b_same_org,
      ctx.org_a,
      ctx.store_a
    ),
    array['P0001'],
    null,
    'current identity is immutable'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    40,
    'gate policy versions are append-only',
    format(
      $sql$
        update public.store_opportunity_gate_policy_versions
        set reason_code = 'changed_reason'
        where id = %L::uuid
      $sql$,
      ctx.policy_v1
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    41,
    'gate policy rules are append-only',
    format(
      $sql$
        delete from public.store_opportunity_gate_policy_rules
        where policy_version_id = %L::uuid
          and rule_key = 'default_quote_required'
      $sql$,
      ctx.policy_v2
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    42,
    'checklist cannot use profile version from another opportunity',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_version_id, gate_policy_version_id, checklist_state,
          settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, 'resolved', '{}'::jsonb, %L,
          'bad_profile_scope', %L, 'system', 'manual_check',
          'bad_profile_scope', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_peer,
      ctx.policy_v2,
      repeat('1', 64),
      repeat('2', 64)
    ),
    array['23503'],
    'p9_checklist_versions_profile_scope_fk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    43,
    'checklist cannot use gate policy version from another store',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_version_id, gate_policy_version_id, checklist_state,
          settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, 'resolved', '{}'::jsonb, %L,
          'bad_policy_scope', %L, 'system', 'manual_check',
          'bad_policy_scope', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_a,
      ctx.policy_store_b,
      repeat('3', 64),
      repeat('4', 64)
    ),
    array['23503'],
    'p9_checklist_versions_gate_policy_scope_fk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    44,
    'checklist previous version cross-opportunity fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          previous_checklist_version_id, profile_version_id, gate_policy_version_id,
          checklist_state, settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 2,
          %L::uuid, %L::uuid, %L::uuid,
          'resolved', '{}'::jsonb, %L, 'bad_previous_checklist_scope',
          %L, 'system', 'manual_check', 'bad_previous_checklist_scope',
          'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_peer,
      ctx.checklist_v1,
      ctx.profile_peer,
      ctx.policy_v2,
      repeat('5', 64),
      repeat('6', 64)
    ),
    array['23503'],
    'p9_checklist_versions_previous_scope_fk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    45,
    'checklist branching from same previous version fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          previous_checklist_version_id, profile_version_id, gate_policy_version_id,
          checklist_state, settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, %L::uuid,
          'resolved', '{}'::jsonb, %L, 'branch_from_checklist_v1',
          %L, 'system', 'manual_check', 'branch_from_checklist_v1',
          'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.profile_a,
      ctx.policy_v2,
      repeat('7', 64),
      repeat('8', 64)
    ),
    array['23505'],
    'p9_checklist_versions_previous_once_uidx'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    46,
    'invalid checklist_state fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_version_id, gate_policy_version_id, checklist_state,
          settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, 'ready', '{}'::jsonb, %L,
          'bad_checklist_state', %L, 'system', 'manual_check',
          'bad_checklist_state', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_a,
      ctx.policy_v2,
      repeat('9', 64),
      repeat('a', 64)
    ),
    array['23514'],
    'p9_checklist_versions_state_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    47,
    'checklist settings_snapshot must be an object',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_version_id, gate_policy_version_id, checklist_state,
          settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, 'resolved', '[]'::jsonb, %L,
          'bad_settings_snapshot', %L, 'system', 'manual_check',
          'bad_settings_snapshot', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_a,
      ctx.policy_v2,
      repeat('b', 64),
      repeat('c', 64)
    ),
    array['23514'],
    'p9_checklist_versions_settings_snapshot_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    48,
    'checklist settings_fingerprint must be lowercase SHA-256 hex',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_version_id, gate_policy_version_id, checklist_state,
          settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, 'resolved', '{}'::jsonb, %L,
          'bad_settings_fingerprint', %L, 'system', 'manual_check',
          'bad_settings_fingerprint', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_a,
      ctx.policy_v2,
      repeat('A', 64),
      repeat('d', 64)
    ),
    array['23514'],
    'p9_checklist_versions_settings_fingerprint_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    49,
    'checklist human actor without actor_user_id fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_version_id, gate_policy_version_id, checklist_state,
          settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, source_type, reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, 'resolved', '{}'::jsonb, %L,
          'bad_human_checklist_actor', %L, 'human', 'manual_check',
          'bad_human_checklist_actor', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_a,
      ctx.policy_v2,
      repeat('e', 64),
      repeat('f', 64)
    ),
    array['23514'],
    'p9_checklist_versions_actor_user_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    50,
    'checklist system actor with actor_user_id fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_versions (
          organization_id, store_id, commercial_opportunity_id, version_number,
          profile_version_id, gate_policy_version_id, checklist_state,
          settings_snapshot, settings_fingerprint, operation_key,
          request_fingerprint, actor_type, actor_user_id, source_type,
          reason_code, created_by
        ) values (
          %L::uuid, %L::uuid, %L::uuid, 3,
          %L::uuid, %L::uuid, 'resolved', '{}'::jsonb, %L,
          'bad_system_checklist_actor', %L, 'system', %L::uuid, 'manual_check',
          'bad_system_checklist_actor', 'p9_policy_checklist_manual_check'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.profile_a,
      ctx.policy_v2,
      repeat('0', 64),
      repeat('1', 64),
      ctx.user_a
    ),
    array['23514'],
    'p9_checklist_versions_actor_user_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    51,
    'invalid checklist item_kind fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_items (
          organization_id, store_id, commercial_opportunity_id,
          checklist_version_id, item_key, item_kind,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'bad_item_kind', 'stage', 'required', 'bad_item_kind'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v2
    ),
    array['23514'],
    'p9_checklist_items_item_kind_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    52,
    'checklist item_key with invalid syntax fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_items (
          organization_id, store_id, commercial_opportunity_id,
          checklist_version_id, item_key, item_kind,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'Compatibility Confirmation', 'technical_requirement',
          'required', 'bad_item_key'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v2
    ),
    array['23514'],
    'p9_checklist_items_item_key_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    53,
    'invalid checklist item applicability_state fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_items (
          organization_id, store_id, commercial_opportunity_id,
          checklist_version_id, item_key, item_kind,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'compatibility_confirmation', 'technical_requirement',
          'conditional', 'bad_item_state'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v2
    ),
    array['23514'],
    'p9_checklist_items_applicability_state_chk'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    54,
    'duplicate item_key in same checklist version fails',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_items (
          organization_id, store_id, commercial_opportunity_id,
          checklist_version_id, item_key, item_kind,
          applicability_state, reason_code
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'quote', 'commercial_gate', 'optional', 'duplicate_item_key'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v2
    ),
    array['23505'],
    'p9_checklist_items_version_item_key_uidx'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    55,
    'checklist current cannot point to another opportunity version',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_current (
          organization_id, store_id, commercial_opportunity_id,
          current_checklist_version_id, last_operation_key
        ) values (
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'p9_checklist_fixture:v2'
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_peer,
      ctx.checklist_v2
    ),
    array['23514'],
    null,
    'points to a version outside its scope'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    56,
    'checklist current operation_key mismatch fails',
    format(
      $sql$
        update public.commercial_opportunity_checklist_current
        set last_operation_key = 'wrong_key'
        where organization_id = %L::uuid
          and store_id = %L::uuid
          and commercial_opportunity_id = %L::uuid
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a
    ),
    array['23514'],
    null,
    'operation_key does not match current version'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    57,
    'checklist current identity cannot move opportunities',
    format(
      $sql$
        update public.commercial_opportunity_checklist_current
        set commercial_opportunity_id = %L::uuid
        where organization_id = %L::uuid
          and store_id = %L::uuid
          and commercial_opportunity_id = %L::uuid
      $sql$,
      ctx.opp_peer,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a
    ),
    array['P0001'],
    null,
    'current identity is immutable'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    58,
    'checklist versions are append-only',
    format(
      $sql$
        update public.commercial_opportunity_checklist_versions
        set checklist_state = 'conflict'
        where id = %L::uuid
      $sql$,
      ctx.checklist_v1
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    59,
    'checklist items are append-only',
    format(
      $sql$
        delete from public.commercial_opportunity_checklist_items
        where checklist_version_id = %L::uuid
          and item_key = 'quote'
      $sql$,
      ctx.checklist_v2
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    60,
    'override event base and result versions must differ',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'measurements_confirmation', 'technical_requirement',
          'needs_resolution', 'required', 'bad_same_version',
          'The same checklist version cannot be both base and result.',
          %L::uuid, 'bad_same_version', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.checklist_v1,
      ctx.user_a,
      repeat('2', 64)
    ),
    array['P0001'],
    null,
    'must be the direct child of base version'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    61,
    'override event must change applicability state',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'measurements_confirmation', 'technical_requirement',
          'needs_resolution', 'needs_resolution', 'bad_same_state',
          'Override must actually change the item applicability state.',
          %L::uuid, 'p9_checklist_fixture:v2', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.checklist_v2,
      ctx.user_a,
      repeat('3', 64)
    ),
    array['P0001'],
    null,
    'to state does not match result item'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    62,
    'override event requires an existing base item',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'compatibility_confirmation', 'technical_requirement',
          'needs_resolution', 'required', 'missing_base_item',
          'Base item is intentionally missing for this negative scenario.',
          %L::uuid, 'p9_checklist_fixture:v2', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.checklist_v2,
      ctx.user_a,
      repeat('4', 64)
    ),
    array['P0001'],
    null,
    'base item does not exist'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    63,
    'override from state must match base item',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'measurements_confirmation', 'technical_requirement',
          'optional', 'required', 'bad_from_state',
          'Declared from state intentionally differs from the base item.',
          %L::uuid, 'p9_checklist_fixture:v2', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.checklist_v2,
      ctx.user_a,
      repeat('5', 64)
    ),
    array['P0001'],
    null,
    'from state does not match base item'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    64,
    'override to state must match result item',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'measurements_confirmation', 'technical_requirement',
          'needs_resolution', 'optional', 'bad_to_state',
          'Declared to state intentionally differs from the result item.',
          %L::uuid, 'p9_checklist_fixture:v2', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.checklist_v2,
      ctx.user_a,
      repeat('6', 64)
    ),
    array['P0001'],
    null,
    'to state does not match result item'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    65,
    'override result version must be direct child of base version',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'measurements_confirmation', 'technical_requirement',
          'required', 'needs_resolution', 'bad_lineage_direction',
          'Result version intentionally points backward instead of being a child.',
          %L::uuid, 'p9_checklist_fixture:v1', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v2,
      ctx.checklist_v1,
      ctx.user_a,
      repeat('7', 64)
    ),
    array['P0001'],
    null,
    'must be the direct child of base version'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    66,
    'override result version must use same human actor',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'measurements_confirmation', 'technical_requirement',
          'needs_resolution', 'required', 'bad_override_actor',
          'Actor intentionally differs from the result checklist version actor.',
          %L::uuid, 'p9_checklist_fixture:v2', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.checklist_v2,
      ctx.user_b,
      repeat('8', 64)
    ),
    array['P0001'],
    null,
    'same human actor'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    67,
    'override operation_key must match result checklist version',
    format(
      $sql$
        insert into public.commercial_opportunity_checklist_override_events (
          organization_id, store_id, commercial_opportunity_id,
          base_checklist_version_id, result_checklist_version_id,
          item_key, item_kind, from_applicability_state, to_applicability_state,
          reason_code, reason_text, actor_user_id, operation_key, request_fingerprint
        ) values (
          %L::uuid, %L::uuid, %L::uuid,
          %L::uuid, %L::uuid,
          'measurements_confirmation', 'technical_requirement',
          'needs_resolution', 'required', 'bad_override_operation_key',
          'Operation key intentionally differs from the result checklist version.',
          %L::uuid, 'different_operation_key', %L
        )
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      ctx.checklist_v1,
      ctx.checklist_v2,
      ctx.user_a,
      repeat('9', 64)
    ),
    array['P0001'],
    null,
    'operation_key must match result version'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    68,
    'override events are append-only on UPDATE',
    format(
      $sql$
        update public.commercial_opportunity_checklist_override_events
        set reason_text = 'Changed reason text should be blocked.'
        where organization_id = %L::uuid
          and store_id = %L::uuid
          and commercial_opportunity_id = %L::uuid
          and operation_key = 'p9_checklist_fixture:v2'
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a
    ),
    array['P0001'],
    null,
    'is append-only'
  );

  perform pg_temp._p9_policy_checklist_expect_fail(
    69,
    'override events are append-only on DELETE',
    format(
      $sql$
        delete from public.commercial_opportunity_checklist_override_events
        where organization_id = %L::uuid
          and store_id = %L::uuid
          and commercial_opportunity_id = %L::uuid
          and operation_key = 'p9_checklist_fixture:v2'
      $sql$,
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a
    ),
    array['P0001'],
    null,
    'is append-only'
  );
end;
$behavior_checks$;

-- ============================================================================
-- RLS behavior: 80-82.
-- ============================================================================

do $rls_checks$
declare
  ctx pg_temp._p9_policy_checklist_ctx%rowtype;
  v_policy_versions integer;
  v_policy_rules integer;
  v_policy_current integer;
  v_checklist_versions integer;
  v_checklist_items integer;
  v_checklist_current integer;
  v_override_events integer;
begin
  select * into ctx from pg_temp._p9_policy_checklist_ctx;

  perform set_config('request.jwt.claim.sub', ctx.user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', ctx.user_a::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*) into v_policy_versions
  from public.store_opportunity_gate_policy_versions
  where organization_id = ctx.org_a;

  select count(*) into v_policy_rules
  from public.store_opportunity_gate_policy_rules
  where organization_id = ctx.org_a;

  select count(*) into v_policy_current
  from public.store_opportunity_gate_policy_current
  where organization_id = ctx.org_a;

  select count(*) into v_checklist_versions
  from public.commercial_opportunity_checklist_versions
  where organization_id = ctx.org_a;

  select count(*) into v_checklist_items
  from public.commercial_opportunity_checklist_items
  where organization_id = ctx.org_a;

  select count(*) into v_checklist_current
  from public.commercial_opportunity_checklist_current
  where organization_id = ctx.org_a;

  select count(*) into v_override_events
  from public.commercial_opportunity_checklist_override_events
  where organization_id = ctx.org_a;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_policy_checklist_expect(
    80,
    'authenticated active member can SELECT own gate policy/checklist rows through RLS',
    v_policy_versions = 3
    and v_policy_rules = 4
    and v_policy_current = 1
    and v_checklist_versions = 2
    and v_checklist_items = 4
    and v_checklist_current = 1
    and v_override_events = 1,
    pg_catalog.format(
      'policy_versions=%s policy_rules=%s policy_current=%s checklist_versions=%s checklist_items=%s checklist_current=%s override_events=%s',
      v_policy_versions,
      v_policy_rules,
      v_policy_current,
      v_checklist_versions,
      v_checklist_items,
      v_checklist_current,
      v_override_events
    )
  );

  perform set_config('request.jwt.claim.sub', ctx.user_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', ctx.user_b::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*) into v_policy_versions
  from public.store_opportunity_gate_policy_versions
  where organization_id = ctx.org_a;

  select count(*) into v_checklist_versions
  from public.commercial_opportunity_checklist_versions
  where organization_id = ctx.org_a;

  select count(*) into v_override_events
  from public.commercial_opportunity_checklist_override_events
  where organization_id = ctx.org_a;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_policy_checklist_expect(
    81,
    'authenticated active member from another organization cannot SELECT org A gate policy/checklist rows',
    v_policy_versions = 0
    and v_checklist_versions = 0
    and v_override_events = 0,
    pg_catalog.format(
      'policy_versions=%s checklist_versions=%s override_events=%s',
      v_policy_versions,
      v_checklist_versions,
      v_override_events
    )
  );

  perform set_config('request.jwt.claim.sub', ctx.user_inactive_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', ctx.user_inactive_a::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*) into v_policy_versions
  from public.store_opportunity_gate_policy_versions
  where organization_id = ctx.org_a;

  select count(*) into v_checklist_versions
  from public.commercial_opportunity_checklist_versions
  where organization_id = ctx.org_a;

  select count(*) into v_override_events
  from public.commercial_opportunity_checklist_override_events
  where organization_id = ctx.org_a;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_policy_checklist_expect(
    82,
    'authenticated inactive member cannot SELECT gate policy/checklist rows through RLS',
    v_policy_versions = 0
    and v_checklist_versions = 0
    and v_override_events = 0,
    pg_catalog.format(
      'policy_versions=%s checklist_versions=%s override_events=%s',
      v_policy_versions,
      v_checklist_versions,
      v_override_events
    )
  );
exception
  when others then
    begin
      execute 'reset role';
    exception when others then null;
    end;

    perform pg_temp._p9_policy_checklist_record(
      80,
      'RLS checks',
      'HARNESS_ERROR',
      sqlstate || ': ' || sqlerrm
    );
end;
$rls_checks$;

-- ============================================================================
-- Summary. Missing scenarios are a harness failure; any SUT_FAIL/HARNESS_ERROR
-- raises an exception. PASS ends with NOTICE + rollback, so Supabase may show
-- "Success. No rows returned" while the transaction is fully rolled back.
-- ============================================================================

do $summary$
declare
  v_failed_count integer;
  v_missing_scenarios text;
  v_summary jsonb;
begin
  select pg_catalog.string_agg(expected.scenario_number::text, ',' order by expected.scenario_number)
  into v_missing_scenarios
  from (
    select pg_catalog.generate_series(1, 18) as scenario_number
    union all
    select pg_catalog.generate_series(20, 69)
    union all
    select pg_catalog.generate_series(80, 82)
  ) expected
  where not exists (
    select 1
    from pg_temp._p9_policy_checklist_results result_row
    where result_row.scenario_number = expected.scenario_number
  );

  if v_missing_scenarios is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 gate policy/checklist foundation manual checks harness is incomplete',
      detail = 'missing scenarios: ' || v_missing_scenarios;
  end if;

  select count(*)
  into v_failed_count
  from pg_temp._p9_policy_checklist_results
  where status <> 'PASS';

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'scenario_number', scenario_number,
      'scenario_name', scenario_name,
      'status', status,
      'detail', detail
    )
    order by scenario_number
  )
  into v_summary
  from pg_temp._p9_policy_checklist_results;

  if v_failed_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9 gate policy/checklist foundation manual checks failed',
      detail = v_summary::text;
  end if;

  raise notice 'P9 gate policy/checklist foundation manual checks passed: %', v_summary::text;
end;
$summary$;

rollback;
