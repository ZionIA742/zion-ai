-- ZION-ADM | Bloco 2 | Reprocessamento administrativo operacional
-- Nao executa processamento nem ativa cron.
-- A API deve autenticar a sessao real do administrador.
-- Nunca confiar em um UUID recebido diretamente do cliente.

BEGIN;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_history
ADD COLUMN actor_user_id uuid;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_history
ADD CONSTRAINT zadoh_actor_identity_check CHECK (
    (
        actor_kind = 'system'
        AND actor_user_id IS NULL
    )
    OR
    (
        actor_kind = 'administrator'
        AND actor_user_id IS NOT NULL
    )
);

CREATE FUNCTION
public.requeue_zion_admin_operational_capture_attempt_by_system(
    p_event_id uuid,
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

    v_captured_at timestamptz;
    v_activated_at timestamptz;

    v_organization_id uuid;
    v_store_id uuid;
BEGIN
    -- Apenas backend confiavel com service_role.

    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_event_id IS NULL
       OR p_admin_user_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_REQUEUE_INVALID_REQUEST'
            USING ERRCODE = '22023';
    END IF;

    -- A pessoa informada precisa ser administradora
    -- interna ativa. A API valida a sessao real
    -- antes de chamar esta funcao.

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
            'ZION_OPERATIONAL_REQUEUE_ADMIN_FORBIDDEN'
            USING ERRCODE = '42501';
    END IF;

    -- Bloqueio da tentativa contra duas reaberturas
    -- simultaneas do mesmo evento.

    SELECT
        a.state,
        a.attempt_count,
        a.max_attempts,
        e.captured_at,
        e.organization_id,
        e.store_id
    INTO
        v_previous_state,
        v_previous_attempt_count,
        v_max_attempts,
        v_captured_at,
        v_organization_id,
        v_store_id
    FROM public.zion_admin_diagnostic_operational_capture_attempts a
    INNER JOIN public.zion_admin_diagnostic_operational_failure_events e
        ON e.id = a.event_id
    WHERE a.event_id = p_event_id
    FOR UPDATE OF a;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_REQUEUE_NOT_FOUND';
    END IF;

    IF v_previous_state IS DISTINCT FROM 'needs_review' THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_REQUEUE_INVALID_STATE';
    END IF;

    SELECT activated_at
    INTO v_activated_at
    FROM public.zion_admin_diagnostic_operational_capture_activation
    WHERE singleton IS TRUE;

    IF v_activated_at IS NULL
       OR v_captured_at < v_activated_at THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_REQUEUE_EVENT_NOT_ELIGIBLE';
    END IF;

    -- Impedir reprocessamento de evento cujo
    -- vinculo organizacao/loja esteja inconsistente.

    PERFORM 1
    FROM public.stores s
    WHERE s.id = v_store_id
      AND s.organization_id = v_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_REQUEUE_SCOPE_INVALID';
    END IF;

    -- Nao reabrir um evento cuja ocorrencia
    -- ja esteja registrada na Central.

    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_occurrences o
        WHERE o.occurrence_key =
            'zion-b2:operational-event:' || p_event_id::text
    ) THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_REQUEUE_ALREADY_REGISTERED';
    END IF;

    -- Reiniciar somente o ciclo de tentativas.
    -- Preservar os codigos de falha anteriores
    -- ate o proximo processamento.

    UPDATE public.zion_admin_diagnostic_operational_capture_attempts
    SET
        state = 'pending',
        attempt_count = 0,
        next_attempt_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE event_id = p_event_id;

    -- Identidade do administrador e transicao
    -- registradas na mesma transacao.

    INSERT INTO public.zion_admin_diagnostic_operational_capture_history (
        event_id,
        event_kind,
        previous_state,
        new_state,
        attempt_count_before,
        attempt_count_after,
        actor_kind,
        actor_user_id
    )
    VALUES (
        p_event_id,
        'manual_requeued',
        v_previous_state,
        'pending',
        v_previous_attempt_count,
        0,
        'administrator',
        p_admin_user_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'requeued', true,
        'event_id', p_event_id,
        'state', 'pending',
        'attempt_count', 0,
        'max_attempts', v_max_attempts,
        'history_preserved', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.requeue_zion_admin_operational_capture_attempt_by_system(uuid,uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.requeue_zion_admin_operational_capture_attempt_by_system(uuid,uuid)
TO service_role;

COMMIT;