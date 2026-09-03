begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:technical-visit-progress-resolver:v1',
    0
  )
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Technical Visit Progress Resolver v1.
--
-- Frozen semantics:
-- - Applicability remains owned by the checklist. This resolver answers only:
--     "what happened with the technical visit in the current lifecycle cycle?"
-- - Resolver output uses the Progress / Assessment vocabulary:
--     determined + not_started|in_progress|completed
--     needs_resolution + NULL progress
--     conflict + NULL progress
-- - Current-cycle identity comes from
--     store_appointments.commercial_opportunity_lifecycle_cycle.
-- - A technical visit is completed only from the explicit canonical appointment
--   completion current pointer/event. Raw store_appointments.status='completed'
--   without canonical completion authority is insufficient and resolves to
--   needs_resolution.
-- - Both canonical outcomes fully_completed and needs_followup mean the visit
--   happened, therefore Progress=completed.
-- - needs_followup is a separate pending obligation and does not regress the fact
--   that the technical visit occurred.
-- - Multiple appointments are aggregated as a set. There is no latest/max/current
--   appointment heuristic:
--     * any valid canonical completion in the current cycle => completed;
--     * otherwise any raw completed-without-authority => needs_resolution;
--     * otherwise any scheduled/rescheduled => in_progress;
--     * otherwise (none/cancelled-only) => not_started.
-- - An additional scheduled/rescheduled visit never regresses an already proven
--   canonical completion.
-- - Appointments anchored to another lifecycle cycle are ignored.
-- - A contradictory canonical completion pointer/event vs operational appointment
--   state/scope is structural conflict and fails closed.
-- - authority_fingerprint is deterministic over exact current-cycle authority
--   inputs; no evaluated_at/current wall-clock value participates in the hash.
-- - This is an internal read-only resolver. It does not write Progress tables.
--   The future Progress materializer will compose this resolver with other domain
--   resolvers and persist a complete projection.
-- ============================================================================

do $preflight$
declare
  v_table text;
begin
  foreach v_table in array array[
    'commercial_opportunities',
    'store_appointments',
    'store_appointment_completion_events',
    'store_appointment_completion_current'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%s is missing',
          v_table
        );
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_appointments'
      and column_row.column_name =
        'commercial_opportunity_lifecycle_cycle'
      and column_row.data_type = 'integer'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: appointment lifecycle cycle anchor is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'extensions.digest(bytea,text)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: extensions.digest(bytea,text) is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: technical visit progress resolver already exists';
  end if;
end;
$preflight$;

