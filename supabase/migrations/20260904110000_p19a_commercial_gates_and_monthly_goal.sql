-- ZION P19-A / Bloco 3 / Pacote E
-- Commercial gates completion + canonical monthly sales goal.
-- Local migration only; do not apply remotely without an explicit runbook.

alter table public.sales_quote_versions
  add column if not exists quote_kind text null;

alter table public.sales_quote_versions
  drop constraint if exists sales_quote_versions_quote_kind_chk;

alter table public.sales_quote_versions
  add constraint sales_quote_versions_quote_kind_chk
  check (
    quote_kind is null
    or quote_kind in ('preliminary', 'definitive')
  );

comment on column public.sales_quote_versions.quote_kind is
  'Canonical quote kind for commercial gates. Null/unknown is not definitive and must fail closed for definitive-only readiness.';

create table if not exists public.store_monthly_sales_goals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  monthly_goal_enabled boolean not null default false,
  monthly_goal_amount_cents integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, store_id),
  constraint store_monthly_sales_goals_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_monthly_sales_goals_amount_chk check (
    (
      monthly_goal_enabled = false
      and monthly_goal_amount_cents is null
    )
    or (
      monthly_goal_enabled = true
      and monthly_goal_amount_cents is not null
      and monthly_goal_amount_cents > 0
    )
  )
);

alter table public.store_monthly_sales_goals enable row level security;

drop policy if exists store_monthly_sales_goals_select_members on public.store_monthly_sales_goals;
create policy store_monthly_sales_goals_select_members
  on public.store_monthly_sales_goals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships membership
      where membership.organization_id = store_monthly_sales_goals.organization_id
        and membership.user_id = auth.uid()
        and membership.is_active is true
    )
  );

revoke all on table public.store_monthly_sales_goals
  from public, anon, authenticated, service_role;

grant select on table public.store_monthly_sales_goals
  to authenticated, service_role;

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

alter function public.upsert_store_monthly_sales_goal_scoped(uuid, uuid, boolean, integer)
  owner to postgres;

revoke all on function public.upsert_store_monthly_sales_goal_scoped(uuid, uuid, boolean, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_monthly_sales_goal_scoped(uuid, uuid, boolean, integer)
  to authenticated;

create table if not exists public.commercial_opportunity_payment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  commercial_opportunity_id uuid not null references public.commercial_opportunities(id) on delete cascade,
  lifecycle_cycle integer not null,
  event_type text not null,
  amount_cents integer not null,
  payment_method text null,
  reversed_payment_event_id uuid null references public.commercial_opportunity_payment_events(id),
  operation_key text not null,
  request_fingerprint text not null,
  actor_user_id uuid not null,
  source_type text not null default 'settings_action',
  reason_code text not null default 'payment_event_recorded',
  notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commercial_opportunity_payment_events_type_chk
    check (event_type in ('confirmation', 'reversal')),
  constraint commercial_opportunity_payment_events_amount_chk
    check (amount_cents > 0),
  constraint commercial_opportunity_payment_events_metadata_chk
    check (jsonb_typeof(metadata) = 'object'),
  constraint commercial_opportunity_payment_events_opportunity_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete cascade,
  constraint commercial_opportunity_payment_events_reversal_shape_chk
    check (
      (event_type = 'confirmation' and reversed_payment_event_id is null)
      or
      (event_type = 'reversal' and reversed_payment_event_id is not null)
    ),
  constraint commercial_opportunity_payment_events_scope_operation_uidx
    unique (
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle,
      operation_key
    )
);

create index if not exists commercial_opportunity_payment_events_scope_idx
  on public.commercial_opportunity_payment_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    created_at
  );

create table if not exists public.commercial_opportunity_payment_settlement_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  commercial_opportunity_id uuid not null references public.commercial_opportunities(id) on delete cascade,
  lifecycle_cycle integer not null,
  settlement_state text not null,
  operation_key text not null,
  request_fingerprint text not null,
  actor_user_id uuid not null,
  reason_code text not null default 'payment_settlement_recorded',
  notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commercial_opportunity_payment_settlement_events_state_chk
    check (settlement_state in ('satisfied', 'reopened')),
  constraint commercial_opportunity_payment_settlement_events_metadata_chk
    check (jsonb_typeof(metadata) = 'object'),
  constraint commercial_opportunity_payment_settlement_events_opportunity_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete cascade,
  constraint commercial_opportunity_payment_settlement_events_scope_operation_uidx
    unique (
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle,
      operation_key
    )
);

