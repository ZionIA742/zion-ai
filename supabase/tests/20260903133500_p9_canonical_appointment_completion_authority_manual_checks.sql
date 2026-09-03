-- ZION / Pilar 9 / Bloco 3 / Etapa 3.5
-- Canonical Appointment Completion Authority — rollback-only manual checks.
--
-- Success contract:
--   * script finishes without exception;
--   * transaction is rolled back;
--   * no business fixture remains.
--
-- This runner intentionally uses a service_role JWT claim for the public
-- completion RPC, matching its existing operational caller contract.

begin;

select pg_catalog.pg_advisory_xact_lock(903503145);

do $checks$
declare
  v_organization_id uuid;
  v_store_id uuid;

  v_appointment_id constant uuid :=
    '9f350001-0000-4000-8000-000000000001'::uuid;
  v_bypass_appointment_id constant uuid :=
    '9f350001-0000-4000-8000-000000000002'::uuid;

  v_start timestamptz := pg_catalog.clock_timestamp() + interval '3650 days';
  v_end timestamptz := pg_catalog.clock_timestamp() + interval '3650 days 1 hour';

  v_row public.store_appointments;
  v_event public.store_appointment_completion_events;
  v_current public.store_appointment_completion_current;

  v_count integer;
  v_first_event_id uuid;
  v_second_event_id uuid;
  v_failed boolean;
  v_error_message text;
