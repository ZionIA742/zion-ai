begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b2:e2.1-c1:commercial-opportunity-followup-foundation:v2',
    0
  )
);

do $preflight$
declare
  v_function_signature text;
  v_trigger_name text;
begin
  if pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_session_context_links') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity followup prerequisites are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'authenticated'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'service_role'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity followup required roles are missing';
  end if;

  foreach v_function_signature in array array[
    'public.normalize_commercial_opportunity_followup_operation_key(text)',
    'public.normalize_commercial_opportunity_followup_reason_code(text)',
    'public.normalize_commercial_opportunity_followup_reason_details(text)',
    'public.touch_commercial_opportunity_followup_updated_at()',
    'public.prevent_commercial_opportunity_followup_event_mutation()',
    'public.build_commercial_opportunity_followup_snapshot(public.commercial_opportunity_followups)',
    'public.restore_commercial_opportunity_followup_snapshot(public.commercial_opportunity_followup_events)',
    'public.lock_commercial_opportunity_followup_target(uuid,uuid,uuid)',
    'public.validate_commercial_opportunity_followup_integrity(public.commercial_opportunities)',
    'public.find_commercial_opportunity_followup_event_by_operation_key(uuid,uuid,uuid,text)',
    'public.insert_commercial_opportunity_followup_event(public.commercial_opportunity_followups,text,text,text,uuid,text,text)',
    'public.activate_commercial_opportunity_followup_by_user(uuid,uuid,uuid,text)',
    'public.record_commercial_opportunity_followup_attempt_by_user(uuid,uuid,uuid,text)',
    'public.resolve_commercial_opportunity_followup_by_user(uuid,uuid,uuid,text)',
    'public.cancel_commercial_opportunity_followup_by_user(uuid,uuid,uuid,text,text,text)',
    'public.exhaust_commercial_opportunity_followup_by_system(uuid,uuid,uuid,text)',
    'public.opt_out_commercial_opportunity_followup_by_user(uuid,uuid,uuid,text,text,text)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_function_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = format('commercial opportunity followup collision detected: %s', v_function_signature);
    end if;
  end loop;

  foreach v_trigger_name in array array[
    'commercial_opportunity_followups_touch_updated_at',
    'commercial_opportunity_followup_events_append_only'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgname = v_trigger_name
        and not trigger_row.tgisinternal
    ) then
      raise exception using
        errcode = 'P0001',
        message = format('commercial opportunity followup collision detected: trigger %s', v_trigger_name);
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.stores'::pg_catalog.regclass
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and index_row.indpred is null
      and index_row.indnkeyatts = 2
      and index_row.indkey[0] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.stores'::pg_catalog.regclass
          and attribute_row.attname = 'id'
          and not attribute_row.attisdropped
      )
      and index_row.indkey[1] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.stores'::pg_catalog.regclass
          and attribute_row.attname = 'organization_id'
          and not attribute_row.attisdropped
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.stores(id, organization_id) unique target is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and index_row.indpred is null
      and index_row.indnkeyatts = 3
      and index_row.indkey[0] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
          and attribute_row.attname = 'id'
          and not attribute_row.attisdropped
      )
      and index_row.indkey[1] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
          and attribute_row.attname = 'organization_id'
          and not attribute_row.attisdropped
      )
      and index_row.indkey[2] = (
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
          and attribute_row.attname = 'store_id'
          and not attribute_row.attisdropped
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities(id, organization_id, store_id) unique target is missing';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_followups') is not null
     or pg_catalog.to_regclass('public.commercial_opportunity_followup_events') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity followup objects already exist';
  end if;
end;
$preflight$;

