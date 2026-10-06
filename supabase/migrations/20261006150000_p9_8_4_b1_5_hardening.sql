begin;

set local lock_timeout = '10s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:8.4:b1.5:rewrite:v2', 0)
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_negotiation_concessions') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.store_high_value_discount_settings') is null
     or pg_catalog.to_regclass('public.store_discount_settings') is null
     or pg_catalog.to_regclass('public.store_discount_counterpart_policy') is null
     or pg_catalog.to_regclass('public.store_payment_settings') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_CANONICAL_TABLES_REQUIRED';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_CANONICAL_WRITER_PRECONDITIONS_REQUIRED';
  end if;

  if pg_catalog.to_regclass(
       'public.commercial_negotiation_concession_decision_events'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_DECISION_EVENTS_MUST_NOT_EXIST';
  end if;
end;
$preflight$;

-- Existing B1 data must already satisfy the stricter human-exception request
-- contract before the constraints are installed. We fail closed instead of
-- silently rewriting historical ledger rows.
do $existing_rows$
begin
  if exists (
    select 1
    from public.commercial_negotiation_concessions concession_row
    where concession_row.concession_class = 'human_exception'
      and (
        concession_row.origin <> 'human'
        or concession_row.high_value is true
        or concession_row.authority_decision = 'unconfigured'
        or (
          concession_row.authority_decision = 'blocked'
          and concession_row.authority_snapshot ->> 'reasonCode'
            is distinct from 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED'
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_EXISTING_HUMAN_EXCEPTION_ROWS_INCOMPATIBLE';
  end if;
end;
$existing_rows$;

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
      and conname = 'commercial_negotiation_concessions_human_exception_origin_check'
  ) then
    alter table public.commercial_negotiation_concessions
      add constraint commercial_negotiation_concessions_human_exception_origin_check
      check (concession_class <> 'human_exception' or origin = 'human');
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
      and conname = 'commercial_negotiation_concessions_human_exception_high_value_check'
  ) then
    alter table public.commercial_negotiation_concessions
      add constraint commercial_negotiation_concessions_human_exception_high_value_check
      check (concession_class <> 'human_exception' or high_value is false);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
      and conname = 'commercial_negotiation_concessions_human_exception_unconfigured_check'
  ) then
    alter table public.commercial_negotiation_concessions
      add constraint commercial_negotiation_concessions_human_exception_unconfigured_check
      check (concession_class <> 'human_exception' or authority_decision <> 'unconfigured');
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
      and conname = 'commercial_negotiation_concessions_human_exception_blocked_reason_check'
  ) then
    alter table public.commercial_negotiation_concessions
      add constraint commercial_negotiation_concessions_human_exception_blocked_reason_check
      check (
        concession_class <> 'human_exception'
        or authority_decision <> 'blocked'
        or authority_snapshot ->> 'reasonCode' is not distinct from 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED'
      );
  end if;
end;
$constraints$;

create or replace function public.write_commercial_negotiation_concession_request_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_negotiation_cycle_id uuid,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_concession_class text,
  p_concession_kind text,
  p_previous_condition jsonb,
  p_proposed_condition jsonb,
  p_requested_discount_percent numeric,
  p_requested_discount_cents bigint,
  p_counterpart_snapshot jsonb,
  p_policy_snapshot jsonb,
  p_authority_snapshot jsonb,
  p_authority_decision text,
  p_high_value boolean,
  p_high_value_context jsonb,
  p_origin text,
  p_source_message_id uuid,
  p_operation_key text
)
returns table (
  concession_id uuid,
  status text,
  concession_class text,
  authority_decision text,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
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
  v_class text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_concession_class, '')));
  v_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_concession_kind, '')));
  v_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_authority_decision, '')));
  v_origin text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_origin, '')));
  v_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');

  v_opp public.commercial_opportunities%rowtype;
  v_message public.messages%rowtype;
  v_proposal record;
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
  v_hv public.store_high_value_discount_settings%rowtype;
  v_discount public.store_discount_settings%rowtype;
  v_counterpart public.store_discount_counterpart_policy%rowtype;
  v_payment public.store_payment_settings%rowtype;
  v_existing public.commercial_negotiation_concessions%rowtype;
  v_inserted public.commercial_negotiation_concessions%rowtype;

  v_cycle integer;
  v_gross numeric;
  v_hv_found boolean := false;
  v_discount_found boolean := false;
  v_counterpart_found boolean := false;
  v_payment_found boolean := false;
  v_hv_state text;
  v_hv_reason text;
  v_expected_hv jsonb;

  v_payload jsonb;
  v_fingerprint text;

  v_name text;
  v_child_key text;
  v_value jsonb;
  v_method text;
  v_numeric numeric;
  v_integer bigint;
