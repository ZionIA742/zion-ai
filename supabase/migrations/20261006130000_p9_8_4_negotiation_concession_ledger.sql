begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('20261006130000_p9_8_4_negotiation_concession_ledger', 0)
);

-- ============================================================================
-- P9 / Bloco 8 / Etapa 8.4
-- Negotiation concession ledger foundation.
--
-- This migration only creates the durable ledger and its integrity/security
-- boundaries. It does NOT apply discounts, mutate quotes, create quote versions,
-- materialize concessions, create tasks, or integrate Sales AI.
-- ============================================================================

do $preflight$
begin
  if pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_CONCESSION_LEDGER_PRECONDITION_MISSING';
  end if;
end;
$preflight$;

-- The lifecycle event id is the cycle identity. This scoped support key lets
-- the ledger prove that the referenced event belongs to the same opportunity,
-- organization and store. Semantic validation of the event is enforced by the
-- trigger created below.
create unique index if not exists commercial_opportunity_lifecycle_events_id_scope_uidx
  on public.commercial_opportunity_lifecycle_events (
    id,
    commercial_opportunity_id,
    organization_id,
    store_id
  );

create table public.commercial_negotiation_concessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  commercial_opportunity_id uuid not null,
  negotiation_cycle_id uuid not null,
  quote_id uuid not null,
  quote_version_id uuid not null,

  concession_class text not null,
  concession_kind text not null,
  status text not null,
  concession_number integer null,

  previous_condition jsonb not null default '{}'::jsonb,
  proposed_condition jsonb not null default '{}'::jsonb,
  requested_discount_percent numeric(7,4) not null,
  requested_discount_cents bigint null,
  counterpart_snapshot jsonb not null,
  policy_snapshot jsonb not null,
  authority_snapshot jsonb not null,
  authority_decision text not null,
  high_value boolean not null,
  high_value_context jsonb not null,

  origin text not null,
  source_message_id uuid null,
  operation_key text not null,
  request_fingerprint text not null,

  approval_status text not null default 'not_required',
  approval_requested_at timestamptz null,
  approval_decided_at timestamptz null,
  approval_expires_at timestamptz null,
  approval_actor_user_id uuid null,
  approval_reason text null,
  approval_reference text null,

  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  authorized_at timestamptz null,
  materialized_at timestamptz null,
  rejected_at timestamptz null,
  expired_at timestamptz null,
  superseded_at timestamptz null,

  constraint commercial_negotiation_concessions_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint commercial_negotiation_concessions_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint commercial_negotiation_concessions_opportunity_scope_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint commercial_negotiation_concessions_cycle_scope_fkey
    foreign key (
      negotiation_cycle_id,
      commercial_opportunity_id,
      organization_id,
      store_id
    )
    references public.commercial_opportunity_lifecycle_events(
      id,
      commercial_opportunity_id,
      organization_id,
      store_id
    )
    on delete restrict,

  constraint commercial_negotiation_concessions_quote_scope_fkey
    foreign key (
      quote_id,
      commercial_opportunity_id,
      organization_id,
      store_id
    )
    references public.sales_quotes(
      id,
      commercial_opportunity_id,
      organization_id,
      store_id
    )
    on delete restrict,

  constraint commercial_negotiation_concessions_quote_version_scope_fkey
    foreign key (quote_version_id, quote_id, organization_id, store_id)
    references public.sales_quote_versions(id, quote_id, organization_id, store_id)
    on delete restrict,

  constraint commercial_negotiation_concessions_source_message_fkey
    foreign key (source_message_id)
    references public.messages(id)
    on delete restrict,

  constraint commercial_negotiation_concessions_approval_actor_fkey
    foreign key (approval_actor_user_id)
    references auth.users(id)
    on delete restrict,

  constraint commercial_negotiation_concessions_class_check
    check (concession_class in ('normal', 'human_exception')),

  constraint commercial_negotiation_concessions_kind_check
    check (concession_kind = 'discount'),

  constraint commercial_negotiation_concessions_status_check
    check (
      status in (
        'proposed',
        'pending_human_approval',
        'authorized',
        'materialized',
        'rejected',
        'expired',
        'superseded'
      )
    ),

  constraint commercial_negotiation_concessions_ordinal_check
    check (concession_number is null or concession_number in (1, 2)),

  constraint commercial_negotiation_concessions_ordinal_state_check
    check (
      (
        concession_class = 'normal'
        and (
          (status = 'materialized' and concession_number is not null)
          or (status <> 'materialized' and concession_number is null)
        )
      )
      or (
        concession_class = 'human_exception'
        and concession_number is null
      )
    ),

  constraint commercial_negotiation_concessions_snapshot_object_check
    check (
      pg_catalog.jsonb_typeof(previous_condition) = 'object'
      and pg_catalog.jsonb_typeof(proposed_condition) = 'object'
      and pg_catalog.jsonb_typeof(counterpart_snapshot) = 'object'
      and pg_catalog.jsonb_typeof(policy_snapshot) = 'object'
      and pg_catalog.jsonb_typeof(authority_snapshot) = 'object'
      and pg_catalog.jsonb_typeof(high_value_context) = 'object'
    ),

  -- V1 supports percentage-based discount concessions only. The canonical
  -- transactional authority treats zero as "no discount requested".
  constraint commercial_negotiation_concessions_discount_values_check
    check (
      requested_discount_percent > 0
      and requested_discount_percent <= 100
      and (requested_discount_cents is null or requested_discount_cents >= 0)
    ),

  constraint commercial_negotiation_concessions_authority_decision_check
    check (
      authority_decision in (
        'allowed',
        'human_approval_required',
        'blocked',
        'unconfigured'
      )
    ),

  constraint commercial_negotiation_concessions_origin_check
    check (origin in ('sales_ai', 'human', 'assistant', 'system')),

  constraint commercial_negotiation_concessions_approval_status_check
    check (approval_status in ('not_required', 'pending', 'approved', 'rejected', 'expired')),

  -- Approval field coherence. This does not create an approval workflow; it
  -- only prevents impossible snapshots from being persisted.
  constraint commercial_negotiation_concessions_approval_fields_check
    check (
      (approval_status <> 'pending' or approval_requested_at is not null)
      and (
        approval_status not in ('approved', 'rejected')
        or (
          approval_actor_user_id is not null
          and approval_decided_at is not null
        )
      )
      and (
        approval_status <> 'expired'
        or (
          approval_requested_at is not null
          and approval_expires_at is not null
        )
      )
    ),

  constraint commercial_negotiation_concessions_approval_state_check
    check (
      (approval_status <> 'pending' or status = 'pending_human_approval')
      and (approval_status <> 'approved' or status in ('authorized', 'materialized'))
      and (approval_status <> 'rejected' or status = 'rejected')
      and (approval_status <> 'expired' or status = 'expired')
      and (status <> 'pending_human_approval' or approval_status = 'pending')
    ),

  -- A fail-closed authority state can never become an authorized/materialized
  -- commercial concession.
  constraint commercial_negotiation_concessions_authority_status_check
    check (
      authority_decision not in ('blocked', 'unconfigured')
      or status not in ('authorized', 'materialized')
    ),

  -- If the canonical authority requires a human, authorization/materialization
  -- is only valid after a concrete human approval was recorded.
  constraint commercial_negotiation_concessions_authority_approval_check
    check (
      authority_decision <> 'human_approval_required'
      or status not in ('authorized', 'materialized')
      or (
        approval_status = 'approved'
        and approval_actor_user_id is not null
        and approval_decided_at is not null
      )
    ),

  -- Human exceptions never consume ordinal 1/2 and are never autonomous.
  -- Once authorized/materialized they must carry explicit human approval and
  -- a non-empty reason for the exception.
  constraint commercial_negotiation_concessions_human_exception_approval_check
    check (
      concession_class <> 'human_exception'
      or status not in ('authorized', 'materialized')
      or (
        approval_status = 'approved'
        and approval_actor_user_id is not null
        and approval_decided_at is not null
        and nullif(pg_catalog.btrim(coalesce(approval_reason, '')), '') is not null
      )
    ),

  constraint commercial_negotiation_concessions_status_timestamps_check
    check (
      (status <> 'authorized' or authorized_at is not null)
      and (
        status <> 'materialized'
        or (
          authorized_at is not null
          and materialized_at is not null
        )
      )
      and (status <> 'rejected' or rejected_at is not null)
      and (status <> 'expired' or expired_at is not null)
      and (status <> 'superseded' or superseded_at is not null)
    ),

  constraint commercial_negotiation_concessions_operation_key_check
    check (
      operation_key = pg_catalog.btrim(operation_key)
      and pg_catalog.length(operation_key) between 1 and 200
    ),

  -- Fingerprints are canonical lowercase SHA-256 hex strings. The future writer
  -- uses this to distinguish idempotent replay from divergent key reuse.
  constraint commercial_negotiation_concessions_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$')
);

