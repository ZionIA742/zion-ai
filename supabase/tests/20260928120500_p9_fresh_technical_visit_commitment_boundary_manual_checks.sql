begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:7.2:fresh-technical-visit-boundary:manual-checks:v2', 0)
);

-- ============================================================================
-- P9 / Bloco 7 / Etapa 7.2
-- ROLLBACK-ONLY behavioral gate for the fresh technical_visit commitment
-- boundary. The runner uses an isolated opportunity set inside an existing DEV
-- tenant, mutates Settings only inside this transaction, and rolls everything
-- back at the end.
-- ============================================================================

create temporary table p9_72_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'FAIL')),
  detail text not null
) on commit drop;

create temporary table p9_72_context (
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  user_id uuid not null,
  pool_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  ready_opportunity_id uuid not null,
  peer_opportunity_id uuid not null,
  needs_opportunity_id uuid not null,
  conflict_opportunity_id uuid not null
) on commit drop;

create or replace function pg_temp.p9_72_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $function$
begin
  if not coalesce(p_condition, false) then
    raise exception using errcode = 'P0001', message = p_message;
  end if;
end;
$function$;

create or replace function pg_temp.p9_72_policy(
  p_required text[],
  p_optional text[]
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'required_situations', to_jsonb(coalesce(p_required, '{}'::text[])),
    'required_other', null,
    'optional_situations', to_jsonb(coalesce(p_optional, '{}'::text[])),
    'optional_other', null,
    'team_mode', 'dono_loja',
    'team_rule', null,
    'requires_appointment', true,
    'duration_mode', '60',
    'duration_minutes', 60,
    'duration_rule', null,
    'preconfirm_items', '["endereco"]'::jsonb,
    'preconfirm_other', null,
    'notes', null
  );
$function$;

create or replace function pg_temp.p9_72_set_technical_policy(
  p_policy jsonb,
  p_legacy_mirror boolean
)
returns void
language plpgsql
as $function$
declare
  v_context pg_temp.p9_72_context%rowtype;
begin
  select * into v_context from pg_temp.p9_72_context limit 1;

  insert into public.store_operation_settings (
    organization_id,
    store_id,
    offers_installation,
    offers_technical_visit
  )
  values (
    v_context.organization_id,
    v_context.store_id,
    true,
    p_legacy_mirror
  )
  on conflict (organization_id, store_id)
  do update set
    offers_installation = true,
    offers_technical_visit = excluded.offers_technical_visit;

  delete from public.store_operation_execution_policies
  where organization_id = v_context.organization_id
    and store_id = v_context.store_id;

  insert into public.store_operation_execution_policies (
    organization_id,
    store_id,
    technical_visit_policy,
    technical_visit_configured_at,
    created_at,
    updated_at
  )
  values (
    v_context.organization_id,
    v_context.store_id,
    p_policy,
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now()),
    pg_catalog.timezone('utc', pg_catalog.now())
  );
end;
$function$;

create or replace function pg_temp.p9_72_write_gate_policy()
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_72_context%rowtype;
  v_rules jsonb;
  v_result record;
begin
  select * into v_context from pg_temp.p9_72_context limit 1;

  v_rules := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key', 'qualification.always.required',
      'rule_priority', 10,
      'item_kind', 'commercial_gate',
      'item_key', 'qualification',
      'match_mode', 'always',
      'component_kind', null,
      'execution_kind', null,
      'applicability_state', 'required',
      'reason_code', 'commercial_opportunity_requires_qualification',
      'metadata', '{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'quote.pool.required',
      'rule_priority', 20,
      'item_kind', 'commercial_gate',
      'item_key', 'quote',
      'match_mode', 'component',
      'component_kind', 'pool',
      'execution_kind', null,
      'applicability_state', 'required',
      'reason_code', 'pool_sale_requires_quote',
      'metadata', '{}'::jsonb
    )
  );

  select *
  into v_result
  from public.write_store_opportunity_gate_policy_internal(
    v_context.organization_id,
    v_context.store_id,
    'p9:7.2:runner:gate:' || pg_catalog.clock_timestamp()::text,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_rules::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    v_rules,
    'system',
    null,
    'manual_check_runner',
    'p9_72_runner_gate_policy',
    'p9_72_runner',
    '{"runner":true}'::jsonb
  );

  return v_result.policy_version_id;
