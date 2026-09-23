-- P9 / Agenda
-- Separa localizacao geral do endereco completo informado pelo cliente.
--
-- location_text:
--   cidade, bairro, regiao ou localizacao geral.
--
-- customer_address_text:
--   endereco completo/especifico informado pelo cliente.
--
-- Nao altera a matriz canonica inferred/confirmed/conflict.
-- Nao adiciona customer_address_text aos missing qualification groups.

alter table public.commercial_opportunity_qualification_fact_events
  drop constraint if exists p9_qfact_events_fact_key_chk;

alter table public.commercial_opportunity_qualification_fact_events
  add constraint p9_qfact_events_fact_key_chk
  check (
    fact_key in (
      'need_summary',
      'interested_product_reference',
      'space_text',
      'requested_area_m2',
      'location_text',
      'customer_address_text',
      'preferred_period_text',
      'budget_text',
      'decision_context',
      'installation_interest',
      'payment_interest',
      'technical_visit_interest',
      'customer_preferences_text',
      'relevant_objection_text'
    )
  );

alter table public.commercial_opportunity_qualification_fact_events
  drop constraint if exists p9_qfact_events_fact_value_kind_chk;

alter table public.commercial_opportunity_qualification_fact_events
  add constraint p9_qfact_events_fact_value_kind_chk
  check (
    (fact_key = 'requested_area_m2' and value_kind = 'number')
    or (
      fact_key in (
        'installation_interest',
        'payment_interest',
        'technical_visit_interest'
      )
      and value_kind = 'boolean'
    )
    or (
      fact_key in (
        'need_summary',
        'interested_product_reference',
        'space_text',
        'location_text',
        'customer_address_text',
        'preferred_period_text',
        'budget_text',
        'decision_context',
        'customer_preferences_text',
        'relevant_objection_text'
      )
      and value_kind = 'text'
    )
  );

alter table public.commercial_opportunity_qualification_facts_current
  drop constraint if exists p9_qfact_current_fact_key_chk;

alter table public.commercial_opportunity_qualification_facts_current
  add constraint p9_qfact_current_fact_key_chk
  check (
    fact_key in (
      'need_summary',
      'interested_product_reference',
      'space_text',
      'requested_area_m2',
      'location_text',
      'customer_address_text',
      'preferred_period_text',
      'budget_text',
      'decision_context',
      'installation_interest',
      'payment_interest',
      'technical_visit_interest',
      'customer_preferences_text',
      'relevant_objection_text'
    )
  );

alter table public.commercial_opportunity_qualification_facts_current
  drop constraint if exists p9_qfact_current_fact_value_kind_chk;

alter table public.commercial_opportunity_qualification_facts_current
  add constraint p9_qfact_current_fact_value_kind_chk
  check (
    (fact_key = 'requested_area_m2' and value_kind = 'number')
    or (
      fact_key in (
        'installation_interest',
        'payment_interest',
        'technical_visit_interest'
      )
      and value_kind = 'boolean'
    )
    or (
      fact_key in (
        'need_summary',
        'interested_product_reference',
        'space_text',
        'location_text',
        'customer_address_text',
        'preferred_period_text',
        'budget_text',
        'decision_context',
        'customer_preferences_text',
        'relevant_objection_text'
      )
      and value_kind = 'text'
    )
  );

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
      'customer_address_text',
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

