begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.1:commercial-opportunity-followup-plan-contract:v1',
    0
  )
);

do $preflight$
declare
  v_function_signature text;
  v_column_name text;
begin
  if pg_catalog.to_regclass('public.commercial_opportunity_followups') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_followup_events') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.memberships') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial opportunity followup foundation is missing';
  end if;

  foreach v_function_signature in array array[
    'public.normalize_commercial_opportunity_followup_context(jsonb)',
    'public.normalize_commercial_opportunity_followup_cadence(integer)',
    'public.normalize_commercial_opportunity_followup_next_action(text)',
    'public.validate_commercial_opportunity_followup_next_action_at(timestamp with time zone,timestamp with time zone)',
    'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_function_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = format('commercial opportunity followup 5.1 collision detected: %s', v_function_signature);
    end if;
  end loop;

  foreach v_column_name in array array[
    'reason_code',
    'reason_details',
    'context',
    'cadence_interval_minutes',
    'next_action',
    'next_action_at'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid = 'public.commercial_opportunity_followups'::pg_catalog.regclass
        and attribute_row.attname = v_column_name
        and not attribute_row.attisdropped
    ) then
      raise exception using
        errcode = 'P0001',
        message = format('commercial opportunity followup 5.1 column collision detected: %s', v_column_name);
    end if;
  end loop;
end;
$preflight$;

alter table public.commercial_opportunity_followups
  add column reason_code text null,
  add column reason_details text null,
  add column context jsonb not null default '{}'::jsonb,
  add column cadence_interval_minutes integer null,
  add column next_action text null,
  add column next_action_at timestamptz null;

alter table public.commercial_opportunity_followups
  add constraint commercial_opportunity_followups_reason_code_check
    check (
      reason_code is null
      or (
        pg_catalog.length(pg_catalog.btrim(reason_code)) > 0
        and reason_code = pg_catalog.btrim(reason_code)
        and pg_catalog.length(reason_code) <= 100
      )
    ),
  add constraint commercial_opportunity_followups_reason_details_check
    check (
      reason_details is null
      or (
        pg_catalog.length(pg_catalog.btrim(reason_details)) > 0
        and reason_details = pg_catalog.btrim(reason_details)
        and pg_catalog.length(reason_details) <= 2000
      )
    ),
  add constraint commercial_opportunity_followups_context_object_check
    check (pg_catalog.jsonb_typeof(context) = 'object'),
  add constraint commercial_opportunity_followups_cadence_positive_check
    check (
      cadence_interval_minutes is null
      or cadence_interval_minutes > 0
    ),
  add constraint commercial_opportunity_followups_next_action_check
    check (
      next_action is null
      or (
        pg_catalog.length(pg_catalog.btrim(next_action)) > 0
        and next_action = pg_catalog.btrim(next_action)
        and pg_catalog.length(next_action) <= 200
      )
    ),
  add constraint commercial_opportunity_followups_next_action_shape_check
    check (
      (
        cadence_interval_minutes is null
        and next_action is null
        and next_action_at is null
      )
      or (
        cadence_interval_minutes is not null
        and next_action is not null
        and next_action_at is not null
      )
    ),
  add constraint commercial_opportunity_followups_next_action_after_start_check
    check (
      next_action_at is null
      or next_action_at > started_at
    );

create function public.normalize_commercial_opportunity_followup_context(
  p_context jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if p_context is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_CONTEXT_REQUIRED';
  end if;

  if pg_catalog.jsonb_typeof(p_context) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_CONTEXT_REQUIRES_OBJECT';
  end if;

  return p_context;
end;
$function$;

alter function public.normalize_commercial_opportunity_followup_context(jsonb)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_followup_context(jsonb)
  from public, anon, authenticated, service_role;

create function public.normalize_commercial_opportunity_followup_cadence(
  p_cadence_interval_minutes integer
)
returns integer
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if p_cadence_interval_minutes is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_CADENCE_REQUIRED';
  end if;

  if p_cadence_interval_minutes <= 0 then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_CADENCE_REQUIRES_POSITIVE_INTERVAL';
  end if;

  return p_cadence_interval_minutes;
end;
$function$;

alter function public.normalize_commercial_opportunity_followup_cadence(integer)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_followup_cadence(integer)
  from public, anon, authenticated, service_role;

create function public.normalize_commercial_opportunity_followup_next_action(
  p_next_action text
)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_next_action text := nullif(pg_catalog.btrim(coalesce(p_next_action, '')), '');
begin
  if v_next_action is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_NEXT_ACTION_REQUIRED';
  end if;

  if pg_catalog.length(v_next_action) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_NEXT_ACTION_TOO_LONG';
  end if;

  return v_next_action;
end;
$function$;

alter function public.normalize_commercial_opportunity_followup_next_action(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_followup_next_action(text)
  from public, anon, authenticated, service_role;

create function public.validate_commercial_opportunity_followup_next_action_at(
  p_next_action_at timestamptz,
  p_started_at timestamptz
)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if p_next_action_at is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_NEXT_ACTION_AT_REQUIRED';
  end if;

  if p_started_at is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_STARTED_AT_REQUIRED';
  end if;

  if p_next_action_at <= p_started_at then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_NEXT_ACTION_AT_REQUIRES_AFTER_START';
  end if;

  return p_next_action_at;
end;
$function$;

alter function public.validate_commercial_opportunity_followup_next_action_at(timestamptz, timestamptz)
  owner to postgres;

revoke all on function public.validate_commercial_opportunity_followup_next_action_at(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create function public.activate_commercial_opportunity_followup_plan_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_reason_code text,
  p_reason_details text,
  p_context jsonb,
  p_cadence_interval_minutes integer,
  p_next_action text,
  p_next_action_at timestamptz
)
returns public.commercial_opportunity_followups
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_operation_key text;
  v_reason_code text;
  v_reason_details text;
  v_context jsonb;
  v_cadence_interval_minutes integer;
  v_next_action text;
  v_started_at timestamptz;
  v_next_action_at timestamptz;
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
  v_existing_active public.commercial_opportunity_followups;
  v_replay_followup public.commercial_opportunity_followups;
  v_last_cycle integer;
  v_followup public.commercial_opportunity_followups;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity followup by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity followup plan requires organization, store and opportunity';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity followup by user is not authorized';
  end if;

  v_operation_key := public.normalize_commercial_opportunity_followup_operation_key(
    p_operation_key
  );
  v_reason_code := public.normalize_commercial_opportunity_followup_reason_code(
    p_reason_code
  );
  if v_reason_code is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_REASON_CODE_REQUIRED';
  end if;
  v_reason_details := public.normalize_commercial_opportunity_followup_reason_details(
    p_reason_details
  );
  v_context := public.normalize_commercial_opportunity_followup_context(p_context);
  v_cadence_interval_minutes := public.normalize_commercial_opportunity_followup_cadence(
    p_cadence_interval_minutes
  );
  v_next_action := public.normalize_commercial_opportunity_followup_next_action(
    p_next_action
  );
  v_started_at := pg_catalog.clock_timestamp();

  v_next_action_at := public.validate_commercial_opportunity_followup_next_action_at(
    p_next_action_at,
    v_started_at
  );

  v_opportunity := public.lock_commercial_opportunity_followup_target(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  );

  v_existing_event := public.find_commercial_opportunity_followup_event_by_operation_key(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_operation_key
  );

  if v_existing_event.id is not null then
    v_replay_followup := public.restore_commercial_opportunity_followup_snapshot(v_existing_event);

    if v_existing_event.event_type <> 'activated'
       or v_existing_event.actor_type <> 'human'
       or v_existing_event.actor_user_id is distinct from v_user_id
       or v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.reason_details is distinct from v_reason_details
       or v_replay_followup.reason_code is distinct from v_reason_code
       or v_replay_followup.reason_details is distinct from v_reason_details
       or v_replay_followup.context is distinct from v_context
       or v_replay_followup.cadence_interval_minutes is distinct from v_cadence_interval_minutes
       or v_replay_followup.next_action is distinct from v_next_action
       or v_replay_followup.next_action_at is distinct from v_next_action_at then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return v_replay_followup;
  end if;

  v_opportunity := public.validate_commercial_opportunity_followup_integrity(v_opportunity);

  if exists (
    select 1
    from public.commercial_opportunity_followups followup_row
    where followup_row.organization_id = p_request_organization_id
      and followup_row.store_id = p_store_id
      and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
      and followup_row.status = 'opted_out'
  ) then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_OPT_OUT_LOCKED';
  end if;

  select followup_row.*
  into v_existing_active
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_request_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if found then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_ALREADY_ACTIVE';
  end if;

  select followup_row.cycle
  into v_last_cycle
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = v_opportunity.organization_id
    and followup_row.store_id = v_opportunity.store_id
    and followup_row.commercial_opportunity_id = v_opportunity.id
  order by followup_row.cycle desc
  limit 1;

  insert into public.commercial_opportunity_followups (
    organization_id,
    store_id,
    commercial_opportunity_id,
    cycle,
    status,
    started_at,
    attempt_count,
    reason_code,
    reason_details,
    context,
    cadence_interval_minutes,
    next_action,
    next_action_at
  )
  values (
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    coalesce(v_last_cycle, 0) + 1,
    'active',
    v_started_at,
    0,
    v_reason_code,
    v_reason_details,
    v_context,
    v_cadence_interval_minutes,
    v_next_action,
    v_next_action_at
  )
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'activated',
    v_operation_key,
    'human',
    v_user_id,
    v_reason_code,
    v_reason_details
  );

  return v_followup;
end;
$function$;

alter function public.activate_commercial_opportunity_followup_plan_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  text,
  timestamptz
)
  owner to postgres;

revoke all on function public.activate_commercial_opportunity_followup_plan_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  text,
  timestamptz
)
  from public, anon, authenticated, service_role;

