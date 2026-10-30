-- ZION / Central I8 -- human response supersedes a pending Sales AI reply.
-- Built from the two real production function definitions exported on 2026-10-30.
-- No text substitutions against pg_get_functiondef at installation time.
-- Restricted to the two existing functions; no message sends or history mutations.
-- If either production function has changed, fail before applying anything.

BEGIN;

DO $deploy_i8$
DECLARE
  v_materialize_oid oid := pg_catalog.to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'
  );
  v_gate_oid oid := pg_catalog.to_regprocedure(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'
  );
  v_materialize_before record;
  v_gate_before record;
  v_materialize_after record;
  v_gate_after record;
  v_materialize_definition text;
  v_gate_definition text;
BEGIN
  IF v_materialize_oid IS NULL OR v_gate_oid IS NULL
     OR pg_catalog.to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'P19A_I8_HUMAN_PRIORITY_DEPENDENCY_MISSING';
  END IF;

  SELECT p.proowner, p.proacl, p.proconfig, p.prosecdef,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  INTO STRICT v_materialize_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_materialize_oid;

  SELECT p.proowner, p.proacl, p.proconfig, p.prosecdef,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  INTO STRICT v_gate_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_gate_oid;

  -- Exact hashes are from the user's production SQL Editor export.
  -- MD5 is used as a drift detector, not as an authorization mechanism.
  IF pg_catalog.md5(v_materialize_before.definition) <> '0984f2e0fbc65fa855874e19c5c3ac19'
     OR pg_catalog.md5(v_gate_before.definition) <> '7ca54c315a5cb1ad756d6c2fea6bc93d' THEN
    RAISE EXCEPTION 'P19A_I8_HUMAN_PRIORITY_PRODUCTION_DRIFT';
  END IF;

  IF pg_catalog.pg_get_userbyid(v_materialize_before.proowner) <> 'postgres'
     OR pg_catalog.pg_get_userbyid(v_gate_before.proowner) <> 'postgres'
     OR v_materialize_before.prosecdef IS DISTINCT FROM true
     OR v_gate_before.prosecdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'P19A_I8_HUMAN_PRIORITY_SECURITY_CONTRACT_MISMATCH';
  END IF;

  -- Full, explicit CREATE OR REPLACE FUNCTION, with original signature,
  -- grants, owner and SET clauses preserved. No DROP, no cascading changes.
  EXECUTE $materialize_ddl$
