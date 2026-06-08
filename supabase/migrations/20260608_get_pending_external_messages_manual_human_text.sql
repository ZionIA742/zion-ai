create or replace function public.get_pending_external_messages(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  message_id uuid,
  conversation_id uuid,
  lead_id uuid,
  lead_phone text,
  message_type text,
  content text,
  media_url text,
  metadata jsonb,
  created_at timestamp with time zone
)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    m.id as message_id,
    m.conversation_id,
    c.lead_id,
    l.phone as lead_phone,
    m.message_type,
    m.content,
    m.media_url,
    coalesce(m.metadata, '{}'::jsonb) as metadata,
    m.created_at
  from public.messages m
  join public.conversations c
    on c.id = m.conversation_id
  join public.leads l
    on l.id = c.lead_id
  where m.organization_id = p_organization_id
    and l.store_id = p_store_id
    and (
      m.sender = 'ai'
      or (
        m.sender = 'human'
        and coalesce(m.metadata->>'outbound_origin', '') in ('crm_manual_text', 'crm_manual_image')
      )
    )
    and m.direction = 'outgoing'
    and m.external_message_id is null
    and m.deleted_at is null
    and m.message_type in ('text', 'image')
    and coalesce(m.metadata->>'send_external', 'false') = 'true'
    and coalesce(m.metadata->>'external_channel', '') = 'whatsapp'
  order by m.created_at asc
  limit 10;
$function$;
