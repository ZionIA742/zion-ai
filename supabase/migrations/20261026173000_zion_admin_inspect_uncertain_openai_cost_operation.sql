-- ZION-ADM 8-C.4-B.6-B
-- Inspecao conservadora de operacoes OpenAI uncertain.
-- Migration:
-- 20261026173000_zion_admin_inspect_uncertain_openai_cost_operation.sql
--
-- SOMENTE CONSULTA.
-- Nao confirma operacoes.
-- Nao associa snapshots.
-- Nao executa retries.
-- Nao ativa cron.
-- Nao altera o writer financeiro.

BEGIN;

CREATE FUNCTION
public.zion_admin_inspect_uncertain_openai_cost_operation_by_system(
    p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
DECLARE
    v_operation record;

    v_candidate_count bigint := 0;
    v_linked_candidate_count bigint := 0;
    v_candidates jsonb := '[]'::jsonb;
BEGIN

    -- 1. Identificador obrigatorio.

    IF p_operation_id IS NULL THEN
        RAISE EXCEPTION
          'OPENAI_COST_INSPECT_INVALID_REQUEST';
    END IF;

    -- 2. Somente operacoes em quarentena
    -- ou marcadas anteriormente como uncertain.

    SELECT
        o.id,
        o.operation_key,
        o.provider,
        o.source,
        o.query_identity,
        o.query_parameters,
        o.period_start,
        o.period_end,
        o.state,
        o.attempt_count,
        o.max_attempts,
        o.last_error_code,
        o.last_error_at

    INTO v_operation

    FROM
      public.zion_admin_openai_cost_collection_operations o

    WHERE o.id = p_operation_id
      AND o.state = 'uncertain'
      AND o.snapshot_collection_id IS NULL
      AND o.confirmed_at IS NULL
      AND o.claim_token IS NULL
      AND o.claim_expires_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION
          'OPENAI_COST_INSPECT_OPERATION_NOT_UNCERTAIN';
    END IF;

    -- 3. Contar snapshots compativeis.
    --
    -- Correspondencia por todos os campos
    -- fundamentais da consulta financeira.
    --
    -- Um snapshot compativel NAO comprova
    -- titularidade nem autoriza confirmacao.

    SELECT
        count(*)

    INTO v_candidate_count

    FROM
      public.zion_admin_provider_cost_collections c

    WHERE c.provider = v_operation.provider
      AND c.source = v_operation.source
      AND c.query_identity =
          v_operation.query_identity
      AND c.query_parameters =
          v_operation.query_parameters
      AND c.period_start =
          v_operation.period_start
      AND c.period_end =
          v_operation.period_end
      AND c.provider_timezone = 'UTC'
      AND c.status IN (
          'available',
          'confirmed_empty'
      );

    -- 4. Contar candidatos ja vinculados
    -- a operacoes confirmadas.
    --
    -- Isso representa evidencia importante
    -- contra uma nova associacao automatica.

    SELECT
        count(DISTINCT c.id)

    INTO v_linked_candidate_count

    FROM
      public.zion_admin_provider_cost_collections c

    WHERE c.provider = v_operation.provider
      AND c.source = v_operation.source
      AND c.query_identity =
          v_operation.query_identity
      AND c.query_parameters =
          v_operation.query_parameters
      AND c.period_start =
          v_operation.period_start
      AND c.period_end =
          v_operation.period_end
      AND c.provider_timezone = 'UTC'
      AND c.status IN (
          'available',
          'confirmed_empty'
      )

      AND EXISTS (
          SELECT 1
          FROM
            public.zion_admin_openai_cost_collection_operations o2

          WHERE o2.snapshot_collection_id = c.id
            AND o2.state = 'confirmed'
      );

    -- 5. Listar ate 20 candidatos para
    -- investigacao administrativa.
    --
    -- O total real permanece separado;
    -- a lista limitada nao deve ser tratada
    -- como levantamento exaustivo.

    SELECT
        COALESCE(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'snapshot_collection_id', s.id,
                    'collection_key', s.collection_key,
                    'status', s.status,
                    'result_count', s.result_count,
                    'collected_at', s.collected_at,
                    'linked_confirmed_operations',
                        s.linked_confirmed_operations
                )
                ORDER BY s.collected_at DESC, s.id
            ),
            '[]'::jsonb
        )

    INTO v_candidates

    FROM (
        SELECT
            c.id,
            c.collection_key,
            c.status,
            c.result_count,
            c.collected_at,

            (
                SELECT count(*)
                FROM
                  public.zion_admin_openai_cost_collection_operations o2

                WHERE o2.snapshot_collection_id = c.id
                  AND o2.state = 'confirmed'
            ) AS linked_confirmed_operations

        FROM
          public.zion_admin_provider_cost_collections c

        WHERE c.provider = v_operation.provider
          AND c.source = v_operation.source
          AND c.query_identity =
              v_operation.query_identity
          AND c.query_parameters =
              v_operation.query_parameters
          AND c.period_start =
              v_operation.period_start
          AND c.period_end =
              v_operation.period_end
          AND c.provider_timezone = 'UTC'
          AND c.status IN (
              'available',
              'confirmed_empty'
          )

        ORDER BY c.collected_at DESC, c.id

        LIMIT 20
    ) s;

    -- 6. Resultado explicitamente nao conclusivo.
    --
    -- Nao inferir falha por ausencia de snapshot.
    -- Nao inferir sucesso por existencia de snapshot.
    -- Nao recomendar retry automatico.

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'inspection_completed',

        'operation_id', v_operation.id,
        'operation_key', v_operation.operation_key,

        'state', v_operation.state,
        'attempt_count', v_operation.attempt_count,
        'max_attempts', v_operation.max_attempts,

        'last_error_code', v_operation.last_error_code,
        'last_error_at', v_operation.last_error_at,

        'matching_snapshot_candidates',
            v_candidate_count,

        'candidates_already_linked_to_confirmed',
            v_linked_candidate_count,

        'candidates_returned',
            pg_catalog.jsonb_array_length(v_candidates),

        'candidates_truncated',
            (v_candidate_count > 20),

        'candidates', v_candidates,

        'resolution', 'requires_manual_reconciliation',

        'ownership_confirmed', false,
        'financial_confirmation_performed', false,
        'retry_authorized', false,
        'retry_scheduled', false
    );

