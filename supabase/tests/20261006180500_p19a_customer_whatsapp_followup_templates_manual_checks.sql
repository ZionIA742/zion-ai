begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public;

-- ============================================================================
-- P19-A 4.5.2
-- Customer WhatsApp canonical follow-up templates - behavior runner
--
-- Self-contained DEV runner:
-- - creates an isolated tenant/store/customer/lead/conversation fixture;
-- - creates messages ONLY through public.insert_message();
-- - exercises reader, claim, lease recovery, fail-closed identity checks,
--   final pre-provider authority and processing -> uncertain linearization;
-- - rolls every fixture mutation back.
-- ============================================================================

do $preflight$
begin
  if pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_followups') is null
     or pg_catalog.to_regclass('public.ai_sales_action_queue') is null
     or pg_catalog.to_regclass('public.external_integrations') is null
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regprocedure(
          'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.get_template_required_canonical_followups_by_system(uuid,uuid,integer,integer)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.claim_template_required_canonical_followup_by_system(uuid,uuid,uuid,integer)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.validate_or_cancel_whatsapp_template_followup_send_by_system(uuid,uuid,uuid,text)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.is_real_whatsapp_conversation_for_external_send(uuid,uuid,uuid)'
        ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_BEHAVIOR_PRECONDITION_MISSING';
  end if;

  if exists (
    select 1
    from public.organizations
    where id = '45020000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_RESERVED_FIXTURE_ID_ALREADY_EXISTS';
  end if;
end;
$preflight$;

create temporary table p19a_4_5_2_fixture_ids (
  fixture_key text primary key,
  fixture_id uuid not null
) on commit drop;

-- ============================================================================
-- 1. Isolated commercial identity
-- ============================================================================

insert into public.organizations (
  id,
  name,
  subscription_status
)
values (
  '45020000-0000-4000-8000-000000000001'::uuid,
  'P19A 4.5.2 behavior runner',
  'trial'
);

insert into public.stores (
  id,
  organization_id,
  name
)
values (
  '45020000-0000-4000-8000-000000000002'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  'P19A 4.5.2 store'
);

insert into public.customers (
  id,
  organization_id,
  display_name,
  normalized_name
)
values (
  '45020000-0000-4000-8000-000000000003'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  'P19A Template Customer',
  'p19a template customer'
);

insert into public.customer_store_links (
  id,
  organization_id,
  store_id,
  customer_id
)
values (
  '45020000-0000-4000-8000-000000000004'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000002'::uuid,
  '45020000-0000-4000-8000-000000000003'::uuid
);

insert into public.leads (
  id,
  organization_id,
  store_id,
  name,
  phone,
  state
)
values (
  '45020000-0000-4000-8000-000000000005'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000002'::uuid,
  'P19A Template Lead',
  '+5511999994502',
  'orcamento'
);

insert into public.lead_customer_links (
  id,
  organization_id,
  store_id,
  lead_id,
  customer_id,
  status,
  source,
  linked_by_actor_type,
  metadata
)
values (
  '45020000-0000-4000-8000-000000000006'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000002'::uuid,
  '45020000-0000-4000-8000-000000000005'::uuid,
  '45020000-0000-4000-8000-000000000003'::uuid,
  'active',
  'system',
  'system',
  '{}'::jsonb
);

insert into public.conversations (
  id,
  organization_id,
  lead_id,
  status
)
values (
  '45020000-0000-4000-8000-000000000007'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000005'::uuid,
  'active'
);

insert into public.commercial_opportunities (
  id,
  organization_id,
  store_id,
  customer_id,
  origin_lead_id,
  primary_conversation_id,
  stage
)
values (
  '45020000-0000-4000-8000-000000000009'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000002'::uuid,
  '45020000-0000-4000-8000-000000000003'::uuid,
  '45020000-0000-4000-8000-000000000005'::uuid,
  '45020000-0000-4000-8000-000000000007'::uuid,
  'orcamento'
);

-- Exactly one active WhatsApp integration for this isolated store.
insert into public.external_integrations (
  id,
  organization_id,
  store_id,
  provider,
  access_token,
  phone_number_id,
  status,
  is_active,
  metadata
)
values (
  '45020000-0000-4000-8000-000000000011'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000002'::uuid,
  'whatsapp',
  'p19a-4-5-2-test-token',
  'p19a-4-5-2-phone-number-id',
  'active',
  true,
  '{}'::jsonb
);

-- ============================================================================
-- 2. Real Meta inbound created through the canonical message writer
-- ============================================================================

do $create_real_inbound$
declare
  v_message public.messages%rowtype;
begin
  select *
  into v_message
  from public.insert_message(
    '45020000-0000-4000-8000-000000000007'::uuid,
    'user',
    'incoming',
    'text',
    'P19A 4.5.2 old real WhatsApp inbound',
    'wamid.P19A452INBOUND',
    null,
    pg_catalog.jsonb_build_object(
      'source', 'meta_whatsapp_webhook',
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'provider', 'meta',
      'phone_number_id', 'p19a-4-5-2-phone-number-id'
    )
  );

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_REAL_INBOUND_INSERT_MESSAGE_FAILED';
  end if;

  update public.messages
  set created_at = pg_catalog.clock_timestamp() - interval '25 hours'
  where id = v_message.id;

  insert into pg_temp.p19a_4_5_2_fixture_ids(fixture_key, fixture_id)
  values ('real_inbound', v_message.id);
end;
$create_real_inbound$;

-- ============================================================================
-- 3. Active follow-up + exact canonical queue identity
-- ============================================================================

insert into public.commercial_opportunity_followups (
  id,
  organization_id,
  store_id,
  commercial_opportunity_id,
  cycle,
  status,
  started_at
)
values (
  '45020000-0000-4000-8000-000000000013'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000002'::uuid,
  '45020000-0000-4000-8000-000000000009'::uuid,
  1,
  'active',
  pg_catalog.clock_timestamp() - interval '2 hours'
);

insert into public.ai_sales_action_queue (
  id,
  organization_id,
  store_id,
  conversation_id,
  ai_run_id,
  next_action,
  action_key,
  payload,
  enqueued_at
)
values (
  '45020000-0000-4000-8000-000000000014'::uuid,
  '45020000-0000-4000-8000-000000000001'::uuid,
  '45020000-0000-4000-8000-000000000002'::uuid,
  '45020000-0000-4000-8000-000000000007'::uuid,
  '45020000-0000-4000-8000-000000000015'::uuid,
  'followup_offer',
  'p19a_4_5_2_followup_offer',
  pg_catalog.jsonb_build_object(
    'commercial_opportunity_id',
      '45020000-0000-4000-8000-000000000009',
    'followup_id',
      '45020000-0000-4000-8000-000000000013',
    'followup_cycle',
      '1',
    'followup_operation_key',
      'p19a_4_5_2_operation'
  ),
  pg_catalog.clock_timestamp() - interval '1 hour'
);

-- ============================================================================
-- 4. Canonical outbound fixtures, also created only through insert_message()
-- ============================================================================

do $create_outbound_fixtures$
declare
  v_message public.messages%rowtype;
begin
  select *
  into v_message
  from public.insert_message(
    '45020000-0000-4000-8000-000000000007'::uuid,
    'ai',
    'outgoing',
    'text',
    'P19A 4.5.2 canonical follow-up',
    null,
    null,
    pg_catalog.jsonb_build_object(
      'source', 'ai_sales_real_handler_followup_offer',
      'handler_key', 'real_handler_followup_offer',
      'execution_mode', 'real',
      'action_queue_id', '45020000-0000-4000-8000-000000000014',
      'commercial_opportunity_id', '45020000-0000-4000-8000-000000000009',
      'followup_id', '45020000-0000-4000-8000-000000000013',
      'followup_cycle', '1',
      'followup_operation_key', 'p19a_4_5_2_operation',
      'send_external', true,
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'outbound_kind', 'canonical_followup',
      'outbound_origin', 'canonical_followup',
      'whatsapp_detected_from_conversation', true,
      'outbound_idempotency_key', 'p19a_4_5_2_canonical_followup'
    )
  );

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_CANONICAL_INSERT_MESSAGE_FAILED';
  end if;

  update public.messages
  set
    created_at = pg_catalog.clock_timestamp() - interval '30 minutes',
    outbound_idempotency_key = 'p19a_4_5_2_canonical_followup',
    outbound_delivery_state = 'template_required',
    outbound_claimed_at = null,
    outbound_claimed_by = null,
    outbound_attempt_started_at = null,
    outbound_provider_accepted_at = null,
    outbound_uncertain_at = null,
    outbound_error_text = null,
    external_message_id = null
  where id = v_message.id;

  insert into pg_temp.p19a_4_5_2_fixture_ids(fixture_key, fixture_id)
  values ('eligible', v_message.id);

  select *
  into v_message
  from public.insert_message(
    '45020000-0000-4000-8000-000000000007'::uuid,
    'ai',
    'outgoing',
    'text',
    'P19A 4.5.2 deliberately ineligible canonical follow-up',
    null,
    null,
    pg_catalog.jsonb_build_object(
      'source', 'ai_sales_real_handler_followup_offer',
      'handler_key', 'real_handler_followup_offer',
      'execution_mode', 'real',
      'action_queue_id', '45020000-0000-4000-8000-000000000014',
      'commercial_opportunity_id', '45020000-0000-4000-8000-000000000009',
      'followup_id', '45020000-0000-4000-8000-000000000013',
      'followup_cycle', '1',
      'followup_operation_key', 'p19a_4_5_2_operation',
      'send_external', false,
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'outbound_kind', 'canonical_followup',
      'outbound_origin', 'canonical_followup',
      'outbound_idempotency_key', 'p19a_4_5_2_ineligible'
    )
  );

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_INELIGIBLE_INSERT_MESSAGE_FAILED';
  end if;

  update public.messages
  set
    created_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    outbound_idempotency_key = 'p19a_4_5_2_ineligible',
    outbound_delivery_state = 'template_required',
    outbound_claimed_at = null,
    outbound_claimed_by = null,
    outbound_attempt_started_at = null,
    outbound_provider_accepted_at = null,
    outbound_uncertain_at = null,
    outbound_error_text = null,
    external_message_id = null
  where id = v_message.id;

  insert into pg_temp.p19a_4_5_2_fixture_ids(fixture_key, fixture_id)
  values ('ineligible', v_message.id);
end;
$create_outbound_fixtures$;

-- ============================================================================
-- 5. Behavior checks
-- ============================================================================

do $checks$
declare
  v_result jsonb;
  v_count integer;
  v_action text;
  v_state text;
  v_claimed_at timestamptz;
  v_attempt_at timestamptz;
  v_uncertain_at timestamptz;
  v_claimed_by text;
  v_context_link_id uuid;
  v_eligible_message_id uuid;
  v_ineligible_message_id uuid;
begin
  select fixture_id into v_eligible_message_id
  from pg_temp.p19a_4_5_2_fixture_ids
  where fixture_key = 'eligible';

  select fixture_id into v_ineligible_message_id
  from pg_temp.p19a_4_5_2_fixture_ids
  where fixture_key = 'ineligible';

  if v_eligible_message_id is null or v_ineligible_message_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_MESSAGE_FIXTURE_IDS_MISSING';
  end if;

  -- insert_message must have captured the canonical commercial context.
  select commercial_session_context_link_id
  into v_context_link_id
  from public.messages
  where id = v_eligible_message_id;

  if v_context_link_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_CANONICAL_CONTEXT_NOT_CAPTURED';
  end if;

  -- The isolated conversation must be proven as real Meta WhatsApp.
  if not public.is_real_whatsapp_conversation_for_external_send(
    '45020000-0000-4000-8000-000000000001'::uuid,
    '45020000-0000-4000-8000-000000000002'::uuid,
    '45020000-0000-4000-8000-000000000007'::uuid
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_REAL_WHATSAPP_FIXTURE_INVALID';
  end if;

  -- Reader includes only the eligible canonical follow-up.
  select pg_catalog.count(*)
  into v_count
  from public.get_template_required_canonical_followups_by_system(
    '45020000-0000-4000-8000-000000000001'::uuid,
    '45020000-0000-4000-8000-000000000002'::uuid,
    50,
    600
  ) candidate
  where candidate.message_id in (
    v_eligible_message_id,
    v_ineligible_message_id
  );

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_READER_ELIGIBILITY_FAILED';
  end if;

  select candidate.template_action
  into v_action
  from public.get_template_required_canonical_followups_by_system(
    '45020000-0000-4000-8000-000000000001'::uuid,
    '45020000-0000-4000-8000-000000000002'::uuid,
    50,
    600
  ) candidate
  where candidate.message_id = v_eligible_message_id;

  if v_action is distinct from 'followup_offer' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_OFFER_TEMPLATE_ACTION_FAILED';
  end if;

  -- Reader derives visit from the queue authority.
  update public.ai_sales_action_queue
  set next_action = 'followup_visit'
  where id = '45020000-0000-4000-8000-000000000014'::uuid;

  update public.messages
  set metadata =
    metadata || pg_catalog.jsonb_build_object(
      'source', 'ai_sales_real_handler_followup_visit',
      'handler_key', 'real_handler_followup_visit'
    )
  where id = v_eligible_message_id;

  select candidate.template_action
  into v_action
  from public.get_template_required_canonical_followups_by_system(
    '45020000-0000-4000-8000-000000000001'::uuid,
    '45020000-0000-4000-8000-000000000002'::uuid,
    50,
    600
  ) candidate
  where candidate.message_id = v_eligible_message_id;

  if v_action is distinct from 'followup_visit' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_VISIT_TEMPLATE_ACTION_FAILED';
  end if;

  -- Restore offer authority.
  update public.ai_sales_action_queue
  set next_action = 'followup_offer'
  where id = '45020000-0000-4000-8000-000000000014'::uuid;

  update public.messages
  set metadata =
    metadata || pg_catalog.jsonb_build_object(
      'source', 'ai_sales_real_handler_followup_offer',
      'handler_key', 'real_handler_followup_offer'
    )
  where id = v_eligible_message_id;

  -- Valid atomic claim.
  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      600
    );

  if (v_result ->> 'claimed') is distinct from 'true'
     or (v_result ->> 'reason') is distinct from 'claimed'
     or (v_result ->> 'template_action') is distinct from 'followup_offer' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_VALID_CLAIM_FAILED';
  end if;

  select outbound_delivery_state, outbound_claimed_at
  into v_state, v_claimed_at
  from public.messages
  where id = v_eligible_message_id;

  if v_state is distinct from 'processing'
     or v_claimed_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_CLAIM_TRANSITION_FAILED';
  end if;

  -- Second claim inside the lease must not resend.
  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      600
    );

  if (v_result ->> 'claimed') is distinct from 'false'
     or (v_result ->> 'reason')
          is distinct from 'message_not_template_followup_claimable' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_SECOND_CLAIM_LEASE_FAILED';
  end if;

  -- Stale processing with no provider attempt is recoverable.
  update public.messages
  set
    outbound_delivery_state = 'processing',
    outbound_claimed_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    outbound_claimed_by =
      'whatsapp-template-cron:45020000-0000-4000-8000-000000000001:45020000-0000-4000-8000-000000000002',
    outbound_attempt_started_at = null,
    outbound_provider_accepted_at = null,
    outbound_uncertain_at = null,
    outbound_error_text = null
  where id = v_eligible_message_id;

  select pg_catalog.count(*)
  into v_count
  from public.get_template_required_canonical_followups_by_system(
    '45020000-0000-4000-8000-000000000001'::uuid,
    '45020000-0000-4000-8000-000000000002'::uuid,
    50,
    60
  ) candidate
  where candidate.message_id = v_eligible_message_id;

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_STALE_READER_RECOVERY_FAILED';
  end if;

  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      60
    );

  if (v_result ->> 'claimed') is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_STALE_CLAIM_RECOVERY_FAILED';
  end if;

  -- Attempt-started processing is never recoverable.
  update public.messages
  set
    outbound_delivery_state = 'processing',
    outbound_claimed_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    outbound_claimed_by =
      'whatsapp-template-cron:45020000-0000-4000-8000-000000000001:45020000-0000-4000-8000-000000000002',
    outbound_attempt_started_at =
      pg_catalog.clock_timestamp() - interval '1 minute',
    outbound_provider_accepted_at = null,
    outbound_uncertain_at = null
  where id = v_eligible_message_id;

  select pg_catalog.count(*)
  into v_count
  from public.get_template_required_canonical_followups_by_system(
    '45020000-0000-4000-8000-000000000001'::uuid,
    '45020000-0000-4000-8000-000000000002'::uuid,
    50,
    60
  ) candidate
  where candidate.message_id = v_eligible_message_id;

  if v_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_ATTEMPT_STARTED_READER_REENTRY_FAILED';
  end if;

  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      60
    );

  if (v_result ->> 'claimed') is distinct from 'false'
     or (v_result ->> 'reason')
          is distinct from 'message_not_template_followup_eligible' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_ATTEMPT_STARTED_CLAIM_REENTRY_FAILED';
  end if;

  -- Provider-accepted state can never re-enter blind send.
  update public.messages
  set
    outbound_delivery_state = 'processing',
    outbound_claimed_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    outbound_claimed_by =
      'whatsapp-template-cron:45020000-0000-4000-8000-000000000001:45020000-0000-4000-8000-000000000002',
    outbound_attempt_started_at = null,
    outbound_provider_accepted_at =
      pg_catalog.clock_timestamp() - interval '1 minute',
    outbound_uncertain_at = null
  where id = v_eligible_message_id;

  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      60
    );

  if (v_result ->> 'claimed') is distinct from 'false'
     or (v_result ->> 'reason')
          is distinct from 'message_not_template_followup_eligible' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_PROVIDER_ACCEPTED_REENTRY_FAILED';
  end if;

  -- Uncertain state can never re-enter blind send.
  update public.messages
  set
    outbound_delivery_state = 'uncertain',
    outbound_claimed_at = null,
    outbound_claimed_by = null,
    outbound_attempt_started_at =
      pg_catalog.clock_timestamp() - interval '1 minute',
    outbound_provider_accepted_at = null,
    outbound_uncertain_at =
      pg_catalog.clock_timestamp() - interval '1 minute'
  where id = v_eligible_message_id;

  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      60
    );

  if (v_result ->> 'claimed') is distinct from 'false'
     or (v_result ->> 'reason')
          is distinct from 'message_not_template_followup_eligible' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_UNCERTAIN_REENTRY_FAILED';
  end if;

  -- Reset before authority mismatch checks.
  update public.messages
  set
    outbound_delivery_state = 'template_required',
    outbound_claimed_at = null,
    outbound_claimed_by = null,
    outbound_attempt_started_at = null,
    outbound_provider_accepted_at = null,
    outbound_uncertain_at = null,
    outbound_error_text = null,
    external_message_id = null,
    metadata =
      metadata || pg_catalog.jsonb_build_object(
        'source', 'ai_sales_real_handler_followup_offer',
        'handler_key', 'real_handler_followup_offer'
      )
  where id = v_eligible_message_id;

  -- Queue/action mismatch fails closed at claim.
  update public.ai_sales_action_queue
  set next_action = 'followup_visit'
  where id = '45020000-0000-4000-8000-000000000014'::uuid;

  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      600
    );

  if (v_result ->> 'claimed') is distinct from 'false'
     or (v_result ->> 'reason')
          is distinct from 'canonical_followup_template_identity_mismatch' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_QUEUE_ACTION_MISMATCH_FAILED';
  end if;

  -- Follow-up identity mismatch fails closed at claim.
  update public.ai_sales_action_queue
  set
    next_action = 'followup_offer',
    payload =
      payload || pg_catalog.jsonb_build_object(
        'followup_id', '45020000-0000-4000-8000-000000000099'
      )
  where id = '45020000-0000-4000-8000-000000000014'::uuid;

  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      600
    );

  if (v_result ->> 'claimed') is distinct from 'false'
     or (v_result ->> 'reason')
          is distinct from 'canonical_followup_template_identity_mismatch' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_FOLLOWUP_IDENTITY_MISMATCH_FAILED';
  end if;

  -- Restore exact queue identity.
  update public.ai_sales_action_queue
  set
    next_action = 'followup_offer',
    payload = pg_catalog.jsonb_build_object(
      'commercial_opportunity_id',
        '45020000-0000-4000-8000-000000000009',
      'followup_id',
        '45020000-0000-4000-8000-000000000013',
      'followup_cycle',
        '1',
      'followup_operation_key',
        'p19a_4_5_2_operation'
    )
  where id = '45020000-0000-4000-8000-000000000014'::uuid;

  -- Claim validly, then change action before final send gate.
  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      600
    );

  if (v_result ->> 'claimed') is distinct from 'true' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_PRE_GATE_CLAIM_FAILED';
  end if;

  update public.ai_sales_action_queue
  set next_action = 'followup_visit'
  where id = '45020000-0000-4000-8000-000000000014'::uuid;

  v_result :=
    public.validate_or_cancel_whatsapp_template_followup_send_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      'followup_offer'
    );

  if (v_result ->> 'decision') is distinct from 'blocked'
     or (v_result ->> 'reason')
          is distinct from 'template_action_changed_before_send' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_CHANGED_ACTION_FINAL_GATE_FAILED';
  end if;

  select outbound_delivery_state
  into v_state
  from public.messages
  where id = v_eligible_message_id;

  if v_state is distinct from 'failed' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_BLOCKED_GATE_NOT_TERMINAL_FAILED';
  end if;

  -- Restore exact authority for successful final linearization.
  update public.ai_sales_action_queue
  set next_action = 'followup_offer'
  where id = '45020000-0000-4000-8000-000000000014'::uuid;

  update public.messages
  set
    outbound_delivery_state = 'template_required',
    outbound_claimed_at = null,
    outbound_claimed_by = null,
    outbound_attempt_started_at = null,
    outbound_provider_accepted_at = null,
    outbound_uncertain_at = null,
    outbound_error_text = null,
    external_message_id = null,
    metadata =
      metadata || pg_catalog.jsonb_build_object(
        'source', 'ai_sales_real_handler_followup_offer',
        'handler_key', 'real_handler_followup_offer'
      )
  where id = v_eligible_message_id;

  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      600
    );

  if (v_result ->> 'claimed') is distinct from 'true'
     or (v_result ->> 'template_action') is distinct from 'followup_offer' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_FINAL_VALID_CLAIM_FAILED';
  end if;

  v_result :=
    public.validate_or_cancel_whatsapp_template_followup_send_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      'followup_offer'
    );

  if (v_result ->> 'decision') is distinct from 'send'
     or (v_result ->> 'reason') is distinct from 'authorized' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_VALID_FINAL_GATE_FAILED';
  end if;

  select
    outbound_delivery_state,
    outbound_attempt_started_at,
    outbound_uncertain_at,
    outbound_claimed_by
  into
    v_state,
    v_attempt_at,
    v_uncertain_at,
    v_claimed_by
  from public.messages
  where id = v_eligible_message_id;

  if v_state is distinct from 'uncertain'
     or v_attempt_at is null
     or v_uncertain_at is null
     or v_claimed_by is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_PRE_PROVIDER_LINEARIZATION_FAILED';
  end if;

  -- The final uncertain state itself must remain non-retryable.
  v_result :=
    public.claim_template_required_canonical_followup_by_system(
      '45020000-0000-4000-8000-000000000001'::uuid,
      '45020000-0000-4000-8000-000000000002'::uuid,
      v_eligible_message_id,
      60
    );

  if (v_result ->> 'claimed') is distinct from 'false'
     or (v_result ->> 'reason')
          is distinct from 'message_not_template_followup_eligible' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_POST_LINEARIZATION_REENTRY_FAILED';
  end if;
end;
$checks$;

rollback;

-- ============================================================================
-- 6. Prove no isolated fixture persisted
-- ============================================================================

do $rollback_check$
begin
  if exists (
    select 1
    from public.organizations
    where id = '45020000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_4_5_2_ROLLBACK_FAILED';
  end if;
end;
$rollback_check$;

select
  'PASS'::text as result,
  'P19A_4_5_2_CUSTOMER_WHATSAPP_FOLLOWUP_TEMPLATES'::text as suite,
  'ROLLBACK_CONFIRMED'::text as persistence;
