begin;

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
    || case
         when public.is_real_whatsapp_conversation_for_external_send(
           v_queue.organization_id,
           v_queue.store_id,
           v_queue.conversation_id
         )
         then pg_catalog.jsonb_build_object(
           'channel', 'whatsapp',
           'external_channel', 'whatsapp',
           'send_external', true,
           'outbound_kind', 'canonical_followup',
           'outbound_origin', 'canonical_followup',
           'whatsapp_detected_from_conversation', true
         )
         else '{}'::jsonb
       end
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

alter function public.ai_sales_execute_canonical_followup_queue(uuid) owner to postgres;

revoke all on function public.ai_sales_execute_canonical_followup_queue(uuid)
from public, anon, authenticated;

grant execute on function public.ai_sales_execute_canonical_followup_queue(uuid)
to service_role;

comment on function public.ai_sales_execute_canonical_followup_queue(uuid) is
  'P9 5.3 canonical follow-up executor. External WhatsApp activation occurs only for a strictly proven real WhatsApp conversation; the external sender must still pass the final SQL SEND gate immediately before Meta.';

commit;
