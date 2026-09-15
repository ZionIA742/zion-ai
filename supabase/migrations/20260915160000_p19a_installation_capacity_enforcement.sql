-- P19-A / Block 3 / Front 5
-- Enforce canonical agenda capacity plus installation-team concurrent capacity.

do $migration$
begin
  if pg_catalog.to_regclass('public.store_appointments') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.store_appointments is required';
  end if;

  if pg_catalog.to_regclass('public.store_operation_execution_policies') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.store_operation_execution_policies is required';
  end if;

  if pg_catalog.to_regprocedure('public.has_store_appointment_conflict(uuid,uuid,timestamptz,timestamptz,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.has_store_appointment_conflict(...) is required';
  end if;
end;
$migration$;

create or replace function public.p19a_guard_store_appointment_capacity_internal()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
set row_security = 'off'
as $function$
declare
  v_ignore_appointment_id uuid;
  v_has_global_conflict boolean;
  v_installation_configured_at timestamptz;
  v_installation_policy jsonb;
  v_installation_capacity numeric;
  v_installation_overlap_count bigint;
begin
  if new.status not in ('scheduled', 'rescheduled') then
    return new;
  end if;

  if new.scheduled_start is null
     or new.scheduled_end is null
     or new.scheduled_end <= new.scheduled_start then
    return new;
  end if;

  -- Serialize active appointment capacity decisions per store so two concurrent
  -- transactions cannot both observe the same free slot and overbook it.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.organization_id::text || ':' || new.store_id::text || ':appointment-capacity',
      0
    )
  );

  if tg_op = 'UPDATE' then
    v_ignore_appointment_id := old.id;
  else
    v_ignore_appointment_id := null;
  end if;

  -- Preserve the canonical global Agenda Capacity authority.
  select public.has_store_appointment_conflict(
    new.organization_id,
    new.store_id,
    new.scheduled_start,
    new.scheduled_end,
    v_ignore_appointment_id
  )
  into v_has_global_conflict;

  if coalesce(v_has_global_conflict, false) then
    raise exception using
      errcode = '23514',
      message = 'ZION_APPOINTMENT_GLOBAL_CAPACITY_EXCEEDED';
  end if;

  -- Only installations consume the installation-team capacity authority.
  if new.appointment_type is distinct from 'installation' then
    return new;
  end if;

  select
    policy_row.installation_configured_at,
    policy_row.installation_policy
  into
    v_installation_configured_at,
    v_installation_policy
  from public.store_operation_execution_policies policy_row
  where policy_row.organization_id = new.organization_id
    and policy_row.store_id = new.store_id;

  -- Unconfigured or explicitly disabled installation does not invent a team
  -- capacity here. Readiness/autonomy remains responsible for those states.
  if v_installation_configured_at is null
     or v_installation_policy is null then
    return new;
  end if;

  if pg_catalog.jsonb_typeof(v_installation_policy -> 'concurrent_capacity') <> 'number' then
    raise exception using
      errcode = '23514',
      message = 'ZION_INSTALLATION_CAPACITY_INVALID';
  end if;

  v_installation_capacity := (v_installation_policy ->> 'concurrent_capacity')::numeric;

  if v_installation_capacity < 1
     or v_installation_capacity <> pg_catalog.trunc(v_installation_capacity) then
    raise exception using
      errcode = '23514',
      message = 'ZION_INSTALLATION_CAPACITY_INVALID';
  end if;

  select count(*)
  into v_installation_overlap_count
  from public.store_appointments appointment_row
  where appointment_row.organization_id = new.organization_id
    and appointment_row.store_id = new.store_id
    and appointment_row.appointment_type = 'installation'
    and appointment_row.status in ('scheduled', 'rescheduled')
    and appointment_row.scheduled_start < new.scheduled_end
    and appointment_row.scheduled_end > new.scheduled_start
    and (v_ignore_appointment_id is null or appointment_row.id <> v_ignore_appointment_id);

  if coalesce(v_installation_overlap_count, 0) >= v_installation_capacity then
    raise exception using
      errcode = '23514',
      message = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED';
  end if;

  return new;
end;
$function$;

alter function public.p19a_guard_store_appointment_capacity_internal() owner to postgres;
revoke all on function public.p19a_guard_store_appointment_capacity_internal() from public, anon, authenticated, service_role;

drop trigger if exists store_appointments_p19a_capacity_guard on public.store_appointments;

create trigger store_appointments_p19a_capacity_guard
before insert or update of organization_id, store_id, appointment_type, status, scheduled_start, scheduled_end
on public.store_appointments
for each row
execute function public.p19a_guard_store_appointment_capacity_internal();

comment on function public.p19a_guard_store_appointment_capacity_internal() is
'P19-A canonical appointment-capacity guard. Enforces global agenda capacity for active appointments and, for installation appointments, the canonical installation_policy.concurrent_capacity without creating a second installation-capacity authority.';

do $postcondition$
declare
  v_trigger_count integer;
  v_definition text;
begin
  select count(*)
  into v_trigger_count
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.store_appointments'::pg_catalog.regclass
    and trigger_row.tgname = 'store_appointments_p19a_capacity_guard'
    and not trigger_row.tgisinternal;

  if v_trigger_count <> 1 then
    raise exception using errcode = 'P0001', message = 'postcondition failed: capacity guard trigger missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.p19a_guard_store_appointment_capacity_internal()'::pg_catalog.regprocedure
  )
  into v_definition;

  if v_definition not like '%has_store_appointment_conflict%'
     or v_definition not like '%installation_policy%'
     or v_definition not like '%concurrent_capacity%'
     or v_definition not like '%ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED%' then
    raise exception using errcode = 'P0001', message = 'postcondition failed: capacity guard definition mismatch';
  end if;
end;
$postcondition$;
