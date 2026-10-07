begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public;

do $preflight$
begin
  if pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.ai_sales_action_queue') is null
     or pg_catalog.to_regprocedure(
          'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'
        ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATE_PRECONDITION_MISSING';
  end if;
end;
$preflight$;

create or replace function public.get_template_required_canonical_followups_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer default 50,
  p_processing_lease_seconds integer default 600
)
returns table (
  message_id uuid,
  organization_id uuid,
  store_id uuid,
  conversation_id uuid,
  lead_id uuid,
  lead_phone text,
  message_type text,
  content text,
  media_url text,
  metadata jsonb,
  created_at timestamptz,
  external_message_id text,
  outbound_delivery_state text,
  outbound_idempotency_key text,
  outbound_claimed_at timestamptz,
  outbound_attempt_started_at timestamptz,
  outbound_provider_accepted_at timestamptz,
  outbound_commercial_finalized_at timestamptz,
  outbound_commercial_error_text text,
  template_action text
)
language sql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
  select
    message_row.id as message_id,
    message_row.organization_id,
    message_row.store_id,
    message_row.conversation_id,
    conversation_row.lead_id,
    lead_row.phone as lead_phone,
    message_row.message_type,
    message_row.content,
    message_row.media_url,
    coalesce(message_row.metadata, '{}'::jsonb) as metadata,
    message_row.created_at,
    message_row.external_message_id,
    message_row.outbound_delivery_state,
    message_row.outbound_idempotency_key,
    message_row.outbound_claimed_at,
    message_row.outbound_attempt_started_at,
    message_row.outbound_provider_accepted_at,
    message_row.outbound_commercial_finalized_at,
    message_row.outbound_commercial_error_text,
    queue_row.next_action::text as template_action
  from public.messages as message_row
  join public.conversations as conversation_row
    on conversation_row.id = message_row.conversation_id
   and conversation_row.organization_id = message_row.organization_id
  join public.leads as lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id = message_row.organization_id
   and lead_row.store_id = message_row.store_id
  join public.ai_sales_action_queue as queue_row
    on queue_row.id::text = nullif(message_row.metadata ->> 'action_queue_id', '')
   and queue_row.organization_id = message_row.organization_id
   and queue_row.store_id = message_row.store_id
   and queue_row.conversation_id = message_row.conversation_id
  where message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and message_row.sender = 'ai'
    and message_row.direction = 'outgoing'
    and message_row.external_message_id is null
    and message_row.deleted_at is null
    and message_row.message_type = 'text'
    and (
      (
        message_row.outbound_delivery_state = 'template_required'
        and message_row.outbound_claimed_at is null
      )
      or (
        message_row.outbound_delivery_state = 'processing'
        and message_row.outbound_claimed_by =
              'whatsapp-template-cron:'
              || p_organization_id::text
              || ':'
              || p_store_id::text
        and message_row.outbound_claimed_at is not null
        and message_row.outbound_claimed_at < (
          pg_catalog.clock_timestamp()
          - pg_catalog.make_interval(
              secs => greatest(
                coalesce(p_processing_lease_seconds, 600),
                1
              )
            )
        )
      )
    )
    and message_row.outbound_attempt_started_at is null
    and message_row.outbound_provider_accepted_at is null
    and message_row.outbound_uncertain_at is null
    and coalesce(message_row.metadata ->> 'send_external', 'false') = 'true'
    and coalesce(message_row.metadata ->> 'external_channel', '') = 'whatsapp'
    and coalesce(message_row.metadata ->> 'outbound_kind', '') = 'canonical_followup'
    and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'canonical_followup'
    and nullif(message_row.metadata ->> 'commercial_opportunity_id', '') is not null
    and nullif(message_row.metadata ->> 'followup_id', '') is not null
    and nullif(message_row.metadata ->> 'followup_cycle', '') is not null
    and nullif(message_row.metadata ->> 'followup_operation_key', '') is not null
    and queue_row.next_action in ('followup_offer', 'followup_visit')
    and message_row.metadata ->> 'source' =
      case
        when queue_row.next_action = 'followup_visit'
          then 'ai_sales_real_handler_followup_visit'
        else 'ai_sales_real_handler_followup_offer'
      end
    and message_row.metadata ->> 'handler_key' =
      case
        when queue_row.next_action = 'followup_visit'
          then 'real_handler_followup_visit'
        else 'real_handler_followup_offer'
      end
    and queue_row.payload ->> 'commercial_opportunity_id'
          = message_row.metadata ->> 'commercial_opportunity_id'
    and queue_row.payload ->> 'followup_id'
          = message_row.metadata ->> 'followup_id'
    and queue_row.payload ->> 'followup_cycle'
          = message_row.metadata ->> 'followup_cycle'
    and queue_row.payload ->> 'followup_operation_key'
          = message_row.metadata ->> 'followup_operation_key'
  order by
    coalesce(message_row.outbound_claimed_at, message_row.created_at) asc,
    message_row.created_at asc,
    message_row.id asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

