-- ZION-ADM 8-C.4-B.4
-- Finalizacao atomica de operacao financeira OpenAI.
-- Migration:
-- 20261026160000_zion_admin_finalize_openai_cost_collection_operation.sql
--
-- A operacao, o snapshot e o evento de auditoria
-- participam da mesma transacao.
-- Nao inicia coleta, cron ou reconciliacao.

BEGIN;

CREATE FUNCTION
public.zion_admin_finalize_openai_cost_collection_operation_by_system(
    p_operation_id uuid,
    p_claim_token uuid,
    p_collection jsonb,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_operation record;
    v_writer_result jsonb;
    v_collection_id uuid;
    v_confirmed_id uuid;
    v_now timestamptz;
BEGIN

    -- 1. Validacao inicial.

    IF p_operation_id IS NULL
       OR p_claim_token IS NULL
       OR p_collection IS NULL
       OR p_lines IS NULL
       OR pg_catalog.jsonb_typeof(p_collection)
          IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(p_lines)
          IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_INVALID_REQUEST';
    END IF;

    -- 2. Lock exclusivo da operacao.
    -- Impede mudanca simultanea de estado/token
    -- enquanto o snapshot esta sendo gravado.

    SELECT
        o.*
    INTO v_operation
    FROM public.zion_admin_openai_cost_collection_operations o
    WHERE o.id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_CLAIM_NOT_ACTIVE';
    END IF;

    v_now := pg_catalog.clock_timestamp();

    -- 3. Verificar titularidade e validade do lease.

    IF v_operation.state IS DISTINCT FROM 'processing'
       OR v_operation.claim_token
          IS DISTINCT FROM p_claim_token
       OR v_operation.claim_expires_at IS NULL
       OR v_operation.claim_expires_at <= v_now
       OR v_operation.claimed_by IS NULL
       OR v_operation.attempt_count < 1
       OR v_operation.snapshot_collection_id IS NOT NULL
       OR v_operation.confirmed_at IS NOT NULL
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_CLAIM_NOT_ACTIVE';
    END IF;

    -- 4. Vincular o payload financeiro a identidade
    -- e ao periodo da operacao que detem o claim.
    --
    -- A validacao integral das linhas permanece
    -- responsabilidade do writer existente.

    IF p_collection ->> 'provider'
          IS DISTINCT FROM v_operation.provider
       OR p_collection ->> 'source'
          IS DISTINCT FROM v_operation.source
       OR p_collection ->> 'query_identity'
          IS DISTINCT FROM v_operation.query_identity
       OR p_collection -> 'query_parameters'
          IS DISTINCT FROM v_operation.query_parameters
       OR (p_collection ->> 'period_start')::timestamptz
          IS DISTINCT FROM v_operation.period_start
       OR (p_collection ->> 'period_end')::timestamptz
          IS DISTINCT FROM v_operation.period_end
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_QUERY_MISMATCH';
    END IF;

    -- 5. Gravar snapshot e linhas financeiras.
    --
    -- O writer ja protege:
    -- - envelope e linhas invalidas;
    -- - consistencia de periodo e valores;
    -- - idempotencia por collection_key;
    -- - insercao atomica de cabecalho e linhas.
    --
    -- Qualquer excecao reverte toda a transacao,
    -- inclusive insercoes feitas pelo writer.

    v_writer_result :=
      public.zion_admin_write_openai_provider_cost_snapshot(
          p_collection,
          p_lines
      );

    IF v_writer_result ->> 'outcome'
          NOT IN ('inserted', 'replayed')
       OR v_writer_result ->> 'outcome' IS NULL
       OR v_writer_result ->> 'collection_id' IS NULL
       OR v_writer_result ->> 'collection_key'
          IS DISTINCT FROM p_collection ->> 'collection_key'
       OR v_writer_result ->> 'status'
          IS DISTINCT FROM p_collection ->> 'status'
       OR (v_writer_result ->> 'line_count')::integer
          IS DISTINCT FROM
             pg_catalog.jsonb_array_length(p_lines)
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_INVALID_WRITER_RESULT';
    END IF;

    v_collection_id :=
      (v_writer_result ->> 'collection_id')::uuid;

    IF v_collection_id IS NULL THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_MISSING_SNAPSHOT';
    END IF;

    -- 6. Conferir novamente o lease depois
    -- da gravacao financeira.
    --
    -- Se expirou durante o writer, tudo sera
    -- revertido, inclusive o snapshot.

    v_now := pg_catalog.clock_timestamp();

    IF v_operation.claim_expires_at <= v_now THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_LEASE_EXPIRED';
    END IF;

    -- 7. Confirmacao da operacao e liberacao
    -- do claim, sem abrir outra transacao.

    UPDATE
      public.zion_admin_openai_cost_collection_operations
    SET
        state = 'confirmed',
        snapshot_collection_id = v_collection_id,
        confirmed_at = v_now,
        claim_token = NULL,
        claim_expires_at = NULL,
        claimed_by = NULL,
        next_attempt_at = NULL,
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = v_now
    WHERE id = p_operation_id
      AND state = 'processing'
      AND claim_token = p_claim_token
      AND claim_expires_at > v_now
    RETURNING id
    INTO v_confirmed_id;

    IF v_confirmed_id IS DISTINCT FROM p_operation_id THEN
        RAISE EXCEPTION
          'OPENAI_COST_FINALIZE_STATE_CHANGED';
    END IF;

    -- 8. Evento auditavel na mesma transacao.
    -- Se o evento falhar, a confirmacao
    -- e a gravacao financeira serao revertidas.

    INSERT INTO
      public.zion_admin_openai_cost_collection_operation_events (
          operation_id,
          event_kind,
          from_state,
          to_state,
          attempt_count,
          occurred_at,
          snapshot_collection_id,
          technical_actor
      )
    VALUES (
        p_operation_id,
        'confirmed',
        'processing',
        'confirmed',
        v_operation.attempt_count,
        v_now,
        v_collection_id,
        v_operation.claimed_by
    );

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'confirmed',
        'operation_id', p_operation_id,
        'operation_key', v_operation.operation_key,
        'snapshot_collection_id', v_collection_id,
        'snapshot_outcome',
            v_writer_result ->> 'outcome',
        'confirmed_at', v_now
    );

END;
$function$;

REVOKE ALL ON FUNCTION
public.zion_admin_finalize_openai_cost_collection_operation_by_system(
    uuid, uuid, jsonb, jsonb
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_finalize_openai_cost_collection_operation_by_system(
    uuid, uuid, jsonb, jsonb
)
TO service_role;

COMMIT;

-- Verificacoes de instalacao e seguranca.
-- Somente leitura. Nao chamar a RPC.

WITH rpc AS (
    SELECT p.oid, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_finalize_openai_cost_collection_operation_by_system(uuid,uuid,jsonb,jsonb)'
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

    SELECT '07_writer_existente',
           pg_catalog.to_regprocedure(
             'public.zion_admin_write_openai_provider_cost_snapshot(jsonb,jsonb)'
           ) IS NOT NULL

    UNION ALL

    SELECT '08_operacoes_sem_alteracoes',
           NOT EXISTS (
             SELECT 1
             FROM public.zion_admin_openai_cost_collection_operations
           )
)
SELECT
    verificacao,
    CASE WHEN passou THEN 'PASS' ELSE 'FAIL' END AS resultado
FROM checks
ORDER BY verificacao;
