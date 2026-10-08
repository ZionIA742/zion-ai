begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';

-- P19-A 4.5.3 / I4: include canonical manual audio/video in the external reader.
-- Keep AI, quote-send, lease, scope, and uncertain-state semantics unchanged.

do $preconditions$
begin
  if pg_catalog.to_regprocedure(
       'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I4_PENDING_EXTERNAL_READER_MISSING';
  end if;
end;
$preconditions$;

create or replace function public.get_pending_external_messages_v2(
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
  outbound_commercial_error_text text
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
    message_row.outbound_commercial_error_text
  from public.messages as message_row
  join public.conversations as conversation_row
    on conversation_row.id = message_row.conversation_id
   and conversation_row.organization_id = message_row.organization_id
  join public.leads as lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id = message_row.organization_id
   and lead_row.store_id = message_row.store_id
  where message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and (
      (
        message_row.sender = 'ai'
        and message_row.message_type in ('text', 'image', 'document')
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') in (
          'crm_manual_text',
          'crm_manual_image',
          'crm_manual_document'
        )
        and message_row.message_type in ('text', 'image', 'document')
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'sales_quote_send'
        and message_row.message_type in ('text', 'image', 'document')
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'crm_manual_audio'
        and message_row.message_type = 'audio'
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'crm_manual_video'
        and message_row.message_type = 'video'
      )
    )
    and message_row.direction = 'outgoing'
    and message_row.external_message_id is null
    and message_row.deleted_at is null
    and coalesce(message_row.metadata ->> 'send_external', 'false') = 'true'
    and coalesce(message_row.metadata ->> 'external_channel', '') = 'whatsapp'
    and (
      coalesce(message_row.outbound_delivery_state, 'pending') = 'pending'
      or (
        message_row.outbound_delivery_state = 'processing'
        and message_row.outbound_attempt_started_at is null
        and message_row.outbound_claimed_at is not null
        and message_row.outbound_claimed_at < (
          clock_timestamp()
          - make_interval(
              secs => greatest(coalesce(p_processing_lease_seconds, 600), 1)
            )
        )
      )
    )
  order by
    coalesce(message_row.outbound_claimed_at, message_row.created_at) asc,
    message_row.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

alter function public.get_pending_external_messages_v2(
  uuid, uuid, integer, integer
) owner to postgres;

revoke all on function public.get_pending_external_messages_v2(
  uuid, uuid, integer, integer
) from public, anon, authenticated;

grant execute on function public.get_pending_external_messages_v2(
  uuid, uuid, integer, integer
) to service_role;

do $postconditions$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like '%message_row.sender = ''ai'' and message_row.message_type in (''text'', ''image'', ''document'')%'
     or v_definition not like '%outbound_origin'', '''') in ( ''crm_manual_text'', ''crm_manual_image'', ''crm_manual_document'' ) and message_row.message_type in (''text'', ''image'', ''document'')%'
     or v_definition not like '%message_row.sender = ''human'' and coalesce(message_row.metadata ->> ''outbound_origin'', '''') = ''sales_quote_send'' and message_row.message_type in (''text'', ''image'', ''document'')%'
     or v_definition not like '%outbound_origin'', '''') = ''crm_manual_audio'' and message_row.message_type = ''audio''%'
     or v_definition not like '%outbound_origin'', '''') = ''crm_manual_video'' and message_row.message_type = ''video''%'
     or v_definition not like '%crm_manual_text%'
     or v_definition not like '%crm_manual_image%'
     or v_definition not like '%crm_manual_document%'
     or v_definition like '%sales_quote_send'' and message_row.message_type in (''text'', ''image'', ''audio'', ''video'', ''document'')%'
     or v_definition like '%message_row.sender = ''ai'' and message_row.message_type in (''text'', ''image'', ''audio'', ''video'', ''document'')%'
     or v_definition not like '%outbound_attempt_started_at is null%'
     or v_definition not like '%outbound_claimed_at <%'
     or v_definition not like '%message_row.organization_id = p_organization_id%'
     or v_definition not like '%message_row.store_id = p_store_id%'
     or v_definition not like '%lead_row.store_id = message_row.store_id%'
     or v_definition like '%outbound_delivery_state = ''uncertain''%'
     or v_definition not like '%external_message_id is null%'
     or v_definition not like '%deleted_at is null%' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I4_PENDING_EXTERNAL_READER_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