alter function public.get_template_required_canonical_followups_by_system(uuid, uuid, integer, integer)
  owner to postgres;

revoke all on function
  public.get_template_required_canonical_followups_by_system(uuid, uuid, integer, integer)
from public, anon, authenticated;

grant execute on function
  public.get_template_required_canonical_followups_by_system(uuid, uuid, integer, integer)
to service_role;

comment on function
  public.get_template_required_canonical_followups_by_system(uuid, uuid, integer, integer)
is
  'P19-A 4.5.2 service-only reader for canonical customer WhatsApp follow-ups parked in template_required. Template kind is derived from the exact ai_sales_action_queue.next_action and cross-checked against canonical message metadata.';


create or replace function public.claim_template_required_canonical_followup_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_processing_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_message public.messages;
  v_queue public.ai_sales_action_queue;
  v_action_queue_id text;
  v_action text;
  v_expected_source text;
  v_expected_handler text;
begin
  select message_row.*
  into v_message
  from public.messages as message_row
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'message_not_found'
    );
  end if;

  if v_message.sender is distinct from 'ai'
     or v_message.direction is distinct from 'outgoing'
     or v_message.message_type is distinct from 'text'     or v_message.external_message_id is not null
     or v_message.deleted_at is not null
     or v_message.outbound_attempt_started_at is not null
     or v_message.outbound_provider_accepted_at is not null
     or v_message.outbound_uncertain_at is not null
     or coalesce(v_message.metadata ->> 'send_external', 'false') <> 'true'
     or coalesce(v_message.metadata ->> 'external_channel', '') <> 'whatsapp'
     or coalesce(v_message.metadata ->> 'outbound_kind', '') <> 'canonical_followup'
     or coalesce(v_message.metadata ->> 'outbound_origin', '') <> 'canonical_followup' then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'message_not_template_followup_eligible',
      'message_id', p_message_id
    );
  end if;

  if not (
       (
         v_message.outbound_delivery_state = 'template_required'
         and v_message.outbound_claimed_at is null
       )
       or (
         v_message.outbound_delivery_state = 'processing'
         and v_message.outbound_claimed_by =
               'whatsapp-template-cron:'
               || p_organization_id::text
               || ':'
               || p_store_id::text
         and v_message.outbound_claimed_at is not null
         and v_message.outbound_claimed_at < (
           pg_catalog.clock_timestamp()
           - pg_catalog.make_interval(
               secs => greatest(
                 coalesce(p_processing_lease_seconds, 600),
                 1
               )
             )
         )
       )
     ) then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'message_not_template_followup_claimable',
      'message_id', p_message_id
    );
  end if;

  v_action_queue_id :=
    nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'action_queue_id', '')), '');

  if v_action_queue_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'action_queue_id_required',
      'message_id', p_message_id
    );
  end if;

  select queue_row.*
  into v_queue
  from public.ai_sales_action_queue as queue_row
  where queue_row.id::text = v_action_queue_id
    and queue_row.organization_id = p_organization_id
    and queue_row.store_id = p_store_id
    and queue_row.conversation_id = v_message.conversation_id
  for share;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'canonical_followup_queue_missing',
      'message_id', p_message_id
    );
  end if;

  v_action := pg_catalog.lower(pg_catalog.btrim(coalesce(v_queue.next_action, '')));

  if v_action not in ('followup_offer', 'followup_visit') then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'canonical_followup_action_unsupported',
      'message_id', p_message_id
    );
  end if;

  v_expected_source :=
    case
      when v_action = 'followup_visit'
        then 'ai_sales_real_handler_followup_visit'
      else 'ai_sales_real_handler_followup_offer'
    end;

  v_expected_handler :=
    case
      when v_action = 'followup_visit'
        then 'real_handler_followup_visit'
      else 'real_handler_followup_offer'
    end;

  if v_message.metadata ->> 'source' is distinct from v_expected_source
     or v_message.metadata ->> 'handler_key' is distinct from v_expected_handler
     or v_queue.payload ->> 'commercial_opportunity_id'
          is distinct from v_message.metadata ->> 'commercial_opportunity_id'
     or v_queue.payload ->> 'followup_id'
          is distinct from v_message.metadata ->> 'followup_id'
     or v_queue.payload ->> 'followup_cycle'
          is distinct from v_message.metadata ->> 'followup_cycle'
     or v_queue.payload ->> 'followup_operation_key'
          is distinct from v_message.metadata ->> 'followup_operation_key' then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'canonical_followup_template_identity_mismatch',
      'message_id', p_message_id
    );
  end if;

  update public.messages as message_row
  set
    outbound_delivery_state = 'processing',
    outbound_claimed_at = pg_catalog.clock_timestamp(),
    outbound_claimed_by =
      'whatsapp-template-cron:' || p_organization_id::text || ':' || p_store_id::text,
    outbound_error_text = null
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and (
      (
        message_row.outbound_delivery_state = 'template_required'
        and message_row.outbound_claimed_at is null
      )
      or (
        message_row.outbound_delivery_state = 'processing'
        and message_row.outbound_claimed_by =
              'whatsapp-template-cron:'
              || p_organization_id::text
              || ':'
              || p_store_id::text
        and message_row.outbound_claimed_at is not null
        and message_row.outbound_claimed_at < (
          pg_catalog.clock_timestamp()
          - pg_catalog.make_interval(
              secs => greatest(
                coalesce(p_processing_lease_seconds, 600),
                1
              )
            )
        )
      )
    )
    and message_row.external_message_id is null
    and message_row.deleted_at is null
    and message_row.outbound_attempt_started_at is null
    and message_row.outbound_provider_accepted_at is null
    and message_row.outbound_uncertain_at is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_TEMPLATE_CLAIM_TRANSITION_LOST';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'claimed', true,
    'reason', 'claimed',
    'message_id', p_message_id,
    'template_action', v_action
  );
