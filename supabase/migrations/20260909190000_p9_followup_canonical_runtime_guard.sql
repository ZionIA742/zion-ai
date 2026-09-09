begin;

create or replace function public.record_commercial_opportunity_followup_attempt_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text
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
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
  v_followup public.commercial_opportunity_followups;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity followup attempt by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity followup attempt requires organization, store and opportunity';
  end if;

  v_operation_key :=
    public.normalize_commercial_opportunity_followup_operation_key(
      p_operation_key
    );

  v_opportunity :=
    public.lock_commercial_opportunity_followup_target(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id
    );

  v_existing_event :=
    public.find_commercial_opportunity_followup_event_by_operation_key(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      v_operation_key
    );

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'attempt_recorded'
       or v_existing_event.actor_type <> 'system'
       or v_existing_event.actor_user_id is not null
       or v_existing_event.reason_code is not null
       or v_existing_event.reason_details is not null then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(
      v_existing_event
    );
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(
    v_opportunity
  );

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id =
      p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE';
  end if;

  update public.commercial_opportunity_followups followup_row
  set
    attempt_count = followup_row.attempt_count + 1,
    last_attempt_at = pg_catalog.clock_timestamp()
  where followup_row.id = v_followup.id
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'attempt_recorded',
    v_operation_key,
    'system',
    null,
    null,
    null
  );

  return v_followup;
end;
$function$;

revoke all
on function public.record_commercial_opportunity_followup_attempt_by_system(
  uuid,
  uuid,
  uuid,
  text
)
from public, anon, authenticated;

grant execute
on function public.record_commercial_opportunity_followup_attempt_by_system(
  uuid,
  uuid,
  uuid,
  text
)
to service_role;


create or replace function public.resolve_commercial_opportunity_followup_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text
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
  v_opportunity public.commercial_opportunities;
  v_existing_event public.commercial_opportunity_followup_events;
  v_followup public.commercial_opportunity_followups;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity followup resolution by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity followup resolution requires organization, store and opportunity';
  end if;

  v_operation_key :=
    public.normalize_commercial_opportunity_followup_operation_key(
      p_operation_key
    );

  v_opportunity :=
    public.lock_commercial_opportunity_followup_target(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id
    );

  v_existing_event :=
    public.find_commercial_opportunity_followup_event_by_operation_key(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      v_operation_key
    );

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'resolved'
       or v_existing_event.actor_type <> 'system'
       or v_existing_event.actor_user_id is not null
       or v_existing_event.reason_code is not null
       or v_existing_event.reason_details is not null then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT';
    end if;

    return public.restore_commercial_opportunity_followup_snapshot(
      v_existing_event
    );
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(
    v_opportunity
  );

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id =
      p_commercial_opportunity_id
    and followup_row.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE';
  end if;

  update public.commercial_opportunity_followups followup_row
  set
    status = 'resolved',
    resolved_at = pg_catalog.clock_timestamp()
  where followup_row.id = v_followup.id
  returning *
  into v_followup;

  perform public.insert_commercial_opportunity_followup_event(
    v_followup,
    'resolved',
    v_operation_key,
    'system',
    null,
    null,
    null
  );

  return v_followup;
end;
$function$;

revoke all
on function public.resolve_commercial_opportunity_followup_by_system(
  uuid,
  uuid,
  uuid,
  text
)
from public, anon, authenticated;

