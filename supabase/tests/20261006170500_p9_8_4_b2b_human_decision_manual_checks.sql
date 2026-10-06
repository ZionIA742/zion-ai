begin;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- P9 8.4 B2B rollback-only real-SUT checks.
-- Fixtures are inserted as postgres. Every human decision call switches to the
-- authenticated database role and supplies the actor JWT claims.
create temp table pg_temp.p9_b2b_results (
  scenario_number integer primary key,
  scenario_name text not null
) on commit drop;

create temp table pg_temp.p9_b2b_ctx (
  org_id uuid not null,
  store_id uuid not null,
  opp_id uuid not null,
  customer_id uuid not null,
  cycle_id uuid,
  quote_id uuid not null,
  version_id uuid not null,
  version_alt_id uuid not null,
  actor_id uuid not null,
  other_store_id uuid not null,
  other_org_id uuid not null
) on commit drop;

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.decide_commercial_negotiation_concession_by_human(uuid,uuid,uuid,uuid,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)'
     ) is null
     or pg_catalog.to_regclass(
       'public.commercial_negotiation_concession_decision_events'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2B_RUNNER_PRECONDITIONS_MISSING';
  end if;
end;
$preflight$;

create or replace function pg_temp.p9_b2b_pass(
  p_number integer,
  p_name text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp.p9_b2b_results values (p_number, p_name);
  raise notice 'PASS %: %', p_number, p_name;
end;
$function$;

create or replace function pg_temp.p9_b2b_snapshot(
  p_state text,
  p_reason text
)
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'action', 'apply_discount',
    'state', p_state,
    'requestedDiscountPercent', 20,
    'canOffer', p_state not in ('blocked', 'unconfigured'),
    'canApply', p_state = 'allowed',
    'canRequestApproval', p_state = 'human_approval_required',
    'requiresHumanApproval', p_state = 'human_approval_required',
    'reasonCode', p_reason,
    'provenance', pg_catalog.jsonb_build_object(
      'source', 'p9_8_4_b2b_manual_runner'
    )
  );
$function$;

create or replace function pg_temp.p9_b2b_cycle(
  p_cycle integer,
  p_suffix text
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
  v_ctx pg_temp.p9_b2b_ctx;
  v_source text := 'p9_8_4_b2b_manual_runner';
  v_key text := 'p9:b2b:cycle:' || p_suffix || ':' || v_id::text;
  v_event_key text;
begin
  select * into strict v_ctx from pg_temp.p9_b2b_ctx;

  if p_cycle is null or p_cycle < 1 then
    raise exception 'P9_8_4_B2B_FIXTURE_CYCLE_INVALID';
  end if;

  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    p_cycle,
    'stage_transition',
    'orcamento',
    'negociacao',
    'system',
    null,
    'concrete_quote_objection_required',
    null,
    v_source,
    'material_negotiation_discount_request',
    null,
    'P9 8.4 B2B rollback-only lifecycle fixture'
  );

  insert into public.commercial_opportunity_lifecycle_events (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    event_type,
    previous_stage,
    new_stage,
    reason_code,
    evidence_type,
    evidence_summary,
    actor_type,
    source,
    metadata,
    idempotency_key,
    event_key
  )
  values (
    v_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_ctx.customer_id,
    p_cycle,
    'stage_transition',
    'orcamento',
    'negociacao',
    'concrete_quote_objection_required',
    'material_negotiation_discount_request',
    'P9 8.4 B2B rollback-only lifecycle fixture',
    'system',
    v_source,
    pg_catalog.jsonb_build_object(
      'runner', 'p9.8.4.b2b',
      'rollback_only', true,
      'fixture_lifecycle_cycle', p_cycle
    ),
    v_key,
    v_event_key
  );

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_b2b_concession(
  p_class text,
  p_status text,
  p_effective text,
  p_raw text,
  p_raw_reason text,
  p_origin text,
  p_key text,
  p_number integer default null,
  p_cycle_id uuid default null
)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
  v_ctx pg_temp.p9_b2b_ctx;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cycle uuid;
begin
  select * into strict v_ctx from pg_temp.p9_b2b_ctx;
  v_cycle := coalesce(p_cycle_id, v_ctx.cycle_id);

  insert into public.commercial_negotiation_concessions (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    negotiation_cycle_id,
    quote_id,
    quote_version_id,
    concession_class,
    concession_kind,
    status,
    concession_number,
    previous_condition,
    proposed_condition,
    requested_discount_percent,
    requested_discount_cents,
    counterpart_snapshot,
    policy_snapshot,
    authority_snapshot,
    authority_decision,
    effective_decision,
    high_value,
    high_value_context,
    origin,
    operation_key,
    request_fingerprint,
    approval_status,
    approval_requested_at,
    authorized_at,
    materialized_at,
    created_at,
    updated_at
  )
  values (
    v_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_cycle,
    v_ctx.quote_id,
    v_ctx.version_id,
    p_class,
    'discount',
    p_status,
    p_number,
    '{}'::jsonb,
    '{}'::jsonb,
    20,
    400000,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_temp.p9_b2b_snapshot(p_raw, p_raw_reason),
    p_raw,
    p_effective,
    false,
    '{}'::jsonb,
    p_origin,
    p_key,
    pg_catalog.repeat('a', 64),
    case
      when p_status = 'pending_human_approval' then 'pending'
      else 'not_required'
    end,
    case
      when p_status = 'pending_human_approval' then v_now
      else null
    end,
    case
      when p_status in ('authorized', 'materialized') then v_now
      else null
    end,
    case
      when p_status = 'materialized' then v_now
      else null
    end,
    v_now,
    v_now
  );

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_b2b_exec(
  p_actor uuid,
  p_org uuid,
  p_store uuid,
  p_opp uuid,
  p_id uuid,
  p_decision text,
  p_reason text,
  p_reference text default null
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    coalesce(p_actor::text, ''),
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', coalesce(p_actor::text, ''),
      'role', 'authenticated'
    )::text,
    true
  );

  execute 'set local role authenticated';

  begin
    select pg_catalog.to_jsonb(result)
      into strict v_value
    from public.decide_commercial_negotiation_concession_by_human(
      p_org,
      p_store,
      p_opp,
      p_id,
      p_decision,
      p_reason,
      p_reference
    ) result;

    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);

    return query
    select true, v_value, null::text, null::text;
    return;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      execute 'reset role';
      perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
      perform pg_catalog.set_config('request.jwt.claim.role', '', true);
      perform pg_catalog.set_config('request.jwt.claims', '', true);

      return query
      select false, null::jsonb, v_state, v_message;
      return;
  end;
exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then null;
    end;

    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);

    return query
    select false, null::jsonb, sqlstate::text, sqlerrm::text;
end;
$function$;

create or replace function pg_temp.p9_b2b_call_as(
  p_actor uuid,
  p_org uuid,
  p_store uuid,
  p_opp uuid,
  p_id uuid,
  p_decision text,
  p_reason text,
  p_reference text default null
)
returns jsonb
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into strict v_exec
  from pg_temp.p9_b2b_exec(
    p_actor,
    p_org,
    p_store,
    p_opp,
    p_id,
    p_decision,
    p_reason,
    p_reference
  );

  if not v_exec.operation_succeeded then
    raise exception using
      errcode = coalesce(v_exec.returned_sqlstate, 'P0001'),
      message = coalesce(v_exec.message_text, 'P9_8_4_B2B_CALL_FAILED');
  end if;

  return v_exec.value_json;
end;
$function$;

create or replace function pg_temp.p9_b2b_expect_error_as(
  p_actor uuid,
  p_org uuid,
  p_store uuid,
  p_opp uuid,
  p_id uuid,
  p_decision text,
  p_reason text,
  p_reference text,
  p_expected text
)
returns void
language plpgsql
as $function$
declare
  v_exec record;
begin
  select * into strict v_exec
  from pg_temp.p9_b2b_exec(
    p_actor,
    p_org,
    p_store,
    p_opp,
    p_id,
    p_decision,
    p_reason,
    p_reference
  );

  if v_exec.operation_succeeded then
    raise exception 'P9_8_4_B2B_EXPECTED_ERROR_NOT_RAISED';
  end if;

  if coalesce(v_exec.message_text, '') not like '%' || p_expected || '%' then
    raise exception
      'P9_8_4_B2B_WRONG_ERROR expected=% actual=%',
      p_expected,
      coalesce(v_exec.message_text, '<null>');
  end if;
end;
$function$;