grant execute on function public.activate_commercial_opportunity_followup_plan_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  text,
  timestamptz
)
  to authenticated;

comment on function public.activate_commercial_opportunity_followup_plan_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  text,
  timestamptz
) is
  'Ativa plano canonico completo de follow-up por oportunidade, com motivo, contexto, cadencia e proxima acao explicitos.';

do $postconditions$
declare
  v_column_count integer;
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'
  );
  v_prosrc text;
begin
  select count(*)
  into v_column_count
  from pg_catalog.pg_attribute attribute_row
  where attribute_row.attrelid = 'public.commercial_opportunity_followups'::pg_catalog.regclass
    and attribute_row.attname in (
      'reason_code',
      'reason_details',
      'context',
      'cadence_interval_minutes',
      'next_action',
      'next_action_at'
    )
    and not attribute_row.attisdropped;

  if v_column_count <> 6 or v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup 5.1 contract was not installed';
  end if;

  select proc_row.prosrc
  into v_prosrc
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_function_oid;

  if v_prosrc like '%panel_list_followup_candidates_scoped%'
     or v_prosrc like '%panel_enqueue_followup_scoped%'
     or v_prosrc like '%follow_up_exhausted%'
     or v_prosrc like '%opt_out%'
     or v_prosrc like '%priority%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup 5.1 writer references out-of-scope behavior';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup 5.1 writer grants mismatch';
  end if;
end;
$postconditions$;

commit;
