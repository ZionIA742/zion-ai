-- ZION / P19-A / BLOCO 6 / ETAPA 5.2-E.1-B.2
-- Validacao somente leitura de autorizacao de preparacao.
-- Nao emite autorizacoes, nao cria orcamentos e nao opera a fila.

BEGIN;

CREATE FUNCTION public.validate_quote_preparation_task_authorization_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_task_id uuid,
    p_request_message_id uuid,
    p_queue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
    v_now timestamptz := pg_catalog.clock_timestamp();

    v_role text;
    v_authorization public.p19a_quote_preparation_task_authorizations%ROWTYPE;
    v_task public.store_assistant_operational_tasks%ROWTYPE;
    v_queue public.store_assistant_operational_task_queue%ROWTYPE;

    v_authorization_count bigint;
    v_task_count bigint;
    v_queue_count bigint;
    v_settings_count bigint;
    v_ai_can_generate_quote boolean;
BEGIN
    v_role := public.zion_resolve_request_role_internal();

    IF v_role IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_VALIDATION_SYSTEM_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_task_id IS NULL
       OR p_request_message_id IS NULL
       OR p_queue_id IS NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_VALIDATION_IDENTITIES_INVALID'
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*)
    INTO v_authorization_count
    FROM public.p19a_quote_preparation_task_authorizations a
    WHERE a.organization_id = p_organization_id
      AND a.store_id = p_store_id
      AND a.task_id = p_task_id
      AND a.request_message_id = p_request_message_id;

    IF v_authorization_count <> 1 THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'authorization_missing_or_ambiguous',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    SELECT *
    INTO v_authorization
    FROM public.p19a_quote_preparation_task_authorizations a
    WHERE a.organization_id = p_organization_id
      AND a.store_id = p_store_id
      AND a.task_id = p_task_id
      AND a.request_message_id = p_request_message_id;

    IF v_authorization.revoked_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'authorization_revoked',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    IF v_authorization.expires_at <= v_now THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'authorization_expired',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    SELECT count(*)
    INTO v_task_count
    FROM public.store_assistant_operational_tasks t
    WHERE t.id = p_task_id
      AND t.organization_id = p_organization_id
      AND t.store_id = p_store_id;

    IF v_task_count <> 1 THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'task_missing_or_ambiguous',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    SELECT *
    INTO v_task
    FROM public.store_assistant_operational_tasks t
    WHERE t.id = p_task_id
      AND t.organization_id = p_organization_id
      AND t.store_id = p_store_id;

    IF v_task.task_type IS DISTINCT FROM 'commercial_quote_request' THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'task_type_not_quote_preparation',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    IF v_task.cancelled_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'task_cancelled',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    IF v_task.resolved_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'task_resolved',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    IF v_task.status NOT IN (
        'open',
        'waiting_user_choice',
        'waiting_customer_response',
        'ready_to_execute',
        'in_progress'
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'task_status_not_eligible',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    SELECT count(*)
    INTO v_queue_count
    FROM public.store_assistant_operational_task_queue q
    WHERE q.id = p_queue_id
      AND q.organization_id = p_organization_id
      AND q.store_id = p_store_id
      AND q.task_id = p_task_id
      AND q.message_id = p_request_message_id
      AND q.queue_type = 'quote_preparation_request';

    IF v_queue_count <> 1 THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'quote_preparation_queue_missing_or_ambiguous',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    SELECT *
    INTO v_queue
    FROM public.store_assistant_operational_task_queue q
    WHERE q.id = p_queue_id
      AND q.organization_id = p_organization_id
      AND q.store_id = p_store_id
      AND q.task_id = p_task_id
      AND q.message_id = p_request_message_id
      AND q.queue_type = 'quote_preparation_request';

    IF v_queue.status NOT IN ('pending', 'processing') THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'queue_status_not_processable',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    SELECT
        count(*),
        bool_and(qs.ai_can_generate_quote IS TRUE)
    INTO
        v_settings_count,
        v_ai_can_generate_quote
    FROM public.store_quote_settings qs
    WHERE qs.organization_id = p_organization_id
      AND qs.store_id = p_store_id;

    IF v_settings_count <> 1
       OR v_ai_can_generate_quote IS DISTINCT FROM TRUE THEN
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'ai_quote_generation_disabled_or_ambiguous',
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'task_id', p_task_id,
            'request_message_id', p_request_message_id,
            'queue_id', p_queue_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'authorized',
        'reason', 'authorization_valid',
        'authorization_id', v_authorization.id,
        'organization_id', p_organization_id,
        'store_id', p_store_id,
        'task_id', p_task_id,
        'request_message_id', p_request_message_id,
        'queue_id', p_queue_id,
        'expires_at', v_authorization.expires_at,
        'task_status', v_task.status,
        'queue_status', v_queue.status,
        'ai_can_generate_quote', true
    );
END;
$function$;

ALTER FUNCTION public.validate_quote_preparation_task_authorization_by_system(
    uuid, uuid, uuid, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.validate_quote_preparation_task_authorization_by_system(
    uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.validate_quote_preparation_task_authorization_by_system(
    uuid, uuid, uuid, uuid, uuid
) TO service_role;

COMMIT;
