begin;

set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- =============================================================================
-- ZION / Pilar 9 / Bloco 8 / Etapa 8.6
-- Final Commercial Condition for negotiated closures.
--
-- Additive only. Historical proposal, acceptance, contract and lifecycle rows
-- are preserved. Direct Bloco 6 closure (orcamento -> fechamento_pagamento)
-- keeps its existing authority and does not require a Final Commercial Condition.
-- =============================================================================

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('20261007150000_p9_8_6_final_commercial_condition', 0)
);

-- -----------------------------------------------------------------------------
-- 0. Preconditions.
-- -----------------------------------------------------------------------------
do $preflight$
declare
  v_required_relation text;
  v_required_function text;
begin
  foreach v_required_relation in array array[
    'public.commercial_opportunities',
    'public.commercial_opportunity_lifecycle_events',
    'public.commercial_proposal_acceptance_events',
    'public.sales_quotes',
    'public.sales_quote_versions',
    'public.sales_contracts',
    'public.memberships'
  ] loop
    if pg_catalog.to_regclass(v_required_relation) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('P9_8_6 precondition missing relation: %s', v_required_relation);
    end if;
  end loop;

  foreach v_required_function in array array[
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)',
    'public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)',
    'public.p9_resolve_current_commercial_proposal_acceptance_internal(uuid,uuid,uuid)',
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)',
    'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)',
    'public.enter_commercial_opportunity_negotiation_by_system(uuid,uuid,uuid,integer,text,text,uuid,text,text,text)',
    'public.enter_commercial_opportunity_negotiation_by_user(uuid,uuid,uuid,integer,text,text,uuid,text,text,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_required_function) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('P9_8_6 precondition missing function: %s', v_required_function);
    end if;
  end loop;

  if pg_catalog.to_regprocedure(
       'public.p9_readiness_v2_pre_final_condition(uuid,uuid,uuid,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.p9_contract_lineage_pre_final_condition(uuid,uuid,uuid)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_6 precondition failed: backup function names already exist';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- 1. Deterministic active negotiation-cycle projection.
--
-- The lifecycle event remains the canonical cycle identity. This nullable column
-- is only a current projection so later code never has to infer the active cycle
-- using latest/first/timestamps.
-- -----------------------------------------------------------------------------
create unique index if not exists p9_lifecycle_event_cycle_scope_uidx
  on public.commercial_opportunity_lifecycle_events(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle
  );

alter table public.commercial_opportunities
  add column if not exists current_negotiation_cycle_id uuid;

do $cycle_fk$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and c.conname = 'commercial_opportunities_current_negotiation_cycle_fkey'
  ) then
    alter table public.commercial_opportunities
      add constraint commercial_opportunities_current_negotiation_cycle_fkey
      foreign key (
        current_negotiation_cycle_id,
        organization_id,
        store_id,
        id,
        lifecycle_cycle
      )
      references public.commercial_opportunity_lifecycle_events(
        id,
        organization_id,
        store_id,
        commercial_opportunity_id,
        lifecycle_cycle
      )
      on update no action
      on delete restrict;
  end if;
end;
$cycle_fk$;

comment on column public.commercial_opportunities.current_negotiation_cycle_id is
  'P9 8.6 projection of the active negotiation cycle. The canonical identity is the referenced lifecycle event id; NULL outside an active negotiation or when legacy history is ambiguous.';

-- Safe legacy backfill only when there is exactly one qualifying entry event in
-- the current lifecycle. Ambiguous histories remain NULL/fail-closed.
with unique_cycle as (
  select
    event_row.organization_id,
    event_row.store_id,
    event_row.commercial_opportunity_id,
    event_row.lifecycle_cycle,
    (pg_catalog.array_agg(event_row.id))[1] as negotiation_cycle_id
  from public.commercial_opportunity_lifecycle_events event_row
  where event_row.event_type = 'stage_transition'
    and event_row.new_stage = 'negociacao'
    and event_row.reason_code in (
      'concrete_offer_required',
      'concrete_quote_objection_required',
      'visit_viable_concrete_offer_required',
      'renegotiation_required'
    )
  group by
    event_row.organization_id,
    event_row.store_id,
    event_row.commercial_opportunity_id,
    event_row.lifecycle_cycle
  having pg_catalog.count(*) = 1
)
update public.commercial_opportunities opportunity_row
set current_negotiation_cycle_id = unique_cycle.negotiation_cycle_id
from unique_cycle
where opportunity_row.organization_id = unique_cycle.organization_id
  and opportunity_row.store_id = unique_cycle.store_id
  and opportunity_row.id = unique_cycle.commercial_opportunity_id
  and opportunity_row.lifecycle_cycle = unique_cycle.lifecycle_cycle
  and opportunity_row.stage = 'negociacao'
  and opportunity_row.current_negotiation_cycle_id is null;

-- -----------------------------------------------------------------------------
-- 2. Final condition ledger and scoped lineage.
-- -----------------------------------------------------------------------------
create unique index if not exists p9_acceptance_event_final_condition_scope_uidx
  on public.commercial_proposal_acceptance_events(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    quote_id,
    quote_version_id
  );

