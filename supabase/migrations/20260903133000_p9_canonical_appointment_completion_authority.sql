-- ZION / Pilar 9 / Bloco 3 / Etapa 3.5
-- Canonical Appointment Completion Authority
--
-- Frozen semantics:
--   * store_appointments.status is operational state, not sufficient evidence of completion.
--   * canonical completion is append-only and explicitly current.
--   * supported outcomes: fully_completed | needs_followup.
--   * needs_followup still means the appointment happened; it only preserves a pending post-appointment obligation.
--   * needs_followup -> fully_completed is allowed.
--   * fully_completed -> needs_followup is fail-closed until an explicit correction authority exists.
--   * no latest/max is used to resolve canonical completion authority.
--   * opportunity-linked evidence snapshots lifecycle_cycle.
--   * legacy completed appointments are NOT backfilled with invented outcomes.
--   * normal create/update/cancel paths cannot manufacture or invalidate completed status.
--
-- This migration intentionally preserves the public signature of
-- complete_store_appointment_with_outcome(...) so existing app/runtime callers
-- continue to use the same RPC while gaining canonical authority underneath.

do $preconditions$
begin
  if pg_catalog.to_regclass('public.store_appointments') is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.store_appointments is required';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities is required';
  end if;

  if pg_catalog.to_regclass('public.schedule_post_appointment_followups') is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.schedule_post_appointment_followups is required';
  end if;

  if pg_catalog.to_regclass('public.conversation_events') is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.conversation_events is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.create_store_appointment(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.create_store_appointment(...) is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.create_store_appointment_with_commercial_context(...) is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.update_store_appointment(uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.update_store_appointment(...) is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.cancel_store_appointment(uuid,uuid,uuid,text)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.cancel_store_appointment(...) is required';
  end if;

  if pg_catalog.to_regprocedure(
    'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: public.complete_store_appointment_with_outcome(...) is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension extension_row
    where extension_row.extname = 'pgcrypto'
  ) then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: pgcrypto is required for deterministic fingerprints';
  end if;

  if pg_catalog.to_regclass('public.store_appointment_completion_events') is not null
     or pg_catalog.to_regclass('public.store_appointment_completion_current') is not null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: appointment completion authority objects already exist';
  end if;
end;
$preconditions$;

-- Exact scoped FK support for appointment authority.
create unique index if not exists store_appointments_scope_id_uidx
  on public.store_appointments (id, organization_id, store_id);

create table public.store_appointment_completion_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  appointment_id uuid not null,

  event_number integer not null,
  previous_completion_event_id uuid null,

  commercial_opportunity_id uuid null,
  lifecycle_cycle integer null,

  completion_outcome text not null,

  appointment_type_snapshot text not null,
  previous_status_snapshot text not null,
  scheduled_start_snapshot timestamptz not null,
  scheduled_end_snapshot timestamptz not null,

  actor_type text not null,
  actor_user_id uuid null,

  operation_key text not null,
  request_fingerprint text not null,

  reason_code text not null,
  completion_note text null,
  source_type text not null,
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint store_appointment_completion_events_appointment_scope_fkey
    foreign key (appointment_id, organization_id, store_id)
    references public.store_appointments(id, organization_id, store_id)
    on delete restrict,

  constraint store_appointment_completion_events_opportunity_scope_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint store_appointment_completion_events_previous_scope_fkey
    foreign key (
      previous_completion_event_id,
      organization_id,
      store_id,
      appointment_id
    )
    references public.store_appointment_completion_events(
      id,
      organization_id,
      store_id,
      appointment_id
    )
    on delete restrict,

  constraint store_appointment_completion_events_event_number_chk
    check (event_number > 0),

  constraint store_appointment_completion_events_outcome_chk
    check (completion_outcome in ('fully_completed', 'needs_followup')),

  constraint store_appointment_completion_events_opportunity_cycle_pair_chk
    check (
      (commercial_opportunity_id is null and lifecycle_cycle is null)
      or
      (commercial_opportunity_id is not null and lifecycle_cycle is not null and lifecycle_cycle >= 1)
    ),

  constraint store_appointment_completion_events_actor_chk
    check (
      (actor_type = 'human' and actor_user_id is not null)
      or
      (actor_type = 'system' and actor_user_id is null)
    ),

  constraint store_appointment_completion_events_operation_key_chk
    check (
      pg_catalog.btrim(operation_key) <> ''
      and pg_catalog.char_length(operation_key) <= 512
    ),

  constraint store_appointment_completion_events_fingerprint_chk
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),

  constraint store_appointment_completion_events_reason_code_chk
    check (pg_catalog.btrim(reason_code) <> ''),

  constraint store_appointment_completion_events_source_type_chk
    check (pg_catalog.btrim(source_type) <> ''),

  constraint store_appointment_completion_events_created_by_chk
    check (pg_catalog.btrim(created_by) <> ''),

  constraint store_appointment_completion_events_metadata_object_chk
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),

  constraint store_appointment_completion_events_scope_event_number_key
    unique (organization_id, store_id, appointment_id, event_number),

  constraint store_appointment_completion_events_scope_operation_key
    unique (organization_id, store_id, appointment_id, operation_key),

  constraint store_appointment_completion_events_previous_once
    unique (previous_completion_event_id),

  constraint store_appointment_completion_events_scope_id_key
    unique (id, organization_id, store_id, appointment_id)
);