end;
$function$;

create or replace function pg_temp.p9_72_write_profile(
  p_opportunity_id uuid
)
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_72_context%rowtype;
  v_components jsonb;
  v_payload text;
  v_result record;
begin
  select * into v_context from pg_temp.p9_72_context limit 1;

  v_components := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'component_key', 'p9_72_runner_pool',
      'component_kind', 'pool',
      'component_state', 'resolved',
      'pool_id', v_context.pool_id,
      'catalog_item_id', null,
      'reference_text', 'P9 7.2 runner pool',
      'metadata', '{"runner":true}'::jsonb
    )
  );
  v_payload := v_components::text || ':[]';

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select *
  into v_result
  from public.write_commercial_opportunity_profile_by_system(
    v_context.organization_id,
    v_context.store_id,
    p_opportunity_id,
    'p9:7.2:runner:profile:' || p_opportunity_id::text,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_payload, 'UTF8'), 'sha256'),
      'hex'
    ),
    'resolved',
    v_components,
    '[]'::jsonb,
    'manual_check_runner',
    'p9_72_runner_profile',
    'p9_72_runner',
    '{"runner":true}'::jsonb
  );

  execute 'reset role';
  return v_result.profile_version_id;
end;
$function$;

create or replace function pg_temp.p9_72_materialize_checklist(
  p_opportunity_id uuid,
  p_event_key text
)
returns table (
  current_checklist_version_id uuid,
  checklist_state text
)
language plpgsql
as $function$
declare
  v_context pg_temp.p9_72_context%rowtype;
begin
  select * into v_context from pg_temp.p9_72_context limit 1;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  return query
  select
    result.current_checklist_version_id,
    result.checklist_state
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_context.organization_id,
    v_context.store_id,
    p_opportunity_id,
    p_event_key
  ) result;

  execute 'reset role';
end;
$function$;

create or replace function pg_temp.p9_72_override_technical_required(
  p_opportunity_id uuid,
  p_expected_version_id uuid
)
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_72_context%rowtype;
  v_result record;
  v_key text := 'p9:7.2:runner:human-override:' || p_opportunity_id::text;
begin
  select * into v_context from pg_temp.p9_72_context limit 1;

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_context.user_id::text, true);

  select *
  into v_result
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_context.organization_id,
    v_context.store_id,
    p_opportunity_id,
    p_expected_version_id,
    v_key,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_key || ':required', 'UTF8'), 'sha256'),
      'hex'
    ),
    'technical_visit',
    'commercial_gate',
    'required',
    'p9_72_runner_required',
    'P9 7.2 runner explicit human authority',
    '{"runner":true}'::jsonb
  );

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  return v_result.result_checklist_version_id;
end;
$function$;

create or replace function pg_temp.p9_72_find_available_start(
  p_appointment_type text,
  p_ignore_appointment_id uuid default null,
  p_after timestamptz default null
)
returns timestamptz
language plpgsql
as $function$
declare
  v_context pg_temp.p9_72_context%rowtype;
  v_candidate timestamptz;
  v_available boolean;
  v_reason text;
  v_i integer;
begin
  select * into v_context from pg_temp.p9_72_context limit 1;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  for v_i in 0..1439 loop
    v_candidate :=
      pg_catalog.date_trunc(
        'hour',
        coalesce(p_after, pg_catalog.clock_timestamp() + interval '2 days')
      ) + (v_i::text || ' hours')::interval;

    select availability_row.available, availability_row.reason_code
    into v_available, v_reason
    from public.check_store_appointment_availability_by_system(
      v_context.organization_id,
      v_context.store_id,
      p_appointment_type,
      v_candidate,
      v_candidate + interval '1 hour',
      p_ignore_appointment_id
    ) availability_row;

    if v_available is true then
      execute 'reset role';
      return v_candidate;
    end if;
  end loop;

  execute 'reset role';
  raise exception using
    errcode = 'P0001',
    message = 'FIXTURE_FAIL: no canonical available slot found for ' || p_appointment_type;