create table public.commercial_opportunity_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  cycle integer not null,
  status text not null,
  started_at timestamptz not null default now(),
  resolved_at timestamptz null,
  cancelled_at timestamptz null,
  exhausted_at timestamptz null,
  opted_out_at timestamptz null,
  last_attempt_at timestamptz null,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commercial_opportunity_followups_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint commercial_opportunity_followups_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint commercial_opportunity_followups_opportunity_scope_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint commercial_opportunity_followups_cycle_check
    check (cycle >= 1),

  constraint commercial_opportunity_followups_status_check
    check (
      status in (
        'active',
        'resolved',
        'cancelled',
        'exhausted',
        'opted_out'
      )
    ),

  constraint commercial_opportunity_followups_attempt_count_check
    check (attempt_count >= 0),

  constraint commercial_opportunity_followups_terminal_shape_check
    check (
      (
        status = 'active'
        and resolved_at is null
        and cancelled_at is null
        and exhausted_at is null
        and opted_out_at is null
      )
      or (
        status = 'resolved'
        and resolved_at is not null
        and cancelled_at is null
        and exhausted_at is null
        and opted_out_at is null
      )
      or (
        status = 'cancelled'
        and resolved_at is null
        and cancelled_at is not null
        and exhausted_at is null
        and opted_out_at is null
      )
      or (
        status = 'exhausted'
        and resolved_at is null
        and cancelled_at is null
        and exhausted_at is not null
        and opted_out_at is null
      )
      or (
        status = 'opted_out'
        and resolved_at is null
        and cancelled_at is null
        and exhausted_at is null
        and opted_out_at is not null
      )
    )
);

create unique index commercial_opportunity_followups_id_scope_cycle_uidx
  on public.commercial_opportunity_followups (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    cycle
  );

create unique index commercial_opportunity_followups_opportunity_cycle_uidx
  on public.commercial_opportunity_followups (
    organization_id,
    store_id,
    commercial_opportunity_id,
    cycle
  );

create unique index commercial_opportunity_followups_one_active_per_opportunity_uidx
  on public.commercial_opportunity_followups (
    organization_id,
    store_id,
    commercial_opportunity_id
  )
  where status = 'active';

create index commercial_opportunity_followups_status_cycle_idx
  on public.commercial_opportunity_followups (
    organization_id,
    store_id,
    status,
    commercial_opportunity_id,
    cycle desc
  );

create table public.commercial_opportunity_followup_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  followup_id uuid not null,
  cycle integer not null,
  event_type text not null,
  operation_key text not null,
  actor_type text not null,
  actor_user_id uuid null,
  reason_code text null,
  reason_details text null,
  metadata jsonb not null,
  created_at timestamptz not null default now(),

  constraint commercial_opportunity_followup_events_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint commercial_opportunity_followup_events_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint commercial_opportunity_followup_events_opportunity_scope_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint commercial_opportunity_followup_events_followup_scope_fkey
    foreign key (
      followup_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      cycle
    )
    references public.commercial_opportunity_followups(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      cycle
    )
    on delete restrict,

  constraint commercial_opportunity_followup_events_actor_user_fkey
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint commercial_opportunity_followup_events_cycle_check
    check (cycle >= 1),

  constraint commercial_opportunity_followup_events_event_type_check
    check (
      event_type in (
        'activated',
        'attempt_recorded',
        'resolved',
        'cancelled',
        'exhausted',
        'opted_out'
      )
    ),

  constraint commercial_opportunity_followup_events_actor_type_check
    check (
      actor_type in ('human', 'system')
      and (
        (actor_type = 'human' and actor_user_id is not null)
        or (actor_type = 'system' and actor_user_id is null)
      )
    ),

  constraint commercial_opportunity_followup_events_operation_key_check
    check (
      pg_catalog.length(pg_catalog.btrim(operation_key)) > 0
      and operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) <= 200
    ),

  constraint commercial_opportunity_followup_events_reason_code_check
    check (
      reason_code is null
      or (
        pg_catalog.length(pg_catalog.btrim(reason_code)) > 0
        and reason_code = pg_catalog.btrim(reason_code)
        and pg_catalog.length(reason_code) <= 100
      )
    ),

  constraint commercial_opportunity_followup_events_reason_details_check
    check (
      reason_details is null
      or (
        pg_catalog.length(pg_catalog.btrim(reason_details)) > 0
        and reason_details = pg_catalog.btrim(reason_details)
        and pg_catalog.length(reason_details) <= 2000
      )
    ),

  constraint commercial_opportunity_followup_events_metadata_object_check
    check (
      pg_catalog.jsonb_typeof(metadata) = 'object'
      and metadata ? 'result_snapshot'
      and pg_catalog.jsonb_typeof(metadata -> 'result_snapshot') = 'object'
    )
);

