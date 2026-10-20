-- ZION / P19-A / I8
-- Alinha a identidade da materializacao com auth.role().
-- Idempotente para ambientes ja corrigidos.
-- Nao altera dados, filas, transporte ou permissoes.

BEGIN;

DO $migration$
DECLARE
  v_rpc oid;
  v_fence oid;
  v_before text;
  v_expected text;
  v_after text;
  v_acl_before aclitem[];
  v_acl_after aclitem[];
  v_config_before text[];
  v_config_after text[];
  v_old text :=
    $old$v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');$old$;
  v_new text :=
    $new$v_request_role text := auth.role();$new$;
  v_guard text :=
    $guard$if v_request_role is distinct from 'service_role' and session_user <> 'postgres' then$guard$;
BEGIN
  v_rpc := to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'
  );

  v_fence := to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'
  );

  IF v_rpc IS NULL OR v_fence IS NULL
     OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'P19A_I8_ALIGNMENT_DEPENDENCY_MISSING';
  END IF;

  SELECT pg_get_functiondef(p.oid), p.proacl, p.proconfig
  INTO v_before, v_acl_before, v_config_before
  FROM pg_proc p
  WHERE p.oid = v_rpc
    AND p.prosecdef IS TRUE
    AND pg_get_userbyid(p.proowner) = 'postgres';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P19A_I8_ALIGNMENT_SECURITY_MISMATCH';
  END IF;

  IF strpos(v_before, v_guard) = 0
     OR strpos(pg_get_functiondef(v_fence), 'auth.role()') = 0
  THEN
    RAISE EXCEPTION 'P19A_I8_ALIGNMENT_GUARD_MISMATCH';
  END IF;

  IF NOT has_function_privilege('service_role', v_rpc, 'EXECUTE')
     OR has_function_privilege('anon', v_rpc, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'P19A_I8_ALIGNMENT_ACL_MISMATCH';
  END IF;

  IF strpos(v_before, v_new) > 0
     AND strpos(v_before, v_old) = 0 THEN
    v_expected := v_before;
    RAISE NOTICE 'P19A_I8_ALIGNMENT_ALREADY_APPLIED';

  ELSIF (
    length(v_before) - length(replace(v_before, v_old, ''))
  ) = length(v_old)
    AND strpos(v_before, v_new) = 0 THEN

    v_expected := replace(v_before, v_old, v_new);
    EXECUTE v_expected;
    RAISE NOTICE 'P19A_I8_ALIGNMENT_APPLIED';

  ELSE
    RAISE EXCEPTION 'P19A_I8_ALIGNMENT_UNEXPECTED_SOURCE';
  END IF;

  SELECT pg_get_functiondef(p.oid), p.proacl, p.proconfig
  INTO v_after, v_acl_after, v_config_after
  FROM pg_proc p
  WHERE p.oid = v_rpc
    AND p.prosecdef IS TRUE
    AND pg_get_userbyid(p.proowner) = 'postgres';

  IF NOT FOUND
     OR v_after IS DISTINCT FROM v_expected
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_config_after IS DISTINCT FROM v_config_before
  THEN
    RAISE EXCEPTION 'P19A_I8_ALIGNMENT_POSTCHECK_FAILED';
  END IF;

  IF NOT has_function_privilege('service_role', v_rpc, 'EXECUTE')
     OR has_function_privilege('anon', v_rpc, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'P19A_I8_ALIGNMENT_POSTCHECK_ACL_FAILED';
  END IF;

  RAISE NOTICE 'P19A_I8_ROLE_ALIGNMENT_PASS';
END;
$migration$;

COMMIT;
