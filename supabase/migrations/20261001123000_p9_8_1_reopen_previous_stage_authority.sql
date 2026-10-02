-- P9 8.1 / Passo 2
-- A reopen must restore the stage recorded by the canonical marked_lost event.
-- This migration is additive and preserves the public signatures and wrappers.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261001123000_p9_8_1_reopen_previous_stage_authority',
    0
  )
);

do $migration$
declare
  v_function_oid oid;
  v_definition text;
  v_needle text := $needle$
  if v_opportunity.stage <> 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_REOPEN_REQUIRES_LOST_STAGE';
  end if;
$needle$;
  v_guard text := $guard$

  if not exists (
    select 1
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.id = v_opportunity.current_loss_event_id
      and lifecycle_event.organization_id = v_opportunity.organization_id
      and lifecycle_event.store_id = v_opportunity.store_id
      and lifecycle_event.commercial_opportunity_id = v_opportunity.id
      and lifecycle_event.customer_id = v_opportunity.customer_id
      and lifecycle_event.lifecycle_cycle = v_opportunity.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost'
      and lifecycle_event.previous_stage is not null
      and public.normalize_commercial_opportunity_stage(lifecycle_event.previous_stage) = v_target_stage
      and lifecycle_event.new_stage = 'perdido'
  ) then
    if exists (
      select 1
      from public.commercial_opportunity_lifecycle_events lifecycle_event
      where lifecycle_event.id = v_opportunity.current_loss_event_id
        and lifecycle_event.organization_id = v_opportunity.organization_id
        and lifecycle_event.store_id = v_opportunity.store_id
        and lifecycle_event.commercial_opportunity_id = v_opportunity.id
        and lifecycle_event.customer_id = v_opportunity.customer_id
        and lifecycle_event.lifecycle_cycle = v_opportunity.lifecycle_cycle
        and lifecycle_event.event_type = 'marked_lost'
        and lifecycle_event.previous_stage is not null
        and lifecycle_event.new_stage = 'perdido'
    ) then
      raise exception using
        errcode = '23514',
        message = 'ZION_REOPEN_TARGET_STAGE_MISMATCH';
    end if;

    raise exception using
      errcode = '23514',
      message = 'ZION_REOPEN_LOSS_EVENT_INVALID';
  end if;
$guard$;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)'
  );

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_REOPEN_INTERNAL_FUNCTION_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
  into v_definition;

  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_REOPEN_INTERNAL_FUNCTION_SHAPE_UNEXPECTED';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_needle, v_needle || v_guard);
  execute v_definition;

  select pg_catalog.pg_get_functiondef(v_function_oid)
  into v_definition;

  if pg_catalog.strpos(v_definition, 'ZION_REOPEN_TARGET_STAGE_MISMATCH') = 0
     or pg_catalog.strpos(v_definition, 'current_loss_event_id') = 0
     or pg_catalog.strpos(v_definition, 'lifecycle_event.previous_stage is not null') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_REOPEN_INTERNAL_FUNCTION_POSTCONDITION_FAILED';
  end if;
end;
$migration$;

commit;