create table public.commercial_final_conditions (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  lifecycle_cycle integer not null check (lifecycle_cycle >= 1),
  negotiation_cycle_id uuid not null,
  quote_id uuid not null,
  quote_version_id uuid not null,
  acceptance_event_id uuid not null,

  condition_state text not null
    check (condition_state in ('current', 'superseded')),

  operation_key text not null,
  request_fingerprint text not null,

  materialized_at timestamptz not null default pg_catalog.clock_timestamp(),
  superseded_at timestamptz null,
  superseded_by_negotiation_cycle_id uuid null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint p9_final_condition_operation_key_check
    check (pg_catalog.length(pg_catalog.btrim(operation_key)) between 1 and 200),

  constraint p9_final_condition_fingerprint_check
    check (pg_catalog.length(pg_catalog.btrim(request_fingerprint)) between 1 and 256),

  constraint p9_final_condition_state_shape_check
    check (
      (
        condition_state = 'current'
        and superseded_at is null
        and superseded_by_negotiation_cycle_id is null
      )
      or
      (
        condition_state = 'superseded'
        and superseded_at is not null
        and superseded_by_negotiation_cycle_id is not null
      )
    ),

  constraint p9_final_condition_opportunity_scope_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on update no action
    on delete restrict,

  constraint p9_final_condition_negotiation_cycle_fkey
    foreign key (
      negotiation_cycle_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle
    )
    references public.commercial_opportunity_lifecycle_events(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle
    )
    on update no action
    on delete restrict,

  constraint p9_final_condition_superseded_cycle_fkey
    foreign key (
      superseded_by_negotiation_cycle_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle
    )
    references public.commercial_opportunity_lifecycle_events(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle
    )
    on update no action
    on delete restrict,

  constraint p9_final_condition_quote_scope_fkey
    foreign key (quote_id, commercial_opportunity_id, organization_id, store_id)
    references public.sales_quotes(id, commercial_opportunity_id, organization_id, store_id)
    on update no action
    on delete restrict,

  constraint p9_final_condition_quote_version_scope_fkey
    foreign key (quote_version_id, quote_id, organization_id, store_id)
    references public.sales_quote_versions(id, quote_id, organization_id, store_id)
    on update no action
    on delete restrict,

  constraint p9_final_condition_acceptance_scope_fkey
    foreign key (
      acceptance_event_id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle,
      quote_id,
      quote_version_id
    )
    references public.commercial_proposal_acceptance_events(
      id,
      organization_id,
      store_id,
      commercial_opportunity_id,
      lifecycle_cycle,
      quote_id,
      quote_version_id
    )
    on update no action
    on delete restrict
);

alter table public.commercial_final_conditions owner to postgres;

create unique index p9_final_condition_operation_uidx
  on public.commercial_final_conditions(organization_id, store_id, operation_key);

create unique index p9_final_condition_one_current_uidx
  on public.commercial_final_conditions(
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle
  )
  where condition_state = 'current';

create unique index p9_final_condition_cycle_once_uidx
  on public.commercial_final_conditions(
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    negotiation_cycle_id
  );

create unique index p9_final_condition_acceptance_once_uidx
  on public.commercial_final_conditions(
    organization_id,
    store_id,
    acceptance_event_id
  );

create index p9_final_condition_scope_state_idx
  on public.commercial_final_conditions(
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    condition_state
  );

alter table public.commercial_final_conditions enable row level security;
alter table public.commercial_final_conditions force row level security;
revoke all on table public.commercial_final_conditions
  from public, anon, authenticated, service_role;

comment on table public.commercial_final_conditions is
  'P9 8.6 append-history authority for an accepted negotiated commercial condition. Direct non-negotiated Bloco 6 closure does not require a row.';

-- -----------------------------------------------------------------------------
-- 3. History mutation guard. Only current -> superseded is legal and the event
--    that supersedes it must be the exact scoped renegotiation entry event.
-- -----------------------------------------------------------------------------
create or replace function public.p9_protect_final_condition_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'P9_FINAL_CONDITION_HISTORY_APPEND_ONLY';
  end if;

  if old.condition_state is distinct from 'current'
     or new.condition_state is distinct from 'superseded'
     or new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
     or new.commercial_opportunity_id is distinct from old.commercial_opportunity_id
     or new.lifecycle_cycle is distinct from old.lifecycle_cycle
     or new.negotiation_cycle_id is distinct from old.negotiation_cycle_id
     or new.quote_id is distinct from old.quote_id
     or new.quote_version_id is distinct from old.quote_version_id
     or new.acceptance_event_id is distinct from old.acceptance_event_id
     or new.operation_key is distinct from old.operation_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.materialized_at is distinct from old.materialized_at
     or new.created_at is distinct from old.created_at
     or new.superseded_at is null
     or new.superseded_by_negotiation_cycle_id is null then
    raise exception using errcode = 'P0001', message = 'P9_FINAL_CONDITION_HISTORY_MUTATION_INVALID';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunity_lifecycle_events event_row
    where event_row.id = new.superseded_by_negotiation_cycle_id
      and event_row.organization_id = new.organization_id
      and event_row.store_id = new.store_id
      and event_row.commercial_opportunity_id = new.commercial_opportunity_id
      and event_row.lifecycle_cycle = new.lifecycle_cycle
      and event_row.event_type = 'stage_transition'
      and event_row.previous_stage = 'fechamento_pagamento'
      and event_row.new_stage = 'negociacao'
      and event_row.reason_code = 'renegotiation_required'
  ) then
    raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_SUPERSESSION_EVENT_INVALID';
  end if;

  return new;
end;
$function$;

alter function public.p9_protect_final_condition_history() owner to postgres;
revoke all on function public.p9_protect_final_condition_history()
  from public, anon, authenticated, service_role;

create trigger p9_final_condition_append_history
before update or delete on public.commercial_final_conditions
for each row execute function public.p9_protect_final_condition_history();

-- -----------------------------------------------------------------------------
-- 4. Transaction-local capability for negotiated closure.
-- -----------------------------------------------------------------------------
create table public.commercial_final_condition_transition_authority (
  transaction_id bigint not null,
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  condition_id uuid not null,
  negotiation_cycle_id uuid not null,
  transition_operation_key text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  primary key (
    transaction_id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    transition_operation_key
  ),

  constraint p9_final_transition_authority_condition_fkey
    foreign key (condition_id)
    references public.commercial_final_conditions(id)
    on delete restrict
);

alter table public.commercial_final_condition_transition_authority owner to postgres;
alter table public.commercial_final_condition_transition_authority enable row level security;
alter table public.commercial_final_condition_transition_authority force row level security;
revoke all on table public.commercial_final_condition_transition_authority
  from public, anon, authenticated, service_role;

