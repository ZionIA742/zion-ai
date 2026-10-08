begin;

drop table if exists pg_temp.p19a_manual_catalog_photo_check_context;
create temp table p19a_manual_catalog_photo_check_context (
  run_token text not null
) on commit drop;
insert into pg_temp.p19a_manual_catalog_photo_check_context (run_token)
values (gen_random_uuid()::text);

do $preconditions$
declare
  v_function_oid oid;
  v_acl text;
  v_definition text;
  v_definition_normalized text;
begin
  v_function_oid := to_regprocedure(
    'public.finalize_manual_catalog_photo_message(uuid,uuid,uuid,uuid,uuid,text,uuid,text,boolean,text,text)'
  );

  if v_function_oid is null then
    raise exception 'manual check precondition: canonical catalog photo writer is missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
    into v_definition;

  v_definition_normalized := lower(
    regexp_replace(v_definition, '\s+', ' ', 'g')
  );

  if position('public.insert_message' in v_definition_normalized) = 0
     or position('insert into public.messages' in v_definition_normalized) > 0 then
    raise exception 'manual check precondition: writer does not use insert_message exclusively';
  end if;

  if position('pool_row.organization_id = p_organization_id' in v_definition_normalized) = 0
     or position('pool_row.store_id = p_store_id' in v_definition_normalized) = 0
     or position('photo_row.organization_id = p_organization_id' in v_definition_normalized) = 0
     or position('photo_row.store_id = p_store_id' in v_definition_normalized) = 0
     or position('photo_row.pool_id = v_pool.id' in v_definition_normalized) = 0
     or position('item_row.organization_id = p_organization_id' in v_definition_normalized) = 0
     or position('item_row.store_id = p_store_id' in v_definition_normalized) = 0
     or position('photo_row.catalog_item_id = v_catalog_item.id' in v_definition_normalized) = 0
     or position('order by photo_row.sort_order asc nulls last, photo_row.id asc' in v_definition_normalized) = 0
     or position('order by photo_row.sort_order asc nulls last, photo_row.created_at asc nulls last, photo_row.id asc' in v_definition_normalized) = 0
     or position('v_pool.photo_url' in v_definition_normalized) = 0
     or position('!~* ''^https?://''' in v_definition_normalized) = 0
     or position('media_origin' in v_definition_normalized) = 0
     or position('store_catalog' in v_definition_normalized) = 0
     or position('media_purpose' in v_definition_normalized) = 0
     or position('catalog_product_photo' in v_definition_normalized) = 0
     or position('crm_manual_image' in v_definition_normalized) = 0
     or position('pg_advisory_xact_lock' in v_definition_normalized) = 0
     or position('outbound_idempotency_key' in v_definition_normalized) = 0 then
    raise exception 'manual check precondition: canonical photo selection/lineage contract is incomplete';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc function_row
     where function_row.oid = v_function_oid
       and function_row.prosecdef
       and function_row.proowner = 'postgres'::regrole
       and coalesce(array_to_string(function_row.proconfig, ' '), '') ilike '%search_path%'
       and coalesce(array_to_string(function_row.proconfig, ' '), '') ilike '%row_security=off%'
  ) then
    raise exception 'manual check precondition: writer security-definer configuration is incomplete';
  end if;

  select coalesce(pg_catalog.string_agg(privilege_type, ',' order by privilege_type), '')
    into v_acl
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) privilege_row
   where function_row.oid = v_function_oid
     and privilege_row.grantee = 0;

  if v_acl <> '' then
    raise exception 'public must not execute canonical catalog photo writer: %', v_acl;
  end if;

  if pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'authenticated must not execute canonical catalog photo writer';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE') then
    raise exception 'anon must not execute canonical catalog photo writer';
  end if;

  if not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception 'service_role must execute canonical catalog photo writer';
  end if;

  raise notice 'PASS exact signature, normalized static tenant/lineage contract, security-definer configuration and service_role-only ACL';
end;
$preconditions$;

savepoint p19a_manual_catalog_photo_behavior;

