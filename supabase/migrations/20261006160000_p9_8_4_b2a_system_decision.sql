begin;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261006160000_p9_8_4_b2a_system_decision',
    0
  )
);
do $preflight$
declare
  v_authority_status_def text;
  v_authority_approval_def text;
begin
  if pg_catalog.to_regclass('public.commercial_negotiation_concessions') is null
     or pg_catalog.to_regclass('auth.users') is null
     or pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(jsonb)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2A_PRECONDITIONS_MISSING';
  end if;
  select pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid))
    into v_authority_status_def
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
          'public.commercial_negotiation_concessions'::pg_catalog.regclass
    and constraint_row.conname =
          'commercial_negotiation_concessions_authority_status_check';
  select pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid))
    into v_authority_approval_def
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
          'public.commercial_negotiation_concessions'::pg_catalog.regclass
    and constraint_row.conname =
          'commercial_negotiation_concessions_authority_approval_check';
  if v_authority_status_def is null
     or v_authority_status_def not like '%authority_decision%'
     or v_authority_status_def not like '%authorized%'
     or v_authority_approval_def is null
     or v_authority_approval_def not like '%authority_decision%'
     or v_authority_approval_def not like '%approval_status%' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2A_EXPECTED_AUTHORITY_CONSTRAINTS_CHANGED';
  end if;
end;
$preflight$;
alter table public.commercial_negotiation_concessions
  add column if not exists effective_decision text null;
alter table public.commercial_negotiation_concessions
  drop constraint commercial_negotiation_concessions_authority_status_check,
  drop constraint commercial_negotiation_concessions_authority_approval_check;
alter table public.commercial_negotiation_concessions
  add constraint commercial_negotiation_concessions_effective_decision_check
  check (
    effective_decision is null
    or effective_decision in (
      'allowed',
      'human_approval_required',
      'blocked',
      'unconfigured'
    )
  ),
  add constraint commercial_negotiation_concessions_effective_decision_state_check
  check (
    status not in (
      'proposed',
      'pending_human_approval',
      'authorized',
      'materialized',
      'rejected'
    )
    or (
      status = 'proposed'
      and effective_decision is null
    )
    or (
      status = 'pending_human_approval'
      and effective_decision = 'human_approval_required'
    )
    or (
      status in ('authorized', 'materialized')
      and effective_decision = 'allowed'
    )
    or (
      status = 'rejected'
      and effective_decision in ('blocked', 'unconfigured')
    )
  ),
  add constraint commercial_negotiation_concessions_authority_status_check
  check (
    effective_decision not in ('blocked', 'unconfigured')
    or status not in ('authorized', 'materialized')
  ),
  add constraint commercial_negotiation_concessions_authority_approval_check
  check (
    effective_decision <> 'human_approval_required'
    or status not in ('authorized', 'materialized')
    or (
      approval_status = 'approved'
      and approval_actor_user_id is not null
      and approval_decided_at is not null
    )
  );
create unique index commercial_negotiation_concessions_id_scope_cycle_uidx
  on public.commercial_negotiation_concessions (
    id,
    commercial_opportunity_id,
    negotiation_cycle_id,
    organization_id,
    store_id
  );