create table if not exists public.commercial_opportunity_payment_current (
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  lifecycle_cycle integer not null,
  confirmed_amount_cents integer not null default 0,
  event_count integer not null default 0,
  last_payment_event_id uuid null,
  last_operation_key text null,
  payment_obligation_satisfied boolean not null default false,
  settlement_event_count integer not null default 0,
  last_settlement_event_id uuid null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, store_id, commercial_opportunity_id, lifecycle_cycle),
  constraint commercial_opportunity_payment_current_amount_chk
    check (confirmed_amount_cents >= 0),
  constraint commercial_opportunity_payment_current_opportunity_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete cascade
);

alter table public.commercial_opportunity_payment_events enable row level security;
alter table public.commercial_opportunity_payment_settlement_events enable row level security;
alter table public.commercial_opportunity_payment_current enable row level security;

revoke all on table public.commercial_opportunity_payment_events
  from public, anon, authenticated, service_role;

revoke all on table public.commercial_opportunity_payment_current
  from public, anon, authenticated, service_role;

revoke all on table public.commercial_opportunity_payment_settlement_events
  from public, anon, authenticated, service_role;

create or replace function public.p9_payment_events_append_only_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'ZION_PAYMENT_EVENTS_APPEND_ONLY';
end;
$function$;

alter function public.p9_payment_events_append_only_internal()
  owner to postgres;

revoke all on function public.p9_payment_events_append_only_internal()
  from public, anon, authenticated, service_role;

create trigger commercial_opportunity_payment_events_append_only
before update or delete
on public.commercial_opportunity_payment_events
for each row
execute function public.p9_payment_events_append_only_internal();

create trigger commercial_opportunity_payment_settlement_events_append_only
before update or delete
on public.commercial_opportunity_payment_settlement_events
for each row
execute function public.p9_payment_events_append_only_internal();

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

