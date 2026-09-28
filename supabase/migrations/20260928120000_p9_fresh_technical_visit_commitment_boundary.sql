begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:7.2:fresh-technical-visit-boundary:v2', 0)
);

-- P9 / Bloco 7 / Etapa 7.2
-- A technical_visit real is created only through this service-role boundary.

create or replace function public.p9_create_technical_visit_physical_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_address_text text,
  p_notes text,
  p_source text,
  p_created_by_user_id uuid,
  p_commercial_opportunity_id uuid,
  p_commercial_opportunity_lifecycle_cycle integer
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_row public.store_appointments;
  v_has_appointment_conflict boolean;
  v_has_block_conflict boolean;
  v_within_operating_window boolean;
begin
  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'T??tulo do compromisso ?? obrigat??rio.';
  end if;

  if p_scheduled_start is null or p_scheduled_end is null
     or p_scheduled_end <= p_scheduled_start then
    raise exception 'Per??odo do compromisso ?? inv??lido.';
  end if;

  if p_status is distinct from 'scheduled' then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_NEW_COMMITMENT_STATUS_MUST_BE_SCHEDULED';
  end if;

  if p_source not in ('panel', 'ai_operator', 'system') then
    raise exception 'Origem inv??lida.';
  end if;

  select public.is_store_appointment_within_operating_window(
    p_organization_id, p_store_id, 'technical_visit',
    p_scheduled_start, p_scheduled_end
  ) into v_within_operating_window;

  if not v_within_operating_window then
    raise exception 'Esse compromisso est?? fora da janela operacional configurada da loja.';
  end if;

  select public.has_store_appointment_conflict(
    p_organization_id, p_store_id, p_scheduled_start, p_scheduled_end, null
  ) into v_has_appointment_conflict;

  if v_has_appointment_conflict then
    raise exception 'J?? existe outro compromisso nesse hor??rio.';
  end if;

  select public.has_store_schedule_block_conflict(
    p_organization_id, p_store_id, p_scheduled_start, p_scheduled_end
  ) into v_has_block_conflict;

  if v_has_block_conflict then
    raise exception 'Existe um bloqueio de agenda nesse hor??rio.';
  end if;

  insert into public.store_appointments (
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    customer_name,
    customer_phone,
    address_text,
    notes,
    source,
    created_by_user_id,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle
  ) values (
    p_organization_id,
    p_store_id,
    p_lead_id,
    p_conversation_id,
    pg_catalog.btrim(p_title),
    'technical_visit',
    p_status,
    p_scheduled_start,
    p_scheduled_end,
    p_customer_name,
    p_customer_phone,
    p_address_text,
    p_notes,
    p_source,
    p_created_by_user_id,
    p_commercial_opportunity_id,
    p_commercial_opportunity_lifecycle_cycle
  ) returning * into v_row;

  perform public.log_schedule_conversation_event(
    p_organization_id,
    v_row.conversation_id,
    'compromisso_agendado',
    'schedule_panel',
    pg_catalog.jsonb_build_object(
      'appointment_id', v_row.id,
      'appointment_type', v_row.appointment_type,
      'commercial_opportunity_id', v_row.commercial_opportunity_id,
      'commercial_opportunity_lifecycle_cycle', v_row.commercial_opportunity_lifecycle_cycle,
      'title', v_row.title,
      'status', v_row.status,
      'scheduled_start', v_row.scheduled_start,
      'scheduled_end', v_row.scheduled_end,
      'source', v_row.source
    )
  );

  return v_row;
end;
$function$;

alter function public.p9_create_technical_visit_physical_internal(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, integer
) owner to postgres;

revoke all on function public.p9_create_technical_visit_physical_internal(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, integer
) from public, anon, authenticated, service_role;