end;
$function$;

do $preflight$
declare
  v_definition text;
  v_trigger_definition text;
  v_legacy_missing_anchor_count integer := 0;
begin
  if pg_catalog.to_regprocedure(
       'public.create_technical_visit_with_fresh_commercial_readiness_by_system(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid,text)'
     ) is null then
    raise exception 'SUT_FAIL: fresh technical_visit boundary is missing';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.create_technical_visit_with_fresh_commercial_readiness_by_system(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid,text)'::regprocedure
  );

  perform pg_temp.p9_72_assert(
    v_definition like '%materialize_commercial_opportunity_checklist_by_system%'
    and v_definition like '%materialize_commercial_opportunity_checklist_progress_by_system%'
    and v_definition like '%read_commercial_action_readiness_scoped%'
    and v_definition like '%extensions.digest%'
    and v_definition like '%ZION_TECHNICAL_VISIT_NEW_COMMITMENT_STATUS_MUST_BE_SCHEDULED%',
    'SUT_FAIL: boundary freshness/hash/status contract mismatch'
  );

  perform pg_temp.p9_72_assert(
    not has_table_privilege('authenticated', 'public.store_appointments', 'INSERT')
    and not has_table_privilege('authenticated', 'public.store_appointments', 'UPDATE')
    and not has_table_privilege('service_role', 'public.store_appointments', 'INSERT')
    and not has_table_privilege('service_role', 'public.store_appointments', 'UPDATE'),
    'SUT_FAIL: direct INSERT/UPDATE privilege remains on store_appointments'
  );

  perform pg_temp.p9_72_assert(
    has_function_privilege(
      'service_role',
      'public.create_technical_visit_with_fresh_commercial_readiness_by_system(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.create_technical_visit_with_fresh_commercial_readiness_by_system(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid,text)',
      'EXECUTE'
    ),
    'SUT_FAIL: fresh boundary grants mismatch'
  );

  perform pg_temp.p9_72_assert(
    has_function_privilege(
      'service_role',
      'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)',
      'EXECUTE'
    ),
    'SUT_FAIL: Checklist/Progress materializer grants mismatch'
  );

  select pg_catalog.pg_get_triggerdef(trigger_row.oid)
  into v_trigger_definition
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class class_row on class_row.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace_row on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname = 'store_appointments'
    and trigger_row.tgname = 'store_appointments_guard_technical_visit_commitment'
    and not trigger_row.tgisinternal;

  perform pg_temp.p9_72_assert(
    v_trigger_definition is not null
    and v_trigger_definition like '%organization_id%'
    and v_trigger_definition like '%store_id%'
    and v_trigger_definition like '%appointment_type%'
    and v_trigger_definition like '%commercial_opportunity_id%'
    and v_trigger_definition like '%commercial_opportunity_lifecycle_cycle%',
    'SUT_FAIL: structural trigger column coverage mismatch'
  );

  perform pg_temp.p9_72_assert(
    pg_catalog.pg_get_functiondef(
      'public.p9_store_appointment_guard_technical_visit_internal()'::regprocedure
    ) not like '%materialize_commercial_opportunity_checklist%'
    and pg_catalog.pg_get_functiondef(
      'public.p9_store_appointment_guard_technical_visit_internal()'::regprocedure
    ) not like '%read_commercial_action_readiness_scoped%',
    'SUT_FAIL: structural trigger must not own readiness'
  );

  perform pg_temp.p9_72_assert(
    pg_catalog.pg_get_functiondef(
      'public.p9_store_appointment_guard_technical_visit_internal()'::regprocedure
    ) like '%old.commercial_opportunity_id is null%'
    and pg_catalog.pg_get_functiondef(
      'public.p9_store_appointment_guard_technical_visit_internal()'::regprocedure
    ) like '%new.commercial_opportunity_id is not distinct from old.commercial_opportunity_id%',
    'SUT_FAIL: legacy missing-anchor grandfather branch is missing'
  );

  if exists (
    select 1
    from public.store_appointments appointment_row
    left join public.commercial_opportunities opportunity_row
      on opportunity_row.id = appointment_row.commercial_opportunity_id
    where appointment_row.appointment_type = 'technical_visit'
      and appointment_row.commercial_opportunity_id is not null
      and appointment_row.commercial_opportunity_lifecycle_cycle is not null
      and (
        opportunity_row.id is null
        or opportunity_row.organization_id is distinct from appointment_row.organization_id
        or opportunity_row.store_id is distinct from appointment_row.store_id
        or opportunity_row.lifecycle_cycle is distinct from appointment_row.commercial_opportunity_lifecycle_cycle
        or (
          appointment_row.lead_id is not null
          and opportunity_row.origin_lead_id is distinct from appointment_row.lead_id
        )
        or (
          appointment_row.conversation_id is not null
          and opportunity_row.primary_conversation_id is distinct from appointment_row.conversation_id
        )
      )
  ) then
    raise exception 'FIXTURE_FAIL: complete legacy technical_visit anchor is contradictory/corrupt';
  end if;

  select pg_catalog.count(*)::integer
  into v_legacy_missing_anchor_count
  from public.store_appointments appointment_row
  where appointment_row.appointment_type = 'technical_visit'
    and (
      appointment_row.commercial_opportunity_id is null
      or appointment_row.commercial_opportunity_lifecycle_cycle is null
    );

  insert into pg_temp.p9_72_results
  values (
    1,
    'installed contract / grants / trigger',
    'PASS',
    pg_catalog.format(
      'static/privilege preflight passed; legacy missing-anchor rows grandfathered without mutation=%s',
      v_legacy_missing_anchor_count
    )
  );