END;
$function$;

-- Permissao restrita ao servidor.

REVOKE ALL ON FUNCTION
public.zion_admin_inspect_uncertain_openai_cost_operation_by_system(
    uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_inspect_uncertain_openai_cost_operation_by_system(
    uuid
)
TO service_role;

COMMIT;

-- Diagnostico somente leitura.
-- Nao executar a nova RPC.

WITH rpc AS (
    SELECT
        p.oid,
        p.prosecdef,
        p.provolatile,
        p.proconfig

    FROM pg_catalog.pg_proc p

    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_inspect_uncertain_openai_cost_operation_by_system(uuid)'
    )
),
checks AS (

    SELECT
        '01_rpc_existe' AS verificacao,
        EXISTS (SELECT 1 FROM rpc) AS passou

    UNION ALL

    SELECT
        '02_security_definer',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE prosecdef
        )

    UNION ALL

    SELECT
        '03_search_path_restrito',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE 'search_path=""' = ANY(proconfig)
        )

    UNION ALL

    SELECT
        '04_funcao_stable',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE provolatile = 's'
        )

    UNION ALL

    SELECT
        '05_service_role_autorizado',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE pg_catalog.has_function_privilege(
                'service_role', oid, 'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '06_anon_bloqueado',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE NOT pg_catalog.has_function_privilege(
                'anon', oid, 'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '07_authenticated_bloqueado',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE NOT pg_catalog.has_function_privilege(
                'authenticated', oid, 'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '08_operacoes_preservadas',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operations
        )

    UNION ALL

    SELECT
        '09_eventos_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operation_events
        )

    UNION ALL

    SELECT
        '10_snapshots_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_provider_cost_collections
            WHERE provider = 'openai'
              AND source = 'openai_organization_costs'
        )
)

SELECT
    verificacao,
    CASE WHEN passou THEN 'PASS' ELSE 'FAIL' END AS resultado
FROM checks
ORDER BY verificacao;
