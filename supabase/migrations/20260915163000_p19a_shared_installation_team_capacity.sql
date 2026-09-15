-- P19-A Front 5: shared installation-team capacity
-- Forward-only follow-up to 20260915160000.
-- Technical visits consume installation-team capacity only when the canonical
-- technical visit policy explicitly says the same installation team performs them.

create or replace function public.p19a_guard_store_appointment_capacity_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_global_conflict boolean;
  v_installation_policy jsonb;
  v_installation_configured_at timestamptz;
  v_technical_visit_policy jsonb;
  v_technical_visit_configured_at timestamptz;
  v_visit_uses_installation_team boolean := false;
  v_consumes_installation_team boolean := false;
  v_installation_capacity numeric;
  v_shared_overlap_count bigint;
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
    new.organization_id,
    new.store_id,
    new.scheduled_start,
    new.scheduled_end,
    v_ignore_id
  ) into v_global_conflict;

  if v_global_conflict then
    raise exception using
      errcode = '23514',
      message = 'ZION_APPOINTMENT_GLOBAL_CAPACITY_EXCEEDED';
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
  where p.organization_id = new.organization_id
    and p.store_id = new.store_id;

  if v_installation_configured_at is null or v_installation_policy is null then
    return new;
  end if;

  v_installation_capacity := (v_installation_policy ->> 'concurrent_capacity')::numeric;

  if v_installation_capacity is null
     or v_installation_capacity < 1
     or v_installation_capacity <> pg_catalog.trunc(v_installation_capacity) then
    raise exception using
      errcode = '23514',
      message = 'ZION_INSTALLATION_CONCURRENT_CAPACITY_INVALID';
  end if;

  v_visit_uses_installation_team :=
    v_technical_visit_configured_at is not null
    and v_technical_visit_policy is not null
    and v_technical_visit_policy ->> 'team_mode' = 'mesma_instalacao';

  v_consumes_installation_team :=
    new.appointment_type = 'installation'
    or (new.appointment_type = 'technical_visit' and v_visit_uses_installation_team);

  if not v_consumes_installation_team then
    return new;
  end if;

  select pg_catalog.count(*)
  into v_shared_overlap_count
  from public.store_appointments a
  where a.organization_id = new.organization_id
    and a.store_id = new.store_id
    and a.status in ('scheduled', 'rescheduled')
    and a.scheduled_start < new.scheduled_end
    and a.scheduled_end > new.scheduled_start
    and (v_ignore_id is null or a.id <> v_ignore_id)
    and (
      a.appointment_type = 'installation'
      or (a.appointment_type = 'technical_visit' and v_visit_uses_installation_team)
    );

  if v_shared_overlap_count >= v_installation_capacity then
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

comment on function public.p19a_guard_store_appointment_capacity_internal() is
'P19-A canonical appointment capacity guard. Global agenda capacity remains authoritative; installation-team capacity additionally includes technical visits only when canonical visit policy uses the same installation team.';
