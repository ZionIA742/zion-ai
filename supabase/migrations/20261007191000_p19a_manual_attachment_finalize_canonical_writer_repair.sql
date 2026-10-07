do $$
begin
  if to_regprocedure(
    'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
  ) is null then
    raise exception
      'P19A_MANUAL_ATTACHMENT_REPAIR_PRECONDITION: public.insert_message(...) is missing';
  end if;

  if to_regprocedure(
    'public.finalize_manual_attachment_message(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text)'
  ) is null then
    raise exception
      'P19A_MANUAL_ATTACHMENT_REPAIR_PRECONDITION: finalize_manual_attachment_message(...) is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'messages'
      and indexname = 'messages_org_store_outbound_idempotency_uidx'
  ) then
    raise exception
      'P19A_MANUAL_ATTACHMENT_REPAIR_PRECONDITION: messages idempotency index is missing';
  end if;
end
$$;

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
returns table (
  message_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_message public.messages%rowtype;
  v_existing public.messages%rowtype;
  v_prefix text;
  v_normalized_content text;
  v_delivery_state text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_conversation_id is null
     or p_lead_id is null
     or nullif(btrim(p_outbound_idempotency_key), '') is null
     or nullif(btrim(p_payload_fingerprint), '') is null
     or nullif(btrim(p_media_url), '') is null
     or p_message_type not in ('image', 'video', 'audio', 'document') then
    raise exception using
      errcode = '22023',
      message = 'MANUAL_ATTACHMENT_INVALID_INPUT';
  end if;

  v_normalized_content := nullif(btrim(p_content), '');

  if v_normalized_content is null then
    raise exception using
      errcode = '22023',
      message = 'MANUAL_ATTACHMENT_CONTENT_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.organization_id = p_organization_id
      and c.lead_id = p_lead_id
  )
  or not exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.organization_id = p_organization_id
      and l.store_id = p_store_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'MANUAL_ATTACHMENT_SCOPE_MISMATCH';
  end if;

  v_prefix :=
    p_organization_id::text
    || '/'
    || p_store_id::text
    || '/manual-attachments/'
    || p_conversation_id::text
    || '/';

  if left(p_media_url, length(v_prefix)) <> v_prefix
     or position('..' in p_media_url) > 0
     or strpos(p_media_url, chr(92)) > 0 then
    raise exception using
      errcode = '22023',
      message = 'MANUAL_ATTACHMENT_PATH_INVALID';
  end if;

  if coalesce(p_metadata->>'storage_bucket', '') <> 'zion-store-files'
     or coalesce(p_metadata->>'storage_path', '') <> p_media_url
     or coalesce(p_metadata->>'outbound_idempotency_key', '') <> p_outbound_idempotency_key
     or coalesce(p_metadata->>'manual_attachment_payload_fingerprint', '') <> p_payload_fingerprint
     or coalesce(p_metadata->>'attachment_kind', '') <> p_message_type
     or nullif(p_metadata->>'mime_type', '') is null
     or nullif(p_metadata->>'size_bytes', '') is null then
    raise exception using
      errcode = '22023',
      message = 'MANUAL_ATTACHMENT_METADATA_INVALID';
  end if;

  /*
   * Same tenant + same idempotency key must be serialized before
   * materialization. This preserves replay semantics while allowing the
   * canonical public.insert_message() writer to remain the only INSERT path.
   *
   * A hash collision can only serialize unrelated requests; it cannot make
   * them share data or pass the scoped replay checks below.
   */
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text
      || ':'
      || p_store_id::text
      || ':'
      || p_outbound_idempotency_key,
      0
    )
  );

  select m.*
  into v_existing
  from public.messages m
  where m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and m.outbound_idempotency_key = p_outbound_idempotency_key
  for update;

  if v_existing.id is not null then
    if v_existing.conversation_id <> p_conversation_id
       or v_existing.lead_id <> p_lead_id
       or v_existing.sender <> 'human'
       or v_existing.direction <> 'outgoing'
       or v_existing.message_type <> p_message_type
       or v_existing.content is distinct from v_normalized_content
       or v_existing.media_url is distinct from p_media_url
       or coalesce(
            v_existing.metadata->>'manual_attachment_payload_fingerprint',
            ''
          ) <> p_payload_fingerprint
       or coalesce(
            v_existing.metadata->>'storage_path',
            ''
          ) <> p_media_url
       or v_existing.deleted_at is not null then
      raise exception using
        errcode = '23514',
        message = 'MANUAL_ATTACHMENT_IDEMPOTENCY_CONFLICT';
    end if;

    return query
      select v_existing.id, true;

    return;
  end if;

  /*
   * Canonical message materialization.
   * insert_message() owns message INSERT authorization, conversation/store
   * derivation, commercial-session enforcement and message invariants.
   */
  select *
  into v_message
  from public.insert_message(
    p_conversation_id,
    'human',
    'outgoing',
    p_message_type,
    v_normalized_content,
    null,
    p_media_url,
    p_metadata
  );

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'MANUAL_ATTACHMENT_INSERT_FAILED';
  end if;

  /*
   * The canonical writer intentionally does not expose the outbound
   * idempotency/delivery columns. Attach them to the row it just created.
   * The transaction-level idempotency lock above prevents two finalize calls
   * for the same tenant/key from reaching this point concurrently.
   */
  v_delivery_state :=
    case
      when coalesce((p_metadata->>'send_external')::boolean, false)
        then 'pending'
      else null
    end;

  update public.messages
  set
    outbound_idempotency_key = p_outbound_idempotency_key,
    outbound_delivery_state = v_delivery_state
  where id = v_message.id
    and organization_id = p_organization_id
    and store_id = p_store_id
  returning *
  into v_message;

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'MANUAL_ATTACHMENT_FINALIZE_UPDATE_FAILED';
  end if;

  return query
    select v_message.id, false;
end;
$function$;

alter function public.finalize_manual_attachment_message(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text
) owner to postgres;

revoke all
on function public.finalize_manual_attachment_message(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text
)
from public, anon, authenticated;

grant execute
on function public.finalize_manual_attachment_message(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text
)
to service_role;