create index store_appointment_completion_events_scope_appointment_idx
  on public.store_appointment_completion_events (
    organization_id,
    store_id,
    appointment_id
  );

create index store_appointment_completion_events_scope_opportunity_cycle_idx
  on public.store_appointment_completion_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle
  )
  where commercial_opportunity_id is not null;

create table public.store_appointment_completion_current (
  organization_id uuid not null,
  store_id uuid not null,
  appointment_id uuid not null,
  current_completion_event_id uuid not null,
  last_operation_key text not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint store_appointment_completion_current_pkey
    primary key (organization_id, store_id, appointment_id),

  constraint store_appointment_completion_current_appointment_scope_fkey
    foreign key (appointment_id, organization_id, store_id)
    references public.store_appointments(id, organization_id, store_id)
    on delete restrict,

  constraint store_appointment_completion_current_event_scope_fkey
    foreign key (
      current_completion_event_id,
      organization_id,
      store_id,
      appointment_id
    )
    references public.store_appointment_completion_events(
      id,
      organization_id,
      store_id,
      appointment_id
    )
    on delete restrict,

  constraint store_appointment_completion_current_operation_key_chk
    check (
      pg_catalog.btrim(last_operation_key) <> ''
      and pg_catalog.char_length(last_operation_key) <= 512
    )
);

comment on table public.store_appointment_completion_events is
  'Append-only canonical authority for appointment completion outcomes. A completed store_appointments.status alone is not sufficient canonical completion evidence.';

comment on table public.store_appointment_completion_current is
  'Explicit current pointer for canonical appointment completion authority. Never resolve current completion by latest/max.';

comment on column public.store_appointment_completion_events.lifecycle_cycle is
  'Snapshot of commercial_opportunities.lifecycle_cycle at the time of canonical completion when the appointment is linked to an opportunity.';

comment on column public.store_appointment_completion_events.completion_outcome is
  'fully_completed or needs_followup. Both mean the appointment happened; needs_followup preserves a pending post-appointment obligation.';

create or replace function public.p9_compute_appointment_completion_fingerprint_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_appointment_id uuid,
  p_commercial_opportunity_id uuid,
  p_lifecycle_cycle integer,
  p_completion_outcome text
)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'schema_version', 1,
          'organization_id', p_organization_id,
          'store_id', p_store_id,
          'appointment_id', p_appointment_id,
          'commercial_opportunity_id', p_commercial_opportunity_id,
          'lifecycle_cycle', p_lifecycle_cycle,
          'completion_outcome', p_completion_outcome
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

alter function public.p9_compute_appointment_completion_fingerprint_internal(
  uuid, uuid, uuid, uuid, integer, text
) owner to postgres;

revoke all on function public.p9_compute_appointment_completion_fingerprint_internal(
  uuid, uuid, uuid, uuid, integer, text
) from public, anon, authenticated, service_role;

create or replace function public.p9_store_appointment_completion_validate_event_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_appointment public.store_appointments;
  v_opportunity public.commercial_opportunities;
  v_current public.store_appointment_completion_current;
  v_current_event public.store_appointment_completion_events;
begin
  select appointment_row.*
  into v_appointment
  from public.store_appointments appointment_row
  where appointment_row.id = new.appointment_id
    and appointment_row.organization_id = new.organization_id
    and appointment_row.store_id = new.store_id
  for key share;

  if not found then
    raise exception using errcode = '23503',
      message = 'ZION_APPOINTMENT_COMPLETION_APPOINTMENT_SCOPE_NOT_FOUND';
  end if;

  if v_appointment.commercial_opportunity_id is null then
    if new.commercial_opportunity_id is not null
       or new.lifecycle_cycle is not null then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_UNLINKED_SCOPE_MISMATCH';
    end if;
  else
    if new.commercial_opportunity_id is distinct from v_appointment.commercial_opportunity_id then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_OPPORTUNITY_SCOPE_MISMATCH';
    end if;

    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_appointment.commercial_opportunity_id
      and opportunity_row.organization_id = new.organization_id
      and opportunity_row.store_id = new.store_id
    for key share;

    if not found then
      raise exception using errcode = '23503',
        message = 'ZION_APPOINTMENT_COMPLETION_OPPORTUNITY_NOT_FOUND';
    end if;

    if new.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_LIFECYCLE_CYCLE_MISMATCH';
    end if;
  end if;

  select current_row.*
  into v_current
  from public.store_appointment_completion_current current_row
  where current_row.organization_id = new.organization_id
    and current_row.store_id = new.store_id
    and current_row.appointment_id = new.appointment_id
  for update;

  if found then
    select event_row.*
    into v_current_event
    from public.store_appointment_completion_events event_row
    where event_row.id = v_current.current_completion_event_id
      and event_row.organization_id = new.organization_id
      and event_row.store_id = new.store_id
      and event_row.appointment_id = new.appointment_id;

    if not found then
      raise exception using errcode = 'P0001',
        message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_EVENT_MISSING';
    end if;

    if new.previous_completion_event_id is distinct from v_current_event.id
       or new.event_number is distinct from v_current_event.event_number + 1 then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_EVENT_CHAIN_MISMATCH';
    end if;
  else
    if new.previous_completion_event_id is not null
       or new.event_number <> 1 then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_FIRST_EVENT_CHAIN_MISMATCH';
    end if;
  end if;

  return new;