create or replace function public.create_technical_visit_with_fresh_commercial_readiness_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_address_text text,
  p_notes text,
  p_source text,
  p_created_by_user_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text default null
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_opportunity public.commercial_opportunities;
  v_checklist record;
  v_progress record;
  v_readiness record;
  v_available boolean;
  v_availability_reason text;
  v_event_identity text;
  v_event_key text;
  v_effective_lead_id uuid;
  v_effective_conversation_id uuid;
  v_row public.store_appointments;
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'ZION_TECHNICAL_VISIT_BOUNDARY_SERVICE_ROLE_REQUIRED';
  end if;

  if p_organization_id is null or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_title is null or pg_catalog.btrim(p_title) = ''
     or p_scheduled_start is null or p_scheduled_end is null
     or p_scheduled_end <= p_scheduled_start then
    raise exception using errcode = '22023',
      message = 'ZION_TECHNICAL_VISIT_BOUNDARY_ARGUMENTS_REQUIRED';
  end if;

  if p_status is distinct from 'scheduled' then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_NEW_COMMITMENT_STATUS_MUST_BE_SCHEDULED';
  end if;

  select opportunity_row.* into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = '23503',
      message = 'ZION_TECHNICAL_VISIT_BOUNDARY_OPPORTUNITY_SCOPE_NOT_FOUND';
  end if;

  if p_lead_id is not null
     and v_opportunity.origin_lead_id is distinct from p_lead_id then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_BOUNDARY_LEAD_MISMATCH';
  end if;

  if p_conversation_id is not null
     and v_opportunity.primary_conversation_id is distinct from p_conversation_id then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_BOUNDARY_CONVERSATION_MISMATCH';
  end if;

  v_effective_lead_id := coalesce(p_lead_id, v_opportunity.origin_lead_id);
  v_effective_conversation_id := coalesce(
    p_conversation_id,
    v_opportunity.primary_conversation_id
  );

  v_event_identity := coalesce(
    nullif(pg_catalog.btrim(p_operation_key), ''),
    'technical_visit_commitment:' || p_commercial_opportunity_id::text || ':' ||
      p_scheduled_start::text || ':' || p_scheduled_end::text
  );

  -- Materializer event keys are capped at 160 chars. Hash the external
  -- operation identity so long Assistant keys stay deterministic and bounded.
  v_event_key :=
    'p9:7.2:technical-visit:' ||
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_event_identity, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

  select * into strict v_checklist
  from public.materialize_commercial_opportunity_checklist_by_system(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_event_key || ':checklist'
  );

  select * into strict v_progress
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_event_key || ':progress'
  );

  select * into strict v_readiness
  from public.read_commercial_action_readiness_scoped(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    'schedule_technical_visit'
  );

  if v_readiness.readiness_state is distinct from 'ready' then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_READINESS_NOT_READY:' ||
        coalesce(v_readiness.readiness_state, 'unknown') || ':' ||
        coalesce(v_readiness.reason_code, 'unknown');
  end if;

  select availability_row.available, availability_row.reason_code
  into v_available, v_availability_reason
  from public.check_store_appointment_availability_by_system(
    p_organization_id,
    p_store_id,
    'technical_visit',
    p_scheduled_start,
    p_scheduled_end,
    null
  ) availability_row;

  if v_available is not true then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_UNAVAILABLE:' ||
        coalesce(v_availability_reason, 'unknown');
  end if;

  select * into v_row
  from public.p9_create_technical_visit_physical_internal(
    p_organization_id,
    p_store_id,
    v_effective_lead_id,
    v_effective_conversation_id,
    p_title,
    p_status,
    p_scheduled_start,
    p_scheduled_end,
    p_customer_name,
    p_customer_phone,
    p_address_text,
    p_notes,
    p_source,
    p_created_by_user_id,
    p_commercial_opportunity_id,
    v_opportunity.lifecycle_cycle
  );

  return v_row;
end;
$function$;

alter function public.create_technical_visit_with_fresh_commercial_readiness_by_system(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, text
) owner to postgres;

