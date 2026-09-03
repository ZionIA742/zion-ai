-- ZION / Pilar 9 / Bloco 3 / Etapa 3.5
-- Appointment Lifecycle Cycle Anchor — rollback-only manual checks.

begin;

select pg_catalog.pg_advisory_xact_lock(903503405);

do $checks$
declare
  v_opportunity public.commercial_opportunities;
  v_appointment_id constant uuid :=
    '9f350405-0000-4000-8000-000000000001'::uuid;
  v_bad_appointment_id constant uuid :=
    '9f350405-0000-4000-8000-000000000002'::uuid;

  v_start timestamptz := pg_catalog.clock_timestamp() + interval '4200 days';
  v_end timestamptz := pg_catalog.clock_timestamp() + interval '4200 days 1 hour';

  v_row public.store_appointments;
  v_event public.store_appointment_completion_events;

  v_failed boolean;
  v_error_message text;
begin
  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_appointments'
      and column_row.column_name = 'commercial_opportunity_lifecycle_cycle'
      and column_row.data_type = 'integer'
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: appointment lifecycle anchor column missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.p9_store_appointment_validate_lifecycle_anchor_internal()'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: appointment lifecycle anchor validator missing';
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
      message = 'SUT_FAIL: appointment lifecycle anchor internal helper leaked';
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
      message = 'SUT_FAIL: appointment lifecycle anchor trigger missing';
  end if;

  -- Current audit contract: any opportunity still in cycle 1 is deterministic
  -- legacy evidence and must have been backfilled.
  if exists (
    select 1
    from public.store_appointments appointment_row
    join public.commercial_opportunities opportunity_row
      on opportunity_row.id = appointment_row.commercial_opportunity_id
     and opportunity_row.organization_id = appointment_row.organization_id
     and opportunity_row.store_id = appointment_row.store_id
    where appointment_row.commercial_opportunity_id is not null
      and opportunity_row.lifecycle_cycle = 1
      and appointment_row.commercial_opportunity_lifecycle_cycle is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: safe cycle-1 legacy appointment was not backfilled';
  end if;

  -- Exact one-cycle technical-visit lifecycle anchors must also be backfilled.
  if exists (
    with exact_cycle as (
      select
        appointment_row.id,
        pg_catalog.count(distinct lifecycle_event.lifecycle_cycle) as cycle_count
      from public.store_appointments appointment_row
      join public.commercial_opportunity_lifecycle_events lifecycle_event
        on lifecycle_event.organization_id = appointment_row.organization_id
       and lifecycle_event.store_id = appointment_row.store_id
       and lifecycle_event.commercial_opportunity_id =
           appointment_row.commercial_opportunity_id
       and lifecycle_event.evidence_type = 'technical_visit_scheduled'
       and lifecycle_event.evidence_summary =
           'appointment_id=' || appointment_row.id::text
      where appointment_row.appointment_type = 'technical_visit'
        and appointment_row.commercial_opportunity_id is not null
      group by appointment_row.id
    )
    select 1
    from exact_cycle exact_row
    join public.store_appointments appointment_row
      on appointment_row.id = exact_row.id
    where exact_row.cycle_count = 1
      and appointment_row.commercial_opportunity_lifecycle_cycle is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: deterministic technical-visit legacy anchor was not backfilled';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.stage not in ('perdido', 'concluido_sem_mais_acoes')
  order by opportunity_row.created_at, opportunity_row.id
  limit 1;

  if not found then
    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    order by opportunity_row.created_at, opportunity_row.id
    limit 1;
  end if;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: runner requires one commercial opportunity';
  end if;

  delete from public.store_appointment_completion_current
  where appointment_id in (v_appointment_id, v_bad_appointment_id);

  delete from public.store_appointment_completion_events
  where appointment_id in (v_appointment_id, v_bad_appointment_id);

  delete from public.schedule_post_appointment_followups
  where appointment_id in (v_appointment_id, v_bad_appointment_id);

  delete from public.store_appointments
  where id in (v_appointment_id, v_bad_appointment_id);

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
    v_appointment_id,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    'P9 lifecycle anchor runner',
    'technical_visit',
    'scheduled',
    v_start,
    v_end,
    'system',
    v_opportunity.id,
    v_opportunity.lifecycle_cycle
  );

  select appointment_row.*
  into v_row
  from public.store_appointments appointment_row
  where appointment_row.id = v_appointment_id;

  if v_row.commercial_opportunity_id is distinct from v_opportunity.id
     or v_row.commercial_opportunity_lifecycle_cycle
          is distinct from v_opportunity.lifecycle_cycle then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: valid appointment lifecycle anchor was not persisted';
  end if;

  -- A new commercial link cannot claim a cycle different from the current
  -- opportunity cycle at link time.
  v_failed := false;
  v_error_message := null;

  begin
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
      v_bad_appointment_id,
      v_opportunity.organization_id,
      v_opportunity.store_id,
      'P9 bad lifecycle anchor runner',
      'technical_visit',
      'scheduled',
      v_start + interval '2 hours',
      v_end + interval '2 hours',
      'system',
      v_opportunity.id,
      v_opportunity.lifecycle_cycle + 1
    );
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_LIFECYCLE_ANCHOR_MUST_MATCH_LINK_TIME_CYCLE%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: wrong lifecycle anchor was accepted';
  end if;

  -- Existing commercial identity is immutable through ordinary writes.
  v_failed := false;
  v_error_message := null;

  begin
    update public.store_appointments
    set commercial_opportunity_lifecycle_cycle =
          commercial_opportunity_lifecycle_cycle + 1
    where id = v_appointment_id;
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_COMMERCIAL_LINK_CORRECTION_AUTHORITY_REQUIRED%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: lifecycle anchor mutation was accepted';
  end if;

  v_failed := false;
  v_error_message := null;

  begin
    update public.store_appointments
    set
      commercial_opportunity_id = null,
      commercial_opportunity_lifecycle_cycle = null
    where id = v_appointment_id;
  exception
    when others then
      v_failed := true;
      v_error_message := sqlerrm;
  end;

  if not v_failed
     or v_error_message not like '%ZION_APPOINTMENT_COMMERCIAL_LINK_CORRECTION_AUTHORITY_REQUIRED%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: commercial appointment unlink was accepted';
  end if;

  -- Canonical completion must write the appointment anchor into its immutable
  -- authority event, not derive a fresh cycle from unrelated evidence.
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  perform public.complete_store_appointment_with_outcome(
    v_appointment_id,
    v_opportunity.organization_id,
    v_opportunity.store_id,
    'fully_completed',
    'lifecycle anchor runner completion'
  );

  select completion_event.*
  into v_event
  from public.store_appointment_completion_events completion_event
  join public.store_appointment_completion_current completion_current
    on completion_current.current_completion_event_id = completion_event.id
   and completion_current.organization_id = completion_event.organization_id
   and completion_current.store_id = completion_event.store_id
   and completion_current.appointment_id = completion_event.appointment_id
  where completion_event.appointment_id = v_appointment_id
    and completion_event.organization_id = v_opportunity.organization_id
    and completion_event.store_id = v_opportunity.store_id;

  if not found
     or v_event.commercial_opportunity_id is distinct from v_opportunity.id
     or v_event.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
     or v_event.completion_outcome is distinct from 'fully_completed' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: canonical completion did not preserve appointment lifecycle anchor';
  end if;

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
      message = 'SUT_FAIL: completion authority disagrees with appointment lifecycle anchor';
  end if;

  if pg_catalog.pg_get_functiondef(
       'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'::pg_catalog.regprocedure
     ) not like '%commercial_opportunity_lifecycle_cycle%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: commercial-context appointment writer does not snapshot lifecycle anchor';
  end if;

  if pg_catalog.pg_get_functiondef(
       'public.complete_store_appointment_with_outcome(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure
     ) not like '%commercial_opportunity_lifecycle_cycle%' then
    raise exception using errcode = 'P0001',
      message = 'SUT_FAIL: canonical completion writer does not consume lifecycle anchor';
  end if;
end;
$checks$;

rollback;
