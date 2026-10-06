begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- ============================================================================
-- P9 / Bloco 8 / Etapa 8.4 B1
-- Manual checks for the canonical negotiation concession request writer.
--
-- Fully self-contained and rollback-only:
-- - creates its own organization/store/customer/opportunity/quote fixtures;
-- - never depends on pre-existing DEV business rows;
-- - leaves no durable ledger, quote, message or lifecycle fixture behind.
-- ============================================================================

create temp table pg_temp.p9_b1_manual_results (
  scenario_number integer primary key,
  scenario_name text not null
) on commit drop;

do $preflight$
declare
  v_writer_proc oid;
  v_writer_definition text;
begin
  if pg_catalog.to_regclass('public.commercial_negotiation_concessions') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.messages') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_PRECONDITION_TABLES_REQUIRED';
  end if;

  if pg_catalog.to_regprocedure(
       'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_PRECONDITION_FUNCTIONS_REQUIRED';
  end if;

  v_writer_proc := pg_catalog.to_regprocedure(
    'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)'
  );
  v_writer_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_writer_proc));

  if pg_catalog.strpos(v_writer_definition, 'pg_catalog.nullif') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_NULLIF_REPAIR_REQUIRED';
  end if;
end;
$preflight$;

create or replace function pg_temp.p9_b1_record(
  p_scenario_number integer,
  p_scenario_name text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp.p9_b1_manual_results (
    scenario_number,
    scenario_name
  )
  values (
    p_scenario_number,
    p_scenario_name
  );
end;
$function$;

create or replace function pg_temp.p9_b1_authority_snapshot(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_requested_discount_percent numeric,
  p_state text
)
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'action', 'apply_discount',
    'requestedDiscountPercent', p_requested_discount_percent,
    'state', p_state,
    'canOffer', (p_state in ('allowed', 'human_approval_required')),
    'canApply', (p_state = 'allowed'),
    'canRequestApproval', (p_state = 'human_approval_required'),
    'requiresHumanApproval', (p_state = 'human_approval_required'),
    'scope', pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id::text,
      'storeId', p_store_id::text,
      'commercialOpportunityId', p_commercial_opportunity_id::text,
      'quoteId', p_quote_id::text,
      'quoteVersionId', p_quote_version_id::text
    ),
    'provenance', pg_catalog.jsonb_build_object(
      'source', 'p9_8_4_b1_manual_checks'
    ),
    'reasonCode', case p_state
      when 'allowed' then 'TRANSACTIONAL_AUTHORITY_WITHIN_POLICY'
      when 'human_approval_required' then 'TRANSACTIONAL_AUTHORITY_APPROVAL_REQUIRED'
      when 'blocked' then 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED'
      else 'TRANSACTIONAL_AUTHORITY_POLICY_UNCONFIGURED'
    end
  );
$function$;

create or replace function pg_temp.p9_b1_insert_negotiation_cycle_event(
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
    'p9:b1:fixture:cycle:' || p_label || ':' || v_event_id::text;
  v_source text := 'p9_8_4_b1_manual_fixture';
  v_evidence_type text := 'material_negotiation_discount_request';
  v_evidence_summary text := 'P9 8.4 B1 rollback-only negotiation fixture';
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
      'runner', 'p9.8.4.b1',
      'label', p_label,
      'rollback_only', true
    ),
    v_idempotency_key,
    v_event_key
  );

  return v_event_id;
end;
$function$;

do $manual_checks$
declare
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();

  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_other_store uuid := gen_random_uuid();

  v_customer uuid := gen_random_uuid();
  v_other_customer uuid := gen_random_uuid();
  v_out_customer uuid := gen_random_uuid();

  v_opp uuid := gen_random_uuid();
  v_other_opp uuid := gen_random_uuid();
  v_out_opp uuid := gen_random_uuid();

  v_cycle uuid;
  v_other_cycle uuid;
  v_stale_cycle uuid;

  v_quote uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();

  v_unrelated_lead uuid := gen_random_uuid();
  v_unrelated_conversation uuid := gen_random_uuid();
  v_unrelated_message public.messages;

  v_cross_store_lead uuid := gen_random_uuid();
  v_cross_store_conversation uuid := gen_random_uuid();
  v_cross_store_message public.messages;

  v_bad_org uuid := gen_random_uuid();
  v_missing_opp uuid := gen_random_uuid();
  v_bad_quote uuid := gen_random_uuid();
  v_bad_version uuid := gen_random_uuid();

  v_result record;
  v_first_id uuid;

  v_quote_before jsonb;
  v_quote_version_before jsonb;
  v_quote_after jsonb;
  v_quote_version_after jsonb;

  v_count integer;
  v_bad_authority jsonb;
