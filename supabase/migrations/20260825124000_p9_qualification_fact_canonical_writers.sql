begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b3:qualification-fact-canonical-writers:v1',
    0
  )
);

-- --------------------------------------------------------------------------
-- Preflight
-- --------------------------------------------------------------------------
do $preflight$
declare
  v_signature text;
begin
  if pg_catalog.to_regclass('public.commercial_opportunity_qualification_fact_events') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_qualification_facts_current') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.messages') is null then
    raise exception using
      errcode = 'P0001',
      message = 'qualification fact writer prerequisites are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: assert_commercial_opportunity_message_evidence is required';
  end if;

  foreach v_signature in array array[
    'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
    'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
    'public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      raise exception using
        errcode = 'P0001',
        message = format('qualification fact writer collision detected: %s', v_signature);
    end if;
  end loop;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Canonical internal writer
-- --------------------------------------------------------------------------
create or replace function public.apply_commercial_opportunity_qualification_fact_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_assertion_level text,
  p_source_type text,
  p_source_message_id uuid,
  p_source_conversation_id uuid,
  p_created_by text,
  p_resolves_conflict boolean
)
returns table (
  commercial_opportunity_id uuid,
  fact_key text,
  event_id uuid,
  current_last_event_id uuid,
  current_state text,
  current_value_json jsonb,
  normalized_value_text text,
  value_kind text,
  conflict_values_json jsonb,
  changed boolean,
  outcome text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_fact_key text := nullif(pg_catalog.btrim(coalesce(p_fact_key, '')), '');
  v_assertion_level text := nullif(pg_catalog.btrim(coalesce(p_assertion_level, '')), '');
  v_source_type text := nullif(pg_catalog.btrim(coalesce(p_source_type, '')), '');
  v_created_by text := nullif(pg_catalog.btrim(coalesce(p_created_by, '')), '');
  v_resolves_conflict boolean := coalesce(p_resolves_conflict, false);
  v_value_kind text;
  v_normalized_value_text text;
  v_opportunity public.commercial_opportunities;
  v_current public.commercial_opportunity_qualification_facts_current;
  v_existing_event public.commercial_opportunity_qualification_fact_events;
  v_event public.commercial_opportunity_qualification_fact_events;
  v_message_conversation_id uuid;
  v_message_sender text;
  v_message_direction text;
  v_values_equal boolean := false;
  v_old_candidate jsonb;
  v_new_candidate jsonb;
  v_conflict_values jsonb;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_operation_key is null
     or v_fact_key is null
     or p_value_json is null
     or p_value_json = 'null'::jsonb
     or v_assertion_level is null
     or v_source_type is null
     or v_created_by is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_ARGUMENTS_REQUIRED';
  end if;

  if pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_OPERATION_KEY_INVALID';
  end if;

  if pg_catalog.length(v_created_by) < 3
     or pg_catalog.length(v_created_by) > 120
     or v_created_by !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_CREATED_BY_INVALID';
  end if;

  v_value_kind := case
    when v_fact_key = 'requested_area_m2' then 'number'
    when v_fact_key in (
      'installation_interest',
      'payment_interest',
      'technical_visit_interest'
    ) then 'boolean'
    when v_fact_key in (
      'need_summary',
      'interested_product_reference',
      'space_text',
      'location_text',
      'preferred_period_text',
      'budget_text',
      'decision_context',
      'customer_preferences_text',
      'relevant_objection_text'
    ) then 'text'
    else null
  end;

  if v_value_kind is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_FACT_KEY_INVALID';
  end if;

  if v_assertion_level not in ('inferred', 'confirmed') then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_ASSERTION_INVALID';
  end if;

  if v_source_type not in (
    'incoming_customer_message',
    'crm_manual',
    'system_inference',
    'system_correction',
    'migration_backfill'
  ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_SOURCE_TYPE_INVALID';
  end if;

  if (v_source_type = 'incoming_customer_message' and v_assertion_level <> 'confirmed')
     or (v_source_type = 'crm_manual' and v_assertion_level <> 'confirmed')
     or (v_source_type = 'system_inference' and v_assertion_level <> 'inferred')
     or (v_source_type = 'system_correction' and v_assertion_level <> 'confirmed') then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_SOURCE_ASSERTION_MISMATCH';
  end if;

  if v_resolves_conflict
     and (
       v_assertion_level <> 'confirmed'
       or v_source_type not in (
         'incoming_customer_message',
         'crm_manual',
         'system_correction'
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_RESOLUTION_AUTHORITY_INVALID';
  end if;

  if (p_source_message_id is null) <> (p_source_conversation_id is null) then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_PROVENANCE_PAIR_REQUIRED';
  end if;

  if v_source_type = 'incoming_customer_message'
     and p_source_message_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_INCOMING_PROVENANCE_REQUIRED';
  end if;

  if v_value_kind = 'text' then
    if pg_catalog.jsonb_typeof(p_value_json) <> 'string'
       or pg_catalog.length(pg_catalog.btrim(p_value_json #>> '{}')) = 0 then
      raise exception using
        errcode = '23514',
        message = 'ZION_QFACT_VALUE_PAYLOAD_INVALID';
    end if;

    v_normalized_value_text := pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(p_value_json #>> '{}'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    );
  elsif v_value_kind = 'number' then
    if pg_catalog.jsonb_typeof(p_value_json) <> 'number' then
      raise exception using
        errcode = '23514',
        message = 'ZION_QFACT_VALUE_PAYLOAD_INVALID';
    end if;
  elsif v_value_kind = 'boolean' then
    if pg_catalog.jsonb_typeof(p_value_json) <> 'boolean' then
      raise exception using
        errcode = '23514',
        message = 'ZION_QFACT_VALUE_PAYLOAD_INVALID';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:qfact:'
      || p_organization_id::text
      || ':' || p_store_id::text
      || ':' || p_commercial_opportunity_id::text
      || ':' || v_fact_key,
      0
    )
  );

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for key share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  if p_source_message_id is not null then
    select
      message_row.conversation_id,
      message_row.sender,
      message_row.direction
    into
      v_message_conversation_id,
      v_message_sender,
      v_message_direction
    from public.messages message_row
    where message_row.id = p_source_message_id
      and message_row.organization_id = p_organization_id
      and message_row.store_id = p_store_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'qualification source message not found in scope';
    end if;

    if v_message_conversation_id is distinct from p_source_conversation_id then
      raise exception using
        errcode = '23514',
        message = 'qualification source conversation does not match message';
    end if;

    if v_source_type = 'incoming_customer_message'
       and (
         pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_sender, ''))) <> 'user'
         or pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_direction, ''))) <> 'incoming'
       ) then
      raise exception using
        errcode = '23514',
        message = 'qualification incoming source is not a customer inbound message';
    end if;

    perform public.assert_commercial_opportunity_message_evidence(
      p_organization_id => v_opportunity.organization_id,
      p_store_id => v_opportunity.store_id,
      p_commercial_opportunity_id => v_opportunity.id,
      p_customer_id => v_opportunity.customer_id,
      p_evidence_message_id => p_source_message_id
    );
  end if;

  select current_row.*
  into v_current
  from public.commercial_opportunity_qualification_facts_current current_row
  where current_row.organization_id = v_opportunity.organization_id
    and current_row.store_id = v_opportunity.store_id
    and current_row.commercial_opportunity_id = v_opportunity.id
    and current_row.fact_key = v_fact_key
  for update;

  select event_row.*
  into v_existing_event
  from public.commercial_opportunity_qualification_fact_events event_row
  where event_row.organization_id = v_opportunity.organization_id
    and event_row.store_id = v_opportunity.store_id
    and event_row.commercial_opportunity_id = v_opportunity.id
    and event_row.fact_key = v_fact_key
    and event_row.operation_key = v_operation_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.value_json is distinct from p_value_json
       or v_existing_event.normalized_value_text is distinct from v_normalized_value_text
       or v_existing_event.value_kind is distinct from v_value_kind
       or v_existing_event.assertion_level is distinct from v_assertion_level
       or v_existing_event.source_type is distinct from v_source_type
       or v_existing_event.source_message_id is distinct from p_source_message_id
       or v_existing_event.source_conversation_id is distinct from p_source_conversation_id
       or v_existing_event.created_by is distinct from v_created_by
       or v_existing_event.resolves_conflict is distinct from v_resolves_conflict then
      raise exception using
        errcode = '23505',
        message = 'ZION_QFACT_IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_current.commercial_opportunity_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_QFACT_EVENT_WITHOUT_CURRENT_PROJECTION';
    end if;

    return query
    select
      v_opportunity.id,
      v_fact_key,
      v_existing_event.id,
      v_current.last_event_id,
      v_current.current_state,
      v_current.value_json,
      v_current.normalized_value_text,
      v_current.value_kind,
      v_current.conflict_values_json,
      false,
      case
        when v_current.last_operation_key = v_operation_key
          then 'idempotent_replay_current'
        else 'idempotent_replay_stale'
      end,
      v_current.updated_at;
    return;
  end if;

  if v_resolves_conflict
     and v_current.current_state is distinct from 'conflict' then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_NO_CONFLICT_TO_RESOLVE';
  end if;

  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    value_json,
    normalized_value_text,
    value_kind,
    assertion_level,
    source_type,
    source_message_id,
    source_conversation_id,
    operation_key,
    created_by,
    resolves_conflict
  )
  values (
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_fact_key,
    p_value_json,
    v_normalized_value_text,
    v_value_kind,
    v_assertion_level,
    v_source_type,
    p_source_message_id,
    p_source_conversation_id,
    v_operation_key,
    v_created_by,
    v_resolves_conflict
  )
  returning *
  into v_event;

  v_new_candidate := pg_catalog.jsonb_build_object(
    'event_id', v_event.id,
    'value', v_event.value_json,
    'normalized_value_text', v_event.normalized_value_text,
    'value_kind', v_event.value_kind,
    'source_type', v_event.source_type,
    'source_message_id', v_event.source_message_id,
    'source_conversation_id', v_event.source_conversation_id
  );

  if v_current.commercial_opportunity_id is null then
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,
      store_id,
      commercial_opportunity_id,
      fact_key,
      current_state,
      value_json,
      normalized_value_text,
      value_kind,
      conflict_values_json,
      source_type,
      source_message_id,
      source_conversation_id,
      last_event_id,
      last_operation_key
    )
    values (
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_fact_key,
      v_assertion_level,
      v_event.value_json,
      v_event.normalized_value_text,
      v_event.value_kind,
      null,
      v_event.source_type,
      v_event.source_message_id,
      v_event.source_conversation_id,
      v_event.id,
      v_event.operation_key
    )
    returning *
    into v_current;

    return query
    select
      v_opportunity.id,
      v_fact_key,
      v_event.id,
      v_current.last_event_id,
      v_current.current_state,
      v_current.value_json,
      v_current.normalized_value_text,
      v_current.value_kind,
      v_current.conflict_values_json,
      true,
      case
        when v_assertion_level = 'confirmed' then 'confirmed_created'
        else 'inferred_created'
      end,
      v_current.updated_at;
    return;
  end if;

  if v_current.value_kind is distinct from v_value_kind then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QFACT_CURRENT_VALUE_KIND_MISMATCH';
  end if;

  if v_current.current_state in ('inferred', 'confirmed') then
    v_values_equal := case
      when v_value_kind = 'text'
        then v_current.normalized_value_text is not distinct from v_normalized_value_text
      else v_current.value_json is not distinct from p_value_json
    end;
  end if;

  if v_current.current_state = 'inferred' then
    update public.commercial_opportunity_qualification_facts_current current_row
    set
      current_state = v_assertion_level,
      value_json = v_event.value_json,
      normalized_value_text = v_event.normalized_value_text,
      value_kind = v_event.value_kind,
      conflict_values_json = null,
      source_type = v_event.source_type,
      source_message_id = v_event.source_message_id,
      source_conversation_id = v_event.source_conversation_id,
      last_event_id = v_event.id,
      last_operation_key = v_event.operation_key
    where current_row.organization_id = v_current.organization_id
      and current_row.store_id = v_current.store_id
      and current_row.commercial_opportunity_id = v_current.commercial_opportunity_id
      and current_row.fact_key = v_current.fact_key
    returning *
    into v_current;

    return query
    select
      v_opportunity.id,
      v_fact_key,
      v_event.id,
      v_current.last_event_id,
      v_current.current_state,
      v_current.value_json,
      v_current.normalized_value_text,
      v_current.value_kind,
      v_current.conflict_values_json,
      true,
      case
        when v_assertion_level = 'confirmed' and v_values_equal
          then 'inferred_promoted_confirmed'
        when v_assertion_level = 'confirmed'
          then 'inferred_replaced_by_confirmed'
        when v_values_equal
          then 'inferred_reaffirmed'
        else 'inferred_replaced'
      end,
      v_current.updated_at;
    return;
  end if;

  if v_current.current_state = 'confirmed' then
    if v_assertion_level = 'inferred' then
      return query
      select
        v_opportunity.id,
        v_fact_key,
        v_event.id,
        v_current.last_event_id,
        v_current.current_state,
        v_current.value_json,
        v_current.normalized_value_text,
        v_current.value_kind,
        v_current.conflict_values_json,
        false,
        'inferred_ignored_confirmed',
        v_current.updated_at;
      return;
    end if;

    if v_values_equal then
      update public.commercial_opportunity_qualification_facts_current current_row
      set
        current_state = 'confirmed',
        value_json = v_event.value_json,
        normalized_value_text = v_event.normalized_value_text,
        value_kind = v_event.value_kind,
        conflict_values_json = null,
        source_type = v_event.source_type,
        source_message_id = v_event.source_message_id,
        source_conversation_id = v_event.source_conversation_id,
        last_event_id = v_event.id,
        last_operation_key = v_event.operation_key
      where current_row.organization_id = v_current.organization_id
        and current_row.store_id = v_current.store_id
        and current_row.commercial_opportunity_id = v_current.commercial_opportunity_id
        and current_row.fact_key = v_current.fact_key
      returning *
      into v_current;

      return query
      select
        v_opportunity.id,
        v_fact_key,
        v_event.id,
        v_current.last_event_id,
        v_current.current_state,
        v_current.value_json,
        v_current.normalized_value_text,
        v_current.value_kind,
        v_current.conflict_values_json,
        true,
        'confirmed_reaffirmed',
        v_current.updated_at;
      return;
    end if;

    v_old_candidate := pg_catalog.jsonb_build_object(
      'event_id', v_current.last_event_id,
      'value', v_current.value_json,
      'normalized_value_text', v_current.normalized_value_text,
      'value_kind', v_current.value_kind,
      'source_type', v_current.source_type,
      'source_message_id', v_current.source_message_id,
      'source_conversation_id', v_current.source_conversation_id
    );
    v_conflict_values := pg_catalog.jsonb_build_array(v_old_candidate, v_new_candidate);

    update public.commercial_opportunity_qualification_facts_current current_row
    set
      current_state = 'conflict',
      value_json = null,
      normalized_value_text = null,
      value_kind = v_event.value_kind,
      conflict_values_json = v_conflict_values,
      source_type = v_event.source_type,
      source_message_id = v_event.source_message_id,
      source_conversation_id = v_event.source_conversation_id,
      last_event_id = v_event.id,
      last_operation_key = v_event.operation_key
    where current_row.organization_id = v_current.organization_id
      and current_row.store_id = v_current.store_id
      and current_row.commercial_opportunity_id = v_current.commercial_opportunity_id
      and current_row.fact_key = v_current.fact_key
    returning *
    into v_current;

    return query
    select
      v_opportunity.id,
      v_fact_key,
      v_event.id,
      v_current.last_event_id,
      v_current.current_state,
      v_current.value_json,
      v_current.normalized_value_text,
      v_current.value_kind,
      v_current.conflict_values_json,
      true,
      'confirmed_conflict_created',
      v_current.updated_at;
    return;
  end if;

  if v_current.current_state = 'conflict' then
    if v_assertion_level = 'inferred' then
      return query
      select
        v_opportunity.id,
        v_fact_key,
        v_event.id,
        v_current.last_event_id,
        v_current.current_state,
        v_current.value_json,
        v_current.normalized_value_text,
        v_current.value_kind,
        v_current.conflict_values_json,
        false,
        'inferred_ignored_conflict',
        v_current.updated_at;
      return;
    end if;

    if v_resolves_conflict then
      update public.commercial_opportunity_qualification_facts_current current_row
      set
        current_state = 'confirmed',
        value_json = v_event.value_json,
        normalized_value_text = v_event.normalized_value_text,
        value_kind = v_event.value_kind,
        conflict_values_json = null,
        source_type = v_event.source_type,
        source_message_id = v_event.source_message_id,
        source_conversation_id = v_event.source_conversation_id,
        last_event_id = v_event.id,
        last_operation_key = v_event.operation_key
      where current_row.organization_id = v_current.organization_id
        and current_row.store_id = v_current.store_id
        and current_row.commercial_opportunity_id = v_current.commercial_opportunity_id
        and current_row.fact_key = v_current.fact_key
      returning *
      into v_current;

      return query
      select
        v_opportunity.id,
        v_fact_key,
        v_event.id,
        v_current.last_event_id,
        v_current.current_state,
        v_current.value_json,
        v_current.normalized_value_text,
        v_current.value_kind,
        v_current.conflict_values_json,
        true,
        'conflict_resolved',
        v_current.updated_at;
      return;
    end if;

    v_conflict_values := v_current.conflict_values_json;

    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_conflict_values) candidate_row
      where candidate_row ->> 'value_kind' = v_event.value_kind
        and candidate_row -> 'value' = v_event.value_json
        and coalesce(candidate_row ->> 'normalized_value_text', '') =
            coalesce(v_event.normalized_value_text, '')
    ) then
      v_conflict_values := v_conflict_values || pg_catalog.jsonb_build_array(v_new_candidate);
    end if;

    update public.commercial_opportunity_qualification_facts_current current_row
    set
      current_state = 'conflict',
      value_json = null,
      normalized_value_text = null,
      value_kind = v_event.value_kind,
      conflict_values_json = v_conflict_values,
      source_type = v_event.source_type,
      source_message_id = v_event.source_message_id,
      source_conversation_id = v_event.source_conversation_id,
      last_event_id = v_event.id,
      last_operation_key = v_event.operation_key
    where current_row.organization_id = v_current.organization_id
      and current_row.store_id = v_current.store_id
      and current_row.commercial_opportunity_id = v_current.commercial_opportunity_id
      and current_row.fact_key = v_current.fact_key
    returning *
    into v_current;

    return query
    select
      v_opportunity.id,
      v_fact_key,
      v_event.id,
      v_current.last_event_id,
      v_current.current_state,
      v_current.value_json,
      v_current.normalized_value_text,
      v_current.value_kind,
      v_current.conflict_values_json,
      true,
      'conflict_preserved',
      v_current.updated_at;
    return;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'ZION_QFACT_CURRENT_STATE_UNSUPPORTED';