do $checks$
declare
  v_run_token text;
  v_actor uuid := gen_random_uuid();
  v_org uuid;
  v_store uuid;
  v_conversation uuid;
  v_lead uuid;
  v_pool uuid;
  v_pool_photo uuid;
  v_pool_path text;
  v_pool_fallback uuid;
  v_pool_fallback_url text;
  v_item uuid;
  v_item_photo uuid;
  v_item_path text;
  v_other_pool uuid;
  v_other_item uuid;
  v_result record;
  v_replay record;
  v_internal record;
  v_count integer;
  v_key text;
  v_fp text;
begin
  select run_token
    into v_run_token
    from pg_temp.p19a_manual_catalog_photo_check_context
    limit 1;

  if v_run_token is null then
    raise exception 'manual check precondition: missing run token';
  end if;

  select
    conversation_row.organization_id,
    lead_row.store_id,
    conversation_row.id,
    conversation_row.lead_id
  into v_org, v_store, v_conversation, v_lead
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id = conversation_row.organization_id
  where conversation_row.organization_id is not null
    and lead_row.store_id is not null
    and exists (
      select 1
        from public.pools pool_fixture
        join public.pool_photos pool_photo_fixture
          on pool_photo_fixture.pool_id = pool_fixture.id
         and pool_photo_fixture.organization_id = pool_fixture.organization_id
         and pool_photo_fixture.store_id = pool_fixture.store_id
         and nullif(pg_catalog.btrim(pool_photo_fixture.storage_path), '') is not null
       where pool_fixture.organization_id = conversation_row.organization_id
         and pool_fixture.store_id = lead_row.store_id
         and pool_fixture.is_active = true
    )
    and exists (
      select 1
        from public.store_catalog_items item_fixture
        join public.store_catalog_item_photos item_photo_fixture
          on item_photo_fixture.catalog_item_id = item_fixture.id
         and nullif(pg_catalog.btrim(item_photo_fixture.storage_path), '') is not null
       where item_fixture.organization_id = conversation_row.organization_id
         and item_fixture.store_id = lead_row.store_id
         and item_fixture.is_active = true
    )
  order by conversation_row.id
  limit 1;

  if v_org is null then
    raise exception 'manual check precondition: no organization/store has scoped conversation, active pool photo and active catalog item photo fixtures';
  end if;

  select
    pool_row.id,
    photo_row.id,
    photo_row.storage_path
  into v_pool, v_pool_photo, v_pool_path
  from public.pools pool_row
  join public.pool_photos photo_row
    on photo_row.pool_id = pool_row.id
   and photo_row.organization_id = pool_row.organization_id
   and photo_row.store_id = pool_row.store_id
  where pool_row.organization_id = v_org
    and pool_row.store_id = v_store
    and pool_row.is_active = true
    and nullif(pg_catalog.btrim(photo_row.storage_path), '') is not null
  order by
    pool_row.id,
    photo_row.sort_order asc nulls last,
    photo_row.id asc
  limit 1;

  if v_pool is null then
    raise exception 'manual check precondition: no active scoped pool photo fixture';
  end if;

  select
    item_row.id,
    photo_row.id,
    photo_row.storage_path
  into v_item, v_item_photo, v_item_path
  from public.store_catalog_items item_row
  join public.store_catalog_item_photos photo_row
    on photo_row.catalog_item_id = item_row.id
  where item_row.organization_id = v_org
    and item_row.store_id = v_store
    and item_row.is_active = true
    and nullif(pg_catalog.btrim(photo_row.storage_path), '') is not null
  order by
    item_row.id,
    photo_row.sort_order asc nulls last,
    photo_row.created_at asc nulls last,
    photo_row.id asc
  limit 1;

  if v_item is null then
    raise exception 'manual check precondition: no active scoped catalog item photo fixture';
  end if;

  select pool_row.id
    into v_other_pool
    from public.pools pool_row
   where (pool_row.organization_id <> v_org or pool_row.store_id <> v_store)
     and pool_row.is_active = true
   order by pool_row.organization_id, pool_row.store_id, pool_row.id
   limit 1;

  select item_row.id
    into v_other_item
    from public.store_catalog_items item_row
   where (item_row.organization_id <> v_org or item_row.store_id <> v_store)
     and item_row.is_active = true
   order by item_row.organization_id, item_row.store_id, item_row.id
   limit 1;

  if v_other_pool is null then
    raise notice 'SKIP no cross-scope pool fixture; static tenant predicate check remains authoritative';
  end if;

  if v_other_item is null then
    raise notice 'SKIP no cross-scope catalog item fixture; static tenant predicate check remains authoritative';
  end if;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'invalid',
      v_pool,
      'manual check',
      true,
      'manual-check:' || v_run_token || ':invalid-kind',
      'fp-invalid-kind'
    );
    raise exception 'invalid source kind was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS invalid source kind rejected';
  end;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org, v_store, v_conversation, v_lead, v_actor, '  ', v_pool,
      'manual check', true,
      'manual-check:' || v_run_token || ':blank-kind', 'fp-blank-kind'
    );
    raise exception 'blank source kind was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS blank source kind rejected';
  end;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org, v_store, v_conversation, v_lead, v_actor, 'pool', v_pool,
      '  ', true,
      'manual-check:' || v_run_token || ':blank-content', 'fp-blank-content'
    );
    raise exception 'blank content was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS blank content rejected';
  end;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org, v_store, v_conversation, v_lead, v_actor, 'pool', v_pool,
      'manual check', null,
      'manual-check:' || v_run_token || ':null-send-external', 'fp-null-send-external'
    );
    raise exception 'NULL send_external was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS NULL send_external rejected';
  end;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org, v_store, v_conversation, v_lead, null, 'pool', v_pool,
      'manual check', true,
      'manual-check:' || v_run_token || ':null-actor', 'fp-null-actor'
    );
    raise exception 'NULL actor user was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS NULL actor user rejected';
  end;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      gen_random_uuid(),
      v_actor,
      'pool',
      v_pool,
      'manual check',
      true,
      'manual-check:' || v_run_token || ':conversation-lead-mismatch',
      'fp-conversation-lead-mismatch'
    );
    raise exception 'conversation/lead mismatch was accepted';
  exception when sqlstate '42501' then
    raise notice 'PASS conversation/lead mismatch rejected';
  end;

  if v_other_pool is not null then
    begin
      perform public.finalize_manual_catalog_photo_message(
        v_org,
        v_store,
        v_conversation,
        v_lead,
        v_actor,
        'pool',
        v_other_pool,
        'manual check',
        true,
        'manual-check:' || v_run_token || ':foreign-pool',
        'fp-foreign-pool'
      );
      raise exception 'foreign pool was accepted';
    exception when sqlstate '42501' then
      raise notice 'PASS pool from another organization/store rejected';
    end;
  end if;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      gen_random_uuid(),
      'manual check',
      true,
      'manual-check:' || v_run_token || ':missing-pool',
      'fp-missing-pool'
    );
    raise exception 'nonexistent pool was accepted';
  exception when sqlstate '42501' then
    raise notice 'PASS nonexistent pool rejected fail-closed';
  end;

  if v_other_item is not null then
    begin
      perform public.finalize_manual_catalog_photo_message(
        v_org,
        v_store,
        v_conversation,
        v_lead,
        v_actor,
        'catalog_item',
        v_other_item,
        'manual check',
        true,
        'manual-check:' || v_run_token || ':foreign-item',
        'fp-foreign-item'
      );
      raise exception 'foreign catalog item was accepted';
    exception when sqlstate '42501' then
      raise notice 'PASS catalog item from another organization/store rejected';
    end;
  end if;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'catalog_item',
      gen_random_uuid(),
      'manual check',
      true,
      'manual-check:' || v_run_token || ':missing-item',
      'fp-missing-item'
    );
    raise exception 'nonexistent catalog item was accepted';
  exception when sqlstate '42501' then
    raise notice 'PASS nonexistent catalog item rejected fail-closed';
  end;

  update public.store_catalog_items
     set is_active = false
   where id = v_item
     and organization_id = v_org
     and store_id = v_store;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'deactivating scoped catalog item affected %, expected 1', v_count;
  end if;

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'catalog_item',
      v_item,
      'manual check',
      true,
      'manual-check:' || v_run_token || ':inactive-item',
      'fp-inactive-item'
    );
    raise exception 'inactive catalog item was accepted';
  exception when sqlstate '42501' then
    raise notice 'PASS inactive catalog item rejected';
  end;

  update public.store_catalog_items
     set is_active = true
   where id = v_item
     and organization_id = v_org
     and store_id = v_store;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'restoring scoped catalog item affected %, expected 1', v_count;
  end if;

  v_key := 'manual-check:' || v_run_token || ':pool';
  v_fp := 'manual-check-fingerprint-pool';

  select *
    into v_result
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'Foto da piscina',
      true,
      v_key,
      v_fp
    );

  if v_result.replayed is distinct from false or v_result.message_id is null then
    raise exception 'pool creation failed';
  end if;

  perform 1
    from public.messages message_row
   where message_row.id = v_result.message_id
     and message_row.organization_id = v_org
     and message_row.store_id = v_store
     and message_row.conversation_id = v_conversation
     and message_row.lead_id = v_lead
     and message_row.sender = 'human'
     and message_row.direction = 'outgoing'
     and message_row.message_type = 'image'
     and message_row.media_url = v_pool_path
     and message_row.outbound_delivery_state = 'pending'
     and message_row.metadata ->> 'source' = 'panel'
     and message_row.metadata ->> 'channel' = 'whatsapp'
     and message_row.metadata ->> 'external_channel' = 'whatsapp'
     and message_row.metadata ->> 'send_external' = 'true'
     and message_row.metadata ->> 'whatsapp_detected_from_conversation' = 'true'
     and message_row.metadata ->> 'outbound_origin' = 'crm_manual_image'
     and message_row.metadata ->> 'media_origin' = 'store_catalog'
     and message_row.metadata ->> 'media_purpose' = 'catalog_product_photo'
     and message_row.metadata ->> 'attachment_kind' = 'image'
     and message_row.metadata ->> 'sent_by' = 'panel_user'
     and message_row.metadata ->> 'sent_by_user_id' = v_actor::text
     and message_row.metadata ->> 'auto_sent' = 'false'
     and message_row.metadata ->> 'storage_bucket' = 'pool-photos'
     and message_row.metadata ->> 'storage_path' = v_pool_path
     and message_row.metadata ->> 'catalog_photo_source' = 'pool_photos'
     and message_row.metadata ->> 'catalog_source_kind' = 'pool'
     and message_row.metadata ->> 'catalog_source_id' = v_pool::text
     and message_row.metadata ->> 'catalog_photo_id' = v_pool_photo::text
     and message_row.metadata ->> 'pool_id' = v_pool::text
     and message_row.metadata ->> 'catalog_item_id' is null
     and message_row.metadata ->> 'catalog_photo_payload_fingerprint' = v_fp;

  if not found then
    raise exception 'pool message lineage, primary photo, actor or outbound scope is invalid';
  end if;

  raise notice 'PASS valid pool selects canonical primary photo and creates human/outgoing WhatsApp image';

  select *
    into v_replay
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'Foto da piscina',
      true,
      v_key,
      v_fp
    );

  if v_replay.replayed is distinct from true
     or v_replay.message_id <> v_result.message_id then
    raise exception 'pool replay did not return original message';
  end if;

  update public.messages
     set outbound_delivery_state = 'uncertain'
   where id = v_result.message_id
     and organization_id = v_org
     and store_id = v_store;

  select *
    into v_replay
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'Foto da piscina',
      true,
      v_key,
      v_fp
    );

  if v_replay.replayed is distinct from true
     or v_replay.message_id <> v_result.message_id then
    raise exception 'uncertain pool replay did not return original message';
  end if;

  update public.pools
     set is_active = false
   where id = v_pool
     and organization_id = v_org
     and store_id = v_store;

  select *
    into v_replay
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'Foto da piscina',
      true,
      v_key,
      v_fp
    );

  if v_replay.replayed is distinct from true
     or v_replay.message_id <> v_result.message_id then
    raise exception 'replay incorrectly depended on current catalog state';
  end if;

  update public.pools
     set is_active = true
   where id = v_pool
     and organization_id = v_org
     and store_id = v_store;

  select count(*)
    into v_count
    from public.messages
   where organization_id = v_org
     and store_id = v_store
     and outbound_idempotency_key = v_key;

  if v_count <> 1 then
    raise exception 'pool idempotency count is %, expected 1', v_count;
  end if;

  raise notice 'PASS replay remains single-row across uncertain delivery and mutable catalog state';

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'Legenda divergente',
      true,
      v_key,
      'different-payload-fingerprint'
    );
    raise exception 'same key with incompatible payload was accepted';
  exception when sqlstate '23514' then
    raise notice 'PASS same key with incompatible payload rejected';
  end;

  v_key := 'manual-check:' || v_run_token || ':pool-internal';
  v_fp := 'manual-check-fingerprint-pool-internal';

  select *
    into v_internal
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'Foto interna da piscina',
      false,
      v_key,
      v_fp
    );

  perform 1
    from public.messages message_row
   where message_row.id = v_internal.message_id
     and message_row.outbound_delivery_state is null
     and message_row.metadata ->> 'channel' = 'crm'
     and message_row.metadata ->> 'send_external' = 'false'
     and message_row.metadata ->> 'whatsapp_detected_from_conversation' = 'false'
     and message_row.metadata ->> 'external_channel' is null
     and message_row.metadata ->> 'outbound_origin' is null;

  if not found then
    raise exception 'non-WhatsApp catalog photo invented external delivery metadata';
  end if;

  select *
    into v_replay
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'Foto interna da piscina',
      false,
      v_key,
      v_fp
    );

  if v_replay.replayed is distinct from true
     or v_replay.message_id <> v_internal.message_id then
    raise exception 'non-WhatsApp replay did not return original message';
  end if;

  select count(*)
    into v_count
    from public.messages
   where organization_id = v_org
     and store_id = v_store
     and outbound_idempotency_key = v_key;

  if v_count <> 1 then
    raise exception 'non-WhatsApp idempotency count is %, expected 1', v_count;
  end if;

  raise notice 'PASS non-WhatsApp catalog photo remains internal and does not invent external delivery';

  v_key := 'manual-check:' || v_run_token || ':catalog-item';
  v_fp := 'manual-check-fingerprint-item';

  select *
    into v_result
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'catalog_item',
      v_item,
      'Foto do produto',
      true,
      v_key,
      v_fp
    );

  if v_result.replayed is distinct from false or v_result.message_id is null then
    raise exception 'catalog item creation failed';
  end if;

  perform 1
    from public.messages message_row
   where message_row.id = v_result.message_id
     and message_row.organization_id = v_org
     and message_row.store_id = v_store
     and message_row.media_url = v_item_path
     and message_row.metadata ->> 'storage_bucket' = 'store-catalog-photos'
     and message_row.metadata ->> 'storage_path' = v_item_path
     and message_row.metadata ->> 'catalog_photo_source' = 'store_catalog_item_photos'
     and message_row.metadata ->> 'catalog_source_kind' = 'catalog_item'
     and message_row.metadata ->> 'catalog_source_id' = v_item::text
     and message_row.metadata ->> 'catalog_photo_id' = v_item_photo::text
     and message_row.metadata ->> 'pool_id' is null
     and message_row.metadata ->> 'catalog_item_id' = v_item::text
     and message_row.metadata ->> 'media_origin' = 'store_catalog'
     and message_row.metadata ->> 'media_purpose' = 'catalog_product_photo'
     and message_row.metadata ->> 'sent_by_user_id' = v_actor::text
     and message_row.outbound_delivery_state = 'pending';

  if not found then
    raise exception 'catalog item message primary photo, lineage or scope is invalid';
  end if;

  select *
    into v_replay
    from public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'catalog_item',
      v_item,
      'Foto do produto',
      true,
      v_key,
      v_fp
    );

  if v_replay.replayed is distinct from true
     or v_replay.message_id <> v_result.message_id then
    raise exception 'catalog item replay did not return original message';
  end if;

  select count(*)
    into v_count
    from public.messages
   where organization_id = v_org
     and store_id = v_store
     and outbound_idempotency_key = v_key;

  if v_count <> 1 then
    raise exception 'catalog item idempotency count is %, expected 1', v_count;
  end if;

  raise notice 'PASS valid catalog item selects canonical primary photo with parent-derived tenant scope';

  select pool_row.id, pool_row.photo_url
    into v_pool_fallback, v_pool_fallback_url
    from public.pools pool_row
   where pool_row.organization_id = v_org
     and pool_row.store_id = v_store
     and pool_row.is_active = true
     and nullif(pg_catalog.btrim(coalesce(pool_row.photo_url, '')), '') ~* '^https?://'
     and not exists (
       select 1
         from public.pool_photos photo_row
        where photo_row.pool_id = pool_row.id
          and photo_row.organization_id = v_org
          and photo_row.store_id = v_store
          and nullif(pg_catalog.btrim(coalesce(photo_row.storage_path, '')), '') is not null
     )
   order by pool_row.id
   limit 1;

  if v_pool_fallback is not null then
    v_key := 'manual-check:' || v_run_token || ':pool-fallback';
    v_fp := 'manual-check-fingerprint-pool-fallback';

    select *
      into v_result
      from public.finalize_manual_catalog_photo_message(
        v_org,
        v_store,
        v_conversation,
        v_lead,
        v_actor,
        'pool',
        v_pool_fallback,
        'Foto fallback da piscina',
        true,
        v_key,
        v_fp
      );

    perform 1
      from public.messages message_row
     where message_row.id = v_result.message_id
       and message_row.media_url = pg_catalog.btrim(v_pool_fallback_url)
       and message_row.metadata ->> 'catalog_photo_source' = 'pool_photo_url'
       and message_row.metadata ->> 'catalog_photo_id' is null
       and message_row.metadata ->> 'storage_bucket' is null
       and message_row.metadata ->> 'storage_path' is null;

    if not found then
      raise exception 'pool photo_url fallback did not preserve canonical direct URL lineage';
    end if;

    raise notice 'PASS pool photo_url HTTP/HTTPS fallback works when no pool_photos row is available';
  else
    raise notice 'SKIP no natural pool photo_url fallback fixture';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  begin
    perform public.finalize_manual_catalog_photo_message(
      v_org,
      v_store,
      v_conversation,
      v_lead,
      v_actor,
      'pool',
      v_pool,
      'authenticated attempt',
      true,
      'manual-check:' || v_run_token || ':authenticated',
      'fp-authenticated'
    );
    raise exception 'authenticated executed service-role-only writer';
  exception when insufficient_privilege then
    raise notice 'PASS authenticated cannot execute writer';
  end;

  execute 'reset role';

  raise notice 'PASS all catalog photo writer behavioral checks';
end;
$checks$;

rollback to savepoint p19a_manual_catalog_photo_behavior;

do $postconditions$
declare
  v_run_token text;
  v_count integer;
begin
  select run_token
    into v_run_token
    from pg_temp.p19a_manual_catalog_photo_check_context
    limit 1;

  select count(*)
    into v_count
    from public.messages
   where outbound_idempotency_key like 'manual-check:' || v_run_token || ':%';

  if v_count <> 0 then
    raise exception 'rollback-to-savepoint left catalog photo test messages: %', v_count;
  end if;

  raise notice 'PASS rollback-to-savepoint leaves no catalog photo test messages for run %', v_run_token;
end;
$postconditions$;

release savepoint p19a_manual_catalog_photo_behavior;
commit;
