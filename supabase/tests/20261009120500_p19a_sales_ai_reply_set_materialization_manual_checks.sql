begin;

do $preflight$
begin
  if to_regclass('public.p19a_sales_ai_reply_sets') is null
     or to_regprocedure('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)') is null
     or to_regprocedure('public.read_sales_ai_reply_set_by_anchor(uuid,uuid,uuid,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'P19A_I8_TEST_CONTRACT_MISSING';
  end if;
  raise notice 'P19A_I8 concurrency is not executed by this single-session rollback-only runner; use the two-session procedure in the file comment below.';
end;
$preflight$;

/*
  Real two-session concurrency procedure (not falsely simulated here):
  A. Rollback-only lock/concurrent materialization check using an isolated
     DEV fixture with no existing reply set or later AI response:
     1. Session A: BEGIN; invoke the RPC and hold the transaction open.
     2. Session B: BEGIN; invoke the RPC with exactly the same anchor/payload.
        Confirm B blocks while A holds the opportunity/conversation locks.
     3. Session A: ROLLBACK (not COMMIT).
     4. Session B resumes. Because A rolled back, B should create the set with
        replayed=false, and exactly one text/media bundle must exist inside B.
     5. Session B: ROLLBACK; verify original ledger/message counts unchanged.

  B. Concurrent committed replay (replayed=true) and divergent-payload checks
     require a disposable/test-only database clone or an explicitly approved
     cleanup plan. The first session must COMMIT for the second to see its set;
     it is NOT possible to commit A and then 'ROLLBACK both sessions'.
     Never run B against an existing commercial conversation without such an
     isolated disposable fixture. These cases are NOT executed by this runner.
*/

do $fixture$
declare
  v_org uuid;
  v_store uuid;
  v_other_store uuid;
  v_conversation uuid;
  v_lead uuid;
  v_anchor uuid;
  v_opportunity uuid;
  v_doc uuid;
  v_pool uuid;
  v_item uuid;
  v_bad_pool uuid;
  v_bad_item uuid;
  v_photo jsonb;
  v_document_actions jsonb;
  v_first record;
  v_replay record;
  v_read record;
  v_before_messages integer;
  v_after_messages integer;
  v_before_sets integer;
  v_after_sets integer;
  v_ext_org uuid;
  v_ext_store uuid;
  v_ext_conversation uuid;
  v_ext_lead uuid;
  v_ext_anchor uuid;
  v_ext_opportunity uuid;
begin
  select s.organization_id, s.id, c.id, l.id, m.id
    into v_org, v_store, v_conversation, v_lead, v_anchor
  from public.stores s
  join public.leads l on l.store_id = s.id and l.organization_id = s.organization_id
  join public.conversations c on c.lead_id = l.id and c.organization_id = l.organization_id
  join public.messages m on m.conversation_id = c.id
                         and m.organization_id = s.organization_id
                         and m.store_id = s.id
  where m.sender = 'user'
    and m.direction = 'incoming'
    and m.deleted_at is null
    and not exists (
      select 1 from public.messages newer
      where newer.conversation_id = c.id
        and newer.organization_id = s.organization_id
        and newer.store_id = s.id
        and newer.sender = 'user'
        and newer.direction = 'incoming'
        and newer.deleted_at is null
        and (newer.created_at, newer.id) > (m.created_at, m.id)
    )
    and not exists (
      select 1 from public.messages later_ai
      where later_ai.conversation_id = c.id
        and later_ai.organization_id = s.organization_id
        and later_ai.store_id = s.id
        and later_ai.sender = 'ai'
        and later_ai.direction = 'outgoing'
        and later_ai.deleted_at is null
        and later_ai.created_at > m.created_at
    )
    and exists (
      select 1 from public.store_catalog_customer_files cf
      join public.store_import_files f on f.id = cf.import_file_id
        and f.organization_id = cf.organization_id and f.store_id = cf.store_id
      join public.store_catalog_settings cs on cs.organization_id = cf.organization_id
        and cs.store_id = cf.store_id
      where cf.organization_id = s.organization_id and cf.store_id = s.id
        and f.status = 'active'
        and nullif(btrim(f.storage_bucket), '') is not null
        and nullif(btrim(f.storage_path), '') is not null
        and cs.allow_full_catalog_send is true
    )
    and (
      exists (
        select 1 from public.pools p
        join public.pool_photos pp on pp.pool_id = p.id
          and pp.organization_id = p.organization_id and pp.store_id = p.store_id
        where p.organization_id = s.organization_id and p.store_id = s.id
          and p.is_active is true and nullif(btrim(pp.storage_path), '') is not null
      )
      or exists (
        select 1 from public.store_catalog_items i
        join public.store_catalog_item_photos ip on ip.catalog_item_id = i.id
        where i.organization_id = s.organization_id and i.store_id = s.id
          and i.is_active is true and nullif(btrim(ip.storage_path), '') is not null
      )
    )
    and exists (
      select 1 from public.commercial_opportunities o
      where o.organization_id = s.organization_id and o.store_id = s.id
        and (o.primary_conversation_id = c.id or o.primary_conversation_id is null)
    )
  order by m.created_at desc, m.id desc
  limit 1;
  if v_anchor is null then
    raise exception using errcode = 'P0001', message = 'P19A_I8_TEST_FIXTURE_MISSING_ELIGIBLE_BASE_CHAIN';
  end if;

  select o.id into v_opportunity
  from public.commercial_opportunities o
  where o.organization_id = v_org
    and o.store_id = v_store
    and (o.primary_conversation_id is null or o.primary_conversation_id = v_conversation)
  order by o.updated_at desc
  limit 1;
  if v_opportunity is null then
    raise exception using errcode = 'P0001', message = 'P19A_I8_TEST_FIXTURE_MISSING_OPPORTUNITY';
  end if;

  select cf.import_file_id into v_doc
  from public.store_catalog_customer_files cf
  join public.store_import_files f
    on f.id = cf.import_file_id
   and f.organization_id = cf.organization_id
   and f.store_id = cf.store_id
  where cf.organization_id = v_org
    and cf.store_id = v_store
    and f.status = 'active'
    and nullif(btrim(f.storage_bucket), '') is not null
    and nullif(btrim(f.storage_path), '') is not null
    and exists (
      select 1 from public.store_catalog_settings cs
      where cs.organization_id = v_org
        and cs.store_id = v_store
        and cs.allow_full_catalog_send is true
    )
  order by f.id
  limit 1;
  if v_doc is null then
    raise exception using errcode = 'P0001', message = 'P19A_I8_TEST_FIXTURE_MISSING_CANONICAL_DOCUMENT';
  end if;

  select p.id into v_pool
  from public.pools p
  join public.pool_photos pp on pp.pool_id = p.id
                            and pp.organization_id = p.organization_id
                            and pp.store_id = p.store_id
  where p.organization_id = v_org and p.store_id = v_store and p.is_active is true
    and nullif(btrim(pp.storage_path), '') is not null
  order by p.id, pp.sort_order asc nulls last, pp.id
  limit 1;
  if v_pool is not null then
    v_photo := jsonb_build_object('target_type','pool','pool_id',v_pool,'caption','fixture photo');
  else
    select i.id into v_item
    from public.store_catalog_items i
    join public.store_catalog_item_photos ip on ip.catalog_item_id = i.id
    where i.organization_id = v_org and i.store_id = v_store and i.is_active is true
      and nullif(btrim(ip.storage_path), '') is not null
    order by i.id, ip.sort_order asc nulls last, ip.id
    limit 1;
    if v_item is null then
      raise exception using errcode = 'P0001', message = 'P19A_I8_TEST_FIXTURE_MISSING_CANONICAL_PHOTO';
    end if;
    v_photo := jsonb_build_object('target_type','catalog_item','catalog_item_id',v_item,'caption','fixture photo');
  end if;

  select p.id into v_bad_pool
  from public.pools p
  where p.organization_id = v_org and p.store_id = v_store and p.is_active is true
  order by p.id
  limit 1;
  select i.id into v_bad_item
  from public.store_catalog_items i
  where i.organization_id = v_org and i.store_id = v_store and i.is_active is true
  order by i.id
  limit 1;

  v_document_actions := jsonb_build_array(jsonb_build_object(
    'import_file_id', v_doc, 'caption', 'fixture document', 'sort_order', 1
  ));

  -- Text-only materialization, exact replay, confirmed read, and transport state.
  begin
    select * into v_first from public.materialize_sales_ai_reply_set_by_system(
      v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
      'fixture text','reactive_ai_reply',false,'[]'::jsonb,null,
      jsonb_build_object('scenario','text')
    );
    if v_first.replayed is distinct from false or v_first.text_message_id is null then
      raise exception using errcode='P0001',message='P19A_I8_TEST_TEXT_MATERIALIZATION_FAILED';
    end if;
    select * into v_replay from public.materialize_sales_ai_reply_set_by_system(
      v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
      'fixture text','reactive_ai_reply',false,'[]'::jsonb,null,
      jsonb_build_object('scenario','text')
    );
    if v_replay.replayed is distinct from true
       or v_replay.text_message_id is distinct from v_first.text_message_id then
      raise exception using errcode='P0001',message='P19A_I8_TEST_TEXT_REPLAY_FAILED';
    end if;
    select * into v_read from public.read_sales_ai_reply_set_by_anchor(v_org,v_store,v_conversation,v_anchor);
    if v_read.response_set_id is null or v_read.materialization_state <> 'confirmed' then
      raise exception using errcode='P0001',message='P19A_I8_TEST_CONFIRMED_READ_FAILED';
    end if;
    if exists (select 1 from public.messages where id=v_first.text_message_id and outbound_delivery_state is not null)
       or exists (select 1 from public.messages where id=v_first.text_message_id and external_message_id is not null) then
      raise exception using errcode='P0001',message='P19A_I8_TEST_INTERNAL_TRANSPORT_STATE_CHANGED';
    end if;
    raise exception using errcode='P0001',message='P19A_I8_TEST_SCENARIO_ROLLBACK';
  exception when others then
    if sqlerrm not like '%P19A_I8_TEST_SCENARIO_ROLLBACK%' then raise; end if;
  end;

  -- Text + document, text + photo, and the complete set use real canonical DEV rows.
  begin
    select * into v_first from public.materialize_sales_ai_reply_set_by_system(
      v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
      'fixture document','reactive_ai_reply',false,v_document_actions,null,
      jsonb_build_object('scenario','document')
    );
    if coalesce(array_length(v_first.document_message_ids,1),0) <> 1 then
      raise exception using errcode='P0001',message='P19A_I8_TEST_DOCUMENT_MATERIALIZATION_FAILED';
    end if;
    raise exception using errcode='P0001',message='P19A_I8_TEST_SCENARIO_ROLLBACK';
  exception when others then
    if sqlerrm not like '%P19A_I8_TEST_SCENARIO_ROLLBACK%' then raise; end if;
  end;

  -- stop_contact_ack is text-only: its media action is rejected before any
  -- catalog lookup or message insert, even when the caller asks for internal
  -- materialization (external_authorized=false).
  begin
    perform * from public.materialize_sales_ai_reply_set_by_system(
      v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
      'stop acknowledgement','stop_contact_ack',false,v_document_actions,null,
      jsonb_build_object('scenario','stop-contact-media')
    );
    raise exception using errcode='P0001',message='P19A_I8_TEST_STOP_CONTACT_MEDIA_ACCEPTED';
  exception when others then
    if sqlerrm not like '%P19A_I8_STOP_CONTACT_MEDIA_FORBIDDEN%' then raise; end if;
  end;

  begin
    select * into v_first from public.materialize_sales_ai_reply_set_by_system(
      v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
      'fixture photo','reactive_ai_reply',false,'[]'::jsonb,v_photo,
      jsonb_build_object('scenario','photo')
    );
    if v_first.photo_message_id is null then
      raise exception using errcode='P0001',message='P19A_I8_TEST_PHOTO_MATERIALIZATION_FAILED';
    end if;
    raise exception using errcode='P0001',message='P19A_I8_TEST_SCENARIO_ROLLBACK';
  exception when others then
    if sqlerrm not like '%P19A_I8_TEST_SCENARIO_ROLLBACK%' then raise; end if;
  end;

  -- Before the complete set exists, a real contradictory target fails before
  -- text/media inserts, proving the candidate transaction is rollback-safe.
  if v_bad_pool is not null and v_bad_item is not null then
    begin
      perform * from public.materialize_sales_ai_reply_set_by_system(
        v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
        'invalid','reactive_ai_reply',false,v_document_actions,
        jsonb_build_object('target_type','pool','pool_id',v_bad_pool,'catalog_item_id',v_bad_item,'caption','invalid'),
        jsonb_build_object('scenario','rollback')
      );
      raise exception using errcode='P0001',message='P19A_I8_TEST_ROLLBACK_INVALID_MEDIA_ACCEPTED';
    exception when others then
      if sqlerrm not like '%P19A_I8_PHOTO_TARGET_IDENTITY_CONTRADICTORY%' then raise; end if;
    end;
  else
    raise notice 'P19A_I8 contradictory target fixture skipped: both real pool and catalog item are required.';
  end if;

  select count(*) into v_before_messages from public.messages where conversation_id=v_conversation;
  select count(*) into v_before_sets from public.p19a_sales_ai_reply_sets where anchor_message_id=v_anchor;
  begin
    select * into v_first from public.materialize_sales_ai_reply_set_by_system(
      v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
      'fixture complete','reactive_ai_reply',false,v_document_actions,v_photo,
      jsonb_build_object('scenario','complete')
    );
    if v_first.text_message_id is null or v_first.photo_message_id is null
       or coalesce(array_length(v_first.document_message_ids,1),0) <> 1 then
      raise exception using errcode='P0001',message='P19A_I8_TEST_COMPLETE_MATERIALIZATION_FAILED';
    end if;
    select count(*) into v_after_messages from public.messages where conversation_id=v_conversation;
    select count(*) into v_after_sets from public.p19a_sales_ai_reply_sets where anchor_message_id=v_anchor;
    if v_after_messages <> v_before_messages + 3 or v_after_sets <> v_before_sets + 1 then
      raise exception using errcode='P0001',message='P19A_I8_TEST_COMPLETE_ATOMIC_COUNT_FAILED';
    end if;
    select * into v_replay from public.materialize_sales_ai_reply_set_by_system(
      v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
      'fixture complete','reactive_ai_reply',false,v_document_actions,v_photo,
      jsonb_build_object('scenario','complete')
    );
    if v_replay.replayed is distinct from true
       or v_replay.text_message_id is distinct from v_first.text_message_id
       or v_replay.photo_message_id is distinct from v_first.photo_message_id then
      raise exception using errcode='P0001',message='P19A_I8_TEST_COMPLETE_REPLAY_FAILED';
    end if;
    begin
      perform * from public.materialize_sales_ai_reply_set_by_system(
        v_org,v_store,v_conversation,v_lead,v_anchor,v_opportunity,
        'changed','reactive_ai_reply',false,v_document_actions,v_photo,
        jsonb_build_object('scenario','changed')
      );
      raise exception using errcode='P0001',message='P19A_I8_TEST_DIVERGENT_REPLAY_ACCEPTED';
    exception when others then
      if sqlerrm not like '%P19A_I8_RESPONSE_SET_PAYLOAD_MISMATCH%' then raise; end if;
    end;
    select count(*) into v_after_messages from public.messages where conversation_id=v_conversation;
    if v_after_messages <> v_before_messages + 3 then
      raise exception using errcode='P0001',message='P19A_I8_TEST_ROLLBACK_CHANGED_CONFIRMED_SET';
    end if;
    raise exception using errcode='P0001',message='P19A_I8_TEST_SCENARIO_ROLLBACK';
  exception when others then
    if sqlerrm not like '%P19A_I8_TEST_SCENARIO_ROLLBACK%' then raise; end if;
  end;

  -- Cross-store isolation uses a real store when one exists; no synthetic UUID proves authorization.
  select s.id into v_other_store
  from public.stores s
  where s.organization_id = v_org and s.id <> v_store
  limit 1;
  if v_other_store is not null then
    begin
      perform * from public.materialize_sales_ai_reply_set_by_system(
        v_org,v_other_store,v_conversation,v_lead,v_anchor,v_opportunity,
        'isolation','reactive_ai_reply',false,'[]'::jsonb,null,'{}'::jsonb
      );
      raise exception using errcode='P0001',message='P19A_I8_TEST_CROSS_STORE_ACCEPTED';
    exception when others then
      if sqlerrm not like '%P19A_I8_%SCOPE_MISMATCH%' then raise; end if;
    end;
  else
    raise notice 'P19A_I8 cross-store isolation fixture skipped: no second real store in this DEV organization.';
  end if;

  -- Opt-out is exercised only with a real Meta anchor, active integration,
  -- canonical context, opportunity, and P9 opted_out event. Otherwise the
  -- runner reports the missing DEV fixture instead of inventing authority.
  select m.organization_id, m.store_id, m.conversation_id, c.lead_id, m.id, o.id
    into v_ext_org, v_ext_store, v_ext_conversation, v_ext_lead, v_ext_anchor, v_ext_opportunity
  from public.messages m
  join public.conversations c on c.id = m.conversation_id and c.organization_id = m.organization_id
  join public.commercial_opportunities o
    on o.organization_id = m.organization_id
   and o.store_id = m.store_id
   and o.primary_conversation_id = m.conversation_id
  where m.sender = 'user'
    and m.direction = 'incoming'
    and m.deleted_at is null
    and m.external_message_id is not null
    and m.metadata ->> 'source' = 'meta_whatsapp_webhook'
    and m.metadata ->> 'channel' = 'whatsapp'
    and m.metadata ->> 'external_channel' = 'whatsapp'
    and m.metadata ->> 'provider' = 'meta'
    and m.commercial_session_context_link_id is not null
    and exists (
      select 1 from public.commercial_session_context_links link_row
      join public.conversation_sessions session_row on session_row.id = link_row.conversation_session_id
      where link_row.id = m.commercial_session_context_link_id
        and link_row.organization_id = m.organization_id
        and link_row.store_id = m.store_id
        and link_row.commercial_opportunity_id = o.id
        and session_row.conversation_id = m.conversation_id
    )
    and exists (
      select 1 from public.get_active_whatsapp_integration_for_external_send_by_system(m.organization_id,m.store_id) integration_row
      where integration_row.phone_number_id = m.metadata ->> 'phone_number_id'
    )
    and exists (
      select 1 from public.commercial_opportunity_followup_events event_row
      where event_row.organization_id = m.organization_id
        and event_row.store_id = m.store_id
        and event_row.commercial_opportunity_id = o.id
        and event_row.event_type = 'opted_out'
        and event_row.actor_type = 'system'
        and event_row.metadata ->> 'source_conversation_id' = m.conversation_id::text
        and event_row.metadata ->> 'source_message_id' = m.id::text
    )
  order by m.created_at desc, m.id desc
  limit 1;
  if v_ext_anchor is null then
    raise notice 'P19A_I8 opt-out/external authority fixture skipped: no real canonical DEV chain with Meta inbound and opted_out event.';
  else
    begin
      select * into v_first from public.materialize_sales_ai_reply_set_by_system(
        v_ext_org,v_ext_store,v_ext_conversation,v_ext_lead,v_ext_anchor,v_ext_opportunity,
        'fixture stop acknowledgement','stop_contact_ack',true,'[]'::jsonb,null,
        jsonb_build_object('scenario','opt-out')
      );
      if v_first.text_message_id is null or v_first.replayed is distinct from false then
        raise exception using errcode='P0001',message='P19A_I8_TEST_OPTOUT_MATERIALIZATION_FAILED';
      end if;
      if not exists (
        select 1 from public.messages
        where id = v_first.text_message_id
          and outbound_delivery_state = 'pending'
          and external_message_id is null
      ) then
        raise exception using errcode='P0001',message='P19A_I8_TEST_OPTOUT_TRANSPORT_STATE_FAILED';
      end if;
      raise exception using errcode='P0001',message='P19A_I8_TEST_SCENARIO_ROLLBACK';
    exception when others then
      if sqlerrm not like '%P19A_I8_TEST_SCENARIO_ROLLBACK%' then raise; end if;
    end;
  end if;

  raise notice 'P19A_I8 rollback-only fixture scenarios passed: text, document, photo, complete set, replay, divergent replay, rollback, transport, and available isolation.';
end;
$fixture$;

rollback;
