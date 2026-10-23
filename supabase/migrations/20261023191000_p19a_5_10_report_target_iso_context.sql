-- ZION | Pilar 19-A | Etapa 5.10
-- Preserva target_iso no contexto da notificacao de relatorio automatico.
-- Nao modifica claims ja concluidos nem filas ja materializadas.
BEGIN;

CREATE OR REPLACE FUNCTION public.assistant_materialize_automatic_report(p_organization_id uuid, p_store_id uuid, p_local_date date, p_report_type text, p_claim_token uuid, p_content text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_run public.store_assistant_automatic_report_claims%ROWTYPE;
    v_message public.store_assistant_messages%ROWTYPE;
    v_notification_id uuid;
    v_message_type text;
    v_event_key text;
    v_metadata jsonb;
    v_context jsonb;
    v_target_iso text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'REPORT_SERVICE_ROLE_REQUIRED';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_local_date IS NULL
       OR p_claim_token IS NULL
       OR p_report_type IS NULL
       OR p_report_type NOT IN ('morning_report', 'evening_report')
       OR NULLIF(btrim(COALESCE(p_content, '')), '') IS NULL
       OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object'
    THEN
        RAISE EXCEPTION 'INVALID_REPORT_MATERIALIZATION';
    END IF;

    SELECT *
    INTO v_run
    FROM public.store_assistant_automatic_report_claims r
    WHERE r.organization_id = p_organization_id
      AND r.store_id = p_store_id
      AND r.local_date = p_local_date
      AND r.report_type = p_report_type
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REPORT_CLAIM_NOT_FOUND';
    END IF;

    IF v_run.status = 'completed' THEN
        RETURN jsonb_build_object(
            'result', 'completed',
            'claim_id', v_run.id,
            'message_id', v_run.message_id,
            'notification_id', v_run.notification_id
        );
    END IF;

    IF v_run.status <> 'processing'
       OR v_run.claim_token IS DISTINCT FROM p_claim_token
       OR v_run.lease_expires_at IS NULL
       OR v_run.lease_expires_at <= clock_timestamp()
    THEN
        RAISE EXCEPTION 'REPORT_CLAIM_INVALID_OR_EXPIRED';
    END IF;

    -- O horario-alvo deve ser explicito para a entrega externa do relatorio.
    -- Preservar o ISO original e impedir notificacoes sem timestamp valido.
    v_target_iso := NULLIF(btrim(p_metadata->>'target_iso'), '');

    IF jsonb_typeof(p_metadata->'target_iso') IS DISTINCT FROM 'string'
       OR v_target_iso IS NULL
       OR v_target_iso !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
    THEN
        RAISE EXCEPTION 'INVALID_REPORT_TARGET_ISO';
    END IF;

    -- Rejeita datas impossiveis mantendo o timestamp em formato UTC canonico.
    PERFORM v_target_iso::timestamptz;

    v_message_type := CASE p_report_type
        WHEN 'morning_report' THEN 'report_morning'
        ELSE 'report_evening'
    END;

    v_event_key := concat(
        'assistant-automatic-report:',
        p_organization_id::text, ':',
        p_store_id::text, ':',
        p_local_date::text, ':',
        p_report_type
    );

    v_metadata :=
        COALESCE(p_metadata, '{}'::jsonb) ||
        jsonb_build_object(
            'source', 'assistant_automatic_reports',
            'local_date', p_local_date::text,
            'report_type', p_report_type,
            'event_key', v_event_key
        );

    SELECT *
    INTO v_message
    FROM public.assistant_push_system_message(
        p_organization_id,
        p_store_id,
        btrim(p_content),
        v_message_type,
        NULL::uuid,
        NULL::uuid,
        NULL::uuid,
        v_metadata
    );

    IF v_message.id IS NULL THEN
        RAISE EXCEPTION 'REPORT_MESSAGE_NOT_CREATED';
    END IF;

    v_context := jsonb_build_object(
        'report_source', 'assistant_automatic_reports',
        'event_key', v_event_key,
        'local_date', p_local_date::text,
        'report_type', p_report_type,
        'target_iso', v_target_iso,
        'assistant_message_id', v_message.id
    );

    SELECT public.assistant_enqueue_internal_notification(
        p_organization_id,
        p_store_id,
        p_report_type,
        CASE p_report_type
            WHEN 'morning_report' THEN 'Relatório da manhã'
            ELSE 'Relatório da noite'
        END,
        btrim(p_content),
        'normal',
        v_context,
        NULL::uuid,
        NULL::uuid,
        NULL::uuid,
        v_event_key
    )
    INTO v_notification_id;

    IF v_notification_id IS NULL THEN
        RAISE EXCEPTION 'REPORT_NOTIFICATION_NOT_CREATED';
    END IF;

    UPDATE public.store_assistant_automatic_report_claims
    SET status = 'completed',
        message_id = v_message.id,
        notification_id = v_notification_id,
        lease_expires_at = NULL,
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_run.id
      AND claim_token = p_claim_token
      AND status = 'processing';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REPORT_FINALIZATION_FENCE_FAILED';
    END IF;

    RETURN jsonb_build_object(
        'result', 'completed',
        'claim_id', v_run.id,
        'message_id', v_message.id,
        'notification_id', v_notification_id
    );
END;
$function$;

COMMIT;
