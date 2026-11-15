begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:7.2:fresh-technical-visit-boundary:v2', 0)
);

create table if not exists public.p9_human_technical_visit_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  actor_user_id uuid not null,
  operation_key text not null,
  request_fingerprint text not null,
  commercial_opportunity_id uuid not null,
  appointment_id uuid null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint p9_human_technical_visit_operation_org_fk
    foreign key (organization_id) references public.organizations(id) on delete restrict,
  constraint p9_human_technical_visit_operation_store_scope_fk
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id) on delete restrict,
  constraint p9_human_technical_visit_operation_actor_fk
    foreign key (actor_user_id) references auth.users(id) on delete restrict,
  constraint p9_human_technical_visit_operation_opportunity_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,
  constraint p9_human_technical_visit_operation_appointment_fk
    foreign key (appointment_id) references public.store_appointments(id) on delete restrict,
  constraint p9_human_technical_visit_operation_key_chk
    check (length(pg_catalog.btrim(operation_key)) between 1 and 200),
  constraint p9_human_technical_visit_operation_fingerprint_chk
    check (length(pg_catalog.btrim(request_fingerprint)) = 64),
  constraint p9_human_technical_visit_operation_unique
    unique (organization_id, operation_key)
);

comment on table public.p9_human_technical_visit_operations is
  'Durable authenticated-panel operation identity for technical visits. The row is reserved before the appointment insert and completed in the same transaction; it is not the D.1/D.2 evidence ledger.';

alter table public.p9_human_technical_visit_operations enable row level security;
revoke all on table public.p9_human_technical_visit_operations from public, anon, authenticated, service_role;