create unique index commercial_opportunity_followup_events_operation_key_uidx
  on public.commercial_opportunity_followup_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    operation_key
  );

create index commercial_opportunity_followup_events_followup_timeline_idx
  on public.commercial_opportunity_followup_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    followup_id,
    created_at desc
  );

create function public.normalize_commercial_opportunity_followup_operation_key(
  p_operation_key text
)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
begin
  if v_operation_key is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_OPERATION_KEY_REQUIRED';
  end if;

  if pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_OPERATION_KEY_TOO_LONG';
  end if;

  return v_operation_key;
end;
$function$;

alter function public.normalize_commercial_opportunity_followup_operation_key(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_followup_operation_key(text)
  from public, anon, authenticated, service_role;

create function public.normalize_commercial_opportunity_followup_reason_code(
  p_reason_code text
)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_reason_code text := nullif(pg_catalog.btrim(coalesce(p_reason_code, '')), '');
begin
  if v_reason_code is not null and pg_catalog.length(v_reason_code) > 100 then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_REASON_CODE_TOO_LONG';
  end if;

  return v_reason_code;
end;
$function$;

alter function public.normalize_commercial_opportunity_followup_reason_code(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_followup_reason_code(text)
  from public, anon, authenticated, service_role;

create function public.normalize_commercial_opportunity_followup_reason_details(
  p_reason_details text
)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
begin
  if v_reason_details is not null and pg_catalog.length(v_reason_details) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_REASON_DETAILS_TOO_LONG';
  end if;

  return v_reason_details;
end;
$function$;

alter function public.normalize_commercial_opportunity_followup_reason_details(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_followup_reason_details(text)
  from public, anon, authenticated, service_role;

create function public.touch_commercial_opportunity_followup_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.touch_commercial_opportunity_followup_updated_at()
  owner to postgres;

revoke all on function public.touch_commercial_opportunity_followup_updated_at()
  from public, anon, authenticated, service_role;

create function public.prevent_commercial_opportunity_followup_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'ZION_FOLLOWUP_EVENTS_APPEND_ONLY';
end;
$function$;

alter function public.prevent_commercial_opportunity_followup_event_mutation()
  owner to postgres;

revoke all on function public.prevent_commercial_opportunity_followup_event_mutation()
  from public, anon, authenticated, service_role;

create function public.build_commercial_opportunity_followup_snapshot(
  p_followup public.commercial_opportunity_followups
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
  select to_jsonb(p_followup);
$function$;

alter function public.build_commercial_opportunity_followup_snapshot(public.commercial_opportunity_followups)
  owner to postgres;

revoke all on function public.build_commercial_opportunity_followup_snapshot(public.commercial_opportunity_followups)
  from public, anon, authenticated, service_role;

create function public.restore_commercial_opportunity_followup_snapshot(
  p_event public.commercial_opportunity_followup_events
)
returns public.commercial_opportunity_followups
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_snapshot jsonb := p_event.metadata -> 'result_snapshot';
  v_followup public.commercial_opportunity_followups;
  v_expected_status text;
begin
  if pg_catalog.jsonb_typeof(v_snapshot) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_MISSING';
  end if;

  select *
  into v_followup
  from pg_catalog.jsonb_populate_record(
    null::public.commercial_opportunity_followups,
    v_snapshot
  );

  if v_followup.id is null
     or v_followup.organization_id is null
     or v_followup.store_id is null
     or v_followup.commercial_opportunity_id is null
     or v_followup.cycle is null
     or v_followup.status is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_INVALID';
  end if;

  if v_followup.id is distinct from p_event.followup_id
     or v_followup.organization_id is distinct from p_event.organization_id
     or v_followup.store_id is distinct from p_event.store_id
     or v_followup.commercial_opportunity_id is distinct from p_event.commercial_opportunity_id
     or v_followup.cycle is distinct from p_event.cycle then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_INVALID';
  end if;

  v_expected_status := case p_event.event_type
    when 'activated' then 'active'
    when 'attempt_recorded' then 'active'
    when 'resolved' then 'resolved'
    when 'cancelled' then 'cancelled'
    when 'exhausted' then 'exhausted'
    when 'opted_out' then 'opted_out'
    else null
  end;

  if v_expected_status is null
     or v_followup.status is distinct from v_expected_status then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_FOLLOWUP_RESULT_SNAPSHOT_INVALID';
  end if;

  return v_followup;
end;
$function$;

alter function public.restore_commercial_opportunity_followup_snapshot(public.commercial_opportunity_followup_events)
  owner to postgres;

revoke all on function public.restore_commercial_opportunity_followup_snapshot(public.commercial_opportunity_followup_events)
  from public, anon, authenticated, service_role;

create function public.lock_commercial_opportunity_followup_target(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns public.commercial_opportunities
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
begin
  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  return v_opportunity;
end;
$function$;

alter function public.lock_commercial_opportunity_followup_target(uuid, uuid, uuid)
  owner to postgres;

revoke all on function public.lock_commercial_opportunity_followup_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.validate_commercial_opportunity_followup_integrity(
  p_opportunity public.commercial_opportunities
)
returns public.commercial_opportunities
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_origin_lead_id uuid;
  v_primary_conversation_id uuid;
begin
  if p_opportunity.id is null
     or p_opportunity.organization_id is null
     or p_opportunity.store_id is null then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if not exists (
    select 1
    from public.customers customer_row
    join public.customer_store_links customer_store_link_row
     on customer_store_link_row.organization_id = customer_row.organization_id
     and customer_store_link_row.customer_id = customer_row.id
     and customer_store_link_row.store_id = p_opportunity.store_id
    where customer_row.id = p_opportunity.customer_id
      and customer_row.organization_id = p_opportunity.organization_id
      and customer_row.merged_into_customer_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'customer_scope_inconsistency';
  end if;

  v_origin_lead_id := p_opportunity.origin_lead_id;

  if v_origin_lead_id is not null
     and not exists (
       select 1
       from public.leads lead_row
       where lead_row.id = v_origin_lead_id
         and lead_row.organization_id = p_opportunity.organization_id
         and lead_row.store_id = p_opportunity.store_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'origin_lead_scope_inconsistency';
  end if;

  v_primary_conversation_id := p_opportunity.primary_conversation_id;

  if v_primary_conversation_id is not null then
    if v_origin_lead_id is null then
      raise exception using
        errcode = '23514',
        message = 'primary_conversation_scope_inconsistency';
    end if;

    if not exists (
      select 1
      from public.conversations conversation_row
      join public.conversation_sessions session_row
        on session_row.conversation_id = conversation_row.id
       and session_row.organization_id = conversation_row.organization_id
       and session_row.store_id = p_opportunity.store_id
       and session_row.status = 'active'
      join public.commercial_session_context_links context_link_row
        on context_link_row.conversation_session_id = session_row.id
       and context_link_row.organization_id = session_row.organization_id
       and context_link_row.store_id = session_row.store_id
       and context_link_row.commercial_opportunity_id = p_opportunity.id
       and context_link_row.customer_id = p_opportunity.customer_id
       and context_link_row.status = 'active'
       and context_link_row.unlinked_at is null
      join public.lead_customer_links lead_link_row
        on lead_link_row.id = context_link_row.lead_customer_link_id
       and lead_link_row.organization_id = p_opportunity.organization_id
       and lead_link_row.store_id = p_opportunity.store_id
       and lead_link_row.customer_id = p_opportunity.customer_id
       and lead_link_row.lead_id = v_origin_lead_id
       and lead_link_row.status = 'active'
       and lead_link_row.unlinked_at is null
      where conversation_row.id = v_primary_conversation_id
        and conversation_row.organization_id = p_opportunity.organization_id
        and conversation_row.lead_id = v_origin_lead_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'primary_conversation_scope_inconsistency';
    end if;
  end if;

  return p_opportunity;
end;
$function$;

alter function public.validate_commercial_opportunity_followup_integrity(public.commercial_opportunities)
  owner to postgres;

revoke all on function public.validate_commercial_opportunity_followup_integrity(public.commercial_opportunities)
  from public, anon, authenticated, service_role;

create function public.find_commercial_opportunity_followup_event_by_operation_key(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text
)
returns public.commercial_opportunity_followup_events
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_operation_key text := public.normalize_commercial_opportunity_followup_operation_key(
    p_operation_key
  );
  v_event public.commercial_opportunity_followup_events;
begin
  select event_row.*
  into v_event
  from public.commercial_opportunity_followup_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.operation_key = v_operation_key
  limit 1;

  return v_event;
end;
$function$;

alter function public.find_commercial_opportunity_followup_event_by_operation_key(uuid, uuid, uuid, text)
  owner to postgres;

revoke all on function public.find_commercial_opportunity_followup_event_by_operation_key(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

create function public.insert_commercial_opportunity_followup_event(
  p_followup public.commercial_opportunity_followups,
  p_event_type text,
  p_operation_key text,
  p_actor_type text,
  p_actor_user_id uuid,
  p_reason_code text,
  p_reason_details text
)
returns public.commercial_opportunity_followup_events
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_event public.commercial_opportunity_followup_events;
begin
  insert into public.commercial_opportunity_followup_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    followup_id,
    cycle,
    event_type,
    operation_key,
    actor_type,
    actor_user_id,
    reason_code,
    reason_details,
    metadata
  )
  values (
    p_followup.organization_id,
    p_followup.store_id,
    p_followup.commercial_opportunity_id,
    p_followup.id,
    p_followup.cycle,
    p_event_type,
    p_operation_key,
    p_actor_type,
    p_actor_user_id,
    p_reason_code,
    p_reason_details,
    jsonb_build_object(
      'result_snapshot',
      public.build_commercial_opportunity_followup_snapshot(p_followup)
    )
  )
  returning *
  into v_event;

  return v_event;
end;
$function$;

alter function public.insert_commercial_opportunity_followup_event(
  public.commercial_opportunity_followups,
  text,
  text,
  text,
  uuid,
  text,
  text
)
  owner to postgres;

revoke all on function public.insert_commercial_opportunity_followup_event(
  public.commercial_opportunity_followups,
  text,
  text,
  text,
  uuid,
  text,
  text
)
  from public, anon, authenticated, service_role;

create trigger commercial_opportunity_followups_touch_updated_at
  before update on public.commercial_opportunity_followups
  for each row
  execute function public.touch_commercial_opportunity_followup_updated_at();

create trigger commercial_opportunity_followup_events_append_only
  before update or delete on public.commercial_opportunity_followup_events
  for each row
  execute function public.prevent_commercial_opportunity_followup_event_mutation();

create function public.activate_commercial_opportunity_followup_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text
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
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
  v_existing_active public.commercial_opportunity_followups;
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
      message = 'commercial opportunity followup activation requires organization, store and opportunity';
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
    if v_existing_event.event_type <> 'activated'
       or v_existing_event.actor_type <> 'human'
       or v_existing_event.actor_user_id is distinct from v_user_id
       or v_existing_event.reason_code is not null
       or v_existing_event.reason_details is not null then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(v_existing_event);
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
    attempt_count
  )
  values (
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    coalesce(v_last_cycle, 0) + 1,
    'active',
    pg_catalog.clock_timestamp(),
    0
  )
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'activated',
    v_operation_key,
    'human',
    v_user_id,
    null,
    null
  );

  return v_followup;
end;
$function$;

alter function public.activate_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text)
  owner to postgres;

create function public.record_commercial_opportunity_followup_attempt_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text
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
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
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
      message = 'commercial opportunity followup attempt requires organization, store and opportunity';
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
    if v_existing_event.event_type <> 'attempt_recorded'
       or v_existing_event.actor_type <> 'human'
       or v_existing_event.actor_user_id is distinct from v_user_id
       or v_existing_event.reason_code is not null
       or v_existing_event.reason_details is not null then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(v_existing_event);
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(v_opportunity);

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_request_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE';
  end if;

  update public.commercial_opportunity_followups followup_row
  set
    attempt_count = followup_row.attempt_count + 1,
    last_attempt_at = pg_catalog.clock_timestamp()
  where followup_row.id = v_followup.id
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'attempt_recorded',
    v_operation_key,
    'human',
    v_user_id,
    null,
    null
  );

  return v_followup;
end;
$function$;

alter function public.record_commercial_opportunity_followup_attempt_by_user(uuid, uuid, uuid, text)
  owner to postgres;

create function public.resolve_commercial_opportunity_followup_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text
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
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
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
      message = 'commercial opportunity followup resolution requires organization, store and opportunity';
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
    if v_existing_event.event_type <> 'resolved'
       or v_existing_event.actor_type <> 'human'
       or v_existing_event.actor_user_id is distinct from v_user_id
       or v_existing_event.reason_code is not null
       or v_existing_event.reason_details is not null then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(v_existing_event);
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(v_opportunity);

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_request_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE';
  end if;

  update public.commercial_opportunity_followups followup_row
  set
    status = 'resolved',
    resolved_at = pg_catalog.clock_timestamp()
  where followup_row.id = v_followup.id
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'resolved',
    v_operation_key,
    'human',
    v_user_id,
    null,
    null
  );

  return v_followup;
end;
$function$;

alter function public.resolve_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text)
  owner to postgres;

create function public.cancel_commercial_opportunity_followup_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_reason_code text default null,
  p_reason_details text default null
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
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
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
      message = 'commercial opportunity followup cancellation requires organization, store and opportunity';
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
  v_reason_details := public.normalize_commercial_opportunity_followup_reason_details(
    p_reason_details
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
    if v_existing_event.event_type <> 'cancelled'
       or v_existing_event.actor_type <> 'human'
       or v_existing_event.actor_user_id is distinct from v_user_id
       or v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.reason_details is distinct from v_reason_details then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(v_existing_event);
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(v_opportunity);

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_request_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE';
  end if;

  update public.commercial_opportunity_followups followup_row
  set
    status = 'cancelled',
    cancelled_at = pg_catalog.clock_timestamp()
  where followup_row.id = v_followup.id
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'cancelled',
    v_operation_key,
    'human',
    v_user_id,
    v_reason_code,
    v_reason_details
  );

  return v_followup;
end;
$function$;

alter function public.cancel_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text, text, text)
  owner to postgres;

create function public.exhaust_commercial_opportunity_followup_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text
)
returns public.commercial_opportunity_followups
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_operation_key text;
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
  v_followup public.commercial_opportunity_followups;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity followup by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity followup exhaustion requires organization, store and opportunity';
  end if;

  v_operation_key := public.normalize_commercial_opportunity_followup_operation_key(
    p_operation_key
  );

  v_opportunity := public.lock_commercial_opportunity_followup_target(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  );

  v_existing_event := public.find_commercial_opportunity_followup_event_by_operation_key(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_operation_key
  );

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'exhausted'
       or v_existing_event.actor_type <> 'system'
       or v_existing_event.actor_user_id is not null
       or v_existing_event.reason_code is not null
       or v_existing_event.reason_details is not null then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(v_existing_event);
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(v_opportunity);

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE';
  end if;

  update public.commercial_opportunity_followups followup_row
  set
    status = 'exhausted',
    exhausted_at = pg_catalog.clock_timestamp()
  where followup_row.id = v_followup.id
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'exhausted',
    v_operation_key,
    'system',
    null,
    null,
    null
  );

  return v_followup;
