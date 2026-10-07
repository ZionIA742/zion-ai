-- P19-A 4.5.3: canonical manual document outbound contract.
-- This preserves the existing v2 scope, retry lease, and delivery-state gates.

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
      message_row.sender = 'ai'
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') in (
          'crm_manual_text',
          'crm_manual_image',
          'crm_manual_document',
          'sales_quote_send'
        )
      )
    )
    and message_row.direction = 'outgoing'
    and message_row.external_message_id is null
    and message_row.deleted_at is null
    and message_row.message_type in ('text', 'image', 'document')
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
