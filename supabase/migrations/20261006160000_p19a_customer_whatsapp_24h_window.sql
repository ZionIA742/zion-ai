begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261006160000_p19a_customer_whatsapp_24h_window',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regprocedure(
          'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'
        ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_24H_PRECONDITION_MISSING';
  end if;
end;
$preflight$;

alter table public.messages
  drop constraint if exists messages_outbound_delivery_state_check;

alter table public.messages
  add constraint messages_outbound_delivery_state_check
  check (
    outbound_delivery_state is null
    or outbound_delivery_state in (
      'pending',
      'processing',
      'template_required',
      'sent',
      'uncertain',
      'failed'
    )
  );

create or replace function public.read_customer_whatsapp_24h_window_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid
)
returns jsonb
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
  v_message public.messages%rowtype;
  v_inbound public.messages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'P19A_CUSTOMER_WHATSAPP_24H_NOT_AUTHORIZED';
  end if;

  select message_row.*
    into v_message
    from public.messages message_row
   where message_row.id = p_message_id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P19A_CUSTOMER_WHATSAPP_24H_MESSAGE_SCOPE_MISMATCH';
  end if;

  if v_message.conversation_id is null
     or v_message.direction is distinct from 'outgoing'
     or v_message.external_message_id is not null
     or v_message.deleted_at is not null
     or coalesce(v_message.outbound_delivery_state, '') is distinct from 'processing'
     or v_message.outbound_attempt_started_at is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'blocked',
      'reason', 'P19A_CUSTOMER_WHATSAPP_24H_OUTBOUND_SCOPE_INVALID',
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id
    );
  end if;

  select inbound_row.*
    into v_inbound
    from public.messages inbound_row
   where inbound_row.organization_id = p_organization_id
     and inbound_row.store_id = p_store_id
     and inbound_row.conversation_id = v_message.conversation_id
     and inbound_row.sender = 'user'
     and inbound_row.direction = 'incoming'
     and inbound_row.deleted_at is null
     and inbound_row.external_message_id is not null
     and inbound_row.metadata ->> 'source' = 'meta_whatsapp_webhook'
     and inbound_row.metadata ->> 'channel' = 'whatsapp'
     and inbound_row.metadata ->> 'external_channel' = 'whatsapp'
     and inbound_row.metadata ->> 'provider' = 'meta'
   order by inbound_row.created_at desc, inbound_row.id desc
   limit 1;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'template_required',
      'reason', 'P19A_CUSTOMER_WHATSAPP_24H_NO_VALID_INBOUND',
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id
    );
  end if;

  if v_inbound.created_at is null or v_inbound.created_at > v_now then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'blocked',
      'reason', case
        when v_inbound.created_at is null
          then 'P19A_CUSTOMER_WHATSAPP_24H_INVALID_INBOUND_TIMESTAMP'
        else 'P19A_CUSTOMER_WHATSAPP_24H_FUTURE_INBOUND_TIMESTAMP'
      end,
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id,
      'last_valid_customer_inbound_at', v_inbound.created_at
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'decision', case
      when v_inbound.created_at >= v_now - interval '24 hours'
        then 'send'
      else 'template_required'
    end,
    'reason', case
      when v_inbound.created_at >= v_now - interval '24 hours'
        then 'P19A_CUSTOMER_WHATSAPP_24H_WINDOW_OPEN'
      else 'P19A_CUSTOMER_WHATSAPP_24H_WINDOW_CLOSED'
    end,
    'message_id', p_message_id,
    'conversation_id', v_message.conversation_id,
    'last_valid_customer_inbound_at', v_inbound.created_at,
    'last_valid_customer_inbound_id', v_inbound.id,
    'last_valid_customer_external_message_id', v_inbound.external_message_id
  );
end;
$function$;

alter function public.read_customer_whatsapp_24h_window_by_system(uuid, uuid, uuid)
  owner to postgres;

revoke all on function
  public.read_customer_whatsapp_24h_window_by_system(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.read_customer_whatsapp_24h_window_by_system(uuid, uuid, uuid)
to service_role;

create or replace function public.validate_or_cancel_whatsapp_external_send_v3_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid
)
returns jsonb
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
  v_window jsonb;
  v_decision text;
  v_reason text;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'P19A_CUSTOMER_WHATSAPP_24H_GATE_NOT_AUTHORIZED';
  end if;

  v_window := public.read_customer_whatsapp_24h_window_by_system(
    p_organization_id,
    p_store_id,
    p_message_id
  );
  v_decision := v_window ->> 'decision';
  v_reason := nullif(pg_catalog.btrim(coalesce(v_window ->> 'reason', '')), '');

  if v_window ->> 'ok' is distinct from 'true'
     or v_decision not in ('send', 'template_required', 'blocked')
     or v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_24H_INVALID_AUTHORITY_RESULT';
  end if;

  if v_decision = 'template_required' then
    update public.messages message_row
       set outbound_delivery_state = 'template_required',
           outbound_claimed_at = null,
           outbound_claimed_by = null,
           outbound_attempt_started_at = null,
           outbound_uncertain_at = null,
           outbound_error_text = ('ZION_EXTERNAL_SEND_TEMPLATE_REQUIRED:' || v_reason)::text
     where message_row.id = p_message_id
       and message_row.organization_id = p_organization_id
       and message_row.store_id = p_store_id
       and message_row.outbound_delivery_state = 'processing'
       and message_row.outbound_attempt_started_at is null
       and message_row.external_message_id is null
       and message_row.deleted_at is null;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'P19A_CUSTOMER_WHATSAPP_24H_TEMPLATE_TRANSITION_LOST';
    end if;

    return v_window;
  end if;

  if v_decision = 'blocked' then
    update public.messages message_row
       set outbound_delivery_state = 'failed',
           outbound_claimed_at = null,
           outbound_claimed_by = null,
           outbound_attempt_started_at = null,
           outbound_uncertain_at = null,
           outbound_error_text = ('ZION_EXTERNAL_SEND_BLOCKED:' || v_reason)::text
     where message_row.id = p_message_id
       and message_row.organization_id = p_organization_id
       and message_row.outbound_delivery_state = 'processing'
       and message_row.outbound_attempt_started_at is null
       and message_row.external_message_id is null
       and message_row.deleted_at is null;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'P19A_CUSTOMER_WHATSAPP_24H_BLOCK_TRANSITION_LOST';
    end if;

    return v_window;
  end if;

  return public.validate_or_cancel_whatsapp_external_send_v2_by_system(
    p_organization_id,
    p_store_id,
    p_message_id
  );
end;
$function$;

alter function public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid, uuid, uuid)
  owner to postgres;

revoke all on function
  public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid, uuid, uuid)
to service_role;

do $postconditions$
begin
  if pg_catalog.pg_get_functiondef(
       'public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid,uuid,uuid)'::regprocedure
     ) not ilike '%read_customer_whatsapp_24h_window_by_system%'
     or pg_catalog.pg_get_functiondef(
       'public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid,uuid,uuid)'::regprocedure
     ) not ilike '%validate_or_cancel_whatsapp_external_send_v2_by_system%' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_24H_GATE_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
