import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputPath = "supabase/homologation/20261124220000_p10_9_b_commercial_memory_integrated_runner.sql";

const runner = String.raw`-- MICROETAPA 10.9-B
-- Homologacao integrada da memoria comercial persistente.
--
-- Este runner usa somente RPCs canonicas ja instaladas. Nao recria migrations,
-- tabelas ou funcoes publicas. Cria fixtures sintéticas pelos writers canônicos,
-- altera metadata/eventos somente dentro da subtransacao controlada e reverte
-- tudo por excecao sentinela.
-- O contexto administrativo permanece no papel SQL postgres; nao se injeta
-- claim JWT service_role artificial. Organizações sintéticas usam past_due para
-- provar que nenhum enfileiramento da IA e alcancado.
-- Runner candidato: modo preflight por padrao; nenhuma fixture e escrita.
-- Execucao funcional requer revisao e autorizacao separadas.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop table if exists pg_temp.p10_9_b_results;
create temp table p10_9_b_results (
  test_name text not null,
  verdict text not null,
  details text not null
) on commit preserve rows;

do $runner$
declare
  v_contracts_ok boolean := false;
  v_execute_fixture constant boolean := false; -- Explicit opt-in only after review.
  v_message_count bigint := 0;
  v_extra_side_effects bigint := 0;
  v_extra_residues bigint := 0;
  v_audio_update_count bigint := 0;
  v_fixture record;
  v_foreign_opportunity record;
  v_text_write record;
  v_text_replay record;
  v_audio_write record;
  v_correction_write record;
  v_promoted_write record;
  v_promoted_replay record;
  v_event record;
  v_canonical record;
  v_audio_metadata_before jsonb;
  v_audio_metadata_after jsonb;
  v_test_prefix text := 'p10_9_b_homologation:' || gen_random_uuid()::text;
  v_text_event_id uuid;
  v_audio_event_id uuid;
  v_correction_supersedes uuid;
  v_events_read integer := 0;
  v_text_events_read integer := 0;
  v_audio_events_read integer := 0;
  v_conflict_events_read integer := 0;
  v_promoted_count integer := 0;
  v_event_before bigint := 0;
  v_event_after bigint := 0;
  v_qevent_before bigint := 0;
  v_qevent_after bigint := 0;
  v_qcurrent_before bigint := 0;
  v_qcurrent_after bigint := 0;
  v_test_event_after bigint := 0;
  v_test_qevent_after bigint := 0;
  v_fixture_message_scope_mismatches bigint := 0;
  v_synthetic_after bigint := 0;
  v_promotion_event_count bigint := 0;
  v_promotion_first_id uuid;
  v_promotion_replay_id uuid;
  v_promotion_first_outcome text;
  v_promotion_replay_outcome text;
  v_functional_pass boolean := false;
  v_subtransaction_rolled_back boolean := false;
  v_persistence_pass boolean := false;
  v_recovery_pass boolean := false;
  v_idempotency_pass boolean := false;
  v_promotion_pass boolean := false;
  v_scope_pass boolean := false;
  v_rollback_pass boolean := false;
  v_sqlstate text;
  v_scope_sqlstate text;
  v_scope_error text;
  v_external_trigger_functions text;
  v_dependency_functions text;
  v_ai_queue_before bigint := 0;
  v_ai_queue_during bigint := 0;
  v_ai_queue_after bigint := 0;
  v_sales_queue_before bigint := 0;
  v_sales_queue_during bigint := 0;
  v_sales_queue_after bigint := 0;
  v_assistant_queue_before bigint := 0;
  v_assistant_queue_during bigint := 0;
  v_assistant_queue_after bigint := 0;
  v_ai_enqueue_pass boolean := false;
  v_p98_branch_pass boolean := false;
  v_error text;
  v_observed text;
  v_details text := 'ensaio nao concluido';
begin
  -- 10.9-B.17: pinned remote evidence, not a name/substring allowlist.
  v_contracts_ok := session_user = 'postgres' and current_user = 'postgres'
    and coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'postgres')
    and coalesce(current_setting('request.jwt.claim.role', true), '') = ''
    and coalesce(current_setting('request.jwt.claims', true), '') in ('', '{}');
  if not v_contracts_ok then
    insert into pg_temp.p10_9_b_results values
      ('execution_context', 'BLOQUEADO', 'contexto administrativo postgres sem claims exigido');
  end if;

  with expected(signature, definition_md5, expected_owner) as (values
      ('public.ai_enqueue_sales_decision_for_conversation(uuid,uuid,uuid)', 'ebe154b69425110a2e0738a135825b66', 'postgres'),
      ('public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', '71e711cd8221091fdcd373ccc731b98e', 'postgres'),
      ('public.assert_commercial_opportunity_message_evidence(uuid,uuid,uuid,uuid,uuid)', '1535edd917415c58536675e9087bfa8b', 'postgres'),
      ('public.autofill_delivered_at_from_read_at()', 'ca11db32ba6aa02eab857a78a3ddbd9e', 'postgres'),
      ('public.block_delete_conversation_state()', '755786bbd2d0a45204b192f2988014cc', 'postgres'),
      ('public.block_direct_human_flag_update()', 'b018a7094d531a470e556609e76e1af1', 'postgres'),
      ('public.block_direct_messages_insert()', 'd7c839e822d281b909e4fd9cff7b54de', 'postgres'),
      ('public.block_direct_state_update()', '70361959671ae49a3cc21e4a09dd2cdf', 'postgres'),
      ('public.block_org_change_in_conversation_states()', '9d01efd9cd784dec01eaa8f7c39b72d7', 'postgres'),
      ('public.can_ai_reply_now(uuid,uuid,uuid)', 'dfb487581b881a4cee9c1aa3510cb084', 'postgres'),
      ('public.can_ai_reply_subscription_guard(uuid)', 'e30efa886df548c7c8fe07aa94deac8a', 'postgres'),
      ('public.capture_zion_admin_operational_failure_transition()', 'cbbe1b392eb0ce52ab7138669d451a93', null::text),
      ('public.conversation_session_apply_write_rules()', '4ec7a0defd01637a13a96f2129af8e7a', 'postgres'),
      ('public.create_initial_conversation_state()', '0e30ca7fe5c69990a41352254035d9f1', 'postgres'),
      ('public.enforce_commercial_opportunity_lifecycle_projection()', '7d61a18534e53236b0cf950e9af9e56e', 'postgres'),
      ('public.enforce_commercial_opportunity_loss_stage_transition()', '7d02a9fee01ef40928dc6bcc794c167e', 'postgres'),
      ('public.enforce_commercial_session_context_link_write_rules()', '446c1e4408c7b400e05bb376b2907ba0', 'postgres'),
      ('public.enforce_conversation_ai_window_state_canonical_scope()', 'ea8231a4364eb9c674dfa5b1c361913a', 'postgres'),
      ('public.enforce_conversation_org_integrity()', 'af7b1c6e6401602fab0dedea9b9d6590', 'postgres'),
      ('public.enforce_lead_customer_link_write_rules()', '757a9b212cf24da07e1b804b8c14c6c1', 'postgres'),
      ('public.enforce_state_transition_log_organization_scope()', 'a9ad2b9d63f36dda430053ac4b1d9ff0', 'postgres'),
      ('public.enforce_state_transition_log_store_scope()', 'd820a916d27457c7cf7a68b53fc5c17c', 'postgres'),
      ('public.enqueue_assistant_operational_task_after_incoming_message()', 'dcdc4ceb8e820a350c5a29cb0b64c3c4', 'postgres'),
      ('public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)', 'f06fa067e28d6f2aea232faf0d587c47', 'postgres'),
      ('public.fill_messages_lead_store_from_conversation()', 'e154ca5a02dd5235ed80c590934be1fe', 'postgres'),
      ('public.guard_conversation_ai_window_state_parent_conversation()', '63b26bf565e069fdc63a28fff6f2bd25', 'postgres'),
      ('public.guard_conversation_ai_window_state_parent_lead()', 'fd9b0bdd440e8e8fe9aac8c45a4b601e', 'postgres'),
      ('public.insert_message(uuid,text,text,text,text,text,text,jsonb)', 'd9c05b605ddc3ba37d8b51579df12361', 'postgres'),
      ('public.lead_customer_link_request_role()', 'bbed5ee526390b36bc8ddb1ec74a2f1f', 'postgres'),
      ('public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)', 'accc6dab7af9070ed92c15cb5963a1a7', 'postgres'),
      ('public.link_lead_to_customer(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,uuid,jsonb,timestamp with time zone)', '24fbca697a615f86d5356798d59fa693', 'postgres'),
      ('public.normalize_and_validate_lead_state()', 'e531807217172c88bedf352dfe433de7', 'postgres'),
      ('public.normalize_conversation_status_aliases()', '2bf19c479cf2902e485dc92cc2f1571b', 'postgres'),
      ('public.p10_7_a1_4b_preserve_delivered_human_response_alert()', '01a0ef0fbd0bc958f78d02570e9e369d', null::text),
      ('public.p9_8_5_finalize_concession_after_quote_send_trigger()', '13000a1e8b7b174cdcf73a77fc398ea0', 'postgres'),
      ('public.p9_guard_contract_send_current_proposal_change()', 'ae7de1ab1a08176654d92123bf8fde71', 'postgres'),
      ('public.p9_guard_sales_contract_send_message()', 'c49a129021cecc81741fcd2591b1cd04', 'postgres'),
      ('public.p9_qfact_prevent_event_mutation()', 'a4563d51855367eba26aa4dfe863d84e', 'postgres'),
      ('public.p9_qfact_touch_current_updated_at()', 'c3c2c5d50cb069d5c36990d9d1dc7968', 'postgres'),
      ('public.p9_qfact_validate_current_projection()', 'b696d4ed053c29219548fe43ad797b88', 'postgres'),
      ('public.prevent_commercial_conversation_fact_event_mutation()', '8023099c74ded63d7f0121f29b6cd90e', 'postgres'),
      ('public.prevent_commercial_opportunity_core_change()', '81e7d2d23f09c9ae493982e8746d1282', 'postgres'),
      ('public.prevent_conversation_session_core_change()', '038e2b81a153b22c200174405b13023b', 'postgres'),
      ('public.prevent_customer_identity_organization_change()', '5ba1d201d85af32873dda89364bb902c', 'postgres'),
      ('public.prevent_delivered_at_reset()', '2969ffe5ed03d27f9e1fc0a617e9b1c4', 'postgres'),
      ('public.prevent_read_at_reset()', '40a3d224d83317fb5ff191f63059b0cc', 'postgres'),
      ('public.private_acquire_sales_contract_conversation_xact_lock(uuid)', 'a5828f3d3d8a5ddb6bd5567106e02a5e', 'postgres'),
      ('public.private_sales_contract_conversation_lock_key(uuid)', 'cd13cf6bb48af30d7965dffe10ff3b95', 'postgres'),
      ('public.read_commercial_conversation_fact_events_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'f5bec07b5231aea04e2e6b0c2c2b41d8', 'postgres'),
      ('public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)', '3b10fd66d569e2c0f6a5c1896a1d06c1', 'postgres'),
      ('public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)', 'c3d6a7c23938b8ee2f7b48433baa5a11', 'postgres'),
      ('public.rebuild_conversation_last_message(uuid)', '83def101e137c055d7e91fc421dac055', 'postgres'),
      ('public.set_current_timestamp_updated_at()', '0ecf9e3798d9ed55a0ae7307d84025f8', null::text),
      ('public.set_updated_at()', '1c3ea071de62c54b535847a852367632', 'postgres'),
      ('public.touch_commercial_opportunity_timestamps()', 'c23b5805a2446d4c64c8bd7904f84add', 'postgres'),
      ('public.touch_customer_identity_updated_at()', '6e3d5827b2812723217abd07440bf152', 'postgres'),
      ('public.trg_conversations_last_message_sync()', '42a22f83d8d97ef441097e9191fb2aba', 'postgres'),
      ('public.trg_enqueue_ai_sales_after_incoming_message()', '34fc78b8739ee40418aaf8262c64ae2d', 'postgres'),
      ('public.trg_log_conversation_status_change()', '27ed00d3f457c2b66f9c7f37e56ff6d7', 'postgres'),
      ('public.write_commercial_conversation_fact_event_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,uuid)', 'f127c12aa4b6355a30904d380217cf7c', 'postgres'),
      ('public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', '261b36a9c94879ded0237b1219d97dff', 'postgres')
  ), checked as (
    select e.*, p.oid, md5(pg_get_functiondef(p.oid)) as observed_md5,
      pg_get_userbyid(p.proowner) as observed_owner
    from expected e left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.signature)
  )
  select string_agg(signature || ': ' || coalesce(observed_md5, 'AUSENTE'), '; ' order by signature)
  into v_dependency_functions
  from checked where observed_md5 is distinct from definition_md5
    or (expected_owner is not null and observed_owner is distinct from expected_owner);
  if v_dependency_functions is not null then
    v_contracts_ok := false;
    insert into pg_temp.p10_9_b_results values
      ('function_hashes', 'BLOQUEADO', v_dependency_functions);
  else
    insert into pg_temp.p10_9_b_results values
      ('function_hashes', 'PASS', 'identidades e MD5 das definicoes conferidos');
  end if;

  with target(name) as (values
      ('public.organizations'),
      ('public.stores'),
      ('public.customers'),
      ('public.customer_store_links'),
      ('public.leads'),
      ('public.lead_customer_links'),
      ('public.conversations'),
      ('public.conversation_sessions'),
      ('public.commercial_opportunities'),
      ('public.commercial_session_context_links'),
      ('public.messages'),
      ('public.conversation_states'),
      ('public.state_transition_log'),
      ('public.commercial_conversation_fact_events'),
      ('public.commercial_opportunity_qualification_fact_events'),
      ('public.commercial_opportunity_qualification_facts_current'),
      ('public.conversation_ai_window_state'),
      ('public.ai_runs'),
      ('public.store_assistant_operational_tasks'),
      ('public.store_assistant_operational_task_queue'),
      ('public.ai_run_queue'),
      ('public.ai_sales_action_queue'),
      ('public.store_assistant_notification_queue'),
      ('public.zion_admin_diagnostic_operational_failure_events'),
      ('public.channel_whatsapp_inbox')
  )
  select string_agg(target.name, ', ' order by target.name) into v_dependency_functions
  from target left join pg_catalog.pg_class c on c.oid = to_regclass(target.name)
  where c.oid is null or c.relkind <> 'r'
    or exists (select 1 from pg_catalog.pg_rewrite w where w.ev_class=c.oid)
    or exists (select 1 from pg_catalog.pg_inherits i where i.inhparent=c.oid or i.inhrelid=c.oid);
  if v_dependency_functions is not null then
    v_contracts_ok := false;
    insert into pg_temp.p10_9_b_results values
      ('table_guard', 'BLOQUEADO', v_dependency_functions);
  else
    insert into pg_temp.p10_9_b_results values
      ('table_guard', 'PASS', 'tabelas ordinarias presentes; sem rewrite rules ou heranca');
  end if;

  with expected(binding, enabled, definition, function_md5) as (values
      ('public.ai_run_queue.zion_admin_capture_ai_queue_failure', 'O', 'CREATE TRIGGER zion_admin_capture_ai_queue_failure AFTER INSERT OR UPDATE OF processing_error, processed_at ON public.ai_run_queue FOR EACH ROW EXECUTE FUNCTION capture_zion_admin_operational_failure_transition()', 'cbbe1b392eb0ce52ab7138669d451a93'),
      ('public.ai_sales_action_queue.zion_admin_capture_sales_action_failure', 'O', 'CREATE TRIGGER zion_admin_capture_sales_action_failure AFTER INSERT OR UPDATE OF processing_error, processed_at ON public.ai_sales_action_queue FOR EACH ROW EXECUTE FUNCTION capture_zion_admin_operational_failure_transition()', 'cbbe1b392eb0ce52ab7138669d451a93'),
      ('public.channel_whatsapp_inbox.zion_admin_capture_whatsapp_failure', 'O', 'CREATE TRIGGER zion_admin_capture_whatsapp_failure AFTER INSERT OR UPDATE OF processing_error, processed_at ON public.channel_whatsapp_inbox FOR EACH ROW EXECUTE FUNCTION capture_zion_admin_operational_failure_transition()', 'cbbe1b392eb0ce52ab7138669d451a93'),
      ('public.commercial_conversation_fact_events.commercial_conversation_fact_events_append_only_trg', 'O', 'CREATE TRIGGER commercial_conversation_fact_events_append_only_trg BEFORE DELETE OR UPDATE ON public.commercial_conversation_fact_events FOR EACH ROW EXECUTE FUNCTION prevent_commercial_conversation_fact_event_mutation()', '8023099c74ded63d7f0121f29b6cd90e'),
      ('public.commercial_opportunities.commercial_opportunities_05_enforce_lifecycle_projection', 'O', 'CREATE TRIGGER commercial_opportunities_05_enforce_lifecycle_projection BEFORE INSERT OR UPDATE ON public.commercial_opportunities FOR EACH ROW EXECUTE FUNCTION enforce_commercial_opportunity_lifecycle_projection()', '7d61a18534e53236b0cf950e9af9e56e'),
      ('public.commercial_opportunities.commercial_opportunities_10_enforce_loss_stage_transition', 'O', 'CREATE TRIGGER commercial_opportunities_10_enforce_loss_stage_transition BEFORE UPDATE ON public.commercial_opportunities FOR EACH ROW EXECUTE FUNCTION enforce_commercial_opportunity_loss_stage_transition()', '7d02a9fee01ef40928dc6bcc794c167e'),
      ('public.commercial_opportunities.commercial_opportunities_prevent_core_change', 'O', 'CREATE TRIGGER commercial_opportunities_prevent_core_change BEFORE UPDATE ON public.commercial_opportunities FOR EACH ROW EXECUTE FUNCTION prevent_commercial_opportunity_core_change()', '81e7d2d23f09c9ae493982e8746d1282'),
      ('public.commercial_opportunities.commercial_opportunities_touch_timestamps', 'O', 'CREATE TRIGGER commercial_opportunities_touch_timestamps BEFORE UPDATE ON public.commercial_opportunities FOR EACH ROW EXECUTE FUNCTION touch_commercial_opportunity_timestamps()', 'c23b5805a2446d4c64c8bd7904f84add'),
      ('public.commercial_opportunities.p9_contract_send_current_proposal_change_guard', 'O', 'CREATE TRIGGER p9_contract_send_current_proposal_change_guard BEFORE UPDATE OF current_quote_id, current_quote_version_id ON public.commercial_opportunities FOR EACH ROW EXECUTE FUNCTION p9_guard_contract_send_current_proposal_change()', 'ae7de1ab1a08176654d92123bf8fde71'),
      ('public.commercial_opportunity_qualification_fact_events.p9_qfact_events_append_only', 'O', 'CREATE TRIGGER p9_qfact_events_append_only BEFORE DELETE OR UPDATE ON public.commercial_opportunity_qualification_fact_events FOR EACH ROW EXECUTE FUNCTION p9_qfact_prevent_event_mutation()', 'a4563d51855367eba26aa4dfe863d84e'),
      ('public.commercial_opportunity_qualification_facts_current.p9_qfact_current_touch_updated_at', 'O', 'CREATE TRIGGER p9_qfact_current_touch_updated_at BEFORE UPDATE ON public.commercial_opportunity_qualification_facts_current FOR EACH ROW EXECUTE FUNCTION p9_qfact_touch_current_updated_at()', 'c3c2c5d50cb069d5c36990d9d1dc7968'),
      ('public.commercial_opportunity_qualification_facts_current.p9_qfact_current_validate_projection', 'O', 'CREATE TRIGGER p9_qfact_current_validate_projection BEFORE INSERT OR UPDATE ON public.commercial_opportunity_qualification_facts_current FOR EACH ROW EXECUTE FUNCTION p9_qfact_validate_current_projection()', 'b696d4ed053c29219548fe43ad797b88'),
      ('public.commercial_session_context_links.commercial_session_context_links_enforce_write_rules', 'O', 'CREATE TRIGGER commercial_session_context_links_enforce_write_rules BEFORE INSERT OR DELETE OR UPDATE ON public.commercial_session_context_links FOR EACH ROW EXECUTE FUNCTION enforce_commercial_session_context_link_write_rules()', '446c1e4408c7b400e05bb376b2907ba0'),
      ('public.conversation_ai_window_state.trg_conversation_ai_window_state_canonical_scope', 'O', 'CREATE TRIGGER trg_conversation_ai_window_state_canonical_scope BEFORE INSERT OR UPDATE OF conversation_id, organization_id, store_id ON public.conversation_ai_window_state FOR EACH ROW EXECUTE FUNCTION enforce_conversation_ai_window_state_canonical_scope()', 'ea8231a4364eb9c674dfa5b1c361913a'),
      ('public.conversation_sessions.conversation_sessions_00_prevent_core_change', 'O', 'CREATE TRIGGER conversation_sessions_00_prevent_core_change BEFORE UPDATE ON public.conversation_sessions FOR EACH ROW EXECUTE FUNCTION prevent_conversation_session_core_change()', '038e2b81a153b22c200174405b13023b'),
      ('public.conversation_sessions.conversation_sessions_apply_write_rules', 'O', 'CREATE TRIGGER conversation_sessions_apply_write_rules BEFORE INSERT OR UPDATE ON public.conversation_sessions FOR EACH ROW EXECUTE FUNCTION conversation_session_apply_write_rules()', '4ec7a0defd01637a13a96f2129af8e7a'),
      ('public.conversation_states.trg_block_delete_conversation_state', 'O', 'CREATE TRIGGER trg_block_delete_conversation_state BEFORE DELETE ON public.conversation_states FOR EACH ROW EXECUTE FUNCTION block_delete_conversation_state()', '755786bbd2d0a45204b192f2988014cc'),
      ('public.conversation_states.trg_block_direct_state_update', 'O', 'CREATE TRIGGER trg_block_direct_state_update BEFORE UPDATE ON public.conversation_states FOR EACH ROW WHEN ((old.state IS DISTINCT FROM new.state)) EXECUTE FUNCTION block_direct_state_update()', '70361959671ae49a3cc21e4a09dd2cdf'),
      ('public.conversation_states.trg_block_org_change', 'O', 'CREATE TRIGGER trg_block_org_change BEFORE UPDATE ON public.conversation_states FOR EACH ROW WHEN ((old.organization_id IS DISTINCT FROM new.organization_id)) EXECUTE FUNCTION block_org_change_in_conversation_states()', '9d01efd9cd784dec01eaa8f7c39b72d7'),
      ('public.conversations.log_conversation_status_change', 'O', 'CREATE TRIGGER log_conversation_status_change AFTER UPDATE OF status ON public.conversations FOR EACH ROW EXECUTE FUNCTION trg_log_conversation_status_change()', '27ed00d3f457c2b66f9c7f37e56ff6d7'),
      ('public.conversations.trg_block_direct_human_flag_update', 'O', 'CREATE TRIGGER trg_block_direct_human_flag_update BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION block_direct_human_flag_update()', 'b018a7094d531a470e556609e76e1af1'),
      ('public.conversations.trg_create_initial_state', 'O', 'CREATE TRIGGER trg_create_initial_state AFTER INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION create_initial_conversation_state()', '0e30ca7fe5c69990a41352254035d9f1'),
      ('public.conversations.trg_enforce_conversation_org_integrity', 'O', 'CREATE TRIGGER trg_enforce_conversation_org_integrity BEFORE INSERT OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION enforce_conversation_org_integrity()', 'af7b1c6e6401602fab0dedea9b9d6590'),
      ('public.conversations.trg_guard_conversation_ai_window_state_parent_conversation', 'O', 'CREATE TRIGGER trg_guard_conversation_ai_window_state_parent_conversation BEFORE UPDATE OF lead_id, organization_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION guard_conversation_ai_window_state_parent_conversation()', '63b26bf565e069fdc63a28fff6f2bd25'),
      ('public.conversations.trg_normalize_conversation_status_aliases', 'O', 'CREATE TRIGGER trg_normalize_conversation_status_aliases BEFORE INSERT OR UPDATE OF status ON public.conversations FOR EACH ROW EXECUTE FUNCTION normalize_conversation_status_aliases()', '2bf19c479cf2902e485dc92cc2f1571b'),
      ('public.customer_store_links.customer_store_links_prevent_organization_change', 'O', 'CREATE TRIGGER customer_store_links_prevent_organization_change BEFORE UPDATE ON public.customer_store_links FOR EACH ROW EXECUTE FUNCTION prevent_customer_identity_organization_change()', '5ba1d201d85af32873dda89364bb902c'),
      ('public.customer_store_links.customer_store_links_touch_updated_at', 'O', 'CREATE TRIGGER customer_store_links_touch_updated_at BEFORE UPDATE ON public.customer_store_links FOR EACH ROW EXECUTE FUNCTION touch_customer_identity_updated_at()', '6e3d5827b2812723217abd07440bf152'),
      ('public.customers.customers_prevent_organization_change', 'O', 'CREATE TRIGGER customers_prevent_organization_change BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION prevent_customer_identity_organization_change()', '5ba1d201d85af32873dda89364bb902c'),
      ('public.customers.customers_touch_updated_at', 'O', 'CREATE TRIGGER customers_touch_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION touch_customer_identity_updated_at()', '6e3d5827b2812723217abd07440bf152'),
      ('public.lead_customer_links.lead_customer_links_enforce_write_rules', 'O', 'CREATE TRIGGER lead_customer_links_enforce_write_rules BEFORE INSERT OR UPDATE ON public.lead_customer_links FOR EACH ROW EXECUTE FUNCTION enforce_lead_customer_link_write_rules()', '757a9b212cf24da07e1b804b8c14c6c1'),
      ('public.leads.leads_set_updated_at', 'O', 'CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION set_updated_at()', '1c3ea071de62c54b535847a852367632'),
      ('public.leads.trg_guard_conversation_ai_window_state_parent_lead', 'O', 'CREATE TRIGGER trg_guard_conversation_ai_window_state_parent_lead BEFORE UPDATE OF organization_id, store_id ON public.leads FOR EACH ROW EXECUTE FUNCTION guard_conversation_ai_window_state_parent_lead()', 'fd9b0bdd440e8e8fe9aac8c45a4b601e'),
      ('public.leads.trg_normalize_and_validate_lead_state', 'O', 'CREATE TRIGGER trg_normalize_and_validate_lead_state BEFORE INSERT OR UPDATE OF state ON public.leads FOR EACH ROW EXECUTE FUNCTION normalize_and_validate_lead_state()', 'e531807217172c88bedf352dfe433de7'),
      ('public.messages.p9_8_5_finalize_concession_after_quote_send', 'O', 'CREATE CONSTRAINT TRIGGER p9_8_5_finalize_concession_after_quote_send AFTER UPDATE OF outbound_commercial_finalized_at ON public.messages DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW WHEN (((old.outbound_commercial_finalized_at IS NULL) AND (new.outbound_commercial_finalized_at IS NOT NULL))) EXECUTE FUNCTION p9_8_5_finalize_concession_after_quote_send_trigger()', '13000a1e8b7b174cdcf73a77fc398ea0'),
      ('public.messages.p9_sales_contract_send_message_current_proposal_guard', 'O', 'CREATE TRIGGER p9_sales_contract_send_message_current_proposal_guard BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION p9_guard_sales_contract_send_message()', 'c49a129021cecc81741fcd2591b1cd04'),
      ('public.messages.trg_autofill_delivered_at_from_read_at', 'O', 'CREATE TRIGGER trg_autofill_delivered_at_from_read_at BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION autofill_delivered_at_from_read_at()', 'ca11db32ba6aa02eab857a78a3ddbd9e'),
      ('public.messages.trg_block_direct_messages_insert', 'O', 'CREATE TRIGGER trg_block_direct_messages_insert BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION block_direct_messages_insert()', 'd7c839e822d281b909e4fd9cff7b54de'),
      ('public.messages.trg_conversations_last_message_sync', 'O', 'CREATE TRIGGER trg_conversations_last_message_sync AFTER INSERT OR DELETE OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION trg_conversations_last_message_sync()', '42a22f83d8d97ef441097e9191fb2aba'),
      ('public.messages.trg_enqueue_ai_sales_after_incoming_message', 'O', 'CREATE TRIGGER trg_enqueue_ai_sales_after_incoming_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION trg_enqueue_ai_sales_after_incoming_message()', '34fc78b8739ee40418aaf8262c64ae2d'),
      ('public.messages.trg_enqueue_assistant_operational_task_after_incoming_message', 'O', 'CREATE TRIGGER trg_enqueue_assistant_operational_task_after_incoming_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enqueue_assistant_operational_task_after_incoming_message()', 'dcdc4ceb8e820a350c5a29cb0b64c3c4'),
      ('public.messages.trg_fill_messages_lead_store', 'O', 'CREATE TRIGGER trg_fill_messages_lead_store BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION fill_messages_lead_store_from_conversation()', 'e154ca5a02dd5235ed80c590934be1fe'),
      ('public.messages.trg_prevent_delivered_at_reset', 'O', 'CREATE TRIGGER trg_prevent_delivered_at_reset BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION prevent_delivered_at_reset()', '2969ffe5ed03d27f9e1fc0a617e9b1c4'),
      ('public.messages.trg_prevent_read_at_reset', 'O', 'CREATE TRIGGER trg_prevent_read_at_reset BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION prevent_read_at_reset()', '40a3d224d83317fb5ff191f63059b0cc'),
      ('public.state_transition_log.state_transition_log_enforce_organization_scope', 'O', 'CREATE TRIGGER state_transition_log_enforce_organization_scope BEFORE INSERT OR UPDATE OF conversation_id, organization_id ON public.state_transition_log FOR EACH ROW EXECUTE FUNCTION enforce_state_transition_log_organization_scope()', 'a9ad2b9d63f36dda430053ac4b1d9ff0'),
      ('public.state_transition_log.state_transition_log_enforce_store_scope', 'O', 'CREATE TRIGGER state_transition_log_enforce_store_scope BEFORE INSERT OR UPDATE OF conversation_id, store_id ON public.state_transition_log FOR EACH ROW EXECUTE FUNCTION enforce_state_transition_log_store_scope()', 'd820a916d27457c7cf7a68b53fc5c17c'),
      ('public.store_assistant_notification_queue.trg_p10_7_a1_4b_preserve_delivered_human_response_alert', 'O', 'CREATE TRIGGER trg_p10_7_a1_4b_preserve_delivered_human_response_alert BEFORE UPDATE ON public.store_assistant_notification_queue FOR EACH ROW EXECUTE FUNCTION p10_7_a1_4b_preserve_delivered_human_response_alert()', '01a0ef0fbd0bc958f78d02570e9e369d'),
      ('public.store_assistant_notification_queue.trg_store_assistant_notification_queue_updated_at', 'O', 'CREATE TRIGGER trg_store_assistant_notification_queue_updated_at BEFORE UPDATE ON public.store_assistant_notification_queue FOR EACH ROW EXECUTE FUNCTION set_current_timestamp_updated_at()', '0ecf9e3798d9ed55a0ae7307d84025f8')
  ), actual as (
    select format('%I.%I.%I', n.nspname, c.relname, t.tgname) as binding,
      t.tgenabled::text as enabled, pg_get_triggerdef(t.oid) as definition,
      md5(pg_get_functiondef(t.tgfoid)) as function_md5
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and t.tgenabled <> 'D' and n.nspname='public'
      and c.relname in ('organizations', 'stores', 'customers', 'customer_store_links', 'leads', 'lead_customer_links', 'conversations', 'conversation_sessions', 'commercial_opportunities', 'commercial_session_context_links', 'messages', 'conversation_states', 'state_transition_log', 'commercial_conversation_fact_events', 'commercial_opportunity_qualification_fact_events', 'commercial_opportunity_qualification_facts_current', 'conversation_ai_window_state', 'ai_runs', 'store_assistant_operational_tasks', 'store_assistant_operational_task_queue', 'ai_run_queue', 'ai_sales_action_queue', 'store_assistant_notification_queue', 'zion_admin_diagnostic_operational_failure_events', 'channel_whatsapp_inbox')
  ), differences as (
    select coalesce(a.binding,e.binding) as binding,
      case when a.binding is null then 'AUSENTE' when e.binding is null then 'NOVO' else 'DIVERGENTE' end as reason
    from expected e full join actual a using (binding)
    where a.binding is null or e.binding is null
      or a.enabled is distinct from e.enabled or a.definition is distinct from e.definition
      or a.function_md5 is distinct from e.function_md5
  )
  select string_agg(binding || ':' || reason, '; ' order by binding) into v_external_trigger_functions from differences;
  if v_external_trigger_functions is not null then
    insert into pg_temp.p10_9_b_results values ('fixture_preflight','BLOQUEADO',v_external_trigger_functions);
  else
    insert into pg_temp.p10_9_b_results values ('fixture_preflight','PASS','vinculos e hashes de triggers conferidos');
  end if;

  if not v_execute_fixture then
    insert into pg_temp.p10_9_b_results values ('integrated_homologation','NAO_EXECUTADO','modo preflight: nenhuma fixture ou escrita em tabela publica');
  end if;

  if v_execute_fixture and v_contracts_ok and v_external_trigger_functions is null then
  select
    gen_random_uuid() as organization_id,
    gen_random_uuid() as store_id,
    gen_random_uuid() as customer_id,
    gen_random_uuid() as lead_id,
    gen_random_uuid() as conversation_id,
    gen_random_uuid() as conversation_session_id,
    gen_random_uuid() as commercial_opportunity_id,
    gen_random_uuid() as lead_customer_link_id,
    gen_random_uuid() as context_link_id,
    null::uuid as text_message_id,
    null::uuid as audio_message_id
  into v_fixture;

  select
    gen_random_uuid() as organization_id,
    gen_random_uuid() as store_id,
    gen_random_uuid() as customer_id,
    gen_random_uuid() as lead_id,
    gen_random_uuid() as id
  into v_foreign_opportunity;

  select count(*) into v_ai_queue_before
  from public.ai_run_queue
  where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);
  select count(*) into v_sales_queue_before
  from public.ai_sales_action_queue
  where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);
  select count(*) into v_assistant_queue_before
  from public.store_assistant_notification_queue
  where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);

  select metadata into v_audio_metadata_before
  from public.messages
  where id = v_fixture.audio_message_id;

  select count(*) into v_event_before
  from public.commercial_conversation_fact_events
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and conversation_id = v_fixture.conversation_id
    and conversation_session_id = v_fixture.conversation_session_id;
  select count(*) into v_qevent_before
  from public.commercial_opportunity_qualification_fact_events
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and commercial_opportunity_id = v_fixture.commercial_opportunity_id;
  select count(*) into v_qcurrent_before
  from public.commercial_opportunity_qualification_facts_current
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and commercial_opportunity_id = v_fixture.commercial_opportunity_id;

  begin
    insert into public.organizations (id, name, subscription_status)
    values (
      v_fixture.organization_id,
      'P10.9-B.14 synthetic organization',
      'past_due'
    ), (
      v_foreign_opportunity.organization_id,
      'P10.9-B.14 synthetic foreign organization',
      'past_due'
    );

    insert into public.stores (id, organization_id, name)
    values
      (v_fixture.store_id, v_fixture.organization_id, 'P10.9-B.4 synthetic target store'),
      (v_foreign_opportunity.store_id, v_foreign_opportunity.organization_id, 'P10.9-B.4 synthetic foreign store');

    insert into public.customers (id, organization_id, display_name, normalized_name)
    values
      (v_fixture.customer_id, v_fixture.organization_id, 'P10.9-B.4 synthetic customer', 'p10.9-b.4 synthetic customer'),
      (v_foreign_opportunity.customer_id, v_foreign_opportunity.organization_id, 'P10.9-B.4 synthetic foreign customer', 'p10.9-b.4 synthetic foreign customer');

    insert into public.customer_store_links (organization_id, store_id, customer_id)
    values
      (v_fixture.organization_id, v_fixture.store_id, v_fixture.customer_id),
      (v_foreign_opportunity.organization_id, v_foreign_opportunity.store_id, v_foreign_opportunity.customer_id);

    insert into public.leads (id, organization_id, store_id, name, phone, state)
    values
      (v_fixture.lead_id, v_fixture.organization_id, v_fixture.store_id, 'P10.9-B.4 synthetic lead', '+5500000000001', 'novo_lead'),
      (v_foreign_opportunity.lead_id, v_foreign_opportunity.organization_id, v_foreign_opportunity.store_id, 'P10.9-B.4 synthetic foreign lead', '+5500000000002', 'novo_lead');

    insert into public.conversations (id, organization_id, lead_id, status, is_human_active)
    values
      (v_fixture.conversation_id, v_fixture.organization_id, v_fixture.lead_id, 'open', false);

    insert into public.commercial_opportunities (
      id, organization_id, store_id, customer_id, origin_lead_id, primary_conversation_id, stage
    )
    values
      (v_fixture.commercial_opportunity_id, v_fixture.organization_id, v_fixture.store_id,
       v_fixture.customer_id, v_fixture.lead_id, v_fixture.conversation_id, 'novo_lead'),
      (v_foreign_opportunity.id, v_foreign_opportunity.organization_id, v_foreign_opportunity.store_id,
       v_foreign_opportunity.customer_id, v_foreign_opportunity.lead_id, null, 'novo_lead');

    insert into public.conversation_sessions (
      id, organization_id, store_id, conversation_id, status, closed_at
    )
    values (
      v_fixture.conversation_session_id, v_fixture.organization_id, v_fixture.store_id,
      v_fixture.conversation_id, 'active', null
    );

    select * into v_text_write
    from public.link_lead_to_customer(
      v_fixture.organization_id, v_fixture.store_id, v_fixture.lead_id,
      v_fixture.customer_id, 'manual', 'system', null, null,
      'p10_9_b.4 synthetic fixture', v_test_prefix || ':lead-customer',
      gen_random_uuid(), jsonb_build_object('runner', true, 'synthetic', true), null
    );
    v_fixture.lead_customer_link_id := v_text_write.id;

    select * into v_audio_write
    from public.link_commercial_session_context(
      v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_session_id,
      v_fixture.customer_id, v_fixture.commercial_opportunity_id,
      v_fixture.lead_customer_link_id, 'system', 'system', null,
      'p10_9_b.4 synthetic fixture', v_test_prefix || ':context-link',
      gen_random_uuid(), jsonb_build_object('runner', true, 'synthetic', true), null
    );
    v_fixture.context_link_id := v_audio_write.id;

    select id into v_fixture.text_message_id
    from public.insert_message(
      v_fixture.conversation_id, 'user', 'incoming', 'text',
      'Mensagem sintetica de homologacao sobre necessidade comercial', null, null,
      jsonb_build_object('runner', true, 'synthetic', true)
    );
    select id into v_fixture.audio_message_id
    from public.insert_message(
      v_fixture.conversation_id, 'user', 'incoming', 'audio',
      '[audio sintetico de homologacao]', null, 'synthetic://p10-9-b/audio',
      jsonb_build_object(
        'runner', true,
        'synthetic', true,
        'media_origin', 'customer',
        'attachment_kind', 'audio'
      )
    );

    select count(*) into v_ai_queue_during
    from public.ai_run_queue
    where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);
    select count(*) into v_sales_queue_during
    from public.ai_sales_action_queue
    where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);
    select count(*) into v_assistant_queue_during
    from public.store_assistant_notification_queue
    where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);
    v_ai_enqueue_pass := v_ai_queue_during = v_ai_queue_before
      and v_sales_queue_during = v_sales_queue_before
      and v_assistant_queue_during = v_assistant_queue_before;

    select (select count(*) from public.ai_runs where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.store_assistant_operational_task_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.store_assistant_operational_tasks where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.zion_admin_diagnostic_operational_failure_events where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.channel_whatsapp_inbox where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.conversation_ai_window_state where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) into v_extra_side_effects;
    if not v_ai_enqueue_pass or v_extra_side_effects <> 0 then
      raise exception using errcode = 'P10B0', message = 'unexpected synthetic queue/window/event activity';
    end if;

    select not exists (
      select 1
      from public.messages message_row
      where message_row.id in (v_fixture.text_message_id, v_fixture.audio_message_id)
        and (
          message_row.outbound_commercial_finalized_at is not null
          or message_row.metadata ?| array[
            'commercial_negotiation_concession_id',
            'commercial_negotiation_concession_materialization_id',
            'commercial_opportunity_id',
            'sales_quote_id',
            'sales_quote_version_id'
          ]
        )
    ) into v_p98_branch_pass;

    select count(*) into v_fixture_message_scope_mismatches
    from public.messages m
    where m.id in (v_fixture.text_message_id, v_fixture.audio_message_id)
      and (
        m.organization_id is distinct from v_fixture.organization_id
        or m.store_id is distinct from v_fixture.store_id
        or m.conversation_id is distinct from v_fixture.conversation_id
        or m.lead_id is distinct from v_fixture.lead_id
        or m.conversation_session_id is distinct from v_fixture.conversation_session_id
        or m.commercial_session_context_link_id is distinct from v_fixture.context_link_id
        or m.commercial_context_capture_state is distinct from 'captured'
        or m.deleted_at is not null
      );
    select count(*) into v_message_count from public.messages m
    where m.id in (v_fixture.text_message_id, v_fixture.audio_message_id)
      and m.sender = 'user' and m.direction = 'incoming'
      and ((m.id = v_fixture.text_message_id and m.message_type = 'text')
        or (m.id = v_fixture.audio_message_id and m.message_type = 'audio'));
    if v_fixture.text_message_id is null or v_fixture.audio_message_id is null
      or v_fixture.text_message_id = v_fixture.audio_message_id
      or v_message_count <> 2 or v_fixture_message_scope_mismatches <> 0 then
      raise exception using
        errcode = 'P10B0',
        message = format(
          'synthetic fixture provenance invalid: mismatches=%s text_message_id=%s audio_message_id=%s context_link_id=%s',
          v_fixture_message_scope_mismatches, v_fixture.text_message_id,
          v_fixture.audio_message_id, v_fixture.context_link_id);
    end if;

    update public.messages
       set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'audio_transcript', 'Transcricao sintetica de homologacao: cliente prefere o modelo confirmado',
         'transcription_status', 'succeeded'
       )
     where id = v_fixture.audio_message_id
       and organization_id = v_fixture.organization_id
       and store_id = v_fixture.store_id;
    get diagnostics v_audio_update_count = row_count;
    if v_audio_update_count <> 1 then
      raise exception using errcode = 'P10B0', message = 'audio metadata update cardinality mismatch';
    end if;

    select * into v_text_write
    from public.write_commercial_conversation_fact_event_by_system(
      v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id,
      v_fixture.lead_id, v_fixture.conversation_session_id, null, null,
      v_test_prefix || ':text:assertion', 'need_summary',
      to_jsonb('Cliente precisa de uma piscina para o espaco informado'::text),
      v_fixture.text_message_id, 'text', 'customer', 'confirmed', 'assertion', null
    );
    v_text_event_id := v_text_write.event_id;

    select * into v_audio_write
    from public.write_commercial_conversation_fact_event_by_system(
      v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id,
      v_fixture.lead_id, v_fixture.conversation_session_id, null, null,
      v_test_prefix || ':audio:assertion', 'customer_preferences_text',
      to_jsonb('prefere o modelo confirmado na transcricao sintetica'::text),
      v_fixture.audio_message_id, 'audio', 'customer', 'confirmed', 'assertion', null
    );
    v_audio_event_id := v_audio_write.event_id;

    select * into v_correction_write
    from public.write_commercial_conversation_fact_event_by_system(
      v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id,
      v_fixture.lead_id, v_fixture.conversation_session_id, null, null,
      v_test_prefix || ':text:correction', 'need_summary',
      to_jsonb('Correcao: cliente prefere uma piscina menor'::text),
      v_fixture.text_message_id, 'text', 'customer', 'confirmed', 'correction', v_text_event_id
    );
    select supersedes_event_id into v_correction_supersedes
    from public.commercial_conversation_fact_events
    where id = v_correction_write.event_id;

    select * into v_text_replay
    from public.write_commercial_conversation_fact_event_by_system(
      v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id,
      v_fixture.lead_id, v_fixture.conversation_session_id, null, null,
      v_test_prefix || ':text:assertion', 'need_summary',
      to_jsonb('Cliente precisa de uma piscina para o espaco informado'::text),
      v_fixture.text_message_id, 'text', 'customer', 'confirmed', 'assertion', null
    );

    with test_events as (
      select *
      from public.read_commercial_conversation_fact_events_by_system(
        v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id,
        v_fixture.lead_id, v_fixture.conversation_session_id, null, null
      )
      where operation_key like v_test_prefix || '%'
    )
    select count(*),
           count(*) filter (where source_media_type = 'text'),
           count(*) filter (where source_media_type = 'audio'),
           count(*) filter (where conflict_state = 'conflict')
      into v_events_read, v_text_events_read, v_audio_events_read, v_conflict_events_read
    from test_events;
    v_persistence_pass := v_text_write.outcome = 'created'
      and v_audio_write.outcome = 'created'
      and v_text_event_id is not null
      and v_audio_event_id is not null
      and v_correction_write.event_id is not null
      and v_events_read = 3
      and v_text_events_read = 2
      and v_audio_events_read = 1;
    v_recovery_pass := v_conflict_events_read = 2
      and v_correction_supersedes = v_text_event_id;
    v_idempotency_pass := v_text_replay.outcome = 'replayed'
      and v_text_replay.event_id = v_text_event_id;

    for v_event in
      select *
      from public.read_commercial_conversation_fact_events_by_system(
        v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id,
        v_fixture.lead_id, v_fixture.conversation_session_id, null,
        v_fixture.commercial_opportunity_id
      )
      where operation_key like v_test_prefix || '%'
    loop
      if v_event.fact_key = 'customer_preferences_text'
         and v_event.conflict_state = 'consistent'
         and v_event.commercial_opportunity_id is null then
        select * into v_promoted_write
        from public.write_commercial_opportunity_qualification_fact_by_system(
          v_fixture.organization_id, v_fixture.store_id, v_fixture.commercial_opportunity_id,
          v_test_prefix || ':promotion:' || v_event.event_id::text,
          v_event.fact_key, v_event.value_json, 'confirmed', 'incoming_customer_message',
          v_event.source_message_id, v_event.conversation_id,
          'p10_9_b_homologation', false
        );
        v_promoted_count := v_promoted_count + 1;
        select * into v_promoted_replay
        from public.write_commercial_opportunity_qualification_fact_by_system(
          v_fixture.organization_id, v_fixture.store_id, v_fixture.commercial_opportunity_id,
          v_test_prefix || ':promotion:' || v_event.event_id::text,
          v_event.fact_key, v_event.value_json, 'confirmed', 'incoming_customer_message',
          v_event.source_message_id, v_event.conversation_id,
          'p10_9_b_homologation', false
        );
        v_promotion_first_id := v_promoted_write.event_id;
        v_promotion_replay_id := v_promoted_replay.event_id;
        v_promotion_first_outcome := v_promoted_write.outcome;
        v_promotion_replay_outcome := v_promoted_replay.outcome;
        select count(*) into v_promotion_event_count
        from public.commercial_opportunity_qualification_fact_events
        where organization_id = v_fixture.organization_id
          and store_id = v_fixture.store_id
          and commercial_opportunity_id = v_fixture.commercial_opportunity_id
          and operation_key = v_test_prefix || ':promotion:' || v_event.event_id::text;
      end if;
    end loop;

    select * into v_canonical
    from public.read_commercial_opportunity_qualification_facts_by_system(
      v_fixture.organization_id, v_fixture.store_id, v_fixture.commercial_opportunity_id
    );
    v_promotion_pass := v_promoted_count = 1
      and v_promotion_first_id is not null
      and v_promotion_replay_id = v_promotion_first_id
      and v_promotion_first_outcome in ('confirmed_created', 'created')
      and v_promotion_replay_outcome in ('idempotent_replay_current', 'idempotent_replay_stale')
      and v_promotion_event_count = 1
      and exists (
        select 1 from jsonb_array_elements(coalesce(v_canonical.known_facts, '[]'::jsonb)) known
        where known->>'factKey' = 'customer_preferences_text'
          and known->'value' = to_jsonb('prefere o modelo confirmado na transcricao sintetica'::text)
      );

    begin
      perform * from public.write_commercial_opportunity_qualification_fact_by_system(
        v_fixture.organization_id, v_fixture.store_id, v_foreign_opportunity.id,
        v_test_prefix || ':wrong-scope', 'customer_preferences_text',
        to_jsonb('nao deve atravessar tenant'::text), 'confirmed',
        'incoming_customer_message', v_fixture.audio_message_id, v_fixture.conversation_id,
        'p10_9_b_homologation', false
      );
      v_scope_pass := false;
    exception when others then
      get stacked diagnostics v_scope_sqlstate = returned_sqlstate, v_scope_error = message_text;
      v_scope_pass := v_scope_sqlstate = '23514'
        and v_scope_error = 'commercial opportunity scope mismatch';
    end;

    select (select count(*) from public.ai_runs where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.store_assistant_operational_task_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.store_assistant_operational_tasks where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.zion_admin_diagnostic_operational_failure_events where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.channel_whatsapp_inbox where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.conversation_ai_window_state where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.ai_run_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.ai_sales_action_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
      (select count(*) from public.store_assistant_notification_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) into v_extra_side_effects;
    v_ai_enqueue_pass := v_ai_enqueue_pass and v_extra_side_effects = 0;
    v_functional_pass := coalesce(v_persistence_pass and v_recovery_pass and v_idempotency_pass
      and v_promotion_pass and v_scope_pass and v_ai_enqueue_pass and v_p98_branch_pass, false);
    v_observed := format(
      'observado: fixture_scope_mismatches=%s events_read=%s(text=%s,audio=%s,conflict=%s) text_outcome=%s audio_outcome=%s correction_id=%s supersedes=%s replay_outcome=%s replay_id=%s promoted_count=%s promotion_first_outcome=%s promotion_replay_outcome=%s promotion_first_id=%s promotion_replay_id=%s promotion_event_count=%s scope_sqlstate=%s scope_error=%s ai_queue=(before:%s,during:%s) sales_queue=(before:%s,during:%s) assistant_queue=(before:%s,during:%s) ai_enqueue_pass=%s p98_branch_pass=%s',
      v_fixture_message_scope_mismatches, v_events_read, v_text_events_read,
      v_audio_events_read, v_conflict_events_read, v_text_write.outcome,
      v_audio_write.outcome, v_correction_write.event_id, v_correction_supersedes,
      v_text_replay.outcome, v_text_replay.event_id, v_promoted_count,
      v_promotion_first_outcome, v_promotion_replay_outcome,
      v_promotion_first_id, v_promotion_replay_id, v_promotion_event_count,
      v_scope_sqlstate, v_scope_error, v_ai_queue_before, v_ai_queue_during,
      v_sales_queue_before, v_sales_queue_during, v_assistant_queue_before,
      v_assistant_queue_during, v_ai_enqueue_pass, v_p98_branch_pass);

    if v_functional_pass then
      raise exception using errcode = 'P10B1', message = 'P10_9_B_INTENTIONAL_ROLLBACK';
    end if;
    raise exception using errcode = 'P10B0', message = v_observed;
  exception when others then
    v_subtransaction_rolled_back := true;
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
    if v_sqlstate = 'P10B1' and v_error = 'P10_9_B_INTENTIONAL_ROLLBACK' then
      v_details := v_observed || '; rollback intencional executado';
    elsif v_sqlstate = 'P10B0' then
      v_functional_pass := false;
      v_details := v_error;
    else
      v_functional_pass := false;
      v_details := coalesce(v_sqlstate, 'erro') || ': ' || coalesce(v_error, 'desconhecido');
    end if;
  end;

  select count(*) into v_event_after
  from public.commercial_conversation_fact_events
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and conversation_id = v_fixture.conversation_id
    and conversation_session_id = v_fixture.conversation_session_id;
  select count(*) into v_qevent_after
  from public.commercial_opportunity_qualification_fact_events
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and commercial_opportunity_id = v_fixture.commercial_opportunity_id;
  select count(*) into v_qcurrent_after
  from public.commercial_opportunity_qualification_facts_current
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and commercial_opportunity_id = v_fixture.commercial_opportunity_id;
  select count(*) into v_test_event_after
  from public.commercial_conversation_fact_events
  where operation_key like v_test_prefix || '%';
  select count(*) into v_test_qevent_after
  from public.commercial_opportunity_qualification_fact_events
  where operation_key like v_test_prefix || '%';
  select metadata into v_audio_metadata_after
  from public.messages
  where id = v_fixture.audio_message_id;

  select count(*) into v_ai_queue_after
  from public.ai_run_queue
  where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);
  select count(*) into v_sales_queue_after
  from public.ai_sales_action_queue
  where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);
  select count(*) into v_assistant_queue_after
  from public.store_assistant_notification_queue
  where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id);

  select coalesce(sum(object_count), 0) into v_synthetic_after
  from (
    select count(*)::bigint as object_count
    from public.organizations
    where id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)
    union all
    select count(*)::bigint from public.stores
    where id in (v_fixture.store_id, v_foreign_opportunity.store_id)
    union all
    select count(*)::bigint from public.customers
    where id in (v_fixture.customer_id, v_foreign_opportunity.customer_id)
    union all
    select count(*)::bigint from public.leads
    where id in (v_fixture.lead_id, v_foreign_opportunity.lead_id)
    union all
    select count(*)::bigint from public.conversations
    where id = v_fixture.conversation_id
    union all
    select count(*)::bigint from public.conversation_sessions
    where id = v_fixture.conversation_session_id
    union all
    select count(*)::bigint from public.commercial_opportunities
    where id in (v_fixture.commercial_opportunity_id, v_foreign_opportunity.id)
    union all
    select count(*)::bigint from public.customer_store_links
    where (organization_id, store_id, customer_id) in (
      (v_fixture.organization_id, v_fixture.store_id, v_fixture.customer_id),
      (v_foreign_opportunity.organization_id, v_foreign_opportunity.store_id, v_foreign_opportunity.customer_id)
    )
    union all
    select count(*)::bigint from public.lead_customer_links
    where id = v_fixture.lead_customer_link_id
    union all
    select count(*)::bigint from public.commercial_session_context_links
    where id = v_fixture.context_link_id
    union all
    select count(*)::bigint from public.messages
    where id in (v_fixture.text_message_id, v_fixture.audio_message_id)
  ) synthetic_objects;

  select (select count(*) from public.ai_runs where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.store_assistant_operational_task_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.store_assistant_operational_tasks where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.zion_admin_diagnostic_operational_failure_events where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.channel_whatsapp_inbox where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.conversation_ai_window_state where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.ai_run_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.ai_sales_action_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.store_assistant_notification_queue where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.conversation_states where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.state_transition_log where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.commercial_conversation_fact_events where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.commercial_opportunity_qualification_fact_events where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.commercial_opportunity_qualification_facts_current where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.lead_customer_links where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.commercial_session_context_links where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) +
    (select count(*) from public.messages where organization_id in (v_fixture.organization_id, v_foreign_opportunity.organization_id)) into v_extra_residues;
  v_rollback_pass := v_subtransaction_rolled_back
    and v_extra_residues = 0
    and v_event_after = v_event_before
    and v_qevent_after = v_qevent_before
    and v_qcurrent_after = v_qcurrent_before
    and v_test_event_after = 0
    and v_test_qevent_after = 0
    and v_synthetic_after = 0
    and v_audio_metadata_after is not distinct from v_audio_metadata_before
    and v_ai_queue_after = v_ai_queue_before
    and v_sales_queue_after = v_sales_queue_before
    and v_assistant_queue_after = v_assistant_queue_before;

  insert into pg_temp.p10_9_b_results values
    ('installed_contracts', 'PASS', 'RPCs canonicas encontradas por assinatura e MD5; nenhuma migration recriada');
  insert into pg_temp.p10_9_b_results values
    ('fixture_trigger_audit', 'PASS', 'vinculos e hashes conferidos; ramos externos excluidos pelo escopo das fixtures');
  insert into pg_temp.p10_9_b_results values
    ('persistence_text_audio', case when v_persistence_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_persistence_pass then 'eventos text/audio persistidos com provenance e escopo; audio usou transcricao sintetica temporaria'
       else v_details end);
  insert into pg_temp.p10_9_b_results values
    ('recovery_correction_conflict', case when v_recovery_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_recovery_pass then 'correcao vinculada por supersedes_event_id e conflito preservado sem escolher valor'
       else v_details end);
  insert into pg_temp.p10_9_b_results values
    ('idempotency_recovery', case when v_idempotency_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_idempotency_pass then 'replay do writer retornou o mesmo event_id sem duplicar'
       else v_details end);
  insert into pg_temp.p10_9_b_results values
    ('promotion_and_isolation', case when v_promotion_pass and v_scope_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_promotion_pass and v_scope_pass then 'fato de audio promovido para oportunidade alvo; tentativa em oportunidade de outro escopo recusada'
       else v_details end);
  insert into pg_temp.p10_9_b_results values
    ('functional_assertions', case when v_functional_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_functional_pass then 'todas as assercoes funcionais passaram; past_due impediu enfileiramento e ramo P9.8.5 ficou inalcançavel'
       else v_details end);
  insert into pg_temp.p10_9_b_results values
    ('rollback_absence', case when v_rollback_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_rollback_pass then 'contagens antes/depois preservadas; prefixos, fixtures, mensagens e residuos auxiliares ausentes'
       else format('%s; rollback=%s event_before=%s event_after=%s qevent_before=%s qevent_after=%s qcurrent_before=%s qcurrent_after=%s test_event_after=%s test_qevent_after=%s synthetic_after=%s metadata_restored=%s',
         v_details, v_subtransaction_rolled_back, v_event_before, v_event_after,
         v_qevent_before, v_qevent_after, v_qcurrent_before, v_qcurrent_after,
         v_test_event_after, v_test_qevent_after, v_synthetic_after,
         v_audio_metadata_after is not distinct from v_audio_metadata_before) ||
         format(' extra_residues=%s extra_side_effects=%s queues ai=%s/%s sales=%s/%s assistant=%s/%s',
            v_extra_residues, v_extra_side_effects,
           v_ai_queue_before, v_ai_queue_after, v_sales_queue_before,
           v_sales_queue_after, v_assistant_queue_before,
           v_assistant_queue_after) end);
  insert into pg_temp.p10_9_b_results values
    ('integrated_homologation', case when v_functional_pass and v_rollback_pass then 'PASS' else 'BLOQUEADO' end,
     case when v_functional_pass and v_rollback_pass then v_details
       else coalesce(v_details, 'ensaio bloqueado') end);
  elsif v_execute_fixture then
    if not v_contracts_ok and not exists (
      select 1 from pg_temp.p10_9_b_results where test_name = 'fixture_preflight'
    ) then
      insert into pg_temp.p10_9_b_results values
        ('fixture_preflight', 'BLOQUEADO', 'preflight de contratos, hashes ou dependencias falhou');
    end if;
    insert into pg_temp.p10_9_b_results values
      ('integrated_homologation', 'BLOQUEADO', 'ensaio funcional nao iniciado: preflight preventivo falhou');
  end if;
end;
$runner$;

select test_name, verdict, details
from pg_temp.p10_9_b_results
order by case test_name
  when 'installed_contracts' then 1
  when 'fixture_trigger_audit' then 2
  when 'fixture_preflight' then 3
  when 'persistence_text_audio' then 4
  when 'recovery_correction_conflict' then 5
  when 'idempotency_recovery' then 6
  when 'promotion_and_isolation' then 7
  when 'functional_assertions' then 8
  when 'rollback_absence' then 9
  else 10
end;

rollback;

-- Limites da homologacao:
-- - SQL comprova RPCs, ledger, escopo, conflito, replay, promocao canonica e rollback.
-- - Extracao TypeScript real e Storage real dependem dos testes/ensaios proprios.
-- - Nenhuma exclusao de audio ou ativacao de ZION_AUDIO_RETENTION_EXECUTOR_ENABLED ocorre aqui.
`;

fs.mkdirSync(path.dirname(path.join(root, outputPath)), { recursive: true });
fs.writeFileSync(path.join(root, outputPath), runner, "utf8");
console.log(outputPath);
