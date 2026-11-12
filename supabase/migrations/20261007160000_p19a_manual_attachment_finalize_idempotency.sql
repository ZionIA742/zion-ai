do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.messages'::regclass and attname = 'outbound_idempotency_key' and not attisdropped) then
    raise exception 'precondition failed: messages.outbound_idempotency_key is required';
  end if;
  if not exists (select 1 from pg_class where relname = 'messages_org_store_outbound_idempotency_uidx' and relkind = 'i') then
    raise exception 'precondition failed: messages_org_store_outbound_idempotency_uidx is required';
  end if;
  if to_regprocedure('public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)') is null then
    raise exception 'precondition failed: canonical conversation session writer is required';
  end if;
end $$;

create or replace function public.finalize_manual_attachment_message(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_message_type text,
  p_content text,
  p_media_url text,
  p_metadata jsonb,
  p_outbound_idempotency_key text,
  p_payload_fingerprint text
)
returns table (message_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $$
declare
  v_message_id uuid;
  v_existing public.messages%rowtype;
  v_prefix text;
begin
  if p_organization_id is null or p_store_id is null or p_conversation_id is null or p_lead_id is null
     or nullif(btrim(p_outbound_idempotency_key), '') is null
     or nullif(btrim(p_payload_fingerprint), '') is null
     or nullif(btrim(p_media_url), '') is null
     or p_message_type not in ('image', 'video', 'audio', 'document') then
    raise exception using errcode = '22023', message = 'MANUAL_ATTACHMENT_INVALID_INPUT';
  end if;

  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.organization_id = p_organization_id and c.lead_id = p_lead_id
  ) or not exists (
    select 1 from public.leads l
    where l.id = p_lead_id and l.organization_id = p_organization_id and l.store_id = p_store_id
  ) then
    raise exception using errcode = '42501', message = 'MANUAL_ATTACHMENT_SCOPE_MISMATCH';
  end if;

  v_prefix := p_organization_id::text || '/' || p_store_id::text || '/manual-attachments/' || p_conversation_id::text || '/';
  if left(p_media_url, length(v_prefix)) <> v_prefix or position('..' in p_media_url) > 0 or strpos(p_media_url, chr(92)) > 0 then
    raise exception using errcode = '22023', message = 'MANUAL_ATTACHMENT_PATH_INVALID';
  end if;
  if coalesce(p_metadata->>'storage_bucket', '') <> 'zion-store-files'
     or coalesce(p_metadata->>'storage_path', '') <> p_media_url
     or coalesce(p_metadata->>'outbound_idempotency_key', '') <> p_outbound_idempotency_key
     or coalesce(p_metadata->>'manual_attachment_payload_fingerprint', '') <> p_payload_fingerprint
     or coalesce(p_metadata->>'attachment_kind', '') <> p_message_type
     or nullif(p_metadata->>'mime_type', '') is null
     or nullif(p_metadata->>'size_bytes', '') is null then
    raise exception using errcode = '22023', message = 'MANUAL_ATTACHMENT_METADATA_INVALID';
  end if;

  perform public.ensure_commercial_conversation_session_context(p_organization_id, p_store_id, p_conversation_id);

  insert into public.messages (
    organization_id, store_id, conversation_id, lead_id, sender, direction, message_type,
    content, media_url, metadata, outbound_idempotency_key, outbound_delivery_state
  ) values (
    p_organization_id, p_store_id, p_conversation_id, p_lead_id, 'human', 'outgoing', p_message_type,
    p_content, p_media_url, p_metadata,
    p_outbound_idempotency_key,
    case when coalesce((p_metadata->>'send_external')::boolean, false) then 'pending' else null end
  )
  on conflict (organization_id, store_id, outbound_idempotency_key)
  where outbound_idempotency_key is not null
  do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    return query select v_message_id, false;
    return;
  end if;

  select m.* into v_existing
  from public.messages m
  where m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and m.outbound_idempotency_key = p_outbound_idempotency_key
  for update;
  if v_existing.id is null
     or v_existing.conversation_id <> p_conversation_id
     or v_existing.lead_id <> p_lead_id
     or v_existing.sender <> 'human'
     or v_existing.direction <> 'outgoing'
     or v_existing.message_type <> p_message_type
     or v_existing.content is distinct from p_content
     or v_existing.media_url is distinct from p_media_url
     or coalesce(v_existing.metadata->>'manual_attachment_payload_fingerprint', '') <> p_payload_fingerprint
     or coalesce(v_existing.metadata->>'storage_path', '') <> p_media_url
     or v_existing.deleted_at is not null then
    raise exception using errcode = '23514', message = 'MANUAL_ATTACHMENT_IDEMPOTENCY_CONFLICT';
  end if;
  return query select v_existing.id, true;
end;
$$;

alter function public.finalize_manual_attachment_message(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, text) owner to postgres;
revoke all on function public.finalize_manual_attachment_message(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.finalize_manual_attachment_message(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, text) to service_role;
