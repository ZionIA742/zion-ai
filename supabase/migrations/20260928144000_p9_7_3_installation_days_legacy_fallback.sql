-- P9 / Bloco 7 / Etapa 7.3
-- Forward-only correction after 20260928130000 was already applied remotely.
-- installation_days is NOT NULL DEFAULT '[]'::jsonb, so [] is the legacy /
-- unconfigured representation and must fall back to operating_days instead of
-- blocking every installation when the operating window is enforced.

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
  where organization_id = p_organization_id
    and store_id = p_store_id;

  if not found then
    return true;
  end if;

  v_timezone := coalesce(
    nullif(pg_catalog.btrim(v_schedule.timezone_name), ''),
    'America/Sao_Paulo'
  );

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = v_timezone
  ) then
    return false;
  end if;

  if coalesce(v_schedule.enforce_operating_window, false) is not true then
    return true;
  end if;

  v_start_local := pg_catalog.timezone(v_timezone, p_start_at);
  v_end_local := pg_catalog.timezone(v_timezone, p_end_at);

  v_day := case extract(dow from v_start_local)::integer
    when 0 then 'domingo'
    when 1 then 'segunda'
    when 2 then 'terca'
    when 3 then 'quarta'
    when 4 then 'quinta'
    when 5 then 'sexta'
    when 6 then 'sabado'
  end;

  if v_start_local::date is distinct from v_end_local::date then
    return false;
  end if;

  if jsonb_typeof(v_schedule.operating_days) <> 'array'
     or not (v_schedule.operating_days ? v_day) then
    return false;
  end if;

  if p_appointment_type = 'technical_visit' then
    -- technical_visit_days is nullable and its writer preserves NULL vs []:
    -- NULL = no type-specific restriction; [] = explicitly no allowed days.
    v_allowed_days := v_schedule.technical_visit_days;

  elsif p_appointment_type = 'installation' then
    -- installation_days is NOT NULL DEFAULT [] and the canonical legacy writer
    -- coalesces NULL to []. Therefore [] cannot safely mean "block all";
    -- it means no type-specific restriction and falls back to operating_days.
    if jsonb_typeof(v_schedule.installation_days) = 'array'
       and jsonb_array_length(v_schedule.installation_days) > 0 then
      v_allowed_days := v_schedule.installation_days;
    else
      v_allowed_days := null;
    end if;

  else
    v_allowed_days := null;
  end if;

  if v_allowed_days is not null
     and (
       jsonb_typeof(v_allowed_days) <> 'array'
       or not (v_allowed_days ? v_day)
     ) then
    return false;
  end if;

  v_hours := v_schedule.operating_hours -> v_day;

  if jsonb_typeof(v_hours) <> 'object'
     or (v_hours ->> 'start') is null
     or (v_hours ->> 'end') is null then
    return false;
  end if;

  return v_start_local::time >= (v_hours ->> 'start')::time
     and v_end_local::time <= (v_hours ->> 'end')::time;

exception when others then
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
