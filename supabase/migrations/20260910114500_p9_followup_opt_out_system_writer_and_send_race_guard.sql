begin;

-- ============================================================================
-- P9 / Block 5 / Stage 5.3
-- Canonical system opt-out + race-safe follow-up SEND + legacy fail-closed.
--
-- Product invariant:
-- OPT-OUT STOPS AUTOMATED FOLLOW-UP.
-- OPT-OUT IS NOT LOST.
-- ============================================================================


-- ============================================================================
-- 1. Canonical system writer for explicit stop_contact
-- ============================================================================

create or replace function public.opt_out_commercial_opportunity_followup_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_source_conversation_id uuid,
  p_source_message_id uuid,
  p_operation_key text,
  p_reason_code text default 'customer_stop_contact',
  p_reason_details text default null
)
returns public.commercial_opportunity_followups
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
declare
  v_request_role text :=
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');

  v_operation_key text;
  v_reason_code text;
  v_reason_details text;

  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
  v_followup public.commercial_opportunity_followups;

  v_last_cycle integer;
  v_message_id uuid;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity followup opt out by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_source_conversation_id is null
     or p_source_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'system followup opt out requires organization, store, opportunity, conversation and source message';
  end if;

  v_operation_key :=
    public.normalize_commercial_opportunity_followup_operation_key(
      p_operation_key
    );

  v_reason_code :=
    public.normalize_commercial_opportunity_followup_reason_code(
      p_reason_code
    );

  v_reason_details :=
    public.normalize_commercial_opportunity_followup_reason_details(
      p_reason_details
    );

  if v_reason_code is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_FOLLOWUP_REASON_CODE_REQUIRED';
  end if;

  /*
   * Opportunity is the canonical unit of sale.
   * The lock also serializes cycle creation for this opportunity.
   */
  v_opportunity :=
    public.lock_commercial_opportunity_followup_target(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id
    );

  v_opportunity :=
    public.validate_commercial_opportunity_followup_integrity(
      v_opportunity
    );

  /*
   * Never infer a conversation here.
   * The caller must provide the exact conversation already resolved
   * by the canonical commercial context.
   */
  if v_opportunity.primary_conversation_id
       is distinct from p_source_conversation_id then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_OPT_OUT_CONVERSATION_SCOPE_MISMATCH';
  end if;

  /*
   * Validate the exact inbound message.
   * No latest/first lookup is allowed.
   */
  select message_row.id
  into v_message_id
  from public.messages message_row
  join public.conversations conversation_row
    on conversation_row.id = message_row.conversation_id
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.commercial_session_context_links context_link_row
    on context_link_row.id =
         message_row.commercial_session_context_link_id
  where message_row.id = p_source_message_id
    and message_row.conversation_id = p_source_conversation_id
    and message_row.sender = 'user'
    and message_row.direction = 'incoming'
    and message_row.deleted_at is null
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and conversation_row.organization_id = p_organization_id
    and lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
    and context_link_row.organization_id = p_organization_id
    and context_link_row.store_id = p_store_id
    and context_link_row.commercial_opportunity_id =
          p_commercial_opportunity_id
  limit 1;

  if v_message_id is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_OPT_OUT_SOURCE_MESSAGE_SCOPE_MISMATCH';
  end if;

  /*
   * Operation-key replay is checked before changing state.
   * Source ids are stored in event metadata so replay cannot silently
   * bind the same operation key to another inbound message.
   */
  v_existing_event :=
    public.find_commercial_opportunity_followup_event_by_operation_key(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      v_operation_key
    );

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'opted_out'
       or v_existing_event.actor_type <> 'system'
       or v_existing_event.actor_user_id is not null
       or v_existing_event.reason_code is distinct from v_reason_code
       or v_existing_event.reason_details is distinct from v_reason_details
       or v_existing_event.metadata ->> 'source_conversation_id'
            is distinct from p_source_conversation_id::text
       or v_existing_event.metadata ->> 'source_message_id'
            is distinct from p_source_message_id::text then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(
      v_existing_event
    );
  end if;

  /*
   * An opportunity already opted out remains opted out.
   * A new explicit stop request may append a new idempotent event,
   * but it must never create another opted-out cycle.
   */
  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id =
          p_commercial_opportunity_id
    and followup_row.status = 'opted_out'
  order by followup_row.cycle desc
  limit 1
  for update;

  if not found then
    select followup_row.*
    into v_followup
    from public.commercial_opportunity_followups followup_row
    where followup_row.organization_id = p_organization_id
      and followup_row.store_id = p_store_id
      and followup_row.commercial_opportunity_id =
            p_commercial_opportunity_id
      and followup_row.status = 'active'
    for update;

    if found then
      update public.commercial_opportunity_followups followup_row
      set
        status = 'opted_out',
        opted_out_at = pg_catalog.clock_timestamp()
      where followup_row.id = v_followup.id
      returning *
      into v_followup;
    else
      select pg_catalog.max(followup_row.cycle)
      into v_last_cycle
      from public.commercial_opportunity_followups followup_row
      where followup_row.organization_id = p_organization_id
        and followup_row.store_id = p_store_id
        and followup_row.commercial_opportunity_id =
              p_commercial_opportunity_id;

      insert into public.commercial_opportunity_followups (
        organization_id,
        store_id,
        commercial_opportunity_id,
        cycle,
        status,
        started_at,
        opted_out_at,
        attempt_count
      )
      values (
        p_organization_id,
        p_store_id,
        p_commercial_opportunity_id,
        coalesce(v_last_cycle, 0) + 1,
        'opted_out',
        pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp(),
        0
      )
      returning *
      into v_followup;
    end if;
  end if;

  /*
   * Same append-only event architecture used by the existing P9 writers.
   * Extra source identity is stored only as metadata.
   */
  insert into public.commercial_opportunity_followup_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    followup_id,
    cycle,
    event_type,
    operation_key,
    actor_type,
    actor_user_id,
    reason_code,
    reason_details,
    metadata
  )
  values (
    v_followup.organization_id,
    v_followup.store_id,
    v_followup.commercial_opportunity_id,
    v_followup.id,
    v_followup.cycle,
    'opted_out',
    v_operation_key,
    'system',
    null,
    v_reason_code,
    v_reason_details,
    pg_catalog.jsonb_build_object(
      'result_snapshot',
      public.build_commercial_opportunity_followup_snapshot(v_followup),
      'source_conversation_id',
      p_source_conversation_id,
      'source_message_id',
      p_source_message_id
    )
  );

  /*
   * Deliberately no commercial opportunity stage mutation here.
   * Opt-out is not Lost.
   */
  return v_followup;