end;
$function$;

alter function public.claim_template_required_canonical_followup_by_system(uuid, uuid, uuid, integer)
  owner to postgres;

revoke all on function
  public.claim_template_required_canonical_followup_by_system(uuid, uuid, uuid, integer)
from public, anon, authenticated;

grant execute on function
  public.claim_template_required_canonical_followup_by_system(uuid, uuid, uuid, integer)
to service_role;

create or replace function public.validate_or_cancel_whatsapp_template_followup_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_expected_template_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_message public.messages;
  v_queue public.ai_sales_action_queue;
  v_expected_action text :=
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_expected_template_action, '')));
  v_action_queue_id text;
  v_expected_source text;
  v_expected_handler text;
  v_block_reason text;
begin
  select message_row.*
  into v_message
  from public.messages as message_row
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P19A_CUSTOMER_WHATSAPP_TEMPLATE_GATE_MESSAGE_NOT_FOUND';
  end if;

  if v_expected_action not in ('followup_offer', 'followup_visit') then
    v_block_reason := 'template_action_invalid';
  elsif v_message.sender is distinct from 'ai'
     or v_message.direction is distinct from 'outgoing'
     or v_message.message_type is distinct from 'text'
     or v_message.outbound_delivery_state is distinct from 'processing'
     or v_message.external_message_id is not null
     or v_message.deleted_at is not null
     or v_message.outbound_attempt_started_at is not null
     or coalesce(v_message.metadata ->> 'send_external', 'false') <> 'true'
     or coalesce(v_message.metadata ->> 'external_channel', '') <> 'whatsapp'
     or coalesce(v_message.metadata ->> 'outbound_kind', '') <> 'canonical_followup'
     or coalesce(v_message.metadata ->> 'outbound_origin', '') <> 'canonical_followup' then
    v_block_reason := 'template_message_scope_invalid';
  end if;

  if v_block_reason is null then
    v_action_queue_id :=
      nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'action_queue_id', '')), '');

    if v_action_queue_id is null then
      v_block_reason := 'template_action_queue_id_required';
    end if;
  end if;

  if v_block_reason is null then
    select queue_row.*
    into v_queue
    from public.ai_sales_action_queue as queue_row
    where queue_row.id::text = v_action_queue_id
      and queue_row.organization_id = p_organization_id
      and queue_row.store_id = p_store_id
      and queue_row.conversation_id = v_message.conversation_id
    for share;

    if not found then
      v_block_reason := 'template_canonical_queue_missing';
    elsif pg_catalog.lower(pg_catalog.btrim(coalesce(v_queue.next_action, '')))
          is distinct from v_expected_action then
      v_block_reason := 'template_action_changed_before_send';
    end if;
  end if;

  if v_block_reason is null then
    v_expected_source :=
      case
        when v_expected_action = 'followup_visit'
          then 'ai_sales_real_handler_followup_visit'
        else 'ai_sales_real_handler_followup_offer'
      end;

    v_expected_handler :=
      case
        when v_expected_action = 'followup_visit'
          then 'real_handler_followup_visit'
        else 'real_handler_followup_offer'
      end;

    if v_message.metadata ->> 'source' is distinct from v_expected_source
       or v_message.metadata ->> 'handler_key' is distinct from v_expected_handler
       or v_queue.payload ->> 'commercial_opportunity_id'
            is distinct from v_message.metadata ->> 'commercial_opportunity_id'
       or v_queue.payload ->> 'followup_id'
            is distinct from v_message.metadata ->> 'followup_id'
       or v_queue.payload ->> 'followup_cycle'
            is distinct from v_message.metadata ->> 'followup_cycle'
       or v_queue.payload ->> 'followup_operation_key'
            is distinct from v_message.metadata ->> 'followup_operation_key' then
      v_block_reason := 'template_action_identity_changed_before_send';
    end if;
  end if;

  if v_block_reason is not null then
    update public.messages as message_row
    set
      outbound_delivery_state = 'failed',
      outbound_claimed_at = null,
      outbound_claimed_by = null,
      outbound_attempt_started_at = null,
      outbound_uncertain_at = null,
      outbound_error_text =
        ('ZION_EXTERNAL_TEMPLATE_SEND_BLOCKED:' || v_block_reason)::text
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
        message = 'P19A_CUSTOMER_WHATSAPP_TEMPLATE_BLOCK_TRANSITION_LOST';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'blocked',
      'reason', v_block_reason,
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id
    );
  end if;

  return public.validate_or_cancel_whatsapp_external_send_v2_by_system(
    p_organization_id,
    p_store_id,
    p_message_id
  );
