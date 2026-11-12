begin;

do $checks$
declare
  v_definition text;
  v_gate text;
  v_atomic_gate text;
  v_materialize text;
  v_finalize text;
begin
  select pg_get_functiondef('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::regprocedure)
    into v_definition;
  if v_definition not like '%sales_contract_send%'
     or v_definition not like '%message_type = ''document''%' then
    raise exception using message = 'P9_9_3_READER_CONTRACT_DOCUMENT_NOT_PROVEN';
  end if;
  if v_definition not like '%crm_manual_audio%audio%'
     or v_definition not like '%crm_manual_video%video%' then
    raise exception using message = 'P9_9_3_READER_MANUAL_MEDIA_NOT_PROVEN';
  end if;
  if v_definition like '%sales_quote_send%audio%'
     or v_definition like '%sales_quote_send%video%'
     or v_definition like '%sender = ''ai''%audio%'
     or v_definition like '%sender = ''ai''%video%' then
    raise exception using message = 'P9_9_3_READER_QUOTE_OR_AI_MEDIA_EXPANSION';
  end if;
  if v_definition not like '%organization_id = p_organization_id%'
     or v_definition not like '%store_id = p_store_id%'
     or v_definition not like '%outbound_delivery_state = ''processing''%'
     or v_definition not like '%outbound_attempt_started_at is null%' then
    raise exception using message = 'P9_9_3_READER_SCOPE_OR_STALE_LEASE_NOT_PROVEN';
  end if;

  select pg_get_functiondef('public.validate_sales_contract_send_before_external_by_system(uuid,uuid,uuid)'::regprocedure)
    into v_gate;
  if v_gate not like '%p9_assert_sales_contract_current_proposal_lineage_internal%'
     or v_gate not like '%message_identity_invalid%'
     or v_gate not like '%current_proposal_replaced%'
     or v_gate not like '%application/pdf%'
     or v_gate not like '%outbound_delivery_state is distinct from ''uncertain''%'
     or v_gate not like '%outbound_attempt_started_at is null%'
     or v_gate not like '%for update%' then
    raise exception using message = 'P9_9_3_CONTRACT_PRE_EXTERNAL_GATE_NOT_PROVEN';
  end if;

  if position('from public.sales_contracts' in v_gate)
       = 0
     or position('from public.sales_contract_versions' in v_gate)
       <= position('from public.sales_contracts' in v_gate)
     or position('and deleted_at is null' in v_gate)
       <= position('from public.sales_contract_versions' in v_gate) then
    raise exception using message = 'P9_9_3_CONTRACT_GATE_LOCK_ORDER_NOT_PROVEN';
  end if;

  select pg_get_functiondef('public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)'::regprocedure)
    into v_atomic_gate;
  if v_atomic_gate not like '%read_customer_whatsapp_24h_window_by_system%'
     or v_atomic_gate not like '%private_acquire_sales_contract_conversation_xact_lock%'
     or v_atomic_gate not like '%from public.sales_contracts%'
     or v_atomic_gate not like '%from public.sales_contract_versions%'
     or v_atomic_gate not like '%outbound_delivery_state=''uncertain''%'
     or v_atomic_gate not like '%outbound_attempt_started_at=clock_timestamp()%'
     or v_atomic_gate not like '%p9_assert_sales_contract_current_proposal_lineage_internal%'
     or v_atomic_gate not like '%outbound_delivery_state=''processing''%'
     or v_atomic_gate not like '%outbound_attempt_started_at is null%' then
    raise exception using message = 'P9_9_3_ATOMIC_GATE_NOT_PROVEN';
  end if;
  if position('from public.sales_contracts' in v_atomic_gate)
       = 0
     or position('from public.sales_contract_versions' in v_atomic_gate)
       <= position('from public.sales_contracts' in v_atomic_gate)
     or position('private_acquire_sales_contract_conversation_xact_lock' in v_atomic_gate)
       <= position('from public.sales_contract_versions' in v_atomic_gate) then
    raise exception using message = 'P9_9_3_ATOMIC_GATE_LOCK_ORDER_NOT_PROVEN';
  end if;

  select pg_get_functiondef('public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'::regprocedure)
    into v_materialize;
  if v_materialize not like '%p9_assert_sales_contract_current_proposal_lineage_internal%'
     or v_materialize not like '%for update%'
     or v_materialize not like '%outbound_idempotency_key%'
     or v_materialize not like '%outcome%'
     or v_materialize not like '%media_url%'
     or v_materialize not like '%document%'
     or v_materialize not like '%already_sent%'
     or v_materialize not like '%uncertain%'
     or v_materialize not like '%failed%'
     or v_materialize not like '%EXISTING_MESSAGE_SCOPE_MISMATCH%'
     or v_materialize not like '%p_actor_user_id%'
     or v_materialize not like '%sent_by_user_id%'
     or v_materialize not like '%returning * into m%' then
    raise exception using message = 'P9_9_3_MATERIALIZER_POSTCONDITION_FAILED';
  end if;

  select pg_get_functiondef('public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure)
    into v_finalize;
  if v_finalize not like '%outbound_delivery_state <> ''sent''%'
     or v_finalize not like '%outbound_provider_accepted_at is null%'
     or v_finalize not like '%outbound_commercial_finalized_at%'
     or v_finalize not like '%conversation_events%'
     or v_finalize not like '%sales_contract_versions%'
     or v_finalize not like '%EXTERNAL_EVIDENCE_REQUIRED%'
     or v_finalize not like '%PREVIOUS_STATE_INVALID%'
     or v_finalize not like '%VERSION_FINALIZATION_FAILED%'
     or v_finalize not like '%CONTRACT_FINALIZATION_FAILED%'
     or v_finalize not like '%returning * into v%'
     or v_finalize not like '%returning * into c%'
     or v_finalize not like '%already_finalized%'
     or v_finalize not like '%sent_by=(m.metadata->>''sent_by_user_id'')::uuid%'
     or v_finalize like '%sent_by=null%' then
    raise exception using message = 'P9_9_3_FINALIZER_POSTCONDITION_FAILED';
  end if;

  if v_definition not like '%sales_quote_send%'
     or v_definition not like '%sender = ''ai''%'
     or v_definition not like '%crm_manual_audio%'
     or v_definition not like '%crm_manual_video%' then
    raise exception using message = 'P9_9_3_READER_ORIGIN_PARTITIONS_NOT_PROVEN';
  end if;

  if has_function_privilege('authenticated', 'public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)', 'EXECUTE') then
    raise exception using message = 'P9_9_3_AUTHENTICATED_EXECUTE_UNEXPECTED';
  end if;
end
$checks$;

rollback;
