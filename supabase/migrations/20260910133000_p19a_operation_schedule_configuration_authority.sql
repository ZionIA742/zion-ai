begin;

-- ============================================================
-- P19-A / Operacao / Pacote 1
-- Canonical authority for:
--   1. Horarios da equipe
--   2. IA fora do horario
--   3. Agenda e capacidade
--
-- Authority remains: public.store_schedule_settings
-- No unsafe backfill.
-- ============================================================

alter table public.store_schedule_settings
  add column if not exists holiday_mode text null,
  add column if not exists holiday_open_time time without time zone null,
  add column if not exists holiday_close_time time without time zone null,
  add column if not exists holiday_notes text null,
  add column if not exists human_schedule_configured_at timestamptz null,
  add column if not exists ai_after_hours_configured_at timestamptz null,
  add column if not exists agenda_capacity_configured_at timestamptz null,
  add column if not exists daily_limit_mode text null,
  add column if not exists daily_limit integer null,
  add column if not exists appointment_buffer_enabled boolean null,
  add column if not exists appointment_buffer_minutes integer null;

comment on column public.store_schedule_settings.holiday_mode is
  'Canonical human holiday policy: closed, normal, special or case_by_case. NULL means not configured in the new authority.';

comment on column public.store_schedule_settings.holiday_open_time is
  'Special holiday opening time. Only applicable when holiday_mode=special.';

comment on column public.store_schedule_settings.holiday_close_time is
  'Special holiday closing time. Only applicable when holiday_mode=special.';

comment on column public.store_schedule_settings.holiday_notes is
  'Human holiday handling notes. Required only when holiday_mode=case_by_case.';

comment on column public.store_schedule_settings.human_schedule_configured_at is
  'Timestamp of the first explicit valid Human Schedule card save. Never inferred from technical defaults.';

comment on column public.store_schedule_settings.ai_after_hours_configured_at is
  'Timestamp of the first explicit valid AI After Hours card save. Never inferred from ai_after_hours_enabled default false.';

comment on column public.store_schedule_settings.agenda_capacity_configured_at is
  'Timestamp of the first explicit valid Agenda Capacity card save. Never inferred from technical defaults.';

comment on column public.store_schedule_settings.daily_limit_mode is
  'Canonical agenda daily limit policy: no_fixed_limit or fixed_limit.';

comment on column public.store_schedule_settings.daily_limit is
  'Maximum appointments per day when daily_limit_mode=fixed_limit.';

comment on column public.store_schedule_settings.appointment_buffer_enabled is
  'Whether a minimum buffer between appointments was explicitly enabled.';

comment on column public.store_schedule_settings.appointment_buffer_minutes is
  'Minimum appointment buffer in minutes when appointment_buffer_enabled=true.';