end;
$function$;

alter function public.apply_commercial_opportunity_qualification_fact_internal(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean
) owner to postgres;

comment on function public.apply_commercial_opportunity_qualification_fact_internal(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean
) is
  'Writer interno canonico de qualification facts. Serializa por opportunity+fact, grava ledger append-only, aplica a matriz inferred/confirmed/conflict e faz replay idempotente sem regressao.';

revoke all on function public.apply_commercial_opportunity_qualification_fact_internal(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- System wrapper: Sales AI/runtime and other server-only producers.
-- --------------------------------------------------------------------------
create or replace function public.write_commercial_opportunity_qualification_fact_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_assertion_level text,
  p_source_type text,
  p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,
  p_created_by text default 'sales_ai',
  p_resolves_conflict boolean default false
)
returns table (
  commercial_opportunity_id uuid,
  fact_key text,
  event_id uuid,
  current_last_event_id uuid,
  current_state text,
  current_value_json jsonb,
  normalized_value_text text,
  value_kind text,
  conflict_values_json jsonb,
  changed boolean,
  outcome text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_source_type text := nullif(pg_catalog.btrim(coalesce(p_source_type, '')), '');
  v_assertion_level text := nullif(pg_catalog.btrim(coalesce(p_assertion_level, '')), '');
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'qualification fact write by system is not authorized';
  end if;

  if v_source_type not in (
    'incoming_customer_message',
    'system_inference',
    'system_correction'
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_QFACT_SYSTEM_SOURCE_NOT_AUTHORIZED';
  end if;

  if (v_source_type = 'system_inference' and v_assertion_level <> 'inferred')
     or (v_source_type <> 'system_inference' and v_assertion_level <> 'confirmed') then
    raise exception using
      errcode = '23514',
      message = 'ZION_QFACT_SYSTEM_ASSERTION_MISMATCH';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_qualification_fact_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_fact_key,
    p_value_json,
    v_assertion_level,
    v_source_type,
    p_source_message_id,
    p_source_conversation_id,
    p_created_by,
    p_resolves_conflict
  );
end;
$function$;

alter function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean
) owner to postgres;

