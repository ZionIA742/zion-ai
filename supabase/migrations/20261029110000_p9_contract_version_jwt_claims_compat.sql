BEGIN;

SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
    v_oid oid;
    v_before text;
    v_after text;
    v_owner text;
    v_security_definer boolean;
    v_config text[];

    v_expected_hash text :=
      '7e2c5bdee78239725e4cff1b472229d9';

    v_old text := $old$v_request_role :=
    nullif(
      current_setting('request.jwt.claim.role', true),
      ''
    );$old$;

    v_new text := $new$v_request_role :=
    coalesce(
      nullif(
        current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(
        current_setting('request.jwt.claims', true),
        ''
      )::jsonb ->> 'role'
    );$new$;

BEGIN
    v_oid := to_regprocedure(
      'public.create_sales_contract_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb)'
    );

    IF v_oid IS NULL THEN
        RAISE EXCEPTION
          'P9_CONTRACT_VERSION_RPC_NOT_FOUND';
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

    IF v_before IS NULL THEN
        RAISE EXCEPTION
          'P9_CONTRACT_VERSION_DEFINITION_NOT_FOUND';
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
          'P9_CONTRACT_VERSION_SECURITY_PRECONDITION_FAILED';
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
          'P9_CONTRACT_VERSION_PRIVILEGES_UNEXPECTED';
    END IF;

    IF md5(v_before) <> v_expected_hash THEN
        RAISE EXCEPTION
          'P9_CONTRACT_VERSION_DEFINITION_CHANGED: %',
          md5(v_before);
    END IF;

    IF (
      length(v_before) -
      length(replace(v_before, v_old, ''))
    ) <> length(v_old)
    THEN
        RAISE EXCEPTION
          'P9_CONTRACT_VERSION_ROLE_GUARD_NOT_UNIQUE';
    END IF;

    EXECUTE replace(v_before, v_old, v_new);

    SELECT
      pg_catalog.pg_get_functiondef(p.oid)
    INTO v_after
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid;

    IF v_after IS NULL
       OR position(v_new IN v_after) = 0
       OR md5(v_after) = v_expected_hash
    THEN
        RAISE EXCEPTION
          'P9_CONTRACT_VERSION_PATCH_NOT_CONFIRMED';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_oid
        AND p.prosecdef = true
        AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND p.proconfig IS NOT DISTINCT FROM v_config
    )
    THEN
        RAISE EXCEPTION
          'P9_CONTRACT_VERSION_SECURITY_CHANGED';
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
          'P9_CONTRACT_VERSION_PRIVILEGES_CHANGED';
    END IF;

    RAISE NOTICE
      'P9_CONTRACT_VERSION_JWT_COMPAT_PASS hash=%',
      md5(v_after);
END;
$migration$;

COMMIT;

SELECT
    p.proname AS funcao,
    md5(pg_catalog.pg_get_functiondef(p.oid))
      AS hash_atual,
    position(
      'request.jwt.claims'
      IN pg_catalog.pg_get_functiondef(p.oid)
    ) > 0 AS suporta_claims_json,
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
  'public.create_sales_contract_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb)'
);