create or replace function public.set_commercial_opportunity_payment_settlement_by_user(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_operation_key text,
  p_request_fingerprint text,
  p_settlement_state text,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  settlement_event_id uuid,
  settlement_state text,
  confirmed_amount_cents integer,
  payment_obligation_satisfied boolean,
  outcome text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation_key text := nullif(btrim(coalesce(p_operation_key, '')), '');
  v_request_fingerprint text := nullif(btrim(coalesce(p_request_fingerprint, '')), '');
  v_state text := lower(btrim(coalesce(p_settlement_state, '')));
  v_opportunity public.commercial_opportunities;
  v_current public.commercial_opportunity_payment_current;
  v_existing public.commercial_opportunity_payment_settlement_events;
  v_event public.commercial_opportunity_payment_settlement_events;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_expected_lifecycle_cycle is null then
    raise exception using errcode = '22023', message = 'PAYMENT_SETTLEMENT_SCOPE_REQUIRED';
  end if;

  if v_operation_key is null or length(v_operation_key) > 160 then
    raise exception using errcode = '22023', message = 'PAYMENT_SETTLEMENT_OPERATION_KEY_INVALID';
  end if;

  if v_request_fingerprint is null or length(v_request_fingerprint) > 160 then
    raise exception using errcode = '22023', message = 'PAYMENT_SETTLEMENT_REQUEST_FINGERPRINT_INVALID';
  end if;

  if v_state not in ('satisfied', 'reopened') then
    raise exception using errcode = '22023', message = 'PAYMENT_SETTLEMENT_STATE_INVALID';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update of opportunity_row;

  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_SETTLEMENT_OPPORTUNITY_NOT_FOUND';
  end if;

  if v_opportunity.lifecycle_cycle is distinct from p_expected_lifecycle_cycle then
    raise exception using errcode = '40001', message = 'PAYMENT_SETTLEMENT_LIFECYCLE_CYCLE_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = v_user_id
      and membership.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'PAYMENT_SETTLEMENT_MEMBERSHIP_REQUIRED';
  end if;

  select *
  into v_existing
  from public.commercial_opportunity_payment_settlement_events existing
  where existing.organization_id = p_organization_id
    and existing.store_id = p_store_id
    and existing.commercial_opportunity_id = p_commercial_opportunity_id
    and existing.lifecycle_cycle = p_expected_lifecycle_cycle
    and existing.operation_key = v_operation_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception using errcode = '23505', message = 'PAYMENT_SETTLEMENT_OPERATION_KEY_REUSED';
    end if;

    select *
    into v_current
    from public.commercial_opportunity_payment_current current_row
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.commercial_opportunity_id = p_commercial_opportunity_id
      and current_row.lifecycle_cycle = p_expected_lifecycle_cycle;

    return query
    select
      v_existing.id,
      v_existing.settlement_state,
      coalesce(v_current.confirmed_amount_cents, 0),
      coalesce(v_current.payment_obligation_satisfied, false),
      'idempotent_replay'::text;

    return;
  end if;

  select *
  into v_current
  from public.commercial_opportunity_payment_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and current_row.lifecycle_cycle = p_expected_lifecycle_cycle
  for update of current_row;

  if v_state = 'satisfied'
     and (
       not found
       or coalesce(v_current.confirmed_amount_cents, 0) <= 0
     ) then
    raise exception using
      errcode = '22023',
      message = 'PAYMENT_SETTLEMENT_REQUIRES_CONFIRMED_AMOUNT';
  end if;

  insert into public.commercial_opportunity_payment_settlement_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    settlement_state,
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
    v_state,
    v_operation_key,
    v_request_fingerprint,
    v_user_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_event;

  update public.commercial_opportunity_payment_current current_row
  set payment_obligation_satisfied = (v_state = 'satisfied'),
      settlement_event_count = current_row.settlement_event_count + 1,
      last_settlement_event_id = v_event.id,
      updated_at = now()
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and current_row.lifecycle_cycle = p_expected_lifecycle_cycle
  returning * into v_current;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PAYMENT_SETTLEMENT_CURRENT_MISSING';
  end if;

  return query
  select
    v_event.id,
    v_event.settlement_state,
    v_current.confirmed_amount_cents,
    v_current.payment_obligation_satisfied,
    'recorded'::text;
end;
$function$;

alter function public.set_commercial_opportunity_payment_settlement_by_user(
  uuid, uuid, uuid, integer, text, text, text, text, jsonb
) owner to postgres;

revoke all on function public.set_commercial_opportunity_payment_settlement_by_user(
  uuid, uuid, uuid, integer, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.set_commercial_opportunity_payment_settlement_by_user(
  uuid, uuid, uuid, integer, text, text, text, text, jsonb
) to authenticated;

create or replace function public.p9_resolve_payment_progress_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  assessment_state text,
  progress_state text,
  resolver_key text,
  resolver_version integer,
  authority_fingerprint text,
  resolution_basis jsonb,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_current public.commercial_opportunity_payment_current;
  v_basis jsonb;
  v_progress text;
  v_reason text;
  v_fingerprint text;
begin
  select *
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'P9_PAYMENT_PROGRESS_OPPORTUNITY_NOT_FOUND';
  end if;

  select *
  into v_current
  from public.commercial_opportunity_payment_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and current_row.lifecycle_cycle = v_opportunity.lifecycle_cycle;

  if not found or coalesce(v_current.confirmed_amount_cents, 0) = 0 then
    v_progress := 'not_started';
    v_reason := 'payment_not_confirmed';
  elsif coalesce(v_current.payment_obligation_satisfied, false) is true then
    v_progress := 'completed';
    v_reason := 'payment_obligation_satisfied_by_human';
  else
    v_progress := 'in_progress';
    v_reason := 'payment_partially_confirmed';
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p9_progress_resolution_basis_v1',
    'resolver_key', 'payment',
    'resolver_version', 2,
    'authority', jsonb_build_array(
      'commercial_opportunity_payment_events',
      'commercial_opportunity_payment_settlement_events',
      'commercial_opportunity_payment_current'
    ),
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle_context', v_opportunity.lifecycle_cycle,
    'confirmed_amount_cents', coalesce(v_current.confirmed_amount_cents, 0),
    'event_count', coalesce(v_current.event_count, 0),
    'payment_obligation_satisfied', coalesce(v_current.payment_obligation_satisfied, false),
    'settlement_event_count', coalesce(v_current.settlement_event_count, 0),
    'last_settlement_event_id', v_current.last_settlement_event_id
  );

  v_fingerprint := encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');

  return query
  select
    'determined'::text,
    v_progress,
    'payment'::text,
    2,
    v_fingerprint,
    v_basis,
    v_reason;
end;
$function$;

alter function public.p9_resolve_payment_progress_internal(uuid, uuid, uuid)
  owner to postgres;

revoke all on function public.p9_resolve_payment_progress_internal(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.p9_resolve_payment_progress_internal(uuid, uuid, uuid)
  to service_role;

create or replace function public.p9_resolve_definitive_quote_progress_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  assessment_state text,
  progress_state text,
  resolver_key text,
  resolver_version integer,
  authority_fingerprint text,
  resolution_basis jsonb,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_quote_count integer := 0;
  v_definitive_sent_version_count integer := 0;
  v_current_quote_exists boolean := false;
  v_current_version_exists boolean := false;
  v_current_quote_opportunity_id uuid;
  v_current_version_quote_id uuid;
  v_current_version_status text;
  v_current_version_sent_at timestamptz;
  v_current_version_quote_kind text;
  v_pointer_valid boolean := false;
  v_basis jsonb;
  v_assessment text;
  v_progress text;
  v_reason text;
  v_fingerprint text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using errcode = '22023', message = 'P9_DEFINITIVE_QUOTE_PROGRESS_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'P9_DEFINITIVE_QUOTE_PROGRESS_OPPORTUNITY_NOT_FOUND';
  end if;

  select count(*)::integer
  into v_quote_count
  from public.sales_quotes quote_row
  where quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id;

  select count(*)::integer
  into v_definitive_sent_version_count
  from public.sales_quotes quote_row
  join public.sales_quote_versions version_row
    on version_row.quote_id = quote_row.id
   and version_row.organization_id = quote_row.organization_id
   and version_row.store_id = quote_row.store_id
  where quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
    and version_row.sent_at is not null
    and lower(btrim(version_row.status)) in ('sent', 'superseded')
    and version_row.quote_kind = 'definitive';

  if v_opportunity.current_quote_id is not null
     and v_opportunity.current_quote_version_id is not null then
    select
      true,
      quote_row.commercial_opportunity_id
    into
      v_current_quote_exists,
      v_current_quote_opportunity_id
    from public.sales_quotes quote_row
    where quote_row.id = v_opportunity.current_quote_id
      and quote_row.organization_id = p_organization_id
      and quote_row.store_id = p_store_id;

    if not found then
      v_current_quote_exists := false;
    end if;

    select
      true,
      version_row.quote_id,
      version_row.status,
      version_row.sent_at,
      version_row.quote_kind
    into
      v_current_version_exists,
      v_current_version_quote_id,
      v_current_version_status,
      v_current_version_sent_at,
      v_current_version_quote_kind
    from public.sales_quote_versions version_row
    where version_row.id = v_opportunity.current_quote_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id;

    if not found then
      v_current_version_exists := false;
    end if;

    v_pointer_valid :=
      v_current_quote_exists
      and v_current_version_exists
      and v_current_quote_opportunity_id is not distinct from p_commercial_opportunity_id
      and v_current_version_quote_id is not distinct from v_opportunity.current_quote_id
      and v_current_version_sent_at is not null
      and lower(btrim(coalesce(v_current_version_status, ''))) in ('sent', 'superseded');

    if not v_pointer_valid then
      v_assessment := 'conflict';
      v_progress := null;
      v_reason := 'definitive_quote_current_proposal_authority_conflict';
    elsif v_current_version_quote_kind is distinct from 'definitive' then
      v_assessment := 'determined';
      v_progress := 'in_progress';
      v_reason := 'definitive_quote_current_proposal_not_definitive';
    elsif v_opportunity.lifecycle_cycle > 1 then
      v_assessment := 'needs_resolution';
      v_progress := null;
      v_reason := 'definitive_quote_current_proposal_cycle_unanchored';
    else
      v_assessment := 'determined';
      v_progress := 'completed';
      v_reason := 'definitive_quote_current_proposal_canonically_sent';
    end if;
  elsif v_opportunity.current_quote_id is not null
        or v_opportunity.current_quote_version_id is not null then
    v_assessment := 'conflict';
    v_progress := null;
    v_reason := 'definitive_quote_current_proposal_pair_conflict';
  elsif v_definitive_sent_version_count > 0 then
    v_assessment := 'needs_resolution';
    v_progress := null;
    v_reason := 'definitive_quote_sent_without_current_proposal';
  elsif v_quote_count = 0 then
    v_assessment := 'determined';
    v_progress := 'not_started';
    v_reason := 'definitive_quote_no_canonical_artifact';
  elsif v_opportunity.lifecycle_cycle > 1 then
    v_assessment := 'needs_resolution';
    v_progress := null;
    v_reason := 'definitive_quote_artifact_cycle_unanchored';
  else
    v_assessment := 'determined';
    v_progress := 'in_progress';
    v_reason := 'definitive_quote_not_canonically_sent';
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p9_progress_resolution_basis_v1',
    'resolver_key', 'definitive_quote',
    'resolver_version', 1,
    'legacy_quote_progress_preserved', true,
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle_context', v_opportunity.lifecycle_cycle,
    'current_quote_id', v_opportunity.current_quote_id,
    'current_quote_version_id', v_opportunity.current_quote_version_id,
    'current_version_quote_kind', v_current_version_quote_kind,
    'current_version_sent_at', v_current_version_sent_at,
    'definitive_sent_version_count', v_definitive_sent_version_count,
    'quote_count', v_quote_count
  );

  v_fingerprint := encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');

  return query
  select
    v_assessment,
    v_progress,
    'definitive_quote'::text,
    1,
    v_fingerprint,
    v_basis,
    v_reason;
end;
$function$;

revoke all on function public.p9_resolve_definitive_quote_progress_internal(uuid, uuid, uuid) from public;

do $block$
declare
  v_function_definition text;
  v_needle text := $needle$
    elsif v_item.item_key = 'post_sale' then
$needle$;
  v_replacement text := $replacement$
    elsif v_item.item_key = 'payment' then
      select * into v_resolution
      from public.p9_resolve_payment_progress_internal(
        p_organization_id, p_store_id, p_commercial_opportunity_id
      );

      if not found then
        raise exception using errcode = 'P0001', message = 'ZION_CHECKLIST_PROGRESS_PAYMENT_RESOLVER_EMPTY';
      end if;

      v_assessment_state := v_resolution.assessment_state;
      v_progress_state := v_resolution.progress_state;
      v_resolver_key := v_resolution.resolver_key;
      v_resolver_version := v_resolution.resolver_version;
      v_authority_fingerprint := v_resolution.authority_fingerprint;
      v_resolution_basis := v_resolution.resolution_basis;
      v_reason_code := v_resolution.reason_code;

    elsif v_item.item_key = 'definitive_quote' then
      select * into v_resolution
      from public.p9_resolve_definitive_quote_progress_internal(
        p_organization_id, p_store_id, p_commercial_opportunity_id
      );

      if not found then
        raise exception using errcode = 'P0001', message = 'ZION_CHECKLIST_PROGRESS_DEFINITIVE_QUOTE_RESOLVER_EMPTY';
      end if;

      v_assessment_state := v_resolution.assessment_state;
      v_progress_state := v_resolution.progress_state;
      v_resolver_key := v_resolution.resolver_key;
      v_resolver_version := v_resolution.resolver_version;
      v_authority_fingerprint := v_resolution.authority_fingerprint;
      v_resolution_basis := v_resolution.resolution_basis;
      v_reason_code := v_resolution.reason_code;

    elsif v_item.item_key = 'post_sale' then
$replacement$;
begin
  v_function_definition := pg_get_functiondef(
    'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)'::regprocedure
  );

  if v_function_definition not like '%p9_resolve_payment_progress_internal%' then
    if position(v_needle in v_function_definition) = 0 then
      raise exception using errcode = 'P0001', message = 'PAYMENT_PROGRESS_MATERIALIZER_ANCHOR_NOT_FOUND';
    end if;

    execute replace(v_function_definition, v_needle, v_replacement);
  end if;
end;
$block$;

create or replace function public.read_quote_kind_send_readiness_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_version_id uuid
)
returns table (
  readiness_state text,
  reason_code text,
  blocking_items jsonb,
  authority_fingerprint text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_version public.sales_quote_versions;
  v_technical_item public.commercial_opportunity_checklist_items;
  v_technical public.commercial_opportunity_checklist_progress_items;
  v_preliminary_policy public.commercial_opportunity_checklist_items;
  v_basis jsonb;
  v_state text := 'ready';
  v_reason text := 'quote_kind_send_ready';
  v_blocking jsonb := '[]'::jsonb;
begin
  select *
  into v_version
  from public.sales_quote_versions version_row
  where version_row.id = p_sales_quote_version_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_KIND_VERSION_NOT_FOUND';
  end if;

  if coalesce(v_version.quote_kind, '') not in ('preliminary', 'definitive') then
    return query select 'ready'::text, 'legacy_quote_kind_send'::text, '[]'::jsonb, null::text;
    return;
  end if;

  select item_row.*
  into v_technical_item
  from public.commercial_opportunity_checklist_current current_row
  join public.commercial_opportunity_checklist_items item_row
    on item_row.checklist_version_id = current_row.current_checklist_version_id
   and item_row.organization_id = current_row.organization_id
   and item_row.store_id = current_row.store_id
   and item_row.commercial_opportunity_id = current_row.commercial_opportunity_id
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and item_row.item_key = 'technical_visit';

  if found and v_technical_item.applicability_state in ('conflict', 'needs_resolution') then
    v_state := v_technical_item.applicability_state;
    v_reason := 'quote_kind_technical_visit_applicability_' || v_technical_item.applicability_state;
    v_blocking := jsonb_build_array(
      jsonb_build_object(
        'item_key', 'technical_visit',
        'applicability_state', v_technical_item.applicability_state,
        'reason_code', v_technical_item.reason_code
      )
    );
  elsif found and v_technical_item.applicability_state = 'required' then
    select progress_row.*
    into v_technical
    from public.commercial_opportunity_checklist_progress_current current_row
    join public.commercial_opportunity_checklist_progress_items progress_row
      on progress_row.progress_version_id = current_row.current_progress_version_id
     and progress_row.organization_id = current_row.organization_id
     and progress_row.store_id = current_row.store_id
     and progress_row.commercial_opportunity_id = current_row.commercial_opportunity_id
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.commercial_opportunity_id = p_commercial_opportunity_id
      and progress_row.checklist_item_id = v_technical_item.id;

    if not found then
      v_state := 'needs_resolution';
      v_reason := 'quote_kind_technical_visit_progress_missing';
      v_blocking := jsonb_build_array(
        jsonb_build_object(
          'item_key', 'technical_visit',
          'applicability_state', 'required'
        )
      );
    elsif v_technical.assessment_state in ('conflict', 'needs_resolution') then
      v_state := v_technical.assessment_state;
      v_reason := 'quote_kind_technical_visit_progress_' || v_technical.assessment_state;
      v_blocking := jsonb_build_array(
        jsonb_build_object(
          'item_key', 'technical_visit',
          'assessment_state', v_technical.assessment_state,
          'reason_code', v_technical.reason_code
        )
      );
    elsif v_technical.progress_state is distinct from 'completed' then
      if v_version.quote_kind = 'definitive' then
        v_state := 'blocked';
        v_reason := 'definitive_quote_requires_completed_technical_visit';
        v_blocking := jsonb_build_array(
          jsonb_build_object(
            'item_key', 'technical_visit',
            'progress_state', v_technical.progress_state,
            'assessment_state', v_technical.assessment_state
          )
        );
      else
        select item_row.*
        into v_preliminary_policy
        from public.commercial_opportunity_checklist_current current_row
        join public.commercial_opportunity_checklist_items item_row
          on item_row.checklist_version_id = current_row.current_checklist_version_id
         and item_row.organization_id = current_row.organization_id
         and item_row.store_id = current_row.store_id
         and item_row.commercial_opportunity_id = current_row.commercial_opportunity_id
        where current_row.organization_id = p_organization_id
          and current_row.store_id = p_store_id
          and current_row.commercial_opportunity_id = p_commercial_opportunity_id
          and item_row.item_key = 'preliminary_quote_before_technical_visit'
          and item_row.applicability_state = 'optional';

        if not found then
          v_state := 'blocked';
          v_reason := 'preliminary_quote_before_visit_not_allowed';
          v_blocking := jsonb_build_array(
            jsonb_build_object(
              'item_key', 'preliminary_quote_before_technical_visit',
              'technical_visit_progress_state', v_technical.progress_state,
              'technical_visit_assessment_state', v_technical.assessment_state
            )
          );
        else
          v_reason := 'preliminary_quote_before_visit_allowed';
        end if;
      end if;
    end if;
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p19a_quote_kind_send_readiness_v1',
    'sales_quote_version_id', p_sales_quote_version_id,
    'quote_kind', v_version.quote_kind,
    'technical_visit_applicability_state', v_technical_item.applicability_state,
    'technical_visit_progress_state', v_technical.progress_state,
    'preliminary_before_visit_policy_item_id', v_preliminary_policy.id,
    'readiness_state', v_state,
    'reason_code', v_reason,
    'blocking_items', v_blocking
  );

  return query
  select v_state, v_reason, v_blocking, encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

revoke all on function public.read_quote_kind_send_readiness_scoped(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.read_quote_kind_send_readiness_scoped(uuid, uuid, uuid, uuid)
to service_role;