end;
$function$;

alter function public.exhaust_commercial_opportunity_followup_by_system(uuid, uuid, uuid, text)
  owner to postgres;

create function public.opt_out_commercial_opportunity_followup_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_reason_code text default null,
  p_reason_details text default null
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
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
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
      message = 'commercial opportunity followup opt out requires organization, store and opportunity';
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
  v_reason_details := public.normalize_commercial_opportunity_followup_reason_details(
    p_reason_details
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
    if v_existing_event.event_type <> 'opted_out'
       or v_existing_event.actor_type <> 'human'
       or v_existing_event.actor_user_id is distinct from v_user_id
       or v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.reason_details is distinct from v_reason_details then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(v_existing_event);
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
      message = 'ZION_FOLLOWUP_OPT_OUT_ALREADY_REGISTERED';
  end if;

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_request_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if found then
    update public.commercial_opportunity_followups followup_row
    set
      status = 'opted_out',
      opted_out_at = pg_catalog.clock_timestamp()
    where followup_row.id = v_followup.id
    returning *
    into v_followup;
  else
    select followup_row.cycle
    into v_last_cycle
    from public.commercial_opportunity_followups followup_row
    where followup_row.organization_id = p_request_organization_id
      and followup_row.store_id = p_store_id
      and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    order by followup_row.cycle desc
    limit 1;

    insert into public.commercial_opportunity_followups (
      organization_id,
      store_id,
      commercial_opportunity_id,
      cycle,
      status,
      started_at,
      opted_out_at,
      attempt_count
    )
    values (
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      coalesce(v_last_cycle, 0) + 1,
      'opted_out',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp(),
      0
    )
    returning *
    into v_followup;
  end if;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'opted_out',
    v_operation_key,
    'human',
    v_user_id,
    v_reason_code,
    v_reason_details
  );

  return v_followup;
