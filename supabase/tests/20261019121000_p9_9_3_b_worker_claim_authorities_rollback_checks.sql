-- ZION / P9 / 9.3-B — SQL RUNNER DE VERIFICACAO (PRODUCAO)
-- SOMENTE fixtures sinteticas, em organizacoes/lojas UUID aleatorias.
-- Nenhum dado real e reprocessado. Todos INSERT/UPDATE sao revertidos.
-- NAO valida concorrencia REAL entre duas sessoes ou E2E Meta.
-- Executar integralmente no Supabase SQL Editor. NAO remover ROLLBACK.

BEGIN;

DO $zion_runner$
DECLARE
  v_org uuid := pg_catalog.gen_random_uuid();
  v_store uuid := pg_catalog.gen_random_uuid();
  v_other_store uuid := pg_catalog.gen_random_uuid();
  v_other_org uuid := pg_catalog.gen_random_uuid();
  v_inbox uuid := pg_catalog.gen_random_uuid();
  v_legacy uuid := pg_catalog.gen_random_uuid();
  v_inbox_other_store uuid := pg_catalog.gen_random_uuid();
  v_inbox_other_org uuid := pg_catalog.gen_random_uuid();
  v_inbox_old_error uuid := pg_catalog.gen_random_uuid();
  v_inbox_retry uuid := pg_catalog.gen_random_uuid();
  v_ai uuid := pg_catalog.gen_random_uuid();
  v_ai_future uuid := pg_catalog.gen_random_uuid();
  v_ai_retry uuid := pg_catalog.gen_random_uuid();
  v_ai_other_store uuid := pg_catalog.gen_random_uuid();
  v_claim record;
  v_claim2 record;
  v_final record;
  v_assert record;
  v_count integer;
  v_attempt integer;
  v_error text;
  v_tests integer := 0;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PRECHECK_FAIL: auth.role nao e service_role no SQL Editor';
  END IF;

  IF (SELECT COUNT(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_whatsapp_inbox_events_by_system',
        'finalize_whatsapp_inbox_event_by_system',
        'assert_whatsapp_inbox_event_claim_by_system',
        'claim_ai_run_queue_tasks_by_system',
        'finalize_ai_run_queue_task_by_system',
        'assert_ai_run_queue_task_claim_by_system'
      ) AND p.prosecdef) <> 6 THEN
    RAISE EXCEPTION 'PRECHECK_FAIL: seis RPCs SECURITY DEFINER nao encontradas';
  END IF;
  v_tests := v_tests + 1;

  IF pg_catalog.has_function_privilege('anon',
       'public.claim_whatsapp_inbox_events_by_system(uuid,uuid,integer,text,integer,integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
       'public.claim_ai_run_queue_tasks_by_system(uuid,uuid,integer,text,integer,integer)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',
       'public.finalize_ai_run_queue_task_by_system(uuid,uuid,uuid,uuid,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY_FAIL: privilegios EXECUTE incorretos';
  END IF;
  v_tests := v_tests + 1;

  INSERT INTO public.channel_whatsapp_inbox
   (id, organization_id, store_id, provider, external_event_id, payload, received_at, processing_error)
  VALUES
   (v_inbox, v_org, v_store, 'meta', 'TEST_ONLY_' || v_inbox::text,
    '{"source":"meta_whatsapp_webhook","event_kind":"message"}'::jsonb, clock_timestamp()-interval '20 minutes', NULL),
   (v_legacy, v_org, v_store, 'meta', 'TEST_ONLY_' || v_legacy::text,
    '{"source":"legacy_fixture","event_kind":"message"}'::jsonb, clock_timestamp()-interval '19 minutes', NULL),
   (v_inbox_other_store, v_org, v_other_store, 'meta', 'TEST_ONLY_' || v_inbox_other_store::text,
    '{"source":"meta_whatsapp_webhook","event_kind":"message"}'::jsonb, clock_timestamp()-interval '18 minutes', NULL),
   (v_inbox_other_org, v_other_org, v_store, 'meta', 'TEST_ONLY_' || v_inbox_other_org::text,
    '{"source":"meta_whatsapp_webhook","event_kind":"message"}'::jsonb, clock_timestamp()-interval '17 minutes', NULL),
   (v_inbox_old_error, v_org, v_store, 'meta', 'TEST_ONLY_' || v_inbox_old_error::text,
    '{"source":"meta_whatsapp_webhook","event_kind":"message"}'::jsonb, clock_timestamp()-interval '16 minutes', 'legacy_terminal_error');

  SELECT * INTO v_claim
  FROM public.claim_whatsapp_inbox_events_by_system(v_org,v_store,10,'zion_sql_rollback_runner',120,3);
  IF NOT FOUND OR v_claim.id IS DISTINCT FROM v_inbox OR v_claim.attempt_count <> 1
     OR v_claim.claim_token IS NULL OR v_claim.claim_expires_at <= clock_timestamp()
     OR v_claim.organization_id <> v_org OR v_claim.store_id <> v_store THEN
    RAISE EXCEPTION 'INBOX_FAIL: claim inicial ou isolamento inadequado';
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.channel_whatsapp_inbox
  WHERE organization_id = v_org AND store_id = v_store AND claim_token IS NOT NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'INBOX_FAIL: reivindicou mais de um evento'; END IF;
  v_tests := v_tests + 1;

  SELECT COUNT(*) INTO v_count FROM public.claim_whatsapp_inbox_events_by_system(
    v_org,v_store,10,'zion_sql_rollback_runner_second',120,3);
  IF v_count <> 0 THEN RAISE EXCEPTION 'INBOX_FAIL: segundo claim antes do lease expirar'; END IF;
  v_tests := v_tests + 1;

  SELECT * INTO v_assert FROM public.assert_whatsapp_inbox_event_claim_by_system(
    v_org,v_store,v_inbox,v_claim.claim_token);
  IF v_assert.ok IS DISTINCT FROM true OR v_assert.id <> v_inbox
     OR v_assert.claim_token <> v_claim.claim_token THEN
    RAISE EXCEPTION 'INBOX_FAIL: assert valido rejeitado';
  END IF;
  SELECT * INTO v_assert FROM public.assert_whatsapp_inbox_event_claim_by_system(
    v_org,v_store,v_inbox,pg_catalog.gen_random_uuid());
  IF v_assert.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'INBOX_FAIL: assert com token falso aceito';
  END IF;
  v_tests := v_tests + 1;

  SELECT * INTO v_final FROM public.finalize_whatsapp_inbox_event_by_system(
    v_org,v_store,v_inbox,pg_catalog.gen_random_uuid(),'processed',NULL,3);
  IF v_final.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'INBOX_FAIL: finalizacao com token falso aceita';
  END IF;
  SELECT * INTO v_final FROM public.finalize_whatsapp_inbox_event_by_system(
    v_org,v_store,v_inbox,v_claim.claim_token,'processed',NULL,3);
  IF v_final.ok IS DISTINCT FROM true OR v_final.id <> v_inbox
     OR v_final.claim_token <> v_claim.claim_token
     OR v_final.outcome <> 'processed' OR v_final.processed_at IS NULL
     OR v_final.processing_error IS NOT NULL THEN
    RAISE EXCEPTION 'INBOX_FAIL: finalizacao correta falhou';
  END IF;
  SELECT * INTO v_final FROM public.finalize_whatsapp_inbox_event_by_system(
    v_org,v_store,v_inbox,v_claim.claim_token,'processed',NULL,3);
  IF v_final.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'INBOX_FAIL: mesma tarefa finalizada duas vezes';
  END IF;
  v_tests := v_tests + 1;

  SELECT COUNT(*) INTO v_count FROM public.claim_whatsapp_inbox_events_by_system(
    v_org,v_store,10,'zion_sql_rollback_runner',120,3);
  IF v_count <> 0 THEN RAISE EXCEPTION 'INBOX_FAIL: incluiu legacy/erro antigo/finalizado'; END IF;
  v_tests := v_tests + 1;

  SELECT * INTO v_claim FROM public.claim_whatsapp_inbox_events_by_system(
    v_org,v_other_store,10,'zion_sql_rollback_runner_other_store',120,3);
  IF NOT FOUND OR v_claim.id <> v_inbox_other_store THEN
    RAISE EXCEPTION 'INBOX_FAIL: isolamento entre lojas';
  END IF;
  SELECT * INTO v_claim FROM public.claim_whatsapp_inbox_events_by_system(
    v_other_org,v_store,10,'zion_sql_rollback_runner_other_org',120,3);
  IF NOT FOUND OR v_claim.id <> v_inbox_other_org THEN
    RAISE EXCEPTION 'INBOX_FAIL: isolamento entre organizacoes';
  END IF;
  v_tests := v_tests + 1;

  INSERT INTO public.channel_whatsapp_inbox
   (id,organization_id,store_id,provider,external_event_id,payload,received_at)
  VALUES (v_inbox_retry,v_org,v_store,'meta','TEST_ONLY_'||v_inbox_retry::text,
    '{"source":"meta_whatsapp_webhook","event_kind":"message"}'::jsonb,clock_timestamp());
  SELECT * INTO v_claim FROM public.claim_whatsapp_inbox_events_by_system(
    v_org,v_store,1,'zion_sql_rollback_runner',120,3);
  IF NOT FOUND OR v_claim.id <> v_inbox_retry OR v_claim.attempt_count <> 1 THEN
    RAISE EXCEPTION 'INBOX_RETRY_FAIL: primeira tentativa';
  END IF;
  SELECT * INTO v_final FROM public.finalize_whatsapp_inbox_event_by_system(
    v_org,v_store,v_inbox_retry,v_claim.claim_token,'retryable','fixture_failure',3);
  IF v_final.ok IS DISTINCT FROM true OR v_final.terminal IS DISTINCT FROM false
     OR v_final.processing_error NOT LIKE 'sales_ai_retryable:%' THEN
    RAISE EXCEPTION 'INBOX_RETRY_FAIL: retryable nao persistido';
  END IF;
  SELECT * INTO v_claim FROM public.claim_whatsapp_inbox_events_by_system(
    v_org,v_store,1,'zion_sql_rollback_runner',120,3);
  IF NOT FOUND OR v_claim.attempt_count <> 2 THEN
    RAISE EXCEPTION 'INBOX_RETRY_FAIL: segunda tentativa';
  END IF;
  UPDATE public.channel_whatsapp_inbox SET claim_expires_at = clock_timestamp()-interval '1 second'
  WHERE id = v_inbox_retry;
  SELECT * INTO v_assert FROM public.assert_whatsapp_inbox_event_claim_by_system(
    v_org,v_store,v_inbox_retry,v_claim.claim_token);
  IF v_assert.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'INBOX_RETRY_FAIL: lease vencido aceito';
  END IF;
  SELECT * INTO v_claim2 FROM public.claim_whatsapp_inbox_events_by_system(
    v_org,v_store,1,'zion_sql_rollback_runner_recovery',120,3);
  IF NOT FOUND OR v_claim2.attempt_count <> 3
     OR v_claim2.claim_token = v_claim.claim_token THEN
    RAISE EXCEPTION 'INBOX_RETRY_FAIL: retomada lease/token incorreta';
  END IF;
  SELECT * INTO v_final FROM public.finalize_whatsapp_inbox_event_by_system(
    v_org,v_store,v_inbox_retry,v_claim.claim_token,'processed',NULL,3);
  IF v_final.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'INBOX_RETRY_FAIL: token anterior finalizou';
  END IF;
  SELECT * INTO v_final FROM public.finalize_whatsapp_inbox_event_by_system(
    v_org,v_store,v_inbox_retry,v_claim2.claim_token,'retryable','third_failed',3);
  IF v_final.ok IS DISTINCT FROM true OR v_final.terminal IS DISTINCT FROM true
     OR v_final.processing_error NOT LIKE 'sales_ai_failed_final:%' THEN
    RAISE EXCEPTION 'INBOX_RETRY_FAIL: terceira tentativa nao terminal';
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.claim_whatsapp_inbox_events_by_system(
    v_org,v_store,10,'zion_sql_rollback_runner',120,3);
  IF v_count <> 0 THEN RAISE EXCEPTION 'INBOX_RETRY_FAIL: terminal reivindicado'; END IF;
  v_tests := v_tests + 1;

  INSERT INTO public.ai_run_queue
   (id,organization_id,store_id,lead_id,conversation_id,queue_key,input,enqueued_at)
  VALUES
    (v_ai,v_org,v_store,pg_catalog.gen_random_uuid(),pg_catalog.gen_random_uuid(),
     'TEST_ONLY_'||v_ai::text,
     '{"type":"resume_sales_conversation","reason":"test","anchorMessageId":"synthetic"}'::jsonb,
     clock_timestamp()-interval '10 minutes'),
    (v_ai_future,v_org,v_store,pg_catalog.gen_random_uuid(),pg_catalog.gen_random_uuid(),
     'TEST_ONLY_'||v_ai_future::text,
     pg_catalog.jsonb_build_object('type','resume_sales_conversation','reason','test',
                                   'resumeAt',(clock_timestamp()+interval '1 day')::text),
     clock_timestamp()-interval '9 minutes'),
    (v_ai_other_store,v_org,v_other_store,pg_catalog.gen_random_uuid(),pg_catalog.gen_random_uuid(),
     'TEST_ONLY_'||v_ai_other_store::text,
     '{"type":"resume_sales_conversation","reason":"test"}'::jsonb,
     clock_timestamp()-interval '8 minutes');
  SELECT * INTO v_claim FROM public.claim_ai_run_queue_tasks_by_system(
    v_org,v_store,10,'zion_sql_rollback_runner',120,3);
  IF NOT FOUND OR v_claim.id <> v_ai OR v_claim.attempt_count <> 1
     OR v_claim.input->>'type' <> 'resume_sales_conversation'
     OR v_claim.claim_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'AI_FAIL: claim inicial ou resumeAt futuro';
  END IF;
  v_tests := v_tests + 1;

  SELECT COUNT(*) INTO v_count FROM public.claim_ai_run_queue_tasks_by_system(
    v_org,v_store,10,'zion_sql_rollback_runner_second',120,3);
  IF v_count <> 0 THEN RAISE EXCEPTION 'AI_FAIL: duplo claim ou resumeAt futuro ignorado'; END IF;
  v_tests := v_tests + 1;

  SELECT * INTO v_assert FROM public.assert_ai_run_queue_task_claim_by_system(
    v_org,v_store,v_ai,v_claim.claim_token);
  IF v_assert.ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AI_FAIL: assert valido';
  END IF;
  SELECT * INTO v_assert FROM public.assert_ai_run_queue_task_claim_by_system(
    v_org,v_store,v_ai,pg_catalog.gen_random_uuid());
  IF v_assert.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AI_FAIL: assert falso token aceito';
  END IF;
  SELECT * INTO v_final FROM public.finalize_ai_run_queue_task_by_system(
    v_org,v_store,v_ai,pg_catalog.gen_random_uuid(),'processed',NULL,3);
  IF v_final.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AI_FAIL: finalizacao por token invalido';
  END IF;
  SELECT * INTO v_final FROM public.finalize_ai_run_queue_task_by_system(
    v_org,v_store,v_ai,v_claim.claim_token,'processed',NULL,3);
  IF v_final.ok IS DISTINCT FROM true OR v_final.outcome <> 'processed'
     OR v_final.id <> v_ai OR v_final.claim_token <> v_claim.claim_token
     OR v_final.processed_at IS NULL OR v_final.processing_error IS NOT NULL THEN
    RAISE EXCEPTION 'AI_FAIL: finalizacao valida';
  END IF;
  v_tests := v_tests + 1;

  INSERT INTO public.ai_run_queue
   (id,organization_id,store_id,lead_id,conversation_id,queue_key,input,enqueued_at)
  VALUES (v_ai_retry,v_org,v_store,pg_catalog.gen_random_uuid(),pg_catalog.gen_random_uuid(),
          'TEST_ONLY_'||v_ai_retry::text,
          '{"type":"resume_sales_conversation","reason":"test"}'::jsonb,clock_timestamp());
  SELECT * INTO v_claim FROM public.claim_ai_run_queue_tasks_by_system(
    v_org,v_store,1,'zion_sql_rollback_runner',120,3);
  IF NOT FOUND OR v_claim.id <> v_ai_retry OR v_claim.attempt_count <> 1 THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: primeira tentativa';
  END IF;
  SELECT * INTO v_final FROM public.finalize_ai_run_queue_task_by_system(
    v_org,v_store,v_ai_retry,v_claim.claim_token,'retryable','test_failure',3);
  IF v_final.ok IS DISTINCT FROM true OR v_final.terminal IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: retryable';
  END IF;
  SELECT * INTO v_claim FROM public.claim_ai_run_queue_tasks_by_system(
    v_org,v_store,1,'zion_sql_rollback_runner',120,3);
  IF NOT FOUND OR v_claim.attempt_count <> 2 THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: segunda tentativa';
  END IF;
  UPDATE public.ai_run_queue SET claim_expires_at = clock_timestamp()-interval '1 second'
  WHERE id = v_ai_retry;
  SELECT * INTO v_assert FROM public.assert_ai_run_queue_task_claim_by_system(
    v_org,v_store,v_ai_retry,v_claim.claim_token);
  IF v_assert.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: lease expirado validado';
  END IF;
  SELECT * INTO v_claim2 FROM public.claim_ai_run_queue_tasks_by_system(
    v_org,v_store,1,'zion_sql_rollback_runner_recovery',120,3);
  IF NOT FOUND OR v_claim2.attempt_count <> 3
     OR v_claim2.claim_token = v_claim.claim_token THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: retomada lease/token';
  END IF;
  SELECT * INTO v_final FROM public.finalize_ai_run_queue_task_by_system(
    v_org,v_store,v_ai_retry,v_claim.claim_token,'processed',NULL,3);
  IF v_final.ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: token obsoleto aceito';
  END IF;
  SELECT * INTO v_final FROM public.finalize_ai_run_queue_task_by_system(
    v_org,v_store,v_ai_retry,v_claim2.claim_token,'retryable','third_failure',3);
  IF v_final.ok IS DISTINCT FROM true OR v_final.terminal IS DISTINCT FROM true
     OR v_final.processing_error NOT LIKE 'sales_ai_failed_final:%' THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: terceira tentativa nao terminal';
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.claim_ai_run_queue_tasks_by_system(
    v_org,v_store,10,'zion_sql_rollback_runner',120,3);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AI_RETRY_FAIL: terminal ou agendamento futuro reivindicado';
  END IF;
  v_tests := v_tests + 1;

  SELECT * INTO v_claim FROM public.claim_ai_run_queue_tasks_by_system(
    v_org,v_other_store,1,'zion_sql_rollback_runner_other_store',120,3);
  IF NOT FOUND OR v_claim.id <> v_ai_other_store THEN
    RAISE EXCEPTION 'AI_FAIL: isolamento por loja';
  END IF;
  v_tests := v_tests + 1;

  IF public._zion_ai_run_resume_is_due(
    pg_catalog.jsonb_build_object('resumeAt',(clock_timestamp()+interval '1 day')::text))
     OR NOT public._zion_ai_run_resume_is_due(
    pg_catalog.jsonb_build_object('resumeAt',(clock_timestamp()-interval '1 day')::text)) THEN
    RAISE EXCEPTION 'AI_FAIL: controle de tempo resumeAt';
  END IF;
  v_tests := v_tests + 1;

  RAISE NOTICE 'P9_9_3_B_WORKER_CLAIMS_TESTS_PASS = %, tudo sintetico e dentro de transacao com ROLLBACK',v_tests;
END;
$zion_runner$;

-- NADA DESTA TRANSACAO PERMANECE NO BANCO.
ROLLBACK;

-- Este SELECT so deve ser interpretado como PASS se TODAS as instrucoes
-- acima executaram sem erro. Nenhuma execucao remota da IA ocorreu.
SELECT
  'P9_9_3_B_WORKER_CLAIMS_ROLLBACK_PASS' AS resultado,
  'Fixtures sinteticas descartadas por ROLLBACK; sem E2E nem teste de duas sessoes' AS escopo,
  15 AS verificacoes_logicas_previstas;
