-- ZION-ADM 8-C.4-B.6-E-C3-B5-6-D
-- Claim financeiro OpenAI direcionado por operation_id.
--
-- NAO executa coleta OpenAI.
-- NAO modifica a RPC existente de claim em lote.
-- NAO ativa cron, flags ou retry.
-- O claim so pode atingir a operacao identificada.

BEGIN;

CREATE FUNCTION
public.zion_admin_claim_openai_cost_operation_by_id_by_system(
    p_operation_id uuid,
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
    v_lease_minutes integer := 15;
BEGIN
    IF p_operation_id IS NULL
       OR p_claimed_by IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_claimed_by)
          ) NOT BETWEEN 1 AND 128
       OR p_claimed_by IS DISTINCT FROM
          pg_catalog.btrim(p_claimed_by)
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_TARGETED_CLAIM_INVALID_REQUEST';
    END IF;

    -- Bloquear exclusivamente a operacao solicitada.
    -- Operacoes processing, confirmed, uncertain e
    -- permanent_failed nunca sao elegiveis.
    --
    -- Lease processing expirado continua inelegivel;
    -- sua recuperacao exige reconciliacao independente.

    SELECT
        o.id,
        o.state,
        o.attempt_count
    INTO v_operation
    FROM public.zion_admin_openai_cost_collection_operations o
    WHERE o.id = p_operation_id
      AND o.provider = 'openai'
      AND o.source = 'openai_organization_costs'
      AND o.state IN ('pending', 'retryable_failed')
      AND o.next_attempt_at IS NOT NULL
      AND o.next_attempt_at <=
          pg_catalog.clock_timestamp()
      AND o.attempt_count < o.max_attempts
      AND o.claim_token IS NULL
      AND o.claim_expires_at IS NULL
    FOR UPDATE OF o SKIP LOCKED;

    -- Ausente, inelegivel ou bloqueada:
    -- nenhuma outra operacao pode ser selecionada.

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'claimed',
            'claimed_count', 0,
            'lease_minutes', v_lease_minutes,
            'operations', '[]'::jsonb
        );
    END IF;

    v_now := pg_catalog.clock_timestamp();

    UPDATE public.zion_admin_openai_cost_collection_operations
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
      AND provider = 'openai'
      AND source = 'openai_organization_costs'
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
          'OPENAI_COST_TARGETED_CLAIM_STATE_CHANGED';
    END IF;

    -- Evento e alteracao de estado sao atomicos.
    -- Falha no evento reverte a transacao inteira.

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

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'claimed',
        'claimed_count', 1,
        'lease_minutes', v_lease_minutes,
        'operations',
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
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION
public.zion_admin_claim_openai_cost_operation_by_id_by_system(
    uuid, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_claim_openai_cost_operation_by_id_by_system(
    uuid, text
)
TO service_role;

COMMIT;
