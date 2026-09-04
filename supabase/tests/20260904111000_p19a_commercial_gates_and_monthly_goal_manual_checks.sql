-- Manual checks for 20260904110000_p19a_commercial_gates_and_monthly_goal.sql.
-- Execute only after explicit authorization to apply/run SQL.
-- No persistent fixtures: every behavioral section must run inside BEGIN/ROLLBACK.
-- Do not create organization_memberships for nonexistent auth.users UUIDs.

begin;

-- 1. Schema exists.
select
  to_regclass('public.store_monthly_sales_goals') is not null as has_monthly_goal_table,
  to_regclass('public.commercial_opportunity_payment_events') is not null as has_payment_events_table,
  to_regclass('public.commercial_opportunity_payment_current') is not null as has_payment_current_table;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sales_quote_versions'
  and column_name = 'quote_kind';

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.sales_quote_versions'::regclass
  and conname = 'sales_quote_versions_quote_kind_chk';

select
  p.proname,
  pg_get_function_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as result,
  p.prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'upsert_store_monthly_sales_goal_scoped',
    'record_commercial_opportunity_payment_by_user',
    'p9_resolve_payment_progress_internal',
    'p9_resolve_definitive_quote_progress_internal',
    'read_quote_kind_send_readiness_scoped'
  )
order by p.proname;

-- 2. Quote compatibility matrix.
-- Use an existing authorized org/store/opportunity fixture, or create complete
-- org/store/opportunity/quote rows in this transaction only.
-- Required assertions:
--   legacy quote_kind null + sent current version:
--     p9_resolve_quote_progress_internal => completed
--     p9_resolve_definitive_quote_progress_internal => in_progress
--   preliminary + sent current version:
--     p9_resolve_quote_progress_internal => completed
--     p9_resolve_definitive_quote_progress_internal => in_progress
--   definitive + sent current version:
--     p9_resolve_quote_progress_internal => completed
--     p9_resolve_definitive_quote_progress_internal => completed
--   quote_kind null:
--     read_quote_kind_send_readiness_scoped => legacy_quote_kind_send

-- 3. Technical-visit matrix for explicit quote kind readiness.
-- Required assertions:
--   technical_visit required + incomplete + definitive:
--     read_quote_kind_send_readiness_scoped => blocked,
--     definitive_quote_requires_completed_technical_visit
--   technical_visit required + completed + definitive:
--     read_quote_kind_send_readiness_scoped => ready
--   technical_visit not_applicable + definitive:
--     read_quote_kind_send_readiness_scoped => ready
--   technical_visit needs_resolution + definitive:
--     read_quote_kind_send_readiness_scoped => needs_resolution
--   technical_visit conflict + definitive:
--     read_quote_kind_send_readiness_scoped => conflict

-- 4. Preliminary-before-visit policy matrix.
-- Gate Policy representation:
--   item_key = preliminary_quote_before_technical_visit
--   applicability_state = optional means the store explicitly allows this
--   exception before a required technical visit is completed.
-- Missing/non-optional item means fail closed.
-- Required assertions:
--   required technical_visit + incomplete + preliminary + optional policy item:
--     read_quote_kind_send_readiness_scoped => ready,
--     preliminary_quote_before_visit_allowed
--   required technical_visit + incomplete + preliminary + missing policy item:
--     read_quote_kind_send_readiness_scoped => blocked,
--     preliminary_quote_before_visit_not_allowed

-- 5. Payment ledger behavioral checks.
-- Uses an EXISTING opportunity attached to an active canonical membership.
-- Payment tables are new in Package E. The fixture intentionally selects an
-- opportunity with no payment events and all writes disappear at ROLLBACK.
-- correction is rejected; confirmation/reversal are the only monetary events.

do $payment_checks$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_store_id uuid;
  v_opportunity_id uuid;
  v_lifecycle_cycle integer;

  v_payment_1 record;
  v_payment_replay record;
  v_payment_2 record;
  v_reversal record;

  v_settlement_1 record;
  v_settlement_replay record;
  v_settlement_2 record;
  v_reopened record;

  v_resolution record;

  v_event_count integer;
  v_settlement_count integer;
  v_current_amount integer;
  v_derived_amount integer;

  v_payment_event_1_id uuid;
  v_settlement_event_1_id uuid;
