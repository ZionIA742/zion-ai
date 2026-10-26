-- ZION-ADM 8-C.4-B.6-A
-- Quarentena de operacoes OpenAI com lease expirado.
-- Migration:
-- 20261026170000_zion_admin_quarantine_expired_openai_cost_operations.sql
--
-- Nao executa coletas.
-- Nao cria snapshots.
-- Nao inicia retries.
-- Nao confirma despesas.
-- Nao ativa cron.

BEGIN;

CREATE FUNCTION
public.zion_admin_quarantine_expired_openai_cost_operations_by_system(
    p_limit integer,
    p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_operation record;

    v_now timestamptz;
    v_updated_id uuid;

    v_candidate_count integer;

    v_items jsonb := '[]'::jsonb;
    v_count integer := 0;

    v_error_code text :=
      'OPENAI_COST_LEASE_EXPIRED_UNCERTAIN';
BEGIN

    -- 1. Validacao do limite e do ator tecnico.

    IF p_limit IS NULL
       OR p_limit NOT BETWEEN 1 AND 10
       OR p_actor IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_actor)
          ) NOT BETWEEN 1 AND 128
       OR p_actor IS DISTINCT FROM
          pg_catalog.btrim(p_actor)
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_QUARANTINE_INVALID_REQUEST';
    END IF;

    -- 2. Selecionar apenas operacoes efetivamente
    -- expiradas e ainda em processamento.
    --
    -- SKIP LOCKED evita disputar a operacao
    -- com uma finalizacao em andamento.
    --
    -- Operacoes confirmed nao sao selecionadas.
    -- Operacoes uncertain nao sao reprocessadas.

    FOR v_operation IN

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
            o.claim_token,
            o.claim_expires_at,
            o.claimed_by

        FROM
          public.zion_admin_openai_cost_collection_operations o

        WHERE o.state = 'processing'
          AND o.claim_token IS NOT NULL
          AND o.claim_expires_at IS NOT NULL
          AND o.claim_expires_at <=
              pg_catalog.clock_timestamp()
          AND o.snapshot_collection_id IS NULL
          AND o.confirmed_at IS NULL

        ORDER BY
            o.claim_expires_at,
            o.created_at,
            o.id

        LIMIT p_limit

        FOR UPDATE OF o SKIP LOCKED

    LOOP

        v_now := pg_catalog.clock_timestamp();

        -- 3. Consultar evidencia financeira existente.
        --
        -- Correspondencia por consulta, periodo,
        -- parametros e provedor.
        --
        -- Mesmo um unico snapshot compativel NAO
        -- comprova titularidade da operacao.
        --
        -- Esta consulta nao modifica snapshots.

        SELECT count(*)
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

        -- 4. Fencing e transicao atomica.
        --
        -- Mesmo sem candidato financeiro, NAO
        -- converter a operacao em retryable_failed.
        --
        -- A ausencia de snapshot local nao prova
        -- que a execucao anterior nao ocorreu.

        UPDATE
          public.zion_admin_openai_cost_collection_operations

        SET
            state = 'uncertain',
            next_attempt_at = NULL,

            claim_token = NULL,
            claim_expires_at = NULL,
            claimed_by = NULL,

            last_error_code = v_error_code,
            last_error_at = v_now,
            updated_at = v_now

        WHERE id = v_operation.id
          AND state = 'processing'
          AND claim_token = v_operation.claim_token
          AND claim_expires_at <= v_now
          AND snapshot_collection_id IS NULL
          AND confirmed_at IS NULL

        RETURNING id
        INTO v_updated_id;

        IF v_updated_id IS DISTINCT FROM v_operation.id
        THEN
            RAISE EXCEPTION
              'OPENAI_COST_QUARANTINE_STATE_CHANGED';
        END IF;

        -- 5. Auditoria imutavel na mesma transacao.
        --
        -- A origem do processamento anterior
        -- permanece preservada no evento 'claimed'.
        -- O evento atual identifica o reconciliador.

        INSERT INTO
          public.zion_admin_openai_cost_collection_operation_events (
              operation_id,
              event_kind,
              from_state,
              to_state,
              attempt_count,
              occurred_at,
              error_code,
              technical_actor
          )

        VALUES (
            v_operation.id,
            'lease_expired_uncertain',
            'processing',
            'uncertain',
            v_operation.attempt_count,
            v_now,
            v_error_code,
            p_actor
        );

        -- 6. Retorno diagnostico.
        --
        -- candidate_count e apenas evidencia.
        -- Nao representa atribuicao nem confirmacao.

        v_items := v_items ||
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'operation_id', v_operation.id,
                'operation_key', v_operation.operation_key,

                'previous_state', 'processing',
                'state', 'uncertain',

                'attempt_count',
                    v_operation.attempt_count,

                'previous_claimed_by',
                    v_operation.claimed_by,

                'previous_claim_expires_at',
                    v_operation.claim_expires_at,

                'matching_snapshot_candidates',
                    v_candidate_count,

                'snapshot_linked', false,
                'retry_scheduled', false,
                'requires_reconciliation', true
            )
          );

        v_count := v_count + 1;

    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'quarantine_completed',
        'quarantined_count', v_count,
        'operations', v_items
    );

END;
$function$;

-- Permissoes: somente servidor.

REVOKE ALL ON FUNCTION
public.zion_admin_quarantine_expired_openai_cost_operations_by_system(
    integer, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_quarantine_expired_openai_cost_operations_by_system(
    integer, text
)
TO service_role;

COMMIT;

-- Diagnostico de instalacao.
-- SOMENTE LEITURA.
-- Nao executar a nova RPC.

WITH rpc AS (
    SELECT
        p.oid,
        p.prosecdef,
        p.proconfig

    FROM pg_catalog.pg_proc p

    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_quarantine_expired_openai_cost_operations_by_system(integer,text)'
    )
),
checks AS (

    SELECT
        '01_rpc_existe' AS verificacao,
        EXISTS (
            SELECT 1 FROM rpc
        ) AS passou

    UNION ALL

    SELECT
        '02_security_definer',
        EXISTS (
            SELECT 1
            FROM rpc
            WHERE prosecdef
        )

    UNION ALL

    SELECT
        '03_search_path_restrito',
        EXISTS (
            SELECT 1
            FROM rpc
            WHERE 'search_path=""' = ANY(proconfig)
        )

    UNION ALL

    SELECT
        '04_service_role_autorizado',
        EXISTS (
            SELECT 1
            FROM rpc
            WHERE pg_catalog.has_function_privilege(
                'service_role',
                oid,
                'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '05_anon_bloqueado',
        EXISTS (
            SELECT 1
            FROM rpc
            WHERE NOT pg_catalog.has_function_privilege(
                'anon',
                oid,
                'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '06_authenticated_bloqueado',
        EXISTS (
            SELECT 1
            FROM rpc
            WHERE NOT pg_catalog.has_function_privilege(
                'authenticated',
                oid,
                'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '07_operacoes_preservadas',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operations
        )

    UNION ALL

    SELECT
        '08_snapshots_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_provider_cost_collections
            WHERE provider = 'openai'
              AND source = 'openai_organization_costs'
        )

    UNION ALL

    SELECT
        '09_eventos_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operation_events
        )
)

SELECT
    verificacao,
    CASE
        WHEN passou THEN 'PASS'
        ELSE 'FAIL'
    END AS resultado

FROM checks
ORDER BY verificacao;
