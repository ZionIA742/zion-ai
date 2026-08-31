begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20260831113000_p9_commercial_message_intent_resolution_canonical_writer',
    0
  )
);

do $preflight$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.create_commercial_opportunity_with_context_by_system(uuid,uuid,uuid,uuid,uuid,uuid)',
    'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)',
    'public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamptz)',
    'public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamptz)',
    'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: required function %s is missing',
          v_signature
        );
    end if;
  end loop;

  if pg_catalog.to_regclass('public.commercial_message_intent_resolution_events') is null
     or pg_catalog.to_regclass('public.commercial_message_intent_resolution_current') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial message intent resolution foundation is missing';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: extensions.digest(bytea,text) is missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.write_commercial_message_intent_resolution_internal(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical message intent resolution writer already exists';
  end if;
end;
$preflight$;

create or replace function public.write_commercial_message_intent_resolution_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_anchor_message_id uuid,
  p_customer_id uuid,
  p_lead_customer_link_id uuid,
  p_operation_key text,
  p_decision_kind text,
  p_reason_code text,
  p_resolved_opportunity_id uuid default null,
  p_related_opportunity_id uuid default null,
  p_actor_type text default 'ai',
  p_metadata jsonb default '{}'::jsonb,
  p_created_by text default 'sales_ai.intent_resolution'
)
returns table (
  event_id uuid,
  decision_kind text,
  resolved_opportunity_id uuid,
  related_opportunity_id uuid,
  relation_type text,
  opportunity_outcome text,
  context_outcome text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_decision_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_decision_kind, '')));
  v_reason_code text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason_code, '')));
  v_actor_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_actor_type, '')));
  v_created_by text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_created_by, '')));
  v_user_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_relation_type text;
  v_anchor public.messages;
  v_arrival_link public.commercial_session_context_links;
  v_active_link public.commercial_session_context_links;
  v_existing_event public.commercial_message_intent_resolution_events;
  v_current public.commercial_message_intent_resolution_current;
  v_current_event public.commercial_message_intent_resolution_events;
  v_resolved public.commercial_opportunities;
  v_related public.commercial_opportunities;
  v_loss_event public.commercial_opportunity_lifecycle_events;
  v_created_opportunity record;
  v_reopen record;
  v_context_row public.commercial_session_context_links;
  v_previous_context_opportunity_id uuid;
  v_supersedes_event_id uuid;
  v_event_key text;
  v_event_id uuid;
  v_opportunity_outcome text := 'no_opportunity_mutation';
  v_context_outcome text := 'no_context_mutation';
  v_final_metadata jsonb;
  v_reopen_target_stage text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_anchor_message_id is null
     or p_customer_id is null
     or p_lead_customer_link_id is null
     or v_operation_key is null
     or pg_catalog.length(v_operation_key) > 200
     or v_reason_code = ''
     or v_created_by = '' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CMIR_WRITE_INPUT_INVALID';
  end if;

  if v_decision_kind not in (
    'continue_same_intent',
    'reopen_same_intent',
    'new_independent_opportunity',
    'repurchase',
    'addendum',
    'needs_clarification',
    'structural_ambiguity'
  ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_CMIR_DECISION_KIND_INVALID';
  end if;

  if v_actor_type not in ('ai', 'system_rule') then
    raise exception using
      errcode = '22023',
      message = 'ZION_CMIR_SYSTEM_ACTOR_INVALID';
  end if;

  if v_reason_code !~ '^[a-z0-9_:.\/-]{3,120}$'
     or v_created_by !~ '^[a-z0-9_:.\/-]{3,120}$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CMIR_REASON_OR_SOURCE_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(v_user_metadata) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'ZION_CMIR_METADATA_INVALID';
  end if;

  if v_user_metadata ?| array[
       'commercial_consequence',
       'context_consequence',
       'canonical_writer',
       'relation_type'
     ] then
    raise exception using
      errcode = '22023',
      message = 'ZION_CMIR_METADATA_RESERVED_KEY';
  end if;

  if v_decision_kind in (
       'continue_same_intent',
       'reopen_same_intent',
       'new_independent_opportunity'
     ) then
    if p_resolved_opportunity_id is null
       or p_related_opportunity_id is not null then
      raise exception using
        errcode = '22023',
        message = 'ZION_CMIR_DECISION_SHAPE_INVALID';
    end if;
    v_relation_type := null;
  elsif v_decision_kind = 'repurchase' then
    if p_resolved_opportunity_id is null
       or p_related_opportunity_id is null
       or p_resolved_opportunity_id = p_related_opportunity_id then
      raise exception using
        errcode = '22023',
        message = 'ZION_CMIR_DECISION_SHAPE_INVALID';
    end if;
    v_relation_type := 'repurchase_of';
  elsif v_decision_kind = 'addendum' then
    if p_resolved_opportunity_id is null
       or p_related_opportunity_id is null
       or p_resolved_opportunity_id = p_related_opportunity_id then
      raise exception using
        errcode = '22023',
        message = 'ZION_CMIR_DECISION_SHAPE_INVALID';
    end if;
    v_relation_type := 'addendum_to';
  else
    if p_resolved_opportunity_id is not null
       or p_related_opportunity_id is not null then
      raise exception using
        errcode = '22023',
        message = 'ZION_CMIR_DECISION_SHAPE_INVALID';
    end if;
    v_relation_type := null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:cmir-writer:v1:' ||
      p_organization_id::text || ':' ||
      p_store_id::text || ':' ||
      p_anchor_message_id::text,
      0
    )
  );

  select message_row.*
  into v_anchor
  from public.messages message_row
  where message_row.id = p_anchor_message_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'ZION_CMIR_ANCHOR_MESSAGE_NOT_FOUND';
  end if;

  if v_anchor.organization_id is distinct from p_organization_id
     or v_anchor.store_id is distinct from p_store_id
     or v_anchor.sender <> 'user'
     or v_anchor.direction <> 'incoming'
     or v_anchor.conversation_id is null
     or v_anchor.conversation_session_id is null
     or v_anchor.lead_id is null
     or v_anchor.commercial_context_capture_state not in ('captured', 'pending_context') then
    raise exception using
      errcode = '23514',
      message = 'ZION_CMIR_ANCHOR_MESSAGE_SCOPE_INVALID';
  end if;

  perform 1
  from public.conversation_sessions session_row
  where session_row.id = v_anchor.conversation_session_id
    and session_row.organization_id = p_organization_id
    and session_row.store_id = p_store_id
    and session_row.conversation_id = v_anchor.conversation_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_CMIR_CONVERSATION_SESSION_SCOPE_INVALID';
  end if;

  perform 1
  from public.lead_customer_links lead_link_row
  where lead_link_row.id = p_lead_customer_link_id
    and lead_link_row.organization_id = p_organization_id
    and lead_link_row.store_id = p_store_id
    and lead_link_row.customer_id = p_customer_id
    and lead_link_row.lead_id = v_anchor.lead_id
    and lead_link_row.status = 'active'
    and lead_link_row.unlinked_at is null
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_CMIR_LEAD_CUSTOMER_LINK_SCOPE_INVALID';
  end if;

  if v_anchor.commercial_context_capture_state = 'captured' then
    if v_anchor.commercial_session_context_link_id is null then
      raise exception using
        errcode = '23514',
        message = 'ZION_CMIR_CAPTURED_SNAPSHOT_INVALID';
    end if;

    select context_row.*
    into v_arrival_link
    from public.commercial_session_context_links context_row
    where context_row.id = v_anchor.commercial_session_context_link_id
      and context_row.organization_id = p_organization_id
      and context_row.store_id = p_store_id
      and context_row.conversation_session_id = v_anchor.conversation_session_id;

    if not found
       or v_arrival_link.customer_id is distinct from p_customer_id
       or v_arrival_link.lead_customer_link_id is distinct from p_lead_customer_link_id then
      raise exception using
        errcode = '23514',
        message = 'ZION_CMIR_CAPTURED_SNAPSHOT_INVALID';
    end if;

    v_previous_context_opportunity_id := v_arrival_link.commercial_opportunity_id;
  else
    if v_anchor.commercial_session_context_link_id is not null then
      raise exception using
        errcode = '23514',
        message = 'ZION_CMIR_PENDING_SNAPSHOT_INVALID';
    end if;
    v_previous_context_opportunity_id := null;
  end if;

  select current_row.*
  into v_current
  from public.commercial_message_intent_resolution_current current_row
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.anchor_message_id = p_anchor_message_id
  for update;

  if found then
    select event_row.*
    into v_current_event
    from public.commercial_message_intent_resolution_events event_row
    where event_row.id = v_current.current_event_id
      and event_row.organization_id = p_organization_id
      and event_row.store_id = p_store_id
      and event_row.anchor_message_id = p_anchor_message_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CMIR_CURRENT_EVENT_CORRUPT';
    end if;
  end if;

  select event_row.*
  into v_existing_event
  from public.commercial_message_intent_resolution_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.anchor_message_id = p_anchor_message_id
    and event_row.operation_key = v_operation_key
  for update;

  if found then
    v_event_key := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'anchor_message_id', p_anchor_message_id,
            'conversation_id', v_anchor.conversation_id,
            'conversation_session_id', v_anchor.conversation_session_id,
            'customer_id', p_customer_id,
            'lead_customer_link_id', p_lead_customer_link_id,
            'previous_context_opportunity_id', v_previous_context_opportunity_id,
            'resolved_opportunity_id', p_resolved_opportunity_id,
            'related_opportunity_id', p_related_opportunity_id,
            'relation_type', v_relation_type,
            'decision_kind', v_decision_kind,
            'reason_code', v_reason_code,
            'operation_key', v_operation_key,
            'supersedes_event_id', v_existing_event.supersedes_event_id,
            'actor_type', v_actor_type,
            'created_by', v_created_by,
            'metadata', v_user_metadata
          )::text,
          'UTF8'::name
        ),
        'sha256'::text
      ),
      'hex'::text
    );

    if v_existing_event.event_key is distinct from v_event_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_CMIR_IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_current.current_event_id is not null
       and v_current.current_event_id is distinct from v_existing_event.id then
      raise exception using
        errcode = '23505',
        message = 'ZION_CMIR_IDEMPOTENT_REPLAY_OBSOLETE';
    end if;

    return query
    select
      v_existing_event.id,
      v_existing_event.decision_kind,
      v_existing_event.resolved_opportunity_id,
      v_existing_event.related_opportunity_id,
      v_existing_event.relation_type,
      coalesce(
        v_existing_event.metadata ->> 'commercial_consequence',
        'unknown_replayed_consequence'
      ),
      coalesce(
        v_existing_event.metadata ->> 'context_consequence',
        'unknown_replayed_context'
      ),
      true;
    return;
  end if;

  if v_current_event.id is not null then
    if v_current_event.decision_kind not in (
         'needs_clarification',
         'structural_ambiguity'
       ) then
      raise exception using
        errcode = '23514',
        message = 'ZION_CMIR_RESOLVED_DECISION_IMMUTABLE_FOR_SYSTEM';
    end if;
    v_supersedes_event_id := v_current_event.id;
  else
    v_supersedes_event_id := null;
  end if;

  if v_decision_kind in ('continue_same_intent', 'reopen_same_intent') then
    select opportunity_row.*
    into v_resolved
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = p_resolved_opportunity_id
    for update;

    if not found
       or v_resolved.organization_id is distinct from p_organization_id
       or v_resolved.store_id is distinct from p_store_id
       or v_resolved.customer_id is distinct from p_customer_id then
      raise exception using
        errcode = '23514',
        message = 'ZION_CMIR_RESOLVED_OPPORTUNITY_SCOPE_INVALID';
    end if;

    if v_previous_context_opportunity_id is not null
       and p_resolved_opportunity_id is distinct from v_previous_context_opportunity_id then
      raise exception using
        errcode = '23514',
        message = 'ZION_CMIR_SAME_INTENT_MUST_MATCH_ARRIVAL_CONTEXT';
    end if;

    if v_decision_kind = 'continue_same_intent' then
      if v_resolved.stage in ('perdido', 'concluido_sem_mais_acoes') then
        raise exception using
          errcode = '23514',
          message = 'ZION_CMIR_CONTINUE_REQUIRES_OPEN_OPPORTUNITY';
      end if;
      v_opportunity_outcome := 'continued_existing_opportunity';
    else
      if v_resolved.stage <> 'perdido'
         or v_resolved.current_loss_event_id is null then
        raise exception using
          errcode = '23514',
          message = 'ZION_CMIR_REOPEN_REQUIRES_LOST_OPPORTUNITY';
      end if;

      select lifecycle_event.*
      into v_loss_event
      from public.commercial_opportunity_lifecycle_events lifecycle_event
      where lifecycle_event.id = v_resolved.current_loss_event_id
        and lifecycle_event.organization_id = p_organization_id
        and lifecycle_event.store_id = p_store_id
        and lifecycle_event.commercial_opportunity_id = v_resolved.id
        and lifecycle_event.customer_id = p_customer_id
        and lifecycle_event.lifecycle_cycle = v_resolved.lifecycle_cycle
        and lifecycle_event.event_type = 'marked_lost';

      if not found
         or v_loss_event.previous_stage is null
         or v_loss_event.previous_stage in ('perdido', 'concluido_sem_mais_acoes') then
        raise exception using
          errcode = '23514',
          message = 'ZION_CMIR_REOPEN_TARGET_NOT_PROVEN';
      end if;

      v_reopen_target_stage := v_loss_event.previous_stage;

      select *
      into v_reopen
      from public.reopen_commercial_opportunity_by_system(
        p_organization_id,
        p_store_id,
        v_resolved.id,
        'cmir-reopen:' || p_anchor_message_id::text || ':' || v_operation_key,
        v_reopen_target_stage,
        'same intent proven by canonical inbound intent resolution',
        'system_intent_resolution'
      )
      limit 1;

      if v_reopen.commercial_opportunity_id is distinct from v_resolved.id
         or v_reopen.stage is distinct from v_reopen_target_stage then
        raise exception using
          errcode = 'P0001',
          message = 'ZION_CMIR_REOPEN_DID_NOT_CONVERGE';
      end if;

      v_opportunity_outcome := 'reopened_existing_opportunity';
    end if;
  elsif v_decision_kind in (
    'new_independent_opportunity',
    'repurchase',
    'addendum'
  ) then
    if exists (
      select 1
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = p_resolved_opportunity_id
    ) then
      raise exception using
        errcode = '23505',
        message = 'ZION_CMIR_NEW_OPPORTUNITY_ID_ALREADY_EXISTS';
    end if;

    if v_previous_context_opportunity_id is not null
       and p_resolved_opportunity_id = v_previous_context_opportunity_id then
      raise exception using
        errcode = '23514',
        message = 'ZION_CMIR_NEW_OPPORTUNITY_MUST_DIFFER_FROM_ARRIVAL_CONTEXT';
    end if;

    if v_decision_kind in ('repurchase', 'addendum') then
      select opportunity_row.*
      into v_related
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = p_related_opportunity_id
      for update;

      if not found
         or v_related.organization_id is distinct from p_organization_id
         or v_related.store_id is distinct from p_store_id
         or v_related.customer_id is distinct from p_customer_id then
        raise exception using
          errcode = '23514',
          message = 'ZION_CMIR_RELATED_OPPORTUNITY_SCOPE_INVALID';
      end if;

      if v_related.stage not in (
        'fechamento_pagamento',
        'instalacao_entrega',
        'pos_venda',
        'concluido_sem_mais_acoes'
      ) then
        raise exception using
          errcode = '23514',
          message = 'ZION_CMIR_RELATED_OPPORTUNITY_NOT_COMMERCIALLY_COMMITTED';
      end if;
    end if;

    select *
    into v_created_opportunity
    from public.create_commercial_opportunity_with_context_by_system(
      p_organization_id,
      p_store_id,
      p_customer_id,
      p_resolved_opportunity_id,
      v_anchor.lead_id,
      v_anchor.conversation_id
    )
    limit 1;

    if v_created_opportunity.commercial_opportunity_id
         is distinct from p_resolved_opportunity_id
       or v_created_opportunity.stage is distinct from 'novo_lead' then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CMIR_NEW_OPPORTUNITY_DID_NOT_CONVERGE';
    end if;

    if v_decision_kind = 'new_independent_opportunity' then
      v_opportunity_outcome := 'created_new_independent_opportunity';
    elsif v_decision_kind = 'repurchase' then
      v_opportunity_outcome := 'created_repurchase_opportunity';
    else
      v_opportunity_outcome := 'created_addendum_opportunity';
    end if;
  else
    v_opportunity_outcome := 'ambiguity_no_opportunity_mutation';
  end if;

  if p_resolved_opportunity_id is not null then
    select active_row.*
    into v_active_link
    from public.commercial_session_context_links active_row
    where active_row.organization_id = p_organization_id
      and active_row.store_id = p_store_id
      and active_row.conversation_session_id = v_anchor.conversation_session_id
      and active_row.status = 'active'
    for update;

    if found then
      if v_active_link.customer_id is distinct from p_customer_id
         or v_active_link.lead_customer_link_id
              is distinct from p_lead_customer_link_id then
        v_context_outcome := 'stale_context_preserved_identity_mismatch';
      elsif v_active_link.commercial_opportunity_id
              = p_resolved_opportunity_id then
        v_context_outcome := 'context_already_resolved_opportunity';
      elsif v_anchor.commercial_context_capture_state = 'captured'
            and v_active_link.id
                = v_anchor.commercial_session_context_link_id then
        select *
        into v_context_row
        from public.replace_commercial_session_context_link(
          v_active_link.id,
          p_organization_id,
          p_store_id,
          p_customer_id,
          p_resolved_opportunity_id,
          p_lead_customer_link_id,
          'system',
          'system',
          null,
          p_anchor_message_id::text,
          'cmir-context:' || p_anchor_message_id::text || ':' || v_operation_key,
          null,
          pg_catalog.jsonb_build_object(
            'intent_resolution_operation_key', v_operation_key,
            'intent_resolution_decision_kind', v_decision_kind
          ),
          'semantic_intent_resolution',
          'Canonical message intent resolution changed the live commercial opportunity.',
          pg_catalog.jsonb_build_object(
            'anchor_message_id', p_anchor_message_id,
            'resolved_opportunity_id', p_resolved_opportunity_id
          ),
          null
        );

        if v_context_row.commercial_opportunity_id
             is distinct from p_resolved_opportunity_id
           or v_context_row.status <> 'active' then
          raise exception using
            errcode = 'P0001',
            message = 'ZION_CMIR_CONTEXT_REPLACEMENT_DID_NOT_CONVERGE';
        end if;

        v_context_outcome := 'arrival_context_replaced';
      else
        v_context_outcome := 'stale_newer_context_preserved';
      end if;
    else
      if v_anchor.commercial_context_capture_state = 'pending_context' then
        select *
        into v_context_row
        from public.link_commercial_session_context(
          p_organization_id,
          p_store_id,
          v_anchor.conversation_session_id,
          p_customer_id,
          p_resolved_opportunity_id,
          p_lead_customer_link_id,
          'system',
          'system',
          null,
          p_anchor_message_id::text,
          'cmir-context:' || p_anchor_message_id::text || ':' || v_operation_key,
          null,
          pg_catalog.jsonb_build_object(
            'intent_resolution_operation_key', v_operation_key,
            'intent_resolution_decision_kind', v_decision_kind
          ),
          null
        );

        if v_context_row.commercial_opportunity_id
             is distinct from p_resolved_opportunity_id
           or v_context_row.status <> 'active' then
          raise exception using
            errcode = 'P0001',
            message = 'ZION_CMIR_CONTEXT_LINK_DID_NOT_CONVERGE';
        end if;

        v_context_outcome := 'pending_context_linked';
      else
        v_context_outcome := 'inactive_arrival_context_not_resurrected';
      end if;
    end if;
  else
    v_context_outcome := 'ambiguity_no_context_mutation';
  end if;

  v_event_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'organization_id', p_organization_id,
          'store_id', p_store_id,
          'anchor_message_id', p_anchor_message_id,
          'conversation_id', v_anchor.conversation_id,
          'conversation_session_id', v_anchor.conversation_session_id,
          'customer_id', p_customer_id,
          'lead_customer_link_id', p_lead_customer_link_id,
          'previous_context_opportunity_id', v_previous_context_opportunity_id,
          'resolved_opportunity_id', p_resolved_opportunity_id,
          'related_opportunity_id', p_related_opportunity_id,
          'relation_type', v_relation_type,
          'decision_kind', v_decision_kind,
          'reason_code', v_reason_code,
          'operation_key', v_operation_key,
          'supersedes_event_id', v_supersedes_event_id,
          'actor_type', v_actor_type,
          'created_by', v_created_by,
          'metadata', v_user_metadata
        )::text,
        'UTF8'::name
      ),
      'sha256'::text
    ),
    'hex'::text
  );

  v_final_metadata := v_user_metadata || pg_catalog.jsonb_build_object(
    'canonical_writer', 'p9_cmir_v1',
    'relation_type', v_relation_type,
    'commercial_consequence', v_opportunity_outcome,
    'context_consequence', v_context_outcome
  );

  insert into public.commercial_message_intent_resolution_events (
    organization_id,
    store_id,
    anchor_message_id,
    conversation_id,
    conversation_session_id,
    customer_id,
    lead_customer_link_id,
    previous_context_opportunity_id,
    resolved_opportunity_id,
    related_opportunity_id,
    relation_type,
    decision_kind,
    reason_code,
    operation_key,
    event_key,
    supersedes_event_id,
    actor_type,
    actor_user_id,
    created_by,
    metadata
  )
  values (
    p_organization_id,
    p_store_id,
    p_anchor_message_id,
    v_anchor.conversation_id,
    v_anchor.conversation_session_id,
    p_customer_id,
    p_lead_customer_link_id,
    v_previous_context_opportunity_id,
    p_resolved_opportunity_id,
    p_related_opportunity_id,
    v_relation_type,
    v_decision_kind,
    v_reason_code,
    v_operation_key,
    v_event_key,
    v_supersedes_event_id,
    v_actor_type,
    null,
    v_created_by,
    v_final_metadata
  )
  returning id into v_event_id;

  if v_supersedes_event_id is null then
    insert into public.commercial_message_intent_resolution_current (
      organization_id,
      store_id,
      anchor_message_id,
      current_event_id,
      last_operation_key
    )
    values (
      p_organization_id,
      p_store_id,
      p_anchor_message_id,
      v_event_id,
      v_operation_key
    );
  else
    update public.commercial_message_intent_resolution_current current_row
    set
      current_event_id = v_event_id,
      last_operation_key = v_operation_key
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.anchor_message_id = p_anchor_message_id
      and current_row.current_event_id = v_supersedes_event_id;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'ZION_CMIR_CURRENT_CHANGED_DURING_WRITE';
    end if;
  end if;

  return query
  select
    v_event_id,
    v_decision_kind,
    p_resolved_opportunity_id,
    p_related_opportunity_id,
    v_relation_type,
    v_opportunity_outcome,
    v_context_outcome,
    false;
