begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:technical-visit-progress-resolver:v1:manual-checks',
    0
  )
);

-- Rollback-only runner. It creates one isolated temporary opportunity and a set
-- of appointment fixtures, exercises the resolver, and rolls everything back.

do $checks$
declare
  v_seed public.commercial_opportunities;

  v_opportunity_id constant uuid :=
    '9f350420-0000-4000-8000-000000000001'::uuid;

  v_other_cycle_appointment_id constant uuid :=
    '9f350420-0000-4000-8000-000000000011'::uuid;
  v_active_appointment_id constant uuid :=
    '9f350420-0000-4000-8000-000000000012'::uuid;
  v_raw_completed_appointment_id constant uuid :=
    '9f350420-0000-4000-8000-000000000013'::uuid;
  v_canonical_appointment_id constant uuid :=
    '9f350420-0000-4000-8000-000000000014'::uuid;
  v_additional_appointment_id constant uuid :=
    '9f350420-0000-4000-8000-000000000015'::uuid;

  v_start timestamptz :=
    pg_catalog.clock_timestamp() + interval '4300 days';

  v_result record;
  v_repeat record;

  v_definition text;
begin
  if pg_catalog.to_regprocedure(
    'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: technical visit progress resolver is missing';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: internal resolver is executable by runtime roles';
  end if;

  select opportunity_row.*
  into v_seed
  from public.commercial_opportunities opportunity_row
  order by opportunity_row.created_at, opportunity_row.id
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: runner requires one existing commercial opportunity as tenant/customer seed';
  end if;

  if exists (
    select 1
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_opportunity_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'HARNESS_ERROR: fixed resolver opportunity fixture already exists';
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
    v_opportunity_id,
    v_seed.organization_id,
    v_seed.store_id,
    v_seed.customer_id,
    'qualificacao',
    1
  );

  -- --------------------------------------------------------------------------
  -- 1. No current-cycle visit => determined / not_started.
  -- --------------------------------------------------------------------------
  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'determined'
     or v_result.progress_state is distinct from 'not_started'
     or v_result.reason_code is distinct from
          'technical_visit_no_current_cycle_appointment'
     or v_result.resolver_key is distinct from 'technical_visit'
     or v_result.resolver_version is distinct from 1
     or v_result.authority_fingerprint !~ '^[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(v_result.resolution_basis)
          is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: no-appointment technical visit resolution mismatch';
  end if;

  select *
  into v_repeat
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_repeat.authority_fingerprint
       is distinct from v_result.authority_fingerprint
     or v_repeat.resolution_basis
       is distinct from v_result.resolution_basis then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: unchanged technical visit authority is not deterministic';
  end if;

  -- --------------------------------------------------------------------------
  -- 2. Appointment from another lifecycle cycle must be ignored.
  --
  -- The anchor trigger is temporarily disabled only to simulate the real state
  -- that occurs naturally after an opportunity reopens: an appointment keeps
  -- its old immutable anchor while the opportunity current cycle changes.
  -- --------------------------------------------------------------------------
  execute
    'alter table public.store_appointments disable trigger ' ||
    'store_appointments_validate_commercial_lifecycle_anchor';

  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle
  )
  values (
    v_other_cycle_appointment_id,
    v_seed.organization_id,
    v_seed.store_id,
    'P9 resolver other-cycle visit',
    'technical_visit',
    'scheduled',
    v_start,
    v_start + interval '1 hour',
    'system',
    v_opportunity_id,
    2
  );

  execute
    'alter table public.store_appointments enable trigger ' ||
    'store_appointments_validate_commercial_lifecycle_anchor';

  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'determined'
     or v_result.progress_state is distinct from 'not_started'
     or (
       v_result.resolution_basis
         #>> '{authority,aggregate_counts,total}'
     )::integer <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: different lifecycle-cycle appointment leaked into current progress';
  end if;

  -- --------------------------------------------------------------------------
  -- 3. scheduled => in_progress.
  -- --------------------------------------------------------------------------
  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle
  )
  values (
    v_active_appointment_id,
    v_seed.organization_id,
    v_seed.store_id,
    'P9 resolver active visit',
    'technical_visit',
    'scheduled',
    v_start + interval '2 hours',
    v_start + interval '3 hours',
    'system',
    v_opportunity_id,
    1
  );

  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'determined'
     or v_result.progress_state is distinct from 'in_progress'
     or v_result.reason_code is distinct from
          'technical_visit_active_appointment' then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: scheduled technical visit did not resolve in_progress';
  end if;

  -- --------------------------------------------------------------------------
  -- 4. cancelled-only current-cycle set => not_started.
  -- --------------------------------------------------------------------------
  update public.store_appointments
  set
    status = 'cancelled',
    updated_at = pg_catalog.clock_timestamp()
  where id = v_active_appointment_id
    and organization_id = v_seed.organization_id
    and store_id = v_seed.store_id;

  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'determined'
     or v_result.progress_state is distinct from 'not_started'
     or v_result.reason_code is distinct from
          'technical_visit_cancelled_only' then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: cancelled-only technical visit did not resolve not_started';
  end if;

  -- --------------------------------------------------------------------------
  -- 5. Raw completed without canonical completion authority => needs_resolution.
  -- PostgreSQL owner context is used deliberately to simulate legacy/bypass data.
  -- --------------------------------------------------------------------------
  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle
  )
  values (
    v_raw_completed_appointment_id,
    v_seed.organization_id,
    v_seed.store_id,
    'P9 resolver raw completed visit',
    'technical_visit',
    'completed',
    v_start + interval '4 hours',
    v_start + interval '5 hours',
    'system',
    v_opportunity_id,
    1
  );

  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'needs_resolution'
     or v_result.progress_state is not null
     or v_result.reason_code is distinct from
          'technical_visit_completed_without_canonical_authority' then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: raw completed appointment was treated as canonical completion';
  end if;

  -- --------------------------------------------------------------------------
  -- 6. Canonical needs_followup means the visit happened => completed.
  -- A raw untrusted completed row remains present; canonical proof still wins.
  -- --------------------------------------------------------------------------
  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle
  )
  values (
    v_canonical_appointment_id,
    v_seed.organization_id,
    v_seed.store_id,
    'P9 resolver canonical visit',
    'technical_visit',
    'scheduled',
    v_start + interval '6 hours',
    v_start + interval '7 hours',
    'system',
    v_opportunity_id,
    1
  );

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  perform public.complete_store_appointment_with_outcome(
    v_canonical_appointment_id,
    v_seed.organization_id,
    v_seed.store_id,
    'needs_followup',
    'technical visit resolver needs followup'
  );

  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'determined'
     or v_result.progress_state is distinct from 'completed'
     or v_result.reason_code is distinct from
          'technical_visit_completed_canonical'
     or (
       v_result.resolution_basis
         #>> '{authority,aggregate_counts,canonical_completed}'
     )::integer < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: canonical needs_followup did not resolve technical visit completed';
  end if;

  -- --------------------------------------------------------------------------
  -- 7. Additional scheduled visit does not regress a proven completed visit.
  -- --------------------------------------------------------------------------
  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle
  )
  values (
    v_additional_appointment_id,
    v_seed.organization_id,
    v_seed.store_id,
    'P9 resolver additional visit',
    'technical_visit',
    'rescheduled',
    v_start + interval '8 hours',
    v_start + interval '9 hours',
    'system',
    v_opportunity_id,
    1
  );

  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'determined'
     or v_result.progress_state is distinct from 'completed'
     or v_result.reason_code is distinct from
          'technical_visit_completed_canonical'
     or (
       v_result.resolution_basis
         #>> '{authority,aggregate_counts,active}'
     )::integer < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: additional active visit regressed canonical completion';
  end if;

  -- --------------------------------------------------------------------------
  -- 8. needs_followup -> fully_completed remains completed, with a changed
  -- deterministic authority fingerprint because current canonical authority moved.
  -- --------------------------------------------------------------------------
  v_repeat := v_result;

  perform public.complete_store_appointment_with_outcome(
    v_canonical_appointment_id,
    v_seed.organization_id,
    v_seed.store_id,
    'fully_completed',
    'technical visit resolver fully completed'
  );

  select *
  into v_result
  from public.p9_resolve_technical_visit_progress_internal(
    v_seed.organization_id,
    v_seed.store_id,
    v_opportunity_id
  );

  if v_result.assessment_state is distinct from 'determined'
     or v_result.progress_state is distinct from 'completed'
     or v_result.reason_code is distinct from
          'technical_visit_completed_canonical'
     or v_result.authority_fingerprint
          is not distinct from v_repeat.authority_fingerprint then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: fully_completed authority transition was not reflected deterministically';
  end if;

  -- --------------------------------------------------------------------------
  -- 9. Definition guard: no latest/max authority fallback.
  -- --------------------------------------------------------------------------
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition like '%order by%created_at%desc%limit 1%'
     or v_definition like '%max(version_number)%'
     or v_definition like '%max(created_at)%'
     or v_definition not like
          '%commercial_opportunity_lifecycle_cycle = v_opportunity.lifecycle_cycle%'
     or v_definition not like
          '%store_appointment_completion_current%' then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: technical visit resolver definition authority contract mismatch';
  end if;
end;
$checks$;

rollback;