create table public.commercial_negotiation_concession_decision_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  negotiation_cycle_id uuid not null,
  concession_id uuid not null,
  decision_kind text not null,
  from_status text not null,
  to_status text not null,
  effective_decision text not null,
  operation_key text not null,
  request_fingerprint text not null,
  actor_kind text not null,
  actor_user_id uuid null,
  reason_code text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint commercial_negotiation_concession_decision_events_scope_fkey
    foreign key (
      concession_id,
      commercial_opportunity_id,
      negotiation_cycle_id,
      organization_id,
      store_id
    )
    references public.commercial_negotiation_concessions (
      id,
      commercial_opportunity_id,
      negotiation_cycle_id,
      organization_id,
      store_id
    )
    on delete restrict,
  constraint commercial_negotiation_concession_decision_events_actor_user_fkey
    foreign key (actor_user_id)
    references auth.users(id)
    on delete restrict,
  constraint commercial_negotiation_concession_decision_events_kind_check
    check (decision_kind in ('system_decision', 'human_decision')),
  constraint commercial_negotiation_concession_decision_events_transition_check
    check (
      decision_kind <> 'system_decision'
      or (
        from_status = 'proposed'
        and to_status in ('authorized', 'pending_human_approval', 'rejected')
      )
    ),
  constraint commercial_negotiation_concession_decision_events_actor_check
    check (actor_kind in ('system', 'human')),
  constraint commercial_negotiation_concession_decision_events_kind_actor_check
    check (
      (decision_kind = 'system_decision' and actor_kind = 'system')
      or (decision_kind = 'human_decision' and actor_kind = 'human')
    ),
  constraint commercial_negotiation_concession_decision_events_system_actor_check
    check (actor_kind <> 'system' or actor_user_id is null),
  constraint commercial_negotiation_concession_decision_events_human_actor_check
    check (actor_kind <> 'human' or actor_user_id is not null),
  constraint commercial_negotiation_concession_decision_events_effective_check
    check (effective_decision in ('allowed', 'human_approval_required', 'blocked', 'unconfigured')),
  constraint commercial_negotiation_concession_decision_events_effective_status_check
    check (
      (to_status = 'authorized' and effective_decision = 'allowed')
      or (to_status = 'pending_human_approval' and effective_decision = 'human_approval_required')
      or (to_status = 'rejected' and effective_decision in ('blocked', 'unconfigured'))
      or to_status not in ('authorized', 'pending_human_approval', 'rejected')
    ),
  constraint commercial_negotiation_concession_decision_events_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint commercial_negotiation_concession_decision_events_operation_key_check
    check (operation_key = pg_catalog.btrim(operation_key) and pg_catalog.length(operation_key) between 1 and 200),
  constraint commercial_negotiation_concession_decision_events_reason_check
    check (pg_catalog.length(pg_catalog.btrim(reason_code)) > 0)
);
alter table public.commercial_negotiation_concession_decision_events owner to postgres;
create or replace function public.p9_prevent_commercial_negotiation_concession_decision_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'P9_8_4_DECISION_EVENTS_APPEND_ONLY';
end;
$function$;
alter function public.p9_prevent_commercial_negotiation_concession_decision_event_mutation()
  owner to postgres;
revoke all on function public.p9_prevent_commercial_negotiation_concession_decision_event_mutation()
  from public, anon, authenticated, service_role;
create or replace function public.p9_prevent_commercial_negotiation_concession_decision_event_truncate()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'P9_8_4_DECISION_EVENTS_APPEND_ONLY';
end;
$function$;
alter function public.p9_prevent_commercial_negotiation_concession_decision_event_truncate()
  owner to postgres;
revoke all on function public.p9_prevent_commercial_negotiation_concession_decision_event_truncate()
  from public, anon, authenticated, service_role;
create trigger commercial_negotiation_concession_decision_events_append_only
  before update or delete
  on public.commercial_negotiation_concession_decision_events
  for each row
  execute function public.p9_prevent_commercial_negotiation_concession_decision_event_mutation();
create trigger commercial_negotiation_concession_decision_events_no_truncate
  before truncate
  on public.commercial_negotiation_concession_decision_events
  for each statement
  execute function public.p9_prevent_commercial_negotiation_concession_decision_event_truncate();
create unique index commercial_negotiation_concession_decision_events_operation_uidx
  on public.commercial_negotiation_concession_decision_events (
    organization_id,
    store_id,
    concession_id,
    operation_key
  );
