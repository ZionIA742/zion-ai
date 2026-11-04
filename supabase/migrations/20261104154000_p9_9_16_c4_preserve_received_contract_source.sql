-- ZION P9.9.16 C.4
-- Preserva origem canonica de documentos recebidos.
-- Nao processa filas, nao atualiza notificacoes antigas e nao envia WhatsApp.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
    v_target regprocedure :=
        'public.assistant_enqueue_internal_notification(uuid,uuid,text,text,text,text,jsonb,uuid,uuid,uuid,text)'::regprocedure;

    v_definition text;
    v_definition_after text;

    v_owner oid;
    v_owner_after oid;

    v_security_definer boolean;
    v_security_definer_after boolean;

    v_config text[];
    v_config_after text[];

    v_acl aclitem[];
    v_acl_after aclitem[];

    v_old text := $old$
        WHEN v_notification_type = 'assistant_panel_sync'
          THEN 'assistant_panel_whatsapp_sync'
        ELSE 'assistant_enqueue_internal_notification'
$old$;

    v_new text := $new$
        WHEN v_notification_type = 'assistant_panel_sync'
          THEN 'assistant_panel_whatsapp_sync'
        WHEN v_notification_type = 'important_alert'
          AND p_context ->> 'source' =
              'received_contract_document_evidence_v1'
          AND p_context ->> 'reason' =
              'received_contract_document'
          AND p_context ->> 'needs_human_action' = 'true'
          AND NULLIF(
              BTRIM(p_context ->> 'received_evidence_source_message_id'),
              ''
          ) IS NOT NULL
          AND NULLIF(
              BTRIM(p_context ->> 'received_document_storage_bucket'),
              ''
          ) IS NOT NULL
          AND NULLIF(
              BTRIM(p_context ->> 'received_document_storage_path'),
              ''
          ) IS NOT NULL
          THEN 'received_contract_document_evidence_v1'
        ELSE 'assistant_enqueue_internal_notification'
$new$;

BEGIN
    SELECT
        pg_get_functiondef(p.oid),
        p.proowner,
        p.prosecdef,
        p.proconfig,
        p.proacl
    INTO
        v_definition,
        v_owner,
        v_security_definer,
        v_config,
        v_acl
    FROM pg_proc p
    WHERE p.oid = v_target::oid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_C4_FUNCTION_NOT_FOUND';
    END IF;

    IF pg_get_userbyid(v_owner) <> 'postgres' THEN
        RAISE EXCEPTION 'P9_C4_UNEXPECTED_OWNER';
    END IF;

    IF v_security_definer IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'P9_C4_UNEXPECTED_SECURITY_MODE';
    END IF;

    IF v_config IS DISTINCT FROM
       ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
    THEN
        RAISE EXCEPTION 'P9_C4_UNEXPECTED_SEARCH_PATH';
    END IF;

    IF NOT has_function_privilege(
        'service_role',
        v_target::oid,
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'P9_C4_MISSING_SERVICE_ROLE_PERMISSION';
    END IF;

    IF STRPOS(v_definition, v_new) > 0
       AND STRPOS(v_definition, v_old) = 0
    THEN
        RAISE NOTICE 'P9_C4_ALREADY_APPLIED';

    ELSE
        IF STRPOS(v_definition, v_old) = 0 THEN
            RAISE EXCEPTION 'P9_C4_ORIGINAL_CASE_NOT_FOUND';
        END IF;

        IF STRPOS(
            SUBSTRING(
                v_definition FROM
                STRPOS(v_definition, v_old) + LENGTH(v_old)
            ),
            v_old
        ) > 0 THEN
            RAISE EXCEPTION 'P9_C4_MULTIPLE_CASE_MATCHES';
        END IF;

        IF STRPOS(v_definition, 'v_context :=') = 0
           OR STRPOS(v_definition, 'v_context :=') >
              STRPOS(v_definition, v_old)
        THEN
            RAISE EXCEPTION 'P9_C4_UNEXPECTED_CONTEXT_STRUCTURE';
        END IF;

        EXECUTE REPLACE(v_definition, v_old, v_new);

        RAISE NOTICE 'P9_C4_CANONICAL_SOURCE_PATCH_APPLIED';
    END IF;

    SELECT
        pg_get_functiondef(p.oid),
        p.proowner,
        p.prosecdef,
        p.proconfig,
        p.proacl
    INTO
        v_definition_after,
        v_owner_after,
        v_security_definer_after,
        v_config_after,
        v_acl_after
    FROM pg_proc p
    WHERE p.oid = v_target::oid;

    IF STRPOS(v_definition_after, v_new) = 0 THEN
        RAISE EXCEPTION 'P9_C4_PATCH_NOT_PRESENT';
    END IF;

    IF v_owner_after IS DISTINCT FROM v_owner
       OR v_security_definer_after IS DISTINCT FROM v_security_definer
       OR v_config_after IS DISTINCT FROM v_config
       OR v_acl_after IS DISTINCT FROM v_acl
    THEN
        RAISE EXCEPTION 'P9_C4_FUNCTION_AUTHORITY_CHANGED';
    END IF;

    RAISE NOTICE 'P9_C4_AUTHORITY_PRESERVED';
END;
$migration$;

COMMIT;