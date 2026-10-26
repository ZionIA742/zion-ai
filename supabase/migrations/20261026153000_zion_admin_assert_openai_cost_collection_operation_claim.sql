-- ZION-ADM 8-C.4-B.3
-- Validacao do claim ativo de coleta OpenAI.
-- Migration:
-- 20261026153000_zion_admin_assert_openai_cost_collection_operation_claim.sql
-- Nenhuma coleta, cron ou operacao e iniciada.

BEGIN;

CREATE FUNCTION
public.zion_admin_assert_openai_cost_collection_operation_claim_by_system(
    p_operation_id uuid,
    p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_claim record;
    v_now timestamptz;
BEGIN

    IF p_operation_id IS NULL
       OR p_claim_token IS NULL
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_CLAIM_INVALID_REQUEST';
    END IF;

    -- Leitura protegida da operacao existente.

    SELECT
        o.id,
        o.operation_key,
        o.state,
        o.attempt_count,
        o.claim_token,
        o.claim_expires_at,
        o.claimed_by
    INTO v_claim
    FROM public.zion_admin_openai_cost_collection_operations o
    WHERE o.id = p_operation_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
          'OPENAI_COST_CLAIM_NOT_ACTIVE';
    END IF;

    -- Verificar o relogio depois de obter o lock.

    v_now := pg_catalog.clock_timestamp();

    IF v_claim.state IS DISTINCT FROM 'processing'
       OR v_claim.claim_token IS DISTINCT FROM p_claim_token
       OR v_claim.claim_expires_at IS NULL
       OR v_claim.claim_expires_at <= v_now
       OR v_claim.claimed_by IS NULL
       OR v_claim.attempt_count < 1
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_CLAIM_NOT_ACTIVE';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'valid',
        'operation_id', v_claim.id,
        'operation_key', v_claim.operation_key,
        'state', v_claim.state,
        'attempt_count', v_claim.attempt_count,
        'claim_expires_at', v_claim.claim_expires_at,
        'claimed_by', v_claim.claimed_by
    );

END;
$function$;

REVOKE ALL ON FUNCTION
public.zion_admin_assert_openai_cost_collection_operation_claim_by_system(
    uuid, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_assert_openai_cost_collection_operation_claim_by_system(
    uuid, uuid
)
TO service_role;

COMMIT;

-- Instalacao e seguranca: somente leitura.

WITH rpc AS (
    SELECT p.oid, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_assert_openai_cost_collection_operation_claim_by_system(uuid,uuid)'
    )
),
checks AS (
    SELECT '01_rpc_existe' AS verificacao,
           EXISTS (SELECT 1 FROM rpc) AS passou

    UNION ALL

    SELECT '02_security_definer',
           EXISTS (
             SELECT 1 FROM rpc WHERE prosecdef
           )

    UNION ALL

    SELECT '03_search_path_restrito',
           EXISTS (
             SELECT 1 FROM rpc
             WHERE 'search_path=""' = ANY(proconfig)
           )

    UNION ALL

    SELECT '04_service_role_autorizado',
           EXISTS (
             SELECT 1 FROM rpc
             WHERE pg_catalog.has_function_privilege(
                 'service_role', oid, 'EXECUTE'
             )
           )

    UNION ALL

    SELECT '05_anon_bloqueado',
           EXISTS (
             SELECT 1 FROM rpc
             WHERE NOT pg_catalog.has_function_privilege(
                 'anon', oid, 'EXECUTE'
             )
           )

    UNION ALL

    SELECT '06_authenticated_bloqueado',
           EXISTS (
             SELECT 1 FROM rpc
             WHERE NOT pg_catalog.has_function_privilege(
                 'authenticated', oid, 'EXECUTE'
             )
           )

    UNION ALL

    SELECT '07_nenhuma_operacao_criada',
           NOT EXISTS (
             SELECT 1
             FROM public.zion_admin_openai_cost_collection_operations
           )

    UNION ALL

    SELECT '08_nenhum_evento_criado',
           NOT EXISTS (
             SELECT 1
             FROM public.zion_admin_openai_cost_collection_operation_events
           )
)
SELECT
    verificacao,
    CASE WHEN passou THEN 'PASS' ELSE 'FAIL' END AS resultado
FROM checks
ORDER BY verificacao;
