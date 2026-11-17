-- ZION-ADM | Bloco 2 | 2.3-D.9-P
-- Reabertura manual de uma captura em revisao.
-- Sem cron, trigger ou execucao automatica.
-- Preserva historico e evidencias anteriores.
-- A API futura deve autenticar a sessao administrativa.

BEGIN;

CREATE FUNCTION public.requeue_zion_admin_ai_run_capture_attempt_by_system(
    p_source_run_id uuid,
    p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_previous_state text;
    v_previous_attempt_count integer;
    v_max_attempts integer;
BEGIN
    -- Somente um backend confiavel pode chamar.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_source_run_id IS NULL
       OR p_admin_user_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_REQUEUE_INVALID_REQUEST'
            USING ERRCODE = '22023';
    END IF;

    -- Validar a identidade INFORMADA pelo backend.
    -- A autenticacao da sessao cabe a API administrativa.
    PERFORM 1
    FROM public.zion_internal_admins z
    WHERE z.user_id = p_admin_user_id
      AND z.is_active IS TRUE
      AND z.role IN (
          'owner',
          'admin',
          'super_admin'
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_REQUEUE_ADMIN_FORBIDDEN'
            USING ERRCODE = '42501';
    END IF;

    -- Bloqueio transacional contra reabertura simultanea.
    SELECT
        a.state,
        a.attempt_count,
        a.max_attempts
    INTO
        v_previous_state,
        v_previous_attempt_count,
        v_max_attempts
    FROM
        public.zion_admin_diagnostic_ai_run_capture_attempts a
    WHERE a.source_run_id = p_source_run_id
    FOR UPDATE OF a;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_REQUEUE_NOT_FOUND';
    END IF;

    IF v_previous_state IS DISTINCT FROM 'needs_review' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_REQUEUE_INVALID_STATE';
    END IF;

    -- Nao reabrir uma fonte cuja ocorrencia ja existe.
    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_occurrences o
        WHERE o.occurrence_key =
            'zion-b2:ai-run-error:' || p_source_run_id::text
    ) THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_REQUEUE_ALREADY_REGISTERED';
    END IF;

    -- Reiniciar apenas o contador do novo ciclo.
    -- Preservar last_sqlstate e last_failure_at.
    -- Todos os eventos anteriores permanecem no historico.
    UPDATE
        public.zion_admin_diagnostic_ai_run_capture_attempts
    SET
        state = 'pending',
        attempt_count = 0,
        next_attempt_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE source_run_id = p_source_run_id;

    -- O UPDATE e o INSERT sao atomicos na mesma transacao.
    INSERT INTO
        public.zion_admin_diagnostic_ai_run_capture_history (
            source_run_id,
            event_kind,
            previous_state,
            new_state,
            attempt_count_before,
            attempt_count_after,
            actor_kind,
            actor_user_id
        )
    VALUES (
        p_source_run_id,
        'manually_requeued',
        v_previous_state,
        'pending',
        v_previous_attempt_count,
        0,
        'zion_admin',
        p_admin_user_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'requeued', true,
        'state', 'pending',
        'attempt_count', 0,
        'max_attempts', v_max_attempts,
        'history_preserved', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.requeue_zion_admin_ai_run_capture_attempt_by_system(uuid,uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.requeue_zion_admin_ai_run_capture_attempt_by_system(uuid,uuid)
TO service_role;

COMMIT;