end;
$function$;

alter function public.opt_out_commercial_opportunity_followup_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
) owner to postgres;

revoke all on function
  public.opt_out_commercial_opportunity_followup_by_system(
    uuid,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
  )
from public, anon, authenticated;

grant execute on function
  public.opt_out_commercial_opportunity_followup_by_system(
    uuid,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
  )
to service_role;


-- ============================================================================
-- 2. Canonical follow-up executor with conversation-level SEND serialization
-- ============================================================================

create or replace function public.ai_sales_execute_canonical_followup_queue(
  p_action_queue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
declare
  v_queue public.ai_sales_action_queue;
  v_opportunity_id uuid;
  v_followup_id uuid;
  v_followup_cycle integer;
  v_followup_operation_key text;

  v_opportunity public.commercial_opportunities;
  v_followup public.commercial_opportunity_followups;
  v_attempt public.commercial_opportunity_followups;
  v_resolved public.commercial_opportunity_followups;

  v_customer_message_at timestamptz;
  v_existing_message_id uuid;
  v_message public.messages;

  v_content text;
  v_source text;

  v_precheck record;
  v_reply_guard record;
begin
  select queue_row.*
  into v_queue
  from public.ai_sales_action_queue queue_row
  where queue_row.id = p_action_queue_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'action_queue_not_found',
      'result', 'action_queue_not_found',
      'action_queue_id', p_action_queue_id
    );
  end if;

  if v_queue.next_action not in ('followup_offer', 'followup_visit') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'unsupported_next_action',
      'result', 'unsupported_next_action',
      'action_queue_id', v_queue.id,
      'next_action', v_queue.next_action
    );
  end if;

  select *
  into v_precheck
  from public.ai_sales_real_execution_precheck(
    v_queue.next_action
  );

  if coalesce(v_precheck.can_run_real, false) = false then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', v_precheck.precheck_status,
      'result', v_precheck.precheck_status,
      'action_queue_id', v_queue.id,
      'next_action', v_queue.next_action,
      'guard_status', v_precheck.guard_status,
      'handler_key', v_precheck.handler_key
    );
  end if;

  if pg_catalog.jsonb_typeof(v_queue.payload) is distinct from 'object'
     or nullif(v_queue.payload ->> 'commercial_opportunity_id', '') is null
     or nullif(v_queue.payload ->> 'followup_id', '') is null
     or nullif(v_queue.payload ->> 'followup_cycle', '') is null
     or nullif(v_queue.payload ->> 'followup_operation_key', '') is null
     or nullif(v_queue.payload ->> 'conversation_id', '') is null
     or nullif(v_queue.payload ->> 'organization_id', '') is null
     or nullif(v_queue.payload ->> 'store_id', '') is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'followup_noncanonical_queue',
      'result', 'followup_noncanonical_queue',
      'action_queue_id', v_queue.id,
      'next_action', v_queue.next_action
    );
  end if;

  begin
    v_opportunity_id :=
      (v_queue.payload ->> 'commercial_opportunity_id')::uuid;

    v_followup_id :=
      (v_queue.payload ->> 'followup_id')::uuid;

    v_followup_cycle :=
      (v_queue.payload ->> 'followup_cycle')::integer;
  exception
    when invalid_text_representation then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'status', 'followup_invalid_identity_payload',
        'result', 'followup_invalid_identity_payload',
        'action_queue_id', v_queue.id
      );
  end;

  v_followup_operation_key :=
    public.normalize_commercial_opportunity_followup_operation_key(
      v_queue.payload ->> 'followup_operation_key'
    );

  if (v_queue.payload ->> 'organization_id')
        is distinct from v_queue.organization_id::text
     or (v_queue.payload ->> 'store_id')
        is distinct from v_queue.store_id::text
     or (v_queue.payload ->> 'conversation_id')
        is distinct from v_queue.conversation_id::text then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_scope_mismatch',
      'result', 'followup_stale_scope_mismatch',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'p9_followup_runtime:' || v_followup_id::text
    )
  );

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity_id
    and opportunity_row.organization_id = v_queue.organization_id
    and opportunity_row.store_id = v_queue.store_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_opportunity_missing',
      'result', 'followup_stale_opportunity_missing',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id
    );
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(
    v_opportunity
  );

  if v_opportunity.primary_conversation_id
       is distinct from v_queue.conversation_id then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_conversation_changed',
      'result', 'followup_stale_conversation_changed',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id
    );
  end if;

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.id = v_followup_id
    and followup_row.organization_id = v_queue.organization_id
    and followup_row.store_id = v_queue.store_id
    and followup_row.commercial_opportunity_id = v_opportunity_id
    and followup_row.cycle = v_followup_cycle
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_identity_mismatch',
      'result', 'followup_stale_identity_mismatch',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle
    );
  end if;

  if v_followup.status <> 'active' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_cycle_not_active',
      'result', 'followup_stale_cycle_not_active',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'followup_status', v_followup.status
    );
  end if;

  if v_followup.next_action is distinct from v_queue.next_action then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_action_changed',
      'result', 'followup_stale_action_changed',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle
    );
  end if;

  if v_opportunity.stage in (
    'perdido',
    'concluido_sem_mais_acoes'
  ) then
    v_resolved :=
      public.resolve_commercial_opportunity_followup_by_system(
        v_queue.organization_id,
        v_queue.store_id,
        v_opportunity_id,
        'system_resolve_terminal_opportunity:' || v_queue.id::text
      );

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'followup_stale_opportunity_terminal',
      'result', 'followup_stale_opportunity_terminal',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'opportunity_stage', v_opportunity.stage,
      'followup_status', v_resolved.status
    );
  end if;

  /*
   * Race-safe SEND barrier.
   *
   * insert_message uses this exact transaction-level conversation lock.
   * Taking it BEFORE the final customer-reply check serializes incoming
   * persistence against this follow-up SEND.
   */
  perform public.private_acquire_sales_contract_conversation_xact_lock(
    v_queue.conversation_id
  );

  /*
   * Revalidate customer activity while holding the same conversation lock
   * used by insert_message.
   */
  select pg_catalog.max(message_row.created_at)
  into v_customer_message_at
  from public.messages message_row
  where message_row.conversation_id = v_queue.conversation_id
    and message_row.sender = 'user'
    and message_row.direction = 'incoming'
    and message_row.deleted_at is null
    and message_row.created_at > v_queue.enqueued_at;

  if v_customer_message_at is not null then
    v_resolved :=
      public.resolve_commercial_opportunity_followup_by_system(
        v_queue.organization_id,
        v_queue.store_id,
        v_opportunity_id,
        'system_resolve_customer_reply:' || v_queue.id::text
      );

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'followup_stale_customer_replied',
      'result', 'followup_stale_customer_replied',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'customer_message_at', v_customer_message_at,
      'followup_status', v_resolved.status
    );
  end if;

  if v_followup.next_action_at > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'followup_not_due_yet',
      'result', 'followup_not_due_yet',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'next_action_at', v_followup.next_action_at
    );
  end if;

  select *
  into v_reply_guard
  from public.ai_sales_has_ai_reply_after_last_customer_message(
    v_queue.conversation_id
  );

  if coalesce(v_reply_guard.has_ai_reply, false) then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'already_replied_after_last_customer_message',
      'result', 'already_replied_after_last_customer_message',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'latest_ai_message_id', v_reply_guard.latest_ai_message_id,
      'latest_ai_message_at', v_reply_guard.latest_ai_message_at
    );
  end if;

  v_source :=
    case
      when v_queue.next_action = 'followup_visit'
        then 'ai_sales_real_handler_followup_visit'
      else 'ai_sales_real_handler_followup_offer'
    end;

  select message_row.id
  into v_existing_message_id
  from public.messages message_row
  where message_row.conversation_id = v_queue.conversation_id
    and message_row.sender = 'ai'
    and message_row.direction = 'outgoing'
    and message_row.metadata ->> 'source' = v_source
    and message_row.metadata ->> 'commercial_opportunity_id'
          = v_opportunity_id::text
    and message_row.metadata ->> 'followup_id'
          = v_followup_id::text
    and message_row.metadata ->> 'followup_cycle'
          = v_followup_cycle::text
  order by message_row.created_at desc
  limit 1;

  if v_existing_message_id is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'already_sent',
      'result', 'already_sent',
      'action_queue_id', v_queue.id,
      'message_id', v_existing_message_id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle
    );
  end if;

  v_content :=
    case
      when v_queue.next_action = 'followup_visit'
        then 'Olá! Passando para acompanhar sua visita. O que você achou e em que ponto posso te ajudar a avançar?'
      else 'Olá! Passando para saber o que você achou da proposta. Se quiser, posso te ajudar a revisar os detalhes para avançarmos.'
    end;

  select *
  into v_message
  from public.insert_message(
    v_queue.conversation_id,
    'ai',
    'outgoing',
    'text',
    v_content,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'source', v_source,
      'handler_key',
        case
          when v_queue.next_action = 'followup_visit'
            then 'real_handler_followup_visit'
          else 'real_handler_followup_offer'
        end,
      'execution_mode', 'real',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'followup_operation_key', v_followup_operation_key
    )
  );

  v_attempt :=
    public.record_commercial_opportunity_followup_attempt_by_system(
      v_queue.organization_id,
      v_queue.store_id,
      v_opportunity_id,
      'system_attempt:' || v_queue.id::text
    );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'message_inserted',
    'result', 'message_inserted',
    'action', v_queue.next_action,
    'action_queue_id', v_queue.id,
    'message_id', v_message.id,
    'commercial_opportunity_id', v_opportunity_id,
    'followup_id', v_followup_id,
    'followup_cycle', v_followup_cycle,
    'attempt_count', v_attempt.attempt_count
  );