end;
$function$;

alter function public.p9_store_appointment_completion_validate_event_internal()
  owner to postgres;

revoke all on function public.p9_store_appointment_completion_validate_event_internal()
  from public, anon, authenticated, service_role;

create trigger store_appointment_completion_events_validate_insert
before insert on public.store_appointment_completion_events
for each row
execute function public.p9_store_appointment_completion_validate_event_internal();

create or replace function public.p9_store_appointment_completion_append_only_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using errcode = '55000',
    message = 'ZION_APPOINTMENT_COMPLETION_EVENTS_APPEND_ONLY';
end;
$function$;

alter function public.p9_store_appointment_completion_append_only_internal()
  owner to postgres;

revoke all on function public.p9_store_appointment_completion_append_only_internal()
  from public, anon, authenticated, service_role;

create trigger store_appointment_completion_events_append_only
before update or delete on public.store_appointment_completion_events
for each row
execute function public.p9_store_appointment_completion_append_only_internal();

create or replace function public.p9_store_appointment_completion_validate_current_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_event public.store_appointment_completion_events;
begin
  select event_row.*
  into v_event
  from public.store_appointment_completion_events event_row
  where event_row.id = new.current_completion_event_id
    and event_row.organization_id = new.organization_id
    and event_row.store_id = new.store_id
    and event_row.appointment_id = new.appointment_id;

  if not found then
    raise exception using errcode = '23503',
      message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_TARGET_NOT_FOUND';
  end if;

  if new.last_operation_key is distinct from v_event.operation_key then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_OPERATION_MISMATCH';
  end if;

  if exists (
    select 1
    from public.store_appointment_completion_events child_row
    where child_row.previous_completion_event_id = v_event.id
  ) then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_MUST_POINT_TO_CHAIN_TIP';
  end if;

  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.p9_store_appointment_completion_validate_current_internal()
  owner to postgres;

revoke all on function public.p9_store_appointment_completion_validate_current_internal()
  from public, anon, authenticated, service_role;

create trigger store_appointment_completion_current_validate
before insert or update on public.store_appointment_completion_current
for each row
execute function public.p9_store_appointment_completion_validate_current_internal();

-- Database-level guard against creating a new completed status through direct
-- authenticated/service-role DML. The canonical completion RPC is SECURITY
-- DEFINER owned by postgres, so its atomic update is allowed.
create or replace function public.p9_guard_store_appointment_completion_status_internal()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed'
       and current_user <> 'postgres' then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
    end if;

    return new;
  end if;

  if old.status is distinct from 'completed'
     and new.status = 'completed'
     and current_user <> 'postgres' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
  end if;

  if old.status = 'completed'
     and new.status is distinct from 'completed'
     and current_user <> 'postgres' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REOPEN_REQUIRES_EXPLICIT_CORRECTION_AUTHORITY';
  end if;

  return new;
end;
$function$;

alter function public.p9_guard_store_appointment_completion_status_internal()
  owner to postgres;

revoke all on function public.p9_guard_store_appointment_completion_status_internal()
  from public, anon, authenticated, service_role;

create trigger store_appointments_guard_canonical_completion_status
before insert or update of status on public.store_appointments
for each row
execute function public.p9_guard_store_appointment_completion_status_internal();

alter table public.store_appointment_completion_events enable row level security;
alter table public.store_appointment_completion_current enable row level security;

revoke all on table public.store_appointment_completion_events
  from public, anon, authenticated, service_role;
revoke all on table public.store_appointment_completion_current
  from public, anon, authenticated, service_role;

grant select on table public.store_appointment_completion_events
  to authenticated, service_role;
grant select on table public.store_appointment_completion_current
  to authenticated, service_role;

create policy store_appointment_completion_events_select_by_active_membership
  on public.store_appointment_completion_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id =
              store_appointment_completion_events.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_appointment_completion_events.store_id
        and store_row.organization_id =
              store_appointment_completion_events.organization_id
    )
  );

create policy store_appointment_completion_current_select_by_active_membership
  on public.store_appointment_completion_current
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id =
              store_appointment_completion_current.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_appointment_completion_current.store_id
        and store_row.organization_id =
              store_appointment_completion_current.organization_id
    )
  );

-- ---------------------------------------------------------------------------
-- Harden existing appointment mutation doors.
-- ---------------------------------------------------------------------------

create or replace function public.create_store_appointment(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamp with time zone,
  p_scheduled_end timestamp with time zone,
  p_customer_name text default null::text,
  p_customer_phone text default null::text,
  p_address_text text default null::text,
  p_notes text default null::text,
  p_source text default 'panel'::text,
  p_created_by_user_id uuid default null::uuid
)
returns public.store_appointments
language plpgsql
as $function$
declare
  v_row public.store_appointments;
  v_has_appointment_conflict boolean;
  v_has_block_conflict boolean;
  v_within_operating_window boolean;
  v_effective_conversation_id uuid;