create or replace function public.p9_guard_negotiated_final_condition_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if new.event_type = 'stage_transition'
     and new.previous_stage = 'negociacao'
     and new.new_stage = 'fechamento_pagamento'
     and new.reason_code = 'accepted_negotiated_condition_required' then

    if not exists (
      select 1
      from public.commercial_final_condition_transition_authority authority_row
      join public.commercial_final_conditions condition_row
        on condition_row.id = authority_row.condition_id
      join public.commercial_opportunities opportunity_row
        on opportunity_row.id = new.commercial_opportunity_id
       and opportunity_row.organization_id = new.organization_id
       and opportunity_row.store_id = new.store_id
      where authority_row.transaction_id = pg_catalog.txid_current()
        and authority_row.organization_id = new.organization_id
        and authority_row.store_id = new.store_id
        and authority_row.commercial_opportunity_id = new.commercial_opportunity_id
        and authority_row.transition_operation_key = new.idempotency_key
        and authority_row.negotiation_cycle_id = condition_row.negotiation_cycle_id
        and condition_row.operation_key = authority_row.transition_operation_key
        and condition_row.condition_state = 'current'
        and condition_row.organization_id = new.organization_id
        and condition_row.store_id = new.store_id
        and condition_row.commercial_opportunity_id = new.commercial_opportunity_id
        and condition_row.lifecycle_cycle = new.lifecycle_cycle
        and opportunity_row.lifecycle_cycle = new.lifecycle_cycle
        and opportunity_row.stage = 'negociacao'
        and opportunity_row.current_negotiation_cycle_id = authority_row.negotiation_cycle_id
    ) then
      raise exception using errcode = '23514', message = 'P9_FINAL_COMMERCIAL_CONDITION_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

alter function public.p9_guard_negotiated_final_condition_transition() owner to postgres;
revoke all on function public.p9_guard_negotiated_final_condition_transition()
  from public, anon, authenticated, service_role;

create trigger p9_final_condition_negotiated_close_guard
before insert on public.commercial_opportunity_lifecycle_events
for each row execute function public.p9_guard_negotiated_final_condition_transition();

-- -----------------------------------------------------------------------------
-- 5. Renegotiation baseline capture.
--
-- Direct Bloco 6 closures have no Final Condition. Without this immutable baseline
-- a later renegotiation could incorrectly reuse the old accepted Q1/V1 before Q2
-- exists. The baseline is attached to the new canonical renegotiation event itself.
-- -----------------------------------------------------------------------------
create or replace function public.p9_capture_renegotiation_baseline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities%rowtype;
  v_acceptance_id uuid;
begin
  if new.event_type = 'stage_transition'
     and new.previous_stage = 'fechamento_pagamento'
     and new.new_stage = 'negociacao'
     and new.reason_code = 'renegotiation_required' then

    select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = new.commercial_opportunity_id
      and opportunity_row.organization_id = new.organization_id
      and opportunity_row.store_id = new.store_id
      and opportunity_row.lifecycle_cycle = new.lifecycle_cycle;

    if not found then
      raise exception using errcode = 'P0002', message = 'P9_RENEGOTIATION_BASELINE_OPPORTUNITY_NOT_FOUND';
    end if;

    if v_opportunity.current_quote_id is not null
       and v_opportunity.current_quote_version_id is not null then
      select acceptance_row.id
      into v_acceptance_id
      from public.commercial_proposal_acceptance_events acceptance_row
      where acceptance_row.organization_id = new.organization_id
        and acceptance_row.store_id = new.store_id
        and acceptance_row.commercial_opportunity_id = new.commercial_opportunity_id
        and acceptance_row.lifecycle_cycle = new.lifecycle_cycle
        and acceptance_row.quote_id = v_opportunity.current_quote_id
        and acceptance_row.quote_version_id = v_opportunity.current_quote_version_id;
    end if;

    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'p9_8_6_renegotiation_baseline',
        pg_catalog.jsonb_build_object(
          'quote_id', v_opportunity.current_quote_id,
          'quote_version_id', v_opportunity.current_quote_version_id,
          'acceptance_event_id', v_acceptance_id
        )
      );
  end if;

  return new;
end;
$function$;

alter function public.p9_capture_renegotiation_baseline() owner to postgres;
revoke all on function public.p9_capture_renegotiation_baseline()
  from public, anon, authenticated, service_role;

create trigger p9_final_condition_renegotiation_baseline
before insert on public.commercial_opportunity_lifecycle_events
for each row execute function public.p9_capture_renegotiation_baseline();

-- -----------------------------------------------------------------------------
-- 6. Keep the active negotiation-cycle projection exact and supersede an old
--    Final Condition atomically when post-accept renegotiation begins.
-- -----------------------------------------------------------------------------
create or replace function public.p9_reconcile_negotiation_cycle_after_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if new.event_type <> 'stage_transition' then
    return new;
  end if;

  if new.new_stage = 'negociacao' then
    if new.reason_code not in (
      'concrete_offer_required',
      'concrete_quote_objection_required',
      'visit_viable_concrete_offer_required',
      'renegotiation_required'
    ) then
      raise exception using errcode = '23514', message = 'P9_NEGOTIATION_CYCLE_EVENT_INVALID';
    end if;

    if new.previous_stage = 'fechamento_pagamento'
       and new.reason_code = 'renegotiation_required' then
      update public.commercial_final_conditions condition_row
      set condition_state = 'superseded',
          superseded_at = pg_catalog.clock_timestamp(),
          superseded_by_negotiation_cycle_id = new.id
      where condition_row.organization_id = new.organization_id
        and condition_row.store_id = new.store_id
        and condition_row.commercial_opportunity_id = new.commercial_opportunity_id
        and condition_row.lifecycle_cycle = new.lifecycle_cycle
        and condition_row.condition_state = 'current';
    end if;

    update public.commercial_opportunities opportunity_row
    set current_negotiation_cycle_id = new.id
    where opportunity_row.id = new.commercial_opportunity_id
      and opportunity_row.organization_id = new.organization_id
      and opportunity_row.store_id = new.store_id
      and opportunity_row.lifecycle_cycle = new.lifecycle_cycle;

    if not found then
      raise exception using errcode = 'P0002', message = 'P9_NEGOTIATION_CYCLE_PROJECTION_OPPORTUNITY_NOT_FOUND';
    end if;

  elsif new.previous_stage = 'negociacao' then
    update public.commercial_opportunities opportunity_row
    set current_negotiation_cycle_id = null
    where opportunity_row.id = new.commercial_opportunity_id
      and opportunity_row.organization_id = new.organization_id
      and opportunity_row.store_id = new.store_id
      and opportunity_row.lifecycle_cycle = new.lifecycle_cycle;
  end if;

  return new;
end;
$function$;

