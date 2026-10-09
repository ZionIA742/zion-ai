begin;

do $precondition$
begin
  if to_regclass('public.messages') is null
     or to_regclass('public.conversations') is null
     or to_regclass('public.leads') is null
     or to_regclass('public.stores') is null
     or to_regclass('public.commercial_opportunities') is null
     or to_regclass('public.store_catalog_customer_files') is null
     or to_regclass('public.store_catalog_settings') is null
     or to_regclass('public.store_import_files') is null
     or to_regclass('public.pools') is null
     or to_regclass('public.pool_photos') is null
     or to_regclass('public.store_catalog_items') is null
     or to_regclass('public.store_catalog_item_photos') is null
     or to_regclass('public.commercial_opportunity_followup_events') is null
     or to_regclass('public.commercial_session_context_links') is null
     or to_regclass('public.conversation_sessions') is null
     or to_regclass('public.external_integrations') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_PRECONDITION_CANONICAL_TABLE_MISSING';
  end if;

  if to_regprocedure('public.insert_message(uuid,text,text,text,text,text,text,jsonb)') is null
     or to_regprocedure('public.private_acquire_sales_contract_conversation_xact_lock(uuid)') is null
     or to_regprocedure('public.is_real_whatsapp_conversation_for_external_send(uuid,uuid,uuid)') is null
     or to_regprocedure('public.get_active_whatsapp_integration_for_external_send_by_system(uuid,uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_PRECONDITION_CANONICAL_WRITER_OR_LOCK_MISSING';
  end if;

  if to_regclass('public.messages_org_store_outbound_idempotency_uidx') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_PRECONDITION_OUTBOUND_IDEMPOTENCY_INDEX_MISSING';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_PRECONDITION_PGCRYPTO_DIGEST_MISSING';
  end if;

  if to_regclass('public.stores_id_organization_uidx') is null
     or to_regclass('public.conversations_id_organization_uidx') is null
     or to_regclass('public.commercial_opportunities_id_organization_store_uidx') is null
     or to_regclass('public.store_import_files_id_organization_store_key') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_PRECONDITION_COMPOSITE_REFERENCE_KEY_MISSING';
  end if;
end;
$precondition$;

-- A composite FK must be backed by an actual non-partial unique index on
-- the referenced columns. The messages primary key (id) alone is not enough
-- for a FK referencing (id, organization_id, store_id).
-- Namespaced to P19-A to avoid changes to historical P9 migrations.
create unique index if not exists p19a_messages_id_org_store_uidx
  on public.messages (id, organization_id, store_id);

do $message_reference_precondition$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class on index_class.oid = index_row.indexrelid
    where index_row.indrelid = 'public.messages'::pg_catalog.regclass
      and index_class.relname = 'p19a_messages_id_org_store_uidx'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indimmediate
      and index_row.indpred is null
      and index_row.indexprs is null
      and index_row.indnkeyatts = 3
      and (
        select pg_catalog.array_agg(attribute_row.attname order by key_row.ordinality)
        from pg_catalog.unnest(index_row.indkey) with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_row.attnum
      ) = array['id', 'organization_id', 'store_id']::name[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_PRECONDITION_MESSAGES_COMPOSITE_REFERENCE_INVALID';
  end if;
end;
$message_reference_precondition$;

create table public.p19a_sales_ai_reply_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  anchor_message_id uuid not null,
  commercial_opportunity_id uuid null,
  request_fingerprint text not null,
  payload jsonb not null,
  text_message_id uuid null,
  document_message_ids uuid[] not null default '{}'::uuid[],
  photo_message_id uuid null,
  materialization_state text not null default 'materializing',
  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz null,
  constraint p19a_sales_ai_reply_sets_state_check
    check (materialization_state in ('materializing', 'confirmed')),
  constraint p19a_sales_ai_reply_sets_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint p19a_sales_ai_reply_sets_fingerprint_check
    check (length(btrim(request_fingerprint)) = 64),
  constraint p19a_sales_ai_reply_sets_confirmed_state_check
    check (
      (materialization_state = 'materializing' and confirmed_at is null)
      or (materialization_state = 'confirmed' and confirmed_at is not null and text_message_id is not null)
    ),
  constraint p19a_sales_ai_reply_sets_identity_uidx
    unique (organization_id, store_id, conversation_id, anchor_message_id),
  constraint p19a_sales_ai_reply_sets_store_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,
  constraint p19a_sales_ai_reply_sets_conversation_fkey
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id)
    on delete restrict,
  constraint p19a_sales_ai_reply_sets_anchor_fkey
    foreign key (anchor_message_id, organization_id, store_id)
    references public.messages(id, organization_id, store_id)
    on delete restrict,
  constraint p19a_sales_ai_reply_sets_opportunity_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,
  constraint p19a_sales_ai_reply_sets_text_message_fkey
    foreign key (text_message_id, organization_id, store_id)
    references public.messages(id, organization_id, store_id)
    on delete restrict
);

create index p19a_sales_ai_reply_sets_anchor_idx
  on public.p19a_sales_ai_reply_sets (organization_id, store_id, anchor_message_id);

alter table public.p19a_sales_ai_reply_sets enable row level security;
alter table public.p19a_sales_ai_reply_sets force row level security;
revoke all on table public.p19a_sales_ai_reply_sets from public, anon, authenticated, service_role;

create or replace function public.materialize_sales_ai_reply_set_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_anchor_message_id uuid,
  p_commercial_opportunity_id uuid,
  p_ai_text text,
  p_outbound_kind text,
  p_external_authorized boolean,
  p_document_actions jsonb default '[]'::jsonb,
  p_photo_action jsonb default null,
  p_payload jsonb default '{}'::jsonb
)
returns table (
  response_set_id uuid,
  text_message_id uuid,
  document_message_ids uuid[],
  photo_message_id uuid,
  request_fingerprint text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
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

create or replace function public.read_sales_ai_reply_set_by_anchor(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_anchor_message_id uuid
)
returns table (
  response_set_id uuid,
  text_message_id uuid,
  document_message_ids uuid[],
  photo_message_id uuid,
  request_fingerprint text,
  payload jsonb,
  materialization_state text,
  confirmed_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select id, text_message_id, document_message_ids, photo_message_id,
         request_fingerprint, payload, materialization_state, confirmed_at
  from public.p19a_sales_ai_reply_sets
  where organization_id = p_organization_id
    and store_id = p_store_id
    and conversation_id = p_conversation_id
    and anchor_message_id = p_anchor_message_id
    and materialization_state = 'confirmed';
$function$;

alter function public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb) owner to postgres;
alter function public.read_sales_ai_reply_set_by_anchor(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.read_sales_ai_reply_set_by_anchor(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.read_sales_ai_reply_set_by_anchor(uuid,uuid,uuid,uuid) to service_role;

do $postcondition$
begin
  if not has_function_privilege(
       'service_role',
       'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.read_sales_ai_reply_set_by_anchor(uuid,uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)',
       'execute'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I8_POSTCONDITION_FUNCTION_ACL_MISMATCH';
  end if;
end;
$postcondition$;

commit;
