-- P19-A / Bloco 3 / Etapa 3.3 - Sales AI after-hours and holiday authority.
-- Human schedule remains owned by operating_days/operating_hours/timezone_name.
-- These columns define the Sales AI layer over that human schedule.

alter table public.store_schedule_settings
  add column if not exists ai_after_hours_enabled boolean not null default false,
  add column if not exists ai_after_hours_mode text null,
  add column if not exists ai_after_hours_start time without time zone null,
  add column if not exists ai_after_hours_end time without time zone null,
  add column if not exists ai_attends_holidays boolean not null default false;

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_schedule_settings'::regclass
      and constraint_row.conname = 'store_schedule_settings_ai_after_hours_mode_valid'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_ai_after_hours_mode_valid
      check (
        ai_after_hours_mode is null
        or ai_after_hours_mode in ('all_closed_hours', 'specific_window')
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_schedule_settings'::regclass
      and constraint_row.conname = 'store_schedule_settings_ai_after_hours_policy_complete'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_ai_after_hours_policy_complete
      check (
        ai_after_hours_enabled = false
        or ai_after_hours_mode = 'all_closed_hours'
        or (
          ai_after_hours_mode = 'specific_window'
          and ai_after_hours_start is not null
          and ai_after_hours_end is not null
          and ai_after_hours_start <> ai_after_hours_end
        )
      );
  end if;
end;
$block$;

comment on column public.store_schedule_settings.ai_after_hours_enabled is
  'Canonical flag: whether Sales AI may answer while the human team is outside its configured schedule.';

comment on column public.store_schedule_settings.ai_after_hours_mode is
  'Canonical Sales AI after-hours mode: all_closed_hours or specific_window.';

comment on column public.store_schedule_settings.ai_after_hours_start is
  'Canonical local start time for the Sales AI specific after-hours window.';

comment on column public.store_schedule_settings.ai_after_hours_end is
  'Canonical local end time for the Sales AI specific after-hours window.';

comment on column public.store_schedule_settings.ai_attends_holidays is
  'Canonical flag: whether Sales AI may answer on holiday blocks when humans are unavailable.';

create or replace function public.upsert_store_schedule_ai_after_hours_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_ai_after_hours_enabled boolean,
  p_ai_after_hours_mode text,
  p_ai_after_hours_start time without time zone default null,
  p_ai_after_hours_end time without time zone default null,
  p_ai_attends_holidays boolean default false
)
returns public.store_schedule_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_mode text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_ai_after_hours_mode, '')), ''));
  v_result public.store_schedule_settings%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if coalesce(p_ai_after_hours_enabled, false) is false then
    v_mode := null;
    p_ai_after_hours_start := null;
    p_ai_after_hours_end := null;
  elsif v_mode = 'all_closed_hours' then
    p_ai_after_hours_start := null;
    p_ai_after_hours_end := null;
  elsif v_mode = 'specific_window' then
    if p_ai_after_hours_start is null
       or p_ai_after_hours_end is null
       or p_ai_after_hours_start = p_ai_after_hours_end then
      raise exception using
        errcode = '23514',
        message = 'specific_window requires valid distinct start and end times';
    end if;
  else
    raise exception using
      errcode = '23514',
      message = 'ai_after_hours_mode is invalid';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store schedule AI after-hours policy scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'store schedule AI after-hours policy scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store schedule AI after-hours policy scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store schedule AI after-hours policy scope is not authorized';
  end if;

  update public.store_schedule_settings schedule_row
  set
    ai_after_hours_enabled = coalesce(p_ai_after_hours_enabled, false),
    ai_after_hours_mode = v_mode,
    ai_after_hours_start = p_ai_after_hours_start,
    ai_after_hours_end = p_ai_after_hours_end,
    ai_attends_holidays = coalesce(p_ai_attends_holidays, false),
    updated_at = pg_catalog.clock_timestamp()
  where schedule_row.organization_id = p_organization_id
    and schedule_row.store_id = p_store_id
  returning *
  into v_result;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'store_schedule_settings must exist before AI after-hours policy can be written';
  end if;

  return v_result;
end;
$function$;

alter function public.upsert_store_schedule_ai_after_hours_policy_scoped(
  uuid,
  uuid,
  boolean,
  text,
  time without time zone,
  time without time zone,
  boolean
) owner to postgres;

revoke all on function public.upsert_store_schedule_ai_after_hours_policy_scoped(
  uuid,
  uuid,
  boolean,
  text,
  time without time zone,
  time without time zone,
  boolean
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_schedule_ai_after_hours_policy_scoped(
  uuid,
  uuid,
  boolean,
  text,
  time without time zone,
  time without time zone,
  boolean
) to authenticated, service_role;