create or replace function public.p9_prepare_technical_visit_readiness_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_commercial_opportunity_id uuid,
  p_operation_key text default null
)
returns table (
  effective_lead_id uuid,
  effective_conversation_id uuid,
  lifecycle_cycle integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp, auth, extensions
set row_security = off
as $function$
declare
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
begin
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

  return query select v_effective_lead_id, v_effective_conversation_id,
    v_opportunity.lifecycle_cycle;
end;
$function$;

alter function public.p9_prepare_technical_visit_readiness_internal(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text
) owner to postgres;
revoke all on function public.p9_prepare_technical_visit_readiness_internal(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text
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
set search_path = pg_catalog, public, pg_temp, auth, extensions
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_context record;
  v_row public.store_appointments;
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'ZION_TECHNICAL_VISIT_BOUNDARY_SERVICE_ROLE_REQUIRED';
  end if;

  select * into strict v_context
  from public.p9_prepare_technical_visit_readiness_internal(
    p_organization_id, p_store_id, p_lead_id, p_conversation_id,
    p_title, p_status, p_scheduled_start, p_scheduled_end,
    p_commercial_opportunity_id, p_operation_key
  );

  select * into v_row
  from public.p9_create_technical_visit_physical_internal(
    p_organization_id, p_store_id,
    v_context.effective_lead_id,
    v_context.effective_conversation_id,
    p_title, p_status, p_scheduled_start, p_scheduled_end,
    p_customer_name, p_customer_phone, p_address_text, p_notes,
    p_source, p_created_by_user_id, p_commercial_opportunity_id,
    v_context.lifecycle_cycle
  );

  return v_row;
end;
$function$;

alter function public.create_technical_visit_with_fresh_commercial_readiness_by_system(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, text
) owner to postgres;
revoke all on function public.create_technical_visit_with_fresh_commercial_readiness_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_technical_visit_with_fresh_commercial_readiness_by_system(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text, text, uuid, uuid, text
) to service_role;

create or replace function public.create_technical_visit_by_user(
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
  p_commercial_opportunity_id uuid,
  p_operation_key text
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp, auth, extensions
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := public.zion_resolve_request_role_internal();
  v_fingerprint text;
  v_operation public.p9_human_technical_visit_operations%rowtype;
  v_context record;
  v_row public.store_appointments;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode = '42501',
      message = 'ZION_HUMAN_TECHNICAL_VISIT_AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501',
      message = 'ZION_HUMAN_TECHNICAL_VISIT_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1 from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using errcode = '23503',
      message = 'ZION_HUMAN_TECHNICAL_VISIT_STORE_SCOPE_NOT_FOUND';
  end if;

  if p_operation_key is null
     or pg_catalog.length(pg_catalog.btrim(p_operation_key)) not between 1 and 200 then
    raise exception using errcode = '22023',
      message = 'ZION_HUMAN_TECHNICAL_VISIT_OPERATION_KEY_REQUIRED';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'lead_id', p_lead_id,
      'conversation_id', p_conversation_id,
      'title', pg_catalog.btrim(coalesce(p_title, '')),
      'status', p_status,
      'scheduled_start', p_scheduled_start,
      'scheduled_end', p_scheduled_end,
      'customer_name', p_customer_name,
      'customer_phone', p_customer_phone,
      'address_text', p_address_text,
      'notes', p_notes,
      'commercial_opportunity_id', p_commercial_opportunity_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.p9_human_technical_visit_operations (
    organization_id, store_id, actor_user_id, operation_key,
    request_fingerprint, commercial_opportunity_id
  ) values (
    p_organization_id, p_store_id, v_user_id, pg_catalog.btrim(p_operation_key),
    v_fingerprint, p_commercial_opportunity_id
  ) on conflict (organization_id, operation_key) do nothing;

  select * into v_operation
  from public.p9_human_technical_visit_operations operation_row
  where operation_row.organization_id = p_organization_id
    and operation_row.operation_key = pg_catalog.btrim(p_operation_key)
  for update;

  if v_operation.actor_user_id is distinct from v_user_id
     or v_operation.request_fingerprint is distinct from v_fingerprint
     or v_operation.store_id is distinct from p_store_id
     or v_operation.commercial_opportunity_id is distinct from p_commercial_opportunity_id then
    raise exception using errcode = '23505',
      message = 'ZION_HUMAN_TECHNICAL_VISIT_OPERATION_KEY_REUSED';
  end if;

  if v_operation.appointment_id is not null then
    select * into v_row
    from public.store_appointments appointment_row
    where appointment_row.id = v_operation.appointment_id
      and appointment_row.organization_id = p_organization_id
      and appointment_row.store_id = p_store_id;
    if not found then
      raise exception using errcode = '23503',
        message = 'ZION_HUMAN_TECHNICAL_VISIT_APPOINTMENT_SCOPE_NOT_FOUND';
    end if;
    return v_row;
  end if;

  select * into strict v_context
  from public.p9_prepare_technical_visit_readiness_internal(
    p_organization_id, p_store_id, p_lead_id, p_conversation_id,
    p_title, p_status, p_scheduled_start, p_scheduled_end,
    p_commercial_opportunity_id, p_operation_key
  );

  select * into v_row
  from public.p9_create_technical_visit_physical_internal(
    p_organization_id, p_store_id,
    v_context.effective_lead_id,
    v_context.effective_conversation_id,
    p_title, p_status, p_scheduled_start, p_scheduled_end,
    p_customer_name, p_customer_phone, p_address_text, p_notes,
    'panel', v_user_id, p_commercial_opportunity_id,
    v_context.lifecycle_cycle
  );

  update public.p9_human_technical_visit_operations operation_row
  set appointment_id = v_row.id
  where operation_row.id = v_operation.id
    and operation_row.appointment_id is null;

  if not found then
    raise exception using errcode = '40001',
      message = 'ZION_HUMAN_TECHNICAL_VISIT_OPERATION_COMPLETION_RACE';
  end if;

  return v_row;
end;
$function$;

alter function public.create_technical_visit_by_user(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, uuid, text
) owner to postgres;
revoke all on function public.create_technical_visit_by_user(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, uuid, text
) from public, anon, service_role;
grant execute on function public.create_technical_visit_by_user(
  uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  text, text, text, text, uuid, text
) to authenticated;

commit;
