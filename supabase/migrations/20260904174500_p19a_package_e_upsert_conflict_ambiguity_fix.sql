-- ZION P19-A / Bloco 3 / Pacote E
-- Runtime hotfix: remove PL/pgSQL ambiguity from UPSERT conflict targets.
-- The original Package E migration was already applied remotely.
-- This migration only replaces the two affected functions.

begin;

create or replace function public.upsert_store_monthly_sales_goal_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_monthly_goal_enabled boolean,
  p_monthly_goal_amount_cents integer default null
)
returns table (
  organization_id uuid,
  store_id uuid,
  monthly_goal_enabled boolean,
  monthly_goal_amount_cents integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_enabled boolean := p_monthly_goal_enabled;
  v_amount_cents integer := p_monthly_goal_amount_cents;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if p_monthly_goal_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'MONTHLY_SALES_GOAL_ENABLED_REQUIRED';
  end if;

  if p_organization_id is null or p_store_id is null then
    raise exception using errcode = '22023', message = 'MONTHLY_SALES_GOAL_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = v_user_id
      and membership.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'MONTHLY_SALES_GOAL_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using errcode = '42501', message = 'MONTHLY_SALES_GOAL_STORE_SCOPE_INVALID';
  end if;

  if not v_enabled then
    v_amount_cents := null;
  elsif v_amount_cents is null or v_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'MONTHLY_SALES_GOAL_AMOUNT_REQUIRED';
  end if;

  return query
  insert into public.store_monthly_sales_goals (
    organization_id,
    store_id,
    monthly_goal_enabled,
    monthly_goal_amount_cents
  )
  values (
    p_organization_id,
    p_store_id,
    v_enabled,
    v_amount_cents
  )
  on conflict on constraint store_monthly_sales_goals_pkey
  do update set
    monthly_goal_enabled = excluded.monthly_goal_enabled,
    monthly_goal_amount_cents = excluded.monthly_goal_amount_cents,
    updated_at = now()
  returning
    store_monthly_sales_goals.organization_id,
    store_monthly_sales_goals.store_id,
    store_monthly_sales_goals.monthly_goal_enabled,
    store_monthly_sales_goals.monthly_goal_amount_cents,
    store_monthly_sales_goals.created_at,
    store_monthly_sales_goals.updated_at;
end;
$function$;

alter function public.upsert_store_monthly_sales_goal_scoped(
  uuid, uuid, boolean, integer
) owner to postgres;

revoke all on function public.upsert_store_monthly_sales_goal_scoped(
  uuid, uuid, boolean, integer
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_monthly_sales_goal_scoped(
  uuid, uuid, boolean, integer
) to authenticated;


create or replace function public.record_commercial_opportunity_payment_by_user(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_operation_key text,
  p_request_fingerprint text,
  p_event_type text,
  p_amount_cents integer,
  p_payment_method text default null,
  p_reversed_payment_event_id uuid default null,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  payment_event_id uuid,
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  event_type text,
  confirmed_amount_cents integer,
  event_count integer,
  outcome text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_opportunity public.commercial_opportunities;
  v_operation_key text := nullif(btrim(coalesce(p_operation_key, '')), '');
  v_request_fingerprint text := nullif(btrim(coalesce(p_request_fingerprint, '')), '');
  v_event_type text := lower(btrim(coalesce(p_event_type, '')));
  v_existing public.commercial_opportunity_payment_events;
  v_event public.commercial_opportunity_payment_events;
  v_reversed public.commercial_opportunity_payment_events;
  v_reversed_amount_cents integer := 0;
  v_delta integer;
  v_next_amount integer;
  v_current public.commercial_opportunity_payment_current;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_expected_lifecycle_cycle is null then
    raise exception using errcode = '22023', message = 'PAYMENT_SCOPE_REQUIRED';
  end if;

  if v_operation_key is null or length(v_operation_key) > 160 then
    raise exception using errcode = '22023', message = 'PAYMENT_OPERATION_KEY_INVALID';
  end if;

  if v_request_fingerprint is null or length(v_request_fingerprint) > 160 then
    raise exception using errcode = '22023', message = 'PAYMENT_REQUEST_FINGERPRINT_INVALID';
  end if;

  if v_event_type not in ('confirmation', 'reversal') then
    raise exception using errcode = '22023', message = 'PAYMENT_EVENT_TYPE_INVALID';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'PAYMENT_AMOUNT_INVALID';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update of opportunity_row;

  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_OPPORTUNITY_NOT_FOUND';
  end if;

  if v_opportunity.lifecycle_cycle is distinct from p_expected_lifecycle_cycle then
    raise exception using errcode = '40001', message = 'PAYMENT_LIFECYCLE_CYCLE_MISMATCH';
  end if;

  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = v_user_id
      and membership.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'PAYMENT_MEMBERSHIP_REQUIRED';
  end if;

  if v_event_type = 'confirmation' and p_reversed_payment_event_id is not null then
    raise exception using
      errcode = '22023',
      message = 'PAYMENT_CONFIRMATION_REVERSAL_TARGET_FORBIDDEN';
  end if;

  if v_event_type = 'reversal' and p_reversed_payment_event_id is null then
    raise exception using
      errcode = '22023',
      message = 'PAYMENT_REVERSAL_TARGET_REQUIRED';
  end if;

  if v_event_type = 'reversal' then
    select target.*
    into v_reversed
    from public.commercial_opportunity_payment_events target
    where target.id = p_reversed_payment_event_id
      and target.organization_id = p_organization_id
      and target.store_id = p_store_id
      and target.commercial_opportunity_id = p_commercial_opportunity_id
      and target.lifecycle_cycle = p_expected_lifecycle_cycle
      and target.event_type = 'confirmation';

    if not found then
      raise exception using
        errcode = '22023',
        message = 'PAYMENT_REVERSAL_TARGET_INVALID';
    end if;

    select coalesce(sum(existing_reversal.amount_cents), 0)::integer
    into v_reversed_amount_cents
    from public.commercial_opportunity_payment_events existing_reversal
    where existing_reversal.organization_id = p_organization_id
      and existing_reversal.store_id = p_store_id
      and existing_reversal.commercial_opportunity_id = p_commercial_opportunity_id
      and existing_reversal.lifecycle_cycle = p_expected_lifecycle_cycle
      and existing_reversal.event_type = 'reversal'
      and existing_reversal.reversed_payment_event_id = p_reversed_payment_event_id;

    if v_reversed_amount_cents + p_amount_cents > v_reversed.amount_cents then
      raise exception using
        errcode = '22023',
        message = 'PAYMENT_REVERSAL_EXCEEDS_TARGET_AMOUNT';
    end if;
  end if;

  select *
  into v_existing
  from public.commercial_opportunity_payment_events existing
  where existing.organization_id = p_organization_id
    and existing.store_id = p_store_id
    and existing.commercial_opportunity_id = p_commercial_opportunity_id
    and existing.lifecycle_cycle = p_expected_lifecycle_cycle
    and existing.operation_key = v_operation_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception using errcode = '23505', message = 'PAYMENT_OPERATION_KEY_REUSED';
    end if;

    select *
    into v_current
    from public.commercial_opportunity_payment_current current_row
    where current_row.organization_id = v_existing.organization_id
      and current_row.store_id = v_existing.store_id
      and current_row.commercial_opportunity_id = v_existing.commercial_opportunity_id
      and current_row.lifecycle_cycle = v_existing.lifecycle_cycle;

    return query
    select
      v_existing.id,
      v_existing.organization_id,
      v_existing.store_id,
      v_existing.commercial_opportunity_id,
      v_existing.lifecycle_cycle,
      v_existing.event_type,
      coalesce(v_current.confirmed_amount_cents, 0),
      coalesce(v_current.event_count, 0),
      'idempotent_replay'::text;
    return;
  end if;

  v_delta := case when v_event_type = 'reversal' then -p_amount_cents else p_amount_cents end;

  insert into public.commercial_opportunity_payment_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    event_type,
    amount_cents,
    payment_method,
    reversed_payment_event_id,
    operation_key,
    request_fingerprint,
    actor_user_id,
    notes,
    metadata
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_expected_lifecycle_cycle,
    v_event_type,
    p_amount_cents,
    nullif(btrim(coalesce(p_payment_method, '')), ''),
    p_reversed_payment_event_id,
    v_operation_key,
    v_request_fingerprint,
    v_user_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_event;

  select coalesce(current_row.confirmed_amount_cents, 0) + v_delta
  into v_next_amount
  from public.commercial_opportunity_payment_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and current_row.lifecycle_cycle = p_expected_lifecycle_cycle
  for update of current_row;

  v_next_amount := coalesce(v_next_amount, v_delta);
  if v_next_amount < 0 then
    raise exception using errcode = '22023', message = 'PAYMENT_REVERSAL_EXCEEDS_CONFIRMED_AMOUNT';
  end if;

  insert into public.commercial_opportunity_payment_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    confirmed_amount_cents,
    event_count,
    last_payment_event_id,
    last_operation_key
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_expected_lifecycle_cycle,
    v_next_amount,
    1,
    v_event.id,
    v_operation_key
  )
  on conflict on constraint commercial_opportunity_payment_current_pkey
  do update set
    confirmed_amount_cents = v_next_amount,
    event_count = commercial_opportunity_payment_current.event_count + 1,
    last_payment_event_id = v_event.id,
    last_operation_key = v_operation_key,
    payment_obligation_satisfied =
      case
        when v_event_type = 'reversal' then false
        else commercial_opportunity_payment_current.payment_obligation_satisfied
      end,
    updated_at = now()
  returning * into v_current;

  return query
  select
    v_event.id,
    v_event.organization_id,
    v_event.store_id,
    v_event.commercial_opportunity_id,
    v_event.lifecycle_cycle,
    v_event.event_type,
    v_current.confirmed_amount_cents,
    v_current.event_count,
    'recorded'::text;
end;
$function$;

alter function public.record_commercial_opportunity_payment_by_user(
  uuid, uuid, uuid, integer, text, text, text, integer, text, uuid, text, jsonb
) owner to postgres;

revoke all on function public.record_commercial_opportunity_payment_by_user(
  uuid, uuid, uuid, integer, text, text, text, integer, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.record_commercial_opportunity_payment_by_user(
  uuid, uuid, uuid, integer, text, text, text, integer, text, uuid, text, jsonb
) to authenticated;

commit;
