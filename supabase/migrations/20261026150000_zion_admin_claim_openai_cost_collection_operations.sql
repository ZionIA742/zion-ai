-- ZION-ADM 8-C.4-B.2
-- Claim atomico com lease de 15 minutos
-- Migration: 20261026150000_zion_admin_claim_openai_cost_collection_operations.sql
-- Sem execucao automatica e sem coleta real.

BEGIN;

CREATE FUNCTION
public.zion_admin_claim_openai_cost_collection_operations_by_system(
    p_limit integer,
    p_claimed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_operation record;
    v_claim record;

    v_now timestamptz;
    v_items jsonb := '[]'::jsonb;
    v_count integer := 0;

    v_lease_minutes integer := 15;
BEGIN

    -- Limites fixos de seguranca do piloto.

    IF p_limit IS NULL
       OR p_limit NOT BETWEEN 1 AND 10
       OR p_claimed_by IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_claimed_by)
          ) NOT BETWEEN 1 AND 128
       OR p_claimed_by IS DISTINCT FROM
          pg_catalog.btrim(p_claimed_by)
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_CLAIM_INVALID_REQUEST';
    END IF;

    -- Selecionar somente operacoes elegiveis.
    -- SKIP LOCKED impede claim simultaneo
    -- da mesma operacao.
    --
    -- Leases expirados de processing NAO
    -- sao elegiveis: precisam de reconciliacao.

    FOR v_operation IN
        SELECT
            o.id,
            o.state,
            o.attempt_count
        FROM
          public.zion_admin_openai_cost_collection_operations o
        WHERE o.state IN (
            'pending',
            'retryable_failed'
        )
          AND o.next_attempt_at IS NOT NULL
          AND o.next_attempt_at <=
              pg_catalog.clock_timestamp()
          AND o.attempt_count < o.max_attempts
          AND o.claim_token IS NULL
          AND o.claim_expires_at IS NULL
        ORDER BY
            o.next_attempt_at,
            o.created_at,
            o.id
        LIMIT p_limit
        FOR UPDATE OF o SKIP LOCKED
    LOOP

        v_now := pg_catalog.clock_timestamp();

        -- Gerar novo fencing token a cada claim.
        -- Uma tentativa antiga nao deve
        -- reutilizar token anterior.

        UPDATE
          public.zion_admin_openai_cost_collection_operations
        SET
            state = 'processing',
            attempt_count = attempt_count + 1,
            claim_token = pg_catalog.gen_random_uuid(),
            claim_expires_at =
                v_now + pg_catalog.make_interval(
                    mins => v_lease_minutes
                ),
            claimed_by = p_claimed_by,
            next_attempt_at = NULL,
            updated_at = v_now,
            last_error_code = NULL,
            last_error_at = NULL
        WHERE id = v_operation.id
          AND state = v_operation.state
          AND attempt_count = v_operation.attempt_count
        RETURNING
            id,
            operation_key,
            query_identity,
            query_parameters,
            period_start,
            period_end,
            state,
            attempt_count,
            max_attempts,
            claim_token,
            claim_expires_at,
            claimed_by
        INTO v_claim;

        IF NOT FOUND THEN
            RAISE EXCEPTION
              'OPENAI_COST_CLAIM_CONCURRENT_STATE_CHANGE';
        END IF;

        -- Registrar auditoria na mesma transacao.
        -- Se a gravacao do evento falhar,
        -- o claim tambem sera revertido.

        INSERT INTO
          public.zion_admin_openai_cost_collection_operation_events (
            operation_id,
            event_kind,
            from_state,
            to_state,
            attempt_count,
            occurred_at,
            technical_actor
          )
        VALUES (
            v_claim.id,
            'claimed',
            v_operation.state,
            'processing',
            v_claim.attempt_count,
            v_now,
            p_claimed_by
        );

        v_items := v_items ||
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'operation_id', v_claim.id,
              'operation_key', v_claim.operation_key,
              'query_identity', v_claim.query_identity,
              'query_parameters', v_claim.query_parameters,
              'period_start', v_claim.period_start,
              'period_end', v_claim.period_end,
              'state', v_claim.state,
              'attempt_count', v_claim.attempt_count,
              'max_attempts', v_claim.max_attempts,
              'claim_token', v_claim.claim_token,
              'claim_expires_at', v_claim.claim_expires_at,
              'claimed_by', v_claim.claimed_by
            )
          );

        v_count := v_count + 1;

    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'claimed',
        'claimed_count', v_count,
        'lease_minutes', v_lease_minutes,
        'operations', v_items
    );
END;
$function$;

-- Permissao restrita ao servidor.

REVOKE ALL ON FUNCTION
public.zion_admin_claim_openai_cost_collection_operations_by_system(
    integer, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_claim_openai_cost_collection_operations_by_system(
    integer, text
)
TO service_role;

COMMIT;

-- Diagnostico somente leitura.
-- Nao chamar a RPC neste passo.

WITH rpc AS (
    SELECT
        p.oid,
        p.prosecdef,
        p.proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_claim_openai_cost_collection_operations_by_system(integer,text)'
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
             SELECT 1 FROM
               public.zion_admin_openai_cost_collection_operations
           )

    UNION ALL

    SELECT '08_nenhum_evento_criado',
           NOT EXISTS (
             SELECT 1 FROM
               public.zion_admin_openai_cost_collection_operation_events
           )
)
SELECT
    verificacao,
    CASE WHEN passou THEN 'PASS' ELSE 'FAIL' END AS resultado
FROM checks
ORDER BY verificacao;
