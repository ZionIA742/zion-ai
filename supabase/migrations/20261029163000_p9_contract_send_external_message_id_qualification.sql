BEGIN;

SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  v_oid oid;
  v_before text;
  v_after text;
  v_installed text;
  v_owner text;
  v_config text[];
  v_old text :=
    'AND deleted_at IS NULL AND external_message_id IS NULL';
  v_new text :=
    'AND deleted_at IS NULL AND messages.external_message_id IS NULL';
  v_count integer;
BEGIN
  v_oid := to_regprocedure(
    'public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'
  );

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P9_SEND_FUNCTION_NOT_FOUND';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(p.oid),
    pg_catalog.pg_get_userbyid(p.proowner),
    p.proconfig
  INTO v_before, v_owner, v_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid
    AND p.prokind = 'f'
    AND p.prosecdef = true;

  IF v_before IS NULL
     OR md5(v_before) <>
        'db373fa77eaf840c2122c02fadd79c4f'
  THEN
    RAISE EXCEPTION
      'P9_SEND_DEFINITION_DRIFT: %', md5(v_before);
  END IF;

  IF v_owner <> 'postgres'
     OR NOT (
       v_config @> ARRAY[
         'search_path=pg_catalog, pg_temp, public',
         'row_security=off'
       ]::text[]
     )
  THEN
    RAISE EXCEPTION 'P9_SEND_SECURITY_PRECONDITION_FAILED';
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
    RAISE EXCEPTION 'P9_SEND_PRIVILEGE_PRECONDITION_FAILED';
  END IF;

  v_count :=
    (length(v_before) -
     length(replace(v_before, v_old, '')))
    / length(v_old);

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'P9_SEND_EXPECTED_ANCHOR_COUNT_INVALID: %',
      v_count;
  END IF;

  IF position(
    'AND messages.outbound_idempotency_key = v_key'
    IN v_before
  ) = 0 THEN
    RAISE EXCEPTION
      'P9_SEND_PREVIOUS_QUALIFICATION_MISSING';
  END IF;

  v_after := replace(v_before, v_old, v_new);

  EXECUTE v_after;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
  INTO v_installed
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid;

  IF position(v_new IN v_installed) = 0
     OR position(v_old IN v_installed) > 0
     OR position(
       'AND messages.outbound_idempotency_key = v_key'
       IN v_installed
     ) = 0
  THEN
    RAISE EXCEPTION 'P9_SEND_PATCH_NOT_VERIFIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid
      AND p.prosecdef = true
      AND pg_catalog.pg_get_userbyid(p.proowner) = v_owner
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) OR NOT has_function_privilege(
    'service_role', v_oid, 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', v_oid, 'EXECUTE'
  ) OR has_function_privilege(
    'anon', v_oid, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'P9_SEND_SECURITY_POSTCHECK_FAILED';
  END IF;

  RAISE NOTICE
    'P9_SEND_EXTERNAL_MESSAGE_ID_FIX_PASS: %',
    md5(v_installed);
END;
$migration$;

COMMIT;

SELECT
  p.proname AS funcao,
  md5(pg_catalog.pg_get_functiondef(p.oid)) AS hash_atual,
  position(
    'messages.external_message_id IS NULL'
    IN pg_catalog.pg_get_functiondef(p.oid)
  ) > 0 AS external_message_qualificado,
  position(
    'messages.outbound_idempotency_key = v_key'
    IN pg_catalog.pg_get_functiondef(p.oid)
  ) > 0 AS idempotencia_preservada,
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
