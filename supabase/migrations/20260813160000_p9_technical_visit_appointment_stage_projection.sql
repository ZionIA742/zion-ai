do $preflight$
begin
  if pg_catalog.to_regclass('public.store_appointments') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.store_appointments is required';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.commercial_opportunities is required';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.commercial_opportunity_lifecycle_events is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.create_store_appointment(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid)'
  ) is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.create_store_appointment(...) is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'
  ) is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.apply_commercial_opportunity_stage_transition_internal(...) is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)'
  ) is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.compute_commercial_opportunity_event_fingerprint_internal(...) is required';
  end if;
end;
$preflight$;

create or replace function public.create_store_appointment_with_commercial_context(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_address_text text,
  p_notes text,
  p_source text,
  p_created_by_user_id uuid,
  p_commercial_opportunity_id uuid default null
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );
  v_opportunity public.commercial_opportunities;
  v_created_appointment public.store_appointments;
begin
  if (v_request_role not in ('authenticated', 'service_role'))
     and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'create store appointment with commercial context is not authorized';
  end if;

  if p_commercial_opportunity_id is not null then
    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id;

    if not found then
      raise exception using errcode = '23503', message = 'commercial opportunity not found';
    end if;

    if v_opportunity.organization_id is distinct from p_organization_id
       or v_opportunity.store_id is distinct from p_store_id then
      raise exception using errcode = '23514', message = 'commercial opportunity scope mismatch';
    end if;

    if p_lead_id is not null
       and v_opportunity.origin_lead_id is distinct from p_lead_id then
      raise exception using errcode = '23514', message = 'commercial opportunity lead mismatch';
    end if;

    if p_conversation_id is not null then
      if v_opportunity.primary_conversation_id is null then
        raise exception using errcode = '23514', message = 'commercial opportunity conversation missing';
      end if;

      if v_opportunity.primary_conversation_id is distinct from p_conversation_id then
        raise exception using errcode = '23514', message = 'commercial opportunity conversation mismatch';
      end if;
    end if;
  end if;

  select *
  into v_created_appointment
  from public.create_store_appointment(
    p_organization_id,
    p_store_id,
    p_lead_id,
    p_conversation_id,
    p_title,
    p_appointment_type,
    p_status,
    p_scheduled_start,
    p_scheduled_end,
    p_customer_name,
    p_customer_phone,
    p_address_text,
    p_notes,
    p_source,
    p_created_by_user_id
  );

  if p_commercial_opportunity_id is not null then
    update public.store_appointments appointment_row
    set commercial_opportunity_id = p_commercial_opportunity_id
    where appointment_row.id = v_created_appointment.id
    returning appointment_row.*
    into v_created_appointment;
  end if;

  return v_created_appointment;
end;
$function$;