grant execute
on function public.resolve_commercial_opportunity_followup_by_system(
  uuid,
  uuid,
  uuid,
  text
)
to service_role;


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
    return jsonb_build_object(
      'ok', false,
      'status', 'action_queue_not_found',
      'result', 'action_queue_not_found',
      'action_queue_id', p_action_queue_id
    );
  end if;

  if v_queue.next_action not in ('followup_offer', 'followup_visit') then
    return jsonb_build_object(
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
    return jsonb_build_object(
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
    return jsonb_build_object(
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
      return jsonb_build_object(
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
    return jsonb_build_object(
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
    return jsonb_build_object(
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
    return jsonb_build_object(
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
    return jsonb_build_object(
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
    return jsonb_build_object(
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
    return jsonb_build_object(
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

    return jsonb_build_object(
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

    return jsonb_build_object(
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

  select *
  into v_reply_guard
  from public.ai_sales_has_ai_reply_after_last_customer_message(
    v_queue.conversation_id
  );

  if coalesce(v_reply_guard.has_ai_reply, false) then
    return jsonb_build_object(
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
    return jsonb_build_object(
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
    jsonb_build_object(
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

  return jsonb_build_object(
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

revoke all
on function public.ai_sales_execute_canonical_followup_queue(uuid)
from public, anon, authenticated;

grant execute
on function public.ai_sales_execute_canonical_followup_queue(uuid)
to service_role;


create or replace function public.ai_sales_action_execute(
  p_action_queue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_mode record;
  v_queue record;
  v_real record;
  v_safe jsonb;
  v_followup jsonb;
begin
  select *
  into v_mode
  from public.ai_sales_action_execution_mode();

  select
    q.id,
    q.organization_id,
    q.store_id,
    q.conversation_id,
    q.ai_run_id,
    q.next_action,
    q.action_key
  into v_queue
  from public.ai_sales_action_queue q
  where q.id = p_action_queue_id;

  if not found then
    return jsonb_build_object(
      'mode', 'router',
      'type', 'ai_sales_action_execute',
      'result', 'action_queue_not_found',
      'action_queue_id', p_action_queue_id
    );
  end if;

  if v_mode.execution_mode = 'invalid' then
    return jsonb_build_object(
      'mode', 'invalid',
      'type', 'ai_sales_action_execute',
      'source', 'ai_sales_action_execute',
      'result', 'invalid_execution_mode_flags',
      'action_queue_id', v_queue.id,
      'ai_run_id', v_queue.ai_run_id,
      'next_action', v_queue.next_action,
      'safe_mode_enabled', v_mode.safe_mode_enabled,
      'real_execution_enabled', v_mode.real_execution_enabled
    );
  end if;

  if v_mode.execution_mode = 'real' then
    if v_queue.next_action in ('followup_offer', 'followup_visit') then
      v_followup :=
        public.ai_sales_execute_canonical_followup_queue(
          v_queue.id
        );

      return jsonb_build_object(
        'mode', 'real',
        'type', 'ai_sales_action_execute',
        'source', 'ai_sales_action_execute',
        'result',
          coalesce(
            v_followup ->> 'result',
            v_followup ->> 'status',
            'canonical_followup_completed'
          ),
        'action_queue_id', v_queue.id,
        'ai_run_id', v_queue.ai_run_id,
        'next_action', v_queue.next_action,
        'dispatch', v_followup
      );
    end if;

    select *
    into v_real
    from public.ai_sales_action_dispatch_real(
      v_queue.organization_id,
      v_queue.store_id,
      v_queue.conversation_id,
      v_queue.next_action
    );

    return jsonb_build_object(
      'mode', 'real',
      'type', 'ai_sales_action_execute',
      'source', 'ai_sales_action_execute',
      'result', coalesce(v_real.status, 'real_dispatch_completed'),
      'action_queue_id', v_queue.id,
      'ai_run_id', v_queue.ai_run_id,
      'next_action', v_queue.next_action,
      'dispatch', jsonb_build_object(
        'ok', v_real.ok,
        'status', v_real.status,
        'action', v_real.action,
        'details', v_real.details
      )
    );
  end if;

  v_safe :=
    public.ai_sales_action_apply_safe(
      p_action_queue_id
    );

  return jsonb_build_object(
    'mode', 'safe',
    'type', 'ai_sales_action_execute',
    'source', 'ai_sales_action_execute',
    'result',
      coalesce(
        v_safe ->> 'result',
        'safe_dispatch_completed'
      ),
    'action_queue_id', v_queue.id,
    'ai_run_id', v_queue.ai_run_id,
    'next_action', v_queue.next_action,
    'execution_mode', v_mode.execution_mode,
    'safe_output', v_safe
  );
end;
$function$;

commit;