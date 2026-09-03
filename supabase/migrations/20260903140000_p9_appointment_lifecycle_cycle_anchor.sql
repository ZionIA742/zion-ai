-- ZION / Pilar 9 / Bloco 3 / Etapa 3.5
-- Appointment Lifecycle Cycle Anchor
--
-- Purpose:
--   Give every opportunity-linked appointment a stable commercial lifecycle-cycle
--   identity so current-cycle Progress/Assessment never consumes stale appointments
--   after an opportunity is reopened.
--
-- Frozen semantics:
--   * commercial_opportunity_lifecycle_cycle is a snapshot/identity anchor, not
--     current state and not Progress.
--   * the anchor is captured when an appointment is linked to an opportunity.
--   * once a non-null commercial link/anchor exists, normal writes cannot unlink,
--     reassign, or rewrite the anchor. A future explicit correction authority would
--     be required for that.
--   * an appointment may remain anchored to cycle N while the opportunity is now
--     in cycle N+1; that is expected and is exactly why the anchor exists.
--   * canonical completion must use the appointment anchor, never the opportunity's
--     current lifecycle_cycle at completion time.
--   * legacy rows are backfilled only from deterministic evidence:
--       1) current canonical completion pointer, when present;
--       2) current opportunity cycle = 1 (proves no reopen has occurred);
--       3) technical_visit_scheduled lifecycle history with exactly one distinct
--          lifecycle_cycle for the exact appointment_id legacy evidence string.
--     Ambiguous legacy rows remain NULL and therefore fail closed in consumers.
--   * legacy evidence_summary text is used only for this one-time deterministic
--     backfill; it does not become the permanent resolver authority.

do $preconditions$
begin
  if pg_catalog.to_regclass('public.store_appointments') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.store_appointment_completion_events') is null
     or pg_catalog.to_regclass('public.store_appointment_completion_current') is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: appointment lifecycle anchor dependencies missing';
  end if;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_appointments'
      and column_row.column_name = 'commercial_opportunity_lifecycle_cycle'
  ) then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: appointment lifecycle anchor column already exists';
  end if;
end;
$preconditions$;

alter table public.store_appointments
  add column commercial_opportunity_lifecycle_cycle integer null;

alter table public.store_appointments
  add constraint store_appointments_commercial_opportunity_lifecycle_cycle_chk
  check (
    commercial_opportunity_lifecycle_cycle is null
    or commercial_opportunity_lifecycle_cycle >= 1
  );

comment on column public.store_appointments.commercial_opportunity_lifecycle_cycle is
  'Immutable commercial lifecycle-cycle identity captured when this appointment is linked to a commercial opportunity. It is not the opportunity current cycle and must not be advanced on reopen.';

-- 1) Strongest legacy source: explicit current canonical completion authority.
update public.store_appointments appointment_row
set commercial_opportunity_lifecycle_cycle = completion_event.lifecycle_cycle
from public.store_appointment_completion_current completion_current
join public.store_appointment_completion_events completion_event
  on completion_event.id = completion_current.current_completion_event_id
 and completion_event.organization_id = completion_current.organization_id
 and completion_event.store_id = completion_current.store_id
 and completion_event.appointment_id = completion_current.appointment_id
where appointment_row.id = completion_current.appointment_id
  and appointment_row.organization_id = completion_current.organization_id
  and appointment_row.store_id = completion_current.store_id
  and appointment_row.commercial_opportunity_id is not null
  and completion_event.commercial_opportunity_id = appointment_row.commercial_opportunity_id
  and completion_event.lifecycle_cycle is not null
  and appointment_row.commercial_opportunity_lifecycle_cycle is null;

-- 2) Safe legacy inference: current cycle 1 proves the opportunity has never reopened.
update public.store_appointments appointment_row
set commercial_opportunity_lifecycle_cycle = opportunity_row.lifecycle_cycle
from public.commercial_opportunities opportunity_row
where opportunity_row.id = appointment_row.commercial_opportunity_id
  and opportunity_row.organization_id = appointment_row.organization_id
  and opportunity_row.store_id = appointment_row.store_id
  and opportunity_row.lifecycle_cycle = 1
  and appointment_row.commercial_opportunity_id is not null
  and appointment_row.commercial_opportunity_lifecycle_cycle is null;

