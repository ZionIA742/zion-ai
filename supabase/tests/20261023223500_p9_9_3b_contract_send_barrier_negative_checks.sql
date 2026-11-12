-- ZION | PILAR 9 | ETAPA 9.3-B
-- Testes negativos das autoridades de barreira.
-- UUIDs sinteticos. Sem envio Meta.
-- Nenhuma fixture persistente.
-- ROLLBACK obrigatorio.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
    v_org uuid := gen_random_uuid();
    v_store uuid := gen_random_uuid();
    v_opportunity uuid := gen_random_uuid();
    v_contract uuid := gen_random_uuid();
    v_version uuid := gen_random_uuid();
    v_message uuid := gen_random_uuid();

    v_key text;
    v_error text;
    v_successes integer := 0;
BEGIN
    v_key :=
        'sales_contract_send:'
        || v_org::text || ':'
        || v_store::text || ':'
        || v_contract::text || ':'
        || v_version::text;

    -- TESTE 1: chave de idempotencia incorreta.

    BEGIN
        PERFORM
            public.p9_activate_sales_contract_send_barrier_internal(
                v_org,
                v_store,
                v_opportunity,
                v_contract,
                v_version,
                v_message,
                'chave_invalida'
            );

        RAISE EXCEPTION 'TESTE_1_FALHOU_ACEITOU_CHAVE';

    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;

        IF v_error IS DISTINCT FROM
            'P9_BARRIER_IDEMPOTENCY_KEY_INVALID'
        THEN
            RAISE EXCEPTION
                'TESTE_1_RESULTADO_INESPERADO: %',
                v_error;
        END IF;
    END;

    v_successes := v_successes + 1;

    -- TESTE 2: contrato inexistente.

    BEGIN
        PERFORM
            public.p9_activate_sales_contract_send_barrier_internal(
                v_org,
                v_store,
                v_opportunity,
                v_contract,
                v_version,
                v_message,
                v_key
            );

        RAISE EXCEPTION 'TESTE_2_FALHOU_ACEITOU_CONTRATO';

    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;

        IF v_error IS DISTINCT FROM
            'P9_BARRIER_CONTRACT_INVALID'
        THEN
            RAISE EXCEPTION
                'TESTE_2_RESULTADO_INESPERADO: %',
                v_error;
        END IF;
    END;

    v_successes := v_successes + 1;

    -- TESTE 3: liberacao sem barreira correspondente.

    BEGIN
        PERFORM
            public.p9_release_sales_contract_send_barrier_finalized_internal(
                v_org,
                v_store,
                v_contract,
                v_message,
                v_key
            );

        RAISE EXCEPTION 'TESTE_3_FALHOU_LIBEROU_SEM_BARREIRA';

    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;

        IF v_error IS DISTINCT FROM
            'P9_BARRIER_RELEASE_MATCH_NOT_FOUND'
        THEN
            RAISE EXCEPTION
                'TESTE_3_RESULTADO_INESPERADO: %',
                v_error;
        END IF;
    END;

    v_successes := v_successes + 1;

    -- TESTE 4: nenhuma persistencia sintetica.

    IF EXISTS (
        SELECT 1
        FROM public.p9_sales_contract_send_barriers
        WHERE organization_id = v_org
          AND store_id = v_store
    )
    OR EXISTS (
        SELECT 1
        FROM public.messages
        WHERE organization_id = v_org
          AND store_id = v_store
    )
    THEN
        RAISE EXCEPTION
            'TESTE_4_FALHOU_REGISTROS_INESPERADOS';
    END IF;

    v_successes := v_successes + 1;

    IF v_successes <> 4 THEN
        RAISE EXCEPTION
            'TESTES_INCOMPLETOS: %',
            v_successes;
    END IF;

    RAISE NOTICE
        'P9_BARRIER_NEGATIVE_TESTS: 4/4 PASS';

END;
$test$;

ROLLBACK;