create or replace function public.p9_resolve_technical_visit_progress_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  assessment_state text,
  progress_state text,
  resolver_key text,
  resolver_version integer,
  authority_fingerprint text,
  resolution_basis jsonb,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;

  v_appointments jsonb := '[]'::jsonb;
  v_authority_basis jsonb;

  v_total_count integer := 0;
  v_active_count integer := 0;
  v_cancelled_count integer := 0;
  v_raw_completed_without_authority_count integer := 0;
  v_canonical_completed_count integer := 0;
  v_structural_conflict_count integer := 0;

  v_assessment_state text;
  v_progress_state text;
  v_reason_code text;
  v_authority_fingerprint text;
  v_resolution_basis jsonb;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_TECHNICAL_VISIT_RESOLVER_SCOPE_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_TECHNICAL_VISIT_RESOLVER_OPPORTUNITY_NOT_FOUND';
  end if;

  with evidence as (
    select
      appointment_row.id as appointment_id,
      appointment_row.status as appointment_status,
      appointment_row.scheduled_start,
      appointment_row.scheduled_end,
      appointment_row.commercial_opportunity_lifecycle_cycle
        as appointment_lifecycle_cycle,

      completion_current.current_completion_event_id,

      completion_event.id as completion_event_id,
      completion_event.commercial_opportunity_id
        as completion_event_opportunity_id,
      completion_event.lifecycle_cycle
        as completion_event_lifecycle_cycle,
      completion_event.completion_outcome,
      completion_event.request_fingerprint
        as completion_event_fingerprint,
      completion_event.event_number
        as completion_event_number,

      (
        completion_event.id is not null
        and (
          appointment_row.status is distinct from 'completed'
          or completion_event.commercial_opportunity_id
               is distinct from p_commercial_opportunity_id
          or completion_event.lifecycle_cycle
               is distinct from v_opportunity.lifecycle_cycle
          or completion_event.completion_outcome
               not in ('fully_completed', 'needs_followup')
        )
      ) as structural_conflict,

      (
        appointment_row.status = 'completed'
        and completion_event.id is not null
        and completion_event.commercial_opportunity_id
              is not distinct from p_commercial_opportunity_id
        and completion_event.lifecycle_cycle
              is not distinct from v_opportunity.lifecycle_cycle
        and completion_event.completion_outcome
              in ('fully_completed', 'needs_followup')
      ) as canonical_completed,

      (
        appointment_row.status = 'completed'
        and completion_event.id is null
      ) as raw_completed_without_authority,

      (
        appointment_row.status in ('scheduled', 'rescheduled')
      ) as active_appointment
    from public.store_appointments appointment_row
    left join public.store_appointment_completion_current completion_current
      on completion_current.organization_id =
           appointment_row.organization_id
     and completion_current.store_id =
           appointment_row.store_id
     and completion_current.appointment_id =
           appointment_row.id
    left join public.store_appointment_completion_events completion_event
      on completion_event.id =
           completion_current.current_completion_event_id
     and completion_event.organization_id =
           completion_current.organization_id
     and completion_event.store_id =
           completion_current.store_id
     and completion_event.appointment_id =
           completion_current.appointment_id
    where appointment_row.organization_id = p_organization_id
      and appointment_row.store_id = p_store_id
      and appointment_row.commercial_opportunity_id =
          p_commercial_opportunity_id
      and appointment_row.commercial_opportunity_lifecycle_cycle =
          v_opportunity.lifecycle_cycle
      and appointment_row.appointment_type = 'technical_visit'
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'appointment_id', evidence.appointment_id,
          'status', evidence.appointment_status,
          'scheduled_start', evidence.scheduled_start,
          'scheduled_end', evidence.scheduled_end,
          'lifecycle_cycle', evidence.appointment_lifecycle_cycle,
          'classification',
            case
              when evidence.structural_conflict
                then 'authority_conflict'
              when evidence.canonical_completed
                then 'canonical_completed'
              when evidence.raw_completed_without_authority
                then 'completed_without_canonical_authority'
              when evidence.active_appointment
                then 'active'
              else 'cancelled'
            end,
          'completion_current_event_id',
            evidence.current_completion_event_id,
          'completion_event',
            case
              when evidence.completion_event_id is null
                then null
              else pg_catalog.jsonb_build_object(
                'id', evidence.completion_event_id,
                'event_number', evidence.completion_event_number,
                'completion_outcome', evidence.completion_outcome,
                'commercial_opportunity_id',
                  evidence.completion_event_opportunity_id,
                'lifecycle_cycle',
                  evidence.completion_event_lifecycle_cycle,
                'request_fingerprint',
                  evidence.completion_event_fingerprint
              )
            end
        )
        order by evidence.appointment_id::text
      ),
      '[]'::jsonb
    ),
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where evidence.active_appointment
    )::integer,
    pg_catalog.count(*) filter (
      where evidence.appointment_status = 'cancelled'
    )::integer,
    pg_catalog.count(*) filter (
      where evidence.raw_completed_without_authority
    )::integer,
    pg_catalog.count(*) filter (
      where evidence.canonical_completed
    )::integer,
    pg_catalog.count(*) filter (
      where evidence.structural_conflict
    )::integer
  into
    v_appointments,
    v_total_count,
    v_active_count,
    v_cancelled_count,
    v_raw_completed_without_authority_count,
    v_canonical_completed_count,
    v_structural_conflict_count
  from evidence;

  if v_structural_conflict_count > 0 then
    v_assessment_state := 'conflict';
    v_progress_state := null;
    v_reason_code := 'technical_visit_authority_conflict';

  elsif v_canonical_completed_count > 0 then
    v_assessment_state := 'determined';
    v_progress_state := 'completed';
    v_reason_code := 'technical_visit_completed_canonical';

  elsif v_raw_completed_without_authority_count > 0 then
    v_assessment_state := 'needs_resolution';
    v_progress_state := null;
    v_reason_code :=
      'technical_visit_completed_without_canonical_authority';

  elsif v_active_count > 0 then
    v_assessment_state := 'determined';
    v_progress_state := 'in_progress';
    v_reason_code := 'technical_visit_active_appointment';

  else
    v_assessment_state := 'determined';
    v_progress_state := 'not_started';

    if v_total_count > 0
       and v_cancelled_count = v_total_count then
      v_reason_code := 'technical_visit_cancelled_only';
    else
      v_reason_code := 'technical_visit_no_current_cycle_appointment';
    end if;
  end if;

  v_authority_basis := pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'resolver_key', 'technical_visit',
    'resolver_version', 1,
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle', v_opportunity.lifecycle_cycle,
    'authority_model',
      'appointment_cycle_anchor_plus_canonical_completion_current',
    'aggregate_counts', pg_catalog.jsonb_build_object(
      'total', v_total_count,
      'active', v_active_count,
      'cancelled', v_cancelled_count,
      'raw_completed_without_authority',
        v_raw_completed_without_authority_count,
      'canonical_completed', v_canonical_completed_count,
      'structural_conflict', v_structural_conflict_count
    ),
    'appointments', v_appointments
  );

  v_authority_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        v_authority_basis::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  v_resolution_basis := pg_catalog.jsonb_build_object(
    'authority', v_authority_basis,
    'decision', pg_catalog.jsonb_build_object(
      'assessment_state', v_assessment_state,
      'progress_state', v_progress_state,
      'reason_code', v_reason_code
    )
  );

  return query
  select
    v_assessment_state,
    v_progress_state,
    'technical_visit'::text,
    1::integer,
    v_authority_fingerprint,
    v_resolution_basis,
    v_reason_code;