end;
$function$;

alter function public.ai_sales_execute_canonical_followup_queue(uuid)
owner to postgres;

revoke all on function
  public.ai_sales_execute_canonical_followup_queue(uuid)
from public, anon, authenticated;

grant execute on function
  public.ai_sales_execute_canonical_followup_queue(uuid)
to service_role;


-- ============================================================================
-- 3. Legacy real-dispatch paths must fail closed for follow-up
-- ============================================================================

create or replace function public.ai_sales_real_handler_followup_offer(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid
)
returns table(
  ok boolean,
  status text,
  action text,
  details jsonb
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  select
    false,
    'canonical_followup_queue_required'::text,
    'followup_offer'::text,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'conversation_id', p_conversation_id,
      'message',
      'Legacy follow-up handler is disabled; canonical queue execution is required'
    );
end;
$function$;


create or replace function public.ai_sales_real_handler_followup_visit(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid
)
returns table(
  ok boolean,
  status text,
  action text,
  details jsonb
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  select
    false,
    'canonical_followup_queue_required'::text,
    'followup_visit'::text,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'conversation_id', p_conversation_id,
      'message',
      'Legacy follow-up handler is disabled; canonical queue execution is required'
    );
end;
$function$;


create or replace function public.ai_sales_action_apply_real(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_action text
)
returns table(
  ok boolean,
  status text,
  action text,
  details jsonb
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_guard record;
begin
  select *
  into v_guard
  from public.ai_sales_real_execution_guard();

  if coalesce(v_guard.can_enable_real_execution, false) = false then
    return query
    select
      false,
      'real_execution_blocked'::text,
      p_action,
      pg_catalog.jsonb_build_object(
        'guard_status', v_guard.guard_status,
        'safe_mode_enabled', v_guard.safe_mode_enabled,
        'real_execution_enabled', v_guard.real_execution_enabled,
        'message', 'Real execution is blocked by guard'
      );
    return;
  end if;

  if p_action in ('followup_offer', 'followup_visit') then
    return query
    select
      false,
      'canonical_followup_queue_required'::text,
      p_action,
      pg_catalog.jsonb_build_object(
        'organization_id', p_organization_id,
        'store_id', p_store_id,
        'conversation_id', p_conversation_id,
        'message',
        'Follow-up real execution requires the canonical queue executor'
      );
    return;
  end if;

  if p_action = 'qualify_lead' then
    return query
    select
      r.ok,
      r.status,
      r.action,
      r.details
    from public.ai_sales_real_handler_qualify_lead(
      p_organization_id,
      p_store_id,
      p_conversation_id
    ) r;
    return;
  end if;

  if p_action = 'confirm_payment' then
    return query
    select
      r.ok,
      r.status,
      r.action,
      r.details
    from public.ai_sales_real_handler_confirm_payment(
      p_organization_id,
      p_store_id,
      p_conversation_id
    ) r;
    return;
  end if;

  if p_action = 'confirm_sale' then
    return query
    select
      r.ok,
      r.status,
      r.action,
      r.details
    from public.ai_sales_real_handler_confirm_sale(
      p_organization_id,
      p_store_id,
      p_conversation_id
    ) r;
    return;
  end if;

  return query
  select
    false,
    'real_handler_not_implemented'::text,
    p_action,
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'conversation_id', p_conversation_id,
      'message', 'Action has no real handler implementation'
    );