-- 3) One-time legacy technical-visit bridge. Only an exact appointment-id evidence
--    match with exactly one distinct lifecycle cycle is accepted.
with exact_technical_visit_cycle as (
  select
    appointment_row.id as appointment_id,
    appointment_row.organization_id,
    appointment_row.store_id,
    pg_catalog.min(lifecycle_event.lifecycle_cycle) as lifecycle_cycle
  from public.store_appointments appointment_row
  join public.commercial_opportunity_lifecycle_events lifecycle_event
    on lifecycle_event.organization_id = appointment_row.organization_id
   and lifecycle_event.store_id = appointment_row.store_id
   and lifecycle_event.commercial_opportunity_id =
       appointment_row.commercial_opportunity_id
   and lifecycle_event.evidence_type = 'technical_visit_scheduled'
   and lifecycle_event.evidence_summary =
       'appointment_id=' || appointment_row.id::text
  where appointment_row.commercial_opportunity_id is not null
    and appointment_row.commercial_opportunity_lifecycle_cycle is null
    and appointment_row.appointment_type = 'technical_visit'
  group by
    appointment_row.id,
    appointment_row.organization_id,
    appointment_row.store_id
  having pg_catalog.count(distinct lifecycle_event.lifecycle_cycle) = 1
)
update public.store_appointments appointment_row
set commercial_opportunity_lifecycle_cycle =
      exact_cycle.lifecycle_cycle
from exact_technical_visit_cycle exact_cycle
where appointment_row.id = exact_cycle.appointment_id
  and appointment_row.organization_id = exact_cycle.organization_id
  and appointment_row.store_id = exact_cycle.store_id
  and appointment_row.commercial_opportunity_lifecycle_cycle is null;

create index store_appointments_scope_opportunity_cycle_type_status_idx
  on public.store_appointments (
    organization_id,
    store_id,
    commercial_opportunity_id,
    commercial_opportunity_lifecycle_cycle,
    appointment_type,
    status
  )
  where commercial_opportunity_id is not null;

create or replace function public.p9_store_appointment_validate_lifecycle_anchor_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_opportunity public.commercial_opportunities;
begin
  if new.commercial_opportunity_id is null then
    if new.commercial_opportunity_lifecycle_cycle is not null then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_LIFECYCLE_ANCHOR_WITHOUT_OPPORTUNITY';
    end if;

    if tg_op = 'UPDATE'
       and old.commercial_opportunity_id is not null then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMMERCIAL_LINK_CORRECTION_AUTHORITY_REQUIRED';
    end if;

    return new;
  end if;

  if new.commercial_opportunity_lifecycle_cycle is null then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_LIFECYCLE_ANCHOR_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = new.commercial_opportunity_id
    and opportunity_row.organization_id = new.organization_id
    and opportunity_row.store_id = new.store_id
  for key share;

  if not found then
    raise exception using errcode = '23503',
      message = 'ZION_APPOINTMENT_COMMERCIAL_OPPORTUNITY_SCOPE_NOT_FOUND';
  end if;

  if tg_op = 'INSERT' then
    if new.commercial_opportunity_lifecycle_cycle
         is distinct from v_opportunity.lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_LIFECYCLE_ANCHOR_MUST_MATCH_LINK_TIME_CYCLE';
    end if;

    return new;
  end if;

  -- Existing linked appointments retain their commercial identity forever under
  -- normal writers. Reopen advances the opportunity, not this anchor.
  if old.commercial_opportunity_id is not null then
    if new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
       or new.commercial_opportunity_lifecycle_cycle
            is distinct from old.commercial_opportunity_lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMMERCIAL_LINK_CORRECTION_AUTHORITY_REQUIRED';
    end if;

    return new;
  end if;

  -- First link of a previously unlinked appointment.
  if new.commercial_opportunity_lifecycle_cycle
       is distinct from v_opportunity.lifecycle_cycle then
    raise exception using errcode = '23514',
      message = 'ZION_APPOINTMENT_LIFECYCLE_ANCHOR_MUST_MATCH_LINK_TIME_CYCLE';
  end if;

  return new;
end;
$function$;

alter function public.p9_store_appointment_validate_lifecycle_anchor_internal()
  owner to postgres;

revoke all on function public.p9_store_appointment_validate_lifecycle_anchor_internal()
  from public, anon, authenticated, service_role;

create trigger store_appointments_validate_commercial_lifecycle_anchor
before insert or update of
  commercial_opportunity_id,
  commercial_opportunity_lifecycle_cycle