alter table public.commercial_negotiation_concessions owner to postgres;

comment on table public.commercial_negotiation_concessions is
  'P9 8.4 foundation: concession evaluation/authorization ledger only; it does not apply discounts or mutate quotes.';

comment on column public.commercial_negotiation_concessions.negotiation_cycle_id is
  'Canonical commercial_opportunity_lifecycle_events.id for the material stage_transition into negociacao; semantic guard enforced in DB.';

comment on column public.commercial_negotiation_concessions.counterpart_snapshot is
  'Immutable evaluation snapshot with independent payment_method, higher_down_payment and fewer_installments dimensions; never a live Settings authority.';

comment on column public.commercial_negotiation_concessions.authority_decision is
  'Snapshot of the canonical transactional discount authority state; authorized is not applied.';

create unique index commercial_negotiation_concessions_scope_operation_uidx
  on public.commercial_negotiation_concessions (organization_id, store_id, operation_key);

create unique index commercial_negotiation_concessions_materialized_ordinal_uidx
  on public.commercial_negotiation_concessions (
    organization_id,
    store_id,
    negotiation_cycle_id,
    concession_number
  )
  where concession_class = 'normal'
    and status = 'materialized'
    and concession_number is not null;

create index commercial_negotiation_concessions_opportunity_idx
  on public.commercial_negotiation_concessions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    created_at desc
  );