begin
  -- --------------------------------------------------------------------------
  -- Fixture: real human + real opportunity, but no pre-existing Package E
  -- payment history. No fake auth.users identity is created.
  -- --------------------------------------------------------------------------

  select
    membership.user_id,
    opportunity.organization_id,
    opportunity.store_id,
    opportunity.id,
    opportunity.lifecycle_cycle
  into
    v_user_id,
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle
  from public.memberships membership
  join public.commercial_opportunities opportunity
    on opportunity.organization_id = membership.organization_id
  where membership.is_active is true
    and membership.user_id is not null
    and opportunity.store_id is not null
    and opportunity.lifecycle_cycle is not null
    and not exists (
      select 1
      from public.commercial_opportunity_payment_events existing_payment
      where existing_payment.organization_id = opportunity.organization_id
        and existing_payment.store_id = opportunity.store_id
        and existing_payment.commercial_opportunity_id = opportunity.id
        and existing_payment.lifecycle_cycle = opportunity.lifecycle_cycle
    )
  order by opportunity.created_at asc nulls last
  limit 1;

  if v_user_id is null
     or v_org_id is null
     or v_store_id is null
     or v_opportunity_id is null
     or v_lifecycle_cycle is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no clean opportunity with active canonical membership';
  end if;

  -- --------------------------------------------------------------------------
  -- Privilege shape.
  -- --------------------------------------------------------------------------

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_events',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_events',
       'DELETE'
     ) then
    raise exception
      'FAIL: authenticated must not mutate payment events directly';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_current',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_current',
       'DELETE'
     ) then
    raise exception
      'FAIL: authenticated must not mutate payment current directly';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_settlement_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_settlement_events',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_payment_settlement_events',
       'DELETE'
     ) then
    raise exception
      'FAIL: authenticated must not mutate settlement events directly';
  end if;

  if pg_catalog.has_function_privilege(
    'service_role',
    'public.record_commercial_opportunity_payment_by_user(uuid,uuid,uuid,integer,text,text,text,integer,text,uuid,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception
      'FAIL: service_role cannot execute human payment writer';
  end if;

  if pg_catalog.has_function_privilege(
    'service_role',
    'public.set_commercial_opportunity_payment_settlement_by_user(uuid,uuid,uuid,integer,text,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception
      'FAIL: service_role cannot execute human settlement writer';
  end if;

  -- --------------------------------------------------------------------------
  -- Simulate authenticated human.
  -- --------------------------------------------------------------------------

  execute 'set local role authenticated';

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  if auth.uid() is distinct from v_user_id then
    raise exception 'FAIL: auth.uid() does not match payment fixture user';
  end if;

  -- --------------------------------------------------------------------------
  -- A. Human cannot declare obligation satisfied before any confirmed amount.
  -- --------------------------------------------------------------------------

  begin
    perform public.set_commercial_opportunity_payment_settlement_by_user(
      v_org_id,
      v_store_id,
      v_opportunity_id,
      v_lifecycle_cycle,
      'payment-test:settlement-before-payment',
      'fp:settlement-before-payment',
      'satisfied',
      'runner',
      '{}'::jsonb
    );

    raise exception
      'FAIL: settlement without confirmed payment was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'PAYMENT_SETTLEMENT_REQUIRES_CONFIRMED_AMOUNT' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- B. First confirmation.
  -- --------------------------------------------------------------------------

  select *
  into v_payment_1
  from public.record_commercial_opportunity_payment_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:confirmation-1',
    'fp:confirmation-1',
    'confirmation',
    10000,
    'pix',
    null,
    'runner first confirmation',
    '{}'::jsonb
  );

  if v_payment_1.confirmed_amount_cents is distinct from 10000
     or v_payment_1.event_count is distinct from 1
     or v_payment_1.outcome is distinct from 'recorded' then
    raise exception
      'FAIL: first payment confirmation projection mismatch';
  end if;

  v_payment_event_1_id := v_payment_1.payment_event_id;

  -- --------------------------------------------------------------------------
  -- C. Exact replay is idempotent.
  -- --------------------------------------------------------------------------

  select *
  into v_payment_replay
  from public.record_commercial_opportunity_payment_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:confirmation-1',
    'fp:confirmation-1',
    'confirmation',
    10000,
    'pix',
    null,
    'runner first confirmation',
    '{}'::jsonb
  );

  if v_payment_replay.payment_event_id is distinct from v_payment_event_1_id
     or v_payment_replay.confirmed_amount_cents is distinct from 10000
     or v_payment_replay.event_count is distinct from 1
     or v_payment_replay.outcome is distinct from 'idempotent_replay' then
    raise exception
      'FAIL: payment idempotent replay mismatch';
  end if;

  -- --------------------------------------------------------------------------
  -- D. Same operation_key with different fingerprint is forbidden.
  -- --------------------------------------------------------------------------

  begin
    perform public.record_commercial_opportunity_payment_by_user(
      v_org_id,
      v_store_id,
      v_opportunity_id,
      v_lifecycle_cycle,
      'payment-test:confirmation-1',
      'fp:DIFFERENT',
      'confirmation',
      10000,
      'pix',
      null,
      'runner conflict',
      '{}'::jsonb
    );

    raise exception
      'FAIL: reused payment operation_key with different fingerprint accepted';
  exception
    when unique_violation then
      if sqlerrm <> 'PAYMENT_OPERATION_KEY_REUSED' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- E. correction is rejected.
  -- --------------------------------------------------------------------------

  begin
    perform public.record_commercial_opportunity_payment_by_user(
      v_org_id,
      v_store_id,
      v_opportunity_id,
      v_lifecycle_cycle,
      'payment-test:correction',
      'fp:correction',
      'correction',
      100,
      null,
      null,
      null,
      '{}'::jsonb
    );

    raise exception 'FAIL: correction payment event was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'PAYMENT_EVENT_TYPE_INVALID' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- F. Reversal requires an explicit confirmation target.
  -- --------------------------------------------------------------------------

  begin
    perform public.record_commercial_opportunity_payment_by_user(
      v_org_id,
      v_store_id,
      v_opportunity_id,
      v_lifecycle_cycle,
      'payment-test:reversal-no-target',
      'fp:reversal-no-target',
      'reversal',
      100,
      null,
      null,
      null,
      '{}'::jsonb
    );

    raise exception 'FAIL: reversal without target was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'PAYMENT_REVERSAL_TARGET_REQUIRED' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- G. Second confirmation accumulates.
  -- --------------------------------------------------------------------------

  select *
  into v_payment_2
  from public.record_commercial_opportunity_payment_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:confirmation-2',
    'fp:confirmation-2',
    'confirmation',
    5000,
    'pix',
    null,
    'runner second confirmation',
    '{}'::jsonb
  );

  if v_payment_2.confirmed_amount_cents is distinct from 15000
     or v_payment_2.event_count is distinct from 2 then
    raise exception
      'FAIL: multiple payment confirmations did not accumulate';
  end if;

  -- Resolver is internal; return to postgres for direct proof.
  execute 'reset role';

  select *
  into v_resolution
  from public.p9_resolve_payment_progress_internal(
    v_org_id,
    v_store_id,
    v_opportunity_id
  );

  if v_resolution.progress_state is distinct from 'in_progress'
     or v_resolution.reason_code is distinct from 'payment_partially_confirmed'
     or v_resolution.resolver_version is distinct from 2 then
    raise exception
      'FAIL: positive confirmed payment must remain in_progress before settlement';
  end if;

  -- --------------------------------------------------------------------------
  -- H. Human settlement changes payment progress to completed.
  -- --------------------------------------------------------------------------

  execute 'set local role authenticated';

  select *
  into v_settlement_1
  from public.set_commercial_opportunity_payment_settlement_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:settlement-1',
    'fp:settlement-1',
    'satisfied',
    'human confirms obligation satisfied',
    '{}'::jsonb
  );

  if v_settlement_1.payment_obligation_satisfied is distinct from true
     or v_settlement_1.confirmed_amount_cents is distinct from 15000
     or v_settlement_1.outcome is distinct from 'recorded' then
    raise exception
      'FAIL: payment settlement did not mark obligation satisfied';
  end if;

  v_settlement_event_1_id := v_settlement_1.settlement_event_id;

  -- Settlement replay is also deterministic/idempotent.
  select *
  into v_settlement_replay
  from public.set_commercial_opportunity_payment_settlement_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:settlement-1',
    'fp:settlement-1',
    'satisfied',
    'human confirms obligation satisfied',
    '{}'::jsonb
  );

  if v_settlement_replay.settlement_event_id is distinct from v_settlement_event_1_id
     or v_settlement_replay.outcome is distinct from 'idempotent_replay' then
    raise exception
      'FAIL: settlement replay is not idempotent';
  end if;

  execute 'reset role';

  select *
  into v_resolution
  from public.p9_resolve_payment_progress_internal(
    v_org_id,
    v_store_id,
    v_opportunity_id
  );

  if v_resolution.progress_state is distinct from 'completed'
     or v_resolution.reason_code is distinct from 'payment_obligation_satisfied_by_human' then
    raise exception
      'FAIL: explicit human settlement must complete payment progress';
  end if;

  -- --------------------------------------------------------------------------
  -- I. A monetary reversal automatically invalidates prior settlement.
  -- --------------------------------------------------------------------------

  execute 'set local role authenticated';

  select *
  into v_reversal
  from public.record_commercial_opportunity_payment_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:reversal-1',
    'fp:reversal-1',
    'reversal',
    4000,
    null,
    v_payment_event_1_id,
    'runner partial reversal',
    '{}'::jsonb
  );

  if v_reversal.confirmed_amount_cents is distinct from 11000
     or v_reversal.event_count is distinct from 3 then
    raise exception
      'FAIL: valid reversal did not reduce confirmed amount';
  end if;

  execute 'reset role';

  select *
  into v_resolution
  from public.p9_resolve_payment_progress_internal(
    v_org_id,
    v_store_id,
    v_opportunity_id
  );

  if v_resolution.progress_state is distinct from 'in_progress'
     or v_resolution.reason_code is distinct from 'payment_partially_confirmed' then
    raise exception
      'FAIL: reversal must invalidate prior human settlement';
  end if;

  -- --------------------------------------------------------------------------
  -- J. Reversals accumulated against one confirmation cannot exceed it.
  -- Original target = 10000; already reversed = 4000; another 7000 is invalid.
  -- --------------------------------------------------------------------------

  execute 'set local role authenticated';

  begin
    perform public.record_commercial_opportunity_payment_by_user(
      v_org_id,
      v_store_id,
      v_opportunity_id,
      v_lifecycle_cycle,
      'payment-test:reversal-over-target',
      'fp:reversal-over-target',
      'reversal',
      7000,
      null,
      v_payment_event_1_id,
      null,
      '{}'::jsonb
    );

    raise exception
      'FAIL: cumulative reversal beyond target confirmation was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'PAYMENT_REVERSAL_EXCEEDS_TARGET_AMOUNT' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- K. Human may re-satisfy after review, then explicitly reopen again.
  -- --------------------------------------------------------------------------

  select *
  into v_settlement_2
  from public.set_commercial_opportunity_payment_settlement_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:settlement-2',
    'fp:settlement-2',
    'satisfied',
    'human re-confirms after reversal review',
    '{}'::jsonb
  );

  if v_settlement_2.payment_obligation_satisfied is distinct from true then
    raise exception
      'FAIL: human could not re-satisfy payment obligation';
  end if;

  select *
  into v_reopened
  from public.set_commercial_opportunity_payment_settlement_by_user(
    v_org_id,
    v_store_id,
    v_opportunity_id,
    v_lifecycle_cycle,
    'payment-test:reopened',
    'fp:reopened',
    'reopened',
    'human reopens payment obligation',
    '{}'::jsonb
  );

  if v_reopened.payment_obligation_satisfied is distinct from false then
    raise exception
      'FAIL: human reopened settlement did not clear satisfied state';
  end if;

  execute 'reset role';

  select *
  into v_resolution
  from public.p9_resolve_payment_progress_internal(
    v_org_id,
    v_store_id,
    v_opportunity_id
  );

  if v_resolution.progress_state is distinct from 'in_progress' then
    raise exception
      'FAIL: reopened payment obligation must be in_progress with positive amount';
  end if;

  -- --------------------------------------------------------------------------
  -- L. Ledger and current projection must agree exactly.
  -- --------------------------------------------------------------------------

  select
    coalesce(
      sum(
        case
          when event_type = 'confirmation' then amount_cents
          when event_type = 'reversal' then -amount_cents
          else 0
        end
      ),
      0
    )::integer,
    count(*)::integer
  into
    v_derived_amount,
    v_event_count
  from public.commercial_opportunity_payment_events
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opportunity_id
    and lifecycle_cycle = v_lifecycle_cycle;

  select
    confirmed_amount_cents,
    settlement_event_count
  into
    v_current_amount,
    v_settlement_count
  from public.commercial_opportunity_payment_current
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opportunity_id
    and lifecycle_cycle = v_lifecycle_cycle;

  if v_current_amount is distinct from v_derived_amount
     or v_current_amount is distinct from 11000
     or v_event_count is distinct from 3
     or v_settlement_count is distinct from 3 then
    raise exception
      'FAIL: payment current projection does not match append-only ledgers';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunity_payment_events
    where id = v_payment_event_1_id
      and actor_user_id = v_user_id
  ) then
    raise exception
      'FAIL: payment actor_user_id is not auth.uid()';
  end if;

  if not exists (
    select 1
    from public.commercial_opportunity_payment_settlement_events
    where id = v_settlement_event_1_id
      and actor_user_id = v_user_id
  ) then
    raise exception
      'FAIL: settlement actor_user_id is not auth.uid()';
  end if;

  -- --------------------------------------------------------------------------
  -- M. Both historical ledgers are truly append-only.
  -- --------------------------------------------------------------------------

  begin
    update public.commercial_opportunity_payment_events
    set notes = 'illegal mutation'
    where id = v_payment_event_1_id;

    raise exception 'FAIL: payment event ledger accepted UPDATE';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'ZION_PAYMENT_EVENTS_APPEND_ONLY' then
        raise;
      end if;
  end;

  begin
    update public.commercial_opportunity_payment_settlement_events
    set notes = 'illegal mutation'
    where id = v_settlement_event_1_id;

    raise exception 'FAIL: settlement ledger accepted UPDATE';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'ZION_PAYMENT_EVENTS_APPEND_ONLY' then
        raise;
      end if;
  end;