create or replace function public.read_commercial_opportunity_qualification_facts_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  known_facts jsonb,
  missing_fact_groups jsonb,
  conflicts jsonb,
  provenance_summary jsonb,
  can_ask_next_question boolean,
  known_fact_count integer,
  missing_group_count integer,
  conflict_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_known_facts jsonb := '[]'::jsonb;
  v_missing_fact_groups jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_provenance_summary jsonb := '{}'::jsonb;
  v_known_fact_count integer := 0;
  v_missing_group_count integer := 0;
  v_conflict_count integer := 0;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_QFACT_READER_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id;

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

  -- Fail closed if the materialized projection no longer matches its last
  -- append-only event. Foundation triggers already prevent this on write; the
  -- reader re-check keeps the read contract safe against later regressions.
  if exists (
    select 1
    from public.commercial_opportunity_qualification_facts_current current_row
    left join public.commercial_opportunity_qualification_fact_events event_row
      on event_row.id = current_row.last_event_id
     and event_row.organization_id = current_row.organization_id
     and event_row.store_id = current_row.store_id
     and event_row.commercial_opportunity_id = current_row.commercial_opportunity_id
     and event_row.fact_key = current_row.fact_key
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
      and (
        event_row.id is null
        or current_row.last_operation_key is distinct from event_row.operation_key
        or current_row.value_kind is distinct from event_row.value_kind
        or current_row.source_type is distinct from event_row.source_type
        or current_row.source_message_id is distinct from event_row.source_message_id
        or current_row.source_conversation_id is distinct from event_row.source_conversation_id
        or (
          current_row.current_state = 'inferred'
          and (
            event_row.assertion_level is distinct from 'inferred'
            or event_row.resolves_conflict
            or current_row.value_json is distinct from event_row.value_json
            or current_row.normalized_value_text is distinct from event_row.normalized_value_text
          )
        )
        or (
          current_row.current_state = 'confirmed'
          and (
            event_row.assertion_level is distinct from 'confirmed'
            or current_row.value_json is distinct from event_row.value_json
            or current_row.normalized_value_text is distinct from event_row.normalized_value_text
          )
        )
        or (
          current_row.current_state = 'conflict'
          and (
            event_row.assertion_level is distinct from 'confirmed'
            or event_row.resolves_conflict
          )
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_QFACT_READER_PROJECTION_INCONSISTENT';
  end if;

  with fact_order(fact_key, sort_order) as (
    values
      ('need_summary'::text, 10),
      ('interested_product_reference'::text, 20),
      ('space_text'::text, 30),
      ('requested_area_m2'::text, 40),
      ('location_text'::text, 50),
      ('customer_address_text'::text, 55),
      ('preferred_period_text'::text, 60),
      ('budget_text'::text, 70),
      ('decision_context'::text, 80),
      ('installation_interest'::text, 90),
      ('payment_interest'::text, 100),
      ('technical_visit_interest'::text, 110),
      ('customer_preferences_text'::text, 120),
      ('relevant_objection_text'::text, 130)
  ), scoped as (
    select current_row.*, fact_order.sort_order
    from public.commercial_opportunity_qualification_facts_current current_row
    join fact_order on fact_order.fact_key = current_row.fact_key
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'factKey', scoped.fact_key,
          'state', scoped.current_state,
          'valueKind', scoped.value_kind,
          'value', scoped.value_json,
          'normalizedValueText', scoped.normalized_value_text,
          'sourceType', scoped.source_type,
          'sourceMessageId', scoped.source_message_id,
          'sourceConversationId', scoped.source_conversation_id,
          'lastEventId', scoped.last_event_id,
          'lastOperationKey', scoped.last_operation_key,
          'updatedAt', scoped.updated_at
        )
        order by scoped.sort_order
      ) filter (where scoped.current_state in ('inferred', 'confirmed')),
      '[]'::jsonb
    ),
    count(*) filter (where scoped.current_state in ('inferred', 'confirmed'))::integer
  into v_known_facts, v_known_fact_count
  from scoped;

  with fact_order(fact_key, sort_order) as (
    values
      ('need_summary'::text, 10),
      ('interested_product_reference'::text, 20),
      ('space_text'::text, 30),
      ('requested_area_m2'::text, 40),
      ('location_text'::text, 50),
      ('customer_address_text'::text, 55),
      ('preferred_period_text'::text, 60),
      ('budget_text'::text, 70),
      ('decision_context'::text, 80),
      ('installation_interest'::text, 90),
      ('payment_interest'::text, 100),
      ('technical_visit_interest'::text, 110),
      ('customer_preferences_text'::text, 120),
      ('relevant_objection_text'::text, 130)
  ), scoped as (
    select current_row.*, fact_order.sort_order
    from public.commercial_opportunity_qualification_facts_current current_row
    join fact_order on fact_order.fact_key = current_row.fact_key
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'factKey', scoped.fact_key,
          'valueKind', scoped.value_kind,
          'candidates', scoped.conflict_values_json,
          'sourceType', scoped.source_type,
          'sourceMessageId', scoped.source_message_id,
          'sourceConversationId', scoped.source_conversation_id,
          'lastEventId', scoped.last_event_id,
          'lastOperationKey', scoped.last_operation_key,
          'updatedAt', scoped.updated_at
        )
        order by scoped.sort_order
      ) filter (where scoped.current_state = 'conflict'),
      '[]'::jsonb
    ),
    count(*) filter (where scoped.current_state = 'conflict')::integer
  into v_conflicts, v_conflict_count
  from scoped;

  with group_defs(group_key, sort_order, fact_keys) as (
    values
      ('need'::text, 10, array['need_summary','interested_product_reference','customer_preferences_text']::text[]),
      ('space'::text, 20, array['space_text','requested_area_m2']::text[]),
      ('location'::text, 30, array['location_text']::text[]),
      ('installation'::text, 40, array['installation_interest']::text[]),
      ('payment'::text, 50, array['payment_interest']::text[])
  ), missing_groups as (
    select
      group_defs.group_key,
      group_defs.sort_order,
      group_defs.fact_keys,
      exists (
        select 1
        from public.commercial_opportunity_qualification_facts_current conflict_row
        where conflict_row.organization_id = v_opportunity.organization_id
          and conflict_row.store_id = v_opportunity.store_id
          and conflict_row.commercial_opportunity_id = v_opportunity.id
          and conflict_row.fact_key = any(group_defs.fact_keys)
          and conflict_row.current_state = 'conflict'
      ) as has_conflict
    from group_defs
    where not exists (
      select 1
      from public.commercial_opportunity_qualification_facts_current known_row
      where known_row.organization_id = v_opportunity.organization_id
        and known_row.store_id = v_opportunity.store_id
        and known_row.commercial_opportunity_id = v_opportunity.id
        and known_row.fact_key = any(group_defs.fact_keys)
        and known_row.current_state in ('inferred', 'confirmed')
    )
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'groupKey', missing_groups.group_key,
          'status', case when missing_groups.has_conflict then 'conflict' else 'missing' end,
          'factKeys', to_jsonb(missing_groups.fact_keys)
        )
        order by missing_groups.sort_order
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_missing_fact_groups, v_missing_group_count
  from missing_groups;

  with scoped as (
    select current_row.*
    from public.commercial_opportunity_qualification_facts_current current_row
    where current_row.organization_id = v_opportunity.organization_id
      and current_row.store_id = v_opportunity.store_id
      and current_row.commercial_opportunity_id = v_opportunity.id
  ), source_counts as (
    select
      scoped.source_type,
      count(*)::integer as item_count
    from scoped
    group by scoped.source_type
  )
  select pg_catalog.jsonb_build_object(
    'knownFactCount', v_known_fact_count,
    'confirmedCount', count(*) filter (where scoped.current_state = 'confirmed'),
    'inferredCount', count(*) filter (where scoped.current_state = 'inferred'),
    'conflictCount', v_conflict_count,
    'messageBackedCount', count(*) filter (where scoped.source_message_id is not null),
    'conversationBackedCount', count(*) filter (where scoped.source_conversation_id is not null),
    'sourceCounts', coalesce(
      (
        select pg_catalog.jsonb_object_agg(source_counts.source_type, source_counts.item_count)
        from source_counts
      ),
      '{}'::jsonb
    )
  )
  into v_provenance_summary
  from scoped;

  return query
  select
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_known_facts,
    v_missing_fact_groups,
    v_conflicts,
    v_provenance_summary,
    (v_missing_group_count > 0 or v_conflict_count > 0),
    v_known_fact_count,
    v_missing_group_count,
    v_conflict_count;
