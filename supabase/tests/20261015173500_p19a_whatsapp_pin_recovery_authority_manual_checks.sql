-- P19-A / 4-B.1: reviewed v2 runner for 20261015173000 authority.
-- READ-ONLY schema/ACL/contract assertions wrapped in rollback.
-- Accept catalog representations search_path= and search_path="" for SQL empty path.
-- No live Meta operations, PIN reveal or mutation of production data.
-- Does not call Graph, reveal PINs, or execute recovery RPCs.
BEGIN;
DO $checks$
DECLARE
    v_names text[] := ARRAY[
      'prepare_whatsapp_pin_recovery_attempt_by_system',
      'begin_whatsapp_pin_recovery_attempt_by_system',
      'create_whatsapp_pin_recovery_replacement_secret_by_system',
      'record_whatsapp_pin_recovery_remote_result_by_system',
      'authorize_whatsapp_pin_recovery_materialization_token_by_system',
      'reconcile_whatsapp_pin_recovery_remote_confirmation_by_system',
      'finalize_whatsapp_pin_recovery_materialization_by_system'
    ];
    v_name text;
    v_fn oid;
    v_count integer;
    v_def text;
BEGIN
    IF pg_catalog.to_regclass('public.whatsapp_pin_recovery_attempts') IS NULL OR
       pg_catalog.to_regclass('public.whatsapp_pin_recovery_events') IS NULL THEN
        RAISE EXCEPTION 'FAIL: recovery ledger or event table missing';
    END IF;
    RAISE NOTICE 'PASS: recovery ledger and event table';

    SELECT count(*) INTO v_count
      FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name='whatsapp_pin_recovery_attempts'
       AND c.column_name IN ('historical_secret_id','replacement_secret_id',
         'session_binding_hash','remote_evidence_hash','access_token_fingerprint',
         'materialization_token_fingerprint','materialization_token_validated_at',
         'operation_id','authorization_expires_at');
    IF v_count <> 9 THEN RAISE EXCEPTION 'FAIL: recovery ledger column contract'; END IF;
    RAISE NOTICE 'PASS: columns and recovery bindings';

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_indexes i
         WHERE i.schemaname='public' AND i.tablename='whatsapp_pin_recovery_attempts'
           AND i.indexname='whatsapp_pin_recovery_global_nonterminal_phone_uidx'
    ) THEN RAISE EXCEPTION 'FAIL: global uncertain/executing lock'; END IF;
    RAISE NOTICE 'PASS: global nonterminal phone uniqueness';
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=idx.relnamespace
        WHERE n.nspname='public' AND idx.relname='whatsapp_pin_recovery_global_nonterminal_phone_uidx'
          AND i.indisunique AND i.indpred IS NOT NULL
    ) THEN RAISE EXCEPTION 'FAIL: global phone index must be partial + unique'; END IF;
    RAISE NOTICE 'PASS: global phone unique partial index';

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid='public.whatsapp_pin_recovery_events'::regclass
          AND t.tgname='whatsapp_pin_recovery_events_immutable'
    ) THEN RAISE EXCEPTION 'FAIL: append-only event trigger'; END IF;
    RAISE NOTICE 'PASS: append-only audit trigger';
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   WHERE c.oid='public.whatsapp_pin_recovery_attempts'::regclass AND c.relrowsecurity)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   WHERE c.oid='public.whatsapp_pin_recovery_events'::regclass AND c.relrowsecurity)
    THEN RAISE EXCEPTION 'FAIL: RLS must be enabled on both recovery tables'; END IF;
    RAISE NOTICE 'PASS: RLS enabled';

    IF pg_catalog.has_table_privilege('anon','public.whatsapp_pin_recovery_attempts','SELECT')
       OR pg_catalog.has_table_privilege('authenticated','public.whatsapp_pin_recovery_attempts','SELECT')
       OR pg_catalog.has_table_privilege('service_role','public.whatsapp_pin_recovery_attempts','SELECT')
       OR pg_catalog.has_table_privilege('anon','public.whatsapp_pin_recovery_events','SELECT')
       OR pg_catalog.has_table_privilege('authenticated','public.whatsapp_pin_recovery_events','SELECT')
    THEN RAISE EXCEPTION 'FAIL: table SELECT ACLs'; END IF;
    RAISE NOTICE 'PASS: no direct ledger/event SELECT granted';

    FOREACH v_name IN ARRAY v_names LOOP
        SELECT p.oid INTO v_fn
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname=v_name;
        IF v_fn IS NULL THEN RAISE EXCEPTION 'FAIL: missing RPC %', v_name; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_fn
                          AND p.prosecdef AND EXISTS(
                            SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS c(setting)
                            WHERE c.setting IN ('search_path=', 'search_path=""'))) THEN
            RAISE EXCEPTION 'FAIL: security-definer/search_path %',v_name;
        END IF;
        IF pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE') THEN
            RAISE EXCEPTION 'FAIL: RPC ACL %',v_name;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS: seven service_role-only SECURITY DEFINER RPCs';
    IF pg_catalog.to_regprocedure('pg_catalog.sha256(bytea)') IS NULL THEN
        RAISE EXCEPTION 'FAIL: SHA-256 bytea function unavailable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='external_integrations'
          AND column_name='access_token' AND data_type='text') THEN
        RAISE EXCEPTION 'FAIL: external_integrations.access_token text missing';
    END IF;
    RAISE NOTICE 'PASS: canonical token column and hash function exist';

    SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_def
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='finalize_whatsapp_pin_recovery_materialization_by_system';
    IF v_def IS NULL
       OR position('materialization_token_fingerprint' IN v_def)=0
       OR position('pg_catalog.sha256' IN v_def)=0
       OR position('e.access_token' IN v_def)=0
       OR position('activate_whatsapp_phone_security_secret_by_system' IN v_def)=0
    THEN RAISE EXCEPTION 'FAIL: finalization requires canonical access-token proof + activation'; END IF;
    RAISE NOTICE 'PASS: finalization checks exact materialized token and activates canonical secret';

    SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_def
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='authorize_whatsapp_pin_recovery_materialization_token_by_system';
    IF v_def IS NULL OR position('remote_confirmed' IN v_def)=0
       OR position('session_binding_hash' IN v_def)=0
       OR position('materialization_token_validated_at' IN v_def)=0
    THEN RAISE EXCEPTION 'FAIL: refreshed OAuth binding contract'; END IF;
    RAISE NOTICE 'PASS: refreshed OAuth binding requires confirmed remote result + session';

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
         WHERE p.proname='reconcile_whatsapp_pin_recovery_remote_confirmation_by_system'
           AND position('ZION_PIN_RECOVERY_INDEPENDENT_META_EVIDENCE_NOT_IMPLEMENTED'
               IN pg_catalog.pg_get_functiondef(p.oid)) > 0
    ) THEN RAISE EXCEPTION 'FAIL: uncertain reconciliation must fail closed'; END IF;
    RAISE NOTICE 'PASS: remote_uncertain cannot be marked confirmed without independent evidence';
    -- This runner is intentionally structural, not a behavioral execution proof.
    RAISE NOTICE 'NOTE: functional SQL rollback tests and TS mocked integration remain required';
    RAISE NOTICE 'PASS: schema/ACL runner completed; no PIN or Graph operations executed';
END;
$checks$;
ROLLBACK;
