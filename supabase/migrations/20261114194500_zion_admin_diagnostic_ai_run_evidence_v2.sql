-- ZION-ADM | Bloco 2 | 2.3-C.13-C
-- Evidencias de execucao com allowlist.
-- Sem backfill, cron, trigger ou coleta automatica.
-- Chaves historicas e idempotencia preservadas.
-- Origem desconhecida nao equivale a IA Vendedora.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_zion_admin_ai_run_error_by_system(
    p_ai_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_organization_id uuid;
    v_store_id uuid;
    v_has_error boolean;
    v_occurred_at timestamptz;
    v_provider text;
    v_model text;
    v_run_status text;
    v_latency_ms numeric;
    v_input_type text;
    v_component text;

    v_incident_key text;
    v_occurrence_key text;

    v_incident_id uuid;
    v_occurrence_id uuid;

    v_existing_org uuid;
    v_existing_store uuid;

    v_new_incident boolean := false;
    v_new_occurrence boolean := false;
BEGIN
    -- Nunca confiar somente na permissao EXECUTE.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_ai_run_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SOURCE_ID_REQUIRED';
    END IF;

    -- A origem e o escopo sao resolvidos no banco.
    -- O chamador nao informa organization_id nem store_id.
    -- O texto original de error NAO e retornado nem armazenado.
    SELECT
        r.organization_id,
        r.store_id,
        NULLIF(btrim(r.error), '') IS NOT NULL,
        COALESCE(
            r.finished_at,
            r.started_at,
            r.created_at,
            now()
        ),
        r.provider,
        r.model,
        r.status,
        r.latency_ms,
        CASE
            WHEN jsonb_typeof(to_jsonb(r.input)) = 'object'
             AND jsonb_typeof(to_jsonb(r.input) -> 'type') = 'string'
            THEN to_jsonb(r.input) ->> 'type'
            ELSE NULL
        END
    INTO
        v_organization_id,
        v_store_id,
        v_has_error,
        v_occurred_at,
        v_provider,
        v_model,
        v_run_status,
        v_latency_ms,
        v_input_type
    FROM public.ai_runs r
    WHERE r.id = p_ai_run_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SOURCE_NOT_FOUND';
    END IF;

    IF NOT COALESCE(v_has_error, false) THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SOURCE_HAS_NO_ERROR';
    END IF;

    IF v_organization_id IS NULL
       OR v_store_id IS NULL THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SOURCE_SCOPE_MISSING';
    END IF;

    -- Validacao canonica, inclusive para fontes
    -- que futuramente nao tenham FKs compostas.
    PERFORM 1
    FROM public.stores s
    WHERE s.id = v_store_id
      AND s.organization_id = v_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SOURCE_SCOPE_INVALID';
    END IF;

    -- Apenas o marcador explicito comprova a Assistente.
    -- Ausencia de marcador nao comprova IA Vendedora.
    v_component := CASE
        WHEN v_input_type = 'assistant_chat'
        THEN 'assistant_ai'
        ELSE 'ai_origin_unknown'
    END;

    -- V1: um incidente por execucao de IA.
    -- Repeticoes da mesma execucao sao idempotentes.
    -- Agrupamento entre execucoes fica para a
    -- classificacao segura de erros.
    v_incident_key :=
        'zion-b2:ai-run:' || p_ai_run_id::text;

    v_occurrence_key :=
        'zion-b2:ai-run-error:' || p_ai_run_id::text;

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
        v_organization_id,
        v_store_id,
        v_component,
        'ai_run_error',
        'error',
        'open',
        'unknown',
        'Erro registrado em uma execucao da IA',
        'Uma execucao da inteligencia artificial registrou um erro.',
        'O atendimento pode ter sido afetado. O impacto ainda precisa ser verificado.',
        'Verificar a execucao e o atendimento associado no painel.',
        v_occurred_at,
        v_occurred_at
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
                'ZION_DIAGNOSTIC_INCIDENT_LOOKUP_FAILED';
        END IF;

        IF v_existing_org IS DISTINCT FROM v_organization_id
           OR v_existing_store IS DISTINCT FROM v_store_id THEN
            RAISE EXCEPTION
                'ZION_DIAGNOSTIC_SCOPE_CONFLICT';
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
        'ai_runs',
        p_ai_run_id::text,
        'AI_RUN_ERROR_RECORDED',
        jsonb_build_object(
            'ingestion_version', 2,
            'raw_error_stored', false,
            'schema_version', 1,
            'origin', CASE
                WHEN v_component = 'assistant_ai'
                THEN 'assistant_ai'
                ELSE 'unknown'
            END,
            'execution_type', CASE
                WHEN v_input_type = 'assistant_chat'
                THEN 'assistant_chat'
                ELSE NULL
            END,
            'provider', CASE
                WHEN v_provider = 'openai'
                THEN 'openai'
                ELSE NULL
            END,
            'model', CASE
                WHEN v_provider = 'openai'
                 AND v_model IN ('gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2', 'gpt-5.3', 'gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-6')
                THEN v_model
                ELSE NULL
            END,
            'status', CASE
                WHEN v_run_status IN ('queued', 'running', 'completed', 'failed', 'error', 'success', 'cancelled')
                THEN v_run_status
                ELSE NULL
            END,
            'latency_ms', CASE
                WHEN v_latency_ms IS NOT NULL
                 AND v_latency_ms >= 0
                 AND v_latency_ms <= 86400000
                 AND trunc(v_latency_ms) = v_latency_ms
                THEN v_latency_ms::bigint
                ELSE NULL
            END
        ),
        v_occurred_at
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
                'ZION_DIAGNOSTIC_OCCURRENCE_CONFLICT';
        END IF;
    ELSE
        UPDATE public.zion_admin_diagnostic_incidents
        SET
            first_seen_at = LEAST(
                first_seen_at, v_occurred_at
            ),
            last_seen_at = GREATEST(
                last_seen_at, v_occurred_at
            ),
            updated_at = now()
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
            'Incidente criado a partir de erro registrado em execucao de IA.'
        );
    END IF;

    RETURN jsonb_build_object(
        'incident_id', v_incident_id,
        'occurrence_id', v_occurrence_id,
        'new_incident', v_new_incident,
        'new_occurrence', v_new_occurrence,
        'source_system', 'ai_runs'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_zion_admin_ai_run_diagnostics_by_system(
    p_limit integer DEFAULT 30,
    p_offset integer DEFAULT 0,
    p_store_id uuid DEFAULT NULL
)
RETURNS TABLE (
    incident_id uuid,
    occurrence_id uuid,
    organization_id uuid,
    store_id uuid,
    incident_status text,
    severity text,
    cause_confidence text,
    title_simple text,
    explanation_simple text,
    impact_simple text,
    next_action_simple text,
    first_seen_at timestamptz,
    last_seen_at timestamptz,
    occurred_at timestamptz,
    captured_at timestamptz,
    technical_error_code text,
    source_record_id text,
    occurrence_count bigint,
    last_failure_older_than_30_days boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_limit IS NULL
       OR p_limit < 1
       OR p_limit > 50 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_INVALID_PAGE_LIMIT'
            USING ERRCODE = '22023';
    END IF;

    IF p_offset IS NULL
       OR p_offset < 0
       OR p_offset > 5000 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_INVALID_PAGE_OFFSET'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH pagina AS MATERIALIZED (
        SELECT i.*
        FROM public.zion_admin_diagnostic_incidents i
        WHERE i.scope = 'store'
           AND EXISTS (
               SELECT 1
               FROM public.zion_admin_diagnostic_occurrences source_o
               WHERE source_o.incident_id = i.id
                 AND source_o.source_system = 'ai_runs'
           )
          AND i.category = 'ai_run_error'
          AND (
              p_store_id IS NULL
              OR i.store_id = p_store_id
          )
        ORDER BY
            i.last_seen_at DESC,
            i.id DESC
        LIMIT p_limit
        OFFSET p_offset
    )
    SELECT
        i.id,
        o.id,
        i.organization_id,
        i.store_id,
        i.status,
        i.severity,
        i.cause_confidence,

        i.title_simple,
        i.explanation_simple,
        i.impact_simple,
        i.next_action_simple,

        i.first_seen_at,
        i.last_seen_at,
        o.occurred_at,
        o.captured_at,

        CASE
            WHEN o.source_system = 'ai_runs'
             AND o.error_code = 'AI_RUN_ERROR_RECORDED'
            THEN 'AI_RUN_ERROR_RECORDED'
            ELSE 'DIAGNOSTIC_CODE_UNAVAILABLE'
        END,

        CASE
            WHEN o.source_system = 'ai_runs'
             AND o.source_record_id ~*
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN o.source_record_id
            ELSE NULL::text
        END,

        totals.occurrence_count,

        (
            i.last_seen_at <
                now() - interval '30 days'
        )

    FROM pagina i

    LEFT JOIN LATERAL (
        SELECT
            x.id,
            x.source_system,
            x.source_record_id,
            x.error_code,
            x.occurred_at,
            x.captured_at
        FROM public.zion_admin_diagnostic_occurrences x
        WHERE x.incident_id = i.id
          AND x.source_system = 'ai_runs'
        ORDER BY
            x.occurred_at DESC,
            x.id DESC
        LIMIT 1
    ) o ON true

    CROSS JOIN LATERAL (
        SELECT COUNT(*) AS occurrence_count
        FROM public.zion_admin_diagnostic_occurrences x
        WHERE x.incident_id = i.id
          AND x.source_system = 'ai_runs'
    ) totals

    ORDER BY
        i.last_seen_at DESC,
        i.id DESC;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.register_zion_admin_ai_run_error_by_system(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.register_zion_admin_ai_run_error_by_system(uuid)
TO service_role;

REVOKE ALL ON FUNCTION
    public.list_zion_admin_ai_run_diagnostics_by_system(
        integer, integer, uuid
    )
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.list_zion_admin_ai_run_diagnostics_by_system(
        integer, integer, uuid
    )
TO service_role;

COMMIT;