begin
  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'Título do compromisso é obrigatório.';
  end if;

  if p_scheduled_start is null or p_scheduled_end is null then
    raise exception 'Período do compromisso é obrigatório.';
  end if;

  if p_scheduled_end <= p_scheduled_start then
    raise exception 'Horário final deve ser maior que o horário inicial.';
  end if;

  if p_appointment_type not in (
    'technical_visit',
    'installation',
    'follow_up',
    'meeting',
    'measurement',
    'maintenance',
    'other'
  ) then
    raise exception 'Tipo de compromisso inválido.';
  end if;

  if p_status = 'completed' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
  end if;

  if p_status not in (
    'scheduled',
    'completed',
    'cancelled',
    'rescheduled'
  ) then
    raise exception 'Status do compromisso inválido.';
  end if;

  if p_source not in (
    'panel',
    'ai_operator',
    'system'
  ) then
    raise exception 'Origem inválida.';
  end if;

  select public.is_store_appointment_within_operating_window(
    p_organization_id,
    p_store_id,
    p_appointment_type,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_within_operating_window;

  if not v_within_operating_window then
    raise exception 'Esse compromisso está fora da janela operacional configurada da loja.';
  end if;

  select public.has_store_appointment_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end,
    null
  )
  into v_has_appointment_conflict;

  if v_has_appointment_conflict then
    raise exception 'Já existe outro compromisso nesse horário.';
  end if;

  select public.has_store_schedule_block_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_has_block_conflict;

  if v_has_block_conflict then
    raise exception 'Existe um bloqueio de agenda nesse horário.';
  end if;

  v_effective_conversation_id := p_conversation_id;

  if v_effective_conversation_id is null and p_lead_id is not null then
    v_effective_conversation_id := public.get_latest_conversation_for_lead(
      p_organization_id,
      p_lead_id
    );
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
    created_by_user_id
  )
  values (
    p_organization_id,
    p_store_id,
    p_lead_id,
    v_effective_conversation_id,
    pg_catalog.btrim(p_title),
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
  )
  returning * into v_row;

  perform public.log_schedule_conversation_event(
    p_organization_id,
    v_row.conversation_id,
    'compromisso_agendado',
    'schedule_panel',
    pg_catalog.jsonb_build_object(
      'appointment_id', v_row.id,
      'appointment_type', v_row.appointment_type,
      'title', v_row.title,
      'status', v_row.status,
      'scheduled_start', v_row.scheduled_start,
      'scheduled_end', v_row.scheduled_end,
      'customer_name', v_row.customer_name,
      'customer_phone', v_row.customer_phone,
      'address_text', v_row.address_text,
      'notes', v_row.notes,
      'source', v_row.source
    )
  );

  return v_row;
end;
$function$;

