begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- P9 8.4 B1.5 real-SUT runner. Every fixture is local to this transaction and
-- the final ROLLBACK is mandatory. No temporary ledger replaces the real SUT.

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_negotiation_concessions') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.store_discount_settings') is null
     or pg_catalog.to_regclass('public.store_high_value_discount_settings') is null
     or pg_catalog.to_regclass('public.store_payment_settings') is null
     or pg_catalog.to_regclass('public.store_discount_counterpart_policy') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_MANUAL_REQUIRED_TABLES_MISSING';
  end if;

  if pg_catalog.to_regprocedure(
       'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_MANUAL_REQUIRED_FUNCTIONS_MISSING';
  end if;
end;
$preflight$;

create temp table pg_temp.p9_b1_5_results (
  scenario_number integer primary key,
  scenario_name text not null
) on commit drop;

create temp table pg_temp.p9_b1_5_input (
  organization_id uuid not null,
  store_id uuid not null,
  opportunity_id uuid not null,
  cycle_id uuid not null,
  quote_id uuid not null,
  version_id uuid not null,
  concession_class text not null,
  concession_kind text not null,
  previous_condition jsonb not null,
  proposed_condition jsonb not null,
  requested_discount_percent numeric not null,
  requested_discount_cents bigint,
  counterpart_snapshot jsonb not null,
  policy_snapshot jsonb not null,
  authority_snapshot jsonb not null,
  authority_decision text not null,
  high_value boolean not null,
  high_value_context jsonb not null,
  origin text not null,
  source_message_id uuid,
  operation_key text not null
) on commit drop;

create or replace function pg_temp.p9_b1_5_record(
  p_number integer,
  p_name text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp.p9_b1_5_results values (p_number, p_name);
end;
$function$;

create or replace function pg_temp.p9_b1_5_authority_snapshot(
  p_organization_id uuid,
  p_store_id uuid,
  p_opportunity_id uuid,
  p_quote_id uuid,
  p_version_id uuid,
  p_requested_percent numeric,
  p_state text,
  p_reason_code text
)
returns jsonb
language plpgsql
as $function$
begin
  return pg_catalog.jsonb_build_object(
    'action', 'apply_discount',
    'state', p_state,
    'requestedDiscountPercent', p_requested_percent,
    'canOffer', case when p_state in ('blocked', 'unconfigured') then false else true end,
    'canApply', case when p_state = 'allowed' then true else false end,
    'canRequestApproval', case when p_state = 'human_approval_required' then true else false end,
    'requiresHumanApproval', case when p_state = 'human_approval_required' then true else false end,
    'reasonCode', p_reason_code,
    'scope', pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'storeId', p_store_id,
      'commercialOpportunityId', p_opportunity_id,
      'quoteId', p_quote_id,
      'quoteVersionId', p_version_id
    ),
    'provenance', pg_catalog.jsonb_build_object(
      'source', 'p9_8_4_b1_5_manual_runner'
    )
  );
end;
$function$;

create or replace function pg_temp.p9_b1_5_call()
returns uuid
language plpgsql
as $function$
declare
  v_input pg_temp.p9_b1_5_input;
  v_id uuid;
begin
  select *
  into strict v_input
  from pg_temp.p9_b1_5_input;

  select result.concession_id
  into v_id
  from public.write_commercial_negotiation_concession_request_by_system(
    v_input.organization_id,
    v_input.store_id,
    v_input.opportunity_id,
    v_input.cycle_id,
    v_input.quote_id,
    v_input.version_id,
    v_input.concession_class,
    v_input.concession_kind,
    v_input.previous_condition,
    v_input.proposed_condition,
    v_input.requested_discount_percent,
    v_input.requested_discount_cents,
    v_input.counterpart_snapshot,
    v_input.policy_snapshot,
    v_input.authority_snapshot,
    v_input.authority_decision,
    v_input.high_value,
    v_input.high_value_context,
    v_input.origin,
    v_input.source_message_id,
    v_input.operation_key
  ) result;

  return v_id;
end;
$function$;

create or replace function pg_temp.p9_b1_5_expect_error(
  p_number integer,
  p_name text,
  p_expected text
)
returns void
language plpgsql
as $function$
begin
  begin
    perform pg_temp.p9_b1_5_call();
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_EXPECTED_ERROR_NOT_RAISED:' || p_name;
  exception
    when others then
      if sqlerrm not like '%' || p_expected || '%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_5_record(p_number, p_name);
end;
$function$;

create or replace function pg_temp.p9_b1_5_insert_negotiation_cycle_event(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_customer_id uuid,
  p_lifecycle_cycle integer,
  p_label text
)
returns uuid
language plpgsql
as $function$
declare
  v_event_id uuid := gen_random_uuid();
  v_idempotency_key text :=
    'p9:b1.5:fixture:cycle:' || p_label || ':' || v_event_id::text;
  v_source text := 'p9_8_4_b1_5_manual_fixture';
  v_evidence_type text := 'material_negotiation_discount_request';
  v_evidence_summary text := 'P9 8.4 B1.5 rollback-only negotiation fixture';
  v_event_key text;
begin
  v_event_key :=
    public.compute_commercial_opportunity_event_fingerprint_internal(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      p_lifecycle_cycle,
      'stage_transition',
      'orcamento',
      'negociacao',
      'system',
      null,
      'concrete_quote_objection_required',
      null,
      v_source,
      v_evidence_type,
      null,
      v_evidence_summary
    );

  insert into public.commercial_opportunity_lifecycle_events (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    event_type,
    previous_stage,
    new_stage,
    reason_code,
    reason_details,
    evidence_type,
    evidence_message_id,
    evidence_summary,
    actor_type,
    actor_user_id,
    source,
    metadata,
    idempotency_key,
    event_key
  )
  values (
    v_event_id,
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_customer_id,
    p_lifecycle_cycle,
    'stage_transition',
    'orcamento',
    'negociacao',
    'concrete_quote_objection_required',
    null,
    v_evidence_type,
    null,
    v_evidence_summary,
    'system',
    null,
    v_source,
    pg_catalog.jsonb_build_object(
      'runner', 'p9.8.4.b1.5',
      'label', p_label,
      'rollback_only', true
    ),
    v_idempotency_key,
    v_event_key
  );

  return v_event_id;
end;
$function$;

do $fixtures$
declare
  v_run uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_opp uuid := gen_random_uuid();
  v_cycle uuid;
  v_quote uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();

  v_context jsonb;
  v_id uuid;
  v_first_id uuid;
  v_quote_before jsonb;
  v_version_before jsonb;
  v_snapshot jsonb;
  v_count integer;
begin
  insert into public.organizations (
    id,
    name
  )
  values (
    v_org,
    'P9 8.4 B1.5 runner ' || v_run::text
  );

  insert into public.stores (
    id,
    organization_id,
    name,
    created_at
  )
  values (
    v_store,
    v_org,
    'P9 8.4 B1.5 store',
    v_now
  );

  insert into public.customers (
    id,
    organization_id,
    display_name,
    normalized_name
  )
  values (
    v_customer,
    v_org,
    'P9 8.4 B1.5 customer',
    'p9-8-4-b1-5-' || pg_catalog.replace(v_run::text, '-', '')
  );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values (
    v_org,
    v_store,
    v_customer
  );

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage,
    lifecycle_cycle
  )
  values (
    v_opp,
    v_org,
    v_store,
    v_customer,
    'negociacao',
    1
  );

  v_cycle := pg_temp.p9_b1_5_insert_negotiation_cycle_event(
    v_org,
    v_store,
    v_opp,
    v_customer,
    1,
    'main'
  );

  v_snapshot := pg_catalog.jsonb_build_object(
    'quote', pg_catalog.jsonb_build_object(
      'id', v_quote::text,
      'subtotalCents', 2000000,
      'discountCents', 0,
      'totalCents', 2000000
    ),
    'items', pg_catalog.jsonb_build_array(),
    'settings', pg_catalog.jsonb_build_object(),
    'runner', 'p9.8.4.b1.5'
  );

  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    quote_number,
    title,
    status,
    subtotal_cents,
    discount_cents,
    total_cents,
    metadata
  )
  values (
    v_quote,
    v_org,
    v_store,
    v_opp,
    'P984B15-' || pg_catalog.replace(v_quote::text, '-', ''),
    'P9 8.4 B1.5 quote',
    'sent',
    2000000,
    0,
    2000000,
    pg_catalog.jsonb_build_object('runner', true)
  );

  insert into public.sales_quote_versions (
    id,
    organization_id,
    store_id,
    quote_id,
    version_number,
    status,
    quote_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot,
    created_at,
    sent_at
  )
  values (
    v_version,
    v_org,
    v_store,
    v_quote,
    1,
    'sent',
    'definitive',
    'zion-store-files',
    'p9/b1.5/' || v_version::text || '.pdf',
    'b1.5.pdf',
    'application/pdf',
    100,
    'system',
    v_snapshot,
    v_now,
    v_now + interval '1 minute'
  );

  update public.sales_quotes
  set current_version_id = v_version
  where id = v_quote;

  perform *
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    v_org,
    v_store,
    v_opp,
    v_quote,
    v_version,
    'current_commercial_proposal:'
      || v_opp::text
      || ':'
      || v_quote::text
      || ':'
      || v_version::text,
    'p9_8_4_b1_5_runner'
  );

  insert into public.store_discount_settings (
    store_id,
    organization_id,
    default_discount_percent,
    max_discount_percent,
    allow_ask_above_max_discount,
    discount_autonomy_mode
  )
  values (
    v_store,
    v_org,
    5,
    10,
    false,
    'within_policy_autonomous'
  )
  on conflict (store_id) do update
  set
    organization_id = excluded.organization_id,
    default_discount_percent = excluded.default_discount_percent,
    max_discount_percent = excluded.max_discount_percent,
    allow_ask_above_max_discount = excluded.allow_ask_above_max_discount,
    discount_autonomy_mode = excluded.discount_autonomy_mode;

  insert into public.store_high_value_discount_settings (
    organization_id,
    store_id,
    enabled,
    threshold_amount_cents,
    discount_percent,
    requires_human_approval,
    requires_human_approval_configured_at
  )
  values (
    v_org,
    v_store,
    true,
    1000000,
    20,
    true,
    v_now
  );

  insert into public.store_payment_settings (
    organization_id,
    store_id,
    accepted_payment_methods,
    pix_key_type,
    pix_key,
    pix_holder_name,
    down_payment_mode,
    down_payment_value_type,
    down_payment_percent,
    installments_enabled,
    max_installments,
    installment_interest_policy
  )
  values (
    v_org,
    v_store,
    array['pix']::text[],
    'random',
    'runner-pix',
    'P9 B1.5 Runner',
    'optional',
    'percent',
    20,
    true,
    7,
    'interest_free'
  );

  insert into public.store_discount_counterpart_policy (
    organization_id,
    store_id,
    enabled,
    allowed_payment_methods,
    higher_down_payment_enabled,
    higher_down_payment_minimum_type,
    higher_down_payment_minimum_percent,
    higher_down_payment_minimum_amount_cents,
    fewer_installments_enabled,
    fewer_installments_max_count
  )
  values (
    v_org,
    v_store,
    true,
    array['pix']::text[],
    true,
    'percent',
    30,
    null,
    true,
    3
  );

  v_context := pg_catalog.jsonb_build_object(
    'organizationId', v_org,
    'storeId', v_store,
    'quoteId', v_quote,
    'quoteVersionId', v_version,
    'grossAmountCents', 2000000,
    'enabled', true,
    'thresholdAmountCents', 1000000,
    'discountPercent', 20,
    'requiresHumanApproval', true,
    'requiresHumanApprovalConfiguredAt', v_now,
    'discountAutonomyMode', 'within_policy_autonomous',
    'defaultDiscountPercent', 5,
    'maxDiscountPercent', 10,
    'requestedDiscountPercent', 20,
    'eligible', true,
    'resultingDecision', pg_catalog.jsonb_build_object(
      'state', 'human_approval_required',
      'reasonCode', 'P9_8_4_B1_HIGH_VALUE_REQUIRES_HUMAN'
    )
  );

  insert into pg_temp.p9_b1_5_input values (
    v_org,
    v_store,
    v_opp,
    v_cycle,
    v_quote,
    v_version,
    'normal',
    'discount',
    pg_catalog.jsonb_build_object('price_cents', 2000000),
    pg_catalog.jsonb_build_object('price_cents', 1900000),
    5,
    100000,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_temp.p9_b1_5_authority_snapshot(
      v_org,
      v_store,
      v_opp,
      v_quote,
      v_version,
      5,
      'allowed',
      'TRANSACTIONAL_AUTHORITY_ALLOWED'
    ),
    'allowed',
    false,
    '{}'::jsonb,
    'sales_ai',
    null,
    'p9-b1-5-01'
  );

  select pg_catalog.to_jsonb(quote_row)
  into v_quote_before
  from public.sales_quotes quote_row
  where quote_row.id = v_quote;

  select pg_catalog.to_jsonb(version_row)
  into v_version_before
  from public.sales_quote_versions version_row
  where version_row.id = v_version;

  -- 01: normal request, no counterpart/high-value, remains proposed.
  v_id := pg_temp.p9_b1_5_call();
  if v_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_NORMAL_REQUEST_FAILED';
  end if;
  perform pg_temp.p9_b1_5_record(1, 'normal without counterpart/high-value proposed');

  -- 02: human exception may be requested by a human and remains proposed.
  update pg_temp.p9_b1_5_input
  set
    concession_class = 'human_exception',
    origin = 'human',
    authority_decision = 'human_approval_required',
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 5,
      'human_approval_required',
      'TRANSACTIONAL_AUTHORITY_APPROVAL_REQUIRED'
    ),
    operation_key = 'p9-b1-5-02';
  perform pg_temp.p9_b1_5_call();
  perform pg_temp.p9_b1_5_record(2, 'human_exception human proposed');

  -- 03-05: non-human origins cannot request a human exception.
  update pg_temp.p9_b1_5_input
  set origin = 'sales_ai', operation_key = 'p9-b1-5-03';
  perform pg_temp.p9_b1_5_expect_error(
    3,
    'human_exception sales_ai rejected',
    'P9_8_4_B1_5_HUMAN_EXCEPTION_ORIGIN_INVALID'
  );

  update pg_temp.p9_b1_5_input
  set origin = 'assistant', operation_key = 'p9-b1-5-04';
  perform pg_temp.p9_b1_5_expect_error(
    4,
    'human_exception assistant rejected',
    'P9_8_4_B1_5_HUMAN_EXCEPTION_ORIGIN_INVALID'
  );

  update pg_temp.p9_b1_5_input
  set origin = 'system', operation_key = 'p9-b1-5-05';
  perform pg_temp.p9_b1_5_expect_error(
    5,
    'human_exception system rejected',
    'P9_8_4_B1_5_HUMAN_EXCEPTION_ORIGIN_INVALID'
  );

  -- 06: high-value is always a normal concession, never a human_exception.
  update pg_temp.p9_b1_5_input
  set
    origin = 'human',
    high_value = true,
    high_value_context = v_context,
    requested_discount_percent = 20,
    authority_decision = 'blocked',
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 20,
      'blocked',
      'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED'
    ),
    operation_key = 'p9-b1-5-06';
  perform pg_temp.p9_b1_5_expect_error(
    6,
    'human_exception high_value rejected',
    'P9_8_4_B1_5_HUMAN_EXCEPTION_HIGH_VALUE_INVALID'
  );

  -- 07: valid high-value request uses canonical gross/settings and remains proposed.
  update pg_temp.p9_b1_5_input
  set
    concession_class = 'normal',
    origin = 'sales_ai',
    high_value = true,
    requested_discount_percent = 20,
    requested_discount_cents = 400000,
    authority_decision = 'blocked',
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 20,
      'blocked',
      'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED'
    ),
    high_value_context = v_context,
    operation_key = 'p9-b1-5-07';
  perform pg_temp.p9_b1_5_call();
  perform pg_temp.p9_b1_5_record(7, 'high-value uses quote version gross');

  -- 08-12: caller-controlled high-value context cannot diverge from DB truth.
  update pg_temp.p9_b1_5_input
  set
    high_value_context = pg_catalog.jsonb_set(
      v_context, '{grossAmountCents}', '1999999'::jsonb
    ),
    operation_key = 'p9-b1-5-08';
  perform pg_temp.p9_b1_5_expect_error(
    8,
    'caller gross mismatch rejected',
    'P9_8_4_B1_HIGH_VALUE_CONTEXT_MISMATCH'
  );

  update pg_temp.p9_b1_5_input
  set
    high_value_context = pg_catalog.jsonb_set(
      v_context, '{thresholdAmountCents}', '999999'::jsonb
    ),
    operation_key = 'p9-b1-5-09';
  perform pg_temp.p9_b1_5_expect_error(
    9,
    'caller threshold mismatch rejected',
    'P9_8_4_B1_HIGH_VALUE_CONTEXT_MISMATCH'
  );

  update pg_temp.p9_b1_5_input
  set
    high_value_context = pg_catalog.jsonb_set(
      v_context, '{discountPercent}', '19'::jsonb
    ),
    operation_key = 'p9-b1-5-10';
  perform pg_temp.p9_b1_5_expect_error(
    10,
    'caller discount mismatch rejected',
    'P9_8_4_B1_HIGH_VALUE_CONTEXT_MISMATCH'
  );

  update pg_temp.p9_b1_5_input
  set
    high_value_context = pg_catalog.jsonb_set(
      v_context, '{requiresHumanApproval}', 'false'::jsonb
    ),
    operation_key = 'p9-b1-5-11';
  perform pg_temp.p9_b1_5_expect_error(
    11,
    'caller requires-human mismatch rejected',
    'P9_8_4_B1_HIGH_VALUE_CONTEXT_MISMATCH'
  );

  update pg_temp.p9_b1_5_input
  set
    high_value_context = pg_catalog.jsonb_set(
      v_context, '{discountAutonomyMode}', '"approval_required"'::jsonb
    ),
    operation_key = 'p9-b1-5-12';
  perform pg_temp.p9_b1_5_expect_error(
    12,
    'caller autonomy mismatch rejected',
    'P9_8_4_B1_HIGH_VALUE_CONTEXT_MISMATCH'
  );

  -- 13: high-value uses exactly the configured high-value percentage.
  update pg_temp.p9_b1_5_input
  set
    requested_discount_percent = 10,
    requested_discount_cents = 200000,
    authority_decision = 'allowed',
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 10,
      'allowed',
      'TRANSACTIONAL_AUTHORITY_ALLOWED'
    ),
    high_value_context = pg_catalog.jsonb_set(
      v_context, '{requestedDiscountPercent}', '10'::jsonb
    ),
    operation_key = 'p9-b1-5-13';
  perform pg_temp.p9_b1_5_expect_error(
    13,
    'high-value requested percent mismatch rejected',
    'P9_8_4_B1_HIGH_VALUE_REQUESTED_PERCENT_MISMATCH'
  );

  -- 14: quote below canonical high-value threshold is not eligible.
  update public.store_high_value_discount_settings
  set threshold_amount_cents = 3000000
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set
    requested_discount_percent = 20,
    requested_discount_cents = 400000,
    authority_decision = 'blocked',
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 20,
      'blocked',
      'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED'
    ),
    high_value_context = pg_catalog.jsonb_set(
      v_context, '{thresholdAmountCents}', '3000000'::jsonb
    ),
    operation_key = 'p9-b1-5-14';
  perform pg_temp.p9_b1_5_expect_error(
    14,
    'high-value quote below threshold rejected',
    'P9_8_4_B1_HIGH_VALUE_NOT_ELIGIBLE'
  );

  update public.store_high_value_discount_settings
  set threshold_amount_cents = 1000000
  where organization_id = v_org
    and store_id = v_store;

  -- 15: being a high-value quote does not force every concession to use the
  -- high-value policy.
  update pg_temp.p9_b1_5_input
  set
    high_value = false,
    high_value_context = '{}'::jsonb,
    requested_discount_percent = 5,
    requested_discount_cents = 100000,
    authority_decision = 'allowed',
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 5,
      'allowed',
      'TRANSACTIONAL_AUTHORITY_ALLOWED'
    ),
    counterpart_snapshot = '{}'::jsonb,
    operation_key = 'p9-b1-5-15';
  perform pg_temp.p9_b1_5_call();
  perform pg_temp.p9_b1_5_record(15, 'high-value quote can use normal concession');

  -- 16: payment-method counterpart must be authorized by policy and operations.
  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'payment_method', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'method', 'pix'
      )
    ),
    operation_key = 'p9-b1-5-16';
  perform pg_temp.p9_b1_5_call();
  perform pg_temp.p9_b1_5_record(16, 'authorized payment counterpart accepted');

  -- 17: payment method outside counterpart policy fails.
  update public.store_discount_counterpart_policy
  set allowed_payment_methods = array['boleto']::text[]
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set operation_key = 'p9-b1-5-17';
  perform pg_temp.p9_b1_5_expect_error(
    17,
    'payment method outside policy rejected',
    'P9_8_4_B1_COUNTERPART_METHOD_UNAUTHORIZED'
  );

  update public.store_discount_counterpart_policy
  set allowed_payment_methods = array['pix']::text[]
  where organization_id = v_org
    and store_id = v_store;

  -- 18: operational payment availability is also required. Pix metadata must
  -- be cleared when Pix is removed, preserving store_payment_settings checks.
  update public.store_payment_settings
  set
    accepted_payment_methods = array['boleto']::text[],
    pix_key_type = null,
    pix_key = null,
    pix_holder_name = null
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set operation_key = 'p9-b1-5-18';
  perform pg_temp.p9_b1_5_expect_error(
    18,
    'payment method outside operational settings rejected',
    'P9_8_4_B1_COUNTERPART_METHOD_UNAUTHORIZED'
  );

  update public.store_payment_settings
  set
    accepted_payment_methods = array['pix']::text[],
    pix_key_type = 'random',
    pix_key = 'runner-pix',
    pix_holder_name = 'P9 B1.5 Runner'
  where organization_id = v_org
    and store_id = v_store;

  -- 19: higher down-payment percent above the canonical baseline is valid.
  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'higher_down_payment', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'minimum_type', 'percent',
        'minimum_percent', 30
      )
    ),
    operation_key = 'p9-b1-5-19';
  perform pg_temp.p9_b1_5_call();
  perform pg_temp.p9_b1_5_record(19, 'higher down payment above baseline accepted');

  -- 20: equal/lower down-payment counterpart fails against the real baseline.
  update public.store_discount_counterpart_policy
  set higher_down_payment_minimum_percent = 20
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'higher_down_payment', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'minimum_type', 'percent',
        'minimum_percent', 20
      )
    ),
    operation_key = 'p9-b1-5-20';
  perform pg_temp.p9_b1_5_expect_error(
    20,
    'higher down payment equal or lower rejected',
    'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID'
  );

  -- 21: percent baseline cannot be paired with a fixed counterpart.
  update public.store_discount_counterpart_policy
  set
    higher_down_payment_minimum_type = 'fixed',
    higher_down_payment_minimum_percent = null,
    higher_down_payment_minimum_amount_cents = 60000
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'higher_down_payment', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'minimum_type', 'fixed',
        'minimum_amount_cents', 60000
      )
    ),
    operation_key = 'p9-b1-5-21';
  perform pg_temp.p9_b1_5_expect_error(
    21,
    'higher down payment type incompatible rejected',
    'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID'
  );

  update public.store_discount_counterpart_policy
  set
    higher_down_payment_minimum_type = 'percent',
    higher_down_payment_minimum_percent = 30,
    higher_down_payment_minimum_amount_cents = null
  where organization_id = v_org
    and store_id = v_store;

  -- 22: case-by-case baseline cannot be automatic authority.
  update public.store_payment_settings
  set
    down_payment_value_type = 'case_by_case',
    down_payment_percent = null,
    down_payment_amount_cents = null
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'higher_down_payment', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'minimum_type', 'percent',
        'minimum_percent', 30
      )
    ),
    operation_key = 'p9-b1-5-22';
  perform pg_temp.p9_b1_5_expect_error(
    22,
    'case by case baseline fails closed',
    'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID'
  );

  update public.store_payment_settings
  set
    down_payment_value_type = 'percent',
    down_payment_percent = 20
  where organization_id = v_org
    and store_id = v_store;

  -- 23: fewer installments below the canonical normal maximum is valid.
  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'fewer_installments', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'maximum_installments', 3
      )
    ),
    operation_key = 'p9-b1-5-23';
  perform pg_temp.p9_b1_5_call();
  perform pg_temp.p9_b1_5_record(23, 'fewer installments below normal accepted');

  -- 24: equal/higher installment count is not a valid counterpart.
  update public.store_discount_counterpart_policy
  set fewer_installments_max_count = 7
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'fewer_installments', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'maximum_installments', 7
      )
    ),
    operation_key = 'p9-b1-5-24';
  perform pg_temp.p9_b1_5_expect_error(
    24,
    'fewer installments equal or higher rejected',
    'P9_8_4_B1_FEWER_INSTALLMENTS_INVALID'
  );

  update public.store_discount_counterpart_policy
  set fewer_installments_max_count = 3
  where organization_id = v_org
    and store_id = v_store;

  -- 25: installment counterpart cannot exist when installments are disabled.
  update public.store_payment_settings
  set
    installments_enabled = false,
    max_installments = null,
    installment_interest_policy = null
  where organization_id = v_org
    and store_id = v_store;

  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'fewer_installments', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'maximum_installments', 3
      )
    ),
    operation_key = 'p9-b1-5-25';
  perform pg_temp.p9_b1_5_expect_error(
    25,
    'installments disabled rejected',
    'P9_8_4_B1_FEWER_INSTALLMENTS_INVALID'
  );

  update public.store_payment_settings
  set
    installments_enabled = true,
    max_installments = 7,
    installment_interest_policy = 'interest_free'
  where organization_id = v_org
    and store_id = v_store;

  -- 26: fused/unknown counterpart dimensions are never automatic authority.
  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'payment_method_with_installments', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'method', 'pix',
        'maximum_installments', 3
      )
    ),
    operation_key = 'p9-b1-5-26';
  perform pg_temp.p9_b1_5_expect_error(
    26,
    'unknown fused counterpart dimension rejected',
    'P9_8_4_B1_COUNTERPART_DIMENSION_UNKNOWN'
  );

  -- 27: free-form economic-benefit claims are not valid counterpart fields.
  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = pg_catalog.jsonb_build_object(
      'payment_method', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'method', 'pix',
        'economic_benefit', 'mais barato'
      )
    ),
    operation_key = 'p9-b1-5-27';
  perform pg_temp.p9_b1_5_expect_error(
    27,
    'economic advantage inference rejected',
    'P9_8_4_B1_COUNTERPART_SNAPSHOT_INVALID'
  );

  -- 28: identical replay remains idempotent.
  update pg_temp.p9_b1_5_input
  set
    counterpart_snapshot = '{}'::jsonb,
    requested_discount_percent = 5,
    requested_discount_cents = 100000,
    authority_decision = 'allowed',
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 5,
      'allowed',
      'TRANSACTIONAL_AUTHORITY_ALLOWED'
    ),
    operation_key = 'p9-b1-5-28';

  v_first_id := pg_temp.p9_b1_5_call();
  v_id := pg_temp.p9_b1_5_call();

  if v_id is distinct from v_first_id then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_REPLAY_IDEMPOTENCY_FAILED';
  end if;
  perform pg_temp.p9_b1_5_record(28, 'identical replay is idempotent');

  -- 29: same operation key with a different semantic payload fails by
  -- fingerprint, not by an unrelated snapshot-shape error.
  update pg_temp.p9_b1_5_input
  set
    requested_discount_percent = 6,
    requested_discount_cents = 120000,
    authority_snapshot = pg_temp.p9_b1_5_authority_snapshot(
      v_org, v_store, v_opp, v_quote, v_version, 6,
      'allowed',
      'TRANSACTIONAL_AUTHORITY_ALLOWED'
    );
  perform pg_temp.p9_b1_5_expect_error(
    29,
    'divergent replay rejected',
    'P9_8_4_B1_IDEMPOTENCY_KEY_REUSED_DIVERGENT'
  );

  -- 30-31: request writer never mutates the quote or quote version.
  select pg_catalog.to_jsonb(quote_row)
  into v_snapshot
  from public.sales_quotes quote_row
  where quote_row.id = v_quote;

  if v_snapshot is distinct from v_quote_before then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_QUOTE_MUTATED';
  end if;
  perform pg_temp.p9_b1_5_record(30, 'quote remains unchanged');

  select pg_catalog.to_jsonb(version_row)
  into v_snapshot
  from public.sales_quote_versions version_row
  where version_row.id = v_version;

  if v_snapshot is distinct from v_version_before then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_QUOTE_VERSION_MUTATED';
  end if;
  perform pg_temp.p9_b1_5_record(31, 'quote version remains unchanged');

  -- 32-33: B1.5 never assigns an ordinal or advances status.
  select pg_catalog.count(*)::integer
  into v_count
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_first_id
    and concession_row.concession_number is null;

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_ORDINAL_ASSIGNED';
  end if;
  perform pg_temp.p9_b1_5_record(32, 'concession number remains null');

  select pg_catalog.count(*)::integer
  into v_count
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_first_id
    and concession_row.status = 'proposed';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_STATUS_CHANGED';
  end if;
  perform pg_temp.p9_b1_5_record(33, 'status remains proposed');

  -- 34: decision-event foundation is intentionally deferred to B2A/B2B.
  if pg_catalog.to_regclass(
       'public.commercial_negotiation_concession_decision_events'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_DECISION_EVENTS_CREATED';
  end if;
  perform pg_temp.p9_b1_5_record(34, 'decision-events table absent in B1.5');
end;
$fixtures$;

select
  result_row.scenario_number,
  result_row.scenario_name,
  'PASS'::text as status
from pg_temp.p9_b1_5_results result_row
order by result_row.scenario_number;

do $count$
begin
  if (select pg_catalog.count(*) from pg_temp.p9_b1_5_results) <> 34 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_SCENARIO_COUNT_MISMATCH';
  end if;
end;
$count$;

rollback;
