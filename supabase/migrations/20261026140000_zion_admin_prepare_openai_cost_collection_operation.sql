-- ZION-ADM 8-C.4-B.1
-- Preparacao idempotente de operacoes financeiras OpenAI
-- Migration:
-- 20261026140000_zion_admin_prepare_openai_cost_collection_operation.sql
--
-- Nao consulta OpenAI.
-- Nao cria operacoes automaticamente.
-- Nao altera snapshots ou fechamentos financeiros.

BEGIN;

CREATE FUNCTION
public.zion_admin_prepare_openai_cost_collection_operation_by_system(
    p_operation_key text,
    p_query_identity text,
    p_query_parameters jsonb,
    p_period_start timestamptz,
    p_period_end timestamptz,
    p_supersedes_operation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing
      public.zion_admin_openai_cost_collection_operations%ROWTYPE;

    v_previous
      public.zion_admin_openai_cost_collection_operations%ROWTYPE;

    v_operation_id uuid;
    v_now timestamptz := pg_catalog.clock_timestamp();

    v_start_seconds numeric;
    v_end_seconds numeric;
BEGIN

    -- 1. Validar identidade e contrato da consulta.

    IF p_operation_key IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_operation_key)
          ) NOT BETWEEN 1 AND 1024
       OR p_operation_key IS DISTINCT FROM
          pg_catalog.btrim(p_operation_key)
       OR p_query_identity IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_query_identity)
          ) = 0
       OR p_period_start IS NULL
       OR p_period_end IS NULL
       OR p_period_end <= p_period_start
       OR pg_catalog.jsonb_typeof(p_query_parameters)
          IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_OPERATION_INVALID_REQUEST';
    END IF;

    IF pg_catalog.left(
         p_query_identity,
         pg_catalog.length(
           'openai_organization_costs:v1:'
         )
       ) <> 'openai_organization_costs:v1:'
       OR p_query_parameters ->> 'query_identity'
          IS DISTINCT FROM p_query_identity
       OR p_query_parameters ->> 'bucket_width'
          IS DISTINCT FROM '1d'
       OR pg_catalog.jsonb_typeof(
            p_query_parameters -> 'start_time'
          ) IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(
            p_query_parameters -> 'end_time'
          ) IS DISTINCT FROM 'number'
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_OPERATION_INVALID_QUERY';
    END IF;

    -- Os instantes Unix sao a fonte para os limites UTC.

    v_start_seconds :=
      (p_query_parameters ->> 'start_time')::numeric;

    v_end_seconds :=
      (p_query_parameters ->> 'end_time')::numeric;

    IF v_start_seconds <> pg_catalog.floor(v_start_seconds)
       OR v_end_seconds <> pg_catalog.floor(v_end_seconds)
       OR v_start_seconds <> EXTRACT(EPOCH FROM p_period_start)
       OR v_end_seconds <> EXTRACT(EPOCH FROM p_period_end)
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_OPERATION_PERIOD_MISMATCH';
    END IF;

    -- A competencia financeira brasileira ainda nao e
    -- definida nesta etapa.

    IF (
        p_query_parameters ? 'financial_competence'
        AND pg_catalog.jsonb_typeof(
          p_query_parameters -> 'financial_competence'
        ) IS DISTINCT FROM 'null'
    ) THEN
        RAISE EXCEPTION
          'OPENAI_COST_OPERATION_COMPETENCE_NOT_SUPPORTED';
    END IF;

    -- 2. Serializar preparacoes com a mesma operation_key.

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(
          'zion_admin_openai_cost_operation'
        ),
        pg_catalog.hashtext(p_operation_key)
    );

    -- 3. Repetir a operacao existente sem criar duplicata.

    SELECT *
    INTO v_existing
    FROM public.zion_admin_openai_cost_collection_operations
    WHERE operation_key = p_operation_key;

    IF FOUND THEN

        IF v_existing.provider IS DISTINCT FROM 'openai'
           OR v_existing.source IS DISTINCT FROM
              'openai_organization_costs'
           OR v_existing.query_identity
              IS DISTINCT FROM p_query_identity
           OR v_existing.query_parameters
              IS DISTINCT FROM p_query_parameters
           OR v_existing.period_start
              IS DISTINCT FROM p_period_start
           OR v_existing.period_end
              IS DISTINCT FROM p_period_end
           OR v_existing.supersedes_operation_id
              IS DISTINCT FROM p_supersedes_operation_id
        THEN
            RAISE EXCEPTION
              'OPENAI_COST_OPERATION_IDEMPOTENCY_CONFLICT';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'existing',
            'operation_id', v_existing.id,
            'operation_key', v_existing.operation_key,
            'state', v_existing.state,
            'attempt_count', v_existing.attempt_count,
            'max_attempts', v_existing.max_attempts,
            'next_attempt_at', v_existing.next_attempt_at,
            'snapshot_collection_id',
                v_existing.snapshot_collection_id
        );
    END IF;

    -- 4. Reconsulta que substitui historico:
    -- exigir operacao anterior confirmada e mesma consulta.

    IF p_supersedes_operation_id IS NOT NULL THEN

        SELECT *
        INTO v_previous
        FROM public.zion_admin_openai_cost_collection_operations
        WHERE id = p_supersedes_operation_id
        FOR SHARE;

        IF NOT FOUND
           OR v_previous.state IS DISTINCT FROM 'confirmed'
           OR v_previous.query_identity
              IS DISTINCT FROM p_query_identity
           OR v_previous.query_parameters
              IS DISTINCT FROM p_query_parameters
           OR v_previous.period_start
              IS DISTINCT FROM p_period_start
           OR v_previous.period_end
              IS DISTINCT FROM p_period_end
        THEN
            RAISE EXCEPTION
              'OPENAI_COST_OPERATION_INVALID_SUPERSESSION';
        END IF;

    END IF;

    -- 5. Criar operacao pendente.
    -- Limite de tentativas fixo para o piloto: 3.

    INSERT INTO
      public.zion_admin_openai_cost_collection_operations (
        operation_key,
        provider,
        source,
        query_identity,
        query_parameters,
        period_start,
        period_end,
        state,
        attempt_count,
        max_attempts,
        next_attempt_at,
        supersedes_operation_id,
        created_at,
        updated_at
      )
    VALUES (
        p_operation_key,
        'openai',
        'openai_organization_costs',
        p_query_identity,
        p_query_parameters,
        p_period_start,
        p_period_end,
        'pending',
        0,
        3,
        v_now,
        p_supersedes_operation_id,
        v_now,
        v_now
    )
    RETURNING id INTO v_operation_id;

    -- 6. Registrar evidencia auditavel na mesma transacao.

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
        v_operation_id,
        'prepared',
        NULL,
        'pending',
        0,
        v_now,
        'zion-admin-openai-cost-system'
    );

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'created',
        'operation_id', v_operation_id,
        'operation_key', p_operation_key,
        'state', 'pending',
        'attempt_count', 0,
        'max_attempts', 3,
        'next_attempt_at', v_now,
        'snapshot_collection_id', NULL
    );

END;
$function$;

-- Somente chamadas administrativas do servidor.

REVOKE ALL ON FUNCTION
public.zion_admin_prepare_openai_cost_collection_operation_by_system(
    text,
    text,
    jsonb,
    timestamptz,
    timestamptz,
    uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_prepare_openai_cost_collection_operation_by_system(
    text,
    text,
    jsonb,
    timestamptz,
    timestamptz,
    uuid
)
TO service_role;

COMMIT;

-- Verificacao somente leitura.

WITH rpc AS (
    SELECT p.oid, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_prepare_openai_cost_collection_operation_by_system(text,text,jsonb,timestamptz,timestamptz,uuid)'
    )
),
checks AS (
    SELECT '01_rpc_existe' AS verificacao,
           EXISTS (SELECT 1 FROM rpc) AS passou

    UNION ALL

    SELECT '02_security_definer',
           EXISTS (
             SELECT 1 FROM rpc
             WHERE prosecdef
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