create or replace function public.create_store_appointment_with_commercial_context(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamp with time zone,
  p_scheduled_end timestamp with time zone,
  p_customer_name text,
  p_customer_phone text,
  p_address_text text,
  p_notes text,
  p_source text,
  p_created_by_user_id uuid,
  p_commercial_opportunity_id uuid default null::uuid
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    pg_catalog.coalesce(
      pg_catalog.nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      pg_catalog.nullif(auth.jwt() ->> 'role', '')
    );
  v_opportunity public.commercial_opportunities;
  v_created_appointment public.store_appointments;
begin
  if (v_request_role not in ('authenticated', 'service_role'))
     and session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'create store appointment with commercial context is not authorized';
  end if;

  if p_status = 'completed' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
  end if;

  if p_commercial_opportunity_id is not null then
    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id;

    if not found then
      raise exception using errcode = '23503',
        message = 'commercial opportunity not found';
    end if;

    if v_opportunity.organization_id is distinct from p_organization_id
       or v_opportunity.store_id is distinct from p_store_id then
      raise exception using errcode = '23514',
        message = 'commercial opportunity scope mismatch';
    end if;

    if p_lead_id is not null
       and v_opportunity.origin_lead_id is distinct from p_lead_id then
      raise exception using errcode = '23514',
        message = 'commercial opportunity lead mismatch';
    end if;

    if p_conversation_id is not null then
      if v_opportunity.primary_conversation_id is null then
        raise exception using errcode = '23514',
          message = 'commercial opportunity conversation missing';
      end if;

      if v_opportunity.primary_conversation_id is distinct from p_conversation_id then
        raise exception using errcode = '23514',
          message = 'commercial opportunity conversation mismatch';
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

create or replace function public.update_store_appointment(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamp with time zone,
  p_scheduled_end timestamp with time zone,
  p_customer_name text default null::text,
  p_customer_phone text default null::text,
  p_address_text text default null::text,
  p_notes text default null::text
)
returns public.store_appointments
language plpgsql
as $function$
declare
  v_existing public.store_appointments;
  v_row public.store_appointments;
  v_has_appointment_conflict boolean;
  v_has_block_conflict boolean;
  v_within_operating_window boolean;
  v_time_changed boolean := false;
  v_status_changed boolean := false;
begin
  select *
  into v_existing
  from public.store_appointments
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    raise exception 'Compromisso não encontrado para esta organização/loja.';
  end if;

  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'Título do compromisso é obrigatório.';
  end if;

  if p_scheduled_start is null or p_scheduled_end is null then
    raise exception 'Período do compromisso é obrigatório.';
  end if;

  if p_scheduled_end <= p_scheduled_start then
    raise exception 'Horário final deve ser maior que o horário inicial.';
  end if;

  if p_appointment_type not in (
    'technical_visit',
    'installation',
    'follow_up',
    'meeting',
    'measurement',
    'maintenance',
    'other'
  ) then
    raise exception 'Tipo de compromisso inválido.';
  end if;

  if p_status not in (
    'scheduled',
    'completed',
    'cancelled',
    'rescheduled'
  ) then
    raise exception 'Status do compromisso inválido.';
  end if;

  if v_existing.status is distinct from 'completed'
     and p_status = 'completed' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER';
  end if;

  if v_existing.status = 'completed'
     and p_status is distinct from 'completed' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REOPEN_REQUIRES_EXPLICIT_CORRECTION_AUTHORITY';
  end if;

  select public.is_store_appointment_within_operating_window(
    p_organization_id,
    p_store_id,
    p_appointment_type,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_within_operating_window;

  if not v_within_operating_window then
    raise exception 'Esse compromisso está fora da janela operacional configurada da loja.';
  end if;

  select public.has_store_appointment_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end,
    p_appointment_id
  )
  into v_has_appointment_conflict;

  if v_has_appointment_conflict then
    raise exception 'Já existe outro compromisso nesse horário.';
  end if;

  select public.has_store_schedule_block_conflict(
    p_organization_id,
    p_store_id,
    p_scheduled_start,
    p_scheduled_end
  )
  into v_has_block_conflict;

  if v_has_block_conflict then
    raise exception 'Existe um bloqueio de agenda nesse horário.';
  end if;

  v_time_changed :=
    v_existing.scheduled_start is distinct from p_scheduled_start
    or v_existing.scheduled_end is distinct from p_scheduled_end;

  v_status_changed := v_existing.status is distinct from p_status;

  update public.store_appointments
  set
    title = pg_catalog.btrim(p_title),
    appointment_type = p_appointment_type,
    status = p_status,
    scheduled_start = p_scheduled_start,
    scheduled_end = p_scheduled_end,
    customer_name = p_customer_name,
    customer_phone = p_customer_phone,
    address_text = p_address_text,
    notes = p_notes,
    updated_at = pg_catalog.now()
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  returning * into v_row;

  if v_time_changed then
    perform public.log_schedule_conversation_event(
      p_organization_id,
      v_row.conversation_id,
      'compromisso_remarcado',
      'schedule_panel',
      pg_catalog.jsonb_build_object(
        'appointment_id', v_row.id,
        'appointment_type', v_row.appointment_type,
        'title', v_row.title,
        'previous_start', v_existing.scheduled_start,
        'previous_end', v_existing.scheduled_end,
        'scheduled_start', v_row.scheduled_start,
        'scheduled_end', v_row.scheduled_end,
        'status', v_row.status,
        'customer_name', v_row.customer_name,
        'customer_phone', v_row.customer_phone,
        'address_text', v_row.address_text,
        'notes', v_row.notes
      )
    );
  end if;

  if v_status_changed and v_row.status = 'cancelled' then
    perform public.log_schedule_conversation_event(
      p_organization_id,
      v_row.conversation_id,
      'compromisso_cancelado',
      'schedule_panel',
      pg_catalog.jsonb_build_object(
        'appointment_id', v_row.id,
        'appointment_type', v_row.appointment_type,
        'title', v_row.title,
        'previous_status', v_existing.status,
        'status', v_row.status,
        'scheduled_start', v_row.scheduled_start,
        'scheduled_end', v_row.scheduled_end,
        'customer_name', v_row.customer_name,
        'customer_phone', v_row.customer_phone,
        'address_text', v_row.address_text,
        'notes', v_row.notes
      )
    );
  end if;

  return v_row;
end;
$function$;

create or replace function public.cancel_store_appointment(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_cancel_reason text default null::text
)
returns public.store_appointments
language plpgsql
as $function$
declare
  v_existing public.store_appointments;
  v_row public.store_appointments;
  v_notes text;
begin
  select *
  into v_existing
  from public.store_appointments
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    raise exception 'Compromisso não encontrado para esta organização/loja.';
  end if;

  if v_existing.status = 'cancelled' then
    raise exception 'Este compromisso já está cancelado.';
  end if;

  if v_existing.status = 'completed' then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_COMPLETION_REOPEN_REQUIRES_EXPLICIT_CORRECTION_AUTHORITY';
  end if;

  v_notes := pg_catalog.coalesce(v_existing.notes, '');

  if p_cancel_reason is not null and pg_catalog.btrim(p_cancel_reason) <> '' then
    if v_notes <> '' then
      v_notes := v_notes || E'\n\n[Cancelamento] ' || pg_catalog.btrim(p_cancel_reason);
    else
      v_notes := '[Cancelamento] ' || pg_catalog.btrim(p_cancel_reason);
    end if;
  end if;

  update public.store_appointments
  set
    status = 'cancelled',
    notes = v_notes
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.complete_store_appointment_with_outcome(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_completion_outcome text,
  p_completion_note text default null::text
)
returns public.store_appointments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_request_role text :=
    pg_catalog.coalesce(
      pg_catalog.nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      pg_catalog.nullif(auth.jwt() ->> 'role', ''),
      ''
    );

  v_actor_type text;
  v_actor_user_id uuid;
  v_source_type text;

  v_existing public.store_appointments;
  v_row public.store_appointments;
  v_opportunity public.commercial_opportunities;

  v_current public.store_appointment_completion_current;
  v_current_event public.store_appointment_completion_events;
  v_existing_operation_event public.store_appointment_completion_events;
  v_new_event public.store_appointment_completion_events;

  v_event_number integer;
  v_previous_event_id uuid;
  v_lifecycle_cycle integer;
  v_operation_key text;
  v_request_fingerprint text;
  v_reason_code text;

  v_followup public.schedule_post_appointment_followups;
  v_final_notes text;
  v_resolution text;
  v_followup_note text;
begin
  if v_request_role = 'service_role' then
    v_actor_type := 'system';
    v_actor_user_id := null;
    v_source_type := 'service_role_appointment_completion';
  else
    if auth.uid() is null
       or not exists (
         select 1
         from public.memberships membership_row
         where membership_row.organization_id = p_organization_id
           and membership_row.user_id = auth.uid()
           and membership_row.is_active is true
       )
       or not exists (
         select 1
         from public.stores store_row
         where store_row.id = p_store_id
           and store_row.organization_id = p_organization_id
       ) then
      raise exception using errcode = '42501',
        message = 'insufficient privilege: tenant access denied';
    end if;

    v_actor_type := 'human';
    v_actor_user_id := auth.uid();
    v_source_type := 'authenticated_appointment_completion';
  end if;

  if p_completion_outcome not in ('fully_completed', 'needs_followup') then
    raise exception 'Resultado de conclusão inválido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'p9:appointment_completion:' || p_appointment_id::text,
      0
    )
  );

  select appointment_row.*
  into v_existing
  from public.store_appointments appointment_row
  where appointment_row.id = p_appointment_id
    and appointment_row.organization_id = p_organization_id
    and appointment_row.store_id = p_store_id
  for update;

  if not found then
    raise exception 'Compromisso não encontrado para esta organização/loja.';
  end if;

  if v_existing.status = 'cancelled' then
    raise exception 'Não é possível concluir um compromisso cancelado.';
  end if;

  if v_existing.commercial_opportunity_id is not null then
    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_existing.commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
    for key share;

    if not found then
      raise exception using errcode = '23503',
        message = 'ZION_APPOINTMENT_COMPLETION_OPPORTUNITY_NOT_FOUND';
    end if;

    v_lifecycle_cycle := v_opportunity.lifecycle_cycle;
  else
    v_lifecycle_cycle := null;
  end if;

  v_reason_code := case
    when p_completion_outcome = 'fully_completed'
      then 'appointment_fully_completed'
    else 'appointment_completed_needs_followup'
  end;

  v_operation_key :=
    'appointment_completion:v1:' ||
    p_appointment_id::text || ':' ||
    pg_catalog.coalesce(v_lifecycle_cycle::text, 'none') || ':' ||
    p_completion_outcome;

  v_request_fingerprint :=
    public.p9_compute_appointment_completion_fingerprint_internal(
      p_organization_id,
      p_store_id,
      p_appointment_id,
      v_existing.commercial_opportunity_id,
      v_lifecycle_cycle,
      p_completion_outcome
    );

  select event_row.*
  into v_existing_operation_event
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.appointment_id = p_appointment_id
    and event_row.operation_key = v_operation_key;

  if found then
    if v_existing_operation_event.request_fingerprint
         is distinct from v_request_fingerprint
       or v_existing_operation_event.completion_outcome
         is distinct from p_completion_outcome
       or v_existing_operation_event.commercial_opportunity_id
         is distinct from v_existing.commercial_opportunity_id
       or v_existing_operation_event.lifecycle_cycle
         is distinct from v_lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_IDEMPOTENCY_CONFLICT';
    end if;

    select current_row.*
    into v_current
    from public.store_appointment_completion_current current_row
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.appointment_id = p_appointment_id
    for update;

    if not found
       or v_current.current_completion_event_id
            is distinct from v_existing_operation_event.id then
      raise exception using errcode = '40001',
        message = 'ZION_APPOINTMENT_COMPLETION_OBSOLETE_REPLAY';
    end if;

    if v_existing.status is distinct from 'completed' then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_STATUS_MISMATCH';
    end if;

    return v_existing;
  end if;

  select current_row.*
  into v_current
  from public.store_appointment_completion_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.appointment_id = p_appointment_id
  for update;

  if found then
    select event_row.*
    into v_current_event
    from public.store_appointment_completion_events event_row
    where event_row.id = v_current.current_completion_event_id
      and event_row.organization_id = p_organization_id
      and event_row.store_id = p_store_id
      and event_row.appointment_id = p_appointment_id;

    if not found then
      raise exception using errcode = 'P0001',
        message = 'ZION_APPOINTMENT_COMPLETION_CURRENT_EVENT_MISSING';
    end if;

    if v_current_event.commercial_opportunity_id
         is distinct from v_existing.commercial_opportunity_id
       or v_current_event.lifecycle_cycle
         is distinct from v_lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_SCOPE_CHANGED_NEEDS_RESOLUTION';
    end if;

    if v_current_event.completion_outcome = 'fully_completed'
       and p_completion_outcome = 'needs_followup' then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_REGRESSION_REQUIRES_CORRECTION_AUTHORITY';
    end if;

    v_previous_event_id := v_current_event.id;
    v_event_number := v_current_event.event_number + 1;
  else
    v_previous_event_id := null;
    v_event_number := 1;
  end if;

  insert into public.store_appointment_completion_events (
    organization_id,
    store_id,
    appointment_id,
    event_number,
    previous_completion_event_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    completion_outcome,
    appointment_type_snapshot,
    previous_status_snapshot,
    scheduled_start_snapshot,
    scheduled_end_snapshot,
    actor_type,
    actor_user_id,
    operation_key,
    request_fingerprint,
    reason_code,
    completion_note,
    source_type,
    created_by,
    metadata
  )
  values (
    p_organization_id,
    p_store_id,
    p_appointment_id,
    v_event_number,
    v_previous_event_id,
    v_existing.commercial_opportunity_id,
    v_lifecycle_cycle,
    p_completion_outcome,
    v_existing.appointment_type,
    v_existing.status,
    v_existing.scheduled_start,
    v_existing.scheduled_end,
    v_actor_type,
    v_actor_user_id,
    v_operation_key,
    v_request_fingerprint,
    v_reason_code,
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_completion_note, '')), ''),
    v_source_type,
    'p9_appointment_completion_v1',
    pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'canonical_authority', 'store_appointment_completion_events'
    )
  )
  returning *
  into v_new_event;

  v_final_notes := pg_catalog.coalesce(v_existing.notes, '');

  if p_completion_note is not null
     and pg_catalog.btrim(p_completion_note) <> '' then
    if v_final_notes <> '' then
      v_final_notes :=
        v_final_notes ||
        E'\n\n[Conclusão] ' ||
        pg_catalog.btrim(p_completion_note);
    else
      v_final_notes :=
        '[Conclusão] ' ||
        pg_catalog.btrim(p_completion_note);
    end if;
  end if;

  update public.store_appointments
  set
    status = 'completed',
    notes = v_final_notes,
    updated_at = pg_catalog.now()
  where id = p_appointment_id
    and organization_id = p_organization_id
    and store_id = p_store_id
  returning * into v_row;

  insert into public.store_appointment_completion_current (
    organization_id,
    store_id,
    appointment_id,
    current_completion_event_id,
    last_operation_key
  )
  values (
    p_organization_id,
    p_store_id,
    p_appointment_id,
    v_new_event.id,
    v_new_event.operation_key
  )
  on conflict (organization_id, store_id, appointment_id)
  do update
  set
    current_completion_event_id = excluded.current_completion_event_id,
    last_operation_key = excluded.last_operation_key;

  select followup_row.*
  into v_followup
  from public.schedule_post_appointment_followups followup_row
  where followup_row.appointment_id = p_appointment_id
    and followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
  order by followup_row.created_at desc
  limit 1;

  if p_completion_outcome = 'fully_completed' then
    if found then
      v_resolution := 'confirmed_completed';

      update public.schedule_post_appointment_followups
      set
        followup_status = v_resolution,
        confirmed_at = pg_catalog.coalesce(confirmed_at, pg_catalog.now()),
        resolved_at = pg_catalog.now(),
        resolution = v_resolution,
        notes = case
          when p_completion_note is not null
               and pg_catalog.btrim(p_completion_note) <> '' then
            case
              when pg_catalog.coalesce(notes, '') <> '' then
                notes ||
                E'\n\n[Fechamento do atendimento] ' ||
                pg_catalog.btrim(p_completion_note)
              else
                '[Fechamento do atendimento] ' ||
                pg_catalog.btrim(p_completion_note)
            end
          else notes
        end,
        updated_at = pg_catalog.now()
      where id = v_followup.id;
    end if;
  else
    v_followup_note := case
      when p_completion_note is not null
           and pg_catalog.btrim(p_completion_note) <> '' then
        '[Após a conclusão ainda falta retorno] ' ||
        pg_catalog.btrim(p_completion_note)
      else
        '[Após a conclusão ainda falta retorno] Atendimento concluído, mas ainda existe retorno pendente.'
    end;

    if found then
      update public.schedule_post_appointment_followups
      set
        followup_status = 'prompt_sent',
        confirmed_at = null,
        resolved_at = null,
        resolution = null,
        notes = case
          when pg_catalog.coalesce(notes, '') <> '' then
            notes || E'\n\n' || v_followup_note
          else v_followup_note
        end,
        updated_at = pg_catalog.now()
      where id = v_followup.id;
    else
      insert into public.schedule_post_appointment_followups (
        organization_id,
        store_id,
        appointment_id,
        lead_id,
        conversation_id,
        scheduled_end,
        followup_status,
        preferred_channel,
        prompt_count,
        notes
      )
      values (
        p_organization_id,
        p_store_id,
        p_appointment_id,
        v_row.lead_id,
        v_row.conversation_id,
        v_row.scheduled_end,
        'prompt_sent',
        'unknown',
        0,
        v_followup_note
      )
      returning *
      into v_followup;
    end if;
  end if;

  perform public.log_schedule_conversation_event(
    p_organization_id,
    v_row.conversation_id,
    'compromisso_concluido',
    'schedule_panel',
    pg_catalog.jsonb_build_object(
      'appointment_id', v_row.id,
      'appointment_type', v_row.appointment_type,
      'title', v_row.title,
      'previous_status', v_existing.status,
      'status', v_row.status,
      'scheduled_start', v_row.scheduled_start,
      'scheduled_end', v_row.scheduled_end,
      'customer_name', v_row.customer_name,
      'customer_phone', v_row.customer_phone,
      'address_text', v_row.address_text,
      'notes', v_row.notes,
      'completion_outcome', p_completion_outcome,
      'canonical_completion_event_id', v_new_event.id,
      'canonical_completion_event_number', v_new_event.event_number,
      'canonical_completion_fingerprint', v_new_event.request_fingerprint,
      'has_linked_followup', (v_followup.id is not null)
    )
  );

  return v_row;