CREATE OR REPLACE FUNCTION public.materialize_sales_ai_reply_set_by_system(p_organization_id uuid, p_store_id uuid, p_conversation_id uuid, p_lead_id uuid, p_anchor_message_id uuid, p_commercial_opportunity_id uuid, p_ai_text text, p_outbound_kind text, p_external_authorized boolean, p_document_actions jsonb DEFAULT '[]'::jsonb, p_photo_action jsonb DEFAULT NULL::jsonb, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(response_set_id uuid, text_message_id uuid, document_message_ids uuid[], photo_message_id uuid, request_fingerprint text, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_request_role text := auth.role();
  v_conversation public.conversations%rowtype;
  v_lead public.leads%rowtype;
  v_opportunity public.commercial_opportunities%rowtype;
  v_anchor public.messages%rowtype;
  v_latest_anchor public.messages%rowtype;
  v_existing public.p19a_sales_ai_reply_sets%rowtype;
  v_set_id uuid;
  v_text_message public.messages%rowtype;
  v_media_message public.messages%rowtype;
  v_pool public.pools%rowtype;
  v_pool_photo public.pool_photos%rowtype;
  v_item public.store_catalog_items%rowtype;
  v_item_photo public.store_catalog_item_photos%rowtype;
  v_import_file public.store_import_files%rowtype;
  v_document jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_photo jsonb := null;
  v_document_ids uuid[] := '{}'::uuid[];
  v_photo_id uuid;
  v_seen_import_ids uuid[] := '{}'::uuid[];
  v_import_file_id uuid;
  v_source_id uuid;
  v_target_type text;
  v_caption text;
  v_storage_path text;
  v_storage_bucket text;
  v_media_url text;
  v_catalog_photo_id uuid;
  v_catalog_photo_source text;
  v_original_filename text;
  v_mime_type text;
  v_extension text;
  v_sort_order integer;
  v_key text;
  v_fingerprint text;
  v_request_payload jsonb;
  v_canonical_payload jsonb;
  v_metadata jsonb;
  v_send_external boolean := coalesce(p_external_authorized, false);
  v_media_send_external boolean := false;
  v_has_newer_incoming boolean;
  v_has_newer_human boolean;
  v_real_whatsapp boolean;
  v_stop_event_exists boolean;
begin
  if v_request_role is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'P19A_I8_SERVICE_ROLE_REQUIRED';
  end if;

  if p_organization_id is null or p_store_id is null or p_conversation_id is null
     or p_lead_id is null or p_anchor_message_id is null
     or nullif(btrim(coalesce(p_ai_text, '')), '') is null
     or p_outbound_kind not in ('reactive_ai_reply', 'stop_contact_ack')
     or jsonb_typeof(coalesce(p_document_actions, '[]'::jsonb)) <> 'array'
     or (p_photo_action is not null and jsonb_typeof(p_photo_action) <> 'object') then
    raise exception using errcode = '22023', message = 'P19A_I8_INVALID_INPUT';
  end if;

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id and organization_id = p_organization_id and lead_id = p_lead_id;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_CONVERSATION_SCOPE_MISMATCH';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and organization_id = p_organization_id and store_id = p_store_id;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_LEAD_SCOPE_MISMATCH';
  end if;

  select * into v_anchor
  from public.messages
  where id = p_anchor_message_id
    and organization_id = p_organization_id
    and store_id = p_store_id
    and conversation_id = p_conversation_id
    and sender = 'user'
    and direction = 'incoming'
    and deleted_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_ANCHOR_SCOPE_MISMATCH';
  end if;

  if p_commercial_opportunity_id is not null then
    select * into v_opportunity
    from public.commercial_opportunities
    where id = p_commercial_opportunity_id
      and organization_id = p_organization_id
      and store_id = p_store_id
    for update;
    if not found then
      raise exception using errcode = '42501', message = 'P19A_I8_OPPORTUNITY_SCOPE_MISMATCH';
    end if;
  elsif v_send_external then
    raise exception using errcode = '42501', message = 'P19A_I8_EXTERNAL_OPPORTUNITY_REQUIRED';
  end if;

  -- P9 acquires the opportunity row before the conversation advisory lock.
  -- Keep this order identical to the final outbound gate and writers.
  perform public.private_acquire_sales_contract_conversation_xact_lock(p_conversation_id);

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id and organization_id = p_organization_id and lead_id = p_lead_id;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_CONVERSATION_SCOPE_MISMATCH';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and organization_id = p_organization_id and store_id = p_store_id;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_LEAD_SCOPE_MISMATCH';
  end if;

  select * into v_anchor
  from public.messages
  where id = p_anchor_message_id
    and organization_id = p_organization_id
    and store_id = p_store_id
    and conversation_id = p_conversation_id
    and sender = 'user'
    and direction = 'incoming'
    and deleted_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_ANCHOR_SCOPE_MISMATCH';
  end if;

  select message_row.* into v_latest_anchor
  from public.messages message_row
  where message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and message_row.conversation_id = p_conversation_id
    and message_row.sender = 'user'
    and message_row.direction = 'incoming'
    and message_row.deleted_at is null
  order by message_row.created_at desc, message_row.id desc
  limit 1;
  if v_latest_anchor.id is distinct from v_anchor.id then
    raise exception using errcode = 'P0001', message = 'P19A_I8_ANCHOR_SUPERSEDED';
  end if;

  -- I8: the human may have replied after this customer request, or a previously
  -- prepared human message may have been accepted by Meta afterwards.
  select exists (
    select 1
    from public.messages human_row
    where human_row.organization_id = p_organization_id
      and human_row.store_id = p_store_id
      and human_row.conversation_id = p_conversation_id
      and human_row.sender = 'human'
      and human_row.direction = 'outgoing'
      and human_row.deleted_at is null
      and coalesce(human_row.metadata ->> 'outbound_origin', '') in (
        'crm_manual_text',
        'crm_manual_image',
        'crm_manual_document',
        'sales_contract_send',
        'sales_quote_send'
      )
      and (
        human_row.created_at > v_anchor.created_at
        or (
          human_row.outbound_delivery_state = 'sent'
          and human_row.external_message_id is not null
          and human_row.outbound_provider_accepted_at > v_anchor.created_at
        )
      )
  ) into v_has_newer_human;

  if v_has_newer_human then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_RESPONSE_SUPERSEDED_BY_HUMAN';
  end if;

  if p_commercial_opportunity_id is not null then
    select * into v_opportunity
    from public.commercial_opportunities
    where id = p_commercial_opportunity_id
      and organization_id = p_organization_id
      and store_id = p_store_id
    for update;
    if not found then
      raise exception using errcode = '42501', message = 'P19A_I8_OPPORTUNITY_SCOPE_MISMATCH';
    end if;
    if v_send_external and v_opportunity.primary_conversation_id is distinct from p_conversation_id then
      raise exception using errcode = '42501', message = 'P19A_I8_OPPORTUNITY_CONVERSATION_MISMATCH';
    end if;
  end if;

  if v_send_external then
    if v_anchor.commercial_session_context_link_id is null
       or not exists (
         select 1
         from public.commercial_session_context_links context_row
         where context_row.id = v_anchor.commercial_session_context_link_id
           and context_row.organization_id = p_organization_id
           and context_row.store_id = p_store_id
           and context_row.commercial_opportunity_id = p_commercial_opportunity_id
           and exists (
             select 1
             from public.conversation_sessions session_row
             where session_row.id = context_row.conversation_session_id
               and session_row.organization_id = p_organization_id
               and session_row.store_id = p_store_id
               and session_row.conversation_id = p_conversation_id
           )
       ) then
      raise exception using errcode = '23514', message = 'P19A_I8_ANCHOR_COMMERCIAL_CONTEXT_MISSING';
    end if;
    if v_anchor.metadata ->> 'source' is distinct from 'meta_whatsapp_webhook'
       or v_anchor.metadata ->> 'channel' is distinct from 'whatsapp'
       or v_anchor.metadata ->> 'external_channel' is distinct from 'whatsapp'
       or v_anchor.metadata ->> 'provider' is distinct from 'meta'
       or nullif(btrim(v_anchor.metadata ->> 'phone_number_id'), '') is null
       or v_anchor.external_message_id is null
       or not exists (
         select 1
         from public.get_active_whatsapp_integration_for_external_send_by_system(
           p_organization_id, p_store_id
         ) integration_row
         where integration_row.phone_number_id = v_anchor.metadata ->> 'phone_number_id'
       ) then
      raise exception using errcode = '23514', message = 'P19A_I8_ANCHOR_META_WHATSAPP_EVIDENCE_MISSING';
    end if;
  end if;

  v_request_payload := jsonb_build_object(
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'anchor_message_id', p_anchor_message_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'ai_text', btrim(p_ai_text),
    'outbound_kind', p_outbound_kind,
    'external_authorized', v_send_external,
    'document_actions', p_document_actions,
    'photo_action', coalesce(p_photo_action, 'null'::jsonb),
    'caller_payload', coalesce(p_payload, '{}'::jsonb)
  );
  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_request_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select * into v_existing
  from public.p19a_sales_ai_reply_sets
  where organization_id = p_organization_id and store_id = p_store_id and conversation_id = p_conversation_id and anchor_message_id = p_anchor_message_id
  for update;
  if found then
    if v_existing.materialization_state <> 'confirmed' or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'P19A_I8_RESPONSE_SET_PAYLOAD_MISMATCH_OR_INCOMPLETE';
    end if;
    return query select v_existing.id, v_existing.text_message_id, v_existing.document_message_ids, v_existing.photo_message_id, v_existing.request_fingerprint, true;
    return;
  end if;

  if exists (
    select 1 from public.messages message_row
    where message_row.organization_id = p_organization_id
      and message_row.store_id = p_store_id
      and message_row.conversation_id = p_conversation_id
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.deleted_at is null
      and message_row.created_at > v_anchor.created_at
  ) then
    raise exception using errcode = '23514', message = 'P19A_I8_ORPHANED_RESPONSE_WITHOUT_LEDGER';
  end if;

  if v_send_external then
    if p_outbound_kind not in ('reactive_ai_reply', 'stop_contact_ack') then
      raise exception using errcode = '23514', message = 'P19A_I8_EXTERNAL_AUTHORITY_INVALID';
    end if;
    v_real_whatsapp := public.is_real_whatsapp_conversation_for_external_send(
      p_organization_id, p_store_id, p_conversation_id
    );
    if not v_real_whatsapp then
      raise exception using errcode = '23514', message = 'P19A_I8_REAL_WHATSAPP_AUTHORITY_MISSING';
    end if;
  end if;

  if p_outbound_kind = 'stop_contact_ack' and v_send_external then
    select exists (
      select 1
      from public.commercial_opportunity_followup_events event_row
      where event_row.organization_id = p_organization_id
        and event_row.store_id = p_store_id
        and event_row.commercial_opportunity_id = p_commercial_opportunity_id
        and event_row.event_type = 'opted_out'
        and event_row.actor_type = 'system'
        and event_row.metadata ->> 'source_conversation_id' = p_conversation_id::text
        and event_row.metadata ->> 'source_message_id' = p_anchor_message_id::text
    ) into v_stop_event_exists;
    if not v_stop_event_exists then
      raise exception using errcode = '23514', message = 'P19A_I8_STOP_CONTACT_ACK_AUTHORITY_MISSING';
    end if;
  end if;

  if p_outbound_kind = 'stop_contact_ack' and p_photo_action is not null then
    raise exception using errcode = '23514', message = 'P19A_I8_STOP_CONTACT_MEDIA_FORBIDDEN';
  end if;
  if p_outbound_kind = 'stop_contact_ack' and jsonb_array_length(p_document_actions) > 0 then
    raise exception using errcode = '23514', message = 'P19A_I8_STOP_CONTACT_MEDIA_FORBIDDEN';
  end if;

  v_media_send_external := v_send_external and p_outbound_kind = 'reactive_ai_reply';

  for v_document in select value from jsonb_array_elements(p_document_actions) loop
    begin
      v_import_file_id := (v_document ->> 'import_file_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'P19A_I8_DOCUMENT_ID_INVALID';
    end;
    v_caption := nullif(btrim(v_document ->> 'caption'), '');
    v_sort_order := nullif(v_document ->> 'sort_order', '')::integer;
    if v_import_file_id is null or v_caption is null or v_sort_order is null
       or v_import_file_id = any(v_seen_import_ids) then
      raise exception using errcode = '22023', message = 'P19A_I8_DOCUMENT_ACTION_INVALID';
    end if;
    v_seen_import_ids := array_append(v_seen_import_ids, v_import_file_id);

    select file_row.* into v_import_file
    from public.store_catalog_customer_files authorized_file
    join public.store_import_files file_row
      on file_row.id = authorized_file.import_file_id
     and file_row.organization_id = authorized_file.organization_id
     and file_row.store_id = authorized_file.store_id
    where authorized_file.organization_id = p_organization_id
      and authorized_file.store_id = p_store_id
      and authorized_file.import_file_id = v_import_file_id
      and file_row.status = 'active'
      and nullif(btrim(file_row.storage_bucket), '') is not null
      and nullif(btrim(file_row.storage_path), '') is not null
      and exists (
        select 1 from public.store_catalog_settings settings_row
        where settings_row.organization_id = p_organization_id
          and settings_row.store_id = p_store_id
          and settings_row.allow_full_catalog_send is true
      );
    if not found then
      raise exception using errcode = '42501', message = 'P19A_I8_DOCUMENT_NOT_CANONICAL_OR_AUTHORIZED';
    end if;

    v_key := format('ai_sales_reply:%s:%s:%s:%s:document:%s', p_organization_id, p_store_id, p_conversation_id, p_anchor_message_id, v_import_file_id);
    v_documents := v_documents || jsonb_build_array(jsonb_build_object(
      'import_file_id', v_import_file_id,
      'sort_order', v_sort_order,
      'storage_bucket', v_import_file.storage_bucket,
      'storage_path', v_import_file.storage_path,
      'original_file_name', v_import_file.original_file_name,
      'mime_type', v_import_file.mime_type,
      'extension', v_import_file.extension,
      'caption', v_caption,
      'key', v_key
    ));
  end loop;

  if p_photo_action is not null then
    v_target_type := nullif(btrim(p_photo_action ->> 'target_type'), '');
    v_caption := nullif(btrim(p_photo_action ->> 'caption'), '');
    if v_target_type not in ('pool', 'catalog_item') or v_caption is null then
      raise exception using errcode = '22023', message = 'P19A_I8_PHOTO_ACTION_INVALID';
    end if;
    if v_target_type = 'pool' then
      if nullif(p_photo_action ->> 'pool_id', '') is null or nullif(p_photo_action ->> 'catalog_item_id', '') is not null then
        raise exception using errcode = '22023', message = 'P19A_I8_PHOTO_TARGET_IDENTITY_CONTRADICTORY';
      end if;
      v_source_id := (p_photo_action ->> 'pool_id')::uuid;
      select * into v_pool from public.pools where id = v_source_id and organization_id = p_organization_id and store_id = p_store_id and is_active is true for share;
      if not found then raise exception using errcode = '42501', message = 'P19A_I8_POOL_NOT_FOUND_OR_FORBIDDEN'; end if;
      select * into v_pool_photo from public.pool_photos where pool_id = v_pool.id and organization_id = p_organization_id and store_id = p_store_id and nullif(btrim(storage_path), '') is not null order by sort_order asc nulls last, id asc limit 1 for share;
      if found then
        v_catalog_photo_id := v_pool_photo.id; v_catalog_photo_source := 'pool_photos'; v_storage_bucket := 'pool-photos'; v_storage_path := btrim(v_pool_photo.storage_path); v_media_url := v_storage_path;
      else
        v_media_url := nullif(btrim(v_pool.photo_url), '');
        if v_media_url is null or v_media_url !~* '^https?://' then raise exception using errcode = '42501', message = 'P19A_I8_POOL_PHOTO_NOT_FOUND_OR_INVALID'; end if;
        v_catalog_photo_id := null; v_catalog_photo_source := 'pool_photo_url'; v_storage_bucket := null; v_storage_path := null;
      end if;
    else
      if nullif(p_photo_action ->> 'catalog_item_id', '') is null or nullif(p_photo_action ->> 'pool_id', '') is not null then
        raise exception using errcode = '22023', message = 'P19A_I8_PHOTO_TARGET_IDENTITY_CONTRADICTORY';
      end if;
      v_source_id := (p_photo_action ->> 'catalog_item_id')::uuid;
      select * into v_item from public.store_catalog_items where id = v_source_id and organization_id = p_organization_id and store_id = p_store_id and is_active is true for share;
      if not found then raise exception using errcode = '42501', message = 'P19A_I8_CATALOG_ITEM_NOT_FOUND_OR_FORBIDDEN'; end if;
      select * into v_item_photo from public.store_catalog_item_photos where catalog_item_id = v_item.id and nullif(btrim(storage_path), '') is not null order by sort_order asc nulls last, created_at asc nulls last, id asc limit 1 for share;
      if not found then raise exception using errcode = '42501', message = 'P19A_I8_CATALOG_ITEM_PHOTO_NOT_FOUND_OR_INVALID'; end if;
      v_catalog_photo_id := v_item_photo.id; v_catalog_photo_source := 'store_catalog_item_photos'; v_storage_bucket := 'store-catalog-photos'; v_storage_path := btrim(v_item_photo.storage_path); v_media_url := v_storage_path;
    end if;
    v_key := format('ai_sales_reply:%s:%s:%s:%s:photo:%s:%s', p_organization_id, p_store_id, p_conversation_id, p_anchor_message_id, v_target_type, v_source_id);
    v_photo := jsonb_build_object('target_type', v_target_type, 'source_id', v_source_id, 'catalog_photo_id', v_catalog_photo_id, 'catalog_photo_source', v_catalog_photo_source, 'storage_bucket', v_storage_bucket, 'storage_path', v_storage_path, 'media_url', v_media_url, 'caption', v_caption, 'key', v_key);
  end if;

  v_canonical_payload := jsonb_build_object(
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'anchor_message_id', p_anchor_message_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'ai_text', btrim(p_ai_text),
    'outbound_kind', p_outbound_kind,
    'external_authorized', v_send_external,
    'documents', v_documents,
    'photo', coalesce(v_photo, 'null'::jsonb),
    'caller_payload', coalesce(p_payload, '{}'::jsonb)
  );
  insert into public.p19a_sales_ai_reply_sets (organization_id, store_id, conversation_id, anchor_message_id, commercial_opportunity_id, request_fingerprint, payload)
  values (p_organization_id, p_store_id, p_conversation_id, p_anchor_message_id, p_commercial_opportunity_id, v_fingerprint, v_canonical_payload)
  returning id into v_set_id;

  v_metadata := jsonb_build_object('source', 'ai_sales_reply_set', 'p19a_response_set_id', v_set_id, 'p19a_response_set_anchor_message_id', p_anchor_message_id, 'p19a_response_set_fingerprint', v_fingerprint, 'source_message_id', p_anchor_message_id, 'organization_id', p_organization_id, 'store_id', p_store_id, 'commercial_opportunity_id', p_commercial_opportunity_id, 'outbound_kind', p_outbound_kind, 'channel', case when v_send_external then 'whatsapp' else null end, 'external_channel', case when v_send_external then 'whatsapp' else null end, 'send_external', v_send_external, 'outbound_origin', 'ai_sales_reply');
  select * into v_text_message from public.insert_message(p_conversation_id, 'ai', 'outgoing', 'text', btrim(p_ai_text), null, null, v_metadata || jsonb_build_object('outbound_idempotency_key', format('ai_sales_reply:%s:%s:%s:%s:text', p_organization_id, p_store_id, p_conversation_id, p_anchor_message_id)));
  update public.messages set outbound_idempotency_key = format('ai_sales_reply:%s:%s:%s:%s:text', p_organization_id, p_store_id, p_conversation_id, p_anchor_message_id), outbound_delivery_state = case when v_send_external then 'pending' else null end where id = v_text_message.id and organization_id = p_organization_id and store_id = p_store_id;

  for v_document in select value from jsonb_array_elements(v_documents) loop
    v_key := v_document ->> 'key';
    v_metadata := jsonb_build_object('source', 'ai_sales_reply_set', 'p19a_response_set_id', v_set_id, 'p19a_response_set_anchor_message_id', p_anchor_message_id, 'p19a_response_set_fingerprint', v_fingerprint, 'source_message_id', p_anchor_message_id, 'organization_id', p_organization_id, 'store_id', p_store_id, 'commercial_opportunity_id', p_commercial_opportunity_id, 'outbound_kind', case when v_media_send_external then 'reactive_ai_reply' else null end, 'channel', case when v_media_send_external then 'whatsapp' else null end, 'external_channel', case when v_media_send_external then 'whatsapp' else null end, 'send_external', v_media_send_external, 'outbound_origin', case when v_media_send_external then 'ai_sales_customer_catalog_document' else null end, 'media_purpose', 'customer_catalog_document', 'storage_bucket', v_document ->> 'storage_bucket', 'storage_path', v_document ->> 'storage_path', 'original_file_name', v_document ->> 'original_file_name', 'mime_type', v_document ->> 'mime_type', 'customer_catalog_import_file_id', v_document ->> 'import_file_id', 'customer_catalog_action_key', format('ai_sales_customer_catalog:%s:%s', p_anchor_message_id, v_document ->> 'import_file_id'), 'outbound_idempotency_key', v_key);
    select * into v_media_message from public.insert_message(p_conversation_id, 'ai', 'outgoing', 'document', v_document ->> 'caption', null, v_document ->> 'storage_path', v_metadata);
    update public.messages set outbound_idempotency_key = v_key, outbound_delivery_state = case when v_media_send_external then 'pending' else null end where id = v_media_message.id and organization_id = p_organization_id and store_id = p_store_id;
    v_document_ids := array_append(v_document_ids, v_media_message.id);
  end loop;

  if v_photo is not null then
    v_key := v_photo ->> 'key';
    v_metadata := jsonb_build_object('source', 'ai_sales_reply_set', 'p19a_response_set_id', v_set_id, 'p19a_response_set_anchor_message_id', p_anchor_message_id, 'p19a_response_set_fingerprint', v_fingerprint, 'source_message_id', p_anchor_message_id, 'organization_id', p_organization_id, 'store_id', p_store_id, 'commercial_opportunity_id', p_commercial_opportunity_id, 'outbound_kind', case when v_media_send_external then 'reactive_ai_reply' else null end, 'channel', case when v_media_send_external then 'whatsapp' else null end, 'external_channel', case when v_media_send_external then 'whatsapp' else null end, 'send_external', v_media_send_external, 'outbound_origin', case when v_media_send_external then 'ai_sales_catalog_photo' else null end, 'media_purpose', 'catalog_product_photo', 'target_type', v_photo ->> 'target_type', 'catalog_source_id', v_photo ->> 'source_id', 'catalog_photo_id', v_photo ->> 'catalog_photo_id', 'catalog_photo_source', v_photo ->> 'catalog_photo_source', 'storage_bucket', v_photo ->> 'storage_bucket', 'storage_path', v_photo ->> 'storage_path', 'pool_id', case when v_photo ->> 'target_type' = 'pool' then v_photo ->> 'source_id' else null end, 'catalog_item_id', case when v_photo ->> 'target_type' = 'catalog_item' then v_photo ->> 'source_id' else null end, 'outbound_idempotency_key', v_key);
    select * into v_media_message from public.insert_message(p_conversation_id, 'ai', 'outgoing', 'image', v_photo ->> 'caption', null, v_photo ->> 'media_url', v_metadata);
    update public.messages set outbound_idempotency_key = v_key, outbound_delivery_state = case when v_media_send_external then 'pending' else null end where id = v_media_message.id and organization_id = p_organization_id and store_id = p_store_id;
    v_photo_id := v_media_message.id;
  end if;

  update public.p19a_sales_ai_reply_sets
  set text_message_id = v_text_message.id, document_message_ids = v_document_ids, photo_message_id = v_photo_id, materialization_state = 'confirmed', confirmed_at = clock_timestamp()
  where id = v_set_id;

  return query select v_set_id, v_text_message.id, v_document_ids, v_photo_id, v_fingerprint, false;
end;
$function$;
$materialize_ddl$;

  EXECUTE $gate_ddl$
CREATE OR REPLACE FUNCTION public.validate_or_cancel_whatsapp_external_send_by_system(p_organization_id uuid, p_store_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );

  v_message public.messages;
  v_source_message public.messages;

  v_outbound_kind text;
  v_outbound_origin text;

  v_opportunity_id uuid;
  v_followup_id uuid;
  v_followup_cycle integer;
  v_action_queue_id uuid;
  v_source_message_id uuid;

  v_context_opportunity_id uuid;
  v_source_context_opportunity_id uuid;

  v_followup public.commercial_opportunity_followups;
  v_queue public.ai_sales_action_queue;

  v_block_reason text;
  v_stop_event_exists boolean := false;
  v_any_opt_out_exists boolean := false;
  v_newer_incoming_exists boolean := false;
  v_newer_human_exists boolean := false;
  v_real_whatsapp boolean := false;

  v_initial_sender text;
  v_initial_outbound_kind text;
  v_initial_opportunity_id uuid;
  v_initial_followup_id uuid;
  v_initial_followup_cycle integer;
  v_initial_action_queue_id uuid;

  v_opportunity public.commercial_opportunities;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'whatsapp external send gate is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_ARGUMENTS_REQUIRED';
  end if;

  /*
   * Initial identity read.
   *
   * No SEND authority is granted from this read. For Sales AI outbound we use
   * its identities only to acquire the same commercial locks used by the
   * opt-out/follow-up writers. The message is re-read after those locks and
   * the conversation lock are held.
   */
  select message_row.*
  into v_message
  from public.messages message_row
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_NOT_FOUND_IN_SCOPE';
  end if;

  if v_message.conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_CONVERSATION_REQUIRED';
  end if;

  v_initial_sender := v_message.sender;

  v_initial_outbound_kind :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_message.metadata ->> 'outbound_kind', '')
      ),
      ''
    );

  /*
   * Every external Sales AI message must carry an explicit outbound kind.
   * There is deliberately no permissive legacy AI fallback.
   */
  if v_message.sender = 'ai' then
    if v_initial_outbound_kind is null then
      v_block_reason := 'sales_ai_outbound_kind_required';
    elsif v_initial_outbound_kind not in (
      'reactive_ai_reply',
      'stop_contact_ack',
      'canonical_followup'
    ) then
      v_block_reason := 'unsupported_sales_ai_outbound_kind';
    end if;
  end if;

  /*
   * Serialize every recognized Sales AI outbound against its exact commercial
   * opportunity. The opt-out writer locks this same opportunity.
   */
  if v_block_reason is null
     and v_message.sender = 'ai' then
    begin
      v_initial_opportunity_id :=
        nullif(
          v_message.metadata ->> 'commercial_opportunity_id',
          ''
        )::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_sales_ai_opportunity_identity';
    end;

    if v_block_reason is null
       and v_initial_opportunity_id is null then
      v_block_reason := 'sales_ai_opportunity_identity_required';
    end if;

    if v_block_reason is null then
      select opportunity_row.*
      into v_opportunity
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = v_initial_opportunity_id
        and opportunity_row.organization_id = p_organization_id
        and opportunity_row.store_id = p_store_id
      for update;

      if not found then
        v_block_reason := 'sales_ai_opportunity_scope_mismatch';
      elsif v_opportunity.primary_conversation_id
              is distinct from v_message.conversation_id then
        v_block_reason := 'sales_ai_opportunity_conversation_mismatch';
      end if;
    end if;
  end if;

  /*
   * Canonical follow-up adds its exact follow-up identity.
   * Lock order matches commercial writers:
   *
   *   opportunity -> followup -> conversation
   */
  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_initial_outbound_kind = 'canonical_followup' then
    begin
      v_initial_followup_id :=
        nullif(v_message.metadata ->> 'followup_id', '')::uuid;

      v_initial_followup_cycle :=
        nullif(v_message.metadata ->> 'followup_cycle', '')::integer;

      v_initial_action_queue_id :=
        nullif(v_message.metadata ->> 'action_queue_id', '')::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_canonical_followup_identity';
    end;

    if v_block_reason is null
       and (
         v_initial_followup_id is null
         or v_initial_followup_cycle is null
         or v_initial_action_queue_id is null
       ) then
      v_block_reason := 'canonical_followup_identity_required';
    end if;

    if v_block_reason is null then
      select followup_row.*
      into v_followup
      from public.commercial_opportunity_followups followup_row
      where followup_row.id = v_initial_followup_id
        and followup_row.organization_id = p_organization_id
        and followup_row.store_id = p_store_id
        and followup_row.commercial_opportunity_id =
              v_initial_opportunity_id
        and followup_row.cycle = v_initial_followup_cycle
      for update;

      if not found then
        v_block_reason := 'canonical_followup_scope_mismatch';
      elsif v_followup.status <> 'active' then
        v_block_reason := 'stale_followup';
      end if;
    end if;
  end if;

  /*
   * Same transaction-level conversation lock used by insert_message.
   */
  perform public.private_acquire_sales_contract_conversation_xact_lock(
    v_message.conversation_id
  );

  /*
   * Fresh authority read after all required serialization locks are held.
   */
  select message_row.*
  into v_message
  from public.messages message_row
  where message_row.id = p_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and message_row.conversation_id = v_message.conversation_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED';
  end if;

  v_outbound_kind :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_message.metadata ->> 'outbound_kind', '')
      ),
      ''
    );

  v_outbound_origin :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_message.metadata ->> 'outbound_origin', '')
      ),
      ''
    );

  if v_block_reason is null
     and v_message.sender is distinct from v_initial_sender then
    v_block_reason := 'message_sender_changed_during_gate';
  end if;

  if v_block_reason is null
     and v_outbound_kind is distinct from v_initial_outbound_kind then
    v_block_reason := 'message_authority_metadata_changed_during_gate';
  end if;

  if v_block_reason is null then
    if v_message.deleted_at is not null
       or v_message.direction <> 'outgoing'
       or v_message.external_message_id is not null
       or coalesce(v_message.metadata ->> 'send_external', 'false') <> 'true'
       or coalesce(v_message.metadata ->> 'external_channel', '') <> 'whatsapp'
       or coalesce(v_message.outbound_delivery_state, '') <> 'processing'
       or v_message.outbound_attempt_started_at is not null then
      v_block_reason := 'message_not_claimed_for_external_send';
    end if;
  end if;

  /*
   * Fresh Sales AI opportunity identity must equal the identity whose row
   * lock is held.
   */
  if v_block_reason is null
     and v_message.sender = 'ai' then
    begin
      v_opportunity_id :=
        nullif(
          v_message.metadata ->> 'commercial_opportunity_id',
          ''
        )::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_sales_ai_opportunity_identity';
    end;

    if v_block_reason is null
       and (
         v_opportunity_id is null
         or v_opportunity_id is distinct from v_initial_opportunity_id
       ) then
      v_block_reason := 'sales_ai_opportunity_identity_changed_during_gate';
    end if;
  end if;

  /*
   * At the final controlled boundary, Sales AI external transport must still
   * belong to a proven real Meta WhatsApp conversation.
   */
  if v_block_reason is null
     and v_message.sender = 'ai' then
    v_real_whatsapp :=
      public.is_real_whatsapp_conversation_for_external_send(
        p_organization_id,
        p_store_id,
        v_message.conversation_id
      );

    if not v_real_whatsapp then
      v_block_reason := 'real_whatsapp_authority_missing';
    end if;
  end if;

  /*
   * Fresh canonical identities must equal the identities whose locks are held.
   */
  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_outbound_kind = 'canonical_followup' then
    begin
      v_followup_id :=
        nullif(v_message.metadata ->> 'followup_id', '')::uuid;

      v_followup_cycle :=
        nullif(v_message.metadata ->> 'followup_cycle', '')::integer;

      v_action_queue_id :=
        nullif(v_message.metadata ->> 'action_queue_id', '')::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_canonical_followup_identity';
    end;

    if v_block_reason is null
       and (
         v_followup_id is distinct from v_initial_followup_id
         or v_followup_cycle is distinct from v_initial_followup_cycle
         or v_action_queue_id is distinct from v_initial_action_queue_id
       ) then
      v_block_reason := 'canonical_followup_identity_changed_during_gate';
    end if;
  end if;
  /*
   * Human/manual/quote paths remain outside the P9 Sales AI gate.
   * Their existing transport contract is preserved.
   */
  if v_block_reason is null and v_message.sender = 'ai' then
    if v_outbound_kind in ('reactive_ai_reply', 'stop_contact_ack') then
      begin
        v_source_message_id :=
          nullif(v_message.metadata ->> 'source_message_id', '')::uuid;
      exception
        when invalid_text_representation then
          v_block_reason := 'invalid_reactive_ai_identity';
      end;

      if v_block_reason is null
         and (
           v_source_message_id is null
           or v_opportunity_id is null
           or v_message.commercial_session_context_link_id is null
         ) then
        v_block_reason := 'reactive_ai_identity_required';
      end if;

      if v_block_reason is null then
        select context_link_row.commercial_opportunity_id
        into v_context_opportunity_id
        from public.commercial_session_context_links context_link_row
        where context_link_row.id =
              v_message.commercial_session_context_link_id
          and context_link_row.organization_id = p_organization_id
          and context_link_row.store_id = p_store_id;

        if not found
           or v_context_opportunity_id is distinct from v_opportunity_id then
          v_block_reason := 'outbound_commercial_context_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select source_row.*
        into v_source_message
        from public.messages source_row
        where source_row.id = v_source_message_id
          and source_row.organization_id = p_organization_id
          and source_row.store_id = p_store_id
          and source_row.conversation_id = v_message.conversation_id
          and source_row.sender = 'user'
          and source_row.direction = 'incoming'
          and source_row.deleted_at is null;

        if not found
           or v_source_message.commercial_session_context_link_id is null then
          v_block_reason := 'reactive_source_message_scope_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select context_link_row.commercial_opportunity_id
        into v_source_context_opportunity_id
        from public.commercial_session_context_links context_link_row
        where context_link_row.id =
              v_source_message.commercial_session_context_link_id
          and context_link_row.organization_id = p_organization_id
          and context_link_row.store_id = p_store_id;

        if not found
           or v_source_context_opportunity_id is distinct from v_opportunity_id then
          v_block_reason := 'reactive_source_opportunity_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.messages incoming_row
          where incoming_row.organization_id = p_organization_id
            and incoming_row.store_id = p_store_id
            and incoming_row.conversation_id = v_message.conversation_id
            and incoming_row.sender = 'user'
            and incoming_row.direction = 'incoming'
            and incoming_row.deleted_at is null
            and incoming_row.id <> v_source_message.id
            and incoming_row.created_at >= v_source_message.created_at
        )
        into v_newer_incoming_exists;

        if v_newer_incoming_exists then
          v_block_reason := 'superseded_by_new_customer_message';
        end if;
      end if;

      -- I8: this check is specific to the reactive response source, not
      -- the similarly named canonical-followup supersession branch.
      if v_block_reason is null then
        select exists (
          select 1
          from public.messages human_row
          where human_row.organization_id = p_organization_id
            and human_row.store_id = p_store_id
            and human_row.conversation_id = v_message.conversation_id
            and human_row.sender = 'human'
            and human_row.direction = 'outgoing'
            and human_row.deleted_at is null
            and coalesce(human_row.metadata ->> 'outbound_origin', '') in (
              'crm_manual_text',
              'crm_manual_image',
              'crm_manual_document',
              'sales_contract_send',
              'sales_quote_send'
            )
            and (
              human_row.created_at > v_source_message.created_at
              or (
                human_row.outbound_delivery_state = 'sent'
                and human_row.external_message_id is not null
                and human_row.outbound_provider_accepted_at
                    > v_source_message.created_at
              )
            )
        ) into v_newer_human_exists;

        if v_newer_human_exists then
          v_block_reason := 'superseded_by_human_response';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.commercial_opportunity_followups followup_row
          where followup_row.organization_id = p_organization_id
            and followup_row.store_id = p_store_id
            and followup_row.commercial_opportunity_id = v_opportunity_id
            and followup_row.status = 'opted_out'
        )
        into v_any_opt_out_exists;

        select exists (
          select 1
          from public.commercial_opportunity_followup_events event_row
          where event_row.organization_id = p_organization_id
            and event_row.store_id = p_store_id
            and event_row.commercial_opportunity_id = v_opportunity_id
            and event_row.event_type = 'opted_out'
            and event_row.actor_type = 'system'
            and event_row.metadata ->> 'source_conversation_id'
                  = v_message.conversation_id::text
            and event_row.metadata ->> 'source_message_id'
                  = v_source_message_id::text
        )
        into v_stop_event_exists;

        if v_outbound_kind = 'stop_contact_ack' then
          if not v_stop_event_exists then
            v_block_reason :=
              'stop_contact_ack_without_exact_opt_out_source';
          end if;
        elsif v_any_opt_out_exists then
          v_block_reason := 'commercial_opportunity_opted_out';
        end if;
      end if;
    elsif v_outbound_kind = 'canonical_followup' then
      if v_message.commercial_session_context_link_id is null then
        v_block_reason := 'canonical_followup_context_required';
      end if;

      if v_block_reason is null then
        select context_link_row.commercial_opportunity_id
        into v_context_opportunity_id
        from public.commercial_session_context_links context_link_row
        where context_link_row.id =
              v_message.commercial_session_context_link_id
          and context_link_row.organization_id = p_organization_id
          and context_link_row.store_id = p_store_id;

        if not found
           or v_context_opportunity_id is distinct from v_opportunity_id then
          v_block_reason := 'canonical_followup_context_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select queue_row.*
        into v_queue
        from public.ai_sales_action_queue queue_row
        where queue_row.id = v_action_queue_id
          and queue_row.organization_id = p_organization_id
          and queue_row.store_id = p_store_id
          and queue_row.conversation_id = v_message.conversation_id;

        if not found
           or v_queue.next_action not in ('followup_offer', 'followup_visit')
           or v_queue.payload ->> 'commercial_opportunity_id'
                is distinct from v_opportunity_id::text
           or v_queue.payload ->> 'followup_id'
                is distinct from v_followup_id::text
           or v_queue.payload ->> 'followup_cycle'
                is distinct from v_followup_cycle::text then
          v_block_reason := 'canonical_followup_queue_scope_mismatch';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.messages incoming_row
          where incoming_row.organization_id = p_organization_id
            and incoming_row.store_id = p_store_id
            and incoming_row.conversation_id = v_message.conversation_id
            and incoming_row.sender = 'user'
            and incoming_row.direction = 'incoming'
            and incoming_row.deleted_at is null
            and incoming_row.created_at > v_queue.enqueued_at
        )
        into v_newer_incoming_exists;

        if v_newer_incoming_exists then
          v_block_reason := 'superseded_by_new_customer_message';
        end if;
      end if;

      if v_block_reason is null then
        select exists (
          select 1
          from public.commercial_opportunity_followups followup_row
          where followup_row.organization_id = p_organization_id
            and followup_row.store_id = p_store_id
            and followup_row.commercial_opportunity_id = v_opportunity_id
            and followup_row.status = 'opted_out'
        )
        into v_any_opt_out_exists;

        if v_any_opt_out_exists then
          v_block_reason := 'commercial_opportunity_opted_out';
        end if;
      end if;
    end if;
  end if;

  if v_block_reason is not null then
    update public.messages message_row
    set
      outbound_delivery_state = 'failed',
      outbound_claimed_at = null,
      outbound_claimed_by = null,
      outbound_attempt_started_at = null,
      outbound_uncertain_at = null,
      outbound_error_text =
        ('ZION_EXTERNAL_SEND_BLOCKED:' || v_block_reason)::text
    where message_row.id = p_message_id
      and message_row.organization_id = p_organization_id
      and message_row.store_id = p_store_id
      and message_row.outbound_delivery_state = 'processing'
      and message_row.outbound_attempt_started_at is null;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'WHATSAPP_EXTERNAL_SEND_GATE_BLOCK_TRANSITION_LOST';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'decision', 'blocked',
      'reason', v_block_reason,
      'message_id', p_message_id,
      'conversation_id', v_message.conversation_id
    );
  end if;

  /*
   * Linearization point for the controlled outbound attempt.
   *
   * The same RPC that authorizes SEND moves processing -> uncertain before
   * returning to Node. After this persisted transition there is never a blind
   * retry. The HTTP POST happens immediately after this RPC returns.
   */
  update public.messages message_row
  set
    outbound_delivery_state = 'uncertain',
    outbound_attempt_started_at = pg_catalog.clock_timestamp(),
    outbound_uncertain_at = pg_catalog.clock_timestamp(),
    outbound_claimed_at = null,
    outbound_claimed_by = null,
    outbound_error_text = null
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
      message = 'WHATSAPP_EXTERNAL_SEND_GATE_ATTEMPT_TRANSITION_LOST';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'decision', 'send',
    'reason', 'authorized',
    'message_id', p_message_id,
    'conversation_id', v_message.conversation_id,
    'outbound_kind', v_outbound_kind
  );