do $runner$
declare
  v_run uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_ctx pg_temp.p9_b2b_ctx;

  v_cycle2 uuid;
  v_id uuid;
  v_id2 uuid;
  v_normal_approved uuid;
  v_exception_no_normals uuid;
  v_exception_gate uuid;
  v_exception_authorized uuid;
  v_exception_blocked_exact uuid;

  v_result jsonb;
  v_replay jsonb;
  v_before jsonb;
  v_quote_before jsonb;
  v_version_before jsonb;
  v_event_id uuid;
  v_event_count integer;
  v_version_count_before integer;

  v_error text;
  v_state text;
  v_constraint text;
begin
  v_ctx := (
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    null,
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid()
  );

  insert into pg_temp.p9_b2b_ctx values (v_ctx.*);

  insert into auth.users (id)
  values (v_ctx.actor_id);

  insert into public.organizations (id, name)
  values
    (v_ctx.org_id, 'P9 8.4 B2B ' || v_run::text),
    (v_ctx.other_org_id, 'P9 8.4 B2B other ' || v_run::text);

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v_ctx.store_id, v_ctx.org_id, 'B2B store', v_now),
    (v_ctx.other_store_id, v_ctx.org_id, 'B2B other store', v_now);

  insert into public.customers (
    id,
    organization_id,
    display_name,
    normalized_name
  )
  values (
    v_ctx.customer_id,
    v_ctx.org_id,
    'B2B customer',
    'p9-8-4-b2b-' || pg_catalog.replace(v_run::text, '-', '')
  );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values (
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.customer_id
  );

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage,
    lifecycle_cycle
  )
  values (
    v_ctx.opp_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.customer_id,
    'negociacao',
    1
  );

  v_ctx.cycle_id := pg_temp.p9_b2b_cycle(1, 'main');
  update pg_temp.p9_b2b_ctx set cycle_id = v_ctx.cycle_id;

  v_cycle2 := pg_temp.p9_b2b_cycle(2, 'stale');

  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    quote_number,
    title,
    status,
    subtotal_cents,
    discount_cents,
    total_cents,
    metadata
  )
  values (
    v_ctx.quote_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    'B2B-' || pg_catalog.replace(v_run::text, '-', ''),
    'B2B quote',
    'sent',
    2000000,
    0,
    2000000,
    pg_catalog.jsonb_build_object('runner', 'p9.8.4.b2b')
  );

  insert into public.sales_quote_versions (
    id,
    organization_id,
    store_id,
    quote_id,
    version_number,
    status,
    quote_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot,
    created_at,
    sent_at
  )
  values
  (
    v_ctx.version_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.quote_id,
    1,
    'sent',
    'definitive',
    'zion-store-files',
    'p9/b2b/' || v_ctx.version_id::text || '.pdf',
    'b2b.pdf',
    'application/pdf',
    100,
    'system',
    pg_catalog.jsonb_build_object(
      'quote', pg_catalog.jsonb_build_object(
        'id', v_ctx.quote_id::text,
        'subtotalCents', 2000000,
        'discountCents', 0,
        'totalCents', 2000000
      ),
      'items', pg_catalog.jsonb_build_array(),
      'settings', pg_catalog.jsonb_build_object()
    ),
    v_now,
    v_now + interval '1 minute'
  ),
  (
    v_ctx.version_alt_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.quote_id,
    2,
    'generated',
    'definitive',
    'zion-store-files',
    'p9/b2b/' || v_ctx.version_alt_id::text || '.pdf',
    'b2b-alt.pdf',
    'application/pdf',
    100,
    'system',
    pg_catalog.jsonb_build_object(
      'quote', pg_catalog.jsonb_build_object(
        'id', v_ctx.quote_id::text,
        'subtotalCents', 2000000,
        'discountCents', 0,
        'totalCents', 2000000
      ),
      'items', pg_catalog.jsonb_build_array(),
      'settings', pg_catalog.jsonb_build_object()
    ),
    v_now + interval '2 minutes',
    null
  );

  update public.sales_quotes
  set current_version_id = v_ctx.version_id
  where id = v_ctx.quote_id;

  perform *
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_ctx.quote_id,
    v_ctx.version_id,
    'current_commercial_proposal:'
      || v_ctx.opp_id::text
      || ':'
      || v_ctx.quote_id::text
      || ':'
      || v_ctx.version_id::text,
    'p9_8_4_b2b_manual_runner'
  );

  insert into public.memberships (
    organization_id,
    user_id,
    role,
    is_active
  )
  values
    (v_ctx.org_id, v_ctx.actor_id, 'owner', true),
    (v_ctx.other_org_id, v_ctx.actor_id, 'owner', true);

  select pg_catalog.to_jsonb(quote_row)
    into v_quote_before
  from public.sales_quotes quote_row
  where quote_row.id = v_ctx.quote_id;

  select pg_catalog.to_jsonb(version_row)
    into v_version_before
  from public.sales_quote_versions version_row
  where version_row.id = v_ctx.version_id;

  select count(*)::integer
    into v_version_count_before
  from public.sales_quote_versions version_row
  where version_row.quote_id = v_ctx.quote_id;

  -- 01: normal pending approve -> authorized.
  v_normal_approved := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-01'
  );

  v_result := pg_temp.p9_b2b_call_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_normal_approved,
    'approve',
    'approved by human',
    'ref-01'
  );

  if v_result ->> 'status' <> 'authorized'
     or v_result ->> 'effective_decision' <> 'allowed'
     or (v_result ->> 'replayed')::boolean then
    raise exception 'P9_8_4_B2B_SCENARIO_01';
  end if;

  v_event_id := (v_result ->> 'decision_event_id')::uuid;
  perform pg_temp.p9_b2b_pass(1, 'normal pending approve => authorized');

  -- 02: normal pending reject -> rejected.
  v_id := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-02'
  );

  v_result := pg_temp.p9_b2b_call_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_id,
    'reject',
    'rejected by human',
    'ref-02'
  );

  if v_result ->> 'status' <> 'rejected'
     or v_result ->> 'effective_decision' <> 'blocked' then
    raise exception 'P9_8_4_B2B_SCENARIO_02';
  end if;
  perform pg_temp.p9_b2b_pass(2, 'normal pending reject => rejected');

  -- 03: approval actor persisted.
  if not exists (
    select 1
    from public.commercial_negotiation_concessions concession_row
    where concession_row.id = v_normal_approved
      and concession_row.approval_status = 'approved'
      and concession_row.approval_actor_user_id = v_ctx.actor_id
      and concession_row.approval_decided_at is not null
  ) then
    raise exception 'P9_8_4_B2B_SCENARIO_03';
  end if;
  perform pg_temp.p9_b2b_pass(3, 'approval actor persisted');

  -- 04: approval reason/reference persisted.
  if not exists (
    select 1
    from public.commercial_negotiation_concessions concession_row
    where concession_row.id = v_normal_approved
      and concession_row.approval_reason = 'approved by human'
      and concession_row.approval_reference = 'ref-01'
  ) then
    raise exception 'P9_8_4_B2B_SCENARIO_04';
  end if;
  perform pg_temp.p9_b2b_pass(4, 'approval reason and reference persisted');

  -- 05: human decision event is scoped and actor-bound.
  if not exists (
    select 1
    from public.commercial_negotiation_concession_decision_events event_row
    where event_row.id = v_event_id
      and event_row.organization_id = v_ctx.org_id
      and event_row.store_id = v_ctx.store_id
      and event_row.commercial_opportunity_id = v_ctx.opp_id
      and event_row.negotiation_cycle_id = v_ctx.cycle_id
      and event_row.concession_id = v_normal_approved
      and event_row.decision_kind = 'human_decision'
      and event_row.actor_kind = 'human'
      and event_row.actor_user_id = v_ctx.actor_id
      and event_row.from_status = 'pending_human_approval'
      and event_row.to_status = 'authorized'
      and event_row.effective_decision = 'allowed'
      and event_row.operation_key =
          'commercial_negotiation_concession_human_decision:'
          || v_normal_approved::text
  ) then
    raise exception 'P9_8_4_B2B_SCENARIO_05';
  end if;
  perform pg_temp.p9_b2b_pass(5, 'human decision event scoped correctly');

  -- 06: identical replay returns the same event.
  v_replay := pg_temp.p9_b2b_call_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_normal_approved,
    'approve',
    'approved by human',
    'ref-01'
  );

  if (v_replay ->> 'replayed')::boolean is not true
     or (v_replay ->> 'decision_event_id')::uuid is distinct from v_event_id
     or v_replay ->> 'status' <> 'authorized' then
    raise exception 'P9_8_4_B2B_SCENARIO_06';
  end if;
  perform pg_temp.p9_b2b_pass(6, 'identical replay returns same event');

  -- 07: divergent replay fails closed.
  perform pg_temp.p9_b2b_expect_error_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_normal_approved,
    'approve',
    'different reason',
    'ref-01',
    'IDEMPOTENCY_KEY_REUSED_DIVERGENT'
  );
  perform pg_temp.p9_b2b_pass(7, 'divergent replay rejected');

  -- 08: authenticated caller without active membership is rejected.
  v_id := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-08'
  );

  perform pg_temp.p9_b2b_expect_error_as(
    pg_catalog.gen_random_uuid(),
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_id,
    'approve',
    'no membership',
    null,
    'MEMBERSHIP_REQUIRED'
  );
  perform pg_temp.p9_b2b_pass(8, 'authenticated membership required');

  -- 09: wrong store and wrong organization are both rejected by exact scope.
  v_id := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-09'
  );

  perform pg_temp.p9_b2b_expect_error_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.other_store_id,
    v_ctx.opp_id,
    v_id,
    'approve',
    'wrong store',
    null,
    'CONCESSION_NOT_FOUND_IN_SCOPE'
  );

  perform pg_temp.p9_b2b_expect_error_as(
    v_ctx.actor_id,
    v_ctx.other_org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_id,
    'approve',
    'wrong organization',
    null,
    'CONCESSION_NOT_FOUND_IN_SCOPE'
  );
  perform pg_temp.p9_b2b_pass(9, 'wrong organization/store rejected');

  -- 10: stale opportunity is detected after a canonical temporary transition.
  v_id := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-10'
  );
  select pg_catalog.to_jsonb(concession_row)
    into v_before
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_id;
  select count(*)::integer
    into v_event_count
  from public.commercial_negotiation_concession_decision_events event_row
  where event_row.concession_id = v_id;

  v_error := null;
  v_state := null;
  begin
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      'service_role',
      true
    );

    perform *
    from public.transition_commercial_opportunity_stage_by_system(
      p_organization_id => v_ctx.org_id,
      p_store_id => v_ctx.store_id,
      p_commercial_opportunity_id => v_ctx.opp_id,
      p_idempotency_key => 'p9-b2b-stale-stage:' || v_run::text,
      p_target_stage => 'orcamento',
      p_reason_details => 'P9 8.4 B2B stale opportunity rollback fixture',
      p_evidence_type => 'quote_revision_required',
      p_evidence_message_id => null,
      p_evidence_summary => 'P9 8.4 B2B stale opportunity rollback fixture',
      p_source => 'p9_8_4_b2b_manual_runner'
    );

    perform pg_temp.p9_b2b_call_as(
      v_ctx.actor_id,
      v_ctx.org_id,
      v_ctx.store_id,
      v_ctx.opp_id,
      v_id,
      'approve',
      'stale opportunity',
      null
    );

    raise exception 'P9_8_4_B2B_SCENARIO_10_EXPECTED_ERROR_NOT_RAISED';
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_error = message_text;
  end;

  if v_error is distinct from 'P9_8_4_B2B_OPPORTUNITY_STALE'
     or (select stage
         from public.commercial_opportunities
         where id = v_ctx.opp_id) is distinct from 'negociacao'
     or (select pg_catalog.to_jsonb(concession_row)
         from public.commercial_negotiation_concessions concession_row
         where concession_row.id = v_id) is distinct from v_before
     or (select count(*)
         from public.commercial_negotiation_concession_decision_events event_row
         where event_row.concession_id = v_id) <> v_event_count then
    raise exception
      'P9_8_4_B2B_SCENARIO_10 error=% state=%',
      coalesce(v_error, '<null>'),
      coalesce(v_state, '<null>');
  end if;
  perform pg_temp.p9_b2b_pass(10, 'stale opportunity rejected without mutation');

  -- 11: stale negotiation cycle is rejected and fixture mutation rolls back.
  v_id := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-11'
  );
  select pg_catalog.to_jsonb(concession_row)
    into v_before
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_id;

  v_error := null;
  begin
    update public.commercial_negotiation_concessions
    set negotiation_cycle_id = v_cycle2
    where id = v_id;

    perform pg_temp.p9_b2b_call_as(
      v_ctx.actor_id,
      v_ctx.org_id,
      v_ctx.store_id,
      v_ctx.opp_id,
      v_id,
      'approve',
      'stale cycle',
      null
    );

    raise exception 'P9_8_4_B2B_SCENARIO_11_EXPECTED_ERROR_NOT_RAISED';
  exception
    when others then
      v_error := sqlerrm;
  end;

  if v_error is distinct from 'P9_8_4_B2B_NEGOTIATION_CYCLE_STALE'
     or (select pg_catalog.to_jsonb(concession_row)
         from public.commercial_negotiation_concessions concession_row
         where concession_row.id = v_id) is distinct from v_before
     or exists (
       select 1
       from public.commercial_negotiation_concession_decision_events event_row
       where event_row.concession_id = v_id
     ) then
    raise exception
      'P9_8_4_B2B_SCENARIO_11 error=%',
      coalesce(v_error, '<null>');
  end if;
  perform pg_temp.p9_b2b_pass(11, 'stale cycle rejected');

  -- 12: stale/missing current quote is rejected without mutation.
  v_id := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-12'
  );
  select pg_catalog.to_jsonb(concession_row)
    into v_before
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_id;

  v_error := null;
  begin
    update public.commercial_opportunities
    set current_quote_id = null,
        current_quote_version_id = null
    where id = v_ctx.opp_id;

    perform pg_temp.p9_b2b_call_as(
      v_ctx.actor_id,
      v_ctx.org_id,
      v_ctx.store_id,
      v_ctx.opp_id,
      v_id,
      'approve',
      'stale current quote',
      null
    );

    raise exception 'P9_8_4_B2B_SCENARIO_12_EXPECTED_ERROR_NOT_RAISED';
  exception
    when others then
      v_error := sqlerrm;
  end;

  if v_error is distinct from 'P9_8_4_B2B_CURRENT_PROPOSAL_STALE'
     or (select pg_catalog.to_jsonb(concession_row)
         from public.commercial_negotiation_concessions concession_row
         where concession_row.id = v_id) is distinct from v_before
     or exists (
       select 1
       from public.commercial_negotiation_concession_decision_events event_row
       where event_row.concession_id = v_id
     ) then
    raise exception
      'P9_8_4_B2B_SCENARIO_12 error=%',
      coalesce(v_error, '<null>');
  end if;
  perform pg_temp.p9_b2b_pass(12, 'stale current quote rejected');

  -- 13: stale current version is rejected without mutation.
  v_id := pg_temp.p9_b2b_concession(
    'normal',
    'pending_human_approval',
    'human_approval_required',
    'human_approval_required',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL',
    'sales_ai',
    'b2b-13'
  );
  select pg_catalog.to_jsonb(concession_row)
    into v_before
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_id;

  v_error := null;
  begin
    update public.commercial_opportunities
    set current_quote_id = v_ctx.quote_id,
        current_quote_version_id = v_ctx.version_alt_id
    where id = v_ctx.opp_id;

    perform pg_temp.p9_b2b_call_as(
      v_ctx.actor_id,
      v_ctx.org_id,
      v_ctx.store_id,
      v_ctx.opp_id,
      v_id,
      'approve',
      'stale current version',
      null
    );

    raise exception 'P9_8_4_B2B_SCENARIO_13_EXPECTED_ERROR_NOT_RAISED';
  exception
    when others then
      v_error := sqlerrm;
  end;

  if v_error is distinct from 'P9_8_4_B2B_CURRENT_PROPOSAL_STALE'
     or (select pg_catalog.to_jsonb(concession_row)
         from public.commercial_negotiation_concessions concession_row
         where concession_row.id = v_id) is distinct from v_before
     or exists (
       select 1
       from public.commercial_negotiation_concession_decision_events event_row
       where event_row.concession_id = v_id
     ) then
    raise exception
      'P9_8_4_B2B_SCENARIO_13 error=%',
      coalesce(v_error, '<null>');
  end if;
  perform pg_temp.p9_b2b_pass(13, 'stale current version rejected');

  -- 14: human exception can exist as proposed before two normal concessions.
  v_exception_no_normals := pg_temp.p9_b2b_concession(
    'human_exception',
    'proposed',
    null,
    'allowed',
    'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
    'human',
    'b2b-14'
  );

  if not exists (
    select 1
    from public.commercial_negotiation_concessions concession_row
    where concession_row.id = v_exception_no_normals
      and concession_row.status = 'proposed'
      and concession_row.effective_decision is null
      and concession_row.concession_number is null
  ) then
    raise exception 'P9_8_4_B2B_SCENARIO_14';
  end if;
  perform pg_temp.p9_b2b_pass(14, 'human exception may be proposed before two normals');

  -- 15: human exception may be rejected before two normals.
  v_id := pg_temp.p9_b2b_concession(
    'human_exception',
    'proposed',
    null,
    'allowed',
    'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
    'human',
    'b2b-15'
  );

  v_result := pg_temp.p9_b2b_call_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_id,
    'reject',
    'exception rejected before normals',
    'ref-15'
  );

  if v_result ->> 'status' <> 'rejected'
     or v_result ->> 'effective_decision' <> 'blocked' then
    raise exception 'P9_8_4_B2B_SCENARIO_15';
  end if;
  perform pg_temp.p9_b2b_pass(15, 'human exception reject before two normals allowed');

  -- 16: human exception approval is blocked before two normals.
  perform pg_temp.p9_b2b_expect_error_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_exception_no_normals,
    'approve',
    'needs two normals',
    null,
    'HUMAN_EXCEPTION_NORMALS_REQUIRED'
  );
  perform pg_temp.p9_b2b_pass(16, 'human exception approve before two normals rejected');

  -- 18: one materialized normal is insufficient.
  perform pg_temp.p9_b2b_concession(
    'normal',
    'materialized',
    'allowed',
    'allowed',
    'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
    'sales_ai',
    'b2b-current-normal-1',
    1
  );

  v_exception_gate := pg_temp.p9_b2b_concession(
    'human_exception',
    'proposed',
    null,
    'allowed',
    'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
    'human',
    'b2b-18'
  );

  perform pg_temp.p9_b2b_expect_error_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_exception_gate,
    'approve',
    'only one normal',
    null,
    'HUMAN_EXCEPTION_NORMALS_REQUIRED'
  );
  perform pg_temp.p9_b2b_pass(18, 'only normal 1 is insufficient');

  -- 19: materialized ordinals 1+2 from another cycle do not count.
  perform pg_temp.p9_b2b_concession(
    'normal',
    'materialized',
    'allowed',
    'allowed',
    'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
    'sales_ai',
    'b2b-other-cycle-normal-1',
    1,
    v_cycle2
  );

  perform pg_temp.p9_b2b_concession(
    'normal',
    'materialized',
    'allowed',
    'allowed',
    'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
    'sales_ai',
    'b2b-other-cycle-normal-2',
    2,
    v_cycle2
  );

  perform pg_temp.p9_b2b_expect_error_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_exception_gate,
    'approve',
    'other cycle normals do not count',
    null,
    'HUMAN_EXCEPTION_NORMALS_REQUIRED'
  );
  perform pg_temp.p9_b2b_pass(19, 'other-cycle ordinals 1+2 do not count');

  -- 17: exactly current-cycle normals 1+2 unlock the human exception.
  perform pg_temp.p9_b2b_concession(
    'normal',
    'materialized',
    'allowed',
    'allowed',
    'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY',
    'sales_ai',
    'b2b-current-normal-2',
    2
  );

  v_result := pg_temp.p9_b2b_call_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_exception_gate,
    'approve',
    'exception approved after two normals',
    'ref-17'
  );

  if v_result ->> 'status' <> 'authorized'
     or v_result ->> 'effective_decision' <> 'allowed' then
    raise exception 'P9_8_4_B2B_SCENARIO_17';
  end if;

  v_exception_authorized := v_exception_gate;
  perform pg_temp.p9_b2b_pass(17, 'exact normals 1+2 allow human exception approval');

  -- 20: exact ABOVE_MAX_BLOCKED raw authority may be explicitly approved.
  v_exception_blocked_exact := pg_temp.p9_b2b_concession(
    'human_exception',
    'proposed',
    null,
    'blocked',
    'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED',
    'human',
    'b2b-20'
  );

  v_result := pg_temp.p9_b2b_call_as(
    v_ctx.actor_id,
    v_ctx.org_id,
    v_ctx.store_id,
    v_ctx.opp_id,
    v_exception_blocked_exact,
    'approve',
    'explicit above-max human exception',
    'ref-20'
  );

  if v_result ->> 'status' <> 'authorized'
     or v_result ->> 'effective_decision' <> 'allowed' then
    raise exception 'P9_8_4_B2B_SCENARIO_20';
  end if;
  perform pg_temp.p9_b2b_pass(20, 'ABOVE_MAX_BLOCKED human exception may be approved');

  -- 21: unrelated blocked reason is rejected even before a decision can exist.
  -- B1.5 already makes such a human_exception row impossible; B2B keeps a
  -- defensive check too. This scenario proves the stronger persisted boundary.
  v_state := null;
  v_error := null;
  v_constraint := null;
  begin
    perform pg_temp.p9_b2b_concession(
      'human_exception',
      'proposed',
      null,
      'blocked',
      'OTHER_BLOCK',
      'human',
      'b2b-21'
    );
    raise exception 'P9_8_4_B2B_SCENARIO_21_EXPECTED_ERROR_NOT_RAISED';
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_error = message_text,
        v_constraint = constraint_name;
  end;

  if v_state is distinct from '23514'
     or v_constraint is distinct from (
       select constraint_row.conname::text
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and constraint_row.conname =
             'commercial_negotiation_concessions_human_exception_blocked_reason_check'
     ) then
    raise exception
      'P9_8_4_B2B_SCENARIO_21 state=% constraint=% error=%',
      coalesce(v_state, '<null>'),
      coalesce(v_constraint, '<null>'),
      coalesce(v_error, '<null>');
  end if;
  perform pg_temp.p9_b2b_pass(21, 'unrelated blocked human exception fails closed');

  -- 22: unconfigured authority cannot become a human exception at all.
  v_state := null;
  v_error := null;
  v_constraint := null;
  begin
    perform pg_temp.p9_b2b_concession(
      'human_exception',
      'proposed',
      null,
      'unconfigured',
      'TRANSACTIONAL_AUTHORITY_POLICY_UNCONFIGURED',
      'human',
      'b2b-22'
    );
    raise exception 'P9_8_4_B2B_SCENARIO_22_EXPECTED_ERROR_NOT_RAISED';
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_error = message_text,
        v_constraint = constraint_name;
  end;

  if v_state is distinct from '23514'
     or v_constraint is distinct from (
       select constraint_row.conname::text
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and constraint_row.conname =
             'commercial_negotiation_concessions_human_exception_unconfigured_check'
     ) then
    raise exception
      'P9_8_4_B2B_SCENARIO_22 state=% constraint=% error=%',
      coalesce(v_state, '<null>'),
      coalesce(v_constraint, '<null>'),
      coalesce(v_error, '<null>');
  end if;
  perform pg_temp.p9_b2b_pass(22, 'unconfigured human exception fails closed');

  -- 23: human exceptions never receive an ordinal or become materialized in B2B.
  if exists (
    select 1
    from public.commercial_negotiation_concessions concession_row
    where concession_row.id in (
      v_exception_authorized,
      v_exception_blocked_exact
    )
      and (
        concession_row.concession_number is not null
        or concession_row.materialized_at is not null
        or concession_row.status <> 'authorized'
      )
  ) then
    raise exception 'P9_8_4_B2B_SCENARIO_23';
  end if;
  perform pg_temp.p9_b2b_pass(23, 'human exception has no ordinal/materialization');

  -- 24: quote/version remain byte-for-byte unchanged and no discount is applied.
  if (select pg_catalog.to_jsonb(quote_row)
      from public.sales_quotes quote_row
      where quote_row.id = v_ctx.quote_id) is distinct from v_quote_before
     or (select pg_catalog.to_jsonb(version_row)
         from public.sales_quote_versions version_row
         where version_row.id = v_ctx.version_id) is distinct from v_version_before
     or (select count(*)
         from public.sales_quote_versions version_row
         where version_row.quote_id = v_ctx.quote_id) <> v_version_count_before
     or (select discount_cents
         from public.sales_quotes quote_row
         where quote_row.id = v_ctx.quote_id) is distinct from 0 then
    raise exception 'P9_8_4_B2B_SCENARIO_24';
  end if;
  perform pg_temp.p9_b2b_pass(24, 'quote/version unchanged and no discount applied');

  if (select count(*) from pg_temp.p9_b2b_results) <> 24 then
    raise exception 'P9_8_4_B2B_SCENARIO_COUNT';
  end if;

  raise notice 'P9_8_4_B2B_MANUAL_CHECKS PASS: 24 scenarios';
end;
$runner$;

select
  scenario_number,
  scenario_name,
  'PASS'::text as status
from pg_temp.p9_b2b_results
order by scenario_number;

rollback;
