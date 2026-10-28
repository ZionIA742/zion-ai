BEGIN;

DO $migration$
DECLARE
  v_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_before text;
  v_after text;
  v_count integer;

  v_expected_hash text :=
    '6e97039cd21d04f40ccd64875e219bd2';

  v_old text := $old$v_role text := nullif(current_setting('request.jwt.claim.role', true), '');$old$;

  v_new text := $new$v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'));$new$;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname =
      'create_sales_contract_text_version_by_system'
    AND p.prokind = 'f';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'P9_TEXT_RPC_SIGNATURE_NOT_UNIQUE';
  END IF;

  SELECT
    p.oid,
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    pg_catalog.pg_get_functiondef(p.oid)
  INTO
    v_oid,
    v_owner,
    v_security_definer,
    v_before
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname =
      'create_sales_contract_text_version_by_system'
    AND p.prokind = 'f';

  IF v_owner <> 'postgres'
     OR NOT v_security_definer
     OR NOT has_function_privilege(
       'service_role', v_oid, 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', v_oid, 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', v_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'P9_TEXT_RPC_SECURITY_PRECONDITION_FAILED';
  END IF;

  IF md5(v_before) <> v_expected_hash THEN
    RAISE EXCEPTION
      'P9_TEXT_RPC_DEFINITION_CHANGED: %',
      md5(v_before);
  END IF;

  IF strpos(v_before, v_old) = 0
     OR strpos(
       substring(
         v_before
         FROM strpos(v_before, v_old) + length(v_old)
       ),
       v_old
     ) > 0 THEN
    RAISE EXCEPTION
      'P9_TEXT_RPC_ROLE_GUARD_NOT_UNIQUE';
  END IF;

  EXECUTE replace(v_before, v_old, v_new);

  SELECT pg_catalog.pg_get_functiondef(v_oid)
  INTO v_after;

  IF strpos(v_after, v_new) = 0
     OR md5(v_after) = v_expected_hash THEN
    RAISE EXCEPTION
      'P9_TEXT_RPC_PATCH_NOT_CONFIRMED';
  END IF;

  IF NOT has_function_privilege(
       'service_role', v_oid, 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', v_oid, 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', v_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'P9_TEXT_RPC_PRIVILEGES_CHANGED';
  END IF;

  RAISE NOTICE
    'P9_TEXT_VERSION_JWT_COMPAT_PASS hash=%',
    md5(v_after);
END;
$migration$;

COMMIT;

SELECT
  p.proname AS funcao,
  md5(pg_catalog.pg_get_functiondef(p.oid))
    AS hash_atual,
  pg_catalog.pg_get_functiondef(p.oid) LIKE
    '%request.jwt.claims%'
    AS suporta_claims_json,
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
JOIN pg_catalog.pg_namespace n
  ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname =
    'create_sales_contract_text_version_by_system';