begin
  -- --------------------------------------------------------------------------
  -- Self-contained fixtures.
  -- --------------------------------------------------------------------------

  insert into public.organizations (
    id,
    name
  )
  values (
    v_org,
    'P9 8.4 B1 Runner Org ' || v_run_id::text
  );

  insert into public.stores (
    id,
    organization_id,
    name,
    created_at
  )
  values
    (
      v_store,
      v_org,
      'P9 8.4 B1 Runner Store',
      v_now
    ),
    (
      v_other_store,
      v_org,
      'P9 8.4 B1 Runner Other Store',
      v_now
    );

  insert into public.customers (
    id,
    organization_id,
    display_name,
    normalized_name
  )
  values
    (
      v_customer,
      v_org,
      'P9 8.4 B1 Customer',
      'p9-8-4-b1-customer-' || pg_catalog.replace(v_run_id::text, '-', '')
    ),
    (
      v_other_customer,
      v_org,
      'P9 8.4 B1 Other Customer',
      'p9-8-4-b1-other-' || pg_catalog.replace(v_run_id::text, '-', '')
    ),
    (
      v_out_customer,
      v_org,
      'P9 8.4 B1 Out Customer',
      'p9-8-4-b1-out-' || pg_catalog.replace(v_run_id::text, '-', '')
    );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values
    (v_org, v_store, v_customer),
    (v_org, v_store, v_other_customer),
    (v_org, v_store, v_out_customer);

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage,
    lifecycle_cycle
  )
  values
    (
      v_opp,
      v_org,
      v_store,
      v_customer,
      'negociacao',
      1
    ),
    (
      v_other_opp,
      v_org,
      v_store,
      v_other_customer,
      'negociacao',
      1
    ),
    (
      v_out_opp,
      v_org,
      v_store,
      v_out_customer,
      'orcamento',
      1
    );

  v_cycle := pg_temp.p9_b1_insert_negotiation_cycle_event(
    v_org,
    v_store,
    v_opp,
    v_customer,
    1,
    'main'
  );

  v_other_cycle := pg_temp.p9_b1_insert_negotiation_cycle_event(
    v_org,
    v_store,
    v_other_opp,
    v_other_customer,
    1,
    'other-opportunity'
  );

  -- Historical/stale cycle evidence for the same opportunity. The B1 writer
  -- must reject it because the current opportunity lifecycle_cycle is 1.
  v_stale_cycle := pg_temp.p9_b1_insert_negotiation_cycle_event(
    v_org,
    v_store,
    v_opp,
    v_customer,
    2,
    'stale'
  );

  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    conversation_id,
    lead_id,
    quote_number,
    title,
    status,
    customer_name,
    customer_phone,
    customer_notes,
    internal_notes,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata
  )
  values (
    v_quote,
    v_org,
    v_store,
    v_opp,
    null,
    null,
    'P984B1-' || pg_catalog.replace(v_quote::text, '-', ''),
    'P9 8.4 B1 Current Proposal',
    'sent',
    'P9 8.4 B1 Customer',
    null,
    null,
    null,
    2000000,
    0,
    2000000,
    null,
    pg_catalog.jsonb_build_object(
      'runner', 'p9.8.4.b1',
      'rollback_only', true
    )
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
    'p9/8-4/b1/' || v_version::text || '.pdf',
    'p9-8-4-b1.pdf',
    'application/pdf',
    100,
    'system',
    pg_catalog.jsonb_build_object(
      'runner', 'p9.8.4.b1'
    ),
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
    'p9_8_4_b1_manual_checks'
  );

  -- Two unrelated messages are deliberately created without a captured
  -- commercial context. One is in the same store, the other in another store.
  insert into public.leads (
    id,
    organization_id,
    store_id,
    name,
    phone,
    state
  )
  values
    (
      v_unrelated_lead,
      v_org,
      v_store,
      'P9 B1 Unrelated Lead',
      '5511' || pg_catalog.right(pg_catalog.replace(v_unrelated_lead::text, '-', ''), 9),
      'novo_lead'
    ),
    (
      v_cross_store_lead,
      v_org,
      v_other_store,
      'P9 B1 Cross Store Lead',
      '5511' || pg_catalog.right(pg_catalog.replace(v_cross_store_lead::text, '-', ''), 9),
      'novo_lead'
    );

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values
    (
      v_unrelated_conversation,
      v_org,
      v_unrelated_lead,
      'open',
      false,
      v_now
    ),
    (
      v_cross_store_conversation,
      v_org,
      v_cross_store_lead,
      'open',
      false,
      v_now
    );

  select *
  into v_unrelated_message
  from public.insert_message(
    v_unrelated_conversation,
    'user',
    'incoming',
    'text',
    'P9 B1 unrelated message',
    'p9-b1-unrelated-' || v_run_id::text,
    null,
    '{}'::jsonb
  );

  select *
  into v_cross_store_message
  from public.insert_message(
    v_cross_store_conversation,
    'user',
    'incoming',
    'text',
    'P9 B1 cross-store message',
    'p9-b1-cross-store-' || v_run_id::text,
    null,
    '{}'::jsonb
  );

  select pg_catalog.to_jsonb(quote_row)
  into v_quote_before
  from public.sales_quotes quote_row
  where quote_row.id = v_quote;

  select pg_catalog.to_jsonb(version_row)
  into v_quote_version_before
  from public.sales_quote_versions version_row
  where version_row.id = v_version;

  -- --------------------------------------------------------------------------
  -- 01 / 02 / 15 / 19
  -- Valid request, proposed status, no ordinal, allowed remains only a snapshot,
  -- and fingerprint is canonical lowercase SHA-256.
  -- --------------------------------------------------------------------------

  select *
  into v_result
  from public.write_commercial_negotiation_concession_request_by_system(
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
    pg_catalog.jsonb_build_object(
      'payment_method', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'method', 'pix'
      ),
      'higher_down_payment', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'minimum_percent', 30
      ),
      'fewer_installments', pg_catalog.jsonb_build_object(
        'state', 'allowed',
        'maximum_installments', 3
      )
    ),
    pg_catalog.jsonb_build_object(
      'schema', 'p19a_discount_counterpart_policy_v1',
      'source', 'manual_check'
    ),
    pg_temp.p9_b1_authority_snapshot(
      v_org,
      v_store,
      v_opp,
      v_quote,
      v_version,
      5,
      'allowed'
    ),
    'allowed',
    false,
    pg_catalog.jsonb_build_object(
      'evaluated_amount_cents', 2000000,
      'enabled', false,
      'result', false
    ),
    'human',
    null,
    'p9-b1-manual-valid-01'
  );

  if v_result.status is distinct from 'proposed'
     or v_result.replayed
     or v_result.authority_decision is distinct from 'allowed'
     or v_result.request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_VALID_CONTRACT_FAILED';
  end if;

  v_first_id := v_result.concession_id;

  select pg_catalog.count(*)::integer
  into v_count
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_first_id
    and concession_row.status = 'proposed'
    and concession_row.concession_number is null;

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_PROPOSED_OR_ORDINAL_FAILED';
  end if;

  perform pg_temp.p9_b1_record(1, 'valid request creates one proposed row');
  perform pg_temp.p9_b1_record(2, 'concession number starts null');
  perform pg_temp.p9_b1_record(15, 'allowed authority remains proposed');
  perform pg_temp.p9_b1_record(19, 'fingerprint is lowercase sha256');

  -- 03 / 04: request writer cannot mutate the quote or quote version.

  select pg_catalog.to_jsonb(quote_row)
  into v_quote_after
  from public.sales_quotes quote_row
  where quote_row.id = v_quote;

  select pg_catalog.to_jsonb(version_row)
  into v_quote_version_after
  from public.sales_quote_versions version_row
  where version_row.id = v_version;

  if v_quote_after is distinct from v_quote_before
     or v_quote_version_after is distinct from v_quote_version_before then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_QUOTE_MUTATION_DETECTED';
  end if;

  perform pg_temp.p9_b1_record(3, 'sales quote remains unchanged');
  perform pg_temp.p9_b1_record(4, 'sales quote version remains unchanged');

  -- 05: exact replay returns the same concession.

  select *
  into v_result
  from public.write_commercial_negotiation_concession_request_by_system(
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
    pg_catalog.jsonb_build_object(
      'payment_method', pg_catalog.jsonb_build_object('state', 'allowed', 'method', 'pix'),
      'higher_down_payment', pg_catalog.jsonb_build_object('state', 'allowed', 'minimum_percent', 30),
      'fewer_installments', pg_catalog.jsonb_build_object('state', 'allowed', 'maximum_installments', 3)
    ),
    pg_catalog.jsonb_build_object('schema', 'p19a_discount_counterpart_policy_v1', 'source', 'manual_check'),
    pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'allowed'),
    'allowed',
    false,
    pg_catalog.jsonb_build_object('evaluated_amount_cents', 2000000, 'enabled', false, 'result', false),
    'human',
    null,
    'p9-b1-manual-valid-01'
  );

  if not v_result.replayed
     or v_result.concession_id is distinct from v_first_id then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_REPLAY_FAILED';
  end if;

  perform pg_temp.p9_b1_record(5, 'same key and payload replay same concession');

  -- 06: same operation key with a divergent semantic payload fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      pg_catalog.jsonb_build_object('price_cents', 2000000),
      pg_catalog.jsonb_build_object('price_cents', 1800000),
      10,
      200000,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 10, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-manual-valid-01'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_DIVERGENT_REPLAY_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_IDEMPOTENCY_KEY_REUSED_DIVERGENT%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(6, 'divergent replay fails closed');

  -- 07: tenant/store mismatch fails before any insert.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_bad_org,
      v_store,
      v_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_bad_org, v_store, v_opp, v_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-org-mismatch'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_ORG_MISMATCH_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_OPPORTUNITY_SCOPE_MISMATCH%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(7, 'organization or store mismatch fails');

  -- 08: nonexistent opportunity fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_missing_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_missing_opp, v_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-opportunity-mismatch'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_OPPORTUNITY_MISMATCH_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_OPPORTUNITY_NOT_FOUND%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(8, 'opportunity mismatch fails');

  -- 09: cycle from another opportunity fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_other_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-other-cycle'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_OTHER_CYCLE_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_NEGOTIATION_CYCLE_STALE_OR_OUT_OF_SCOPE%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(9, 'cycle from another opportunity fails');

  -- 10: stale lifecycle cycle for the same opportunity fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_stale_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-stale-cycle'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_STALE_CYCLE_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_NEGOTIATION_CYCLE_STALE_OR_OUT_OF_SCOPE%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(10, 'stale negotiation cycle fails');

  -- 11: opportunity outside negociacao fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_out_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_out_opp, v_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-out-of-negotiation'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_OUT_OF_NEGOTIATION_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_OPPORTUNITY_NOT_IN_NEGOTIATION%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(11, 'opportunity outside negotiation fails');

  -- 12: non-current quote fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_cycle,
      v_bad_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_bad_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-non-current-quote'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_NON_CURRENT_QUOTE_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_CURRENT_PROPOSAL_MISMATCH%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(12, 'non-current quote fails');

  -- 13: non-current version fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_cycle,
      v_quote,
      v_bad_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_bad_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-non-current-version'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_NON_CURRENT_VERSION_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_CURRENT_PROPOSAL_MISMATCH%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(13, 'non-current quote version fails');

  -- 14: cross-store message fails.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      v_cross_store_message.id,
      'p9-b1-cross-store-message'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_CROSS_STORE_MESSAGE_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_SOURCE_MESSAGE_INVALID%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(14, 'cross-store source message fails');

  -- 16: human approval requirement remains only a proposed request.

  select *
  into v_result
  from public.write_commercial_negotiation_concession_request_by_system(
    v_org,
    v_store,
    v_opp,
    v_cycle,
    v_quote,
    v_version,
    'normal',
    'discount',
    '{}'::jsonb,
    '{}'::jsonb,
    5,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'human_approval_required'),
    'human_approval_required',
    false,
    '{}'::jsonb,
    'human',
    null,
    'p9-b1-human-approval'
  );

  if v_result.status is distinct from 'proposed' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_HUMAN_APPROVAL_AUTHORIZED';
  end if;

  perform pg_temp.p9_b1_record(16, 'human approval required remains proposed');

  -- 17: blocked authority remains a proposed audit request with no effect.

  select *
  into v_result
  from public.write_commercial_negotiation_concession_request_by_system(
    v_org,
    v_store,
    v_opp,
    v_cycle,
    v_quote,
    v_version,
    'normal',
    'discount',
    '{}'::jsonb,
    '{}'::jsonb,
    5,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'blocked'),
    'blocked',
    false,
    '{}'::jsonb,
    'system',
    null,
    'p9-b1-blocked'
  );

  if v_result.status is distinct from 'proposed' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_BLOCKED_EFFECT';
  end if;

  perform pg_temp.p9_b1_record(17, 'blocked authority stays without commercial effect');

  -- 18: human exception remains proposed and never receives an ordinal in B1.

  select *
  into v_result
  from public.write_commercial_negotiation_concession_request_by_system(
    v_org,
    v_store,
    v_opp,
    v_cycle,
    v_quote,
    v_version,
    'human_exception',
    'discount',
    '{}'::jsonb,
    '{}'::jsonb,
    5,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'human_approval_required'),
    'human_approval_required',
    true,
    '{}'::jsonb,
    'human',
    null,
    'p9-b1-human-exception'
  );

  select pg_catalog.count(*)::integer
  into v_count
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = v_result.concession_id
    and concession_row.status = 'proposed'
    and concession_row.concession_number is null;

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_HUMAN_EXCEPTION_ORDINAL_ASSIGNED';
  end if;

  perform pg_temp.p9_b1_record(18, 'human exception starts proposed without ordinal');

  -- 20: direct table DML and the system writer remain unavailable to authenticated.

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
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_AUTHENTICATED_PRIVILEGE_EXPOSED';
  end if;

  perform pg_temp.p9_b1_record(20, 'authenticated cannot write ledger or execute system writer');

  -- 21: a same-store message is not enough. If a human supplies a message, it
  -- must still be canonical evidence for this exact opportunity/customer.

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_temp.p9_b1_authority_snapshot(v_org, v_store, v_opp, v_quote, v_version, 5, 'allowed'),
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      v_unrelated_message.id,
      'p9-b1-human-unrelated-message'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_UNRELATED_HUMAN_MESSAGE_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_SOURCE_MESSAGE_CONTEXT_INVALID%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(21, 'supplied human message must prove opportunity context');

  -- 22: separate authority_decision cannot contradict the canonical snapshot.

  v_bad_authority :=
    pg_temp.p9_b1_authority_snapshot(
      v_org,
      v_store,
      v_opp,
      v_quote,
      v_version,
      5,
      'blocked'
    );

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      v_bad_authority,
      'allowed',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-authority-mismatch'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_AUTHORITY_MISMATCH_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_AUTHORITY_SNAPSHOT_MISMATCH%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(22, 'authority snapshot must match request identity and state');

  -- 23: snapshot flags cannot contradict the canonical authority state.

  v_bad_authority :=
    pg_temp.p9_b1_authority_snapshot(
      v_org,
      v_store,
      v_opp,
      v_quote,
      v_version,
      5,
      'blocked'
    ) || pg_catalog.jsonb_build_object('canApply', true);

  begin
    perform public.write_commercial_negotiation_concession_request_by_system(
      v_org,
      v_store,
      v_opp,
      v_cycle,
      v_quote,
      v_version,
      'normal',
      'discount',
      '{}'::jsonb,
      '{}'::jsonb,
      5,
      null,
      '{}'::jsonb,
      '{}'::jsonb,
      v_bad_authority,
      'blocked',
      false,
      '{}'::jsonb,
      'human',
      null,
      'p9-b1-authority-semantics-invalid'
    );

    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_MANUAL_AUTHORITY_SEMANTICS_ACCEPTED';
  exception
    when others then
      if sqlerrm not like '%P9_8_4_B1_AUTHORITY_SNAPSHOT_SEMANTICS_INVALID%' then
        raise;
      end if;
  end;

  perform pg_temp.p9_b1_record(23, 'authority snapshot flags must match canonical state semantics');

  -- --------------------------------------------------------------------------
  -- Final gate: every scenario must have been recorded.
  -- --------------------------------------------------------------------------

  select pg_catalog.count(*)::integer
  into v_count
  from pg_temp.p9_b1_manual_results;

  if v_count <> 23 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'P9_8_4_B1_MANUAL_SCENARIO_COUNT_%s',
        v_count
      );
  end if;

  raise notice 'P9 8.4 B1 manual checks passed: % scenarios', v_count;
end;
$manual_checks$;

select
  scenario_number,
  scenario_name,
  'PASS'::text as status
from pg_temp.p9_b1_manual_results
order by scenario_number;

rollback;