-- ============================================================
-- Constraints
--
-- NOT VALID intentionally avoids interpreting or rejecting
-- historical rows that predate this authority.
--
-- PostgreSQL still enforces these constraints on new writes and
-- future updates.
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_schedule_settings'::regclass
      and conname = 'store_schedule_settings_holiday_policy_shape_valid'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_holiday_policy_shape_valid
      check (
        (
          holiday_mode is null
          and holiday_open_time is null
          and holiday_close_time is null
          and holiday_notes is null
        )
        or (
          holiday_mode = 'closed'
          and attends_holidays is false
          and holiday_open_time is null
          and holiday_close_time is null
          and holiday_notes is null
        )
        or (
          holiday_mode = 'normal'
          and attends_holidays is true
          and holiday_open_time is null
          and holiday_close_time is null
          and holiday_notes is null
        )
        or (
          holiday_mode = 'special'
          -- Legacy runtime must remain fail-closed until it learns
          -- how to consume holiday_mode + special hours.
          and attends_holidays is false
          and holiday_open_time is not null
          and holiday_close_time is not null
          and holiday_open_time < holiday_close_time
          and holiday_notes is null
        )
        or (
          holiday_mode = 'case_by_case'
          -- No automatic availability in legacy runtime.
          and attends_holidays is false
          and holiday_open_time is null
          and holiday_close_time is null
          and nullif(btrim(holiday_notes), '') is not null
        )
      ) not valid;
  end if;


  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_schedule_settings'::regclass
      and conname = 'store_schedule_settings_human_schedule_configured_shape_valid'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_human_schedule_configured_shape_valid
      check (
        human_schedule_configured_at is null
        or (
          holiday_mode is not null
          and jsonb_typeof(operating_days) = 'array'
          and jsonb_array_length(operating_days) > 0
          and jsonb_typeof(operating_hours) = 'object'
          and nullif(btrim(timezone_name), '') is not null
        )
      ) not valid;
  end if;


  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_schedule_settings'::regclass
      and conname = 'store_schedule_settings_ai_after_hours_configured_shape_valid'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_ai_after_hours_configured_shape_valid
      check (
        ai_after_hours_configured_at is null
        or (
          ai_after_hours_enabled is false
          and ai_after_hours_mode is null
          and ai_after_hours_start is null
          and ai_after_hours_end is null
          and ai_attends_holidays is false
        )
        or (
          ai_after_hours_enabled is true
          and ai_after_hours_mode = 'all_closed_hours'
          and ai_after_hours_start is null
          and ai_after_hours_end is null
        )
        or (
          ai_after_hours_enabled is true
          and ai_after_hours_mode = 'specific_window'
          and ai_after_hours_start is not null
          and ai_after_hours_end is not null
          and ai_after_hours_start <> ai_after_hours_end
        )
      ) not valid;
  end if;


  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_schedule_settings'::regclass
      and conname = 'store_schedule_settings_agenda_capacity_configured_shape_valid'
  ) then
    alter table public.store_schedule_settings
      add constraint store_schedule_settings_agenda_capacity_configured_shape_valid
      check (
        (
          agenda_capacity_configured_at is null
          and daily_limit_mode is null
          and daily_limit is null
          and appointment_buffer_enabled is null
          and appointment_buffer_minutes is null
        )
        or (
          agenda_capacity_configured_at is not null
          and (
            (
              allow_multiple_appointments_per_day is false
              and daily_limit_mode = 'fixed_limit'
              and daily_limit = 1
              and allow_same_time_appointments is false
              and same_time_capacity = 1
              and appointment_buffer_enabled is false
              and appointment_buffer_minutes is null
            )
            or (
              allow_multiple_appointments_per_day is true
              and daily_limit_mode in ('no_fixed_limit', 'fixed_limit')
              and (
                (
                  daily_limit_mode = 'no_fixed_limit'
                  and daily_limit is null
                )
                or (
                  daily_limit_mode = 'fixed_limit'
                  and daily_limit >= 2
                )
              )
              and (
                (
                  allow_same_time_appointments is false
                  and same_time_capacity = 1
                )
                or (
                  allow_same_time_appointments is true
                  and same_time_capacity >= 2
                )
              )
              and (
                (
                  appointment_buffer_enabled is false
                  and appointment_buffer_minutes is null
                )
                or (
                  appointment_buffer_enabled is true
                  and appointment_buffer_minutes > 0
                )
              )
            )
          )
        )
      ) not valid;
  end if;
end
$$;


-- ============================================================
-- Shared internal scope guard.
--
-- Exact approved semantics:
-- authenticated -> auth.uid + active membership
-- postgres      -> allowed
-- every other JWT role -> denied
-- store must belong to organization
-- ============================================================