begin
  if v_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'P9_8_4_B1_SYSTEM_WRITER_NOT_AUTHORIZED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_negotiation_cycle_id is null
     or p_quote_id is null
     or p_quote_version_id is null
     or v_class not in ('normal', 'human_exception')
     or v_kind <> 'discount'
     or p_previous_condition is null
     or p_proposed_condition is null
     or p_counterpart_snapshot is null
     or p_policy_snapshot is null
     or p_authority_snapshot is null
     or p_high_value is null
     or p_high_value_context is null
     or v_decision not in ('allowed', 'human_approval_required', 'blocked', 'unconfigured')
     or v_origin not in ('sales_ai', 'human', 'assistant', 'system')
     or v_key is null
     or pg_catalog.length(v_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'P9_8_4_B1_REQUEST_ARGUMENTS_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_previous_condition) <> 'object'
     or pg_catalog.jsonb_typeof(p_proposed_condition) <> 'object'
     or pg_catalog.jsonb_typeof(p_counterpart_snapshot) <> 'object'
     or pg_catalog.jsonb_typeof(p_policy_snapshot) <> 'object'
     or pg_catalog.jsonb_typeof(p_authority_snapshot) <> 'object'
     or pg_catalog.jsonb_typeof(p_high_value_context) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'P9_8_4_B1_SNAPSHOT_OBJECTS_REQUIRED';
  end if;

  if p_requested_discount_percent is null
     or p_requested_discount_percent <= 0
     or p_requested_discount_percent > 100
     or (p_requested_discount_cents is not null and p_requested_discount_cents < 0) then
    raise exception using
      errcode = '22023',
      message = 'P9_8_4_B1_DISCOUNT_INPUTS_INVALID';
  end if;

  if v_class = 'human_exception' and v_origin <> 'human' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_5_HUMAN_EXCEPTION_ORIGIN_INVALID';
  end if;

  if v_class = 'human_exception' and p_high_value is true then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_5_HUMAN_EXCEPTION_HIGH_VALUE_INVALID';
  end if;

  if v_class = 'human_exception' and v_decision = 'unconfigured' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_5_HUMAN_EXCEPTION_UNCONFIGURED_INVALID';
  end if;

  if v_class = 'human_exception'
     and v_decision = 'blocked'
     and p_authority_snapshot ->> 'reasonCode'
       is distinct from 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_5_HUMAN_EXCEPTION_BLOCKED_REASON_INVALID';
  end if;

  if p_authority_snapshot ->> 'action' is distinct from 'apply_discount'
     or p_authority_snapshot ->> 'state' is distinct from v_decision
     or pg_catalog.jsonb_typeof(p_authority_snapshot -> 'requestedDiscountPercent') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_authority_snapshot -> 'canOffer') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_authority_snapshot -> 'canApply') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_authority_snapshot -> 'canRequestApproval') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_authority_snapshot -> 'requiresHumanApproval') is distinct from 'boolean'
     or nullif(pg_catalog.btrim(coalesce(p_authority_snapshot ->> 'reasonCode', '')), '') is null
     or pg_catalog.jsonb_typeof(p_authority_snapshot -> 'scope') is distinct from 'object'
     or p_authority_snapshot #>> '{scope,organizationId}' is distinct from p_organization_id::text
     or p_authority_snapshot #>> '{scope,storeId}' is distinct from p_store_id::text
     or p_authority_snapshot #>> '{scope,commercialOpportunityId}' is distinct from p_commercial_opportunity_id::text
     or p_authority_snapshot #>> '{scope,quoteId}' is distinct from p_quote_id::text
     or p_authority_snapshot #>> '{scope,quoteVersionId}' is distinct from p_quote_version_id::text
     or pg_catalog.jsonb_typeof(p_authority_snapshot -> 'provenance') is distinct from 'object' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_AUTHORITY_SNAPSHOT_MISMATCH';
  end if;

  begin
    if (p_authority_snapshot ->> 'requestedDiscountPercent')::numeric
       is distinct from p_requested_discount_percent then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_AUTHORITY_SNAPSHOT_MISMATCH';
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_AUTHORITY_SNAPSHOT_MISMATCH';
  end;

  if (
       v_decision = 'allowed'
       and (
         (p_authority_snapshot ->> 'canApply')::boolean is distinct from true
         or (p_authority_snapshot ->> 'canRequestApproval')::boolean is distinct from false
         or (p_authority_snapshot ->> 'requiresHumanApproval')::boolean is distinct from false
       )
     )
     or (
       v_decision = 'human_approval_required'
       and (
         (p_authority_snapshot ->> 'canApply')::boolean is distinct from false
         or (p_authority_snapshot ->> 'canRequestApproval')::boolean is distinct from true
         or (p_authority_snapshot ->> 'requiresHumanApproval')::boolean is distinct from true
       )
     )
     or (
       v_decision in ('blocked', 'unconfigured')
       and (
         (p_authority_snapshot ->> 'canOffer')::boolean is distinct from false
         or (p_authority_snapshot ->> 'canApply')::boolean is distinct from false
         or (p_authority_snapshot ->> 'canRequestApproval')::boolean is distinct from false
         or (p_authority_snapshot ->> 'requiresHumanApproval')::boolean is distinct from false
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_AUTHORITY_SNAPSHOT_SEMANTICS_INVALID';
  end if;

  -- Preserve B1 idempotency semantics: an exact replay is resolved from the
  -- immutable request fingerprint before any mutable live Settings or current
  -- proposal are reinterpreted.
  v_payload := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'negotiation_cycle_id', p_negotiation_cycle_id,
    'quote_id', p_quote_id,
    'quote_version_id', p_quote_version_id,
    'concession_class', v_class,
    'concession_kind', v_kind,
    'previous_condition', p_previous_condition,
    'proposed_condition', p_proposed_condition,
    'requested_discount_percent', p_requested_discount_percent,
    'requested_discount_cents', p_requested_discount_cents,
    'counterpart_snapshot', p_counterpart_snapshot,
    'policy_snapshot', p_policy_snapshot,
    'authority_snapshot', p_authority_snapshot,
    'authority_decision', v_decision,
    'high_value', p_high_value,
    'high_value_context', p_high_value_context,
    'origin', v_origin,
    'source_message_id', p_source_message_id
  );

  v_fingerprint :=
    public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(
      v_payload
    );

  select concession_row.*
  into v_existing
  from public.commercial_negotiation_concessions concession_row
  where concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id
    and concession_row.operation_key = v_key
  for update;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'P9_8_4_B1_IDEMPOTENCY_KEY_REUSED_DIVERGENT';
    end if;

    return query
    select
      v_existing.id,
      v_existing.status,
      v_existing.concession_class,
      v_existing.authority_decision,
      v_existing.negotiation_cycle_id,
      v_existing.quote_id,
      v_existing.quote_version_id,
      v_existing.request_fingerprint,
      true;
    return;
  end if;

  select opportunity_row.*
  into v_opp
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_8_4_B1_OPPORTUNITY_NOT_FOUND';
  end if;

  if v_opp.organization_id is distinct from p_organization_id
     or v_opp.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_OPPORTUNITY_SCOPE_MISMATCH';
  end if;

  if v_opp.stage is distinct from 'negociacao' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_OPPORTUNITY_NOT_IN_NEGOTIATION';
  end if;

  select lifecycle_event.lifecycle_cycle
  into v_cycle
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.id = p_negotiation_cycle_id
    and lifecycle_event.organization_id = p_organization_id
    and lifecycle_event.store_id = p_store_id
    and lifecycle_event.commercial_opportunity_id = p_commercial_opportunity_id
    and lifecycle_event.lifecycle_cycle = v_opp.lifecycle_cycle
    and lifecycle_event.event_type = 'stage_transition'
    and lifecycle_event.new_stage = 'negociacao'
    and lifecycle_event.reason_code in (
      'concrete_offer_required',
      'concrete_quote_objection_required',
      'visit_viable_concrete_offer_required',
      'renegotiation_required'
    );

  if not found or v_cycle is distinct from v_opp.lifecycle_cycle then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_NEGOTIATION_CYCLE_STALE_OR_OUT_OF_SCOPE';
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
     or v_proposal.lifecycle_cycle is distinct from v_opp.lifecycle_cycle
     or v_proposal.current_quote_id is distinct from p_quote_id
     or v_proposal.current_quote_version_id is distinct from p_quote_version_id
     or v_proposal.version_status not in ('sent', 'superseded')
     or v_proposal.version_sent_at is null
     or v_proposal.reason_code is distinct from 'current_proposal_authority_valid' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_CURRENT_PROPOSAL_MISMATCH';
  end if;

  select quote_row.*
  into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = p_quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_QUOTE_SCOPE_MISMATCH';
  end if;

  select version_row.*
  into v_version
  from public.sales_quote_versions version_row
  where version_row.id = p_quote_version_id
    and version_row.quote_id = p_quote_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id;

  if not found
     or pg_catalog.jsonb_typeof(v_version.quote_snapshot) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_version.quote_snapshot -> 'quote') is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_version.quote_snapshot #> '{quote,subtotalCents}') is distinct from 'number'
     or v_version.quote_snapshot #>> '{quote,id}' is distinct from p_quote_id::text then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_GROSS_SNAPSHOT_INVALID';
  end if;

  begin
    v_gross := (v_version.quote_snapshot #>> '{quote,subtotalCents}')::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_GROSS_SNAPSHOT_INVALID';
  end;

  if v_gross <= 0
     or v_gross <> pg_catalog.trunc(v_gross)
     or v_gross > 9223372036854775807::numeric then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_GROSS_SNAPSHOT_INVALID';
  end if;

  if p_source_message_id is not null then
    select message_row.*
    into v_message
    from public.messages message_row
    where message_row.id = p_source_message_id
      and message_row.organization_id = p_organization_id
      and message_row.store_id = p_store_id;

    if not found
       or v_message.deleted_at is not null
       or nullif(pg_catalog.btrim(coalesce(v_message.content, '')), '') is null then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_SOURCE_MESSAGE_INVALID';
    end if;

    if v_origin in ('sales_ai', 'assistant', 'system')
       and pg_catalog.lower(pg_catalog.btrim(coalesce(v_message.direction, ''))) <> 'incoming' then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_SOURCE_MESSAGE_NOT_INBOUND';
    end if;

    begin
      perform public.assert_commercial_opportunity_message_evidence(
        p_organization_id,
        p_store_id,
        p_commercial_opportunity_id,
        v_opp.customer_id,
        p_source_message_id
      );
    exception
      when others then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_SOURCE_MESSAGE_CONTEXT_INVALID',
          detail = sqlerrm;
    end;
  end if;

  -- Counterpart request snapshot. The caller selects the dimensions it wants to
  -- use; every selected dimension is validated against live canonical Settings.
  if p_counterpart_snapshot <> '{}'::jsonb then
    select counterpart_row.*
    into v_counterpart
    from public.store_discount_counterpart_policy counterpart_row
    where counterpart_row.organization_id = p_organization_id
      and counterpart_row.store_id = p_store_id;
    v_counterpart_found := found;

    if not v_counterpart_found or v_counterpart.enabled is not true then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_COUNTERPART_POLICY_UNCONFIGURED';
    end if;

    select payment_row.*
    into v_payment
    from public.store_payment_settings payment_row
    where payment_row.organization_id = p_organization_id
      and payment_row.store_id = p_store_id;
    v_payment_found := found;

    if not v_payment_found then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_PAYMENT_SETTINGS_UNCONFIGURED';
    end if;

    for v_name in
      select pg_catalog.jsonb_object_keys(p_counterpart_snapshot)
    loop
      if v_name not in ('payment_method', 'higher_down_payment', 'fewer_installments') then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_COUNTERPART_DIMENSION_UNKNOWN';
      end if;
    end loop;

    if p_counterpart_snapshot ? 'payment_method' then
      v_value := p_counterpart_snapshot -> 'payment_method';

      if pg_catalog.jsonb_typeof(v_value) is distinct from 'object' then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_COUNTERPART_METHOD_INVALID';
      end if;

      for v_child_key in
        select pg_catalog.jsonb_object_keys(v_value)
      loop
        if v_child_key not in ('state', 'method') then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_INVALID';
        end if;
      end loop;

      v_method := pg_catalog.lower(
        pg_catalog.btrim(coalesce(v_value ->> 'method', ''))
      );

      if v_value ->> 'state' is distinct from 'allowed'
         or v_method not in (
           'pix',
           'cartao_credito',
           'cartao_debito',
           'boleto',
           'dinheiro',
           'transferencia',
           'financiamento'
         ) then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_COUNTERPART_METHOD_INVALID';
      end if;

      if not (v_counterpart.allowed_payment_methods @> array[v_method]::text[])
         or not (v_payment.accepted_payment_methods @> array[v_method]::text[]) then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_COUNTERPART_METHOD_UNAUTHORIZED';
      end if;
    end if;

    if p_counterpart_snapshot ? 'higher_down_payment' then
      v_value := p_counterpart_snapshot -> 'higher_down_payment';

      if pg_catalog.jsonb_typeof(v_value) is distinct from 'object' then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID';
      end if;

      for v_child_key in
        select pg_catalog.jsonb_object_keys(v_value)
      loop
        if v_child_key not in (
          'state',
          'minimum_type',
          'minimum_percent',
          'minimum_amount_cents'
        ) then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_INVALID';
        end if;
      end loop;

      if v_value ->> 'state' is distinct from 'allowed'
         or v_counterpart.higher_down_payment_enabled is not true
         or v_counterpart.higher_down_payment_minimum_type not in ('percent', 'fixed') then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID';
      end if;

      if v_value ? 'minimum_type'
         and v_value ->> 'minimum_type'
           is distinct from v_counterpart.higher_down_payment_minimum_type then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
      end if;

      if v_counterpart.higher_down_payment_minimum_type = 'percent' then
        if pg_catalog.jsonb_typeof(v_value -> 'minimum_percent') is distinct from 'number'
           or v_value ? 'minimum_amount_cents' then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
        end if;

        begin
          v_numeric := (v_value ->> 'minimum_percent')::numeric;
        exception
          when invalid_text_representation or numeric_value_out_of_range then
            raise exception using
              errcode = '23514',
              message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
        end;

        if v_numeric is distinct from v_counterpart.higher_down_payment_minimum_percent then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
        end if;
      else
        if pg_catalog.jsonb_typeof(v_value -> 'minimum_amount_cents') is distinct from 'number'
           or v_value ? 'minimum_percent' then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
        end if;

        begin
          v_numeric := (v_value ->> 'minimum_amount_cents')::numeric;
        exception
          when invalid_text_representation or numeric_value_out_of_range then
            raise exception using
              errcode = '23514',
              message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
        end;

        if v_numeric <= 0
           or v_numeric <> pg_catalog.trunc(v_numeric)
           or v_numeric > 9223372036854775807::numeric then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
        end if;

        v_integer := v_numeric::bigint;
        if v_integer is distinct from v_counterpart.higher_down_payment_minimum_amount_cents then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
        end if;
      end if;

      if v_payment.down_payment_mode = 'none' then
        null;
      elsif v_payment.down_payment_mode in ('optional', 'required')
            and v_payment.down_payment_value_type = 'percent'
            and v_payment.down_payment_percent is not null
            and v_payment.down_payment_percent > 0
            and v_payment.down_payment_percent <= 100 then
        if v_counterpart.higher_down_payment_minimum_type <> 'percent'
           or v_counterpart.higher_down_payment_minimum_percent
              <= v_payment.down_payment_percent then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID';
        end if;
      elsif v_payment.down_payment_mode in ('optional', 'required')
            and v_payment.down_payment_value_type = 'fixed'
            and v_payment.down_payment_amount_cents is not null
            and v_payment.down_payment_amount_cents > 0 then
        if v_counterpart.higher_down_payment_minimum_type <> 'fixed'
           or v_counterpart.higher_down_payment_minimum_amount_cents
              <= v_payment.down_payment_amount_cents then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID';
        end if;
      else
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_HIGHER_DOWN_PAYMENT_INVALID';
      end if;
    end if;

    if p_counterpart_snapshot ? 'fewer_installments' then
      v_value := p_counterpart_snapshot -> 'fewer_installments';

      if pg_catalog.jsonb_typeof(v_value) is distinct from 'object' then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_FEWER_INSTALLMENTS_INVALID';
      end if;

      for v_child_key in
        select pg_catalog.jsonb_object_keys(v_value)
      loop
        if v_child_key not in ('state', 'maximum_installments') then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_INVALID';
        end if;
      end loop;

      if v_value ->> 'state' is distinct from 'allowed'
         or pg_catalog.jsonb_typeof(v_value -> 'maximum_installments') is distinct from 'number'
         or v_counterpart.fewer_installments_enabled is not true
         or v_payment.installments_enabled is not true
         or v_payment.max_installments is null
         or v_payment.max_installments < 1
         or v_counterpart.fewer_installments_max_count is null
         or v_counterpart.fewer_installments_max_count < 1
         or v_counterpart.fewer_installments_max_count >= v_payment.max_installments then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_FEWER_INSTALLMENTS_INVALID';
      end if;

      begin
        v_numeric := (v_value ->> 'maximum_installments')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception using
            errcode = '23514',
            message = 'P9_8_4_B1_FEWER_INSTALLMENTS_INVALID';
      end;

      if v_numeric <> pg_catalog.trunc(v_numeric)
         or v_numeric < 1
         or v_numeric > 2147483647::numeric
         or v_numeric::integer is distinct from v_counterpart.fewer_installments_max_count then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B1_COUNTERPART_SNAPSHOT_MISMATCH';
      end if;
    end if;
  end if;

  if p_high_value is true then
    if v_class <> 'normal' then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_5_HIGH_VALUE_CLASS_INVALID';
    end if;

    select high_value_row.*
    into v_hv
    from public.store_high_value_discount_settings high_value_row
    where high_value_row.organization_id = p_organization_id
      and high_value_row.store_id = p_store_id;
    v_hv_found := found;

    select discount_row.*
    into v_discount
    from public.store_discount_settings discount_row
    where discount_row.organization_id = p_organization_id
      and discount_row.store_id = p_store_id;
    v_discount_found := found;

    if not v_hv_found
       or not v_discount_found
       or v_hv.enabled is not true
       or v_hv.threshold_amount_cents is null
       or v_hv.threshold_amount_cents <= 0
       or v_hv.discount_percent is null
       or v_hv.discount_percent <= 0
       or v_hv.discount_percent > 100
       or v_hv.requires_human_approval is null
       or v_hv.requires_human_approval_configured_at is null
       or v_discount.default_discount_percent is null
       or v_discount.default_discount_percent < 0
       or v_discount.default_discount_percent > 100
       or v_discount.max_discount_percent is null
       or v_discount.max_discount_percent < v_discount.default_discount_percent
       or v_discount.max_discount_percent > 100
       or v_discount.discount_autonomy_mode not in (
         'approval_required',
         'default_step_autonomous',
         'within_policy_autonomous'
       ) then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_HIGH_VALUE_SETTINGS_INVALID';
    end if;

    if v_gross < v_hv.threshold_amount_cents then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_HIGH_VALUE_NOT_ELIGIBLE';
    end if;

    if p_requested_discount_percent is distinct from v_hv.discount_percent then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_HIGH_VALUE_REQUESTED_PERCENT_MISMATCH';
    end if;

    if v_hv.requires_human_approval is true then
      v_hv_state := 'human_approval_required';
      v_hv_reason := 'P9_8_4_B1_HIGH_VALUE_REQUIRES_HUMAN';
    elsif v_discount.discount_autonomy_mode = 'approval_required' then
      v_hv_state := 'human_approval_required';
      v_hv_reason := 'P9_8_4_B1_HIGH_VALUE_AUTONOMY_REQUIRES_HUMAN';
    elsif v_discount.discount_autonomy_mode = 'default_step_autonomous'
          and p_requested_discount_percent > v_discount.default_discount_percent then
      v_hv_state := 'human_approval_required';
      v_hv_reason := 'P9_8_4_B1_HIGH_VALUE_ABOVE_DEFAULT_REQUIRES_HUMAN';
    else
      v_hv_state := 'allowed';
      v_hv_reason := 'P9_8_4_B1_HIGH_VALUE_ALLOWED';
    end if;

    v_expected_hv := pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'storeId', p_store_id,
      'quoteId', p_quote_id,
      'quoteVersionId', p_quote_version_id,
      'grossAmountCents', v_gross,
      'enabled', true,
      'thresholdAmountCents', v_hv.threshold_amount_cents,
      'discountPercent', v_hv.discount_percent,
      'requiresHumanApproval', v_hv.requires_human_approval,
      'requiresHumanApprovalConfiguredAt', v_hv.requires_human_approval_configured_at,
      'discountAutonomyMode', v_discount.discount_autonomy_mode,
      'defaultDiscountPercent', v_discount.default_discount_percent,
      'maxDiscountPercent', v_discount.max_discount_percent,
      'requestedDiscountPercent', p_requested_discount_percent,
      'eligible', true,
      'resultingDecision', pg_catalog.jsonb_build_object(
        'state', v_hv_state,
        'reasonCode', v_hv_reason
      )
    );

    if p_high_value_context is distinct from v_expected_hv then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B1_HIGH_VALUE_CONTEXT_MISMATCH';
    end if;
  end if;

  insert into public.commercial_negotiation_concessions (
    organization_id,
    store_id,
    commercial_opportunity_id,
    negotiation_cycle_id,
    quote_id,
    quote_version_id,
    concession_class,
    concession_kind,
    status,
    concession_number,
    previous_condition,
    proposed_condition,
    requested_discount_percent,
    requested_discount_cents,
    counterpart_snapshot,
    policy_snapshot,
    authority_snapshot,
    authority_decision,
    high_value,
    high_value_context,
    origin,
    source_message_id,
    operation_key,
    request_fingerprint,
    approval_status
  )
  values (
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_negotiation_cycle_id,
    p_quote_id,
    p_quote_version_id,
    v_class,
    v_kind,
    'proposed',
    null,
    p_previous_condition,
    p_proposed_condition,
    p_requested_discount_percent,
    p_requested_discount_cents,
    p_counterpart_snapshot,
    p_policy_snapshot,
    p_authority_snapshot,
    v_decision,
    p_high_value,
    p_high_value_context,
    v_origin,
    p_source_message_id,
    v_key,
    v_fingerprint,
    'not_required'
  )
  on conflict (organization_id, store_id, operation_key) do nothing
  returning *
  into v_inserted;

  if v_inserted.id is not null then
    return query
    select
      v_inserted.id,
      v_inserted.status,
      v_inserted.concession_class,
      v_inserted.authority_decision,
      v_inserted.negotiation_cycle_id,
      v_inserted.quote_id,
      v_inserted.quote_version_id,
      v_inserted.request_fingerprint,
      false;
    return;
  end if;

  -- Concurrent replay/race: preserve the original B1 deterministic replay
  -- contract instead of surfacing the unique-index exception.
  select concession_row.*
  into v_existing
  from public.commercial_negotiation_concessions concession_row
  where concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id
    and concession_row.operation_key = v_key
  for update;

  if not found
     or v_existing.request_fingerprint is distinct from v_fingerprint then
    raise exception using
      errcode = '23505',
      message = 'P9_8_4_B1_IDEMPOTENCY_KEY_REUSED_DIVERGENT';
  end if;

  return query
  select
    v_existing.id,
    v_existing.status,
    v_existing.concession_class,
    v_existing.authority_decision,
    v_existing.negotiation_cycle_id,
    v_existing.quote_id,
    v_existing.quote_version_id,
    v_existing.request_fingerprint,
    true;