alter function public.p9_reconcile_negotiation_cycle_after_lifecycle_event() owner to postgres;
revoke all on function public.p9_reconcile_negotiation_cycle_after_lifecycle_event()
  from public, anon, authenticated, service_role;

create trigger p9_final_condition_cycle_projection
  after insert on public.commercial_opportunity_lifecycle_events
  for each row execute function public.p9_reconcile_negotiation_cycle_after_lifecycle_event();

-- -----------------------------------------------------------------------------
-- 7. Deterministic Final Condition resolver.
-- -----------------------------------------------------------------------------
create or replace function public.p9_resolve_current_commercial_final_condition_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  condition_state text,
  reason_code text,
  condition_id uuid,
  lifecycle_cycle integer,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid,
  request_fingerprint text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities%rowtype;
  v_condition public.commercial_final_conditions%rowtype;
  v_negotiation_event public.commercial_opportunity_lifecycle_events%rowtype;
  v_proposal record;
  v_acceptance record;
  v_current_count bigint := 0;
  v_history_count bigint := 0;
  v_negotiated_close_count bigint := 0;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using errcode = '22023', message = 'P9_FINAL_CONDITION_READER_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'P9_FINAL_CONDITION_OPPORTUNITY_NOT_FOUND';
  end if;

  select
    pg_catalog.count(*) filter (where condition_row.condition_state = 'current'),
    pg_catalog.count(*)
  into v_current_count, v_history_count
  from public.commercial_final_conditions condition_row
  where condition_row.organization_id = p_organization_id
    and condition_row.store_id = p_store_id
    and condition_row.commercial_opportunity_id = p_commercial_opportunity_id
    and condition_row.lifecycle_cycle = v_opportunity.lifecycle_cycle;

  select pg_catalog.count(*)
  into v_negotiated_close_count
  from public.commercial_opportunity_lifecycle_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
    and event_row.event_type = 'stage_transition'
    and event_row.previous_stage = 'negociacao'
    and event_row.new_stage = 'fechamento_pagamento'
    and event_row.reason_code = 'accepted_negotiated_condition_required';

  if v_current_count > 1 then
    return query select
      'conflict'::text,
      'multiple_current_final_conditions'::text,
      null::uuid,
      v_opportunity.lifecycle_cycle,
      null::uuid, null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_current_count = 0 then
    if v_history_count > 0 then
      return query select
        'stale'::text,
        'final_condition_superseded_by_renegotiation'::text,
        null::uuid,
        v_opportunity.lifecycle_cycle,
        v_opportunity.current_negotiation_cycle_id,
        null::uuid, null::uuid, null::uuid, null::text;
    elsif v_negotiated_close_count > 0 then
      return query select
        'conflict'::text,
        'negotiated_close_final_condition_missing'::text,
        null::uuid,
        v_opportunity.lifecycle_cycle,
        v_opportunity.current_negotiation_cycle_id,
        null::uuid, null::uuid, null::uuid, null::text;
    else
      return query select
        'none'::text,
        'final_condition_missing'::text,
        null::uuid,
        v_opportunity.lifecycle_cycle,
        v_opportunity.current_negotiation_cycle_id,
        null::uuid, null::uuid, null::uuid, null::text;
    end if;
    return;
  end if;

  select condition_row.*
  into v_condition
  from public.commercial_final_conditions condition_row
  where condition_row.organization_id = p_organization_id
    and condition_row.store_id = p_store_id
    and condition_row.commercial_opportunity_id = p_commercial_opportunity_id
    and condition_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
    and condition_row.condition_state = 'current';

  if v_opportunity.stage = 'negociacao' then
    return query select
      'stale'::text,
      'active_renegotiation_invalidates_final_condition'::text,
      v_condition.id,
      v_condition.lifecycle_cycle,
      v_condition.negotiation_cycle_id,
      v_condition.quote_id,
      v_condition.quote_version_id,
      v_condition.acceptance_event_id,
      v_condition.request_fingerprint;
    return;
  end if;

  select event_row.*
  into v_negotiation_event
  from public.commercial_opportunity_lifecycle_events event_row
  where event_row.id = v_condition.negotiation_cycle_id
    and event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
    and event_row.event_type = 'stage_transition'
    and event_row.new_stage = 'negociacao'
    and event_row.reason_code in (
      'concrete_offer_required',
      'concrete_quote_objection_required',
      'visit_viable_concrete_offer_required',
      'renegotiation_required'
    );

  if not found then
    return query select
      'stale'::text,
      'negotiation_cycle_invalid'::text,
      v_condition.id,
      v_condition.lifecycle_cycle,
      v_condition.negotiation_cycle_id,
      v_condition.quote_id,
      v_condition.quote_version_id,
      v_condition.acceptance_event_id,
      v_condition.request_fingerprint;
    return;
  end if;

  select proposal_row.*
  into v_proposal
  from public.p9_resolve_current_commercial_proposal_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) proposal_row;

  if not found
     or v_proposal.proposal_state is distinct from 'available'
     or v_proposal.reason_code is distinct from 'current_proposal_authority_valid'
     or v_proposal.lifecycle_cycle is distinct from v_condition.lifecycle_cycle
     or v_proposal.current_quote_id is distinct from v_condition.quote_id
     or v_proposal.current_quote_version_id is distinct from v_condition.quote_version_id
     or v_proposal.version_status not in ('sent', 'superseded')
     or v_proposal.version_sent_at is null then
    return query select
      'stale'::text,
      'current_proposal_lineage_stale'::text,
      v_condition.id,
      v_condition.lifecycle_cycle,
      v_condition.negotiation_cycle_id,
      v_condition.quote_id,
      v_condition.quote_version_id,
      v_condition.acceptance_event_id,
      v_condition.request_fingerprint;
    return;
  end if;

  select acceptance_row.*
  into v_acceptance
  from public.p9_resolve_current_commercial_proposal_acceptance_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) acceptance_row;

  if not found
     or v_acceptance.acceptance_state is distinct from 'accepted'
     or v_acceptance.reason_code is distinct from 'current_proposal_accepted'
     or v_acceptance.lifecycle_cycle is distinct from v_condition.lifecycle_cycle
     or v_acceptance.current_quote_id is distinct from v_condition.quote_id
     or v_acceptance.current_quote_version_id is distinct from v_condition.quote_version_id
     or v_acceptance.acceptance_event_id is distinct from v_condition.acceptance_event_id then
    return query select
      'stale'::text,
      'acceptance_lineage_stale'::text,
      v_condition.id,
      v_condition.lifecycle_cycle,
      v_condition.negotiation_cycle_id,
      v_condition.quote_id,
      v_condition.quote_version_id,
      v_condition.acceptance_event_id,
      v_condition.request_fingerprint;
    return;
  end if;

  return query select
    'current'::text,
    'final_condition_current'::text,
    v_condition.id,
    v_condition.lifecycle_cycle,
    v_condition.negotiation_cycle_id,
    v_condition.quote_id,
    v_condition.quote_version_id,
    v_condition.acceptance_event_id,
    v_condition.request_fingerprint;
