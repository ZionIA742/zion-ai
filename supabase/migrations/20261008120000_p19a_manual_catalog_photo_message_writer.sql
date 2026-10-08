do $precondition$
declare
  v_index_oid oid;
  v_index_definition text;
  v_index_predicate text;
begin
  if to_regprocedure('public.insert_message(uuid,text,text,text,text,text,text,jsonb)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: public.insert_message(...) is missing';
  end if;

  if to_regclass('public.messages') is null
     or to_regclass('public.conversations') is null
     or to_regclass('public.leads') is null
     or to_regclass('public.pools') is null
     or to_regclass('public.pool_photos') is null
     or to_regclass('public.store_catalog_items') is null
     or to_regclass('public.store_catalog_item_photos') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: canonical tables are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name in (
        'id',
        'organization_id',
        'store_id',
        'conversation_id',
        'lead_id',
        'sender',
        'direction',
        'message_type',
        'content',
        'media_url',
        'metadata',
        'deleted_at',
        'outbound_idempotency_key',
        'outbound_delivery_state'
      )
    having count(*) = 14
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: messages contract is incomplete';
  end if;

  v_index_oid := to_regclass('public.messages_org_store_outbound_idempotency_uidx');
  if v_index_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: messages idempotency index is missing';
  end if;

  select
    pg_catalog.pg_get_indexdef(index_row.indexrelid),
    pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
  into v_index_definition, v_index_predicate
  from pg_catalog.pg_index index_row
  where index_row.indexrelid = v_index_oid
    and index_row.indisunique is true;

  if v_index_definition is null
     or v_index_definition not ilike '%(organization_id, store_id, outbound_idempotency_key)%'
     or coalesce(v_index_predicate, '') not ilike '%outbound_idempotency_key IS NOT NULL%' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: messages idempotency index contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversations'
      and column_name in ('id', 'organization_id', 'lead_id')
    having count(*) = 3
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name in ('id', 'organization_id', 'store_id')
    having count(*) = 3
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: conversation/lead scope columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pools'
      and column_name in (
        'id',
        'organization_id',
        'store_id',
        'name',
        'material',
        'shape',
        'width_m',
        'length_m',
        'depth_m',
        'price',
        'price_status',
        'photo_url',
        'is_active'
      )
    having count(*) = 13
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: pool product columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pool_photos'
      and column_name in (
        'id',
        'organization_id',
        'store_id',
        'pool_id',
        'storage_path',
        'sort_order'
      )
    having count(*) = 6
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: pool photo columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_catalog_items'
      and column_name in (
        'id',
        'organization_id',
        'store_id',
        'sku',
        'name',
        'price_cents',
        'price_status',
        'currency',
        'is_active'
      )
    having count(*) = 9
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: catalog item columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_catalog_item_photos'
      and column_name in ('id', 'catalog_item_id', 'storage_path', 'sort_order', 'created_at')
    having count(*) = 5
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_MANUAL_CATALOG_PHOTO_PRECONDITION: catalog item photo columns are missing';
  end if;
end;
$precondition$;

create or replace function public.finalize_manual_catalog_photo_message(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_catalog_source_kind text,
  p_catalog_source_id uuid,
  p_content text,
  p_send_external boolean,
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
set row_security = off
as $function$
declare
  v_existing public.messages%rowtype;
  v_message public.messages%rowtype;
  v_pool public.pools%rowtype;
  v_catalog_item public.store_catalog_items%rowtype;
  v_pool_photo public.pool_photos%rowtype;
  v_catalog_photo public.store_catalog_item_photos%rowtype;
  v_normalized_kind text := nullif(pg_catalog.btrim(coalesce(p_catalog_source_kind, '')), '');
  v_normalized_content text := nullif(pg_catalog.btrim(coalesce(p_content, '')), '');
  v_key text := nullif(pg_catalog.btrim(coalesce(p_outbound_idempotency_key, '')), '');
  v_fingerprint text := nullif(pg_catalog.btrim(coalesce(p_payload_fingerprint, '')), '');
  v_media_url text;
  v_storage_bucket text;
  v_storage_path text;
  v_catalog_photo_id uuid;
  v_catalog_photo_source text;
  v_pool_name text;
  v_catalog_item_name text;
  v_catalog_item_sku text;
  v_product_snapshot jsonb;
  v_metadata jsonb;
  v_delivery_state text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_conversation_id is null
     or p_lead_id is null
     or p_actor_user_id is null
     or p_catalog_source_id is null
     or v_normalized_kind is null
     or v_normalized_kind not in ('pool', 'catalog_item')
     or v_normalized_content is null
     or p_send_external is null
     or v_key is null
     or v_fingerprint is null then
    raise exception using
      errcode = '22023',
      message = 'MANUAL_CATALOG_PHOTO_INVALID_INPUT';
  end if;

  if not exists (
    select 1
    from public.conversations conversation_row
    where conversation_row.id = p_conversation_id
      and conversation_row.organization_id = p_organization_id
      and conversation_row.lead_id = p_lead_id
  ) or not exists (
    select 1
    from public.leads lead_row
    where lead_row.id = p_lead_id
      and lead_row.organization_id = p_organization_id
      and lead_row.store_id = p_store_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'MANUAL_CATALOG_PHOTO_SCOPE_MISMATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_store_id::text || ':' || v_key,
      0
    )
  );

  select message_row.*
    into v_existing
    from public.messages message_row
   where message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.outbound_idempotency_key = v_key
   for update;

  if found then
    if v_existing.deleted_at is not null
       or v_existing.conversation_id is distinct from p_conversation_id
       or v_existing.lead_id is distinct from p_lead_id
       or v_existing.sender is distinct from 'human'
       or v_existing.direction is distinct from 'outgoing'
       or v_existing.message_type is distinct from 'image'
       or v_existing.content is distinct from v_normalized_content
       or coalesce(v_existing.metadata ->> 'media_origin', '') <> 'store_catalog'
       or coalesce(v_existing.metadata ->> 'media_purpose', '') <> 'catalog_product_photo'
       or coalesce(v_existing.metadata ->> 'catalog_source_kind', '') <> v_normalized_kind
       or coalesce(v_existing.metadata ->> 'catalog_source_id', '') <> p_catalog_source_id::text
       or coalesce(v_existing.metadata ->> 'catalog_photo_payload_fingerprint', '') <> v_fingerprint
       or coalesce(v_existing.metadata ->> 'sent_by', '') <> 'panel_user'
       or coalesce(v_existing.metadata ->> 'sent_by_user_id', '') <> p_actor_user_id::text
       or coalesce(v_existing.metadata ->> 'target_type', '') <> v_normalized_kind
       or coalesce(v_existing.metadata ->> 'send_external', 'false') <> p_send_external::text
       or (
         p_send_external
         and coalesce(v_existing.metadata ->> 'outbound_origin', '') <> 'crm_manual_image'
       )
       or (
         not p_send_external
         and v_existing.metadata ->> 'outbound_origin' is not null
       )
       or nullif(pg_catalog.btrim(coalesce(v_existing.media_url, '')), '') is null
       or (
         v_normalized_kind = 'pool'
         and (
           coalesce(v_existing.metadata ->> 'pool_id', '') <> p_catalog_source_id::text
           or v_existing.metadata ->> 'catalog_item_id' is not null
           or coalesce(v_existing.metadata ->> 'catalog_photo_source', '') not in ('pool_photos', 'pool_photo_url')
           or (
             v_existing.metadata ->> 'catalog_photo_source' = 'pool_photos'
             and (
               nullif(v_existing.metadata ->> 'catalog_photo_id', '') is null
               or coalesce(v_existing.metadata ->> 'storage_bucket', '') <> 'pool-photos'
               or coalesce(v_existing.metadata ->> 'storage_path', '') <> v_existing.media_url
             )
           )
           or (
             v_existing.metadata ->> 'catalog_photo_source' = 'pool_photo_url'
             and (
               v_existing.metadata ->> 'catalog_photo_id' is not null
               or v_existing.metadata ->> 'storage_bucket' is not null
               or v_existing.metadata ->> 'storage_path' is not null
               or v_existing.media_url !~* '^https?://'
             )
           )
         )
       )
       or (
         v_normalized_kind = 'catalog_item'
         and (
           v_existing.metadata ->> 'pool_id' is not null
           or coalesce(v_existing.metadata ->> 'catalog_item_id', '') <> p_catalog_source_id::text
           or coalesce(v_existing.metadata ->> 'catalog_photo_source', '') <> 'store_catalog_item_photos'
           or nullif(v_existing.metadata ->> 'catalog_photo_id', '') is null
           or coalesce(v_existing.metadata ->> 'storage_bucket', '') <> 'store-catalog-photos'
           or coalesce(v_existing.metadata ->> 'storage_path', '') <> v_existing.media_url
         )
       ) then
      raise exception using
        errcode = '23514',
        message = 'MANUAL_CATALOG_PHOTO_IDEMPOTENCY_CONFLICT';
    end if;

    return query
      select v_existing.id, true;
    return;
  end if;

  if v_normalized_kind = 'pool' then
    select pool_row.*
      into v_pool
      from public.pools pool_row
     where pool_row.id = p_catalog_source_id
       and pool_row.organization_id = p_organization_id
       and pool_row.store_id = p_store_id
       and pool_row.is_active = true
     for share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'MANUAL_CATALOG_PHOTO_POOL_NOT_FOUND_OR_FORBIDDEN';
    end if;

    v_pool_name := nullif(pg_catalog.btrim(coalesce(v_pool.name, '')), '');

    select photo_row.*
      into v_pool_photo
      from public.pool_photos photo_row
     where photo_row.pool_id = v_pool.id
       and photo_row.organization_id = p_organization_id
       and photo_row.store_id = p_store_id
       and nullif(pg_catalog.btrim(coalesce(photo_row.storage_path, '')), '') is not null
     order by photo_row.sort_order asc nulls last, photo_row.id asc
     limit 1
     for share;

    if found then
      v_catalog_photo_id := v_pool_photo.id;
      v_catalog_photo_source := 'pool_photos';
      v_storage_bucket := 'pool-photos';
      v_storage_path := pg_catalog.btrim(v_pool_photo.storage_path);
      v_media_url := v_storage_path;
    else
      v_media_url := nullif(pg_catalog.btrim(coalesce(v_pool.photo_url, '')), '');
      if v_media_url is null or v_media_url !~* '^https?://' then
        raise exception using
          errcode = '42501',
          message = 'MANUAL_CATALOG_PHOTO_POOL_PHOTO_NOT_FOUND_OR_INVALID';
      end if;

      v_catalog_photo_id := null;
      v_catalog_photo_source := 'pool_photo_url';
      v_storage_bucket := null;
      v_storage_path := null;
    end if;

    v_product_snapshot := pg_catalog.jsonb_build_object(
      'source', 'pool',
      'id', v_pool.id,
      'name', v_pool.name,
      'material', v_pool.material,
      'shape', v_pool.shape,
      'width_m', v_pool.width_m,
      'length_m', v_pool.length_m,
      'depth_m', v_pool.depth_m,
      'price', v_pool.price,
      'price_status', v_pool.price_status
    );
  else
    select item_row.*
      into v_catalog_item
      from public.store_catalog_items item_row
     where item_row.id = p_catalog_source_id
       and item_row.organization_id = p_organization_id
       and item_row.store_id = p_store_id
       and item_row.is_active = true
     for share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'MANUAL_CATALOG_PHOTO_ITEM_NOT_FOUND_OR_FORBIDDEN';
    end if;

    v_catalog_item_name := nullif(pg_catalog.btrim(coalesce(v_catalog_item.name, '')), '');
    v_catalog_item_sku := nullif(pg_catalog.btrim(coalesce(v_catalog_item.sku, '')), '');

    select photo_row.*
      into v_catalog_photo
      from public.store_catalog_item_photos photo_row
     where photo_row.catalog_item_id = v_catalog_item.id
       and nullif(pg_catalog.btrim(coalesce(photo_row.storage_path, '')), '') is not null
     order by
       photo_row.sort_order asc nulls last,
       photo_row.created_at asc nulls last,
       photo_row.id asc
     limit 1
     for share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'MANUAL_CATALOG_PHOTO_ITEM_PHOTO_NOT_FOUND_OR_INVALID';
    end if;

    v_catalog_photo_id := v_catalog_photo.id;
    v_catalog_photo_source := 'store_catalog_item_photos';
    v_storage_bucket := 'store-catalog-photos';
    v_storage_path := pg_catalog.btrim(v_catalog_photo.storage_path);
    v_media_url := v_storage_path;

    v_product_snapshot := pg_catalog.jsonb_build_object(
      'source', 'catalog_item',
      'id', v_catalog_item.id,
      'sku', v_catalog_item.sku,
      'name', v_catalog_item.name,
      'price_cents', v_catalog_item.price_cents,
      'price_status', v_catalog_item.price_status,
      'currency', v_catalog_item.currency
    );
  end if;

  v_metadata := pg_catalog.jsonb_build_object(
    'source', 'panel',
    'channel', case when p_send_external then 'whatsapp' else 'crm' end,
    'external_channel', case when p_send_external then 'whatsapp' else null end,
    'send_external', p_send_external,
    'whatsapp_detected_from_conversation', p_send_external,
    'outbound_origin', case when p_send_external then 'crm_manual_image' else null end,
    'media_origin', 'store_catalog',
    'media_purpose', 'catalog_product_photo',
    'source_channel', 'panel_manual',
    'attachment_kind', 'image',
    'can_be_sent_to_customer', true,
    'requires_human_review', false,
    'sent_by', 'panel_user',
    'sent_by_user_id', p_actor_user_id,
    'auto_sent', false,
    'storage_bucket', v_storage_bucket,
    'storage_path', v_storage_path,
    'catalog_photo_source', v_catalog_photo_source,
    'catalog_source_kind', v_normalized_kind,
    'catalog_source_id', p_catalog_source_id,
    'catalog_photo_id', v_catalog_photo_id,
    'target_type', v_normalized_kind,
    'pool_id', case when v_normalized_kind = 'pool' then p_catalog_source_id else null end,
    'pool_name', case when v_normalized_kind = 'pool' then v_pool_name else null end,
    'catalog_item_id', case when v_normalized_kind = 'catalog_item' then p_catalog_source_id else null end,
    'catalog_item_name', case when v_normalized_kind = 'catalog_item' then v_catalog_item_name else null end,
    'catalog_item_sku', case when v_normalized_kind = 'catalog_item' then v_catalog_item_sku else null end,
    'catalog_photo_payload_fingerprint', v_fingerprint,
    'outbound_idempotency_key', v_key,
    'product_snapshot', v_product_snapshot
  );

  select *
    into v_message
    from public.insert_message(
      p_conversation_id,
      'human',
      'outgoing',
      'image',
      v_normalized_content,
      null,
      v_media_url,
      v_metadata
    );

  if v_message.id is null
     or v_message.organization_id is distinct from p_organization_id
     or v_message.store_id is distinct from p_store_id
     or v_message.conversation_id is distinct from p_conversation_id
     or v_message.lead_id is distinct from p_lead_id then
    raise exception using
      errcode = 'P0001',
      message = 'MANUAL_CATALOG_PHOTO_INSERT_SCOPE_MISMATCH';
  end if;

  v_delivery_state := case when p_send_external then 'pending' else null end;

  update public.messages message_row
     set outbound_idempotency_key = v_key,
         outbound_delivery_state = v_delivery_state
   where message_row.id = v_message.id
     and message_row.organization_id = p_organization_id
     and message_row.store_id = p_store_id
     and message_row.deleted_at is null
  returning message_row.* into v_message;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'MANUAL_CATALOG_PHOTO_OUTBOUND_STATE_NOT_APPLIED';
  end if;

  return query
    select v_message.id, false;
end;
$function$;

alter function public.finalize_manual_catalog_photo_message(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, boolean, text, text
) owner to postgres;

revoke all on function public.finalize_manual_catalog_photo_message(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.finalize_manual_catalog_photo_message(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, boolean, text, text
) to service_role;