create or replace function public.store_schedule_assert_card_writer_scope_internal(
  p_organization_id uuid,
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_request_role text;
  v_user_id uuid;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'ORGANIZATION_ID_AND_STORE_ID_REQUIRED';
  end if;

  v_request_role := public.zion_resolve_request_role_internal();

  if v_request_role = 'authenticated' then
    v_user_id := auth.uid();

    if v_user_id is null then
      raise exception using
        errcode = '42501',
        message = 'AUTHENTICATION_REQUIRED';
    end if;

    if not exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = v_user_id
        and membership_row.is_active is true
    ) then
      raise exception using
        errcode = '42501',
        message = 'STORE_SCHEDULE_WRITER_NOT_AUTHORIZED';
    end if;

  elsif v_request_role = 'postgres' then
    null;

  else
    raise exception using
      errcode = '42501',
      message = 'STORE_SCHEDULE_WRITER_ROLE_NOT_AUTHORIZED';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'STORE_SCOPE_MISMATCH';
  end if;
end;
$$;


-- ============================================================
-- Internal day normalization for explicit Human Schedule writes.
-- Uses existing store_schedule_normalize_day(text).
-- ============================================================

create or replace function public.store_schedule_normalize_operating_days_internal(
  p_operating_days jsonb
)
returns text[]
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_raw_day text;
  v_day text;
  v_days text[] := array[]::text[];
begin
  if p_operating_days is null
     or jsonb_typeof(p_operating_days) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'OPERATING_DAYS_MUST_BE_ARRAY';
  end if;

  for v_raw_day in
    select jsonb_array_elements_text(p_operating_days)
  loop
    v_day := public.store_schedule_normalize_day(v_raw_day);

    if v_day is null then
      raise exception using
        errcode = '22023',
        message = 'INVALID_OPERATING_DAY';
    end if;

    if v_day = any(v_days) then
      raise exception using
        errcode = '22023',
        message = 'DUPLICATE_OPERATING_DAY';
    end if;

    v_days := array_append(v_days, v_day);
  end loop;

  if coalesce(array_length(v_days, 1), 0) = 0 then
    raise exception using
      errcode = '22023',
      message = 'OPERATING_DAYS_EMPTY';
  end if;

  return v_days;
end;
$$;


-- ============================================================
-- Internal validation/canonicalization of operating_hours.
-- Only canonical selected days survive.
-- ============================================================

create or replace function public.store_schedule_validate_operating_hours_internal(
  p_operating_hours jsonb,
  p_operating_days text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_day text;
  v_start_text text;
  v_end_text text;
  v_start time without time zone;
  v_end time without time zone;
  v_result jsonb := '{}'::jsonb;
begin
  if p_operating_hours is null
     or jsonb_typeof(p_operating_hours) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'OPERATING_HOURS_MUST_BE_OBJECT';
  end if;

  foreach v_day in array p_operating_days
  loop
    if jsonb_typeof(p_operating_hours -> v_day) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'OPERATING_HOURS_DAY_MISSING';
    end if;

    v_start_text :=
      nullif(btrim(p_operating_hours -> v_day ->> 'start'), '');

    v_end_text :=
      nullif(btrim(p_operating_hours -> v_day ->> 'end'), '');

    if v_start_text is null or v_end_text is null then
      raise exception using
        errcode = '22023',
        message = 'OPERATING_HOURS_START_END_REQUIRED';
    end if;

    begin
      v_start := v_start_text::time without time zone;
      v_end := v_end_text::time without time zone;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'OPERATING_HOURS_TIME_INVALID';
    end;

    if v_start >= v_end then
      raise exception using
        errcode = '22023',
        message = 'OPERATING_HOURS_START_MUST_BE_BEFORE_END';
    end if;

    v_result :=
      v_result ||
      jsonb_build_object(
        v_day,
        jsonb_build_object(
          'start', to_char(v_start, 'HH24:MI'),
          'end', to_char(v_end, 'HH24:MI')
        )
      );
  end loop;

  return v_result;
end;
$$;


-- ============================================================
-- Writer 1: Horarios da equipe
--
-- This is the ONLY new card writer allowed to bootstrap the
-- store_schedule_settings row.
--
-- It must not mark Agenda or AI After Hours as configured.
-- It must not enable enforce_operating_window automatically.
-- ============================================================

create or replace function public.upsert_store_human_schedule_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_operating_days jsonb,
  p_operating_hours jsonb,
  p_timezone_name text,
  p_holiday_mode text,
  p_holiday_open_time time without time zone default null,
  p_holiday_close_time time without time zone default null,
  p_holiday_notes text default null
)
returns public.store_schedule_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_days text[];
  v_hours jsonb;
  v_holiday_mode text;
  v_holiday_notes text;
  v_attends_holidays boolean;
  v_result public.store_schedule_settings%rowtype;
