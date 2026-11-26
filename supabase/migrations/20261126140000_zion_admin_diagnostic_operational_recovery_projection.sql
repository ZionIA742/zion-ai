-- ZION-ADM | Operational recovery projection.
-- No operational queue writes or cron changes.

BEGIN;

CREATE FUNCTION public.reconcile_zion_admin_operational_incident_internal(
    p_source_system text,
    p_source_record_id uuid,
    p_organization_id uuid,
    p_store_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    v_incident record;
    v_activation timestamptz;
    v_failure_count bigint;
    v_unresolved_count bigint;
    v_recovered_at timestamptz;
    v_recovery record;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'zion-adm-operational-recovery:' ||
            p_source_system || ':' ||
            p_source_record_id::text,
            0
        )
    );

    SELECT a.activated_at
    INTO v_activation
    FROM public.zion_admin_diagnostic_operational_capture_activation a
    WHERE a.singleton IS TRUE;

    IF v_activation IS NULL THEN
        RETURN;
    END IF;

    SELECT i.id, i.status, i.resolved_at
    INTO v_incident
    FROM public.zion_admin_diagnostic_incidents i
    WHERE i.incident_key =
        'zion-b2:operational:' ||
        p_source_system || ':' ||
        p_source_record_id::text
      AND i.organization_id = p_organization_id
      AND i.store_id = p_store_id
      AND i.scope = 'store'
      AND i.category = 'operational_queue_failure'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Preserve each explicitly registered recovery in history.
    -- The shared lock serializes history and status projection.

    FOR v_recovery IN
        SELECT
            r.failure_event_id,
            r.evidence_kind,
            r.processed_at
        FROM public.zion_admin_diagnostic_operational_recovery_events r
        JOIN public.zion_admin_diagnostic_operational_failure_events f
          ON f.id = r.failure_event_id
        WHERE f.source_system = p_source_system
          AND f.source_record_id = p_source_record_id
          AND f.organization_id = p_organization_id
          AND f.store_id = p_store_id
          AND f.captured_at >= v_activation
          AND r.processed_at > f.captured_at
        ORDER BY r.processed_at, r.failure_event_id
    LOOP

        INSERT INTO public.zion_admin_diagnostic_history (
            incident_id,
            event_kind,
            actor_kind,
            description_simple,
            sanitized_details
        )
        SELECT
            v_incident.id,
            'operational_recovery_confirmed',
            'system',
            'Recuperacao operacional comprovada.',
            pg_catalog.jsonb_build_object(
                'failure_event_id', v_recovery.failure_event_id,
                'evidence_kind', v_recovery.evidence_kind,
                'processed_at', v_recovery.processed_at
            )
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_diagnostic_history h
            WHERE h.incident_id = v_incident.id
              AND h.event_kind =
                  'operational_recovery_confirmed'
              AND h.sanitized_details ->> 'failure_event_id' =
                  v_recovery.failure_event_id::text
        );

    END LOOP;

    -- A later proven recovery may cover earlier failures
    -- of the same operation and same failure classification.
    -- It cannot cover a different source, scope or failure code.

    SELECT
        count(*),
        count(*) FILTER (
            WHERE NOT EXISTS (
                SELECT 1
                FROM public.zion_admin_diagnostic_operational_recovery_events r
                JOIN public.zion_admin_diagnostic_operational_failure_events rf
                  ON rf.id = r.failure_event_id
                WHERE rf.source_system = f.source_system
                  AND rf.source_record_id = f.source_record_id
                  AND rf.organization_id = f.organization_id
                  AND rf.store_id = f.store_id
                  AND rf.failure_code = f.failure_code
                  AND rf.captured_at >= f.captured_at
                  AND r.processed_at > rf.captured_at
            )
        )
    INTO v_failure_count, v_unresolved_count
    FROM public.zion_admin_diagnostic_operational_failure_events f
    WHERE f.source_system = p_source_system
      AND f.source_record_id = p_source_record_id
      AND f.organization_id = p_organization_id
      AND f.store_id = p_store_id
      AND f.captured_at >= v_activation;

    IF v_failure_count = 0 THEN
        RETURN;
    END IF;

    IF v_unresolved_count > 0 THEN

        IF v_incident.status = 'resolved' THEN

            UPDATE public.zion_admin_diagnostic_incidents
            SET status = 'open',
                resolved_at = NULL,
                updated_at = pg_catalog.clock_timestamp()
            WHERE id = v_incident.id;

            INSERT INTO public.zion_admin_diagnostic_history (
                incident_id,
                event_kind,
                actor_kind,
                previous_status,
                new_status,
                description_simple
            )
            VALUES (
                v_incident.id,
                'operational_incident_reopened',
                'system',
                'resolved',
                'open',
                'Nova falha sem recuperacao comprovada.'
            );

        END IF;

        RETURN;
    END IF;

    SELECT max(r.processed_at)
    INTO v_recovered_at
    FROM public.zion_admin_diagnostic_operational_recovery_events r
    JOIN public.zion_admin_diagnostic_operational_failure_events f
      ON f.id = r.failure_event_id
    WHERE f.source_system = p_source_system
      AND f.source_record_id = p_source_record_id
      AND f.organization_id = p_organization_id
      AND f.store_id = p_store_id
      AND f.captured_at >= v_activation
      AND r.processed_at > f.captured_at;

    IF v_recovered_at IS NULL THEN
        RETURN;
    END IF;

    IF v_incident.status IS DISTINCT FROM 'resolved'
       OR v_incident.resolved_at IS DISTINCT FROM v_recovered_at
    THEN

        UPDATE public.zion_admin_diagnostic_incidents
        SET status = 'resolved',
            resolved_at = v_recovered_at,
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_incident.id;

        INSERT INTO public.zion_admin_diagnostic_history (
            incident_id,
            event_kind,
            actor_kind,
            previous_status,
            new_status,
            description_simple,
            sanitized_details
        )
        VALUES (
            v_incident.id,
            'operational_incident_resolved',
            'system',
            v_incident.status,
            'resolved',
            'Todas as falhas pertinentes possuem recuperacao comprovada.',
            pg_catalog.jsonb_build_object(
                'resolved_at', v_recovered_at,
                'failure_count', v_failure_count
            )
        );

    END IF;