end;
$function$;

alter function public.write_commercial_message_intent_resolution_internal(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, text, jsonb, text
) owner to postgres;

revoke all on function public.write_commercial_message_intent_resolution_internal(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;

create or replace function public.write_commercial_message_intent_resolution_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_anchor_message_id uuid,
  p_customer_id uuid,
  p_lead_customer_link_id uuid,
  p_operation_key text,
  p_decision_kind text,
  p_reason_code text,
  p_resolved_opportunity_id uuid default null,
  p_related_opportunity_id uuid default null,
  p_actor_type text default 'ai',
  p_metadata jsonb default '{}'::jsonb,
  p_created_by text default 'sales_ai.intent_resolution'
)
returns table (
  event_id uuid,
  decision_kind text,
  resolved_opportunity_id uuid,
  related_opportunity_id uuid,
  relation_type text,
  opportunity_outcome text,
  context_outcome text,
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
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial message intent resolution by system is not authorized';
  end if;

  return query
  select *
  from public.write_commercial_message_intent_resolution_internal(
    p_organization_id,
    p_store_id,
    p_anchor_message_id,
    p_customer_id,
    p_lead_customer_link_id,
    p_operation_key,
    p_decision_kind,
    p_reason_code,
    p_resolved_opportunity_id,
    p_related_opportunity_id,
    p_actor_type,
    p_metadata,
    p_created_by
  );
end;
$function$;

alter function public.write_commercial_message_intent_resolution_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, text, jsonb, text
) owner to postgres;

