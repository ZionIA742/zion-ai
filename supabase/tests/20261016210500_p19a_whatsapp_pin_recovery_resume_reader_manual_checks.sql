-- ZION / P19-A / 4-B.4
-- Runner corrigido: reader de retomada remote_confirmed
-- Nenhuma alteracao persistente.
-- Corrige verificacao search_path="" e uso de MAX para UUID.

BEGIN TRANSACTION READ ONLY;

DO $runner$
DECLARE
    v_function regprocedure;
    v_actor uuid;
    v_attempt_count integer;
    v_result_count integer;

    v_organization_id uuid :=
        'fbd4afaa-4958-4663-9234-98589ab322c7';

    v_store_id uuid :=
        '54fb81f4-92e5-463a-af6c-fc1544ea4b04';

    v_waba_id text := '1642288770859048';
    v_phone_id text := '1322472314288518';
BEGIN

    -- 1. Existencia da funcao
    v_function := pg_catalog.to_regprocedure(
        'public.read_whatsapp_pin_recovery_resumable_attempt_by_system(uuid,uuid,uuid,text,text)'
    );

    IF v_function IS NULL THEN
        RAISE EXCEPTION 'FAIL_FUNCTION_NOT_INSTALLED';
    END IF;

    -- 2. SECURITY DEFINER e search_path vazio
    -- PostgreSQL pode representar vazio como search_path=""
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_function::oid
          AND p.prosecdef = true
          AND EXISTS (
              SELECT 1
              FROM pg_catalog.unnest(p.proconfig) AS cfg(value)
              WHERE cfg.value IN (
                  'search_path=',
                  'search_path=""'
              )
          )
    ) THEN
        RAISE EXCEPTION 'FAIL_FUNCTION_SECURITY_CONFIGURATION';
    END IF;

    -- 3. Permissoes
    IF pg_catalog.has_function_privilege(
        'anon', v_function::oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
        'authenticated', v_function::oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
        'service_role', v_function::oid, 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'FAIL_FUNCTION_PERMISSIONS';
    END IF;

    -- 4. Localizar somente a tentativa confirmada
    SELECT COUNT(*), MAX(a.actor_user_id::text)::uuid
    INTO v_attempt_count, v_actor
    FROM public.whatsapp_pin_recovery_attempts a
    WHERE a.organization_id = v_organization_id
      AND a.store_id = v_store_id
      AND a.waba_id = v_waba_id
      AND a.phone_number_id = v_phone_id
      AND a.status = 'remote_confirmed';

    IF v_attempt_count <> 1 OR v_actor IS NULL THEN
        RAISE EXCEPTION
            'FAIL_REMOTE_CONFIRMED_ATTEMPT_COUNT: %',
            v_attempt_count;
    END IF;

    -- 5. Uma chamada comum deve ser rejeitada
    PERFORM pg_catalog.set_config(
        'request.jwt.claim.role',
        'authenticated',
        true
    );

    BEGIN
        PERFORM 1
        FROM public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
            v_actor,
            v_organization_id,
            v_store_id,
            v_waba_id,
            v_phone_id
        );

        RAISE EXCEPTION 'FAIL_AUTHENTICATED_ROLE_ACCEPTED';

    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            NULL;
    END;

    -- 6. Simular contexto service_role apenas na transacao
    PERFORM pg_catalog.set_config(
        'request.jwt.claim.role',
        'service_role',
        true
    );

    -- 7. Mesmo administrador e alvo correto
    SELECT COUNT(*)
    INTO v_result_count
    FROM public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
        v_actor,
        v_organization_id,
        v_store_id,
        v_waba_id,
        v_phone_id
    ) r
    WHERE r.status = 'remote_confirmed'
      AND r.attempt_id IS NOT NULL
      AND r.operation_id IS NOT NULL
      AND r.remote_result_at IS NOT NULL;

    IF v_result_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL_VALID_RECOVERY_NOT_FOUND: %',
            v_result_count;
    END IF;

    -- 8. Administrador inexistente deve ser rejeitado
    BEGIN
        PERFORM 1
        FROM public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
            pg_catalog.gen_random_uuid(),
            v_organization_id,
            v_store_id,
            v_waba_id,
            v_phone_id
        );

        RAISE EXCEPTION 'FAIL_UNKNOWN_ACTOR_ACCEPTED';

    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            NULL;
    END;

    -- 9. WABA diferente
    SELECT COUNT(*)
    INTO v_result_count
    FROM public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
        v_actor,
        v_organization_id,
        v_store_id,
        'WABA_DIFERENTE',
        v_phone_id
    );

    IF v_result_count <> 0 THEN
        RAISE EXCEPTION 'FAIL_WABA_ISOLATION';
    END IF;

    -- 10. Organizacao diferente
    SELECT COUNT(*)
    INTO v_result_count
    FROM public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
        v_actor,
        pg_catalog.gen_random_uuid(),
        v_store_id,
        v_waba_id,
        v_phone_id
    );

    IF v_result_count <> 0 THEN
        RAISE EXCEPTION 'FAIL_ORGANIZATION_ISOLATION';
    END IF;

    -- 11. Loja diferente
    SELECT COUNT(*)
    INTO v_result_count
    FROM public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
        v_actor,
        v_organization_id,
        pg_catalog.gen_random_uuid(),
        v_waba_id,
        v_phone_id
    );

    IF v_result_count <> 0 THEN
        RAISE EXCEPTION 'FAIL_STORE_ISOLATION';
    END IF;

    -- 12. Telefone diferente
    SELECT COUNT(*)
    INTO v_result_count
    FROM public.read_whatsapp_pin_recovery_resumable_attempt_by_system(
        v_actor,
        v_organization_id,
        v_store_id,
        v_waba_id,
        'PHONE_DIFERENTE'
    );

    IF v_result_count <> 0 THEN
        RAISE EXCEPTION 'FAIL_PHONE_ISOLATION';
    END IF;

    RAISE NOTICE
        'PASS: security definer, search_path, permissoes, tentativa e isolamento';

END;
$runner$;

ROLLBACK;

SELECT
    'PASS_READ_ONLY_SEM_PERSISTENCIA' AS resultado,
    'Reader validado sem modificar tentativa, PIN ou integracao'
        AS observacao;
