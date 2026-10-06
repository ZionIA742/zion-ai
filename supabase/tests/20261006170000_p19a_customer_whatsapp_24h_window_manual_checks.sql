begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;
set local request.jwt.claim.role = '';
set local request.jwt.claims = '';
set local request.jwt.claim.sub = '';

-- P19-A / 4.5.1
-- Rollback-only DEV validation of the customer WhatsApp 24h reader and v3 gate.
-- This file must be run manually in a DEV SQL session. It does not call HTTP,
-- Graph API, WhatsApp, or any remote service.

create temp table pg_temp.p19a_24h_manual_results (
  scenario_number integer primary key,
  scenario_name text not null,
  evidence jsonb not null
) on commit drop;

do $preflight$
begin
  if pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.external_integrations') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_24H_MANUAL_REQUIRED_TABLES_MISSING';
  end if;

  if pg_catalog.to_regprocedure(
       'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_customer_whatsapp_24h_window_by_system(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.validate_or_cancel_whatsapp_external_send_v3_by_system(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_24H_MANUAL_REQUIRED_FUNCTIONS_MISSING';
  end if;
end;
$preflight$;

create or replace function pg_temp.p19a_24h_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_evidence jsonb
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp.p19a_24h_manual_results
    (scenario_number, scenario_name, evidence)
  values
    (p_scenario_number, p_scenario_name, coalesce(p_evidence, '{}'::jsonb));
  raise notice 'PASS %: % %', p_scenario_number, p_scenario_name, p_evidence;
end;
$function$;

create or replace function pg_temp.p19a_24h_clear_fixture_identity()
returns void
language plpgsql
as $function$
begin
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  if session_user <> 'postgres'
     or current_user <> 'postgres'
     or nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '') is not null
     or nullif(pg_catalog.current_setting('request.jwt.claims', true), '') is not null
     or nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '') is not null then
    raise exception using
      errcode = '42501',
      message = 'P19A_24H_MANUAL_FIXTURE_IDENTITY_NOT_CLEAN';
  end if;
end;
$function$;

create or replace function pg_temp.p19a_24h_restore_system_identity()
returns void
language plpgsql
as $function$
begin
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
end;
$function$;

create or replace function pg_temp.p19a_24h_assert_reader(
  p_scenario_number integer,
  p_scenario_name text,
  p_organization_id uuid,
  p_store_id uuid,
  p_message_id uuid,
  p_expected_decision text
)
returns jsonb
language plpgsql
as $function$
declare
  v_result jsonb;
begin
  perform pg_temp.p19a_24h_restore_system_identity();
  begin
    v_result := public.read_customer_whatsapp_24h_window_by_system(
      p_organization_id, p_store_id, p_message_id
    );
  exception
    when others then
      perform pg_temp.p19a_24h_clear_fixture_identity();
      raise;
  end;
  perform pg_temp.p19a_24h_clear_fixture_identity();

  if v_result ->> 'ok' is distinct from 'true'
     or v_result ->> 'decision' is distinct from p_expected_decision then
    raise exception using
      errcode = 'P0001',
      message = format(
        'P19A_24H_SCENARIO_%s_READER_EXPECTED_%s_GOT_%s',
        p_scenario_number,
        p_expected_decision,
        coalesce(v_result ->> 'decision', '<null>')
      );
  end if;

  perform pg_temp.p19a_24h_record(
    p_scenario_number,
    p_scenario_name,
    v_result
  );
  return v_result;
end;
$function$;

do $runner$
declare
  v_run_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_org uuid := pg_catalog.gen_random_uuid();
  v_other_org uuid := pg_catalog.gen_random_uuid();
  v_store uuid := pg_catalog.gen_random_uuid();
  v_other_store uuid := pg_catalog.gen_random_uuid();
  v_other_org_store uuid := pg_catalog.gen_random_uuid();
  v_customer uuid := pg_catalog.gen_random_uuid();
  v_other_customer uuid := pg_catalog.gen_random_uuid();
  v_lead uuid := pg_catalog.gen_random_uuid();
  v_other_lead uuid := pg_catalog.gen_random_uuid();
  v_other_org_lead uuid := pg_catalog.gen_random_uuid();
  v_conversation uuid := pg_catalog.gen_random_uuid();
  v_other_conversation uuid := pg_catalog.gen_random_uuid();
  v_other_org_conversation uuid := pg_catalog.gen_random_uuid();
  v_inbound uuid;
  v_message uuid;
  v_closed_message uuid;
  v_missing_id_message uuid;
  v_bad_metadata_message uuid;
  v_wrong_org_inbound uuid;
  v_wrong_store_inbound uuid;
  v_wrong_conversation_inbound uuid;
  v_future_message uuid;
  v_reopen_message uuid;
  v_open_message uuid;
  v_other_scope_message uuid;
  v_integration_phone text := '155500' || pg_catalog.right(pg_catalog.replace(v_run_id::text, '-', ''), 6);
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
  v_pending_count integer;
  v_scope_error boolean := false;
