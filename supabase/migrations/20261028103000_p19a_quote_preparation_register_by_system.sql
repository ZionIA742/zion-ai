BEGIN;

CREATE FUNCTION public.register_quote_preparation_operation_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_lead_id uuid,
    p_conversation_id uuid,
    p_commercial_opportunity_id uuid,
    p_request_message_id uuid,
    p_profile_version_id uuid,
    p_profile_version_number integer,
    p_operation_key text,
    p_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public, auth
SET row_security = off
AS $function$
DECLARE
    v_opportunity public.commercial_opportunities%ROWTYPE;
    v_lead public.leads%ROWTYPE;
    v_conversation public.conversations%ROWTYPE;
    v_message public.messages%ROWTYPE;
    v_current public.commercial_opportunity_profile_current%ROWTYPE;
    v_profile public.commercial_opportunity_profile_versions%ROWTYPE;
    v_existing public.p19a_quote_preparation_operations%ROWTYPE;
    v_new_id uuid;
    v_active_id uuid;
BEGIN
    -- A funcao so aceita autoridade sistemica real.
    IF public.zion_resolve_request_role_internal()
        IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_SYSTEM_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_lead_id IS NULL
       OR p_conversation_id IS NULL
       OR p_commercial_opportunity_id IS NULL
       OR p_request_message_id IS NULL
       OR p_profile_version_id IS NULL
       OR p_profile_version_number IS NULL
       OR p_profile_version_number <= 0 THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_INVALID_IDENTITIES';
    END IF;

    IF p_operation_key IS NULL
       OR p_operation_key <> btrim(p_operation_key)
       OR length(p_operation_key) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_INVALID_OPERATION_KEY';
    END IF;

    IF p_request_fingerprint IS NULL
       OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_INVALID_FINGERPRINT';
    END IF;

    -- Serializa registros concorrentes da mesma oportunidade.
    SELECT *
    INTO v_opportunity
    FROM public.commercial_opportunities
    WHERE id = p_commercial_opportunity_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_OPPORTUNITY_NOT_FOUND';
    END IF;

    -- Replay deve recuperar a operacao original, sem criar outra.
    SELECT *
    INTO v_existing
    FROM public.p19a_quote_preparation_operations
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint
           OR v_existing.commercial_opportunity_id IS DISTINCT FROM p_commercial_opportunity_id
           OR v_existing.lead_id IS DISTINCT FROM p_lead_id
           OR v_existing.conversation_id IS DISTINCT FROM p_conversation_id
           OR v_existing.request_message_id IS DISTINCT FROM p_request_message_id
           OR v_existing.profile_version_id IS DISTINCT FROM p_profile_version_id
           OR v_existing.profile_version_number IS DISTINCT FROM p_profile_version_number THEN
            RAISE EXCEPTION 'P19A_QUOTE_PREP_IDEMPOTENCY_CONFLICT';
        END IF;

        RETURN jsonb_build_object(
            'outcome', 'idempotent_replay',
            'operation_id', v_existing.id,
            'organization_id', v_existing.organization_id,
            'store_id', v_existing.store_id,
            'status', v_existing.status,
            'profile_version_id', v_existing.profile_version_id,
            'request_message_id', v_existing.request_message_id
        );
    END IF;

    -- Confere o lead no escopo da loja.
    SELECT *
    INTO v_lead
    FROM public.leads
    WHERE id = p_lead_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_LEAD_NOT_FOUND';
    END IF;

    -- A conversa deve pertencer exatamente ao lead.
    SELECT *
    INTO v_conversation
    FROM public.conversations
    WHERE id = p_conversation_id
      AND organization_id = p_organization_id
      AND lead_id = p_lead_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_CONVERSATION_MISMATCH';
    END IF;

    -- A mensagem deve ser uma solicitacao recebida,
    -- ainda existente, na mesma conversa e loja.
    SELECT *
    INTO v_message
    FROM public.messages
    WHERE id = p_request_message_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND conversation_id = p_conversation_id
      AND lead_id = p_lead_id
      AND sender = 'user'
      AND direction = 'incoming'
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_REQUEST_MESSAGE_MISMATCH';
    END IF;

    -- Nesta primeira versao, nao inferir vinculos ausentes
    -- a partir de texto ou de outra oportunidade.
    IF v_opportunity.origin_lead_id IS DISTINCT FROM p_lead_id
       OR v_opportunity.primary_conversation_id IS DISTINCT FROM p_conversation_id THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_OPPORTUNITY_CONTEXT_MISMATCH';
    END IF;

    IF v_opportunity.stage IN ('perdido', 'concluido_sem_mais_acoes') THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_OPPORTUNITY_INACTIVE';
    END IF;

    -- A unica autoridade de versao corrente e a projecao P9.
    SELECT *
    INTO v_current
    FROM public.commercial_opportunity_profile_current
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id = p_commercial_opportunity_id
    FOR SHARE;

    IF NOT FOUND
       OR v_current.current_profile_version_id IS DISTINCT FROM p_profile_version_id THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_PROFILE_NOT_CURRENT';
    END IF;

    SELECT *
    INTO v_profile
    FROM public.commercial_opportunity_profile_versions
    WHERE id = p_profile_version_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id = p_commercial_opportunity_id
      AND version_number = p_profile_version_number
      AND profile_state = 'resolved';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_PROFILE_NOT_RESOLVED';
    END IF;

    -- Nao registrar um perfil vazio ou com componentes pendentes.
    IF NOT EXISTS (
        SELECT 1
        FROM public.commercial_opportunity_profile_components c
        WHERE c.profile_version_id = p_profile_version_id
          AND c.organization_id = p_organization_id
          AND c.store_id = p_store_id
          AND c.commercial_opportunity_id = p_commercial_opportunity_id
    ) OR EXISTS (
        SELECT 1
        FROM public.commercial_opportunity_profile_components c
        WHERE c.profile_version_id = p_profile_version_id
          AND c.organization_id = p_organization_id
          AND c.store_id = p_store_id
          AND c.commercial_opportunity_id = p_commercial_opportunity_id
          AND c.component_state <> 'resolved'
    ) THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_COMPONENTS_NOT_READY';
    END IF;

    -- Uma mensagem original nao pode gerar duas operacoes.
    IF EXISTS (
        SELECT 1
        FROM public.p19a_quote_preparation_operations o
        WHERE o.organization_id = p_organization_id
          AND o.store_id = p_store_id
          AND o.request_message_id = p_request_message_id
    ) THEN
        RAISE EXCEPTION 'P19A_QUOTE_PREP_REQUEST_ALREADY_REGISTERED';
    END IF;

    -- Outra preparacao ativa impede criacao concorrente.
    SELECT id
    INTO v_active_id
    FROM public.p19a_quote_preparation_operations
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id = p_commercial_opportunity_id
      AND status IN ('queued', 'processing', 'uncertain')
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'outcome', 'blocked',
            'reason', 'active_preparation_exists',
            'operation_id', NULL,
            'status', 'blocked'
        );
    END IF;

    INSERT INTO public.p19a_quote_preparation_operations (
        organization_id,
        store_id,
        lead_id,
        conversation_id,
        commercial_opportunity_id,
        request_message_id,
        profile_version_id,
        profile_version_number,
        operation_key,
        request_fingerprint,
        status
    )
    VALUES (
        p_organization_id,
        p_store_id,
        p_lead_id,
        p_conversation_id,
        p_commercial_opportunity_id,
        p_request_message_id,
        p_profile_version_id,
        p_profile_version_number,
        p_operation_key,
        p_request_fingerprint,
        'queued'
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'outcome', 'created',
        'operation_id', v_new_id,
        'organization_id', p_organization_id,
        'store_id', p_store_id,
        'status', 'queued',
        'profile_version_id', p_profile_version_id,
        'request_message_id', p_request_message_id
    );
END;
$function$;

ALTER FUNCTION public.register_quote_preparation_operation_by_system(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.register_quote_preparation_operation_by_system(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.register_quote_preparation_operation_by_system(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text
) TO service_role;

COMMIT;
