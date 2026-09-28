-- P9 / Bloco 7 / Etapa 7.3
-- Final forward-only operating-window contract after the already-applied:
--   20260928130000_p9_7_3_operational_capacity_timezone.sql
--   20260928144000_p9_7_3_installation_days_legacy_fallback.sql
--
-- Do not rewrite the already-applied migrations. This file finalizes the
-- effective runtime contract and restores the pre-7.3 holiday behavior.

create or replace function public.is_store_appointment_within_operating_window(
  p_organization_id uuid,
  p_store_id uuid,
  p_appointment_type text,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns boolean
language plpgsql
stable
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
  v_is_holiday boolean := false;
begin
  if p_start_at is null
     or p_end_at is null
     or p_end_at <= p_start_at then
    return false;
  end if;

  select *
  into v_schedule
  from public.store_schedule_settings
  where organization_id = p_organization_id
    and store_id = p_store_id;

  -- Legacy effective-settings fallback: no schedule row means no operating
  -- window enforcement.
  if not found then
    return true;
  end if;

  v_timezone := coalesce(
    nullif(pg_catalog.btrim(v_schedule.timezone_name), ''),
    'America/Sao_Paulo'
  );

  -- Explicitly configured invalid timezone fails closed.
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_row
    where timezone_row.name = v_timezone
  ) then
    return false;
  end if;

  -- Preserve the legacy disabled-window behavior, but only after validating an
  -- explicitly stored timezone.
  if coalesce(v_schedule.enforce_operating_window, false) is not true then
    return true;
  end if;

  v_start_local := pg_catalog.timezone(v_timezone, p_start_at);
  v_end_local := pg_catalog.timezone(v_timezone, p_end_at);

  if v_start_local::date is distinct from v_end_local::date then
    return false;
  end if;

  v_day := case extract(dow from v_start_local)::integer
    when 0 then 'domingo'
    when 1 then 'segunda'
    when 2 then 'terca'
    when 3 then 'quarta'
    when 4 then 'quinta'
    when 5 then 'sexta'
    when 6 then 'sabado'
    else null
  end;

  if v_day is null
     or pg_catalog.jsonb_typeof(v_schedule.operating_days) <> 'array'
     or not (v_schedule.operating_days ? v_day) then
    return false;
  end if;

  if p_appointment_type = 'technical_visit' then
    -- technical_visit_days is nullable:
    --   NULL = no type-specific restriction (fall back to operating_days)
    --   []   = explicitly no technical-visit days
    --   [...] = restrict to those days
    v_allowed_days := v_schedule.technical_visit_days;

    if v_allowed_days is not null then
      if pg_catalog.jsonb_typeof(v_allowed_days) <> 'array'
         or not (v_allowed_days ? v_day) then
        return false;
      end if;
    end if;

  elsif p_appointment_type = 'installation' then
    -- installation_days is NOT NULL DEFAULT [] and the canonical legacy writer
    -- coalesces NULL to []. Therefore [] is the legacy/unconfigured state and
    -- must fall back to operating_days. A non-empty array is restrictive.
    if pg_catalog.jsonb_typeof(v_schedule.installation_days) <> 'array' then
      return false;
    end if;

    if pg_catalog.jsonb_array_length(v_schedule.installation_days) > 0
       and not (v_schedule.installation_days ? v_day) then
      return false;
    end if;
  end if;

  -- Restore the behavior that existed before 7.3: when the store does not
  -- attend holidays, an overlapping holiday block closes the operating window.
  if coalesce(v_schedule.attends_holidays, false) is false then
    select exists (
      select 1
      from public.store_schedule_blocks block_row
      where block_row.organization_id = p_organization_id
        and block_row.store_id = p_store_id
        and block_row.block_type = 'holiday'
        and block_row.start_at < p_end_at
        and block_row.end_at > p_start_at
    )
    into v_is_holiday;

    if v_is_holiday then
      return false;
    end if;
  end if;

  if pg_catalog.jsonb_typeof(v_schedule.operating_hours) <> 'object' then
    return false;
  end if;

  v_hours := v_schedule.operating_hours -> v_day;

  if pg_catalog.jsonb_typeof(v_hours) <> 'object'
     or nullif(pg_catalog.btrim(coalesce(v_hours ->> 'start', '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(v_hours ->> 'end', '')), '') is null then
    return false;
  end if;

  begin
    return v_start_local::time >= (v_hours ->> 'start')::time
       and v_end_local::time <= (v_hours ->> 'end')::time;
  exception
    when others then
      return false;
  end;
exception
  when others then
    return false;
end;
$function$;

alter function public.is_store_appointment_within_operating_window(
  uuid, uuid, text, timestamptz, timestamptz
) owner to postgres;

revoke all on function public.is_store_appointment_within_operating_window(
  uuid, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.is_store_appointment_within_operating_window(
  uuid, uuid, text, timestamptz, timestamptz
) to service_role;

comment on function public.is_store_appointment_within_operating_window(
  uuid, uuid, text, timestamptz, timestamptz
) is
  'P9 7.3 final operating-window authority: canonical store timezone, fail-closed invalid timezone, general operating days/hours, technical-visit nullable day restriction, installation legacy [] fallback, and holiday closure preservation.';