end;
$function$;

alter function public.p9_resolve_current_commercial_final_condition_internal(uuid,uuid,uuid)
  owner to postgres;
revoke all on function public.p9_resolve_current_commercial_final_condition_internal(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.read_current_commercial_final_condition_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  condition_state text,
  reason_code text,
  condition_id uuid,
  lifecycle_cycle integer,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid,
  request_fingerprint text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if v_role is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'P9_FINAL_CONDITION_READER_UNAUTHORIZED';
  end if;

  return query
  select resolved.*
  from public.p9_resolve_current_commercial_final_condition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) resolved;
end;
$function$;

alter function public.read_current_commercial_final_condition_by_system(uuid,uuid,uuid)
  owner to postgres;
revoke all on function public.read_current_commercial_final_condition_by_system(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_current_commercial_final_condition_by_system(uuid,uuid,uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 8. Atomic accepted-negotiated-condition boundary.
-- -----------------------------------------------------------------------------
create or replace function public.p9_materialize_accepted_negotiated_condition_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_negotiation_cycle_id uuid,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_acceptance_event_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_actor_type text,
  p_actor_user_id uuid
)
returns table (
  condition_id uuid,
  condition_state text,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid,
  lifecycle_event_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_request_fingerprint text := nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), '');
  v_actor_type text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_actor_type, '')), ''));

  v_opportunity public.commercial_opportunities%rowtype;
  v_event public.commercial_opportunity_lifecycle_events%rowtype;
  v_proposal record;
  v_acceptance record;
  v_existing public.commercial_final_conditions%rowtype;
  v_condition public.commercial_final_conditions%rowtype;
  v_transition record;
  v_existing_transition public.commercial_opportunity_lifecycle_events%rowtype;
  v_baseline jsonb;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_expected_lifecycle_cycle is null
     or p_expected_lifecycle_cycle < 1
     or p_negotiation_cycle_id is null
     or p_quote_id is null
     or p_quote_version_id is null
     or p_acceptance_event_id is null
     or v_operation_key is null
     or pg_catalog.length(v_operation_key) > 200
     or v_request_fingerprint is null
     or pg_catalog.length(v_request_fingerprint) > 256
     or v_actor_type not in ('human', 'system')
     or (v_actor_type = 'human' and p_actor_user_id is null)
     or (v_actor_type = 'system' and p_actor_user_id is not null) then
    raise exception using errcode = '22023', message = 'P9_FINAL_CONDITION_ARGUMENTS_INVALID';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'P9_FINAL_CONDITION_OPPORTUNITY_NOT_FOUND';
  end if;

  -- Idempotent replay is checked before current-stage validation because a
  -- successful first call already moved the opportunity to fechamento_pagamento.
  select condition_row.*
  into v_existing
  from public.commercial_final_conditions condition_row
  where condition_row.organization_id = p_organization_id
    and condition_row.store_id = p_store_id
    and condition_row.operation_key = v_operation_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint
       or v_existing.commercial_opportunity_id is distinct from p_commercial_opportunity_id
       or v_existing.lifecycle_cycle is distinct from p_expected_lifecycle_cycle
       or v_existing.negotiation_cycle_id is distinct from p_negotiation_cycle_id
       or v_existing.quote_id is distinct from p_quote_id
       or v_existing.quote_version_id is distinct from p_quote_version_id
       or v_existing.acceptance_event_id is distinct from p_acceptance_event_id then
      raise exception using errcode = '23505', message = 'P9_FINAL_CONDITION_OPERATION_KEY_REUSED';
    end if;

    select event_row.*
    into v_existing_transition
    from public.commercial_opportunity_lifecycle_events event_row
    where event_row.organization_id = p_organization_id
      and event_row.store_id = p_store_id
      and event_row.commercial_opportunity_id = p_commercial_opportunity_id
      and event_row.lifecycle_cycle = p_expected_lifecycle_cycle
      and event_row.idempotency_key = v_operation_key
      and event_row.event_type = 'stage_transition'
      and event_row.previous_stage = 'negociacao'
      and event_row.new_stage = 'fechamento_pagamento'
      and event_row.reason_code = 'accepted_negotiated_condition_required';

    if not found then
      raise exception using errcode = 'P0001', message = 'P9_FINAL_CONDITION_REPLAY_TRANSITION_MISSING';
    end if;

    return query select
      v_existing.id,
      v_existing.condition_state,
      v_existing.negotiation_cycle_id,
      v_existing.quote_id,
      v_existing.quote_version_id,
      v_existing.acceptance_event_id,
      v_existing_transition.id,
      true;
    return;
  end if;

  if v_opportunity.stage is distinct from 'negociacao'
     or v_opportunity.lifecycle_cycle is distinct from p_expected_lifecycle_cycle then
    raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_STAGE_OR_LIFECYCLE_STALE';
  end if;

  if v_opportunity.current_negotiation_cycle_id is null then
    raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_NEGOTIATION_CYCLE_UNRESOLVED';
  end if;

  if v_opportunity.current_negotiation_cycle_id is distinct from p_negotiation_cycle_id then
    raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_NEGOTIATION_CYCLE_STALE';
  end if;

  select event_row.*
  into v_event
  from public.commercial_opportunity_lifecycle_events event_row
  where event_row.id = p_negotiation_cycle_id
    and event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.lifecycle_cycle = p_expected_lifecycle_cycle
    and event_row.event_type = 'stage_transition'
    and event_row.new_stage = 'negociacao'
    and event_row.reason_code in (
      'concrete_offer_required',
      'concrete_quote_objection_required',
      'visit_viable_concrete_offer_required',
      'renegotiation_required'
    );

  if not found then
    raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_NEGOTIATION_CYCLE_INVALID';
  end if;

  select proposal_row.*
  into v_proposal
  from public.p9_resolve_current_commercial_proposal_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) proposal_row;

  if not found
     or v_proposal.proposal_state is distinct from 'available'
     or v_proposal.reason_code is distinct from 'current_proposal_authority_valid'
     or v_proposal.lifecycle_cycle is distinct from p_expected_lifecycle_cycle
     or v_proposal.current_quote_id is distinct from p_quote_id
     or v_proposal.current_quote_version_id is distinct from p_quote_version_id
     or v_proposal.version_status not in ('sent', 'superseded')
     or v_proposal.version_sent_at is null then
    raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_CURRENT_PROPOSAL_MISMATCH';
  end if;

  select acceptance_row.*
  into v_acceptance
  from public.p9_resolve_current_commercial_proposal_acceptance_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) acceptance_row;

  if not found
     or v_acceptance.acceptance_state is distinct from 'accepted'
     or v_acceptance.reason_code is distinct from 'current_proposal_accepted'
     or v_acceptance.lifecycle_cycle is distinct from p_expected_lifecycle_cycle
     or v_acceptance.current_quote_id is distinct from p_quote_id
     or v_acceptance.current_quote_version_id is distinct from p_quote_version_id
     or v_acceptance.acceptance_event_id is distinct from p_acceptance_event_id then
    raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_ACCEPTANCE_MISMATCH';
  end if;

  -- A post-accept renegotiation must produce a genuinely new accepted proposal.
  -- The immutable baseline prevents Q1/V1/A1 from being reused while it still
  -- happens to be the Current Proposal before Q2 is materialized.
  if v_event.reason_code = 'renegotiation_required' then
    v_baseline := coalesce(v_event.metadata -> 'p9_8_6_renegotiation_baseline', '{}'::jsonb);

    if nullif(v_baseline ->> 'quote_id', '') = p_quote_id::text
       or nullif(v_baseline ->> 'quote_version_id', '') = p_quote_version_id::text
       or nullif(v_baseline ->> 'acceptance_event_id', '') = p_acceptance_event_id::text then
      raise exception using errcode = '23514', message = 'P9_FINAL_CONDITION_RENEGOTIATION_BASELINE_STALE';
    end if;
  end if;

  insert into public.commercial_final_conditions(
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    negotiation_cycle_id,
    quote_id,
    quote_version_id,
    acceptance_event_id,
    condition_state,
    operation_key,
    request_fingerprint
  ) values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_expected_lifecycle_cycle,
    p_negotiation_cycle_id,
    p_quote_id,
    p_quote_version_id,
    p_acceptance_event_id,
    'current',
    v_operation_key,
    v_request_fingerprint
  )
  returning * into v_condition;

  insert into public.commercial_final_condition_transition_authority(
    transaction_id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    condition_id,
    negotiation_cycle_id,
    transition_operation_key
  ) values (
    pg_catalog.txid_current(),
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_condition.id,
    p_negotiation_cycle_id,
    v_operation_key
  );

  select transition_row.*
  into v_transition
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_operation_key,
    'fechamento_pagamento',
    'accepted negotiated condition materialized',
    'accepted_negotiated_condition',
    v_acceptance.source_message_id,
    'accepted negotiated condition',
    'p9_final_commercial_condition',
    'stage_transition',
    v_actor_type,
    p_actor_user_id
  ) transition_row;

  if not found
     or v_transition.stage is distinct from 'fechamento_pagamento'
     or v_transition.lifecycle_cycle is distinct from p_expected_lifecycle_cycle
     or v_transition.reason_code is distinct from 'accepted_negotiated_condition_required'
     or v_transition.lifecycle_event_id is null then
    raise exception using errcode = 'P0001', message = 'P9_FINAL_CONDITION_STAGE_TRANSITION_CONTRACT_MISMATCH';
  end if;

  delete from public.commercial_final_condition_transition_authority authority_row
  where authority_row.transaction_id = pg_catalog.txid_current()
    and authority_row.organization_id = p_organization_id
    and authority_row.store_id = p_store_id
    and authority_row.commercial_opportunity_id = p_commercial_opportunity_id
    and authority_row.transition_operation_key = v_operation_key;

  return query select
    v_condition.id,
    v_condition.condition_state,
    v_condition.negotiation_cycle_id,
    v_condition.quote_id,
    v_condition.quote_version_id,
    v_condition.acceptance_event_id,
    v_transition.lifecycle_event_id,
    false;