begin
  -- -------------------------------------------------------------------------
  -- Schema / security contract.
  -- -------------------------------------------------------------------------

  if pg_catalog.to_regclass('public.store_appointment_completion_events') is null
     or pg_catalog.to_regclass('public.store_appointment_completion_current') is null then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: appointment completion authority tables missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.p9_compute_appointment_completion_fingerprint_internal(uuid,uuid,uuid,uuid,integer,text)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: completion fingerprint helper missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: completion public RPC missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'store_appointment_completion_events'
      and class_row.relrowsecurity is true
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: completion events RLS disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'store_appointment_completion_current'
      and class_row.relrowsecurity is true
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: completion current RLS disabled';
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
      message = 'SUT_FAIL: direct completion event mutation grant leaked';
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
      message = 'SUT_FAIL: direct completion current mutation grant leaked';
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
      message = 'SUT_FAIL: internal completion fingerprint helper leaked';
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
      message = 'SUT_FAIL: public completion RPC grants mismatch';
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
        'store_appointments_guard_canonical_completion_status'
      and not trigger_row.tgisinternal
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: store_appointments canonical completion guard missing';
  end if;

  -- -------------------------------------------------------------------------
  -- Resolve a real tenant only as fixture scope. No business row is reused.
  -- -------------------------------------------------------------------------

  select store_row.organization_id, store_row.id
  into v_organization_id, v_store_id
  from public.stores store_row
  order by store_row.organization_id, store_row.id
  limit 1;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: runner requires at least one store';
  end if;

  delete from public.store_appointment_completion_current
  where appointment_id in (v_appointment_id, v_bypass_appointment_id);

  delete from public.store_appointment_completion_events
  where appointment_id in (v_appointment_id, v_bypass_appointment_id);

  delete from public.schedule_post_appointment_followups
  where appointment_id in (v_appointment_id, v_bypass_appointment_id);

  delete from public.store_appointments
  where id in (v_appointment_id, v_bypass_appointment_id);

  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source
  )
  values (
    v_appointment_id,
    v_organization_id,
    v_store_id,
    'P9 runner canonical completion',
    'technical_visit',
    'scheduled',
    v_start,
    v_end,
    'system'
  );

  insert into public.store_appointments (
    id,
    organization_id,
    store_id,
    title,
    appointment_type,
    status,
    scheduled_start,
    scheduled_end,
    source
  )
  values (
    v_bypass_appointment_id,
    v_organization_id,
    v_store_id,
    'P9 runner completion bypass',
    'technical_visit',
    'scheduled',
    v_start + interval '2 hours',
    v_end + interval '2 hours',
    'system'
  );

  -- -------------------------------------------------------------------------
  -- Existing mutation doors must reject manufacturing completed status.
  -- -------------------------------------------------------------------------

  v_failed := false;
  v_error_message := null;

  begin
    perform public.update_store_appointment(
      v_bypass_appointment_id,
      v_organization_id,
      v_store_id,
      'P9 runner completion bypass',
      'technical_visit',
      'completed',
      v_start + interval '2 hours',
      v_end + interval '2 hours',
      null,
      null,
      null,
      null
    );
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: update_store_appointment still manufactures completed';
  end if;

  v_failed := false;
  v_error_message := null;

  begin
    perform public.create_store_appointment(
      v_organization_id,
      v_store_id,
      null,
      null,
      'P9 runner forbidden completed create',
      'technical_visit',
      'completed',
      v_start + interval '4 hours',
      v_end + interval '4 hours',
      null,
      null,
      null,
      null,
      'system',
      null
    );
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_COMPLETION_REQUIRES_CANONICAL_WRITER%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: create_store_appointment still manufactures completed';
  end if;

  -- -------------------------------------------------------------------------
  -- Canonical writer as service_role.
  -- -------------------------------------------------------------------------

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  select *
  into v_row
  from public.complete_store_appointment_with_outcome(
    v_appointment_id,
    v_organization_id,
    v_store_id,
    'needs_followup',
    'runner needs followup'
  );

  if v_row.status is distinct from 'completed' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: canonical completion did not set appointment completed';
  end if;

  select pg_catalog.count(*)::integer
  into v_count
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = v_organization_id
    and event_row.store_id = v_store_id
    and event_row.appointment_id = v_appointment_id;

  if v_count <> 1 then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: first canonical completion event count mismatch';
  end if;

  select event_row.*
  into v_event
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = v_organization_id
    and event_row.store_id = v_store_id
    and event_row.appointment_id = v_appointment_id
    and event_row.event_number = 1;

  if v_event.completion_outcome is distinct from 'needs_followup'
     or v_event.previous_completion_event_id is not null
     or v_event.actor_type is distinct from 'system'
     or v_event.actor_user_id is not null
     or v_event.commercial_opportunity_id is not null
     or v_event.lifecycle_cycle is not null
     or v_event.request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: first canonical completion event payload mismatch';
  end if;

  v_first_event_id := v_event.id;

  select current_row.*
  into v_current
  from public.store_appointment_completion_current current_row
  where current_row.organization_id = v_organization_id
    and current_row.store_id = v_store_id
    and current_row.appointment_id = v_appointment_id;

  if not found
     or v_current.current_completion_event_id is distinct from v_first_event_id
     or v_current.last_operation_key is distinct from v_event.operation_key then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: first canonical current pointer mismatch';
  end if;

  if not exists (
    select 1
    from public.schedule_post_appointment_followups followup_row
    where followup_row.organization_id = v_organization_id
      and followup_row.store_id = v_store_id
      and followup_row.appointment_id = v_appointment_id
      and followup_row.followup_status = 'prompt_sent'
      and followup_row.resolved_at is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: needs_followup did not preserve an open post-appointment obligation';
  end if;

  -- Same business outcome is idempotent.
  perform public.complete_store_appointment_with_outcome(
    v_appointment_id,
    v_organization_id,
    v_store_id,
    'needs_followup',
    'different retry note must not create new authority'
  );

  select pg_catalog.count(*)::integer
  into v_count
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = v_organization_id
    and event_row.store_id = v_store_id
    and event_row.appointment_id = v_appointment_id;

  if v_count <> 1 then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: needs_followup replay created duplicate authority';
  end if;

  -- Allowed convergence: needs_followup -> fully_completed.
  perform public.complete_store_appointment_with_outcome(
    v_appointment_id,
    v_organization_id,
    v_store_id,
    'fully_completed',
    'runner final completion'
  );

  select pg_catalog.count(*)::integer
  into v_count
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = v_organization_id
    and event_row.store_id = v_store_id
    and event_row.appointment_id = v_appointment_id;

  if v_count <> 2 then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: fully_completed convergence event count mismatch';
  end if;

  select event_row.*
  into v_event
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = v_organization_id
    and event_row.store_id = v_store_id
    and event_row.appointment_id = v_appointment_id
    and event_row.event_number = 2;

  if v_event.completion_outcome is distinct from 'fully_completed'
     or v_event.previous_completion_event_id is distinct from v_first_event_id then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: fully_completed convergence chain mismatch';
  end if;

  v_second_event_id := v_event.id;

  select current_row.*
  into v_current
  from public.store_appointment_completion_current current_row
  where current_row.organization_id = v_organization_id
    and current_row.store_id = v_store_id
    and current_row.appointment_id = v_appointment_id;

  if v_current.current_completion_event_id is distinct from v_second_event_id
     or v_current.last_operation_key is distinct from v_event.operation_key then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: fully_completed current pointer mismatch';
  end if;

  if not exists (
    select 1
    from public.schedule_post_appointment_followups followup_row
    where followup_row.organization_id = v_organization_id
      and followup_row.store_id = v_store_id
      and followup_row.appointment_id = v_appointment_id
      and followup_row.followup_status = 'confirmed_completed'
      and followup_row.resolved_at is not null
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: fully_completed did not resolve post-appointment obligation';
  end if;

  -- Replay of the current terminal outcome stays idempotent.
  perform public.complete_store_appointment_with_outcome(
    v_appointment_id,
    v_organization_id,
    v_store_id,
    'fully_completed',
    'another retry note'
  );

  select pg_catalog.count(*)::integer
  into v_count
  from public.store_appointment_completion_events event_row
  where event_row.organization_id = v_organization_id
    and event_row.store_id = v_store_id
    and event_row.appointment_id = v_appointment_id;

  if v_count <> 2 then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: fully_completed replay created duplicate authority';
  end if;

  -- Old outcome replay after convergence is stale, not a regression.
  v_failed := false;
  v_error_message := null;

  begin
    perform public.complete_store_appointment_with_outcome(
      v_appointment_id,
      v_organization_id,
      v_store_id,
      'needs_followup',
      'stale replay'
    );
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_COMPLETION_OBSOLETE_REPLAY%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: obsolete needs_followup replay was not rejected';
  end if;

  -- Completed appointment cannot be cancelled through the normal cancellation door.
  v_failed := false;
  v_error_message := null;

  begin
    perform public.cancel_store_appointment(
      v_appointment_id,
      v_organization_id,
      v_store_id,
      'runner forbidden cancellation after canonical completion'
    );
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_COMPLETION_REOPEN_REQUIRES_EXPLICIT_CORRECTION_AUTHORITY%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: completed appointment cancellation bypass remains';
  end if;

  -- Canonical event history is immutable even for the migration runner owner.
  v_failed := false;
  v_error_message := null;

  begin
    update public.store_appointment_completion_events
    set metadata = metadata || '{"runner_mutation":true}'::jsonb
    where id = v_second_event_id;
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_COMPLETION_EVENTS_APPEND_ONLY%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: canonical completion event history is mutable';
  end if;

  -- Chain tip invariant: current points to event 2 and event 2 has no child.
  if exists (
    select 1
    from public.store_appointment_completion_events child_row
    where child_row.previous_completion_event_id = v_second_event_id
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: unexpected child after terminal completion';
  end if;
end;
$checks$;

rollback;