END;
$function$;

ALTER FUNCTION
    public.reconcile_zion_admin_operational_incident_internal(
        text, uuid, uuid, uuid
    )
OWNER TO postgres;

REVOKE ALL ON FUNCTION
    public.reconcile_zion_admin_operational_incident_internal(
        text, uuid, uuid, uuid
    )
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION
public.project_zion_admin_operational_recovery_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    v_failure record;
BEGIN
    SELECT
        f.source_system,
        f.source_record_id,
        f.organization_id,
        f.store_id
    INTO STRICT v_failure
    FROM public.zion_admin_diagnostic_operational_failure_events f
    WHERE f.id = NEW.failure_event_id;

    PERFORM public.reconcile_zion_admin_operational_incident_internal(
        v_failure.source_system,
        v_failure.source_record_id,
        v_failure.organization_id,
        v_failure.store_id
    );

    RETURN NEW;
END;
$function$;

ALTER FUNCTION
    public.project_zion_admin_operational_recovery_internal()
OWNER TO postgres;

REVOKE ALL ON FUNCTION
    public.project_zion_admin_operational_recovery_internal()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zion_admin_project_operational_recovery
AFTER INSERT
ON public.zion_admin_diagnostic_operational_recovery_events
FOR EACH ROW
EXECUTE FUNCTION
    public.project_zion_admin_operational_recovery_internal();

CREATE OR REPLACE FUNCTION public.register_zion_admin_operational_failure_event_by_system(
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

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'zion-adm-operational-recovery:' ||
            v_event.source_system || ':' ||
            v_event.source_record_id::text,
            0
        )
    );

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

    PERFORM public.reconcile_zion_admin_operational_incident_internal(
        v_event.source_system,
        v_event.source_record_id,
        v_event.organization_id,
        v_event.store_id
    );

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

COMMIT;
