-- ZION | Catalogo CRM | Security hardening
-- Restrict only the legacy outbound reader.
-- Preserve existing function definitions and V2.
-- No message creation or business data mutation.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $security$
DECLARE

    v_legacy oid := pg_catalog.to_regprocedure(
        'public.get_pending_external_messages(uuid,uuid)'
    );

    v_v2 oid := pg_catalog.to_regprocedure(
        'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'
    );

    v_panel oid := pg_catalog.to_regprocedure(
        'public.panel_send_message_scoped(uuid,uuid,text)'
    );

    v_v2_acl text;
    v_panel_acl text;

    v_legacy_owner oid;

BEGIN

    -- Required installed authorities.

    IF v_legacy IS NULL
       OR v_v2 IS NULL
       OR v_panel IS NULL THEN

        RAISE EXCEPTION
            'ZION_LEGACY_OUTBOUND_REQUIRED_AUTHORITY_MISSING';

    END IF;

    -- Confirm the audited remote definitions.

    IF pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_legacy)
    ) IS DISTINCT FROM
        'd6f1207d0f625eb08c29c83b138bc0d4'
    THEN

        RAISE EXCEPTION
            'ZION_LEGACY_OUTBOUND_DEFINITION_CHANGED';

    END IF;

    IF pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_v2)
    ) IS DISTINCT FROM
        'd575b51c5f1dc9f4d3be1682b9d89663'
    THEN

        RAISE EXCEPTION
            'ZION_OUTBOUND_V2_DEFINITION_CHANGED';

    END IF;

    IF pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_panel)
    ) IS DISTINCT FROM
        '1877bd63fcb5a5f7885b708c237c6d30'
    THEN

        RAISE EXCEPTION
            'ZION_PANEL_SCOPED_DEFINITION_CHANGED';

    END IF;

    SELECT p.proowner
      INTO v_legacy_owner
      FROM pg_catalog.pg_proc p
     WHERE p.oid = v_legacy;

    IF pg_catalog.pg_get_userbyid(v_legacy_owner)
       IS DISTINCT FROM 'postgres' THEN

        RAISE EXCEPTION
            'ZION_LEGACY_OWNER_CHANGED';

    END IF;

    SELECT p.proacl::text
      INTO v_v2_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = v_v2;

    SELECT p.proacl::text
      INTO v_panel_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = v_panel;

    IF NOT pg_catalog.has_function_privilege(
        'service_role', v_legacy, 'EXECUTE'
    ) THEN

        RAISE EXCEPTION
            'ZION_LEGACY_SERVICE_ACCESS_MISSING';

    END IF;

    IF pg_catalog.has_function_privilege(
        'anon', v_v2, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
        'authenticated', v_v2, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
        'service_role', v_v2, 'EXECUTE'
    ) THEN

        RAISE EXCEPTION
            'ZION_V2_PERMISSION_BASELINE_CHANGED';

    END IF;

    IF pg_catalog.has_function_privilege(
        'anon', v_panel, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
        'authenticated', v_panel, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
        'service_role', v_panel, 'EXECUTE'
    ) THEN

        RAISE EXCEPTION
            'ZION_PANEL_PERMISSION_BASELINE_CHANGED';

    END IF;

    -- Only the legacy reader is modified.

    REVOKE ALL PRIVILEGES ON FUNCTION
        public.get_pending_external_messages(uuid, uuid)
    FROM PUBLIC, anon, authenticated;

    GRANT EXECUTE ON FUNCTION
        public.get_pending_external_messages(uuid, uuid)
    TO service_role;

    -- Validate effective permissions.

    IF pg_catalog.has_function_privilege(
        'anon', v_legacy, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
        'authenticated', v_legacy, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
        'service_role', v_legacy, 'EXECUTE'
    ) THEN

        RAISE EXCEPTION
            'ZION_LEGACY_HARDENING_FAILED';

    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(
            coalesce(
                p.proacl,
                pg_catalog.acldefault('f', p.proowner)
            )
        ) acl
        WHERE p.oid = v_legacy
          AND acl.privilege_type = 'EXECUTE'
          AND acl.grantee NOT IN (
              p.proowner,
              'service_role'::pg_catalog.regrole::oid
          )
    ) THEN

        RAISE EXCEPTION
            'ZION_LEGACY_UNEXPECTED_EXECUTE_GRANT';

    END IF;

    -- Confirm that no function definition changed.

    IF pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_legacy)
    ) IS DISTINCT FROM
        'd6f1207d0f625eb08c29c83b138bc0d4'

    OR pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_v2)
    ) IS DISTINCT FROM
        'd575b51c5f1dc9f4d3be1682b9d89663'

    OR pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_panel)
    ) IS DISTINCT FROM
        '1877bd63fcb5a5f7885b708c237c6d30'
    THEN

        RAISE EXCEPTION
            'ZION_EXISTING_FUNCTION_DEFINITION_CHANGED';

    END IF;

    -- Confirm exact preservation of unrelated ACLs.

    IF (
        SELECT p.proacl::text
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_v2
    ) IS DISTINCT FROM v_v2_acl

    OR (
        SELECT p.proacl::text
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_panel
    ) IS DISTINCT FROM v_panel_acl

    OR (
        SELECT p.proowner
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_legacy
    ) IS DISTINCT FROM v_legacy_owner

    THEN

        RAISE EXCEPTION
            'ZION_UNRELATED_AUTHORITY_CHANGED';

    END IF;

END;
$security$;

SELECT
    'ZION_LEGACY_OUTBOUND_HARDENING_PASS' AS verdict,

    NOT pg_catalog.has_function_privilege(
        'anon',
        'public.get_pending_external_messages(uuid,uuid)',
        'EXECUTE'
    ) AS anon_blocked,

    NOT pg_catalog.has_function_privilege(
        'authenticated',
        'public.get_pending_external_messages(uuid,uuid)',
        'EXECUTE'
    ) AS authenticated_blocked,

    pg_catalog.has_function_privilege(
        'service_role',
        'public.get_pending_external_messages(uuid,uuid)',
        'EXECUTE'
    ) AS service_role_preserved,

    true AS function_definitions_preserved,
    true AS v2_permissions_preserved,
    true AS panel_scoped_permissions_preserved;

COMMIT;