begin
  perform pg_temp.p19a_24h_clear_fixture_identity();
  insert into public.organizations (id, name)
  values
    (v_org, 'P19A 24h Runner Org ' || v_run_id::text),
    (v_other_org, 'P19A 24h Runner Other Org ' || v_run_id::text);

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v_store, v_org, 'P19A 24h Runner Store', v_now),
    (v_other_store, v_org, 'P19A 24h Runner Other Store', v_now),
    (v_other_org_store, v_other_org, 'P19A 24h Runner Other Org Store', v_now);

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (v_customer, v_org, 'P19A 24h Runner Customer', 'p19a-24h-' || v_run_id::text),
    (v_other_customer, v_other_org, 'P19A 24h Other Customer', 'p19a-24h-other-' || v_run_id::text);

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v_org, v_store, v_customer),
    (v_org, v_other_store, v_customer),
    (v_other_org, v_other_org_store, v_other_customer);

  insert into public.leads (id, organization_id, store_id, name, phone, state)
  values
    (v_lead, v_org, v_store, 'P19A 24h Runner Lead', v_integration_phone, 'novo_lead'),
    (v_other_lead, v_org, v_other_store, 'P19A 24h Other Lead', v_integration_phone, 'novo_lead'),
    (v_other_org_lead, v_other_org, v_other_org_store, 'P19A 24h Other Org Lead', v_integration_phone, 'novo_lead');

  insert into public.conversations (id, organization_id, lead_id, status, is_human_active, created_at)
  values
    (v_conversation, v_org, v_lead, 'open', false, v_now),
    (v_other_conversation, v_org, v_other_lead, 'open', false, v_now),
    (v_other_org_conversation, v_other_org, v_other_org_lead, 'open', false, v_now);

  insert into public.external_integrations (
    id, organization_id, store_id, provider, status, is_active,
    display_phone_number, phone_number_id, whatsapp_business_account_id,
    access_token, metadata, updated_at
  )
  values (
    pg_catalog.gen_random_uuid(), v_org, v_store, 'whatsapp', 'active', true,
    '+15550000000', v_integration_phone, 'p19a-waba-' || v_run_id::text,
    'p19a-runner-token', '{}'::jsonb, v_now
  );

  -- 01. Recent valid inbound opens the window.
  v_inbound := (public.insert_message(
    v_conversation, 'user', 'incoming', 'text', 'recent inbound',
    'wamid.p19a.recent.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object(
      'source', 'meta_whatsapp_webhook', 'channel', 'whatsapp',
      'external_channel', 'whatsapp', 'provider', 'meta',
      'phone_number_id', v_integration_phone
    )
  )).id;
  v_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner outbound 01', null, null,
    pg_catalog.jsonb_build_object(
      'send_external', 'true', 'external_channel', 'whatsapp',
      'outbound_origin', 'crm_manual_text'
    )
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(1, 'recent valid inbound => send', v_org, v_store, v_message, 'send');

  -- 02. Expired inbound closes the free-form window.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_closed_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner closed', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_closed_message;
  update public.messages set created_at = v_now - interval '25 hours' where id = v_inbound;
  perform pg_temp.p19a_24h_assert_reader(2, 'expired inbound => template_required', v_org, v_store, v_closed_message, 'template_required');

  -- 03. No valid inbound.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_message := (public.insert_message(
    v_other_conversation, 'human', 'outgoing', 'text', 'runner no inbound', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(3, 'no valid inbound => template_required', v_org, v_other_store, v_message, 'template_required');

  -- 04. External id is mandatory for the inbound authority.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_missing_id_message := (public.insert_message(
    v_other_conversation, 'user', 'incoming', 'text', 'missing external id', null, null,
    pg_catalog.jsonb_build_object('source', 'meta_whatsapp_webhook', 'channel', 'whatsapp', 'external_channel', 'whatsapp', 'provider', 'meta', 'phone_number_id', v_integration_phone)
  )).id;
  v_message := (public.insert_message(
    v_other_conversation, 'human', 'outgoing', 'text', 'runner missing id', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(4, 'inbound without external id', v_org, v_other_store, v_message, 'template_required');

  -- 05. Meta/WhatsApp metadata is part of the valid inbound contract.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_bad_metadata_message := (public.insert_message(
    v_other_conversation, 'user', 'incoming', 'text', 'bad metadata', 'wamid.p19a.bad.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object('source', 'manual', 'channel', 'whatsapp')
  )).id;
  v_message := (public.insert_message(
    v_other_conversation, 'human', 'outgoing', 'text', 'runner bad metadata', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(5, 'invalid inbound metadata', v_org, v_other_store, v_message, 'template_required');

  -- 06-08. Valid-looking inbounds outside the exact tenant/store/conversation scope.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_wrong_org_inbound := (public.insert_message(
    v_other_org_conversation, 'user', 'incoming', 'text', 'wrong organization', 'wamid.p19a.org.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object('source', 'meta_whatsapp_webhook', 'channel', 'whatsapp', 'external_channel', 'whatsapp', 'provider', 'meta', 'phone_number_id', v_integration_phone)
  )).id;
  v_wrong_store_inbound := (public.insert_message(
    v_other_conversation, 'user', 'incoming', 'text', 'wrong store', 'wamid.p19a.store.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object('source', 'meta_whatsapp_webhook', 'channel', 'whatsapp', 'external_channel', 'whatsapp', 'provider', 'meta', 'phone_number_id', v_integration_phone)
  )).id;
  v_wrong_conversation_inbound := (public.insert_message(
    v_other_conversation, 'user', 'incoming', 'text', 'wrong conversation', 'wamid.p19a.conversation.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object('source', 'meta_whatsapp_webhook', 'channel', 'whatsapp', 'external_channel', 'whatsapp', 'provider', 'meta', 'phone_number_id', v_integration_phone)
  )).id;
  -- These rows remain in their canonical organizations/stores; the reader
  -- must scope them out rather than relying on mutable fixture identities.
  v_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner scope org', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(6, 'other organization inbound isolated', v_org, v_store, v_message, 'template_required');
  v_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner scope store', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(7, 'other store inbound isolated', v_org, v_store, v_message, 'template_required');
  v_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner scope conversation', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(8, 'other conversation inbound isolated', v_org, v_store, v_message, 'template_required');

  -- 09. A future valid inbound is blocked, not treated as open.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_future_message := (public.insert_message(
    v_conversation, 'user', 'incoming', 'text', 'future inbound', 'wamid.p19a.future.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object('source', 'meta_whatsapp_webhook', 'channel', 'whatsapp', 'external_channel', 'whatsapp', 'provider', 'meta', 'phone_number_id', v_integration_phone)
  )).id;
  update public.messages set created_at = v_now + interval '5 minutes' where id = v_future_message;
  v_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner future', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(9, 'future inbound => blocked', v_org, v_store, v_message, 'blocked');

  -- 10-11. Closed v3 transition is template_required and non-terminal.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  update public.messages set created_at = v_now - interval '25 hours' where id = v_future_message;
  v_closed_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner v3 closed', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages
  set outbound_delivery_state = 'processing', outbound_claimed_at = v_now, outbound_claimed_by = 'p19a-24h-runner'
  where id = v_closed_message;
  perform pg_temp.p19a_24h_restore_system_identity();
  v_result := public.validate_or_cancel_whatsapp_external_send_v3_by_system(v_org, v_store, v_closed_message);
  if v_result ->> 'decision' is distinct from 'template_required' then
    raise exception 'P19A_24H_SCENARIO_10_EXPECTED_TEMPLATE_REQUIRED_GOT_%', v_result;
  end if;
  select pg_catalog.to_jsonb(message_row) into v_after from public.messages message_row where id = v_closed_message;
  if v_after ->> 'outbound_delivery_state' is distinct from 'template_required'
     or v_after ->> 'external_message_id' is not null
     or v_after ->> 'outbound_attempt_started_at' is not null
     or v_after ->> 'outbound_claimed_at' is not null
     or v_after ->> 'outbound_claimed_by' is not null
     or v_after ->> 'outbound_delivery_state' in ('failed', 'uncertain') then
    raise exception 'P19A_24H_SCENARIOS_10_11_INVALID_TEMPLATE_TRANSITION_%', v_after;
  end if;
  perform pg_temp.p19a_24h_record(10, 'v3 closed => template_required and safe state', v_result || pg_catalog.jsonb_build_object('message', v_after));
  perform pg_temp.p19a_24h_record(11, 'template_required has no external attempt', v_after);

  -- 12. template_required is not selected by the pending queue.
  perform pg_temp.p19a_24h_restore_system_identity();
  select count(*) into v_pending_count
  from public.get_pending_external_messages_v2(v_org, v_store, 200, 600) pending_row
  where pending_row.message_id = v_closed_message;
  if v_pending_count <> 0 then
    raise exception 'P19A_24H_SCENARIO_12_TEMPLATE_ROW_RESELECTED';
  end if;
  perform pg_temp.p19a_24h_record(12, 'template_required excluded from pending v2', pg_catalog.jsonb_build_object('pending_count', v_pending_count));

  -- 13. A new valid inbound reopens a previously expired conversation.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_reopen_message := (public.insert_message(
    v_other_conversation, 'user', 'incoming', 'text', 'new valid inbound', 'wamid.p19a.reopen.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object('source', 'meta_whatsapp_webhook', 'channel', 'whatsapp', 'external_channel', 'whatsapp', 'provider', 'meta', 'phone_number_id', v_integration_phone)
  )).id;
  v_message := (public.insert_message(
    v_other_conversation, 'human', 'outgoing', 'text', 'runner reopen', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_message;
  perform pg_temp.p19a_24h_assert_reader(13, 'new valid inbound reopens window', v_org, v_other_store, v_message, 'send');

  -- 14. Scope mismatch raises and cannot mutate a message in another scope.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_other_scope_message := (public.insert_message(
    v_other_conversation, 'human', 'outgoing', 'text', 'scope protected', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages set outbound_delivery_state = 'processing' where id = v_other_scope_message;
  select pg_catalog.to_jsonb(message_row) into v_before from public.messages message_row where id = v_other_scope_message;
  perform pg_temp.p19a_24h_restore_system_identity();
  begin
    perform public.read_customer_whatsapp_24h_window_by_system(v_other_org, v_store, v_other_scope_message);
  exception when others then
    perform pg_temp.p19a_24h_clear_fixture_identity();
    v_scope_error := true;
  end;
  select pg_catalog.to_jsonb(message_row) into v_after from public.messages message_row where id = v_other_scope_message;
  if not v_scope_error or v_after is distinct from v_before then
    raise exception 'P19A_24H_SCENARIO_14_SCOPE_MISMATCH_NOT_FAIL_CLOSED';
  end if;
  perform pg_temp.p19a_24h_record(14, 'scope mismatch raises without cross-scope mutation', pg_catalog.jsonb_build_object('error_observed', v_scope_error));

  -- 15. Open v3 path delegates to the published P9 gate and persists uncertain.
  perform pg_temp.p19a_24h_clear_fixture_identity();
  v_inbound := (public.insert_message(
    v_conversation, 'user', 'incoming', 'text', 'fresh valid inbound for P9', 'wamid.p19a.open.' || v_run_id::text, null,
    pg_catalog.jsonb_build_object(
      'source', 'meta_whatsapp_webhook', 'channel', 'whatsapp',
      'external_channel', 'whatsapp', 'provider', 'meta',
      'phone_number_id', v_integration_phone
    )
  )).id;
  v_open_message := (public.insert_message(
    v_conversation, 'human', 'outgoing', 'text', 'runner open v3', null, null,
    pg_catalog.jsonb_build_object('send_external', 'true', 'external_channel', 'whatsapp', 'outbound_origin', 'crm_manual_text')
  )).id;
  update public.messages
  set outbound_delivery_state = 'processing', outbound_claimed_at = v_now, outbound_claimed_by = 'p19a-24h-runner'
  where id = v_open_message;
  perform pg_temp.p19a_24h_restore_system_identity();
  v_result := public.validate_or_cancel_whatsapp_external_send_v3_by_system(v_org, v_store, v_open_message);
  select pg_catalog.to_jsonb(message_row) into v_after from public.messages message_row where id = v_open_message;
  if v_result ->> 'decision' is distinct from 'send'
     or v_after ->> 'outbound_delivery_state' is distinct from 'uncertain'
     or v_after ->> 'outbound_attempt_started_at' is null
     or v_after ->> 'external_message_id' is not null then
    raise exception 'P19A_24H_SCENARIO_15_P9_DELEGATION_CONTRACT_FAILED: result=%, message=%', v_result, v_after;
  end if;
  perform pg_temp.p19a_24h_record(15, 'open v3 delegates to P9 v2 and persists uncertain', v_result || pg_catalog.jsonb_build_object('message', v_after));
end;
$runner$;

do $summary$
declare
  v_count integer;
begin
  select count(*) into v_count from pg_temp.p19a_24h_manual_results;
  if v_count <> 15 then
    raise exception 'P19A_24H_MANUAL_EXPECTED_15_SCENARIOS_GOT_%', v_count;
  end if;
  raise notice 'P19A_24H_MANUAL_SUMMARY: PASS scenarios=% transaction=ROLLBACK external_calls=NO', v_count;
end;
$summary$;

rollback;
