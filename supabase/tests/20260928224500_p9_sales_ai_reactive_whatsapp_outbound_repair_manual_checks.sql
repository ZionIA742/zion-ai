-- P9 / Bug B - Sales AI reactive WhatsApp outbound repair
-- Behavioral/manual checks. Synthetic fixtures only; rollback-only.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

create temp table p9_bug_b_results (
  scenario integer primary key,
  name text not null,
  status text not null,
  detail text not null
) on commit drop;

do $runner$
declare
  v_run uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_customer_internal uuid := gen_random_uuid();
  v_customer_real uuid := gen_random_uuid();
  v_customer_wrong_phone uuid := gen_random_uuid();
  v_customer_no_context uuid := gen_random_uuid();

  v_lead_internal uuid := gen_random_uuid();
  v_lead_real uuid := gen_random_uuid();
  v_lead_wrong_phone uuid := gen_random_uuid();
  v_lead_no_context uuid := gen_random_uuid();

  v_link_internal uuid := gen_random_uuid();
  v_link_real uuid := gen_random_uuid();
  v_link_wrong_phone uuid := gen_random_uuid();
  v_link_no_context uuid := gen_random_uuid();

  v_conv_internal uuid := gen_random_uuid();
  v_conv_real uuid := gen_random_uuid();
  v_conv_wrong_phone uuid := gen_random_uuid();
  v_conv_no_context uuid := gen_random_uuid();

  v_session_internal uuid := gen_random_uuid();
  v_session_real uuid := gen_random_uuid();
  v_session_wrong_phone uuid := gen_random_uuid();
  v_session_no_context uuid := gen_random_uuid();

  v_opp_internal uuid := gen_random_uuid();
  v_opp_real uuid := gen_random_uuid();
  v_opp_wrong_phone uuid := gen_random_uuid();

  v_context_internal uuid := gen_random_uuid();
  v_context_real uuid := gen_random_uuid();
  v_context_wrong_phone uuid := gen_random_uuid();

  v_source_internal public.messages;
  v_source_real public.messages;
  v_source_wrong_phone public.messages;
  v_source_no_context public.messages;
  v_outbound public.messages;
  v_replay record;
  v_result record;
  v_gate jsonb;
  v_count integer;
  v_def text;
  v_phone text := 'runner-phone-' || replace(v_run::text, '-', '');
  v_wrong_phone text := 'runner-wrong-' || replace(v_run::text, '-', '');