end;
$preflight$;

do $runner$
declare
  c pg_temp.p9_72_context%rowtype;
  v_checklist record;
  v_readiness record;
  v_ready_version_id uuid;
  v_technical_start timestamptz;
  v_reschedule_start timestamptz;
  v_meeting_start timestamptz;
  v_invalid_direct_start timestamptz;
  v_created public.store_appointments;
  v_updated public.store_appointments;
  v_meeting public.store_appointments;
  v_failed boolean;
  v_error text;
  v_count integer;
begin
  -- Existing tenant shell only. All business fixtures below are fresh and rolled back.
  insert into pg_temp.p9_72_context (
    organization_id,
    store_id,
    customer_id,
    user_id,
    pool_id,
    lead_id,
    conversation_id,
    ready_opportunity_id,
    peer_opportunity_id,
    needs_opportunity_id,
    conflict_opportunity_id
  )
  select
    store_row.organization_id,
    store_row.id,
    customer_row.id,
    membership_row.user_id,
    pool_row.id,
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid()
  from public.stores store_row
  join public.customers customer_row
    on customer_row.organization_id = store_row.organization_id
  join public.memberships membership_row
    on membership_row.organization_id = store_row.organization_id
   and membership_row.is_active is true
  join public.pools pool_row
    on pool_row.organization_id = store_row.organization_id
   and pool_row.store_id = store_row.id
  join auth.users user_row
    on user_row.id = membership_row.user_id
  join public.store_schedule_settings schedule_row
    on schedule_row.organization_id = store_row.organization_id
   and schedule_row.store_id = store_row.id
  order by store_row.organization_id, store_row.id, customer_row.id, membership_row.user_id
  limit 1;

  perform pg_temp.p9_72_assert(
    exists (select 1 from pg_temp.p9_72_context),
    'FIXTURE_FAIL: no store/customer/active auth-backed member/pool/schedule settings available'
  );

  select * into c from pg_temp.p9_72_context limit 1;

  insert into public.leads (
    id, organization_id, store_id, state, created_at, updated_at
  )
  values (
    c.lead_id, c.organization_id, c.store_id, 'negociacao',
    pg_catalog.now(), pg_catalog.now()
  );

  insert into public.conversations (
    id, organization_id, lead_id, status, is_human_active, created_at
  )
  values (
    c.conversation_id, c.organization_id, c.lead_id, 'open', false, pg_catalog.now()
  );

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id,
    origin_lead_id, primary_conversation_id, stage
  )
  values
    (c.ready_opportunity_id, c.organization_id, c.store_id, c.customer_id, c.lead_id, c.conversation_id, 'qualificacao'),
    (c.peer_opportunity_id, c.organization_id, c.store_id, c.customer_id, c.lead_id, c.conversation_id, 'qualificacao'),
    (c.needs_opportunity_id, c.organization_id, c.store_id, c.customer_id, c.lead_id, c.conversation_id, 'qualificacao'),
    (c.conflict_opportunity_id, c.organization_id, c.store_id, c.customer_id, c.lead_id, c.conversation_id, 'qualificacao');

  delete from public.store_contract_settings
  where organization_id = c.organization_id
    and store_id = c.store_id;

  insert into public.store_contract_settings (
    organization_id, store_id, contract_enabled
  )
  values (c.organization_id, c.store_id, true);

  perform pg_temp.p9_72_write_gate_policy();
  perform pg_temp.p9_72_write_profile(c.ready_opportunity_id);
  perform pg_temp.p9_72_write_profile(c.peer_opportunity_id);
  perform pg_temp.p9_72_write_profile(c.needs_opportunity_id);
  perform pg_temp.p9_72_write_profile(c.conflict_opportunity_id);

  -- Empty configured policy is canonical needs_resolution. The ready fixture is
  -- then resolved through the canonical human override authority.
  perform pg_temp.p9_72_set_technical_policy(
    pg_temp.p9_72_policy('{}'::text[], '{}'::text[]),
    true
  );

  select * into v_checklist
  from pg_temp.p9_72_materialize_checklist(
    c.ready_opportunity_id,
    'p9:7.2:runner:ready:baseline'
  );

  v_ready_version_id := pg_temp.p9_72_override_technical_required(
    c.ready_opportunity_id,
    v_checklist.current_checklist_version_id
  );

  perform pg_temp.p9_72_assert(
    v_ready_version_id is not null,
    'SUT_FAIL: canonical human override did not create a ready technical_visit authority'
  );

  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  -- 2. Generic base writer cannot manufacture technical_visit.
  v_failed := false;
  begin
    perform public.create_store_appointment(
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 forbidden generic visit', 'technical_visit', 'scheduled',
      pg_catalog.now() + interval '20 days',
      pg_catalog.now() + interval '20 days 1 hour',
      null, null, null, null, 'system', null
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_REQUIRES_FRESH_COMMERCIAL_BOUNDARY';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    2, 'generic create rejects technical_visit',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'generic create unexpectedly succeeded')
  );

  -- 3. Commercial wrapper cannot manufacture technical_visit.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_store_appointment_with_commercial_context(
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 forbidden commercial wrapper visit', 'technical_visit', 'scheduled',
      pg_catalog.now() + interval '21 days',
      pg_catalog.now() + interval '21 days 1 hour',
      null, null, null, null, 'system', null, c.ready_opportunity_id
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_REQUIRES_FRESH_COMMERCIAL_BOUNDARY';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    3, 'commercial wrapper rejects technical_visit',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'commercial wrapper unexpectedly succeeded')
  );

  -- 4. New commitment status is scheduled-only.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 forbidden cancelled creation', 'cancelled',
      pg_catalog.now() + interval '22 days',
      pg_catalog.now() + interval '22 days 1 hour',
      null, null, null, null, 'system', null,
      c.ready_opportunity_id, 'p9:7.2:runner:cancelled'
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_NEW_COMMITMENT_STATUS_MUST_BE_SCHEDULED';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    4, 'fresh boundary requires scheduled status',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'cancelled new commitment unexpectedly succeeded')
  );

  -- 5. Explicit opportunity is mandatory.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 null opportunity', 'scheduled',
      pg_catalog.now() + interval '23 days',
      pg_catalog.now() + interval '23 days 1 hour',
      null, null, null, null, 'system', null,
      null, 'p9:7.2:runner:null-opportunity'
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_BOUNDARY_ARGUMENTS_REQUIRED';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    5, 'fresh boundary requires explicit opportunity',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'null opportunity unexpectedly succeeded')
  );

  -- 6. Cross-tenant scope cannot be supplied.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      gen_random_uuid(), gen_random_uuid(), c.lead_id, c.conversation_id,
      'P9 7.2 wrong scope', 'scheduled',
      pg_catalog.now() + interval '24 days',
      pg_catalog.now() + interval '24 days 1 hour',
      null, null, null, null, 'system', null,
      c.ready_opportunity_id, 'p9:7.2:runner:wrong-scope'
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_BOUNDARY_OPPORTUNITY_SCOPE_NOT_FOUND';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    6, 'fresh boundary rejects wrong organization/store scope',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'wrong scope unexpectedly succeeded')
  );

  -- 7. Lead mismatch fails before materialization.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      c.organization_id, c.store_id, gen_random_uuid(), c.conversation_id,
      'P9 7.2 wrong lead', 'scheduled',
      pg_catalog.now() + interval '25 days',
      pg_catalog.now() + interval '25 days 1 hour',
      null, null, null, null, 'system', null,
      c.ready_opportunity_id, 'p9:7.2:runner:wrong-lead'
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_BOUNDARY_LEAD_MISMATCH';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    7, 'fresh boundary rejects lead mismatch',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'lead mismatch unexpectedly succeeded')
  );

  -- 8. Conversation mismatch fails before materialization.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      c.organization_id, c.store_id, c.lead_id, gen_random_uuid(),
      'P9 7.2 wrong conversation', 'scheduled',
      pg_catalog.now() + interval '26 days',
      pg_catalog.now() + interval '26 days 1 hour',
      null, null, null, null, 'system', null,
      c.ready_opportunity_id, 'p9:7.2:runner:wrong-conversation'
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_BOUNDARY_CONVERSATION_MISMATCH';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    8, 'fresh boundary rejects conversation mismatch',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'conversation mismatch unexpectedly succeeded')
  );

  -- 9. needs_resolution is a real fail-closed readiness state.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 needs resolution', 'scheduled',
      pg_catalog.now() + interval '27 days',
      pg_catalog.now() + interval '27 days 1 hour',
      null, null, null, null, 'system', null,
      c.needs_opportunity_id, 'p9:7.2:runner:needs-resolution'
    );
  exception when others then
    v_failed := sqlerrm like 'ZION_TECHNICAL_VISIT_READINESS_NOT_READY:needs_resolution:%';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    9, 'fresh boundary blocks needs_resolution',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'needs_resolution unexpectedly created an appointment')
  );

  -- 10. READY path: long external operation keys are hashed/bounded, and one of
  -- two opportunities on the same lead is selected only by explicit id.
  v_technical_start := pg_temp.p9_72_find_available_start('technical_visit');

  select *
  into strict v_created
  from public.create_technical_visit_with_fresh_commercial_readiness_by_system(
    c.organization_id,
    c.store_id,
    null,
    null,
    'P9 7.2 fresh boundary ready',
    'scheduled',
    v_technical_start,
    v_technical_start + interval '1 hour',
    null,
    null,
    null,
    'rollback-only P9 7.2 runner',
    'system',
    null,
    c.ready_opportunity_id,
    repeat('assistant-operation-key-', 30)
  );

  perform pg_temp.p9_72_assert(
    v_created.appointment_type = 'technical_visit'
    and v_created.commercial_opportunity_id = c.ready_opportunity_id
    and v_created.commercial_opportunity_lifecycle_cycle = (
      select opportunity_row.lifecycle_cycle
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = c.ready_opportunity_id
    )
    and v_created.lead_id = c.lead_id
    and v_created.conversation_id = c.conversation_id,
    'SUT_FAIL: ready boundary did not persist the exact canonical target'
  );

  select count(*)::integer
  into v_count
  from public.store_appointments appointment_row
  where appointment_row.commercial_opportunity_id = c.peer_opportunity_id;

  insert into pg_temp.p9_72_results values (
    10,
    'ready boundary commits exact opportunity and accepts long operation key',
    case when v_count = 0 then 'PASS' else 'FAIL' end,
    case when v_count = 0
      then 'exact ready opportunity committed; peer on same lead untouched'
      else 'peer opportunity received an appointment'
    end
  );

  -- 11. Once a real visit exists, fresh Progress makes a second creation blocked.
  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 duplicate real visit', 'scheduled',
      v_technical_start + interval '2 hours',
      v_technical_start + interval '3 hours',
      null, null, null, null, 'system', null,
      c.ready_opportunity_id, 'p9:7.2:runner:second-commit'
    );
  exception when others then
    v_failed := sqlerrm like 'ZION_TECHNICAL_VISIT_READINESS_NOT_READY:blocked:%';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    11, 'fresh Progress blocks a second active technical_visit',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'second commitment unexpectedly succeeded')
  );

  -- 12. Existing technical_visit can be rescheduled without creation readiness.
  v_reschedule_start := pg_temp.p9_72_find_available_start(
    'technical_visit',
    v_created.id,
    v_technical_start + interval '4 hours'
  );

  select *
  into strict v_updated
  from public.update_store_appointment(
    v_created.id,
    c.organization_id,
    c.store_id,
    v_created.title,
    'technical_visit',
    'rescheduled',
    v_reschedule_start,
    v_reschedule_start + interval '1 hour',
    v_created.customer_name,
    v_created.customer_phone,
    v_created.address_text,
    'P9 7.2 runner reschedule'
  );

  insert into pg_temp.p9_72_results values (
    12,
    'existing technical_visit reschedules without creation readiness',
    case
      when v_updated.id = v_created.id
       and v_updated.status = 'rescheduled'
       and v_updated.scheduled_start = v_reschedule_start
       and v_updated.commercial_opportunity_id = c.ready_opportunity_id
      then 'PASS' else 'FAIL'
    end,
    'reschedule kept the original commercial anchor'
  );

  -- 13. Non-technical generic create still works.
  v_meeting_start := pg_temp.p9_72_find_available_start(
    'meeting',
    null,
    v_reschedule_start + interval '4 hours'
  );

  select *
  into strict v_meeting
  from public.create_store_appointment(
    c.organization_id, c.store_id, c.lead_id, c.conversation_id,
    'P9 7.2 regression meeting', 'meeting', 'scheduled',
    v_meeting_start, v_meeting_start + interval '1 hour',
    null, null, null, 'rollback-only P9 7.2 runner', 'system', null
  );

  insert into pg_temp.p9_72_results values (
    13, 'non-technical generic writer remains functional',
    case when v_meeting.id is not null and v_meeting.appointment_type = 'meeting'
      then 'PASS' else 'FAIL' end,
    'meeting creation preserved'
  );

  -- 14. Generic updater rejects meeting -> technical_visit.
  v_failed := false;
  v_error := null;
  begin
    perform public.update_store_appointment(
      v_meeting.id, c.organization_id, c.store_id,
      v_meeting.title, 'technical_visit', 'scheduled',
      v_meeting.scheduled_start, v_meeting.scheduled_end,
      v_meeting.customer_name, v_meeting.customer_phone,
      v_meeting.address_text, v_meeting.notes
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_TYPE_IMMUTABLE';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    14, 'generic updater rejects meeting to technical_visit',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'meeting -> technical_visit unexpectedly succeeded')
  );

  -- 15. Generic updater rejects technical_visit -> meeting.
  v_failed := false;
  v_error := null;
  begin
    perform public.update_store_appointment(
      v_created.id, c.organization_id, c.store_id,
      v_created.title, 'meeting', 'rescheduled',
      v_reschedule_start, v_reschedule_start + interval '1 hour',
      v_created.customer_name, v_created.customer_phone,
      v_created.address_text, v_created.notes
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_TYPE_IMMUTABLE';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    15, 'generic updater rejects technical_visit to meeting',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'technical_visit -> meeting unexpectedly succeeded')
  );

  -- 16. Trigger itself rejects direct conversion, even as postgres.
  v_failed := false;
  v_error := null;
  begin
    update public.store_appointments
    set appointment_type = 'technical_visit',
        commercial_opportunity_id = c.ready_opportunity_id,
        commercial_opportunity_lifecycle_cycle = (
          select lifecycle_cycle
          from public.commercial_opportunities
          where id = c.ready_opportunity_id
        )
    where id = v_meeting.id;
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_TYPE_IMMUTABLE';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    16, 'table trigger rejects direct type conversion',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'direct meeting -> technical_visit unexpectedly succeeded')
  );

  -- 17. Trigger rejects direct anchor mutation.
  v_failed := false;
  v_error := null;
  begin
    update public.store_appointments
    set commercial_opportunity_id = c.peer_opportunity_id,
        commercial_opportunity_lifecycle_cycle = (
          select lifecycle_cycle
          from public.commercial_opportunities
          where id = c.peer_opportunity_id
        )
    where id = v_created.id;
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_COMMERCIAL_ANCHOR_IMMUTABLE';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    17, 'table trigger rejects commercial anchor mutation',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'commercial anchor unexpectedly changed')
  );

  -- 18. Trigger covers organization/store mutations too.
  v_failed := false;
  v_error := null;
  begin
    update public.store_appointments
    set store_id = gen_random_uuid()
    where id = v_created.id;
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_OPPORTUNITY_SCOPE_NOT_FOUND';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    18, 'table trigger rejects tenant-scope mutation',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'technical_visit store scope unexpectedly changed')
  );

  -- 19. Structurally invalid direct technical_visit INSERT is rejected by trigger.
  v_invalid_direct_start := pg_temp.p9_72_find_available_start(
    'technical_visit',
    null,
    v_meeting_start + interval '4 hours'
  );

  v_failed := false;
  v_error := null;
  begin
    insert into public.store_appointments (
      organization_id, store_id, lead_id, conversation_id,
      title, appointment_type, status, scheduled_start, scheduled_end, source
    )
    values (
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 invalid direct visit', 'technical_visit', 'scheduled',
      v_invalid_direct_start,
      v_invalid_direct_start + interval '1 hour',
      'system'
    );
  exception when others then
    v_failed := sqlerrm = 'ZION_TECHNICAL_VISIT_COMMERCIAL_ANCHOR_REQUIRED';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    19, 'table trigger rejects technical_visit without commercial anchor',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'unanchored direct technical_visit unexpectedly succeeded')
  );

  -- 20. Real canonical conflict is fail-closed.
  perform pg_temp.p9_72_set_technical_policy(null, true);

  v_failed := false;
  v_error := null;
  begin
    perform public.create_technical_visit_with_fresh_commercial_readiness_by_system(
      c.organization_id, c.store_id, c.lead_id, c.conversation_id,
      'P9 7.2 conflict', 'scheduled',
      v_meeting_start + interval '6 hours',
      v_meeting_start + interval '7 hours',
      null, null, null, null, 'system', null,
      c.conflict_opportunity_id, 'p9:7.2:runner:conflict'
    );
  exception when others then
    v_failed := sqlerrm like 'ZION_TECHNICAL_VISIT_READINESS_NOT_READY:conflict:%';
    v_error := sqlerrm;
  end;
  insert into pg_temp.p9_72_results values (
    20, 'fresh boundary blocks conflict readiness',
    case when v_failed then 'PASS' else 'FAIL' end,
    coalesce(v_error, 'conflict unexpectedly created an appointment')
  );

  -- Ensure no scenario silently passed with an unrecorded failure.
  perform pg_temp.p9_72_assert(
    (select count(*) from pg_temp.p9_72_results) = 20,
    'SUT_FAIL: expected 20 P9 7.2 scenarios'
  );

  perform pg_temp.p9_72_assert(
    not exists (
      select 1 from pg_temp.p9_72_results result_row
      where result_row.status <> 'PASS'
    ),
    'SUT_FAIL: one or more P9 7.2 scenarios failed'
  );
end;
$runner$;

select scenario_number, scenario_name, status, detail
from pg_temp.p9_72_results
order by scenario_number;

rollback;
