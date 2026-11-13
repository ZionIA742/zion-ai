-- ZION-ADM | Bloco 2 | 2.3-A.3
-- Primeira fonte: public.ai_runs.
-- Exclusiva do backend via service_role.
-- Nao armazena error bruto, conversas ou tokens.
-- Nao executa captura automatica.

BEGIN;

CREATE FUNCTION public.register_zion_admin_ai_run_error_by_system(
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
        )
    INTO
        v_organization_id,
        v_store_id,
        v_has_error,
        v_occurred_at
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
        'sales_ai',
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
        '{"ingestion_version":1,"raw_error_stored":false}'::jsonb,
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

-- Acesso direto permanece bloqueado.
-- Apenas esta funcao recebe EXECUTE para service_role.
REVOKE ALL ON FUNCTION
    public.register_zion_admin_ai_run_error_by_system(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.register_zion_admin_ai_run_error_by_system(uuid)
TO service_role;

COMMIT;
