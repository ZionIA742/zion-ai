-- P19-A Front 6: canonical appointment availability.
-- One reusable authority composes operating window, schedule blocks,
-- global agenda capacity and installation-team capacity.

create or replace function public.p19a_check_installation_team_capacity_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_appointment_type text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_ignore_appointment_id uuid default null
)
returns text
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_installation_policy jsonb;
  v_installation_configured_at timestamptz;
  v_technical_visit_policy jsonb;
  v_technical_visit_configured_at timestamptz;
  v_visit_uses_installation_team boolean := false;
  v_capacity_text text;
  v_installation_capacity integer;
  v_shared_overlap_count bigint;
begin
  if p_appointment_type is null
     or p_appointment_type not in ('installation', 'technical_visit') then
    return 'not_applicable';
  end if;

  select
    p.installation_configured_at,
    p.installation_policy,
    p.technical_visit_configured_at,
    p.technical_visit_policy
  into
    v_installation_configured_at,
    v_installation_policy,
    v_technical_visit_configured_at,
    v_technical_visit_policy
  from public.store_operation_execution_policies p
  where p.organization_id = p_organization_id
    and p.store_id = p_store_id;

  if v_installation_configured_at is null or v_installation_policy is null then
    return 'unconfigured';
  end if;

  v_visit_uses_installation_team :=
    v_technical_visit_configured_at is not null
    and v_technical_visit_policy is not null
    and v_technical_visit_policy ->> 'team_mode' = 'mesma_instalacao';

  if p_appointment_type = 'technical_visit' and not v_visit_uses_installation_team then
    return 'not_applicable';
  end if;

  v_capacity_text := nullif(pg_catalog.btrim(v_installation_policy ->> 'concurrent_capacity'), '');

  if v_capacity_text is null or v_capacity_text !~ '^[0-9]+$' then
    return 'invalid';
  end if;

  v_installation_capacity := v_capacity_text::integer;
  if v_installation_capacity < 1 then
    return 'invalid';
  end if;

  select pg_catalog.count(*)
  into v_shared_overlap_count
  from public.store_appointments a
  where a.organization_id = p_organization_id
    and a.store_id = p_store_id
    and a.status in ('scheduled', 'rescheduled')
    and a.scheduled_start < p_end_at
    and a.scheduled_end > p_start_at
    and (p_ignore_appointment_id is null or a.id <> p_ignore_appointment_id)
    and (
      a.appointment_type = 'installation'
      or (a.appointment_type = 'technical_visit' and v_visit_uses_installation_team)
    );

  if v_shared_overlap_count >= v_installation_capacity then
    return 'conflict';
  end if;

  return 'available';
end;
$function$;

alter function public.p19a_check_installation_team_capacity_internal(uuid,uuid,text,timestamptz,timestamptz,uuid) owner to postgres;
revoke all on function public.p19a_check_installation_team_capacity_internal(uuid,uuid,text,timestamptz,timestamptz,uuid) from public;
revoke all on function public.p19a_check_installation_team_capacity_internal(uuid,uuid,text,timestamptz,timestamptz,uuid) from anon;
revoke all on function public.p19a_check_installation_team_capacity_internal(uuid,uuid,text,timestamptz,timestamptz,uuid) from authenticated;
revoke all on function public.p19a_check_installation_team_capacity_internal(uuid,uuid,text,timestamptz,timestamptz,uuid) from service_role;

