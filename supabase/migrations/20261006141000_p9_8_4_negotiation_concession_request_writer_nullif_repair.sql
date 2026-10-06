begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261006141000_p9_8_4_b1_request_writer_nullif_repair',
    0
  )
);

-- P9 / Bloco 8 / Etapa 8.4 B1
-- Additive repair after 20261006140000 was already applied.
-- PostgreSQL NULLIF is SQL syntax, not a pg_catalog function; schema-qualifying
-- it as pg_catalog.nullif causes runtime error 42883. This migration replaces
-- only the already-installed B1 writer with the same contract and unqualified
-- NULLIF expressions. It does not mutate quotes, versions, approvals or ordinals.

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_negotiation_concessions') is null
     or pg_catalog.to_regprocedure(
       'public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_NULLIF_REPAIR_PRECONDITION_MISSING';
  end if;
end;
$preflight$;

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
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_concession_class text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_concession_class, '')));
  v_concession_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_concession_kind, '')));
  v_authority_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_authority_decision, '')));
  v_origin text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_origin, '')));
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_opportunity public.commercial_opportunities%rowtype;
  v_cycle_lifecycle integer;
  v_message public.messages%rowtype;
  v_current_proposal record;
  v_request_payload jsonb;
  v_request_fingerprint text;
  v_existing public.commercial_negotiation_concessions%rowtype;
  v_inserted public.commercial_negotiation_concessions%rowtype;
begin
  if v_request_role is distinct from 'service_role'
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
     or v_concession_class not in ('normal', 'human_exception')
     or v_concession_kind <> 'discount'
     or p_previous_condition is null
     or p_proposed_condition is null
     or p_counterpart_snapshot is null
     or p_policy_snapshot is null
     or p_authority_snapshot is null
     or p_high_value is null
     or p_high_value_context is null
     or v_authority_decision not in ('allowed', 'human_approval_required', 'blocked', 'unconfigured')
     or v_origin not in ('sales_ai', 'human', 'assistant', 'system')
     or v_operation_key is null
     or pg_catalog.length(v_operation_key) > 200 then
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

  -- The ledger stores a historical snapshot of the canonical transactional
  -- authority result. B1 does not recompute policy here, but it must prove that
  -- the supplied snapshot belongs to this exact request instead of accepting an
  -- unrelated or contradictory authority object.
  if p_authority_snapshot ->> 'action' is distinct from 'apply_discount'
     or p_authority_snapshot ->> 'state' is distinct from v_authority_decision
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

  if (p_authority_snapshot ->> 'requestedDiscountPercent')::numeric
       is distinct from p_requested_discount_percent then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_AUTHORITY_SNAPSHOT_MISMATCH';
  end if;

  -- Preserve the semantic contract of transactional-commercial-authority.
  -- canOffer is strategy-owned for allowed/approval-required decisions and may
  -- be either true or false. The remaining flags must agree with the state.
  if (
       v_authority_decision = 'allowed'
       and (
         (p_authority_snapshot ->> 'canApply')::boolean is distinct from true
         or (p_authority_snapshot ->> 'canRequestApproval')::boolean is distinct from false
         or (p_authority_snapshot ->> 'requiresHumanApproval')::boolean is distinct from false
       )
     )
     or (
       v_authority_decision = 'human_approval_required'
       and (
         (p_authority_snapshot ->> 'canApply')::boolean is distinct from false
         or (p_authority_snapshot ->> 'canRequestApproval')::boolean is distinct from true
         or (p_authority_snapshot ->> 'requiresHumanApproval')::boolean is distinct from true
       )
     )
     or (
       v_authority_decision in ('blocked', 'unconfigured')
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

  v_request_payload := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'negotiation_cycle_id', p_negotiation_cycle_id,
    'quote_id', p_quote_id,
    'quote_version_id', p_quote_version_id,
    'concession_class', v_concession_class,
    'concession_kind', v_concession_kind,
    'previous_condition', p_previous_condition,
    'proposed_condition', p_proposed_condition,
    'requested_discount_percent', p_requested_discount_percent,
    'requested_discount_cents', p_requested_discount_cents,
    'counterpart_snapshot', p_counterpart_snapshot,
    'policy_snapshot', p_policy_snapshot,
    'authority_snapshot', p_authority_snapshot,
    'authority_decision', v_authority_decision,
    'high_value', p_high_value,
    'high_value_context', p_high_value_context,
    'origin', v_origin,
    'source_message_id', p_source_message_id
  );

  v_request_fingerprint := public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(
    v_request_payload
  );

  select concession_row.*
  into v_existing
  from public.commercial_negotiation_concessions concession_row
  where concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id
    and concession_row.operation_key = v_operation_key
  for update;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
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
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_8_4_B1_OPPORTUNITY_NOT_FOUND';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_OPPORTUNITY_SCOPE_MISMATCH';
  end if;

  if v_opportunity.stage is distinct from 'negociacao' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_OPPORTUNITY_NOT_IN_NEGOTIATION';
  end if;

  select lifecycle_event.lifecycle_cycle
  into v_cycle_lifecycle
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.id = p_negotiation_cycle_id
    and lifecycle_event.organization_id = p_organization_id
    and lifecycle_event.store_id = p_store_id
    and lifecycle_event.commercial_opportunity_id = p_commercial_opportunity_id
    and lifecycle_event.lifecycle_cycle = v_opportunity.lifecycle_cycle
    and lifecycle_event.event_type = 'stage_transition'
    and lifecycle_event.new_stage = 'negociacao'
    and lifecycle_event.reason_code in (
      'concrete_offer_required',
      'concrete_quote_objection_required',
      'visit_viable_concrete_offer_required',
      'renegotiation_required'
    );

  if not found
     or v_cycle_lifecycle is distinct from v_opportunity.lifecycle_cycle then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_NEGOTIATION_CYCLE_STALE_OR_OUT_OF_SCOPE';
  end if;

  select proposal.*
  into v_current_proposal
  from public.p9_resolve_current_commercial_proposal_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) proposal;

  if not found
     or v_current_proposal.proposal_state is distinct from 'available'
     or v_current_proposal.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
     or v_current_proposal.current_quote_id is distinct from p_quote_id
     or v_current_proposal.current_quote_version_id is distinct from p_quote_version_id
     or v_current_proposal.version_status not in ('sent', 'superseded')
     or v_current_proposal.version_sent_at is null
     or v_current_proposal.reason_code is distinct from 'current_proposal_authority_valid' then
    raise exception using
      errcode = '23514',
      message = 'P9_8_4_B1_CURRENT_PROPOSAL_MISMATCH';
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

    -- A human/offline request may legitimately have no message. When a message
    -- is supplied by any origin, however, it must be canonical evidence for
    -- this exact opportunity/customer, not merely a message from the same store.
    begin
      perform public.assert_commercial_opportunity_message_evidence(
        p_organization_id,
        p_store_id,
        p_commercial_opportunity_id,
        v_opportunity.customer_id,
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
    v_concession_class,
    v_concession_kind,
    'proposed',
    null,
    p_previous_condition,
    p_proposed_condition,
    p_requested_discount_percent,
    p_requested_discount_cents,
    p_counterpart_snapshot,
    p_policy_snapshot,
    p_authority_snapshot,
    v_authority_decision,
    p_high_value,
    p_high_value_context,
    v_origin,
    p_source_message_id,
    v_operation_key,
    v_request_fingerprint,
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

  select concession_row.*
  into v_existing
  from public.commercial_negotiation_concessions concession_row
  where concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id
    and concession_row.operation_key = v_operation_key
  for update;

  if not found
     or v_existing.request_fingerprint is distinct from v_request_fingerprint then
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

comment on function public.write_commercial_negotiation_concession_request_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, numeric, bigint,
  jsonb, jsonb, jsonb, text, boolean, jsonb, text, uuid, text
) is
  'P9 8.4 B1 system-only request writer. Validates current negotiation cycle and current commercial proposal, computes the request fingerprint in the database, and inserts/replays only status proposed with no ordinal or commercial effect.';