end;
$function$;

alter function public.write_commercial_negotiation_concession_request_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, numeric, bigint,
  jsonb, jsonb, jsonb, text, boolean, jsonb, text, uuid, text
)
  owner to postgres;

revoke all on function public.write_commercial_negotiation_concession_request_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, numeric, bigint,
  jsonb, jsonb, jsonb, text, boolean, jsonb, text, uuid, text
)
  from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_negotiation_concession_request_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, numeric, bigint,
  jsonb, jsonb, jsonb, text, boolean, jsonb, text, uuid, text
)
  to service_role;

do $postconditions$
declare
  v_proc oid := pg_catalog.to_regprocedure(
    'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)'
  );
  v_owner text;
  v_definer boolean;
  v_config text[];
begin
  if v_proc is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_WRITER_MISSING';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc_row.proowner),
    proc_row.prosecdef,
    coalesce(proc_row.proconfig, array[]::text[])
  into v_owner, v_definer, v_config
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_proc;

  if v_owner is distinct from 'postgres'
     or v_definer is distinct from true
     or not (
       v_config @> array[
         'search_path=pg_catalog, pg_temp, public',
         'row_security=off'
       ]::text[]
     )
     or not pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('public', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_WRITER_SECURITY_CONTRACT_INVALID';
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
      message = 'P9_8_4_B1_5_LEDGER_DIRECT_DML_EXPOSED';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint
       where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and conname = 'commercial_negotiation_concessions_human_exception_origin_check'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint
       where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and conname = 'commercial_negotiation_concessions_human_exception_high_value_check'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint
       where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and conname = 'commercial_negotiation_concessions_human_exception_unconfigured_check'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint
       where conrelid = 'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and conname = 'commercial_negotiation_concessions_human_exception_blocked_reason_check'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_HARDENING_CONSTRAINTS_MISSING';
  end if;

  if pg_catalog.to_regclass(
       'public.commercial_negotiation_concession_decision_events'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_5_DECISION_EVENTS_CREATED';
  end if;
end;
$postconditions$;

commit;