end;
$function$;

alter function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) owner to postgres;

-- Preserve the established caller surface.
revoke all on function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) from public, anon;
grant execute on function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) to authenticated, service_role;

revoke all on function public.create_store_appointment(
  uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.create_store_appointment(
  uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, text, text, uuid
) to authenticated, service_role;

revoke all on function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.create_store_appointment_with_commercial_context(
  uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, text, text, uuid, uuid
) to authenticated, service_role;

revoke all on function public.update_store_appointment(
  uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, text
) from public, anon;
grant execute on function public.update_store_appointment(
  uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, text
) to authenticated, service_role;

revoke all on function public.cancel_store_appointment(
  uuid, uuid, uuid, text
) from public, anon;
grant execute on function public.cancel_store_appointment(
  uuid, uuid, uuid, text
) to authenticated, service_role;

do $postconditions$
declare
  v_completion_definition text;
  v_create_definition text;
  v_update_definition text;
  v_cancel_definition text;
begin
  if pg_catalog.to_regclass('public.store_appointment_completion_events') is null
     or pg_catalog.to_regclass('public.store_appointment_completion_current') is null then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: canonical appointment completion tables missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname in (
        'store_appointment_completion_events',
        'store_appointment_completion_current'
      )
      and class_row.relrowsecurity is true
    group by namespace_row.nspname
    having pg_catalog.count(*) = 2
  ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: appointment completion RLS missing';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.store_appointment_completion_events',
       'INSERT'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_appointment_completion_events',
       'UPDATE'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_appointment_completion_events',
       'DELETE'
     )
     or has_table_privilege(
       'service_role',
       'public.store_appointment_completion_events',
       'INSERT'
     )
     or has_table_privilege(
       'service_role',
       'public.store_appointment_completion_events',
       'UPDATE'
     )
     or has_table_privilege(
       'service_role',
       'public.store_appointment_completion_events',
       'DELETE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: direct completion event mutation grant leaked';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.store_appointment_completion_current',
       'INSERT'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_appointment_completion_current',
       'UPDATE'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_appointment_completion_current',
       'DELETE'
     )
     or has_table_privilege(
       'service_role',
       'public.store_appointment_completion_current',
       'INSERT'
     )
     or has_table_privilege(
       'service_role',
       'public.store_appointment_completion_current',
       'UPDATE'
     )
     or has_table_privilege(
       'service_role',
       'public.store_appointment_completion_current',
       'DELETE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: direct completion current mutation grant leaked';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.p9_compute_appointment_completion_fingerprint_internal(uuid,uuid,uuid,uuid,integer,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.p9_compute_appointment_completion_fingerprint_internal(uuid,uuid,uuid,uuid,integer,text)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: internal fingerprint helper execute leaked';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: completion writer grants mismatch';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_completion_definition;

  if v_completion_definition not like '%store_appointment_completion_events%'
     or v_completion_definition not like '%store_appointment_completion_current%'
     or v_completion_definition not like '%pg_advisory_xact_lock%'
     or v_completion_definition not like '%needs_followup%'
     or v_completion_definition not like '%fully_completed%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: canonical completion writer definition mismatch';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.create_store_appointment(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_create_definition;

  if v_create_definition not like '%zion_appointment_completion_requires_canonical_writer%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: create appointment completion bypass remains';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.update_store_appointment(uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_update_definition;

  if v_update_definition not like '%zion_appointment_completion_requires_canonical_writer%'
     or v_update_definition not like '%zion_appointment_completion_reopen_requires_explicit_correction_authority%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: update appointment completion bypass remains';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.cancel_store_appointment(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_cancel_definition;

  if v_cancel_definition not like '%zion_appointment_completion_reopen_requires_explicit_correction_authority%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: cancel completed appointment bypass remains';
  end if;
end;
$postconditions$;
