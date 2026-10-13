-- ZION-ADM / D10-G0
-- Transactional contract-rule review validation.
--
-- PREREQUISITE:
-- Migration 20261012120000 must already be applied.
--
-- This runner creates synthetic fixtures inside BEGIN/ROLLBACK.
-- Do not run in production before explicit approval.
-- No COMMIT is included.
-- Concurrent two-session testing is a separate requirement.

BEGIN;

DO $test$
DECLARE
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_other_store uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();

  v_template uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_rule uuid := gen_random_uuid();

  v_key1 uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v_key3 uuid := gen_random_uuid();
  v_key4 uuid := gen_random_uuid();

  v_rpc oid;
  v_result jsonb;
  v_first_result jsonb;
  v_event_id uuid;
  v_count bigint;
  v_revision bigint;
BEGIN
  -- The immutable-history trigger tests require the table owner.
  -- Fail explicitly instead of accepting permission errors.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'D10_G0_TEST_REQUIRES_POSTGRES_OWNER';
  END IF;

  -- 01. Canonical RPC exists.
  v_rpc := to_regprocedure(
    'public.review_store_contract_template_rule_by_system(uuid,uuid,uuid,uuid,bigint,uuid,text,text,text)'
  );

  IF v_rpc IS NULL THEN
    RAISE EXCEPTION 'D10_G0_TEST_RPC_MISSING';
  END IF;

  IF (
    SELECT pg_catalog.pg_get_userbyid(p.proowner)
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_rpc
  ) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'D10_G0_TEST_RPC_OWNER';
  END IF;

  RAISE NOTICE 'PASS 01 - canonical RPC exists';

  -- 02. Only the backend service role may execute it.
  IF NOT has_function_privilege(
    'service_role', v_rpc, 'EXECUTE'
  )
  OR has_function_privilege(
    'anon', v_rpc, 'EXECUTE'
  )
  OR has_function_privilege(
    'authenticated', v_rpc, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'D10_G0_TEST_RPC_PRIVILEGES';
  END IF;

  IF NOT (
    SELECT prosecdef
    FROM pg_catalog.pg_proc
    WHERE oid = v_rpc
  ) THEN
    RAISE EXCEPTION 'D10_G0_TEST_RPC_SECURITY_DEFINER';
  END IF;

  RAISE NOTICE 'PASS 02 - RPC authority';

  -- 03. History table exists and is protected.
  IF to_regclass(
    'public.store_contract_template_rule_review_events'
  ) IS NULL THEN
    RAISE EXCEPTION 'D10_G0_TEST_HISTORY_MISSING';
  END IF;

  IF has_table_privilege(
    'anon',
    'public.store_contract_template_rule_review_events',
    'SELECT'
  )
  OR has_table_privilege(
    'authenticated',
    'public.store_contract_template_rule_review_events',
    'SELECT'
  )
  OR has_table_privilege(
    'service_role',
    'public.store_contract_template_rule_review_events',
    'UPDATE'
  )
  OR has_table_privilege(
    'service_role',
    'public.store_contract_template_rule_review_events',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'D10_G0_TEST_HISTORY_PRIVILEGES';
  END IF;

  RAISE NOTICE 'PASS 03 - history access protection';

  -- 04. Synthetic template, version and rule.
  -- All rows are rolled back at the end.

  INSERT INTO public.store_contract_templates (
    id,
    organization_id,
    store_id,
    status
  )
  VALUES (
    v_template,
    v_org,
    v_store,
    'draft'
  );

  INSERT INTO public.store_contract_template_versions (
    id,
    template_id,
    organization_id,
    store_id,
    version_number,
    status,
    storage_bucket,
    storage_path
  )
  VALUES (
    v_version,
    v_template,
    v_org,
    v_store,
    1,
    'awaiting_review',
    'zion-d10-g0-test',
    'rollback-only'
  );

  INSERT INTO public.store_contract_template_extracted_rules (
    id,
    template_version_id,
    organization_id,
    store_id,
    rule_key,
    rule_group,
    label,
    value_text,
    review_status
  )
  VALUES (
    v_rule,
    v_version,
    v_org,
    v_store,
    'test_rule',
    'general',
    'Original label',
    'Original value',
    'pending'
  );

  SELECT review_revision
  INTO v_revision
  FROM public.store_contract_template_extracted_rules
  WHERE id = v_rule;

  IF v_revision IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'D10_G0_TEST_INITIAL_REVISION';
  END IF;

  RAISE NOTICE 'PASS 04 - synthetic fixture and revision zero';

  -- 05. Approve the rule.
  v_first_result :=
    public.review_store_contract_template_rule_by_system(
      v_rule,
      v_org,
      v_store,
      v_actor,
      0,
      v_key1,
      'approved',
      NULL,
      NULL
    );

  IF v_first_result->>'replayed' IS DISTINCT FROM 'false'
     OR v_first_result#>>'{rule,review_status}'
       IS DISTINCT FROM 'approved'
     OR v_first_result#>>'{rule,review_revision}'
       IS DISTINCT FROM '1'
  THEN
    RAISE EXCEPTION 'D10_G0_TEST_APPROVAL_RESULT';
  END IF;

  v_event_id := (v_first_result->>'eventId')::uuid;

  RAISE NOTICE 'PASS 05 - approval and revision increment';

  -- 06. Audit the previous and new states.
  IF NOT EXISTS (
    SELECT 1
    FROM public.store_contract_template_rule_review_events
    WHERE id = v_event_id
      AND organization_id = v_org
      AND store_id = v_store
      AND rule_id = v_rule
      AND actor_user_id = v_actor
      AND previous_review_status = 'pending'
      AND new_review_status = 'approved'
      AND expected_revision = 0
      AND new_revision = 1
  ) THEN
    RAISE EXCEPTION 'D10_G0_TEST_AUDIT_EVENT';
  END IF;

  RAISE NOTICE 'PASS 06 - append-only audit recorded';

  -- 07. Exact retry is idempotent.
  v_result :=
    public.review_store_contract_template_rule_by_system(
      v_rule,
      v_org,
      v_store,
      v_actor,
      0,
      v_key1,
      'approved',
      NULL,
      NULL
    );

  IF v_result->>'replayed' IS DISTINCT FROM 'true'
     OR v_result->>'eventId'
       IS DISTINCT FROM v_first_result->>'eventId'
  THEN
    RAISE EXCEPTION 'D10_G0_TEST_IDEMPOTENT_REPLAY';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.store_contract_template_rule_review_events
  WHERE rule_id = v_rule;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'D10_G0_TEST_DUPLICATE_EVENT';
  END IF;

  RAISE NOTICE 'PASS 07 - exact replay without duplication';

  -- 08. Same key with a different payload must fail.
  BEGIN
    PERFORM
      public.review_store_contract_template_rule_by_system(
        v_rule,
        v_org,
        v_store,
        v_actor,
        0,
        v_key1,
        'rejected',
        NULL,
        NULL
      );

    RAISE EXCEPTION 'D10_G0_TEST_COLLISION_NOT_BLOCKED';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <>
      'ZION_ADM_RULE_REVIEW_IDEMPOTENCY_KEY_REUSED'
    THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'PASS 08 - idempotency collision blocked';

  -- 09. A stale revision must fail.
  BEGIN
    PERFORM
      public.review_store_contract_template_rule_by_system(
        v_rule,
        v_org,
        v_store,
        v_actor,
        0,
        v_key2,
        'edited',
        'Outdated edit',
        NULL
      );

    RAISE EXCEPTION 'D10_G0_TEST_STALE_NOT_BLOCKED';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ZION_ADM_RULE_REVIEW_CONFLICT' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'PASS 09 - stale revision blocked';

  -- 10. Foreign-store access must fail.
  BEGIN
    PERFORM
      public.review_store_contract_template_rule_by_system(
        v_rule,
        v_org,
        v_other_store,
        v_actor,
        1,
        v_key4,
        'rejected',
        NULL,
        NULL
      );

    RAISE EXCEPTION 'D10_G0_TEST_CROSS_STORE_NOT_BLOCKED';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <>
      'ZION_ADM_RULE_REVIEW_NOT_FOUND_OR_OUT_OF_SCOPE'
    THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'PASS 10 - cross-store scope blocked';

  -- 11. A valid edit succeeds with the next revision.
  v_result :=
    public.review_store_contract_template_rule_by_system(
      v_rule,
      v_org,
      v_store,
      v_actor,
      1,
      v_key2,
      'edited',
      'Reviewed value',
      NULL
    );

  IF v_result#>>'{rule,review_status}'
     IS DISTINCT FROM 'edited'
     OR v_result#>>'{rule,value_text}'
       IS DISTINCT FROM 'Reviewed value'
     OR v_result#>>'{rule,review_revision}'
       IS DISTINCT FROM '2'
  THEN
    RAISE EXCEPTION 'D10_G0_TEST_EDIT';
  END IF;

  RAISE NOTICE 'PASS 11 - edit and second revision';

  -- 12. Ignore/reject is valid without a reason.
  v_result :=
    public.review_store_contract_template_rule_by_system(
      v_rule,
      v_org,
      v_store,
      v_actor,
      2,
      v_key3,
      'rejected',
      NULL,
      NULL
    );

  IF v_result#>>'{rule,review_status}'
     IS DISTINCT FROM 'rejected'
     OR v_result#>>'{rule,review_revision}'
       IS DISTINCT FROM '3'
  THEN
    RAISE EXCEPTION 'D10_G0_TEST_REJECT';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.store_contract_template_rule_review_events
  WHERE rule_id = v_rule;

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'D10_G0_TEST_EVENT_COUNT';
  END IF;

  RAISE NOTICE 'PASS 12 - ignored rule and three audit events';

  -- 13. Existing history cannot be updated.
  BEGIN
    UPDATE public.store_contract_template_rule_review_events
    SET new_review_status = 'edited'
    WHERE id = v_event_id;

    RAISE EXCEPTION 'D10_G0_TEST_HISTORY_UPDATE_ALLOWED';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <>
      'ZION_ADM_CONTRACT_RULE_REVIEW_HISTORY_IMMUTABLE'
    THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'PASS 13 - history UPDATE blocked';

  -- 14. Existing history cannot be deleted.
  BEGIN
    DELETE FROM public.store_contract_template_rule_review_events
    WHERE id = v_event_id;

    RAISE EXCEPTION 'D10_G0_TEST_HISTORY_DELETE_ALLOWED';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <>
      'ZION_ADM_CONTRACT_RULE_REVIEW_HISTORY_IMMUTABLE'
    THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'PASS 14 - history DELETE blocked';

  -- 15. A finalized version cannot accept new reviews.
  UPDATE public.store_contract_template_versions
  SET
    status = 'rejected',
    rejected_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = v_version;

  BEGIN
    PERFORM
      public.review_store_contract_template_rule_by_system(
        v_rule,
        v_org,
        v_store,
        v_actor,
        3,
        v_key4,
        'approved',
        NULL,
        NULL
      );

    RAISE EXCEPTION 'D10_G0_TEST_FINAL_VERSION_MUTATED';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <>
      'ZION_ADM_RULE_REVIEW_VERSION_READ_ONLY'
    THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'PASS 15 - finalized version protected';

  -- 16. Exact replay still works after finalization.
  v_result :=
    public.review_store_contract_template_rule_by_system(
      v_rule,
      v_org,
      v_store,
      v_actor,
      0,
      v_key1,
      'approved',
      NULL,
      NULL
    );

  IF v_result->>'replayed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'D10_G0_TEST_FINALIZED_REPLAY';
  END IF;

  RAISE NOTICE 'PASS 16 - replay of finalized version';

  RAISE NOTICE
    'D10_G0_TRANSACTIONAL_CHECKS_COMPLETE: 16 PASS';
END;
$test$;

-- Do not persist synthetic test data.
ROLLBACK;
