-- P9 Block 10 / Etapa 10.1
-- A human message sent from the CRM panel must atomically enter human takeover.
-- The condition is deliberately limited to panel-owned human outbound metadata;
-- webhook echoes and system-generated outbound messages remain unchanged.

create or replace function public.insert_message(
  p_conversation_id uuid,
  p_sender text,
  p_direction text,
  p_message_type text,
  p_content text,
  p_external_message_id text default null,
  p_media_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org_id uuid;
  v_lead_id uuid;
  v_store_id uuid;
  v_row public.messages;
  v_content text;
  v_sender text;
  v_direction text;
  v_message_type text;
begin
  perform set_config('app.insert_via_function', 'true', true);

  v_sender := lower(trim(p_sender));
  v_direction := lower(trim(p_direction));
  v_message_type := lower(trim(p_message_type));
  v_content := nullif(btrim(p_content), '');

  select c.organization_id, c.lead_id
  into v_org_id, v_lead_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_org_id is null then
    raise exception 'conversation_not_found: %', p_conversation_id;
  end if;

  if v_lead_id is null then
    raise exception 'conversation_without_lead: %', p_conversation_id;
  end if;

  select l.store_id
  into v_store_id
  from public.leads l
  where l.id = v_lead_id;

  if not found then
    raise exception 'lead_not_found_for_conversation: %, lead_id=%', p_conversation_id, v_lead_id;
  end if;

  if v_store_id is null then
    raise exception 'lead_without_store: %, lead_id=%', p_conversation_id, v_lead_id;
  end if;

  if v_sender not in ('user', 'ai', 'human') then
    raise exception 'invalid_sender: %', p_sender;
  end if;

  if v_direction not in ('incoming', 'outgoing') then
    raise exception 'invalid_direction: %', p_direction;
  end if;

  if v_message_type not in ('text', 'image', 'audio', 'video', 'document') then
    raise exception 'invalid_message_type: %', p_message_type;
  end if;

  if v_message_type = 'text' and v_content is null then
    raise exception 'text_message_requires_content';
  end if;

  if v_message_type = 'text' and p_media_url is not null then
    raise exception 'text_message_cannot_have_media_url';
  end if;

  if v_message_type in ('image', 'audio', 'video', 'document') and p_media_url is null then
    raise exception 'media_message_requires_media_url: %', v_message_type;
  end if;

  if v_message_type in ('image', 'audio', 'video', 'document') and v_content is null then
    raise exception 'media_message_requires_content: %', v_message_type;
  end if;

  perform public.private_acquire_sales_contract_conversation_xact_lock(p_conversation_id);

  perform public.ensure_commercial_conversation_session_context(
    v_org_id,
    v_store_id,
    p_conversation_id
  );

  if v_sender = 'human'
     and v_direction = 'outgoing'
     and coalesce(p_metadata ->> 'source', '') = 'panel'
     and (
       coalesce(p_metadata ->> 'outbound_origin', '') = 'crm_manual_text'
       or coalesce(p_metadata ->> 'source_channel', '') = 'panel_manual'
     )
  then
    perform public.human_takeover_conversation(
      p_conversation_id,
      'automatic_panel_human_message'
    );
  end if;

  insert into public.messages (
    organization_id,
    conversation_id,
    sender,
    direction,
    message_type,
    content,
    external_message_id,
    media_url,
    metadata,
    lead_id,
    store_id
  )
  values (
    v_org_id,
    p_conversation_id,
    v_sender,
    v_direction,
    v_message_type,
    v_content,
    p_external_message_id,
    p_media_url,
    coalesce(p_metadata, '{}'::jsonb),
    v_lead_id,
    v_store_id
  )
  returning * into v_row;

  return v_row;
end;
$function$;

alter function public.insert_message(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) owner to postgres;

revoke all on function public.insert_message(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.insert_message(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;