do $postconditions$
declare
  v_proc oid := pg_catalog.to_regprocedure(
    'public.write_commercial_negotiation_concession_request_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,numeric,bigint,jsonb,jsonb,jsonb,text,boolean,jsonb,text,uuid,text)'
  );
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  if v_proc is null
     or not pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('public', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_NULLIF_REPAIR_ACL_MISMATCH';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc_row.proowner),
    proc_row.prosecdef,
    coalesce(proc_row.proconfig, array[]::text[])
  into
    v_owner,
    v_security_definer,
    v_config
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_proc;

  if v_owner is distinct from 'postgres'
     or v_security_definer is distinct from true
     or not (v_config @> array[
       'search_path=pg_catalog, pg_temp, public',
       'row_security=off'
     ]::text[]) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_NULLIF_REPAIR_HARDENING_MISMATCH';
  end if;

  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_proc));

  if pg_catalog.strpos(v_definition, 'pg_catalog.nullif') > 0
     or pg_catalog.strpos(v_definition, 'nullif(pg_catalog.btrim(coalesce(p_operation_key') = 0
     or pg_catalog.strpos(v_definition, 'p9_8_4_b1_authority_snapshot_mismatch') = 0
     or pg_catalog.strpos(v_definition, 'p9_8_4_b1_source_message_context_invalid') = 0
     or pg_catalog.strpos(v_definition, 'p9_8_4_b1_idempotency_key_reused_divergent') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_NULLIF_REPAIR_CONTRACT_MISMATCH';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_negotiation_concessions',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_negotiation_concessions',
       'INSERT'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B1_NULLIF_REPAIR_DIRECT_DML_EXPOSED';
  end if;
end;
$postconditions$;

commit;