on public.store_appointments
for each row
execute function public.p9_store_appointment_validate_lifecycle_anchor_internal();

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
    if v_appointment.commercial_opportunity_lifecycle_cycle is not null
       or new.commercial_opportunity_id is not null
       or new.lifecycle_cycle is not null then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_UNLINKED_SCOPE_MISMATCH';
    end if;
  else
    if v_appointment.commercial_opportunity_lifecycle_cycle is null then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_LIFECYCLE_ANCHOR_UNRESOLVED';
    end if;

    if new.commercial_opportunity_id is distinct from v_appointment.commercial_opportunity_id then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_OPPORTUNITY_SCOPE_MISMATCH';
    end if;

    if new.lifecycle_cycle is distinct from v_appointment.commercial_opportunity_lifecycle_cycle then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_LIFECYCLE_CYCLE_MISMATCH';
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
    coalesce(
      nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(auth.jwt() ->> 'role', '')
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
    set
      commercial_opportunity_id = p_commercial_opportunity_id,
      commercial_opportunity_lifecycle_cycle = v_opportunity.lifecycle_cycle
    where appointment_row.id = v_created_appointment.id
    returning appointment_row.*
    into v_created_appointment;
  end if;

  return v_created_appointment;
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
    coalesce(
      nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(auth.jwt() ->> 'role', ''),
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
    if v_existing.commercial_opportunity_lifecycle_cycle is null then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_LIFECYCLE_ANCHOR_UNRESOLVED';
    end if;

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

    -- Frozen rule: completion belongs to the cycle in which the appointment
    -- was commercially anchored, even if the opportunity has since reopened.
    v_lifecycle_cycle := v_existing.commercial_opportunity_lifecycle_cycle;
  else
    if v_existing.commercial_opportunity_lifecycle_cycle is not null then
      raise exception using errcode = '23514',
        message = 'ZION_APPOINTMENT_COMPLETION_UNLINKED_CYCLE_ANCHOR_INVALID';
    end if;

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
    coalesce(v_lifecycle_cycle::text, 'none') || ':' ||
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
    nullif(pg_catalog.btrim(coalesce(p_completion_note, '')), ''),
    v_source_type,
    'p9_appointment_completion_v1',
    pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'canonical_authority', 'store_appointment_completion_events'
    )
  )
  returning *
  into v_new_event;

  v_final_notes := coalesce(v_existing.notes, '');

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
        confirmed_at = coalesce(confirmed_at, pg_catalog.now()),
        resolved_at = pg_catalog.now(),
        resolution = v_resolution,
        notes = case
          when p_completion_note is not null
               and pg_catalog.btrim(p_completion_note) <> '' then
            case
              when coalesce(notes, '') <> '' then
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
          when coalesce(notes, '') <> '' then
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

revoke all on function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) from public, anon;
grant execute on function public.complete_store_appointment_with_outcome(
  uuid, uuid, uuid, text, text
) to authenticated, service_role;

do $postconditions$
declare
  v_wrapper_definition text;
  v_completion_definition text;
  v_validator_definition text;
begin
  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_appointments'
      and column_row.column_name = 'commercial_opportunity_lifecycle_cycle'
      and column_row.data_type = 'integer'
      and column_row.is_nullable = 'YES'
  ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: appointment lifecycle anchor column missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'store_appointments'
      and trigger_row.tgname =
          'store_appointments_validate_commercial_lifecycle_anchor'
      and not trigger_row.tgisinternal
  ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: appointment lifecycle anchor trigger missing';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.p9_store_appointment_validate_lifecycle_anchor_internal()',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.p9_store_appointment_validate_lifecycle_anchor_internal()',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: appointment lifecycle anchor helper leaked';
  end if;

  -- Any canonical completion event must agree with its appointment anchor.
  if exists (
    select 1
    from public.store_appointment_completion_events completion_event
    join public.store_appointments appointment_row
      on appointment_row.id = completion_event.appointment_id
     and appointment_row.organization_id = completion_event.organization_id
     and appointment_row.store_id = completion_event.store_id
    where completion_event.commercial_opportunity_id is not null
      and (
        appointment_row.commercial_opportunity_id
          is distinct from completion_event.commercial_opportunity_id
        or appointment_row.commercial_opportunity_lifecycle_cycle is null
        or appointment_row.commercial_opportunity_lifecycle_cycle
          is distinct from completion_event.lifecycle_cycle
      )
  ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: completion authority disagrees with appointment lifecycle anchor';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_wrapper_definition;

  if v_wrapper_definition not like '%commercial_opportunity_lifecycle_cycle%'
     or v_wrapper_definition not like '%v_opportunity.lifecycle_cycle%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: commercial appointment wrapper does not snapshot lifecycle cycle';
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

  if v_completion_definition not like '%commercial_opportunity_lifecycle_cycle%'
     or v_completion_definition not like '%zion_appointment_completion_lifecycle_anchor_unresolved%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: canonical completion does not consume appointment lifecycle anchor';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.p9_store_appointment_completion_validate_event_internal()'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_validator_definition;

  if v_validator_definition not like '%commercial_opportunity_lifecycle_cycle%'
     or v_validator_definition like '%new.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle%' then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: completion validator still depends on current opportunity cycle';
  end if;
end;
$postconditions$;