revoke all on function public.write_commercial_message_intent_resolution_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;

grant execute on function public.write_commercial_message_intent_resolution_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, text, jsonb, text
) to service_role;

create or replace function public.assert_commercial_opportunity_message_evidence(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_customer_id uuid,
  p_evidence_message_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_message record;
  v_current_event public.commercial_message_intent_resolution_events;
begin
  if p_evidence_message_id is null then
    return null;
  end if;

  select
    message_row.id,
    message_row.organization_id,
    message_row.store_id,
    message_row.conversation_id,
    message_row.conversation_session_id,
    message_row.commercial_session_context_link_id,
    message_row.commercial_context_capture_state
  into v_message
  from public.messages message_row
  where message_row.id = p_evidence_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_LOSS_EVIDENCE_OUT_OF_SCOPE';
  end if;

  select event_row.*
  into v_current_event
  from public.commercial_message_intent_resolution_current current_row
  join public.commercial_message_intent_resolution_events event_row
    on event_row.id = current_row.current_event_id
   and event_row.organization_id = current_row.organization_id
   and event_row.store_id = current_row.store_id
   and event_row.anchor_message_id = current_row.anchor_message_id
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.anchor_message_id = p_evidence_message_id;

  if found then
    if v_current_event.customer_id = p_customer_id
       and v_current_event.decision_kind in (
         'continue_same_intent',
         'reopen_same_intent',
         'new_independent_opportunity',
         'repurchase',
         'addendum'
       )
       and v_current_event.resolved_opportunity_id
             = p_commercial_opportunity_id then
      return v_message.id;
    end if;

    raise exception using
      errcode = '23514',
      message = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN';
  end if;

  if v_message.commercial_context_capture_state = 'captured'
     and v_message.conversation_session_id is not null
     and v_message.commercial_session_context_link_id is not null
     and exists (
       select 1
       from public.conversation_sessions session_row
       join public.commercial_session_context_links context_link
         on context_link.id = v_message.commercial_session_context_link_id
        and context_link.conversation_session_id = session_row.id
        and context_link.organization_id = session_row.organization_id
        and context_link.store_id = session_row.store_id
       where session_row.organization_id = p_organization_id
         and session_row.store_id = p_store_id
         and session_row.id = v_message.conversation_session_id
         and session_row.conversation_id = v_message.conversation_id
         and context_link.commercial_opportunity_id
               = p_commercial_opportunity_id
         and context_link.customer_id = p_customer_id
     ) then
    return v_message.id;
  end if;

  raise exception using
    errcode = '23514',
    message = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN';
end;
$function$;

alter function public.assert_commercial_opportunity_message_evidence(
  uuid, uuid, uuid, uuid, uuid
) owner to postgres;

revoke all on function public.assert_commercial_opportunity_message_evidence(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

comment on function public.write_commercial_message_intent_resolution_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, text, jsonb, text
) is
  'Writer canonico service-role da Etapa 3.3. Resolve a intencao de uma mensagem inbound exata, aplica consequencias comerciais idempotentes, preserva contexto vivo mais novo e materializa a adjudicacao em event+current.';

comment on function public.assert_commercial_opportunity_message_evidence(
  uuid, uuid, uuid, uuid, uuid
) is
  'Valida evidence_message_id por opportunity. Uma CMIR current existente tem precedencia absoluta sobre o snapshot de chegada; snapshot captured e fallback apenas quando nao existe resolucao canonica atual.';

do $postconditions$
declare
  v_evidence_def text;
begin
  if pg_catalog.to_regprocedure(
       'public.write_commercial_message_intent_resolution_internal(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical CMIR writer functions are missing';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.write_commercial_message_intent_resolution_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.write_commercial_message_intent_resolution_internal(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,jsonb,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical CMIR writer grants mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) into v_evidence_def;

  if pg_catalog.strpos(
       v_evidence_def,
       'commercial_message_intent_resolution_current'
     ) = 0
     or pg_catalog.strpos(
       v_evidence_def,
       'commercial_context_capture_state'
     ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: evidence helper precedence/fallback is missing';
  end if;
end;
$postconditions$;

commit;
