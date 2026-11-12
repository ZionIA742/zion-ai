BEGIN;

SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
    v_oid oid;
    v_before text;
    v_after text;
    v_installed text;
    v_owner text;
    v_security_definer boolean;
    v_config text[];
    v_occurrences integer;

    v_old text :=
      'AND outbound_idempotency_key = v_key';

    v_new text :=
      'AND messages.outbound_idempotency_key = v_key';

    v_expected_hash text :=
      'fdcd251d183174bc73458b6ac53c62b7';

BEGIN
    v_oid := to_regprocedure(
      'public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'
    );

    IF v_oid IS NULL THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_NOT_FOUND';
    END IF;

    SELECT
        pg_catalog.pg_get_functiondef(p.oid),
        pg_catalog.pg_get_userbyid(p.proowner),
        p.prosecdef,
        p.proconfig
    INTO
        v_before,
        v_owner,
        v_security_definer,
        v_config
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid
      AND p.prokind = 'f';

    IF v_before IS NULL
       OR md5(v_before) <> v_expected_hash
    THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_DEFINITION_CHANGED: %',
          md5(v_before);
    END IF;

    IF v_owner <> 'postgres'
       OR v_security_definer IS DISTINCT FROM true
       OR NOT (
         v_config @> ARRAY[
           'search_path=pg_catalog, pg_temp, public',
           'row_security=off'
         ]::text[]
       )
    THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_SECURITY_PRECONDITION_FAILED';
    END IF;

    IF NOT has_function_privilege(
         'service_role', v_oid, 'EXECUTE'
       )
       OR has_function_privilege(
         'authenticated', v_oid, 'EXECUTE'
       )
       OR has_function_privilege(
         'anon', v_oid, 'EXECUTE'
       )
    THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_PRIVILEGES_UNEXPECTED';
    END IF;

    IF position(
      'SELECT * INTO m FROM public.messages'
      IN v_before
    ) = 0 THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_LOOKUP_NOT_FOUND';
    END IF;

    v_occurrences := (
      length(v_before) -
      length(replace(v_before, v_old, ''))
    ) / length(v_old);

    IF v_occurrences <> 1 THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_AMBIGUOUS_ANCHOR_COUNT: %',
          v_occurrences;
    END IF;

    -- Qualify only the column in the existing
    -- idempotency lookup. No other logic changes.
    v_after := replace(v_before, v_old, v_new);

    EXECUTE v_after;

    SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_installed
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid;

    IF v_installed IS NULL
       OR position(v_new IN v_installed) = 0
       OR position(v_old IN v_installed) > 0
       OR md5(v_installed) = v_expected_hash
    THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_PATCH_NOT_CONFIRMED';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_oid
        AND p.prosecdef = true
        AND pg_catalog.pg_get_userbyid(p.proowner)
            = v_owner
        AND p.proconfig IS NOT DISTINCT FROM v_config
    )
    THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_SECURITY_CHANGED';
    END IF;

    IF NOT has_function_privilege(
         'service_role', v_oid, 'EXECUTE'
       )
       OR has_function_privilege(
         'authenticated', v_oid, 'EXECUTE'
       )
       OR has_function_privilege(
         'anon', v_oid, 'EXECUTE'
       )
    THEN
        RAISE EXCEPTION
          'P9_SEND_MATERIALIZER_PRIVILEGES_CHANGED';
    END IF;

    RAISE NOTICE
      'P9_SEND_IDEMPOTENCY_LOOKUP_FIX_PASS hash=%',
      md5(v_installed);
END;
$migration$;

COMMIT;

SELECT
    p.proname AS funcao,

    md5(pg_catalog.pg_get_functiondef(p.oid))
      AS hash_atual,

    position(
      'AND messages.outbound_idempotency_key = v_key'
      IN pg_catalog.pg_get_functiondef(p.oid)
    ) > 0 AS lookup_qualificado,

    p.prosecdef AS security_definer,

    has_function_privilege(
      'service_role', p.oid, 'EXECUTE'
    ) AS service_role_execute,

    has_function_privilege(
      'authenticated', p.oid, 'EXECUTE'
    ) AS authenticated_execute,

    has_function_privilege(
      'anon', p.oid, 'EXECUTE'
    ) AS anon_execute

FROM pg_catalog.pg_proc p
WHERE p.oid = to_regprocedure(
  'public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'
);