end;
$function$;
$gate_ddl$;

  SELECT p.proowner, p.proacl, p.proconfig, p.prosecdef,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  INTO STRICT v_materialize_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_materialize_oid;

  SELECT p.proowner, p.proacl, p.proconfig, p.prosecdef,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  INTO STRICT v_gate_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_gate_oid;

  IF v_materialize_before.proowner IS DISTINCT FROM v_materialize_after.proowner
     OR v_materialize_before.proacl IS DISTINCT FROM v_materialize_after.proacl
     OR v_materialize_before.proconfig IS DISTINCT FROM v_materialize_after.proconfig
     OR v_materialize_before.prosecdef IS DISTINCT FROM v_materialize_after.prosecdef
     OR v_gate_before.proowner IS DISTINCT FROM v_gate_after.proowner
     OR v_gate_before.proacl IS DISTINCT FROM v_gate_after.proacl
     OR v_gate_before.proconfig IS DISTINCT FROM v_gate_after.proconfig
     OR v_gate_before.prosecdef IS DISTINCT FROM v_gate_after.prosecdef THEN
    RAISE EXCEPTION 'P19A_I8_HUMAN_PRIORITY_POSTCHECK_SECURITY_MISMATCH';
  END IF;

  v_materialize_definition := v_materialize_after.definition;
  v_gate_definition := v_gate_after.definition;

  IF pg_catalog.strpos(v_materialize_definition,
       'P19A_I8_RESPONSE_SUPERSEDED_BY_HUMAN') = 0
     OR pg_catalog.strpos(v_materialize_definition,
       'outbound_provider_accepted_at > v_anchor.created_at') = 0
     OR pg_catalog.strpos(v_gate_definition,
       'superseded_by_human_response') = 0
     OR pg_catalog.strpos(v_gate_definition,
       'outbound_provider_accepted_at') = 0 THEN
    RAISE EXCEPTION 'P19A_I8_HUMAN_PRIORITY_POSTCHECK_PATCH_MISSING';
  END IF;

  RAISE NOTICE 'P19A_I8_HUMAN_PRIORITY_INSTALLED';
END;
$deploy_i8$;

COMMIT;