end;
$function$;

alter function public.p9_materialize_accepted_negotiated_condition_internal(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,text,uuid
) owner to postgres;
revoke all on function public.p9_materialize_accepted_negotiated_condition_internal(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,text,uuid
) from public, anon, authenticated, service_role;

create or replace function public.materialize_accepted_negotiated_condition_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_negotiation_cycle_id uuid,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_acceptance_event_id uuid,
  p_operation_key text,
  p_request_fingerprint text
)
returns table (
  condition_id uuid,
  condition_state text,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid,
  lifecycle_event_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if v_role is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'P9_FINAL_CONDITION_SYSTEM_UNAUTHORIZED';
  end if;

  return query
  select result_row.*
  from public.p9_materialize_accepted_negotiated_condition_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_expected_lifecycle_cycle,
    p_negotiation_cycle_id,
    p_quote_id,
    p_quote_version_id,
    p_acceptance_event_id,
    p_operation_key,
    p_request_fingerprint,
    'system',
    null
  ) result_row;
end;
$function$;

create or replace function public.materialize_accepted_negotiated_condition_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_negotiation_cycle_id uuid,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_acceptance_event_id uuid,
  p_operation_key text,
  p_request_fingerprint text
)
returns table (
  condition_id uuid,
  condition_state text,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid,
  lifecycle_event_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if v_user_id is null
     or v_role is distinct from 'authenticated'
     or not exists (
       select 1
       from public.memberships membership_row
       where membership_row.organization_id = p_request_organization_id
         and membership_row.user_id = v_user_id
         and membership_row.is_active is true
     ) then
    raise exception using errcode = '42501', message = 'P9_FINAL_CONDITION_USER_UNAUTHORIZED';
  end if;

  return query
  select result_row.*
  from public.p9_materialize_accepted_negotiated_condition_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_expected_lifecycle_cycle,
    p_negotiation_cycle_id,
    p_quote_id,
    p_quote_version_id,
    p_acceptance_event_id,
    p_operation_key,
    p_request_fingerprint,
    'human',
    v_user_id
  ) result_row;