comment on function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean
) is
  'Writer server-only de qualification facts. Autoriza incoming confirmado, inferencia de sistema e correcao de sistema; nunca crm_manual nem migration_backfill.';

revoke all on function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_opportunity_qualification_fact_by_system(
  uuid, uuid, uuid, text, text, jsonb, text, text, uuid, uuid, text, boolean
) to service_role;

-- --------------------------------------------------------------------------
-- Authenticated human wrapper: CRM manual confirmation/correction.
-- --------------------------------------------------------------------------
create or replace function public.write_commercial_opportunity_qualification_fact_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,
  p_resolves_conflict boolean default false
)
returns table (
  commercial_opportunity_id uuid,
  fact_key text,
  event_id uuid,
  current_last_event_id uuid,
  current_state text,
  current_value_json jsonb,
  normalized_value_text text,
  value_kind text,
  conflict_values_json jsonb,
  changed boolean,
  outcome text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'qualification fact write by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using
      errcode = '42501',
      message = 'qualification fact write by user is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_qualification_fact_internal(
    p_request_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_operation_key,
    p_fact_key,
    p_value_json,
    'confirmed',
    'crm_manual',
    p_source_message_id,
    p_source_conversation_id,
    ('user:' || v_user_id::text),
    p_resolves_conflict
  );