create index commercial_negotiation_concessions_cycle_idx
  on public.commercial_negotiation_concessions (
    organization_id,
    store_id,
    negotiation_cycle_id,
    created_at desc
  );

create index commercial_negotiation_concessions_status_idx
  on public.commercial_negotiation_concessions (
    organization_id,
    store_id,
    status,
    created_at desc
  );

create index commercial_negotiation_concessions_quote_version_idx
  on public.commercial_negotiation_concessions (
    organization_id,
    store_id,
    quote_id,
    quote_version_id,
    created_at desc
  );

-- Semantic/scoped guard that cannot be expressed as a plain FK/CHECK:
-- 1) negotiation_cycle_id must be the 8.1 material entry into negociacao;
-- 2) source_message_id, when present, must belong to the same organization/store.
create or replace function public.p9_validate_commercial_negotiation_concession_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_cycle public.commercial_opportunity_lifecycle_events%rowtype;
begin
  select event_row.*
  into v_cycle
  from public.commercial_opportunity_lifecycle_events event_row
  where event_row.id = new.negotiation_cycle_id
    and event_row.commercial_opportunity_id = new.commercial_opportunity_id
    and event_row.organization_id = new.organization_id
    and event_row.store_id = new.store_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_NEGOTIATION_CYCLE_OUT_OF_SCOPE';
  end if;

  if v_cycle.event_type is distinct from 'stage_transition'
     or v_cycle.new_stage is distinct from 'negociacao'
     or v_cycle.reason_code not in (
       'concrete_offer_required',
       'concrete_quote_objection_required',
       'visit_viable_concrete_offer_required',
       'renegotiation_required'
     ) then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_NEGOTIATION_CYCLE_NOT_MATERIAL_ENTRY';
  end if;

  if new.source_message_id is not null then
    perform 1
    from public.messages message_row
    where message_row.id = new.source_message_id
      and message_row.organization_id = new.organization_id
      and message_row.store_id = new.store_id;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_SOURCE_MESSAGE_OUT_OF_SCOPE';
    end if;
  end if;

  return new;