begin
  perform public.store_schedule_assert_card_writer_scope_internal(
    p_organization_id,
    p_store_id
  );

  if nullif(btrim(coalesce(p_timezone_name, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'TIMEZONE_NAME_REQUIRED';
  end if;

  if not exists (
    select 1
    from pg_timezone_names
    where name = p_timezone_name
  ) then
    raise exception using
      errcode = '22023',
      message = 'TIMEZONE_NAME_INVALID';
  end if;

  v_days :=
    public.store_schedule_normalize_operating_days_internal(
      p_operating_days
    );

  v_hours :=
    public.store_schedule_validate_operating_hours_internal(
      p_operating_hours,
      v_days
    );

  v_holiday_mode :=
    lower(nullif(btrim(coalesce(p_holiday_mode, '')), ''));

  v_holiday_notes :=
    nullif(btrim(coalesce(p_holiday_notes, '')), '');

  if v_holiday_mode not in (
    'closed',
    'normal',
    'special',
    'case_by_case'
  ) then
    raise exception using
      errcode = '22023',
      message = 'HOLIDAY_MODE_INVALID';
  end if;

  if v_holiday_mode = 'closed' then
    v_attends_holidays := false;
    p_holiday_open_time := null;
    p_holiday_close_time := null;
    v_holiday_notes := null;

  elsif v_holiday_mode = 'normal' then
    v_attends_holidays := true;
    p_holiday_open_time := null;
    p_holiday_close_time := null;
    v_holiday_notes := null;

  elsif v_holiday_mode = 'special' then
    if p_holiday_open_time is null
       or p_holiday_close_time is null
       or p_holiday_open_time >= p_holiday_close_time then
      raise exception using
        errcode = '22023',
        message = 'HOLIDAY_SPECIAL_TIMES_INVALID';
    end if;

    -- IMPORTANT:
    -- Keep the old coarse boolean fail-closed until runtime
    -- consumes holiday_mode + special times canonically.
    v_attends_holidays := false;
    v_holiday_notes := null;

  else
    if v_holiday_notes is null then
      raise exception using
        errcode = '22023',
        message = 'HOLIDAY_CASE_BY_CASE_NOTES_REQUIRED';
    end if;

    -- No automatic availability for case-by-case.
    v_attends_holidays := false;
    p_holiday_open_time := null;
    p_holiday_close_time := null;
  end if;

  insert into public.store_schedule_settings (
    organization_id,
    store_id,

    allow_multiple_appointments_per_day,
    allow_same_time_appointments,
    same_time_capacity,

    attends_holidays,
    operating_days,
    operating_hours,

    installation_days,
    technical_visit_days,

    after_hours_behavior,
    notes,
    enforce_operating_window,
    timezone_name,

    ai_after_hours_enabled,
    ai_after_hours_mode,
    ai_after_hours_start,
    ai_after_hours_end,
    ai_attends_holidays,

    holiday_mode,
    holiday_open_time,
    holiday_close_time,
    holiday_notes,

    human_schedule_configured_at,
    ai_after_hours_configured_at,
    agenda_capacity_configured_at,

    daily_limit_mode,
    daily_limit,
    appointment_buffer_enabled,
    appointment_buffer_minutes,

    updated_at
  )
  values (
    p_organization_id,
    p_store_id,

    -- Technical bootstrap values only.
    -- They are NOT proof that Agenda was configured.
    false,
    false,
    1,

    v_attends_holidays,
    to_jsonb(v_days),
    v_hours,

    '[]'::jsonb,
    null,

    null,
    null,

    -- Do not activate an independent legacy policy merely because
    -- the customer configured their human opening hours.
    false,

    p_timezone_name,

    -- Technical disabled state. Not a human answer while
    -- ai_after_hours_configured_at remains NULL.
    false,
    null,
    null,
    null,
    false,

    v_holiday_mode,
    p_holiday_open_time,
    p_holiday_close_time,
    v_holiday_notes,

    clock_timestamp(),
    null,
    null,

    null,
    null,
    null,
    null,

    clock_timestamp()
  )
  on conflict (organization_id, store_id)
  do update set
    attends_holidays = excluded.attends_holidays,
    operating_days = excluded.operating_days,
    operating_hours = excluded.operating_hours,
    timezone_name = excluded.timezone_name,

    holiday_mode = excluded.holiday_mode,
    holiday_open_time = excluded.holiday_open_time,
    holiday_close_time = excluded.holiday_close_time,
    holiday_notes = excluded.holiday_notes,

    human_schedule_configured_at = coalesce(
      public.store_schedule_settings.human_schedule_configured_at,
      excluded.human_schedule_configured_at
    ),

    -- Deliberately preserve:
    -- agenda fields
    -- AI-after-hours fields
    -- installation/visit days
    -- after_hours_behavior
    -- notes
    -- enforce_operating_window
    updated_at = clock_timestamp()

  returning *
  into v_result;

  return v_result;
end;
$$;


-- ============================================================
-- Writer 2: IA fora do horario
--
-- Same installed function identity and same defaults preserved.
-- Existing ACL is deliberately NOT revoked/regranted here.
-- Existing function already rejected service_role in its body;
-- this replacement preserves that authorization semantics through
-- the shared scope helper.
-- ============================================================

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
as $$
declare
  v_mode text;
  v_ai_attends_holidays boolean;
  v_result public.store_schedule_settings%rowtype;
begin
  perform public.store_schedule_assert_card_writer_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_ai_after_hours_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'AI_AFTER_HOURS_ENABLED_REQUIRED';
  end if;

  v_mode :=
    lower(nullif(btrim(coalesce(p_ai_after_hours_mode, '')), ''));

  if p_ai_after_hours_enabled is false then
    v_mode := null;
    p_ai_after_hours_start := null;
    p_ai_after_hours_end := null;
    v_ai_attends_holidays := false;

  elsif v_mode = 'all_closed_hours' then
    p_ai_after_hours_start := null;
    p_ai_after_hours_end := null;
    v_ai_attends_holidays :=
      coalesce(p_ai_attends_holidays, false);

  elsif v_mode = 'specific_window' then
    if p_ai_after_hours_start is null
       or p_ai_after_hours_end is null
       or p_ai_after_hours_start = p_ai_after_hours_end then
      raise exception using
        errcode = '22023',
        message = 'AI_AFTER_HOURS_SPECIFIC_WINDOW_INVALID';
    end if;

    v_ai_attends_holidays :=
      coalesce(p_ai_attends_holidays, false);

  else
    raise exception using
      errcode = '22023',
      message = 'AI_AFTER_HOURS_MODE_INVALID';
  end if;

  update public.store_schedule_settings schedule_row
  set
    ai_after_hours_enabled = p_ai_after_hours_enabled,
    ai_after_hours_mode = v_mode,
    ai_after_hours_start = p_ai_after_hours_start,
    ai_after_hours_end = p_ai_after_hours_end,
    ai_attends_holidays = v_ai_attends_holidays,

    ai_after_hours_configured_at = coalesce(
      schedule_row.ai_after_hours_configured_at,
      clock_timestamp()
    ),

    updated_at = clock_timestamp()

  where schedule_row.organization_id = p_organization_id
    and schedule_row.store_id = p_store_id

  returning *
  into v_result;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'STORE_SCHEDULE_SETTINGS_REQUIRED_FOR_AI_AFTER_HOURS';
  end if;

  return v_result;
end;
$$;


-- ============================================================
-- Writer 3: Agenda e capacidade
--
-- Required human-choice booleans intentionally have NO defaults.
-- NULL is not interpreted as "No" when the question is applicable.
-- ============================================================

create or replace function public.upsert_store_agenda_capacity_configuration_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_allow_multiple_appointments_per_day boolean,
  p_allow_same_time_appointments boolean,
  p_appointment_buffer_enabled boolean,
  p_daily_limit_mode text default null,
  p_daily_limit integer default null,
  p_same_time_capacity integer default null,
  p_appointment_buffer_minutes integer default null
)
returns public.store_schedule_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_daily_limit_mode text;
  v_result public.store_schedule_settings%rowtype;
begin
  perform public.store_schedule_assert_card_writer_scope_internal(
    p_organization_id,
    p_store_id
  );

  if p_allow_multiple_appointments_per_day is null then
    raise exception using
      errcode = '22023',
      message = 'ALLOW_MULTIPLE_APPOINTMENTS_REQUIRED';
  end if;

  if p_allow_multiple_appointments_per_day is false then
    -- Single-appointment mode is complete by itself.
    -- Dependent fields are canonicalized, not interpreted as
    -- separate human answers.
    v_daily_limit_mode := 'fixed_limit';
    p_daily_limit := 1;
    p_allow_same_time_appointments := false;
    p_same_time_capacity := 1;
    p_appointment_buffer_enabled := false;
    p_appointment_buffer_minutes := null;

  else
    if p_allow_same_time_appointments is null then
      raise exception using
        errcode = '22023',
        message = 'ALLOW_SAME_TIME_APPOINTMENTS_REQUIRED';
    end if;

    if p_appointment_buffer_enabled is null then
      raise exception using
        errcode = '22023',
        message = 'APPOINTMENT_BUFFER_ENABLED_REQUIRED';
    end if;

    v_daily_limit_mode :=
      lower(nullif(btrim(coalesce(p_daily_limit_mode, '')), ''));

    if v_daily_limit_mode not in (
      'no_fixed_limit',
      'fixed_limit'
    ) then
      raise exception using
        errcode = '22023',
        message = 'DAILY_LIMIT_MODE_INVALID';
    end if;

    if v_daily_limit_mode = 'no_fixed_limit' then
      p_daily_limit := null;

    elsif p_daily_limit is null or p_daily_limit < 2 then
      raise exception using
        errcode = '22023',
        message = 'DAILY_LIMIT_FIXED_REQUIRES_AT_LEAST_TWO';
    end if;

    if p_allow_same_time_appointments is false then
      p_same_time_capacity := 1;

    elsif p_same_time_capacity is null
       or p_same_time_capacity < 2 then
      raise exception using
        errcode = '22023',
        message = 'SAME_TIME_CAPACITY_REQUIRES_AT_LEAST_TWO';
    end if;

    if p_appointment_buffer_enabled is false then
      p_appointment_buffer_minutes := null;

    elsif p_appointment_buffer_minutes is null
       or p_appointment_buffer_minutes <= 0 then
      raise exception using
        errcode = '22023',
        message = 'APPOINTMENT_BUFFER_MINUTES_REQUIRED';
    end if;
  end if;

  update public.store_schedule_settings schedule_row
  set
    allow_multiple_appointments_per_day =
      p_allow_multiple_appointments_per_day,

    allow_same_time_appointments =
      p_allow_same_time_appointments,

    same_time_capacity =
      p_same_time_capacity,

    daily_limit_mode =
      v_daily_limit_mode,

    daily_limit =
      p_daily_limit,

    appointment_buffer_enabled =
      p_appointment_buffer_enabled,

    appointment_buffer_minutes =
      p_appointment_buffer_minutes,

    agenda_capacity_configured_at = coalesce(
      schedule_row.agenda_capacity_configured_at,
      clock_timestamp()
    ),

    updated_at = clock_timestamp()

  where schedule_row.organization_id = p_organization_id
    and schedule_row.store_id = p_store_id

  returning *
  into v_result;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'STORE_SCHEDULE_SETTINGS_REQUIRED_FOR_AGENDA_CAPACITY';
  end if;

  return v_result;
end;
$$;


-- ============================================================
-- Ownership / ACL for NEW internal functions and NEW card writers.
--
-- Do NOT alter ACL of the pre-existing after-hours function here.
-- ============================================================

alter function public.store_schedule_assert_card_writer_scope_internal(
  uuid,
  uuid
) owner to postgres;

alter function public.store_schedule_normalize_operating_days_internal(
  jsonb
) owner to postgres;

alter function public.store_schedule_validate_operating_hours_internal(
  jsonb,
  text[]
) owner to postgres;

alter function public.upsert_store_human_schedule_configuration_scoped(
  uuid,
  uuid,
  jsonb,
  jsonb,
  text,
  text,
  time without time zone,
  time without time zone,
  text
) owner to postgres;

alter function public.upsert_store_agenda_capacity_configuration_scoped(
  uuid,
  uuid,
  boolean,
  boolean,
  boolean,
  text,
  integer,
  integer,
  integer
) owner to postgres;


revoke all on function
  public.store_schedule_assert_card_writer_scope_internal(
    uuid,
    uuid
  )
from public, anon, authenticated, service_role;

revoke all on function
  public.store_schedule_normalize_operating_days_internal(
    jsonb
  )
from public, anon, authenticated, service_role;

revoke all on function
  public.store_schedule_validate_operating_hours_internal(
    jsonb,
    text[]
  )
from public, anon, authenticated, service_role;


revoke all on function
  public.upsert_store_human_schedule_configuration_scoped(
    uuid,
    uuid,
    jsonb,
    jsonb,
    text,
    text,
    time without time zone,
    time without time zone,
    text
  )
from public, anon, authenticated, service_role;

grant execute on function
  public.upsert_store_human_schedule_configuration_scoped(
    uuid,
    uuid,
    jsonb,
    jsonb,
    text,
    text,
    time without time zone,
    time without time zone,
    text
  )
to authenticated;


revoke all on function
  public.upsert_store_agenda_capacity_configuration_scoped(
    uuid,
    uuid,
    boolean,
    boolean,
    boolean,
    text,
    integer,
    integer,
    integer
  )
from public, anon, authenticated, service_role;

grant execute on function
  public.upsert_store_agenda_capacity_configuration_scoped(
    uuid,
    uuid,
    boolean,
    boolean,
    boolean,
    text,
    integer,
    integer,
    integer
  )
to authenticated;


comment on function
  public.upsert_store_human_schedule_configuration_scoped(
    uuid,
    uuid,
    jsonb,
    jsonb,
    text,
    text,
    time without time zone,
    time without time zone,
    text
  )
is
  'P19-A canonical writer for explicit Human Schedule configuration. May bootstrap store_schedule_settings without marking Agenda or AI After Hours as configured.';


comment on function
  public.upsert_store_schedule_ai_after_hours_policy_scoped(
    uuid,
    uuid,
    boolean,
    text,
    time without time zone,
    time without time zone,
    boolean
  )
is
  'P19-A canonical AI After Hours writer. Existing signature/defaults preserved; explicit save records first configured_at and requires existing schedule row.';


comment on function
  public.upsert_store_agenda_capacity_configuration_scoped(
    uuid,
    uuid,
    boolean,
    boolean,
    boolean,
    text,
    integer,
    integer,
    integer
  )
is
  'P19-A canonical Agenda Capacity writer. Requires an existing store_schedule_settings row and explicit human choices for applicable boolean policies.';


commit;