end;
$function$;

alter function public.materialize_accepted_negotiated_condition_by_system(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text
) owner to postgres;
alter function public.materialize_accepted_negotiated_condition_by_user(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text
) owner to postgres;

revoke all on function public.materialize_accepted_negotiated_condition_by_system(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text
) from public, anon, authenticated, service_role;
revoke all on function public.materialize_accepted_negotiated_condition_by_user(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_accepted_negotiated_condition_by_system(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text
) to service_role;
grant execute on function public.materialize_accepted_negotiated_condition_by_user(
  uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text
) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Preserve the existing readiness authority under a private backup name, then
--    replace the original function in-place. CREATE OR REPLACE preserves the OID
--    used by existing callers; no downstream caller can bypass the 8.6 wrapper by
--    retaining a dependency on a renamed object.
-- -----------------------------------------------------------------------------
do $clone_readiness$
declare
  v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'CREATE OR REPLACE FUNCTION public.p9_resolve_commercial_action_readiness_internal',
    'CREATE OR REPLACE FUNCTION public.p9_readiness_v2_pre_final_condition'
  );

  execute v_definition;
end;
$clone_readiness$;

alter function public.p9_readiness_v2_pre_final_condition(uuid,uuid,uuid,text)
  owner to postgres;
revoke all on function public.p9_readiness_v2_pre_final_condition(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create or replace function public.p9_resolve_commercial_action_readiness_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_action_key text
)
returns table (
  action_key text,
  readiness_state text,
  reason_code text,
  blocking_items jsonb,
  readiness_basis jsonb,
  authority_fingerprint text,
  resolver_key text,
  resolver_version integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public, extensions
set row_security = off
as $function$
declare
  v_base record;
  v_final record;
  v_lifecycle_cycle integer;
  v_requires_final boolean := false;
  v_blocker jsonb;
begin
  select base_row.*
  into v_base
  from public.p9_readiness_v2_pre_final_condition(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_action_key
  ) base_row;

  if not found then
    raise exception using errcode = 'P0001', message = 'P9_FINAL_CONDITION_BASE_READINESS_MISSING';
  end if;

  if p_action_key = 'create_contract' then
    select opportunity_row.lifecycle_cycle
    into v_lifecycle_cycle
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'P9_ACTION_READINESS_OPPORTUNITY_NOT_FOUND';
    end if;

    select
      exists (
        select 1
        from public.commercial_final_conditions condition_row
        where condition_row.organization_id = p_organization_id
          and condition_row.store_id = p_store_id
          and condition_row.commercial_opportunity_id = p_commercial_opportunity_id
          and condition_row.lifecycle_cycle = v_lifecycle_cycle
      )
      or exists (
        select 1
        from public.commercial_opportunity_lifecycle_events event_row
        where event_row.organization_id = p_organization_id
          and event_row.store_id = p_store_id
          and event_row.commercial_opportunity_id = p_commercial_opportunity_id
          and event_row.lifecycle_cycle = v_lifecycle_cycle
          and event_row.event_type = 'stage_transition'
          and event_row.previous_stage = 'negociacao'
          and event_row.new_stage = 'fechamento_pagamento'
          and event_row.reason_code = 'accepted_negotiated_condition_required'
      )
    into v_requires_final;

    if v_requires_final then
      select final_row.*
      into v_final
      from public.p9_resolve_current_commercial_final_condition_internal(
        p_organization_id,
        p_store_id,
        p_commercial_opportunity_id
      ) final_row;

      v_base.readiness_basis := coalesce(v_base.readiness_basis, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'final_condition_required', true,
          'final_condition_state', coalesce(v_final.condition_state, 'missing'),
          'final_condition_reason_code', v_final.reason_code,
          'final_condition_id', v_final.condition_id,
          'final_condition_negotiation_cycle_id', v_final.negotiation_cycle_id,
          'final_condition_quote_id', v_final.quote_id,
          'final_condition_quote_version_id', v_final.quote_version_id,
          'final_condition_acceptance_event_id', v_final.acceptance_event_id
        );

      if not found or v_final.condition_state is distinct from 'current' then
        v_blocker := pg_catalog.jsonb_build_object(
          'item_key', 'final_commercial_condition',
          'condition_state', coalesce(v_final.condition_state, 'missing'),
          'reason_code', coalesce(v_final.reason_code, 'final_condition_missing')
        );

        v_base.blocking_items := coalesce(v_base.blocking_items, '[]'::jsonb)
          || pg_catalog.jsonb_build_array(v_blocker);

        if v_base.readiness_state = 'ready' then
          v_base.readiness_state := 'blocked';
          v_base.reason_code := 'create_contract_final_condition_missing_or_stale';
        end if;
      end if;

      -- Keep the returned state/reason/blockers and the hashed basis coherent.
      v_base.readiness_basis := coalesce(v_base.readiness_basis, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'readiness_state', v_base.readiness_state,
          'reason_code', v_base.reason_code,
          'blocking_items', coalesce(v_base.blocking_items, '[]'::jsonb)
        );

      v_base.authority_fingerprint := pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(v_base.readiness_basis::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      );
    end if;
  end if;

  return query select
    v_base.action_key,
    v_base.readiness_state,
    v_base.reason_code,
    v_base.blocking_items,
    v_base.readiness_basis,
    v_base.authority_fingerprint,
    v_base.resolver_key,
    v_base.resolver_version;
end;
$function$;

alter function public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)
  owner to postgres;