end;
$function$;

alter function public.write_commercial_opportunity_qualification_fact_by_user(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, boolean
) owner to postgres;

comment on function public.write_commercial_opportunity_qualification_fact_by_user(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, boolean
) is
  'Writer autenticado de qualification facts para CRM manual. Exige membership ativa e grava sempre fato confirmado com created_by derivado de auth.uid().';

revoke all on function public.write_commercial_opportunity_qualification_fact_by_user(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_opportunity_qualification_fact_by_user(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, boolean
) to authenticated;

-- --------------------------------------------------------------------------
-- Postconditions
-- --------------------------------------------------------------------------
do $postconditions$
declare
  v_internal_oid oid := pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'
  );
  v_system_oid oid := pg_catalog.to_regprocedure(
    'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'
  );
  v_user_oid oid := pg_catalog.to_regprocedure(
    'public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)'
  );
  v_proc_oid oid;
begin
  if v_internal_oid is null or v_system_oid is null or v_user_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: qualification fact writer function is missing';
  end if;

  foreach v_proc_oid in array array[v_internal_oid, v_system_oid, v_user_oid]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      join pg_catalog.pg_roles role_row
        on role_row.oid = proc_row.proowner
      where proc_row.oid = v_proc_oid
        and namespace_row.nspname = 'public'
        and role_row.rolname = 'postgres'
        and proc_row.prosecdef
        and proc_row.provolatile = 'v'
        and exists (
          select 1
          from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
          where config_row = 'search_path=pg_catalog, pg_temp, public'
        )
        and exists (
          select 1
          from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
          where config_row = 'row_security=off'
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: qualification fact writer metadata mismatch';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc proc_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
      ) acl_row
      where proc_row.oid = v_proc_oid
        and acl_row.grantee = 0
        and acl_row.privilege_type = 'EXECUTE'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: qualification fact writer exposes EXECUTE to PUBLIC';
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal qualification fact writer is publicly executable';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system qualification fact writer grants mismatch';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: user qualification fact writer grants mismatch';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_qualification_fact_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_qualification_facts_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.commercial_opportunity_qualification_facts_current',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_qualification_fact_events',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_qualification_facts_current',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'public.commercial_opportunity_qualification_facts_current',
       'UPDATE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct qualification fact table writes were reopened';
  end if;
end;
$postconditions$;

commit;