alter table public.commercial_negotiation_concession_decision_events enable row level security;
alter table public.commercial_negotiation_concession_decision_events force row level security;
revoke all on table public.commercial_negotiation_concession_decision_events
from public, anon, authenticated, service_role;
create or replace function public.decide_commercial_negotiation_concession_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_concession_id uuid
)
returns table (
  concession_id uuid,
  status text,
  effective_decision text,
  authority_decision text,
  reason_code text,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  decision_event_id uuid,
  operation_key text,
  request_fingerprint text,
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
  v_now timestamptz;
  v_operation_key text :=
    'commercial_negotiation_concession_system_decision:' || p_concession_id::text;
  v_concession public.commercial_negotiation_concessions%rowtype;
  v_opportunity public.commercial_opportunities%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
  v_proposal record;
  v_event public.commercial_negotiation_concession_decision_events%rowtype;
  v_raw_decision text;
  v_raw_reason text;
  v_hv_state text;
  v_hv_reason text;
  v_effective_decision text;
  v_reason_code text;
  v_to_status text;
  v_payload jsonb;
  v_fingerprint text;
begin
  if v_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'P9_8_4_B2A_SYSTEM_WRITER_NOT_AUTHORIZED';
  end if;
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_concession_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_8_4_B2A_ARGUMENTS_INVALID';
  end if;
  select concession_row.*
    into v_concession
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = p_concession_id
    and concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id
    and concession_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_8_4_B2A_CONCESSION_NOT_FOUND_IN_SCOPE';
  end if;
  select event_row.*
    into v_event
  from public.commercial_negotiation_concession_decision_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.concession_id = p_concession_id
    and event_row.operation_key = v_operation_key
  for update;
  if found then
    v_payload := pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'negotiation_cycle_id', v_concession.negotiation_cycle_id,
      'concession_id', v_concession.id,
      'quote_id', v_concession.quote_id,
      'quote_version_id', v_concession.quote_version_id,
      'from_status', 'proposed',
      'authority_decision', v_concession.authority_decision,
      'authority_snapshot', v_concession.authority_snapshot,
      'high_value', v_concession.high_value,
      'high_value_context', v_concession.high_value_context -> 'resultingDecision',
      'effective_decision', v_event.effective_decision,
      'reason_code', v_event.reason_code,
      'to_status', v_event.to_status
    );
    if v_event.request_fingerprint is distinct from
       public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(v_payload) then
      raise exception using
        errcode = '23505',
        message = 'P9_8_4_B2A_IDEMPOTENCY_KEY_REUSED_DIVERGENT';
    end if;
    return query
    select
      v_concession.id,
      v_event.to_status,
      v_event.effective_decision,
      v_concession.authority_decision,
      v_event.reason_code,
      v_concession.negotiation_cycle_id,
      v_concession.quote_id,
      v_concession.quote_version_id,
      v_event.id,
      v_event.operation_key,
      v_event.request_fingerprint,
      true;
    return;
  end if;
  if v_concession.status is distinct from 'proposed' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_CONCESSION_NOT_PROPOSED';
  end if;
  if v_concession.concession_class is distinct from 'normal' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_HUMAN_EXCEPTION_NOT_AUTONOMOUS';
  end if;
  select opportunity_row.*
    into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;
  if not found or v_opportunity.stage is distinct from 'negociacao' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_OPPORTUNITY_STALE';
  end if;
  if not exists (
    select 1
    from public.commercial_opportunity_lifecycle_events lifecycle_row
    where lifecycle_row.id = v_concession.negotiation_cycle_id
      and lifecycle_row.organization_id = p_organization_id
      and lifecycle_row.store_id = p_store_id
      and lifecycle_row.commercial_opportunity_id = p_commercial_opportunity_id
      and lifecycle_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
      and lifecycle_row.event_type = 'stage_transition'
      and lifecycle_row.new_stage = 'negociacao'
      and lifecycle_row.reason_code in (
        'concrete_offer_required',
        'concrete_quote_objection_required',
        'visit_viable_concrete_offer_required',
        'renegotiation_required'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_NEGOTIATION_CYCLE_STALE';
  end if;
  select quote_row.*
    into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = v_concession.quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_QUOTE_STALE';
  end if;
  select version_row.*
    into v_version
  from public.sales_quote_versions version_row
  where version_row.id = v_concession.quote_version_id
    and version_row.quote_id = v_concession.quote_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id
  for update;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_QUOTE_VERSION_STALE';
  end if;
  select proposal.*
    into v_proposal
  from public.p9_resolve_current_commercial_proposal_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) proposal;
  if not found
     or v_proposal.proposal_state is distinct from 'available'
     or v_proposal.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
     or v_proposal.current_quote_id is distinct from v_concession.quote_id
     or v_proposal.current_quote_version_id is distinct from v_concession.quote_version_id
     or v_proposal.version_status not in ('sent', 'superseded')
     or v_proposal.version_sent_at is null
     or v_proposal.reason_code is distinct from 'current_proposal_authority_valid' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_CURRENT_PROPOSAL_STALE';
  end if;
  v_raw_decision := v_concession.authority_decision;
  v_raw_reason := nullif(pg_catalog.btrim(coalesce(v_concession.authority_snapshot ->> 'reasonCode', '')), '');
  if v_raw_reason is null then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_AUTHORITY_REASON_REQUIRED';
  end if;
  if v_concession.authority_snapshot ->> 'state' is distinct from v_raw_decision then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_AUTHORITY_SNAPSHOT_INCONSISTENT';
  end if;
  if v_concession.high_value is not true then
    v_effective_decision := v_raw_decision;
    v_reason_code := v_raw_reason;
  else
    v_hv_state := nullif(pg_catalog.btrim(coalesce(v_concession.high_value_context #>> '{resultingDecision,state}', '')), '');
    v_hv_reason := nullif(pg_catalog.btrim(coalesce(v_concession.high_value_context #>> '{resultingDecision,reasonCode}', '')), '');
    if v_hv_state not in ('allowed', 'human_approval_required')
       or v_hv_reason is null then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B2A_HIGH_VALUE_CONTEXT_INVALID';
    end if;
    if v_hv_state = 'allowed' then
      if v_raw_decision = 'allowed' then
        v_effective_decision := 'allowed';
      elsif v_raw_decision = 'human_approval_required'
            and v_raw_reason = 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_REQUIRES_APPROVAL' then
        v_effective_decision := 'allowed';
      elsif v_raw_decision = 'human_approval_required' then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B2A_HIGH_VALUE_COMBINATION_INVALID';
      elsif v_raw_decision = 'blocked'
            and v_raw_reason = 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED' then
        v_effective_decision := 'allowed';
      else
        v_effective_decision := v_raw_decision;
      end if;
    else
      if v_raw_decision in ('allowed', 'human_approval_required') then
        v_effective_decision := 'human_approval_required';
      elsif v_raw_decision = 'blocked'
            and v_raw_reason = 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED' then
        v_effective_decision := 'human_approval_required';
      else
        v_effective_decision := v_raw_decision;
      end if;
    end if;
    v_reason_code := case
      when v_effective_decision in ('allowed', 'human_approval_required')
        then v_hv_reason
      else v_raw_reason
    end;
  end if;
  if v_effective_decision not in ('allowed', 'human_approval_required', 'blocked', 'unconfigured') then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B2A_EFFECTIVE_DECISION_INVALID';
  end if;
  v_to_status := case v_effective_decision
    when 'allowed' then 'authorized'
    when 'human_approval_required' then 'pending_human_approval'
    else 'rejected'
  end;
  v_now := pg_catalog.clock_timestamp();
  update public.commercial_negotiation_concessions concession_row
  set
    status = v_to_status,
    effective_decision = v_effective_decision,
    approval_status = case
      when v_to_status = 'pending_human_approval' then 'pending'
      else 'not_required'
    end,
    approval_requested_at = case
      when v_to_status = 'pending_human_approval' then v_now
      else null
    end,
    approval_decided_at = null,
    approval_expires_at = null,
    approval_actor_user_id = null,
    approval_reason = null,
    approval_reference = null,
    authorized_at = case when v_to_status = 'authorized' then v_now else null end,
    rejected_at = case when v_to_status = 'rejected' then v_now else null end,
    materialized_at = null,
    concession_number = null,
    updated_at = v_now
  where concession_row.id = v_concession.id
    and concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id
    and concession_row.status = 'proposed';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'P9_8_4_B2A_CONCESSION_TRANSITION_LOST';
  end if;
  v_payload := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'negotiation_cycle_id', v_concession.negotiation_cycle_id,
    'concession_id', v_concession.id,
    'quote_id', v_concession.quote_id,
    'quote_version_id', v_concession.quote_version_id,
    'from_status', 'proposed',
    'authority_decision', v_raw_decision,
    'authority_snapshot', v_concession.authority_snapshot,
    'high_value', v_concession.high_value,
    'high_value_context', v_concession.high_value_context -> 'resultingDecision',
    'effective_decision', v_effective_decision,
    'reason_code', v_reason_code,
    'to_status', v_to_status
  );
  v_fingerprint := public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(v_payload);
  insert into public.commercial_negotiation_concession_decision_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    negotiation_cycle_id,
    concession_id,
    decision_kind,
    from_status,
    to_status,
    effective_decision,
    operation_key,
    request_fingerprint,
    actor_kind,
    actor_user_id,
    reason_code,
    created_at
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    v_concession.negotiation_cycle_id,
    v_concession.id,
    'system_decision',
    'proposed',
    v_to_status,
    v_effective_decision,
    v_operation_key,
    v_fingerprint,
    'system',
    null,
    v_reason_code,
    v_now
  )
  returning * into v_event;
  return query
  select
    v_concession.id,
    v_to_status,
    v_effective_decision,
    v_raw_decision,
    v_reason_code,
    v_concession.negotiation_cycle_id,
    v_concession.quote_id,
    v_concession.quote_version_id,
    v_event.id,
    v_operation_key,
    v_fingerprint,
    false;
end;
$function$;
alter function public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)
  owner to postgres;
revoke all on function public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)
to service_role;
do $postconditions$
declare
  v_rel record;
  v_has_execute boolean;
  v_is_secure boolean;
  v_owner text;
begin
  if not exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and attname = 'effective_decision'
         and not attisdropped
     )
     or not exists (
       select 1 from pg_catalog.pg_class
       where oid = 'public.commercial_negotiation_concession_decision_events'::pg_catalog.regclass
         and relrowsecurity
         and relforcerowsecurity
     )
     or pg_catalog.to_regprocedure(
       'public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)'
     ) is null
     or exists (
       select 1
       from pg_catalog.pg_proc proc_row
       join pg_catalog.pg_namespace namespace_row
         on namespace_row.oid = proc_row.pronamespace
       where namespace_row.nspname = 'public'
         and proc_row.proname = 'decide_commercial_negotiation_concession_by_human'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.commercial_negotiation_concession_decision_events'::pg_catalog.regclass
         and trigger_row.tgname =
             'commercial_negotiation_concession_decision_events_append_only'
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.commercial_negotiation_concession_decision_events'::pg_catalog.regclass
         and trigger_row.tgname =
             'commercial_negotiation_concession_decision_events_no_truncate'
         and not trigger_row.tgisinternal
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2A_POSTCONDITIONS_FAILED';
  end if;
  select has_function_privilege(
    'service_role',
    'public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)',
    'execute'
  )
  into v_has_execute;
  if not v_has_execute then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2A_SERVICE_ROLE_EXECUTE_MISSING';
  end if;
  select proc_row.prosecdef, role_row.rolname
    into v_is_secure, v_owner
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row on role_row.oid = proc_row.proowner
  where proc_row.oid = pg_catalog.to_regprocedure(
    'public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)'
  );
  if v_is_secure is not true
     or v_owner is distinct from 'postgres'
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row,
            lateral pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
       where proc_row.oid = pg_catalog.to_regprocedure(
         'public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)'
       )
         and config_row = 'row_security=off'
     )
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row,
            lateral pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
       where proc_row.oid = pg_catalog.to_regprocedure(
         'public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)'
       )
         and config_row = 'search_path=pg_catalog, pg_temp, public'
     )
     or has_function_privilege(
          'authenticated',
          'public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)',
          'execute'
        )
     or has_table_privilege(
          'service_role',
          'public.commercial_negotiation_concession_decision_events',
          'INSERT'
        )
     or has_table_privilege(
          'service_role',
          'public.commercial_negotiation_concession_decision_events',
          'UPDATE'
        )
     or has_table_privilege(
          'service_role',
          'public.commercial_negotiation_concession_decision_events',
          'DELETE'
        )
     or has_table_privilege(
          'service_role',
          'public.commercial_negotiation_concession_decision_events',
          'TRUNCATE'
        )
     or has_table_privilege(
          'authenticated',
          'public.commercial_negotiation_concession_decision_events',
          'INSERT'
        )
     or has_table_privilege(
          'authenticated',
          'public.commercial_negotiation_concession_decision_events',
          'UPDATE'
        )
     or has_table_privilege(
          'authenticated',
          'public.commercial_negotiation_concession_decision_events',
          'DELETE'
        )
     or has_table_privilege(
          'authenticated',
          'public.commercial_negotiation_concession_decision_events',
          'TRUNCATE'
        ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2A_ACL_OR_SECURITY_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;
commit;