revoke all on function public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Preserve and wrap contract downstream lineage in-place.
-- -----------------------------------------------------------------------------
do $clone_lineage$
declare
  v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'::pg_catalog.regprocedure
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'CREATE OR REPLACE FUNCTION public.p9_assert_sales_contract_current_proposal_lineage_internal',
    'CREATE OR REPLACE FUNCTION public.p9_contract_lineage_pre_final_condition'
  );

  execute v_definition;
end;
$clone_lineage$;

alter function public.p9_contract_lineage_pre_final_condition(uuid,uuid,uuid)
  owner to postgres;
revoke all on function public.p9_contract_lineage_pre_final_condition(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.p9_assert_sales_contract_current_proposal_lineage_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid
)
returns table (
  guard_state text,
  commercial_opportunity_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_base record;
  v_final record;
  v_lifecycle_cycle integer;
  v_requires_final boolean := false;
begin
  select base_row.*
  into v_base
  from public.p9_contract_lineage_pre_final_condition(
    p_organization_id,
    p_store_id,
    p_contract_id
  ) base_row;

  if not found then
    raise exception using errcode = 'P0001', message = 'P9_FINAL_CONDITION_BASE_LINEAGE_MISSING';
  end if;

  if v_base.commercial_opportunity_id is not null then
    select opportunity_row.lifecycle_cycle
    into v_lifecycle_cycle
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_base.commercial_opportunity_id
      and opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'P9_FINAL_CONDITION_CONTRACT_OPPORTUNITY_NOT_FOUND';
    end if;

    select
      exists (
        select 1
        from public.commercial_final_conditions condition_row
        where condition_row.organization_id = p_organization_id
          and condition_row.store_id = p_store_id
          and condition_row.commercial_opportunity_id = v_base.commercial_opportunity_id
          and condition_row.lifecycle_cycle = v_lifecycle_cycle
      )
      or exists (
        select 1
        from public.commercial_opportunity_lifecycle_events event_row
        where event_row.organization_id = p_organization_id
          and event_row.store_id = p_store_id
          and event_row.commercial_opportunity_id = v_base.commercial_opportunity_id
          and event_row.lifecycle_cycle = v_lifecycle_cycle
          and event_row.event_type = 'stage_transition'
          and event_row.previous_stage = 'negociacao'
          and event_row.new_stage = 'fechamento_pagamento'
          and event_row.reason_code = 'accepted_negotiated_condition_required'
      )
    into v_requires_final;

    if v_requires_final then
      select final_row.*
      into v_final
      from public.p9_resolve_current_commercial_final_condition_internal(
        p_organization_id,
        p_store_id,
        v_base.commercial_opportunity_id
      ) final_row;

      if not found
         or v_final.condition_state is distinct from 'current'
         or v_final.quote_id is distinct from v_base.quote_id
         or v_final.quote_version_id is distinct from v_base.quote_version_id
         or v_final.acceptance_event_id is distinct from v_base.acceptance_event_id then
        raise exception using errcode = 'P0001', message = 'P9_FINAL_COMMERCIAL_CONDITION_STALE';
      end if;
    end if;
  end if;

  return query select
    v_base.guard_state,
    v_base.commercial_opportunity_id,
    v_base.quote_id,
    v_base.quote_version_id,
    v_base.acceptance_event_id;
end;
$function$;

alter function public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)
  owner to postgres;
revoke all on function public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. Postconditions.
-- -----------------------------------------------------------------------------
do $postconditions$
declare
  v_definition text;
  v_prosecdef boolean;
  v_volatility "char";
begin
  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    where class_row.oid = 'public.commercial_final_conditions'::pg_catalog.regclass
      and class_row.relrowsecurity
      and class_row.relforcerowsecurity
  ) then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: final condition RLS/force missing';
  end if;

  if pg_catalog.has_table_privilege('authenticated','public.commercial_final_conditions','INSERT')
     or pg_catalog.has_table_privilege('service_role','public.commercial_final_conditions','INSERT')
     or pg_catalog.has_table_privilege('authenticated','public.commercial_final_condition_transition_authority','INSERT')
     or pg_catalog.has_table_privilege('service_role','public.commercial_final_condition_transition_authority','INSERT') then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: direct table write privilege leaked';
  end if;

  if pg_catalog.to_regprocedure(
       'public.materialize_accepted_negotiated_condition_by_system(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.materialize_accepted_negotiated_condition_by_user(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_current_commercial_final_condition_by_system(uuid,uuid,uuid)'
     ) is null then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: public wrappers missing';
  end if;

  select proc_row.prosecdef, proc_row.provolatile
  into v_prosecdef, v_volatility
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = 'public.p9_resolve_current_commercial_final_condition_internal(uuid,uuid,uuid)'::pg_catalog.regprocedure;

  if v_prosecdef is distinct from true or v_volatility is distinct from 's'::"char" then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: final resolver hardening mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.p9_resolve_current_commercial_final_condition_internal(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.p9_resolve_current_commercial_final_condition_internal(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: private resolver execute leaked';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_opportunity_lifecycle_events'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_final_condition_negotiated_close_guard'
      and not trigger_row.tgisinternal
  )
  or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_opportunity_lifecycle_events'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_final_condition_renegotiation_baseline'
      and not trigger_row.tgisinternal
  )
  or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_opportunity_lifecycle_events'::pg_catalog.regclass
      and trigger_row.tgname = 'p9_final_condition_cycle_projection'
      and not trigger_row.tgisinternal
  ) then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: lifecycle guards missing';
  end if;

  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
  ));
  if pg_catalog.strpos(v_definition, 'p9_resolve_current_commercial_final_condition_internal') = 0
     or pg_catalog.strpos(v_definition, 'p9_readiness_v2_pre_final_condition') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: readiness wrapper missing final-condition authority';
  end if;

  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'::pg_catalog.regprocedure
  ));
  if pg_catalog.strpos(v_definition, 'p9_resolve_current_commercial_final_condition_internal') = 0
     or pg_catalog.strpos(v_definition, 'p9_contract_lineage_pre_final_condition') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: contract-lineage wrapper missing final-condition authority';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.materialize_accepted_negotiated_condition_by_system(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'public.materialize_accepted_negotiated_condition_by_user(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001', message = 'P9_8_6 postcondition: wrapper grants missing';
  end if;
end;
$postconditions$;

commit;