end;
$payment_checks$;

select
  conname,
  pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.commercial_opportunity_payment_events'::regclass
  and conname in (
    'commercial_opportunity_payment_events_type_chk',
    'commercial_opportunity_payment_events_amount_chk',
    'commercial_opportunity_payment_events_opportunity_fkey',
    'commercial_opportunity_payment_events_reversal_shape_chk',
    'commercial_opportunity_payment_events_scope_operation_uidx'
  )
order by conname;

select
  conname,
  pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.commercial_opportunity_payment_settlement_events'::regclass
  and conname in (
    'commercial_opportunity_payment_settlement_events_state_chk',
    'commercial_opportunity_payment_settlement_events_opportunity_fkey',
    'commercial_opportunity_payment_settlement_events_scope_operation_uidx'
  )
order by conname;

-- 6. Monthly goal behavioral checks.
-- Uses one EXISTING auth user with an active canonical membership.
-- Temporary org/store/goal rows are transaction-local and disappear at ROLLBACK.

do $monthly_goal_checks$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_store_id uuid;

  v_other_org_id uuid := gen_random_uuid();
  v_other_store_id uuid := gen_random_uuid();

  v_result record;
  v_count integer;
begin
  -- --------------------------------------------------------------------------
  -- Fixture: one real active membership + one real store in that organization.
  -- We deliberately do NOT create a fake auth.users identity.
  -- --------------------------------------------------------------------------

  select
    membership.user_id,
    membership.organization_id,
    store_row.id
  into
    v_user_id,
    v_org_id,
    v_store_id
  from public.memberships membership
  join public.stores store_row
    on store_row.organization_id = membership.organization_id
  where membership.is_active is true
    and membership.user_id is not null
  order by membership.created_at asc nulls last
  limit 1;

  if v_user_id is null
     or v_org_id is null
     or v_store_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no store with active canonical membership';
  end if;

  -- Second tenant/store only for negative scope/RLS tests.
  insert into public.organizations (id, name)
  values (
    v_other_org_id,
    'P19A Package E Monthly Goal Isolation'
  );

  insert into public.stores (id, organization_id, name)
  values (
    v_other_store_id,
    v_other_org_id,
    'P19A Package E Monthly Goal Isolation Store'
  );

  -- The selected real store may already have a goal.
  -- Delete only inside this transaction; final ROLLBACK restores it.
  delete from public.store_monthly_sales_goals
  where organization_id = v_org_id
    and store_id = v_store_id;

  -- Prepare a foreign-tenant row for the RLS isolation assertion.
  insert into public.store_monthly_sales_goals (
    organization_id,
    store_id,
    monthly_goal_enabled,
    monthly_goal_amount_cents
  )
  values (
    v_other_org_id,
    v_other_store_id,
    false,
    null
  );

  -- --------------------------------------------------------------------------
  -- Privilege shape.
  -- --------------------------------------------------------------------------

  if not pg_catalog.has_table_privilege(
    'authenticated',
    'public.store_monthly_sales_goals',
    'SELECT'
  ) then
    raise exception 'FAIL: authenticated must have SELECT on monthly goals';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.store_monthly_sales_goals',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.store_monthly_sales_goals',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.store_monthly_sales_goals',
       'DELETE'
     ) then
    raise exception
      'FAIL: authenticated must not mutate monthly goals directly';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.upsert_store_monthly_sales_goal_scoped(uuid,uuid,boolean,integer)',
    'EXECUTE'
  ) then
    raise exception
      'FAIL: authenticated must execute monthly goal canonical writer';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.upsert_store_monthly_sales_goal_scoped(uuid,uuid,boolean,integer)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: anon cannot execute monthly goal writer';
  end if;

  if pg_catalog.has_function_privilege(
    'service_role',
    'public.upsert_store_monthly_sales_goal_scoped(uuid,uuid,boolean,integer)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role cannot impersonate human goal writer';
  end if;

  -- --------------------------------------------------------------------------
  -- Simulate the existing real member as an authenticated request.
  -- --------------------------------------------------------------------------

  execute 'set local role authenticated';

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  if auth.uid() is distinct from v_user_id then
    raise exception 'FAIL: auth.uid() does not match fixture user';
  end if;

  -- --------------------------------------------------------------------------
  -- A. No row = not configured at DB level.
  -- --------------------------------------------------------------------------

  select count(*)::integer
  into v_count
  from public.store_monthly_sales_goals
  where organization_id = v_org_id
    and store_id = v_store_id;

  if v_count <> 0 then
    raise exception 'FAIL: expected absent monthly goal row';
  end if;

  -- RLS must hide another tenant.
  select count(*)::integer
  into v_count
  from public.store_monthly_sales_goals
  where organization_id = v_other_org_id
    and store_id = v_other_store_id;

  if v_count <> 0 then
    raise exception 'FAIL: monthly goal RLS leaked another tenant';
  end if;

  -- --------------------------------------------------------------------------
  -- B. Explicit disabled = configured, amount NULL.
  -- --------------------------------------------------------------------------

  select *
  into v_result
  from public.upsert_store_monthly_sales_goal_scoped(
    v_org_id,
    v_store_id,
    false,
    123456
  );

  if v_result.monthly_goal_enabled is distinct from false
     or v_result.monthly_goal_amount_cents is not null then
    raise exception
      'FAIL: disabled monthly goal must normalize amount to NULL';
  end if;

  -- --------------------------------------------------------------------------
  -- C. Enabled valid = exact cents preserved.
  -- --------------------------------------------------------------------------

  select *
  into v_result
  from public.upsert_store_monthly_sales_goal_scoped(
    v_org_id,
    v_store_id,
    true,
    450000
  );

  if v_result.monthly_goal_enabled is distinct from true
     or v_result.monthly_goal_amount_cents is distinct from 450000 then
    raise exception
      'FAIL: enabled monthly goal did not preserve exact cents';
  end if;

  -- --------------------------------------------------------------------------
  -- D. Same write does not duplicate canonical row.
  -- --------------------------------------------------------------------------

  perform public.upsert_store_monthly_sales_goal_scoped(
    v_org_id,
    v_store_id,
    true,
    450000
  );

  select count(*)::integer
  into v_count
  from public.store_monthly_sales_goals
  where organization_id = v_org_id
    and store_id = v_store_id;

  if v_count <> 1 then
    raise exception
      'FAIL: monthly goal writer duplicated canonical row';
  end if;

  -- --------------------------------------------------------------------------
  -- E. Enabled + zero is invalid.
  -- --------------------------------------------------------------------------

  begin
    perform public.upsert_store_monthly_sales_goal_scoped(
      v_org_id,
      v_store_id,
      true,
      0
    );

    raise exception 'FAIL: enabled zero monthly goal was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'MONTHLY_SALES_GOAL_AMOUNT_REQUIRED' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- F. Enabled + negative is invalid.
  -- --------------------------------------------------------------------------

  begin
    perform public.upsert_store_monthly_sales_goal_scoped(
      v_org_id,
      v_store_id,
      true,
      -1
    );

    raise exception 'FAIL: enabled negative monthly goal was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'MONTHLY_SALES_GOAL_AMOUNT_REQUIRED' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- G. Missing Sim/N?o decision is invalid.
  -- --------------------------------------------------------------------------

  begin
    perform public.upsert_store_monthly_sales_goal_scoped(
      v_org_id,
      v_store_id,
      null,
      null
    );

    raise exception 'FAIL: NULL monthly_goal_enabled was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'MONTHLY_SALES_GOAL_ENABLED_REQUIRED' then
        raise;
      end if;
  end;

  -- --------------------------------------------------------------------------
  -- H. Store from another organization cannot be paired with member org.
  -- Membership for v_org_id is valid, so this proves exact store/org scope.
  -- --------------------------------------------------------------------------

  begin
    perform public.upsert_store_monthly_sales_goal_scoped(
      v_org_id,
      v_other_store_id,
      false,
      null
    );

    raise exception 'FAIL: mismatched store/organization scope was accepted';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'MONTHLY_SALES_GOAL_STORE_SCOPE_INVALID' then
        raise;
      end if;
  end;

  execute 'reset role';

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- --------------------------------------------------------------------------
  -- I. Composite FK exists and canonical values survived all failed attempts.
  -- --------------------------------------------------------------------------

  select count(*)::integer
  into v_count
  from public.store_monthly_sales_goals
  where organization_id = v_org_id
    and store_id = v_store_id
    and monthly_goal_enabled is true
    and monthly_goal_amount_cents = 450000;

  if v_count <> 1 then
    raise exception
      'FAIL: canonical monthly goal changed after rejected writes';
  end if;
end;
$monthly_goal_checks$;

-- Structural proof for amount and exact store/org constraints.
select
  conname,
  pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.store_monthly_sales_goals'::regclass
  and conname in (
    'store_monthly_sales_goals_amount_chk',
    'store_monthly_sales_goals_store_scope_fkey'
  )
order by conname;

rollback;
