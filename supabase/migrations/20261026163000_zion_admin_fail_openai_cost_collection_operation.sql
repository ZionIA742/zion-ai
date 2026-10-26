-- ZION-ADM 8-C.4-B.5
-- Registro controlado de falhas da coleta OpenAI.
-- Migration:
-- 20261026163000_zion_admin_fail_openai_cost_collection_operation.sql
--
-- Nao inicia coletas, retries ou cron.
-- Nao modifica o writer financeiro.
-- Nao recupera automaticamente leases expirados.

BEGIN;

CREATE FUNCTION
public.zion_admin_fail_openai_cost_collection_operation_by_system(
    p_operation_id uuid,
    p_claim_token uuid,
    p_failure_kind text,
    p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_operation record;
    v_updated_id uuid;

    v_now timestamptz;
    v_new_state text;
    v_event_kind text;

    v_next_attempt_at timestamptz;
    v_retry_delay_minutes integer;
BEGIN

    -- 1. Validar o envelope.
    --
    -- error_code deve ser um codigo tecnico estavel,
    -- nunca uma mensagem livre, segredo ou payload.

    IF p_operation_id IS NULL
       OR p_claim_token IS NULL
       OR p_failure_kind IS NULL
       OR p_failure_kind NOT IN (
           'retryable',
           'permanent',
           'uncertain'
       )
       OR p_error_code IS NULL
       OR p_error_code !~
          '^[A-Z][A-Z0-9_]{0,63}$'
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_FAIL_INVALID_REQUEST';
    END IF;

    -- 2. Bloquear a operacao.
    --
    -- Serializa esta transicao contra finalizacao,
    -- outra falha ou reconciliacao futura.

    SELECT
        o.id,
        o.operation_key,
        o.state,
        o.attempt_count,
        o.max_attempts,
        o.claim_token,
        o.claim_expires_at,
        o.claimed_by,
        o.snapshot_collection_id,
        o.confirmed_at
    INTO v_operation
    FROM
      public.zion_admin_openai_cost_collection_operations o
    WHERE o.id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
          'OPENAI_COST_FAIL_CLAIM_NOT_ACTIVE';
    END IF;

    v_now := pg_catalog.clock_timestamp();

    -- 3. Fencing: apenas o worker titular pode
    -- classificar a falha enquanto o lease existir.
    --
    -- Lease expirado exige reconciliacao.
    -- Nunca converter automaticamente em retry.

    IF v_operation.state IS DISTINCT FROM 'processing'
       OR v_operation.claim_token
          IS DISTINCT FROM p_claim_token
       OR v_operation.claim_expires_at IS NULL
       OR v_operation.claim_expires_at <= v_now
       OR v_operation.claimed_by IS NULL
       OR v_operation.attempt_count < 1
       OR v_operation.attempt_count >
          v_operation.max_attempts
       OR v_operation.snapshot_collection_id IS NOT NULL
       OR v_operation.confirmed_at IS NOT NULL
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_FAIL_CLAIM_NOT_ACTIVE';
    END IF;

    -- 4. Determinar o destino.
    --
    -- Uma falha recuperavel na ultima tentativa
    -- encerra a operacao sem abrir quarta tentativa.

    v_next_attempt_at := NULL;
    v_retry_delay_minutes := NULL;

    IF p_failure_kind = 'uncertain' THEN

        v_new_state := 'uncertain';
        v_event_kind := 'marked_uncertain';

    ELSIF p_failure_kind = 'permanent' THEN

        v_new_state := 'permanent_failed';
        v_event_kind := 'failed_permanent';

    ELSIF v_operation.attempt_count >=
          v_operation.max_attempts
    THEN

        v_new_state := 'permanent_failed';
        v_event_kind := 'retry_limit_exhausted';

    ELSE

        v_new_state := 'retryable_failed';
        v_event_kind := 'failed_retryable';

        -- Tentativa 1: aguardar 5 minutos.
        -- Tentativa 2: aguardar 15 minutos.
        -- Tentativa 3: nao agenda retry.

        v_retry_delay_minutes :=
          CASE v_operation.attempt_count
            WHEN 1 THEN 5
            ELSE 15
          END;

        v_next_attempt_at :=
          v_now + pg_catalog.make_interval(
              mins => v_retry_delay_minutes
          );

    END IF;

    -- 5. Atualizar o estado dentro do mesmo
    -- lock e conferir novamente o lease.
    --
    -- Nao manter token em estados de falha.

    v_now := pg_catalog.clock_timestamp();

    IF v_operation.claim_expires_at <= v_now THEN
        RAISE EXCEPTION
          'OPENAI_COST_FAIL_CLAIM_NOT_ACTIVE';
    END IF;

    IF v_new_state = 'retryable_failed' THEN

        v_next_attempt_at :=
          v_now + pg_catalog.make_interval(
              mins => v_retry_delay_minutes
          );

    END IF;

    UPDATE
      public.zion_admin_openai_cost_collection_operations
    SET
        state = v_new_state,
        next_attempt_at = v_next_attempt_at,

        claim_token = NULL,
        claim_expires_at = NULL,
        claimed_by = NULL,

        last_error_code = p_error_code,
        last_error_at = v_now,
        updated_at = v_now

    WHERE id = p_operation_id
      AND state = 'processing'
      AND claim_token = p_claim_token
      AND claim_expires_at > v_now
      AND snapshot_collection_id IS NULL
      AND confirmed_at IS NULL

    RETURNING id INTO v_updated_id;

    IF v_updated_id IS DISTINCT FROM p_operation_id THEN
        RAISE EXCEPTION
          'OPENAI_COST_FAIL_STATE_CHANGED';
    END IF;

    -- 6. Auditoria imutavel.
    --
    -- Evento e mudanca de estado participam
    -- da mesma transacao.
    -- Qualquer erro reverte ambos.

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
        p_operation_id,
        v_event_kind,
        'processing',
        v_new_state,
        v_operation.attempt_count,
        v_now,
        p_error_code,
        v_operation.claimed_by
    );

    -- 7. Retorno explicito da classificacao.
    --
    -- O resultado indica agendamento de retry,
    -- nao execucao ou sucesso financeiro.

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'failure_recorded',
        'operation_id', p_operation_id,
        'operation_key', v_operation.operation_key,

        'state', v_new_state,
        'event_kind', v_event_kind,
        'error_code', p_error_code,

        'attempt_count', v_operation.attempt_count,
        'max_attempts', v_operation.max_attempts,

        'retry_scheduled',
            (v_new_state = 'retryable_failed'),

        'next_attempt_at', v_next_attempt_at,

        'retry_delay_minutes', v_retry_delay_minutes
    );

END;
$function$;

-- 8. Permissoes exclusivamente de servidor.

REVOKE ALL ON FUNCTION
public.zion_admin_fail_openai_cost_collection_operation_by_system(
    uuid, uuid, text, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_fail_openai_cost_collection_operation_by_system(
    uuid, uuid, text, text
)
TO service_role;

COMMIT;

-- 9. Verificacoes somente leitura.
-- Nao chamar a nova RPC neste passo.

WITH rpc AS (
    SELECT
        p.oid,
        p.prosecdef,
        p.proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_fail_openai_cost_collection_operation_by_system(uuid,uuid,text,text)'
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
        '07_tabela_operacoes_preservada',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operations
        )

    UNION ALL

    SELECT
        '08_eventos_preservados',
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