end;
$function$;

do $postconditions$
declare
  v_writer_definition text;
  v_reader_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
            'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_qfact_events_fact_key_chk'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            like '%customer_address_text%'
  ) then
    raise exception 'P9_CUSTOMER_ADDRESS_EVENTS_FACT_KEY_CONSTRAINT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
            'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass
      and constraint_row.conname = 'p9_qfact_events_fact_value_kind_chk'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            like '%customer_address_text%'
  ) then
    raise exception 'P9_CUSTOMER_ADDRESS_EVENTS_VALUE_KIND_CONSTRAINT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
            'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
      and constraint_row.conname = 'p9_qfact_current_fact_key_chk'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            like '%customer_address_text%'
  ) then
    raise exception 'P9_CUSTOMER_ADDRESS_CURRENT_FACT_KEY_CONSTRAINT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
            'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass
      and constraint_row.conname = 'p9_qfact_current_fact_value_kind_chk'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            like '%customer_address_text%'
  ) then
    raise exception 'P9_CUSTOMER_ADDRESS_CURRENT_VALUE_KIND_CONSTRAINT_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'::pg_catalog.regprocedure
  )
  into v_writer_definition;

  if v_writer_definition not like '%customer_address_text%' then
    raise exception 'P9_CUSTOMER_ADDRESS_WRITER_NOT_UPDATED';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)'::pg_catalog.regprocedure
  )
  into v_reader_definition;

  if v_reader_definition not like '%customer_address_text%' then
    raise exception 'P9_CUSTOMER_ADDRESS_READER_NOT_UPDATED';
  end if;

  if v_reader_definition not like '%array[''location_text'']::text[]%' then
    raise exception 'P9_CUSTOMER_ADDRESS_CHANGED_LOCATION_MISSING_GROUP';
  end if;
end;
$postconditions$;