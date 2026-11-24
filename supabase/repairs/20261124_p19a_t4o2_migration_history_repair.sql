-- ZION P19A 4-T4-O.2: targeted history reconciliation only.
-- No application migration is executed. Record version and name only.
-- Revision B: use hashes in the explicit restricted search_path, verified
-- against N34A via T4O.2-A (20/20 original context matches).
-- T4M.1 verified bodies; all existing ACL and owner checks retained.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $guard$
DECLARE
    r record;
    p pg_catalog.pg_proc%rowtype;
    c pg_catalog.pg_class%rowtype;
BEGIN
    IF current_user <> 'postgres' THEN
        RAISE EXCEPTION 'POSTGRES_REQUIRED';
    END IF;
    FOR r IN SELECT * FROM (VALUES
        ('function', 'public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)', '3b81660402c1f277b05043f2cff7074c', '{postgres=X/postgres}'),
        ('function', 'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)', 'f086bc2e28c5b6ba2c10c23317385893', '{postgres=X/postgres}'),
        ('function', 'public._conversation_transition_context(uuid)', 'ce6e2fadb6cbbaa7fb1a87425b7e3b5b', '{postgres=X/postgres}'),
        ('function', 'public.assistant_push_system_message(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)', 'af858708adeda43727b2cb9cf1971322', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
        ('function', 'public.assistant_send_human_message(uuid,uuid,text)', '4345cd8661f67071ecb9e982aae18c38', '{postgres=X/postgres,authenticated=X/postgres}'),
        ('function', 'public.create_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'f5ac7b74936265e6f272b64f8f20ba23', '{postgres=X/postgres,authenticated=X/postgres}'),
        ('function', 'public.ensure_human_takeover_lease_by_system(uuid)', 'f16d33fa94c17e80b1415afabd98b0f2', '{postgres=X/postgres,service_role=X/postgres}'),
        ('function', 'public.execute_assistant_human_control_command_scoped(uuid,uuid,uuid)', '81074ab0bf59cbb877989c73fc9a6072', '{postgres=X/postgres,authenticated=X/postgres}'),
        ('function', 'public.human_release_conversation_to_ai(uuid,text,text)', 'a9c777372c74b90c3b5e411d2625c513', '{postgres=X/postgres}'),
        ('function', 'public.human_takeover_conversation(uuid,text)', '5ad0b64968be074782d01443ab117e56', '{postgres=X/postgres,service_role=X/postgres}'),
        ('function', 'public.insert_message(uuid,text,text,text,text,text,text,jsonb)', 'eb3c34a01ad71d60635aba663a3e2872', '{postgres=X/postgres,service_role=X/postgres}'),
        ('function', 'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)', '4d44f7b4a2ad6dd33d2806ae251d8e2e', '{postgres=X/postgres,service_role=X/postgres}'),
        ('function', 'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)', '70ab29097ea4fb55be6d05afbac35492', '{postgres=X/postgres,service_role=X/postgres}'),
        ('function', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', '9757cb7e6ba68054a6c616aecc46381d', '{postgres=X/postgres,authenticated=X/postgres}'),
        ('function', 'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)', '4cfa55d9c9a47bfbb46ae5820d8afa2c', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
        ('function', 'public.process_stale_human_conversations()', '3b5ea075a6b50ef1265db3ac8f6fed71', '{postgres=X/postgres,service_role=X/postgres}'),
        ('function', 'public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)', '94eccfe169cbff541567854e23499ae5', '{postgres=X/postgres,service_role=X/postgres}'),
        ('function', 'public.release_human_takeover_hard_hold_scoped(uuid,uuid,uuid,text,text)', 'a7b5f7817af566ee986359db93053431', '{postgres=X/postgres,authenticated=X/postgres}'),
        ('function', 'public.release_human_takeover_lease_by_system(uuid,text)', '52a9928e66525daf26192fb2fe9dc5dd', '{postgres=X/postgres}'),
        ('function', 'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)', 'ab31de10abacbf51e03a2fff219a58c0', '{postgres=X/postgres,service_role=X/postgres}'),
        ('table', 'public.assistant_human_control_command_receipts', NULL::text, '{postgres=arwdDxtm/postgres}'),
        ('table', 'public.conversation_human_takeover_activity_events', NULL::text, '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'),
        ('table', 'public.conversation_human_takeover_hard_hold_decisions', NULL::text, '{postgres=arwdDxtm/postgres}'),
        ('table', 'public.conversation_human_takeover_leases', NULL::text, '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
    ) AS expected(kind, signature, body_hash, acl)
    LOOP
        IF r.kind = 'function' THEN
            SELECT * INTO p FROM pg_catalog.pg_proc
            WHERE oid = pg_catalog.to_regprocedure(r.signature);
            IF NOT FOUND OR pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) IS DISTINCT FROM r.body_hash
               OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
               OR p.prosecdef IS DISTINCT FROM true
               OR p.proacl::text IS DISTINCT FROM r.acl THEN
                RAISE EXCEPTION 'N34A_CATALOG_DIVERGENCE: %', r.signature;
            END IF;
            IF r.signature = 'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'
               AND p.proconfig IS DISTINCT FROM ARRAY['search_path=""', 'row_security=off']::text[] THEN
                RAISE EXCEPTION 'N34A_WORKER_CONFIG_DIVERGENCE';
            END IF;
        ELSE
            SELECT * INTO c FROM pg_catalog.pg_class
            WHERE oid = pg_catalog.to_regclass(r.signature);
            IF NOT FOUND OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres'
               OR c.relrowsecurity IS DISTINCT FROM true
               OR c.relacl::text IS DISTINCT FROM r.acl THEN
                RAISE EXCEPTION 'N34A_TABLE_DIVERGENCE: %', r.signature;
            END IF;
        END IF;
    END LOOP;

    FOR r IN SELECT * FROM (VALUES
        ('public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)', 'b809076da9fde50c45536760718461dc', 'search_path=pg_catalog, pg_temp, public, extensions'),
        ('public.zion_admin_provision_account(uuid,text,text)', '78c14157460442a2747abe50e9035efb', 'search_path=pg_catalog, public, pg_temp')
    ) AS expected(signature, body_hash, path_config)
    LOOP
        SELECT * INTO p FROM pg_catalog.pg_proc
        WHERE oid = pg_catalog.to_regprocedure(r.signature);
        IF NOT FOUND OR md5(btrim(replace(p.prosrc, chr(13), ''), chr(10))) IS DISTINCT FROM r.body_hash
           OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
           OR p.prosecdef IS DISTINCT FROM true
           OR NOT coalesce(p.proconfig @> ARRAY[r.path_config, 'row_security=off']::text[], false)
           OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
           OR has_function_privilege('anon', p.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'T4M_CATALOG_DIVERGENCE: %', r.signature;
        END IF;
    END LOOP;
END;
$guard$;

LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;

DO $record$
DECLARE
    n integer;
BEGIN
    IF EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version IN ('20261124223000', '20261124224000')
    ) THEN
        RAISE EXCEPTION 'TARGET_HISTORY_ALREADY_PRESENT';
    END IF;

    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES
        ('20261124223000', 'p19a_4_t3_human_control_production_reconciliation'),
        ('20261124224000', 'p19a_gate_policy_bootstrap');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 2 THEN RAISE EXCEPTION 'HISTORY_INSERT_COUNT_INVALID'; END IF;
END;
$record$;

COMMIT;

SELECT version, name, 'REGISTERED' AS history_status
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261124223000', '20261124224000')
ORDER BY version;
