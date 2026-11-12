BEGIN;

SET LOCAL lock_timeout = '5s';

DO $patch$
DECLARE
  v_oid oid;
  v_before text;
  v_after text;
  v_installed text;
  v_owner text;
  v_security boolean;
  v_config text[];

  v_old_decl text := $x$  v_rules jsonb;$x$;
  v_new_decl text := $x$  v_rules jsonb;
  v_is_manual boolean := false;$x$;

  v_old_read text := $x$  v_rules :=
    p_contract_snapshot
      ->'template_authority'
      ->'rules';$x$;

  v_new_read text := $x$  v_rules :=
    p_contract_snapshot
      ->'template_authority'
      ->'rules';

  -- This exception applies only to a validated manual text draft.
  -- Historical creation metadata remains unchanged.
  v_is_manual := coalesce(
    v_contract.quote_id IS NULL
    AND v_contract.quote_version_id IS NULL
    AND v_contract.metadata->>'source'
        = 'responsible_text_draft'
    AND v_contract.metadata->>'created_via'
        = 'create_sales_contract_manual_by_system'
    AND v_contract.metadata->>'commercial_amounts_authoritative'
        = 'false'
    AND v_contract.metadata->>'template_version_id'
        = v_template_version.id::text
    AND nullif(v_contract.metadata->>'draft_id', '') IS NOT NULL
    AND nullif(v_contract.metadata->>'commercial_opportunity_id', '') IS NOT NULL
    AND nullif(v_contract.metadata->>'customer_id', '') IS NOT NULL
    AND nullif(v_contract.metadata->>'created_by_user_id', '') IS NOT NULL
    AND p_contract_snapshot->'text_provenance'->>'mode'
        = 'saved_text_draft'
    AND p_contract_snapshot->'text_provenance'->>'draft_id'
        = v_contract.metadata->>'draft_id'
    AND p_contract_snapshot->'text_provenance'->>'template_version_id'
        = v_template_version.id::text
    AND p_contract_snapshot->'text_provenance'->>'organization_id'
        = p_organization_id::text
    AND p_contract_snapshot->'text_provenance'->>'store_id'
        = p_store_id::text
    AND p_contract_snapshot->'text_provenance'->>'commercial_opportunity_id'
        = v_contract.metadata->>'commercial_opportunity_id'
    AND p_contract_snapshot->'text_provenance'->>'pdf_sha256'
        = p_pdf_sha256
    AND coalesce(
      p_contract_snapshot->'text_provenance'->>'revision',
      ''
    ) ~ '^[1-9][0-9]*$'
    AND coalesce(
      p_contract_snapshot->'text_provenance'->>'text_sha256',
      ''
    ) ~ '^[0-9a-f]{64}$',
    false
  );$x$;

  v_old_rules text := $x$or jsonb_array_length(v_rules) = 0$x$;
  v_new_rules text := $x$or (
       jsonb_array_length(v_rules) = 0
       and not v_is_manual
     )$x$;

  v_old_clauses text := $x$  if nullif(
       btrim(
         p_contract_snapshot
           ->'renderer_input'
           ->'templateAuthority'
           ->>'clauses'
       ),
       ''
     ) is null$x$;

  v_new_clauses text := $x$  if (
       not v_is_manual
       and nullif(
         btrim(
           p_contract_snapshot
             ->'renderer_input'
             ->'templateAuthority'
             ->>'clauses'
         ),
         ''
       ) is null
     )
     or jsonb_typeof(
       p_contract_snapshot
         ->'renderer_input'
         ->'templateAuthority'
         ->'clauses'
     ) is distinct from 'string'$x$;

BEGIN
  v_oid := to_regprocedure(
    'public.create_sales_contract_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb)'
  );

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P9_WRITER_FUNCTION_NOT_FOUND';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(p.oid),
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig
  INTO
    v_before,
    v_owner,
    v_security,
    v_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid
    AND p.prokind = 'f';

  IF v_before IS NULL
     OR md5(v_before)
        <> 'd9eca2f6eef3e31cbd1cef3402a73f04'
  THEN
    RAISE EXCEPTION
      'P9_WRITER_DEFINITION_CHANGED: %',
      md5(v_before);
  END IF;

  IF v_owner <> 'postgres'
     OR v_security IS DISTINCT FROM true
     OR NOT (
       v_config @> ARRAY[
         'search_path=pg_catalog, pg_temp, public',
         'row_security=off'
       ]::text[]
     )
  THEN
    RAISE EXCEPTION 'P9_WRITER_SECURITY_PRECONDITION_FAILED';
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
    RAISE EXCEPTION 'P9_WRITER_PRIVILEGES_UNEXPECTED';
  END IF;

  -- All four original fragments must appear exactly once.
  IF length(v_before) - length(replace(v_before, v_old_decl, ''))
       <> length(v_old_decl)
     OR length(v_before) - length(replace(v_before, v_old_read, ''))
       <> length(v_old_read)
     OR length(v_before) - length(replace(v_before, v_old_rules, ''))
       <> length(v_old_rules)
     OR length(v_before) - length(replace(v_before, v_old_clauses, ''))
       <> length(v_old_clauses)
  THEN
    RAISE EXCEPTION 'P9_WRITER_PATCH_ANCHORS_NOT_UNIQUE';
  END IF;

  v_after := replace(v_before, v_old_decl, v_new_decl);
  v_after := replace(v_after, v_old_read, v_new_read);
  v_after := replace(v_after, v_old_rules, v_new_rules);
  v_after := replace(v_after, v_old_clauses, v_new_clauses);

  IF v_after = v_before THEN
    RAISE EXCEPTION 'P9_WRITER_PATCH_NOT_APPLIED';
  END IF;

  EXECUTE v_after;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
  INTO v_installed
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid;

  IF v_installed IS NULL
     OR position('v_is_manual boolean' IN v_installed) = 0
     OR position('and not v_is_manual' IN v_installed) = 0
     OR position('not v_is_manual' IN v_installed) = 0
     OR md5(v_installed) =
        'd9eca2f6eef3e31cbd1cef3402a73f04'
  THEN
    RAISE EXCEPTION 'P9_WRITER_PATCH_VERIFICATION_FAILED';
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
    RAISE EXCEPTION 'P9_WRITER_SECURITY_CHANGED';
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
    RAISE EXCEPTION 'P9_WRITER_PRIVILEGES_CHANGED';
  END IF;

  RAISE NOTICE
    'P9_MANUAL_TEMPLATE_SNAPSHOT_COMPAT_PASS hash=%',
    md5(v_installed);
END;
$patch$;

COMMIT;

SELECT
  p.proname AS funcao,
  md5(pg_catalog.pg_get_functiondef(p.oid)) AS hash_atual,
  position(
    'v_is_manual boolean'
    IN pg_catalog.pg_get_functiondef(p.oid)
  ) > 0 AS ramo_manual_instalado,
  position(
    'and not v_is_manual'
    IN pg_catalog.pg_get_functiondef(p.oid)
  ) > 0 AS regras_vazias_condicionais,
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