end;
$function$;

alter function public.p9_validate_commercial_negotiation_concession_scope()
  owner to postgres;

revoke all on function public.p9_validate_commercial_negotiation_concession_scope()
  from public, anon, authenticated, service_role;

create trigger commercial_negotiation_concessions_scope_guard
before insert or update of
  organization_id,
  store_id,
  commercial_opportunity_id,
  negotiation_cycle_id,
  source_message_id
on public.commercial_negotiation_concessions
for each row
execute function public.p9_validate_commercial_negotiation_concession_scope();

create or replace function public.p9_touch_commercial_negotiation_concessions_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.p9_touch_commercial_negotiation_concessions_updated_at()
  owner to postgres;

revoke all on function public.p9_touch_commercial_negotiation_concessions_updated_at()
  from public, anon, authenticated, service_role;

create trigger commercial_negotiation_concessions_touch_updated_at
before update on public.commercial_negotiation_concessions
for each row
execute function public.p9_touch_commercial_negotiation_concessions_updated_at();

alter table public.commercial_negotiation_concessions enable row level security;
alter table public.commercial_negotiation_concessions force row level security;

revoke all on table public.commercial_negotiation_concessions
  from public, anon, authenticated, service_role;

-- Foundation intentionally exposes no direct table access and no productive
-- RPC. Readers/writers are added in the next 8.4 slice.

do $postconditions$
declare
  v_rls boolean;
  v_force_rls boolean;
  v_required_constraints integer;
begin
  if pg_catalog.to_regclass('public.commercial_negotiation_concessions') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_POSTCONDITION_LEDGER_MISSING';
  end if;

  select class_row.relrowsecurity, class_row.relforcerowsecurity
  into v_rls, v_force_rls
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname = 'commercial_negotiation_concessions';

  if not coalesce(v_rls, false) or not coalesce(v_force_rls, false) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_POSTCONDITION_RLS_MISMATCH';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_negotiation_concessions',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_negotiation_concessions',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_negotiation_concessions',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_negotiation_concessions',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_negotiation_concessions',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_negotiation_concessions',
       'DELETE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_POSTCONDITION_DIRECT_DML_EXPOSED';
  end if;

  select pg_catalog.count(*)::integer
  into v_required_constraints
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
    and constraint_row.conname in (
      'commercial_negotiation_concessions_ordinal_state_check',
      'commercial_negotiation_concessions_discount_values_check',
      'commercial_negotiation_concessions_approval_fields_check',
      'commercial_negotiation_concessions_approval_state_check',
      'commercial_negotiation_concessions_authority_status_check',
      'commercial_negotiation_concessions_authority_approval_check',
      'commercial_negotiation_concessions_human_exception_approval_check',
      'commercial_negotiation_concessions_operation_key_check',
      'commercial_negotiation_concessions_fingerprint_check'
    );

  if v_required_constraints <> 9 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_POSTCONDITION_CONSTRAINTS_MISSING';
  end if;

  if pg_catalog.to_regclass('public.commercial_negotiation_concessions_scope_operation_uidx') is null
     or pg_catalog.to_regclass('public.commercial_negotiation_concessions_materialized_ordinal_uidx') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_POSTCONDITION_UNIQUE_INDEX_MISSING';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_validate_commercial_negotiation_concession_scope()'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and trigger_row.tgname = 'commercial_negotiation_concessions_scope_guard'
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled <> 'D'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_POSTCONDITION_CYCLE_GUARD_MISSING';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_touch_commercial_negotiation_concessions_updated_at()'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and trigger_row.tgname = 'commercial_negotiation_concessions_touch_updated_at'
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled <> 'D'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_POSTCONDITION_UPDATED_AT_TRIGGER_MISSING';
  end if;
end;
$postconditions$;

commit;