end;
$function$;

alter function public.opt_out_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text, text, text)
  owner to postgres;

alter table public.commercial_opportunity_followups enable row level security;
alter table public.commercial_opportunity_followup_events enable row level security;

revoke all on table public.commercial_opportunity_followups
  from public, anon, authenticated, service_role;
revoke all on table public.commercial_opportunity_followup_events
  from public, anon, authenticated, service_role;

grant select on table public.commercial_opportunity_followups
  to authenticated, service_role;
grant select on table public.commercial_opportunity_followup_events
  to authenticated, service_role;

drop policy if exists commercial_opportunity_followups_select_by_membership
  on public.commercial_opportunity_followups;
create policy commercial_opportunity_followups_select_by_membership
  on public.commercial_opportunity_followups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_followups.organization_id
        and membership_row.user_id = auth.uid()
    )
  );

drop policy if exists commercial_opportunity_followup_events_select_by_membership
  on public.commercial_opportunity_followup_events;
create policy commercial_opportunity_followup_events_select_by_membership
  on public.commercial_opportunity_followup_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_opportunity_followup_events.organization_id
        and membership_row.user_id = auth.uid()
    )
  );

revoke all on function public.activate_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text)
  to authenticated;

revoke all on function public.record_commercial_opportunity_followup_attempt_by_user(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_commercial_opportunity_followup_attempt_by_user(uuid, uuid, uuid, text)
  to authenticated;

revoke all on function public.resolve_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text)
  to authenticated;

revoke all on function public.cancel_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text, text, text)
  to authenticated;

revoke all on function public.exhaust_commercial_opportunity_followup_by_system(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.exhaust_commercial_opportunity_followup_by_system(uuid, uuid, uuid, text)
  to service_role;

revoke all on function public.opt_out_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.opt_out_commercial_opportunity_followup_by_user(uuid, uuid, uuid, text, text, text)
  to authenticated;

do $postconditions$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class class_row
      on class_row.oid = index_row.indexrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunity_followups_one_active_per_opportunity_uidx'
      and index_row.indisunique
      and index_row.indpred is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: missing unique active followup index';
  end if;

  if has_table_privilege('authenticated', 'public.commercial_opportunity_followups', 'INSERT')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_followups', 'UPDATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_followup_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_followup_events', 'UPDATE')
     or not has_function_privilege(
       'authenticated',
       'public.activate_commercial_opportunity_followup_by_user(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.exhaust_commercial_opportunity_followup_by_system(uuid,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup grants mismatch';
  end if;
end;
$postconditions$;

commit;