end;
$function$;

alter function public.validate_or_cancel_whatsapp_template_followup_send_by_system(
  uuid, uuid, uuid, text
)
  owner to postgres;

revoke all on function
  public.validate_or_cancel_whatsapp_template_followup_send_by_system(
    uuid, uuid, uuid, text
  )
from public, anon, authenticated;

grant execute on function
  public.validate_or_cancel_whatsapp_template_followup_send_by_system(
    uuid, uuid, uuid, text
  )
to service_role;

comment on function
  public.claim_template_required_canonical_followup_by_system(uuid, uuid, uuid, integer)
is
  'P19-A 4.5.2 atomic claim for canonical customer follow-up templates. Revalidates queue action and canonical identity before template_required becomes processing.';

comment on function
  public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid, uuid, uuid, text)
is
  'P19-A 4.5.2 final template boundary. Revalidates that the exact template action selected at claim time is still current, then delegates commercial authority and processing-to-uncertain linearization to P9 v2.';

do $postconditions$
declare
  v_definition text;
begin
  if pg_catalog.to_regprocedure(
       'public.get_template_required_canonical_followups_by_system(uuid,uuid,integer,integer)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATE_READER_MISSING';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.get_template_required_canonical_followups_by_system(uuid,uuid,integer,integer)'::regprocedure
  );

  if v_definition not ilike '%outbound_delivery_state = ''template_required''%'
     or v_definition not ilike '%outbound_kind%'
     or v_definition not ilike '%canonical_followup%'
     or v_definition not ilike '%followup_offer%'
     or v_definition not ilike '%followup_visit%'
     or v_definition not ilike '%ai_sales_action_queue%' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATE_READER_POSTCONDITION_FAILED';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.get_template_required_canonical_followups_by_system(uuid,uuid,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.get_template_required_canonical_followups_by_system(uuid,uuid,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.get_template_required_canonical_followups_by_system(uuid,uuid,integer,integer)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.get_template_required_canonical_followups_by_system(uuid,uuid,integer,integer)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATE_READER_ACL_INVALID';
  end if;
end;
$postconditions$;


do $template_authority_postconditions$
declare
  v_claim_definition text;
  v_gate_definition text;
begin
  if pg_catalog.to_regprocedure(
       'public.claim_template_required_canonical_followup_by_system(uuid,uuid,uuid,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid,uuid,uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATE_AUTHORITY_MISSING';
  end if;

  v_claim_definition := pg_catalog.pg_get_functiondef(
    'public.claim_template_required_canonical_followup_by_system(uuid,uuid,uuid,integer)'::regprocedure
  );

  v_gate_definition := pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid,uuid,uuid,text)'::regprocedure
  );

  if v_claim_definition not ilike '%template_required%'
     or v_claim_definition not ilike '%template_action%'
     or v_claim_definition not ilike '%for share%'
     or v_gate_definition not ilike '%template_action_changed_before_send%'
     or v_gate_definition not ilike '%validate_or_cancel_whatsapp_external_send_v2_by_system%'
     or v_gate_definition not ilike '%for share%' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATE_AUTHORITY_POSTCONDITION_FAILED';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.claim_template_required_canonical_followup_by_system(uuid,uuid,uuid,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.claim_template_required_canonical_followup_by_system(uuid,uuid,uuid,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.claim_template_required_canonical_followup_by_system(uuid,uuid,uuid,integer)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.claim_template_required_canonical_followup_by_system(uuid,uuid,uuid,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       'public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATE_AUTHORITY_ACL_INVALID';
  end if;
end;
$template_authority_postconditions$;

commit;