revoke all on function public.create_technical_visit_with_fresh_commercial_readiness_by_system(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_technical_visit_with_fresh_commercial_readiness_by_system(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, text
) to service_role;

-- Preserve the established generic writers for non-technical types while making
-- the technical type unreachable through their public signatures.
alter function public.create_store_appointment(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid
) rename to p9_create_store_appointment_legacy;

create or replace function public.create_store_appointment(
  p_organization_id uuid, p_store_id uuid, p_lead_id uuid,
  p_conversation_id uuid, p_title text, p_appointment_type text,
  p_status text, p_scheduled_start timestamptz, p_scheduled_end timestamptz,
  p_customer_name text default null, p_customer_phone text default null,
  p_address_text text default null, p_notes text default null,
  p_source text default 'panel', p_created_by_user_id uuid default null
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if p_appointment_type = 'technical_visit' then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_REQUIRES_FRESH_COMMERCIAL_BOUNDARY';
  end if;

  return public.p9_create_store_appointment_legacy(
    p_organization_id, p_store_id, p_lead_id, p_conversation_id,
    p_title, p_appointment_type, p_status, p_scheduled_start,
    p_scheduled_end, p_customer_name, p_customer_phone, p_address_text,
    p_notes, p_source, p_created_by_user_id
  );
end;
$function$;

alter function public.create_store_appointment(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid
) owner to postgres;
revoke all on function public.create_store_appointment(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_store_appointment(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid
) to authenticated, service_role;
revoke all on function public.p9_create_store_appointment_legacy(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

alter function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid
) rename to p9_create_store_appointment_with_commercial_context_legacy;

create or replace function public.create_store_appointment_with_commercial_context(
  p_organization_id uuid, p_store_id uuid, p_lead_id uuid,
  p_conversation_id uuid, p_title text, p_appointment_type text,
  p_status text, p_scheduled_start timestamptz, p_scheduled_end timestamptz,
  p_customer_name text, p_customer_phone text, p_address_text text,
  p_notes text, p_source text, p_created_by_user_id uuid,
  p_commercial_opportunity_id uuid default null
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if p_appointment_type = 'technical_visit' then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_REQUIRES_FRESH_COMMERCIAL_BOUNDARY';
  end if;

  return public.p9_create_store_appointment_with_commercial_context_legacy(
    p_organization_id, p_store_id, p_lead_id, p_conversation_id,
    p_title, p_appointment_type, p_status, p_scheduled_start,
    p_scheduled_end, p_customer_name, p_customer_phone, p_address_text,
    p_notes, p_source, p_created_by_user_id, p_commercial_opportunity_id
  );
end;
$function$;

alter function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid
) owner to postgres;
revoke all on function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid
) to authenticated, service_role;
revoke all on function public.p9_create_store_appointment_with_commercial_context_legacy(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;

alter function public.update_store_appointment(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) rename to p9_update_store_appointment_legacy;

create or replace function public.update_store_appointment(
  p_appointment_id uuid, p_organization_id uuid, p_store_id uuid,
  p_title text, p_appointment_type text, p_status text,
  p_scheduled_start timestamptz, p_scheduled_end timestamptz,
  p_customer_name text default null, p_customer_phone text default null,
  p_address_text text default null, p_notes text default null
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_existing_type text;
begin
  select appointment_row.appointment_type
  into v_existing_type
  from public.store_appointments appointment_row
  where appointment_row.id = p_appointment_id
    and appointment_row.organization_id = p_organization_id
    and appointment_row.store_id = p_store_id;

  if p_appointment_type = 'technical_visit'
     or v_existing_type = 'technical_visit' then
    if p_appointment_type is distinct from v_existing_type then
      raise exception using errcode = '23514',
        message = 'ZION_TECHNICAL_VISIT_TYPE_IMMUTABLE';
    end if;
  end if;

  return public.p9_update_store_appointment_legacy(
    p_appointment_id, p_organization_id, p_store_id, p_title,
    p_appointment_type, p_status, p_scheduled_start, p_scheduled_end,
    p_customer_name, p_customer_phone, p_address_text, p_notes
  );
end;
$function$;

alter function public.update_store_appointment(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) owner to postgres;
revoke all on function public.update_store_appointment(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.update_store_appointment(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) to authenticated, service_role;
revoke all on function public.p9_update_store_appointment_legacy(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.p9_store_appointment_guard_technical_visit_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
begin
  if tg_op = 'UPDATE'
     and old.appointment_type is distinct from new.appointment_type
     and (
       old.appointment_type = 'technical_visit'
       or new.appointment_type = 'technical_visit'
     ) then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_TYPE_IMMUTABLE';
  end if;

  if new.appointment_type <> 'technical_visit' then
    return new;
  end if;

  -- Legacy compatibility: pre-7.2 technical_visit rows that are missing their
  -- commercial anchor are preserved as historical data. They may receive only
  -- non-structural edits (title/status/time/etc.) while every structural identity
  -- field remains byte-for-byte unchanged. New invalid rows remain impossible.
  if tg_op = 'UPDATE'
     and old.appointment_type = 'technical_visit'
     and new.appointment_type = 'technical_visit'
     and (
       old.commercial_opportunity_id is null
       or old.commercial_opportunity_lifecycle_cycle is null
     )
     and new.organization_id is not distinct from old.organization_id
     and new.store_id is not distinct from old.store_id
     and new.lead_id is not distinct from old.lead_id
     and new.conversation_id is not distinct from old.conversation_id
     and new.commercial_opportunity_id is not distinct from old.commercial_opportunity_id
     and new.commercial_opportunity_lifecycle_cycle
           is not distinct from old.commercial_opportunity_lifecycle_cycle then
    return new;
  end if;

  if new.commercial_opportunity_id is null
     or new.commercial_opportunity_lifecycle_cycle is null then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_COMMERCIAL_ANCHOR_REQUIRED';
  end if;

  select opportunity_row.* into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = new.commercial_opportunity_id
    and opportunity_row.organization_id = new.organization_id
    and opportunity_row.store_id = new.store_id;

  if not found then
    raise exception using errcode = '23503',
      message = 'ZION_TECHNICAL_VISIT_OPPORTUNITY_SCOPE_NOT_FOUND';
  end if;

  if new.commercial_opportunity_lifecycle_cycle
       is distinct from v_opportunity.lifecycle_cycle then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_LIFECYCLE_CYCLE_MISMATCH';
  end if;

  if new.lead_id is not null
     and v_opportunity.origin_lead_id is distinct from new.lead_id then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_LEAD_MISMATCH';
  end if;

  if new.conversation_id is not null
     and v_opportunity.primary_conversation_id is distinct from new.conversation_id then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_CONVERSATION_MISMATCH';
  end if;

  if tg_op = 'UPDATE'
     and old.appointment_type = 'technical_visit'
     and (
       new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
       or new.commercial_opportunity_lifecycle_cycle
            is distinct from old.commercial_opportunity_lifecycle_cycle
     ) then
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_COMMERCIAL_ANCHOR_IMMUTABLE';
  end if;

  return new;
end;
$function$;

alter function public.p9_store_appointment_guard_technical_visit_internal()
  owner to postgres;
revoke all on function public.p9_store_appointment_guard_technical_visit_internal()
  from public, anon, authenticated, service_role;

do $preflight$
declare
  v_legacy_missing_anchor_count integer := 0;
begin
  -- Fail closed only for legacy rows that claim to have a complete commercial
  -- anchor but whose anchor is contradictory/corrupt. Those rows require an
  -- explicit remediation because the database cannot safely infer intent.
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
    raise exception using errcode = '23514',
      message = 'ZION_TECHNICAL_VISIT_LEGACY_CORRUPT_ANCHOR_REQUIRES_EXPLICIT_REMEDIATION';
  end if;

  -- Missing-anchor rows are legacy, pre-7.2 data. Do not guess, backfill, delete
  -- or reinterpret them in this migration. The trigger below grandfathers only
  -- non-structural edits on those existing rows while enforcing the new contract
  -- for every new technical_visit.
  select pg_catalog.count(*)::integer
  into v_legacy_missing_anchor_count
  from public.store_appointments appointment_row
  where appointment_row.appointment_type = 'technical_visit'
    and (
      appointment_row.commercial_opportunity_id is null
      or appointment_row.commercial_opportunity_lifecycle_cycle is null
    );

  if v_legacy_missing_anchor_count > 0 then
    raise notice
      'P9_72_LEGACY_TECHNICAL_VISITS_GRANDFATHERED_WITHOUT_BACKFILL=%',
      v_legacy_missing_anchor_count;
  end if;
end;
$preflight$;

drop trigger if exists store_appointments_guard_technical_visit_commitment
  on public.store_appointments;

create trigger store_appointments_guard_technical_visit_commitment
before insert or update of
  organization_id,
  store_id,
  appointment_type,
  commercial_opportunity_id,
  commercial_opportunity_lifecycle_cycle,
  lead_id,
  conversation_id
on public.store_appointments
for each row
execute function public.p9_store_appointment_guard_technical_visit_internal();

alter function public.create_assistant_appointment_by_task_atomic(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, timestamptz, timestamptz
) rename to p9_create_assistant_appointment_by_task_atomic_legacy;

create or replace function public.create_assistant_appointment_by_task_atomic(
  p_task_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_expected_operation_key text,
  p_expected_lead_id uuid,
  p_expected_conversation_id uuid,
  p_expected_commercial_opportunity_id uuid,
  p_expected_appointment_type text,
  p_expected_start_at timestamptz,
  p_expected_end_at timestamptz
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_task public.store_assistant_operational_tasks;
  v_existing public.store_appointments;
  v_created public.store_appointments;
  v_operation_key text;
  v_appointment_type text;
  v_appointment_title text;
  v_write_succeeded boolean := false;
  v_available boolean;
  v_reason_code text;
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_NOT_AUTHORIZED';
  end if;

  if p_task_id is null or p_organization_id is null or p_store_id is null
     or p_expected_lead_id is null or p_expected_conversation_id is null
     or p_expected_start_at is null or p_expected_end_at is null
     or p_expected_end_at <= p_expected_start_at then
    raise exception using errcode = '22023',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_ARGUMENTS_INVALID';
  end if;

  v_operation_key := nullif(pg_catalog.btrim(p_expected_operation_key), '');
  if v_operation_key is null then
    raise exception using errcode = '22023',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_OPERATION_KEY_REQUIRED';
  end if;

  if p_expected_appointment_type not in ('technical_visit', 'installation') then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_TYPE_NOT_ALLOWED';
  end if;

  select task_row.* into v_task
  from public.store_assistant_operational_tasks task_row
  where task_row.id = p_task_id
    and task_row.organization_id = p_organization_id
    and task_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'ZION_ASSISTANT_CREATE_TASK_NOT_FOUND';
  end if;

  if v_task.task_type <> 'appointment_create_with_customer' then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_TASK_TYPE_MISMATCH';
  end if;

  if nullif(pg_catalog.btrim(v_task.task_payload ->> 'operation_key'), '')
       is distinct from v_operation_key
     or v_task.related_lead_id is distinct from p_expected_lead_id
     or v_task.related_conversation_id is distinct from p_expected_conversation_id
     or v_task.commercial_opportunity_id is distinct from p_expected_commercial_opportunity_id
     or v_task.target_start_at is distinct from p_expected_start_at
     or v_task.target_end_at is distinct from p_expected_end_at then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_TASK_IDENTITY_OR_WINDOW_MISMATCH';
  end if;

  v_appointment_type := nullif(
    pg_catalog.btrim(v_task.task_payload ->> 'appointment_type'), ''
  );
  if v_appointment_type is distinct from p_expected_appointment_type then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_TYPE_MISMATCH';
  end if;

  if pg_catalog.jsonb_typeof(v_task.task_payload -> 'appointment_write_succeeded') = 'boolean' then
    v_write_succeeded := (v_task.task_payload ->> 'appointment_write_succeeded')::boolean;
  end if;

  if v_write_succeeded is true or v_task.related_appointment_id is not null then
    if v_write_succeeded is not true or v_task.related_appointment_id is null
       or v_task.task_payload ->> 'appointment_id' is distinct from v_task.related_appointment_id::text
       or (v_task.task_payload ->> 'agenda_updated')::boolean is not true
       or (v_task.task_payload ->> 'atomic_appointment_write_completed')::boolean is not true then
      raise exception using errcode = '23514',
        message = 'ZION_ASSISTANT_CREATE_POST_WRITE_MARKER_INCONSISTENT';
    end if;

    select appointment_row.* into v_existing
    from public.store_appointments appointment_row
    where appointment_row.id = v_task.related_appointment_id
      and appointment_row.organization_id = p_organization_id
      and appointment_row.store_id = p_store_id
    for key share;

    if not found
       or v_existing.lead_id is distinct from p_expected_lead_id
       or v_existing.conversation_id is distinct from p_expected_conversation_id
       or v_existing.commercial_opportunity_id is distinct from p_expected_commercial_opportunity_id
       or v_existing.appointment_type is distinct from p_expected_appointment_type
       or v_existing.scheduled_start is distinct from p_expected_start_at
       or v_existing.scheduled_end is distinct from p_expected_end_at
       or v_existing.status <> 'scheduled' then
      raise exception using errcode = '23514',
        message = 'ZION_ASSISTANT_CREATE_MARKED_APPOINTMENT_MISMATCH';
    end if;

    return v_existing;
  end if;

  if p_expected_appointment_type = 'installation' then
    return public.p9_create_assistant_appointment_by_task_atomic_legacy(
      p_task_id, p_organization_id, p_store_id, p_expected_operation_key,
      p_expected_lead_id, p_expected_conversation_id,
      p_expected_commercial_opportunity_id, p_expected_appointment_type,
      p_expected_start_at, p_expected_end_at
    );
  end if;

  if v_task.status <> 'waiting_customer_response' then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_TASK_NOT_WAITING_CUSTOMER_RESPONSE';
  end if;

  v_appointment_title := nullif(pg_catalog.btrim(v_task.task_payload ->> 'title'), '');
  if v_appointment_title is null then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_TITLE_REQUIRED';
  end if;

  if nullif(pg_catalog.btrim(v_task.task_payload ->> 'last_customer_reply_decision_type'), '')
       not in ('confirmed', 'suggested_other_time')
     or nullif(pg_catalog.btrim(v_task.task_payload ->> 'last_customer_reply_message_id'), '') is null
     or nullif(pg_catalog.btrim(v_task.task_payload ->> 'last_processed_queue_id'), '') is null
     or nullif(pg_catalog.btrim(v_task.task_payload ->> 'last_processed_conversation_id'), '') is null
     or pg_catalog.btrim(v_task.task_payload ->> 'last_processed_conversation_id')
          is distinct from v_task.related_conversation_id::text then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_CUSTOMER_CONFIRMATION_REQUIRED';
  end if;

  if nullif(pg_catalog.btrim(v_task.task_payload ->> 'last_customer_reply_decision_type'), '')
       = 'suggested_other_time'
     and (
       pg_catalog.jsonb_typeof(v_task.task_payload -> 'suggested_time_available') is distinct from 'boolean'
       or (v_task.task_payload ->> 'suggested_time_available')::boolean is not true
       or (v_task.task_payload ->> 'suggested_start_at')::timestamptz is distinct from p_expected_start_at
       or (v_task.task_payload ->> 'suggested_end_at')::timestamptz is distinct from p_expected_end_at
     ) then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_CUSTOMER_SUGGESTED_WINDOW_NOT_AUTHORIZED';
  end if;

  if p_expected_commercial_opportunity_id is null then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_TECHNICAL_VISIT_OPPORTUNITY_REQUIRED';
  end if;

  if not exists (
    select 1 from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_expected_commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
      and opportunity_row.origin_lead_id = p_expected_lead_id
      and opportunity_row.primary_conversation_id = p_expected_conversation_id
  ) then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_TECHNICAL_VISIT_OPPORTUNITY_MISMATCH';
  end if;

  select availability_row.available, availability_row.reason_code
  into v_available, v_reason_code
  from public.check_store_appointment_availability_by_system(
    p_organization_id, p_store_id, 'technical_visit',
    p_expected_start_at, p_expected_end_at, null
  ) availability_row;

  if v_available is not true then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_UNAVAILABLE:' || coalesce(v_reason_code, 'unknown');
  end if;

  select * into v_created
  from public.create_technical_visit_with_fresh_commercial_readiness_by_system(
    p_organization_id,
    p_store_id,
    p_expected_lead_id,
    p_expected_conversation_id,
    v_appointment_title,
    'scheduled',
    p_expected_start_at,
    p_expected_end_at,
    v_task.customer_name,
    v_task.customer_phone,
    nullif(pg_catalog.btrim(v_task.task_payload ->> 'address_text'), ''),
    'Criado pela assistente apos confirmacao do cliente.',
    'ai_operator',
    null,
    p_expected_commercial_opportunity_id,
    v_operation_key
  );

  if v_created.id is null
     or v_created.organization_id is distinct from p_organization_id
     or v_created.store_id is distinct from p_store_id
     or v_created.lead_id is distinct from p_expected_lead_id
     or v_created.conversation_id is distinct from p_expected_conversation_id
     or v_created.commercial_opportunity_id is distinct from p_expected_commercial_opportunity_id
     or v_created.appointment_type is distinct from p_expected_appointment_type
     or v_created.scheduled_start is distinct from p_expected_start_at
     or v_created.scheduled_end is distinct from p_expected_end_at
     or v_created.status <> 'scheduled' then
    raise exception using errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_WRITER_RESULT_MISMATCH';
  end if;

  update public.store_assistant_operational_tasks task_row
  set related_appointment_id = v_created.id,
      task_payload = coalesce(task_row.task_payload, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'appointment_id', v_created.id,
          'appointment_write_succeeded', true,
          'agenda_updated', true,
          'appointment_created_at', v_created.created_at,
          'atomic_appointment_write_completed', true
        ),
      last_action_at = pg_catalog.transaction_timestamp(),
      updated_at = pg_catalog.transaction_timestamp()
  where task_row.id = p_task_id
    and task_row.organization_id = p_organization_id
    and task_row.store_id = p_store_id;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'ZION_ASSISTANT_CREATE_TASK_ATOMIC_MARKER_UPDATE_FAILED';
  end if;

  return v_created;
end;
$function$;

alter function public.create_assistant_appointment_by_task_atomic(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, timestamptz, timestamptz
) owner to postgres;
revoke all on function public.create_assistant_appointment_by_task_atomic(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.create_assistant_appointment_by_task_atomic(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, timestamptz, timestamptz
) to service_role;
revoke all on function public.p9_create_assistant_appointment_by_task_atomic_legacy(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

revoke insert, update on table public.store_appointments from authenticated, service_role;

commit;