create or replace function public.check_store_appointment_availability_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_appointment_type text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_ignore_appointment_id uuid default null
)
returns table(available boolean, reason_code text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_installation_status text;
begin
  if p_organization_id is null or p_store_id is null
     or p_start_at is null or p_end_at is null
     or p_end_at <= p_start_at then
    return query select false, 'invalid_request'::text;
    return;
  end if;

  if p_appointment_type is null or p_appointment_type not in (
    'technical_visit', 'installation', 'follow_up', 'meeting',
    'measurement', 'maintenance', 'other'
  ) then
    return query select false, 'invalid_appointment_type'::text;
    return;
  end if;

  if not public.is_store_appointment_within_operating_window(
    p_organization_id, p_store_id, p_appointment_type, p_start_at, p_end_at
  ) then
    return query select false, 'outside_operating_window'::text;
    return;
  end if;

  if public.has_store_schedule_block_conflict(
    p_organization_id, p_store_id, p_start_at, p_end_at
  ) then
    return query select false, 'schedule_block_conflict'::text;
    return;
  end if;

  if public.has_store_appointment_conflict(
    p_organization_id, p_store_id, p_start_at, p_end_at, p_ignore_appointment_id
  ) then
    return query select false, 'global_capacity_exceeded'::text;
    return;
  end if;

  v_installation_status := public.p19a_check_installation_team_capacity_internal(
    p_organization_id, p_store_id, p_appointment_type, p_start_at, p_end_at, p_ignore_appointment_id
  );

  if v_installation_status = 'invalid' then
    return query select false, 'installation_team_capacity_invalid'::text;
    return;
  end if;

  if v_installation_status = 'conflict' then
    return query select false, 'installation_team_capacity_exceeded'::text;
    return;
  end if;

  return query select true, null::text;
end;
$function$;

alter function public.check_store_appointment_availability_by_system(uuid,uuid,text,timestamptz,timestamptz,uuid) owner to postgres;
revoke all on function public.check_store_appointment_availability_by_system(uuid,uuid,text,timestamptz,timestamptz,uuid) from public;
revoke all on function public.check_store_appointment_availability_by_system(uuid,uuid,text,timestamptz,timestamptz,uuid) from anon;
revoke all on function public.check_store_appointment_availability_by_system(uuid,uuid,text,timestamptz,timestamptz,uuid) from authenticated;
grant execute on function public.check_store_appointment_availability_by_system(uuid,uuid,text,timestamptz,timestamptz,uuid) to service_role;

create or replace function public.p19a_guard_store_appointment_capacity_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_global_conflict boolean;
  v_installation_status text;
  v_ignore_id uuid;
begin
  perform pg_catalog.set_config('row_security', 'off', true);

  if new.status not in ('scheduled', 'rescheduled') then
    return new;
  end if;

  if new.scheduled_start is null or new.scheduled_end is null or new.scheduled_end <= new.scheduled_start then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.organization_id::text || ':' || new.store_id::text || ':appointment-capacity',
      0
    )
  );

  v_ignore_id := case when tg_op = 'UPDATE' then old.id else null end;

  select public.has_store_appointment_conflict(
    new.organization_id, new.store_id, new.scheduled_start, new.scheduled_end, v_ignore_id
  ) into v_global_conflict;

  if v_global_conflict then
    raise exception using
      errcode = '23514',
      message = 'ZION_APPOINTMENT_GLOBAL_CAPACITY_EXCEEDED';
  end if;

  v_installation_status := public.p19a_check_installation_team_capacity_internal(
    new.organization_id,
    new.store_id,
    new.appointment_type,
    new.scheduled_start,
    new.scheduled_end,
    v_ignore_id
  );

  if v_installation_status = 'invalid' then
    raise exception using
      errcode = '23514',
      message = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_INVALID';
  end if;

  if v_installation_status = 'conflict' then
    raise exception using
      errcode = '23514',
      message = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_EXCEEDED';
  end if;

  return new;
end;
$function$;

alter function public.p19a_guard_store_appointment_capacity_internal() owner to postgres;
revoke all on function public.p19a_guard_store_appointment_capacity_internal() from public;
revoke all on function public.p19a_guard_store_appointment_capacity_internal() from anon;
revoke all on function public.p19a_guard_store_appointment_capacity_internal() from authenticated;

comment on function public.check_store_appointment_availability_by_system(uuid,uuid,text,timestamptz,timestamptz,uuid) is
'Canonical system availability check for P19-A. Composes operating window, schedule blocks, global agenda capacity and shared installation-team capacity.';

comment on function public.p19a_check_installation_team_capacity_internal(uuid,uuid,text,timestamptz,timestamptz,uuid) is
'Internal reusable authority for installation-team capacity, including technical visits configured to use the same installation team.';
