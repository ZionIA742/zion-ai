BEGIN;

-- ZION-ADM D.11-A
-- Registra observacoes candidatas de vinculacao financeira Meta.
-- NAO comprova faturamento, isencao, custo zero ou fechamento.
-- NAO consulta a Meta ou executa cobrancas.

CREATE FUNCTION public.zion_admin_register_meta_binding_candidate_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_integration_id uuid,
    p_whatsapp_business_account_id text,
    p_event_type text,
    p_financial_account_type text,
    p_financial_account_id text,
    p_source_fingerprint_sha256 text,
    p_operation_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.zion_admin_meta_financial_binding_events%ROWTYPE;
    v_previous public.zion_admin_meta_financial_binding_events%ROWTYPE;
    v_new_id bigint;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_BINDING_UNAUTHORIZED';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_integration_id IS NULL
       OR p_whatsapp_business_account_id IS NULL
       OR p_whatsapp_business_account_id !~ '^[0-9]{5,25}$'
       OR p_event_type NOT IN ('bound', 'unbound')
       OR p_event_type IS NULL
       OR p_financial_account_type NOT IN
          ('messaging_account', 'business_portfolio')
       OR p_financial_account_type IS NULL
       OR p_financial_account_id IS NULL
       OR p_financial_account_id !~ '^[A-Za-z0-9:_-]{1,128}$'
       OR p_source_fingerprint_sha256 IS NULL
       OR p_source_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
       OR p_operation_key IS NULL
       OR length(p_operation_key) NOT BETWEEN 8 AND 200
       OR p_operation_key <> btrim(p_operation_key)
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_BINDING_INVALID_INPUT';
    END IF;

    -- Serializa eventos da mesma WABA dentro da organizacao.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_meta_binding_candidate'),
        pg_catalog.hashtext(
            p_organization_id::text || ':' ||
            p_whatsapp_business_account_id
        )
    );

    -- A identidade e a vinculacao devem existir no estado atual.
    PERFORM 1
    FROM public.external_integrations AS ei
    INNER JOIN public.stores AS s
      ON s.id = ei.store_id
     AND s.organization_id = ei.organization_id
    WHERE ei.id = p_integration_id
      AND ei.organization_id = p_organization_id
      AND ei.store_id = p_store_id
      AND ei.provider = 'whatsapp'
      AND ei.whatsapp_business_account_id =
          p_whatsapp_business_account_id
    FOR SHARE OF ei, s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ZION_ADMIN_META_BINDING_TENANCY_MISMATCH';
    END IF;

    -- A mesma chave somente pode representar o mesmo evento.
    SELECT *
      INTO v_existing
    FROM public.zion_admin_meta_financial_binding_events
    WHERE operation_key = p_operation_key;

    IF FOUND THEN
        IF v_existing.organization_id IS DISTINCT FROM p_organization_id
           OR v_existing.store_id IS DISTINCT FROM p_store_id
           OR v_existing.integration_id IS DISTINCT FROM p_integration_id
           OR v_existing.whatsapp_business_account_id
                IS DISTINCT FROM p_whatsapp_business_account_id
           OR v_existing.event_type IS DISTINCT FROM p_event_type
           OR v_existing.financial_account_type
                IS DISTINCT FROM p_financial_account_type
           OR v_existing.financial_account_id
                IS DISTINCT FROM p_financial_account_id
           OR v_existing.source_kind
                IS DISTINCT FROM 'integration_state_observation'
           OR v_existing.source_fingerprint_sha256
                IS DISTINCT FROM p_source_fingerprint_sha256
        THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_BINDING_OPERATION_REUSED';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'ok', true,
            'outcome', 'replayed',
            'event_id', v_existing.id,
            'authority_status', 'candidate_only'
        );
    END IF;

    -- Reconstrucao conservadora da ultima observacao.
    SELECT *
      INTO v_previous
    FROM public.zion_admin_meta_financial_binding_events
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND whatsapp_business_account_id =
          p_whatsapp_business_account_id
    ORDER BY id DESC
    LIMIT 1;

    IF p_event_type = 'bound' THEN
        IF v_previous.id IS NOT NULL
           AND v_previous.event_type = 'bound'
           AND (
               v_previous.financial_account_type
                   IS DISTINCT FROM p_financial_account_type
               OR v_previous.financial_account_id
                   IS DISTINCT FROM p_financial_account_id
           )
        THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_BINDING_REQUIRES_UNBOUND';
        END IF;
    ELSE
        IF v_previous.id IS NULL
           OR v_previous.event_type IS DISTINCT FROM 'bound'
           OR v_previous.financial_account_type
                IS DISTINCT FROM p_financial_account_type
           OR v_previous.financial_account_id
                IS DISTINCT FROM p_financial_account_id
        THEN
            RAISE EXCEPTION 'ZION_ADMIN_META_BINDING_INVALID_UNBOUND';
        END IF;
    END IF;

    INSERT INTO public.zion_admin_meta_financial_binding_events (
        organization_id,
        store_id,
        integration_id,
        whatsapp_business_account_id,
        event_type,
        financial_account_type,
        financial_account_id,
        source_kind,
        source_fingerprint_sha256,
        operation_key
    ) VALUES (
        p_organization_id,
        p_store_id,
        p_integration_id,
        p_whatsapp_business_account_id,
        p_event_type,
        p_financial_account_type,
        p_financial_account_id,
        'integration_state_observation',
        p_source_fingerprint_sha256,
        p_operation_key
    )
    RETURNING id INTO v_new_id;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'outcome', 'inserted',
        'event_id', v_new_id,
        'authority_status', 'candidate_only'
    );
END;
$function$;

REVOKE ALL ON FUNCTION
public.zion_admin_register_meta_binding_candidate_by_system(
    uuid,uuid,uuid,text,text,text,text,text,text
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.zion_admin_register_meta_binding_candidate_by_system(
    uuid,uuid,uuid,text,text,text,text,text,text
)
TO service_role;

COMMIT;