-- ZION | P19-A | 4-T4-N | targeted production data repair.
-- Run only in the authorized production project. No schema changes or AI calls.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, pg_temp, public, extensions;

DO $repair$
DECLARE
    v_org constant uuid := '8d7eebab-13e8-4503-a2fc-a4f049b5b9f5';
    v_store constant uuid := 'cfa26c3a-4344-4a84-bbed-2c9f1442620e';
    v_result jsonb;
    v_version uuid;
    v_signature constant text := 'public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)';
BEGIN
    IF current_user <> 'postgres' OR session_user <> 'postgres'
       OR public.zion_resolve_request_role_internal() IS DISTINCT FROM 'postgres' THEN
        RAISE EXCEPTION 'T4N_POSTGRES_REQUIRED';
    END IF;

    IF (SELECT md5(btrim(replace(prosrc, chr(13), ''), chr(10)))
        FROM pg_proc WHERE oid = to_regprocedure(v_signature))
        IS DISTINCT FROM 'b809076da9fde50c45536760718461dc' THEN
        RAISE EXCEPTION 'T4N_BOOTSTRAP_SOURCE_DIVERGENT';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'zion:p9:gate-policy-writer:v1:' || v_org::text || ':' || v_store::text, 0));

    PERFORM 1 FROM public.stores s
    WHERE s.id = v_store AND s.organization_id = v_org
      AND lower(btrim(s.name)) = 'passinhos leve'
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'T4N_TARGET_SCOPE_INVALID';
    END IF;

    v_result := public.ensure_store_opportunity_gate_policy_by_system(v_org, v_store);
    IF v_result->>'status' IS NULL OR v_result->>'status' NOT IN ('created', 'preserved')
       OR v_result->>'rule_count' IS DISTINCT FROM '28'
       OR v_result->>'policy_version_id' IS NULL THEN
        RAISE EXCEPTION 'T4N_BOOTSTRAP_RESULT_INVALID';
    END IF;
    v_version := (v_result->>'policy_version_id')::uuid;

    IF NOT EXISTS (
        SELECT 1 FROM public.store_opportunity_gate_policy_current c
        JOIN public.store_opportunity_gate_policy_versions v
          ON v.id = c.current_policy_version_id
         AND v.organization_id = c.organization_id AND v.store_id = c.store_id
        WHERE c.organization_id = v_org AND c.store_id = v_store
          AND v.id = v_version AND v.version_number = 1
          AND v.previous_policy_version_id IS NULL
          AND v.operation_key = 'p19a:initial_gate_policy:v1'
          AND c.last_operation_key = v.operation_key
          AND v.actor_type = 'system' AND v.actor_user_id IS NULL
          AND v.source_type = 'system_bootstrap'
          AND v.reason_code = 'initial_commercial_gate_policy'
          AND v.created_by = 'p19a_gate_policy_bootstrap_v1'
          AND v.metadata = '{"baseline_version":1}'::jsonb
    ) OR (SELECT count(*) FROM public.store_opportunity_gate_policy_versions
          WHERE organization_id = v_org AND store_id = v_store) <> 1
      OR (SELECT count(*) FROM public.store_opportunity_gate_policy_rules
          WHERE organization_id = v_org AND store_id = v_store
            AND policy_version_id = v_version) <> 28 THEN
        RAISE EXCEPTION 'T4N_POLICY_POSTCONDITION_FAILED';
    END IF;

    PERFORM set_config('zion.t4n.status', v_result->>'status', true);
END;
$repair$;

SELECT 'PASS - T4N TARGETED POLICY REPAIR' AS resultado,
       s.name AS loja, s.id AS store_id,
       current_setting('zion.t4n.status') AS status,
       v.version_number, count(r.rule_key) AS rule_count,
       'COMMIT FOLLOWS' AS guarantee
FROM public.stores s
JOIN public.store_opportunity_gate_policy_current c
  ON c.organization_id = s.organization_id AND c.store_id = s.id
JOIN public.store_opportunity_gate_policy_versions v
  ON v.id = c.current_policy_version_id
 AND v.organization_id = c.organization_id AND v.store_id = c.store_id
JOIN public.store_opportunity_gate_policy_rules r
  ON r.policy_version_id = v.id
 AND r.organization_id = v.organization_id AND r.store_id = v.store_id
WHERE s.id = 'cfa26c3a-4344-4a84-bbed-2c9f1442620e'::uuid
  AND s.organization_id = '8d7eebab-13e8-4503-a2fc-a4f049b5b9f5'::uuid
GROUP BY s.name, s.id, v.version_number;

COMMIT;