create or replace function public.advance_commercial_opportunity_to_technical_visit_stage_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_reason_details text,
  p_source text,
  p_actor_type text,
  p_actor_user_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  appointment_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed boolean,
  outcome text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_evidence_type constant text := 'technical_visit_scheduled';
  v_opportunity public.commercial_opportunities;
  v_appointment public.store_appointments;
  v_existing_event public.commercial_opportunity_lifecycle_events;
  v_internal_event public.commercial_opportunity_lifecycle_events;
  v_internal_result record;
  v_stored_event_key text;
  v_candidate_event_key text;
  v_evidence_summary text;
  v_reason_code text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_appointment_id is null
     or v_idempotency_key is null
     or v_source is null
     or p_actor_type not in ('human', 'system') then
    raise exception using errcode = '22023', message = 'ZION_TECHNICAL_VISIT_STAGE_ADVANCE_ARGUMENTS_REQUIRED';
  end if;

  v_evidence_summary := 'appointment_id=' || p_appointment_id::text;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using errcode = '23514', message = 'commercial opportunity scope mismatch';
  end if;

  select appointment_row.*
  into v_appointment
  from public.store_appointments appointment_row
  where appointment_row.id = p_appointment_id;

  if not found then
    raise exception using errcode = '23503', message = 'store appointment not found';
  end if;

  if v_appointment.organization_id is distinct from p_organization_id
     or v_appointment.store_id is distinct from p_store_id then
    raise exception using errcode = '23514', message = 'store appointment scope mismatch';
  end if;

  if v_appointment.commercial_opportunity_id is null then
    raise exception using errcode = '23514', message = 'store appointment is not linked to a commercial opportunity';
  end if;

  if v_appointment.commercial_opportunity_id is distinct from v_opportunity.id then
    raise exception using errcode = '23514', message = 'store appointment opportunity mismatch';
  end if;

  if v_appointment.appointment_type is distinct from 'technical_visit' then
    raise exception using errcode = '23514', message = 'store appointment is not a technical visit';
  end if;

  if v_appointment.status not in ('scheduled', 'rescheduled') then
    raise exception using errcode = '23514', message = 'store appointment is not eligible for technical visit stage projection';
  end if;

  select lifecycle_event.*
  into v_existing_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.organization_id = v_opportunity.organization_id
    and lifecycle_event.store_id = v_opportunity.store_id
    and lifecycle_event.commercial_opportunity_id = v_opportunity.id
    and lifecycle_event.idempotency_key = v_idempotency_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'stage_transition'
       or v_existing_event.previous_stage not in ('novo_lead', 'qualificacao', 'orcamento')
       or v_existing_event.new_stage <> 'visita_tecnica'
       or v_existing_event.actor_type is distinct from p_actor_type
       or (p_actor_type = 'human' and v_existing_event.actor_user_id is distinct from p_actor_user_id)
       or (p_actor_type = 'system' and v_existing_event.actor_user_id is not null) then
      raise exception using errcode = '23505', message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      v_existing_event.event_type,
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      v_existing_event.actor_type,
      v_existing_event.actor_user_id,
      v_existing_event.reason_code,
      v_existing_event.reason_details,
      v_existing_event.source,
      v_existing_event.evidence_type,
      v_existing_event.evidence_message_id,
      v_existing_event.evidence_summary
    );

    if v_existing_event.event_key is distinct from v_stored_event_key then
      raise exception using errcode = 'P0001', message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    v_reason_code := case
      when v_existing_event.previous_stage in ('novo_lead', 'qualificacao') then 'visit_eligibility_required'
      else 'visit_required_or_eligible'
    end;

    v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      'stage_transition',
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      p_actor_type,
      p_actor_user_id,
      v_reason_code,
      v_reason_details,
      v_source,
      v_evidence_type,
      null,
      v_evidence_summary
    );

    if v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.evidence_type is distinct from v_evidence_type
       or v_existing_event.evidence_message_id is not null
       or v_candidate_event_key is distinct from v_existing_event.event_key then
      raise exception using errcode = '23505', message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_opportunity.id,
      p_appointment_id,
      v_opportunity.stage,
      v_opportunity.lifecycle_cycle,
      v_existing_event.id,
      v_existing_event.event_type,
      v_existing_event.reason_code,
      false,
      'idempotent_replay'::text,
      v_opportunity.stage_changed_at,
      v_opportunity.updated_at;
    return;
  end if;

  if v_opportunity.stage in ('novo_lead', 'qualificacao', 'orcamento') then
    v_reason_code := case
      when v_opportunity.stage in ('novo_lead', 'qualificacao') then 'visit_eligibility_required'
      else 'visit_required_or_eligible'
    end;

    select *
    into v_internal_result
    from public.apply_commercial_opportunity_stage_transition_internal(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      v_idempotency_key,
      'visita_tecnica',
      v_reason_details,
      v_evidence_type,
      null,
      v_evidence_summary,
      v_source,
      'stage_transition',
      p_actor_type,
      p_actor_user_id
    );

    select lifecycle_event.*
    into v_internal_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.id = v_internal_result.lifecycle_event_id;

    if not found
       or v_internal_result.commercial_opportunity_id is distinct from v_opportunity.id
       or v_internal_result.stage is distinct from 'visita_tecnica'
       or v_internal_result.lifecycle_event_id is null
       or v_internal_event.reason_code is distinct from v_reason_code
       or v_internal_event.new_stage is distinct from 'visita_tecnica'
       or v_internal_event.evidence_type is distinct from v_evidence_type
       or v_internal_event.evidence_summary is distinct from v_evidence_summary then
      raise exception using errcode = 'P0001', message = 'ZION_TECHNICAL_VISIT_STAGE_ADVANCE_INTERNAL_CONTRACT_MISMATCH';
    end if;

    return query
    select
      v_internal_result.commercial_opportunity_id,
      p_appointment_id,
      v_internal_result.stage,
      v_internal_result.lifecycle_cycle,
      v_internal_result.lifecycle_event_id,
      v_internal_result.event_type,
      v_internal_result.reason_code,
      true,
      'advanced_to_visita_tecnica'::text,
      v_internal_result.stage_changed_at,
      v_internal_result.updated_at;
    return;
  end if;

  if v_opportunity.stage = 'visita_tecnica' then
    return query
    select
      v_opportunity.id,
      p_appointment_id,
      v_opportunity.stage,
      v_opportunity.lifecycle_cycle,
      null::uuid,
      null::text,
      null::text,
      false,
      'already_in_visit_stage'::text,
      v_opportunity.stage_changed_at,
      v_opportunity.updated_at;
    return;
  end if;

  return query
  select
    v_opportunity.id,
    p_appointment_id,
    v_opportunity.stage,
    v_opportunity.lifecycle_cycle,
    null::uuid,
    null::text,
    null::text,
    false,
    'stage_not_eligible_for_automatic_visit_projection'::text,
    v_opportunity.stage_changed_at,
    v_opportunity.updated_at;
