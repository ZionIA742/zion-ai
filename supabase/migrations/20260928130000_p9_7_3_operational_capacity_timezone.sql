-- P9 / Bloco 7 / Etapa 7.3
-- Forward-only runtime correction. Remote execution is intentionally not part
-- of this change.

-- IMPORTANT: keep the existing PostgreSQL input parameter names p_start_at / p_end_at.
-- CREATE OR REPLACE FUNCTION cannot rename input parameters for an existing signature.

create or replace function public.is_store_appointment_within_operating_window(
  p_organization_id uuid,
  p_store_id uuid,
  p_appointment_type text,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_schedule public.store_schedule_settings%rowtype;
  v_timezone text;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day text;
  v_allowed_days jsonb;
  v_hours jsonb;
begin
  if p_start_at is null or p_end_at is null
     or p_end_at <= p_start_at then
    return false;
  end if;

  select * into v_schedule
  from public.store_schedule_settings
  where organization_id = p_organization_id and store_id = p_store_id;

  if not found then
    return true;
  end if;

  v_timezone := coalesce(nullif(pg_catalog.btrim(v_schedule.timezone_name), ''), 'America/Sao_Paulo');
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    return false;
  end if;

  if coalesce(v_schedule.enforce_operating_window, false) is not true then
    return true;
  end if;

  v_start_local := pg_catalog.timezone(v_timezone, p_start_at);
  v_end_local := pg_catalog.timezone(v_timezone, p_end_at);
  v_day := case extract(dow from v_start_local)::integer
    when 0 then 'domingo' when 1 then 'segunda' when 2 then 'terca'
    when 3 then 'quarta' when 4 then 'quinta' when 5 then 'sexta'
    when 6 then 'sabado' end;

  if v_start_local::date is distinct from v_end_local::date then
    return false;
  end if;

  if jsonb_typeof(v_schedule.operating_days) <> 'array'
     or not (v_schedule.operating_days ? v_day) then
    return false;
  end if;

  if p_appointment_type = 'technical_visit' then
    v_allowed_days := v_schedule.technical_visit_days;
  elsif p_appointment_type = 'installation' then
    v_allowed_days := v_schedule.installation_days;
  else
    v_allowed_days := null;
  end if;

  if v_allowed_days is not null
     and (jsonb_typeof(v_allowed_days) <> 'array' or not (v_allowed_days ? v_day)) then
    return false;
  end if;

  v_hours := v_schedule.operating_hours -> v_day;
  if jsonb_typeof(v_hours) <> 'object'
     or (v_hours ->> 'start') is null or (v_hours ->> 'end') is null then
    return false;
  end if;

  return v_start_local::time >= (v_hours ->> 'start')::time
     and v_end_local::time <= (v_hours ->> 'end')::time;
exception when others then
  return false;
end;
$function$;

create or replace function public.has_store_appointment_conflict(
  p_organization_id uuid,
  p_store_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_ignore_appointment_id uuid default null::uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_schedule public.store_schedule_settings%rowtype;
  v_timezone text := 'America/Sao_Paulo';
  v_local_day date;
  v_active_count integer;
  v_overlap_count integer;
  v_buffer integer := 0;
  v_has_schedule boolean := false;
  v_allow_multiple boolean := false;
  v_allow_same_time boolean := false;
  v_same_time_capacity integer := 1;
begin
  if p_start_at is null or p_end_at is null
     or p_end_at <= p_start_at then
    return true;
  end if;

  select * into v_schedule
  from public.store_schedule_settings
  where organization_id = p_organization_id and store_id = p_store_id;

  if found then
    v_has_schedule := true;
    v_timezone := coalesce(nullif(pg_catalog.btrim(v_schedule.timezone_name), ''), 'America/Sao_Paulo');
    v_allow_multiple := coalesce(v_schedule.allow_multiple_appointments_per_day, false);
    v_allow_same_time := coalesce(v_schedule.allow_same_time_appointments, false);
    v_same_time_capacity := greatest(coalesce(v_schedule.same_time_capacity, 1), 1);
  else
    -- Exact effective-settings fallback for stores without a schedule row.
    v_allow_multiple := true;
    v_allow_same_time := false;
    v_same_time_capacity := 1;
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    return true;
  end if;

  v_local_day := (pg_catalog.timezone(v_timezone, p_start_at))::date;

  if v_has_schedule and v_schedule.agenda_capacity_configured_at is not null then
    if v_schedule.daily_limit_mode = 'fixed_limit'
       and coalesce(v_schedule.daily_limit, 0) > 0 then
      select count(*) into v_active_count
      from public.store_appointments appointment_row
      where appointment_row.organization_id = p_organization_id
        and appointment_row.store_id = p_store_id
        and appointment_row.id is distinct from p_ignore_appointment_id
        and appointment_row.status in ('scheduled', 'rescheduled')
        and (pg_catalog.timezone(v_timezone, appointment_row.scheduled_start))::date = v_local_day;
      if v_active_count >= v_schedule.daily_limit then return true; end if;
    end if;

    if coalesce(v_schedule.appointment_buffer_enabled, false)
       and coalesce(v_schedule.appointment_buffer_minutes, 0) > 0 then
      v_buffer := v_schedule.appointment_buffer_minutes;
      if exists (
        select 1 from public.store_appointments appointment_row
        where appointment_row.organization_id = p_organization_id
          and appointment_row.store_id = p_store_id
          and appointment_row.id is distinct from p_ignore_appointment_id
          and appointment_row.status in ('scheduled', 'rescheduled')
          and ((appointment_row.scheduled_end <= p_start_at
                and p_start_at - appointment_row.scheduled_end < make_interval(mins => v_buffer))
            or (appointment_row.scheduled_start >= p_end_at
                and appointment_row.scheduled_start - p_end_at < make_interval(mins => v_buffer)))
      ) then return true; end if;
    end if;
  else
    -- Legacy rows deliberately do not consume modern daily-limit/buffer fields.
    if not v_allow_multiple then
      select count(*) into v_active_count
      from public.store_appointments appointment_row
      where appointment_row.organization_id = p_organization_id
        and appointment_row.store_id = p_store_id
        and appointment_row.id is distinct from p_ignore_appointment_id
        and appointment_row.status in ('scheduled', 'rescheduled')
        and (pg_catalog.timezone(v_timezone, appointment_row.scheduled_start))::date = v_local_day;
      if v_active_count >= 1 then return true; end if;
    end if;
  end if;

  select count(*) into v_overlap_count
  from public.store_appointments appointment_row
  where appointment_row.organization_id = p_organization_id
    and appointment_row.store_id = p_store_id
    and appointment_row.id is distinct from p_ignore_appointment_id
    and appointment_row.status in ('scheduled', 'rescheduled')
    and appointment_row.scheduled_start < p_end_at
    and appointment_row.scheduled_end > p_start_at;

  if v_overlap_count = 0 then return false; end if;
  if ((v_has_schedule and v_schedule.agenda_capacity_configured_at is null)
      or (v_has_schedule and v_schedule.agenda_capacity_configured_at is not null))
     and v_allow_same_time
     and v_same_time_capacity >= 2
     and v_overlap_count < v_same_time_capacity then
    return false;
  end if;
  return true;
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
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_existing public.store_appointments;
  v_row public.store_appointments;
  v_notes text;
  v_request_role text := public.zion_resolve_request_role_internal();
begin
  if v_request_role = 'authenticated' then
    if auth.uid() is null or not exists (
      select 1 from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    ) then
      raise exception using errcode = '42501', message = 'cancel_store_appointment scope is not authorized';
    end if;
  elsif v_request_role not in ('service_role', 'postgres') then
    raise exception using errcode = '42501', message = 'cancel_store_appointment scope is not authorized';
  end if;

  select * into v_existing from public.store_appointments
  where id = p_appointment_id and organization_id = p_organization_id and store_id = p_store_id;
  if not found then raise exception 'Compromisso não encontrado para esta organização/loja.'; end if;
  if v_existing.status = 'cancelled' then raise exception 'Este compromisso já está cancelado.'; end if;
  if v_existing.status = 'completed' then
    raise exception using errcode = '23514', message = 'ZION_APPOINTMENT_COMPLETION_REOPEN_REQUIRES_EXPLICIT_CORRECTION_AUTHORITY';
  end if;

  v_notes := coalesce(v_existing.notes, '');
  if p_cancel_reason is not null and pg_catalog.btrim(p_cancel_reason) <> '' then
    v_notes := case when v_notes <> '' then v_notes || E'\n\n[Cancelamento] ' else '[Cancelamento] ' end || pg_catalog.btrim(p_cancel_reason);
  end if;
  update public.store_appointments set status = 'cancelled', notes = v_notes
  where id = p_appointment_id and organization_id = p_organization_id and store_id = p_store_id
  returning * into v_row;
  return v_row;
end;
$function$;

alter function public.is_store_appointment_within_operating_window(uuid, uuid, text, timestamptz, timestamptz) owner to postgres;
alter function public.has_store_appointment_conflict(uuid, uuid, timestamptz, timestamptz, uuid) owner to postgres;
alter function public.cancel_store_appointment(uuid, uuid, uuid, text) owner to postgres;
revoke all on function public.has_store_appointment_conflict(uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.is_store_appointment_within_operating_window(uuid, uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- These helpers are SECURITY DEFINER + row_security=off. They are internal
-- availability/capacity authorities and must not be directly callable by an
-- authenticated tenant with arbitrary organization/store identifiers.
-- Canonical application writers are SECURITY DEFINER and the public
-- availability reader is service-role-only, so service_role is sufficient.
grant execute on function public.has_store_appointment_conflict(uuid, uuid, timestamptz, timestamptz, uuid)
  to service_role;
grant execute on function public.is_store_appointment_within_operating_window(uuid, uuid, text, timestamptz, timestamptz)
  to service_role;
revoke all on function public.cancel_store_appointment(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_store_appointment(uuid, uuid, uuid, text) to authenticated, service_role;