end;
$function$;


create or replace function public.ai_sales_action_dispatch_real(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_action text
)
returns table(
  ok boolean,
  status text,
  action text,
  details jsonb
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_precheck record;
  v_reply_guard record;
begin
  if p_action in ('followup_offer', 'followup_visit') then
    return query
    select
      false,
      'canonical_followup_queue_required'::text,
      p_action,
      pg_catalog.jsonb_build_object(
        'organization_id', p_organization_id,
        'store_id', p_store_id,
        'conversation_id', p_conversation_id,
        'message',
        'Follow-up dispatch requires the canonical queue executor'
      );
    return;
  end if;

  select *
  into v_precheck
  from public.ai_sales_real_execution_precheck(p_action);

  if coalesce(v_precheck.can_run_real, false) = false then
    return query
    select
      false,
      v_precheck.precheck_status,
      p_action,
      pg_catalog.jsonb_build_object(
        'guard_status', v_precheck.guard_status,
        'handler_key', v_precheck.handler_key,
        'precheck_status', v_precheck.precheck_status,
        'message', 'Real dispatch blocked before handler execution'
      );
    return;
  end if;

  select *
  into v_reply_guard
  from public.ai_sales_has_ai_reply_after_last_customer_message(
    p_conversation_id
  );

  if coalesce(v_reply_guard.has_ai_reply, false) = true then
    return query
    select
      false,
      'already_replied_after_last_customer_message'::text,
      p_action,
      pg_catalog.jsonb_build_object(
        'guard_status', 'already_replied_after_last_customer_message',
        'handler_key', v_precheck.handler_key,
        'precheck_status', v_precheck.precheck_status,
        'message',
        'Real dispatch skipped because an AI message already exists after the latest customer message',
        'conversation_id', p_conversation_id,
        'last_customer_message_at', v_reply_guard.last_customer_message_at,
        'latest_ai_message_id', v_reply_guard.latest_ai_message_id,
        'latest_ai_message_at', v_reply_guard.latest_ai_message_at
      );
    return;
  end if;

  return query
  select
    r.ok,
    r.status,
    r.action,
    r.details
  from public.ai_sales_action_apply_real(
    p_organization_id,
    p_store_id,
    p_conversation_id,
    p_action
  ) r;
end;
$function$;


alter function public.ai_sales_real_handler_followup_offer(uuid, uuid, uuid)
owner to postgres;

alter function public.ai_sales_real_handler_followup_visit(uuid, uuid, uuid)
owner to postgres;

alter function public.ai_sales_action_apply_real(uuid, uuid, uuid, text)
owner to postgres;

alter function public.ai_sales_action_dispatch_real(uuid, uuid, uuid, text)
owner to postgres;

revoke all on function
  public.ai_sales_real_handler_followup_offer(uuid, uuid, uuid)
from public, anon, authenticated;

revoke all on function
  public.ai_sales_real_handler_followup_visit(uuid, uuid, uuid)
from public, anon, authenticated;

revoke all on function
  public.ai_sales_action_apply_real(uuid, uuid, uuid, text)
from public, anon, authenticated;

revoke all on function
  public.ai_sales_action_dispatch_real(uuid, uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.ai_sales_real_handler_followup_offer(uuid, uuid, uuid)
to service_role;

grant execute on function
  public.ai_sales_real_handler_followup_visit(uuid, uuid, uuid)
to service_role;

grant execute on function
  public.ai_sales_action_apply_real(uuid, uuid, uuid, text)
to service_role;

grant execute on function
  public.ai_sales_action_dispatch_real(uuid, uuid, uuid, text)
to service_role;


-- ============================================================================
-- 4. Contract comments
-- ============================================================================

comment on function
  public.opt_out_commercial_opportunity_followup_by_system(
    uuid,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
  )
is
  'P9 5.3 canonical system opt-out writer. Explicit stop_contact stops automated follow-up for the exact opportunity and never marks it Lost.';

comment on function
  public.ai_sales_execute_canonical_followup_queue(uuid)
is
  'P9 canonical real follow-up executor. P9 5.3 serializes final SEND against incoming persistence with the same conversation transaction lock used by insert_message.';

commit;