end;
$function$;

create or replace function public.advance_commercial_opportunity_to_technical_visit_stage_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_source text default 'user_technical_visit_stage_projection'
)
returns table (
  commercial_opportunity_id uuid,
  appointment_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed boolean,
  outcome text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using errcode = '42501', message = 'technical visit stage projection by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'technical visit stage projection by user is not authorized';
  end if;

  return query
  select *
  from public.advance_commercial_opportunity_to_technical_visit_stage_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_appointment_id,
    p_idempotency_key,
    p_reason_details,
    p_source,
    'human',
    v_user_id
  );
end;
$function$;

create or replace function public.advance_commercial_opportunity_to_technical_visit_stage_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_reason_details text default null,
  p_source text default 'system_technical_visit_stage_projection'
)
returns table (
  commercial_opportunity_id uuid,
  appointment_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed boolean,
  outcome text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'technical visit stage projection by system is not authorized';
  end if;

  return query
  select *
  from public.advance_commercial_opportunity_to_technical_visit_stage_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_appointment_id,
    p_idempotency_key,
    p_reason_details,
    p_source,
    'system',
    null
  );
end;
$function$;

revoke all on function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, text, text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, text, text, text, text, uuid, uuid
) to authenticated, service_role;

revoke all on function public.advance_commercial_opportunity_to_technical_visit_stage_internal(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.advance_commercial_opportunity_to_technical_visit_stage_by_user(
  uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.advance_commercial_opportunity_to_technical_visit_stage_by_user(
  uuid, uuid, uuid, uuid, text, text, text
) to authenticated;

revoke all on function public.advance_commercial_opportunity_to_technical_visit_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.advance_commercial_opportunity_to_technical_visit_stage_by_system(
  uuid, uuid, uuid, uuid, text, text, text
) to service_role;

do $postconditions$
declare
  v_create_wrapper oid := pg_catalog.to_regprocedure(
    'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'
  );
  v_writer_internal oid := pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_technical_visit_stage_internal(uuid,uuid,uuid,uuid,text,text,text,text,uuid)'
  );
  v_writer_user oid := pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_technical_visit_stage_by_user(uuid,uuid,uuid,uuid,text,text,text)'
  );
  v_writer_system oid := pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_technical_visit_stage_by_system(uuid,uuid,uuid,uuid,text,text,text)'
  );
  v_create_definition text;
  v_writer_system_definition text;
  v_writer_internal_definition text;
begin
  if v_create_wrapper is null
     or v_writer_internal is null
     or v_writer_user is null
     or v_writer_system is null then
    raise exception using errcode = 'P0001', message = 'postcondition failed: technical visit appointment functions were not created';
  end if;

  select lower(regexp_replace(pg_catalog.pg_get_functiondef(v_create_wrapper), '\s+', ' ', 'g'))
  into v_create_definition;

  if v_create_definition not like '%create_store_appointment(%'
     or v_create_definition not like '%commercial opportunity%'
     or v_create_definition not like '%commercial_opportunity_id%' then
    raise exception using errcode = 'P0001', message = 'postcondition failed: appointment commercial wrapper definition mismatch';
  end if;

  select lower(regexp_replace(pg_catalog.pg_get_functiondef(v_writer_system), '\s+', ' ', 'g'))
  into v_writer_system_definition;

  if v_writer_system_definition not like '%advance_commercial_opportunity_to_technical_visit_stage_internal%'
     or v_writer_system_definition not like '%''system''%'
     or v_writer_system_definition not like '%service_role%' then
    raise exception using errcode = 'P0001', message = 'postcondition failed: technical visit system writer definition mismatch';
  end if;

  select lower(regexp_replace(pg_catalog.pg_get_functiondef(v_writer_internal), '\s+', ' ', 'g'))
  into v_writer_internal_definition;

  if v_writer_internal_definition not like '%for update%'
     or v_writer_internal_definition not like '%technical_visit%'
     or v_writer_internal_definition not like '%visita_tecnica%'
     or v_writer_internal_definition like '%transition_commercial_opportunity_stage_by_system%' then
    raise exception using errcode = 'P0001', message = 'postcondition failed: technical visit internal writer definition mismatch';
  end if;
end;
$postconditions$;
