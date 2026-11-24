-- ZION-ADM | Bloco 2 | Writer de eventos operacionais
-- Requer as migrations 18-F e 18-I.
-- Nenhum cron, trigger ou processamento automatico.
-- Nunca armazena processing_error ou payload bruto.

BEGIN;

CREATE FUNCTION public.register_zion_admin_operational_failure_event_by_system(
    p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_event record;
    v_activated_at timestamptz;

    v_component text;
    v_title text;
    v_explanation text;
    v_action text;

    v_incident_key text;
    v_occurrence_key text;

    v_incident_id uuid;
    v_occurrence_id uuid;

    v_existing_org uuid;
    v_existing_store uuid;

    v_new_incident boolean := false;
    v_new_occurrence boolean := false;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_event_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_EVENT_ID_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    SELECT e.*
    INTO v_event
    FROM public.zion_admin_diagnostic_operational_failure_events e
    WHERE e.id = p_event_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_EVENT_NOT_FOUND'
            USING ERRCODE = '22023';
    END IF;

    SELECT a.activated_at
    INTO v_activated_at
    FROM public.zion_admin_diagnostic_operational_capture_activation a
    WHERE a.singleton IS TRUE;

    IF NOT FOUND
       OR v_activated_at IS NULL
       OR v_event.captured_at < v_activated_at THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_EVENT_NOT_ELIGIBLE'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.stores s
    WHERE s.id = v_event.store_id
      AND s.organization_id = v_event.organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_EVENT_SCOPE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Validar a combinacao origem/tipo de falha.
    -- Nunca confiar apenas no codigo de erro recebido.

    IF NOT (
        (
            v_event.source_system = 'channel_whatsapp_inbox'
            AND v_event.failure_code IN (
                'whatsapp_sales_ai_failed_final',
                'whatsapp_status_failed_final'
            )
        )
        OR (
            v_event.source_system = 'ai_run_queue'
            AND v_event.failure_code = 'ai_run_queue_failed_final'
        )
        OR (
            v_event.source_system = 'ai_sales_action_queue'
            AND v_event.failure_code = 'sales_action_processing_failed'
        )
    ) THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_EVENT_CLASSIFICATION_INVALID'
            USING ERRCODE = '22023';
    END IF;

    v_component := CASE v_event.source_system
        WHEN 'channel_whatsapp_inbox'
            THEN 'whatsapp_inbox'
        WHEN 'ai_run_queue'
            THEN 'sales_ai_queue'
        WHEN 'ai_sales_action_queue'
            THEN 'sales_action_queue'
    END;

    v_title := CASE v_event.source_system
        WHEN 'channel_whatsapp_inbox'
            THEN 'Falha definitiva no processamento do WhatsApp'
        WHEN 'ai_run_queue'
            THEN 'Falha definitiva na fila da inteligencia artificial'
        WHEN 'ai_sales_action_queue'
            THEN 'Falha no processamento de uma acao comercial'
    END;

    v_explanation := CASE v_event.source_system
        WHEN 'channel_whatsapp_inbox'
            THEN 'Um evento recebido pelo WhatsApp registrou uma falha definitiva.'
        WHEN 'ai_run_queue'
            THEN 'Uma tarefa da fila da IA registrou uma falha definitiva.'
        WHEN 'ai_sales_action_queue'
            THEN 'Uma acao comercial enfileirada registrou uma falha.'
    END;

    v_action :=
        'Verificar o registro de origem e o atendimento associado antes de decidir qualquer intervencao.';

    -- Incidente estavel por registro de origem.
    -- Ocorrencia unica por evento de transicao.

    v_incident_key :=
        'zion-b2:operational:' ||
        v_event.source_system || ':' ||
        v_event.source_record_id::text;

    v_occurrence_key :=
        'zion-b2:operational-event:' ||
        v_event.id::text;

    INSERT INTO public.zion_admin_diagnostic_incidents (
        incident_key,
        scope,
        organization_id,
        store_id,
        component,
        category,
        severity,
        status,
        cause_confidence,
        title_simple,
        explanation_simple,
        impact_simple,
        next_action_simple,
        first_seen_at,
        last_seen_at
    )
    VALUES (
        v_incident_key,
        'store',
        v_event.organization_id,
        v_event.store_id,
        v_component,
        'operational_queue_failure',
        'error',
        'open',
        'unknown',
        v_title,
        v_explanation,
        'O atendimento ou a execucao pode ter sido afetado. O impacto real ainda precisa ser confirmado.',
        v_action,
        v_event.captured_at,
        v_event.captured_at
    )
    ON CONFLICT (incident_key) DO NOTHING
    RETURNING id INTO v_incident_id;

    v_new_incident := FOUND;

    IF NOT v_new_incident THEN
        SELECT
            i.id,
            i.organization_id,
            i.store_id
        INTO
            v_incident_id,
            v_existing_org,
            v_existing_store
        FROM public.zion_admin_diagnostic_incidents i
        WHERE i.incident_key = v_incident_key;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'ZION_OPERATIONAL_INCIDENT_LOOKUP_FAILED';
        END IF;

        IF v_existing_org IS DISTINCT FROM v_event.organization_id
           OR v_existing_store IS DISTINCT FROM v_event.store_id THEN
            RAISE EXCEPTION
                'ZION_OPERATIONAL_INCIDENT_SCOPE_CONFLICT';
        END IF;
    END IF;

    INSERT INTO public.zion_admin_diagnostic_occurrences (
        incident_id,
        occurrence_key,
        source_system,
        source_record_id,
        error_code,
        sanitized_evidence,
        occurred_at
    )
    VALUES (
        v_incident_id,
        v_occurrence_key,
        v_event.source_system,
        v_event.source_record_id::text,
        pg_catalog.upper(v_event.failure_code),
        pg_catalog.jsonb_build_object(
            'schema_version', 1,
            'origin', v_event.source_system,
            'failure_event_id', v_event.id,
            'failure_code', v_event.failure_code,
            'attempt_count', v_event.attempt_count,
            'raw_error_stored', false
        ),
        v_event.captured_at
    )
    ON CONFLICT (occurrence_key) DO NOTHING
    RETURNING id INTO v_occurrence_id;

    v_new_occurrence := FOUND;

    IF NOT v_new_occurrence THEN
        SELECT o.id
        INTO v_occurrence_id
        FROM public.zion_admin_diagnostic_occurrences o
        WHERE o.occurrence_key = v_occurrence_key
          AND o.incident_id = v_incident_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'ZION_OPERATIONAL_OCCURRENCE_CONFLICT';
        END IF;
    ELSE
        UPDATE public.zion_admin_diagnostic_incidents
        SET
            first_seen_at = LEAST(
                first_seen_at,
                v_event.captured_at
            ),
            last_seen_at = GREATEST(
                last_seen_at,
                v_event.captured_at
            ),
            updated_at = pg_catalog.now()
        WHERE id = v_incident_id;
    END IF;

    IF v_new_incident THEN
        INSERT INTO public.zion_admin_diagnostic_history (
            incident_id,
            event_kind,
            actor_kind,
            previous_status,
            new_status,
            description_simple
        )
        VALUES (
            v_incident_id,
            'created',
            'system',
            NULL,
            'open',
            'Incidente criado a partir de falha operacional registrada.'
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'incident_id', v_incident_id,
        'occurrence_id', v_occurrence_id,
        'new_incident', v_new_incident,
        'new_occurrence', v_new_occurrence,
        'source_system', v_event.source_system,
        'event_id', v_event.id
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.register_zion_admin_operational_failure_event_by_system(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.register_zion_admin_operational_failure_event_by_system(uuid)
TO service_role;

COMMIT;