end;
$function$;

alter function public.p9_resolve_technical_visit_progress_internal(
  uuid, uuid, uuid
) owner to postgres;

revoke all on function public.p9_resolve_technical_visit_progress_internal(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

comment on function public.p9_resolve_technical_visit_progress_internal(
  uuid, uuid, uuid
) is
  'Internal P9 resolver for technical_visit Progress/Assessment. Consumes current lifecycle-cycle appointment anchors plus explicit canonical appointment completion current authority; never infers completion from raw appointment.status alone and never selects an appointment by latest/max.';

do $postconditions$
declare
  v_function_oid oid;
  v_definition text;
  v_normalized_definition text;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)'
  );

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: technical visit progress resolver is missing';
  end if;

  select
    pg_catalog.pg_get_functiondef(v_function_oid),
    pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_functiondef(v_function_oid),
        '\s+',
        ' ',
        'g'
      )
    )
  into
    v_definition,
    v_normalized_definition;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and proc_row.proowner =
          (
            select role_row.oid
            from pg_catalog.pg_roles role_row
            where role_row.rolname = 'postgres'
          )
      and proc_row.prosecdef is true
      and proc_row.provolatile = 's'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: technical visit resolver ownership/security/stability mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal technical visit resolver leaked to runtime roles';
  end if;

  if v_normalized_definition not like
       '%commercial_opportunity_lifecycle_cycle = v_opportunity.lifecycle_cycle%'
     or v_normalized_definition not like
       '%store_appointment_completion_current%'
     or v_normalized_definition not like
       '%store_appointment_completion_events%'
     or v_normalized_definition not like
       '%technical_visit_completed_without_canonical_authority%'
     or v_normalized_definition not like
       '%technical_visit_completed_canonical%'
     or v_normalized_definition not like
       '%order by evidence.appointment_id::text%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: technical visit resolver authority contract mismatch';
  end if;

  if v_normalized_definition like '%order by%created_at%desc%limit 1%'
     or v_normalized_definition like '%max(version_number)%'
     or v_normalized_definition like '%max(created_at)%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: latest/max authority heuristic detected in technical visit resolver';
  end if;
end;
$postconditions$;

commit;