begin
  -- Scenario 1: installed function security and producer contract.
  select pg_catalog.pg_get_functiondef(
    'public.ai_sales_real_handler_qualify_lead(uuid,uuid,uuid)'::regprocedure
  ) into v_def;

  insert into p9_bug_b_results values (
    1,
    'handler security and reactive transport contract are installed',
    case
      when exists (
        select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'ai_sales_real_handler_qualify_lead'
          and p.prosecdef = true
          and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
          and p.proconfig = array['search_path=public, pg_temp']::text[]
          and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
      and pg_catalog.strpos(v_def, '''outbound_kind'', ''reactive_ai_reply''') > 0
      and pg_catalog.strpos(v_def, '''source_message_id'', v_source_message_id') > 0
      and pg_catalog.strpos(v_def, '''commercial_opportunity_id'', v_commercial_opportunity_id') > 0
      and pg_catalog.strpos(v_def, '''send_external'', true') > 0
      and pg_catalog.strpos(v_def, 'is_real_whatsapp_conversation_for_external_send') > 0
      then 'PASS' else 'FAIL'
    end,
    'owner/security/ACL plus reactive metadata producer'
  );

  -- Shared tenant fixtures.
  insert into public.organizations (id, name, subscription_status)
  values (v_org, 'P9 Bug B Runner Org ' || v_run::text, 'active');

  insert into public.stores (id, organization_id, name)
  values (v_store, v_org, 'P9 Bug B Runner Store');

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (v_customer_internal, v_org, 'P9 Bug B Customer Internal', 'p9-bug-b-internal-' || replace(v_run::text, '-', '')),
    (v_customer_real, v_org, 'P9 Bug B Customer Real', 'p9-bug-b-real-' || replace(v_run::text, '-', '')),
    (v_customer_wrong_phone, v_org, 'P9 Bug B Customer Wrong Phone', 'p9-bug-b-wrong-' || replace(v_run::text, '-', '')),
    (v_customer_no_context, v_org, 'P9 Bug B Customer No Context', 'p9-bug-b-no-context-' || replace(v_run::text, '-', ''));

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v_org, v_store, v_customer_internal),
    (v_org, v_store, v_customer_real),
    (v_org, v_store, v_customer_wrong_phone),
    (v_org, v_store, v_customer_no_context);

  insert into public.leads (id, organization_id, store_id, name, phone, state)
  values
    (v_lead_internal, v_org, v_store, 'P9 Bug B Internal', '5511990001001', 'novo_lead'),
    (v_lead_real, v_org, v_store, 'P9 Bug B Real', '5511990001002', 'novo_lead'),
    (v_lead_wrong_phone, v_org, v_store, 'P9 Bug B Wrong Phone', '5511990001003', 'novo_lead'),
    (v_lead_no_context, v_org, v_store, 'P9 Bug B No Context', '5511990001004', 'novo_lead');

  insert into public.lead_customer_links (
    id, organization_id, store_id, lead_id, customer_id,
    status, source, linked_by_actor_type, metadata
  )
  values
    (v_link_internal, v_org, v_store, v_lead_internal, v_customer_internal, 'active', 'system', 'system', '{"runner":"p9_bug_b"}'::jsonb),
    (v_link_real, v_org, v_store, v_lead_real, v_customer_real, 'active', 'system', 'system', '{"runner":"p9_bug_b"}'::jsonb),
    (v_link_wrong_phone, v_org, v_store, v_lead_wrong_phone, v_customer_wrong_phone, 'active', 'system', 'system', '{"runner":"p9_bug_b"}'::jsonb),
    (v_link_no_context, v_org, v_store, v_lead_no_context, v_customer_no_context, 'active', 'system', 'system', '{"runner":"p9_bug_b"}'::jsonb);

  insert into public.conversations (
    id, organization_id, lead_id, status, is_human_active, created_at
  )
  values
    (v_conv_internal, v_org, v_lead_internal, 'active', false, clock_timestamp()),
    (v_conv_real, v_org, v_lead_real, 'active', false, clock_timestamp()),
    (v_conv_wrong_phone, v_org, v_lead_wrong_phone, 'active', false, clock_timestamp()),
    (v_conv_no_context, v_org, v_lead_no_context, 'active', false, clock_timestamp());

  insert into public.conversation_sessions (
    id, organization_id, store_id, conversation_id, status
  )
  values
    (v_session_internal, v_org, v_store, v_conv_internal, 'active'),
    (v_session_real, v_org, v_store, v_conv_real, 'active'),
    (v_session_wrong_phone, v_org, v_store, v_conv_wrong_phone, 'active'),
    (v_session_no_context, v_org, v_store, v_conv_no_context, 'active');

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id,
    origin_lead_id, primary_conversation_id, stage, lifecycle_cycle
  )
  values
    (v_opp_internal, v_org, v_store, v_customer_internal, v_lead_internal, v_conv_internal, 'qualificacao', 1),
    (v_opp_real, v_org, v_store, v_customer_real, v_lead_real, v_conv_real, 'qualificacao', 1),
    (v_opp_wrong_phone, v_org, v_store, v_customer_wrong_phone, v_lead_wrong_phone, v_conv_wrong_phone, 'qualificacao', 1);

  insert into public.commercial_session_context_links (
    id, organization_id, store_id, conversation_session_id,
    customer_id, commercial_opportunity_id, lead_customer_link_id,
    status, source, linked_by_actor_type, metadata
  )
  values
    (v_context_internal, v_org, v_store, v_session_internal, v_customer_internal, v_opp_internal, v_link_internal, 'active', 'system', 'system', '{"runner":"p9_bug_b"}'::jsonb),
    (v_context_real, v_org, v_store, v_session_real, v_customer_real, v_opp_real, v_link_real, 'active', 'system', 'system', '{"runner":"p9_bug_b"}'::jsonb),
    (v_context_wrong_phone, v_org, v_store, v_session_wrong_phone, v_customer_wrong_phone, v_opp_wrong_phone, v_link_wrong_phone, 'active', 'system', 'system', '{"runner":"p9_bug_b"}'::jsonb);

  insert into public.external_integrations (
    id, organization_id, store_id, provider, status, is_active,
    display_phone_number, phone_number_id, whatsapp_business_account_id,
    access_token, last_error, metadata, updated_at
  )
  values (
    gen_random_uuid(), v_org, v_store, 'whatsapp', 'active', true,
    '+55 11 90000-1000', v_phone, 'runner-waba-' || replace(v_run::text, '-', ''),
    'runner-token-not-used', null, '{"runner":"p9_bug_b"}'::jsonb, clock_timestamp()
  );

  -- Scenario 2: ordinary internal/panel inbound remains internal.
  select * into v_source_internal
  from public.insert_message(
    v_conv_internal, 'user', 'incoming', 'text',
    'Quero saber mais sobre as opções.',
    'runner-internal-' || v_run::text, null,
    '{"source":"panel","channel":"panel"}'::jsonb
  );

  select * into v_result
  from public.ai_sales_real_handler_qualify_lead(v_org, v_store, v_conv_internal);

  select * into v_outbound
  from public.messages
  where id = (v_result.details ->> 'message_id')::uuid;

  insert into p9_bug_b_results values (
    2,
    'non WhatsApp conversation remains internal',
    case
      when v_result.ok = true
       and v_result.status = 'message_inserted'
       and coalesce(v_outbound.metadata ->> 'send_external', 'false') <> 'true'
       and nullif(v_outbound.metadata ->> 'external_channel', '') is null
       and nullif(v_outbound.metadata ->> 'outbound_kind', '') is null
      then 'PASS' else 'FAIL'
    end,
    'internal message must not become provider-eligible'
  );

  -- Scenario 3: exact Meta inbound + active integration + captured opportunity
  -- becomes canonical reactive WhatsApp outbound.
  select * into v_source_real
  from public.insert_message(
    v_conv_real, 'user', 'incoming', 'text',
    'Olá, quero conhecer as opções.',
    'runner-real-' || v_run::text, null,
    jsonb_build_object(
      'source', 'meta_whatsapp_webhook',
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'provider', 'meta',
      'phone_number_id', v_phone,
      'raw_message_type', 'text'
    )
  );

  -- This rollback-only harness keeps every fixture in one PostgreSQL
  -- transaction. messages.created_at defaults to now(), which is the
  -- transaction timestamp, so without this adjustment the inbound and the
  -- handler outbound would tie artificially. Production inbound and Sales AI
  -- execution occur in separate database transactions.
  update public.messages
  set created_at = pg_catalog.now() - interval '1 second'
  where id = v_source_real.id;

  select * into v_result
  from public.ai_sales_real_handler_qualify_lead(v_org, v_store, v_conv_real);

  select * into v_outbound
  from public.messages
  where id = (v_result.details ->> 'message_id')::uuid;

  insert into p9_bug_b_results values (
    3,
    'real Meta inbound materializes exact reactive WhatsApp contract',
    case
      when v_result.ok = true
       and v_result.status = 'message_inserted'
       and v_outbound.metadata ->> 'source' = 'ai_sales_real_handler_qualify_lead'
       and v_outbound.metadata ->> 'channel' = 'whatsapp'
       and v_outbound.metadata ->> 'external_channel' = 'whatsapp'
       and v_outbound.metadata ->> 'send_external' = 'true'
       and v_outbound.metadata ->> 'outbound_origin' = 'ai_sales_reply'
       and v_outbound.metadata ->> 'outbound_kind' = 'reactive_ai_reply'
       and (v_outbound.metadata ->> 'source_message_id')::uuid = v_source_real.id
       and (v_outbound.metadata ->> 'commercial_opportunity_id')::uuid = v_opp_real
       and v_outbound.commercial_session_context_link_id = v_context_real
       and v_outbound.outbound_delivery_state is null
      then 'PASS' else 'FAIL'
    end,
    pg_catalog.format(
      'source=%s outbound=%s opportunity=%s',
      v_source_real.id, v_outbound.id, v_opp_real
    )
  );

  -- Scenario 4: replay in the same customer turn remains idempotent.
  select * into v_replay
  from public.ai_sales_real_handler_qualify_lead(v_org, v_store, v_conv_real);

  select count(*) into v_count
  from public.messages m
  where m.organization_id = v_org
    and m.store_id = v_store
    and m.conversation_id = v_conv_real
    and m.sender = 'ai'
    and m.direction = 'outgoing'
    and m.metadata ->> 'source' = 'ai_sales_real_handler_qualify_lead';

  insert into p9_bug_b_results values (
    4,
    'same-turn replay does not duplicate AI outbound',
    case
      when v_replay.ok = true
       and v_replay.status = 'already_sent_for_current_customer_turn'
       and v_count = 1
      then 'PASS' else 'FAIL'
    end,
    'outgoing_count=' || v_count::text || ' status=' || coalesce(v_replay.status, '<null>')
  );

  -- Scenario 5: final SQL gate accepts the producer contract before provider
  -- attempt. No provider/HTTP call is made by this runner.
  update public.messages
  set outbound_delivery_state = 'processing',
      outbound_claimed_at = clock_timestamp(),
      outbound_claimed_by = 'p9_bug_b_runner'
  where id = v_outbound.id;

  v_gate := public.validate_or_cancel_whatsapp_external_send_by_system(
    v_org, v_store, v_outbound.id
  );

  select * into v_outbound
  from public.messages
  where id = v_outbound.id;

  insert into p9_bug_b_results values (
    5,
    'final external SEND gate accepts exact reactive contract',
    case
      when v_gate ->> 'decision' = 'send'
       and v_gate ->> 'reason' = 'authorized'
       and v_outbound.outbound_delivery_state = 'uncertain'
       and v_outbound.outbound_attempt_started_at is not null
      then 'PASS' else 'FAIL'
    end,
    'gate=' || coalesce(v_gate::text, '<null>')
  );

  -- Scenario 6: Meta-looking inbound whose phone is not the active integration
  -- remains internal.
  select * into v_source_wrong_phone
  from public.insert_message(
    v_conv_wrong_phone, 'user', 'incoming', 'text',
    'Teste de outro phone id.',
    'runner-wrong-phone-' || v_run::text, null,
    jsonb_build_object(
      'source', 'meta_whatsapp_webhook',
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'provider', 'meta',
      'phone_number_id', v_wrong_phone,
      'raw_message_type', 'text'
    )
  );

  select * into v_result
  from public.ai_sales_real_handler_qualify_lead(v_org, v_store, v_conv_wrong_phone);

  select * into v_outbound
  from public.messages
  where id = (v_result.details ->> 'message_id')::uuid;

  insert into p9_bug_b_results values (
    6,
    'wrong phone_number_id does not activate external transport',
    case
      when coalesce(v_outbound.metadata ->> 'send_external', 'false') <> 'true'
       and nullif(v_outbound.metadata ->> 'outbound_kind', '') is null
      then 'PASS' else 'FAIL'
    end,
    'wrong_phone=' || v_wrong_phone
  );

  -- Scenario 7: even a real Meta inbound stays internal without an immutable
  -- commercial opportunity snapshot.
  select * into v_source_no_context
  from public.insert_message(
    v_conv_no_context, 'user', 'incoming', 'text',
    'Teste sem contexto comercial.',
    'runner-no-context-' || v_run::text, null,
    jsonb_build_object(
      'source', 'meta_whatsapp_webhook',
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'provider', 'meta',
      'phone_number_id', v_phone,
      'raw_message_type', 'text'
    )
  );

  select * into v_result
  from public.ai_sales_real_handler_qualify_lead(v_org, v_store, v_conv_no_context);

  select * into v_outbound
  from public.messages
  where id = (v_result.details ->> 'message_id')::uuid;

  insert into p9_bug_b_results values (
    7,
    'real WhatsApp without commercial opportunity fails closed to internal only',
    case
      when v_source_no_context.commercial_session_context_link_id is null
       and coalesce(v_outbound.metadata ->> 'send_external', 'false') <> 'true'
       and nullif(v_outbound.metadata ->> 'commercial_opportunity_id', '') is null
      then 'PASS' else 'FAIL'
    end,
    'source_context=' || coalesce(v_source_no_context.commercial_session_context_link_id::text, '<null>')
  );

exception
  when others then
    insert into p9_bug_b_results
    values (
      99,
      'runner infrastructure',
      'FAIL',
      sqlstate || ' ' || sqlerrm
    )
    on conflict (scenario) do update
      set status = excluded.status,
          detail = excluded.detail;
end;
$runner$;

select *
from p9_bug_b_results
order by scenario;

do $assert$
declare
  v_failed integer;
begin
  select count(*) into v_failed
  from p9_bug_b_results
  where status <> 'PASS';

  if v_failed <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_REACTIVE_WHATSAPP_MANUAL_CHECKS_FAILED: failed_scenarios=' || v_failed::text;
  end if;

  raise notice 'P9 BUG B REACTIVE WHATSAPP: failed_scenarios=0';
end;
$assert$;

rollback;
