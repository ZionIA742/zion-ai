-- ZION / PILAR 19-A / BLOCO 6 / ETAPA 5.1-C
-- Writer transacional do orcamento sistemico em draft.
-- Nao gera PDF, versao, aprovacao ou envio.
-- Requer as migrations P19-A 5.1-A e 5.1-B.1.

BEGIN;

CREATE FUNCTION public.create_sales_quote_draft_from_current_profile_by_system(
    p_operation_id uuid,
    p_organization_id uuid,
    p_store_id uuid,
    p_commercial_opportunity_id uuid,
    p_profile_version_id uuid,
    p_profile_version_number integer,
    p_creation_idempotency_key text,
    p_creation_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public, auth
SET row_security = off
AS $function$
DECLARE
    v_operation public.p19a_quote_preparation_operations%ROWTYPE;
    v_opportunity public.commercial_opportunities%ROWTYPE;
    v_current public.commercial_opportunity_profile_current%ROWTYPE;
    v_profile public.commercial_opportunity_profile_versions%ROWTYPE;
    v_quote public.sales_quotes%ROWTYPE;

    v_quote_id uuid;
    v_quote_number text;
    v_reserved_number integer;
    v_prefix text;
    v_ai_allowed boolean;
    v_metadata jsonb;

    v_materialization_rows jsonb;
    v_materialization jsonb;
    v_item_count integer;
    v_persisted_count integer;
    v_updated_operation_id uuid;
BEGIN
    -- Autoridade sistemica obrigatoria.
    IF public.zion_resolve_request_role_internal()
        IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_SYSTEM_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_operation_id IS NULL
       OR p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_commercial_opportunity_id IS NULL
       OR p_profile_version_id IS NULL
       OR p_profile_version_number IS NULL
       OR p_profile_version_number <= 0 THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_INVALID_IDENTITIES';
    END IF;

    IF p_creation_idempotency_key IS NULL
       OR p_creation_idempotency_key
          <> pg_catalog.btrim(p_creation_idempotency_key)
       OR pg_catalog.length(p_creation_idempotency_key)
          NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_INVALID_OPERATION_KEY';
    END IF;

    IF p_creation_request_fingerprint IS NULL
       OR p_creation_request_fingerprint
          !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_INVALID_FINGERPRINT';
    END IF;

    -- Mesma ordem de lock utilizada no registro P19-A:
    -- oportunidade antes da operacao.
    SELECT *
    INTO v_opportunity
    FROM public.commercial_opportunities
    WHERE id = p_commercial_opportunity_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_OPPORTUNITY_NOT_FOUND';
    END IF;

    SELECT *
    INTO v_operation
    FROM public.p19a_quote_preparation_operations
    WHERE id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_OPERATION_NOT_FOUND';
    END IF;

    IF v_operation.organization_id
          IS DISTINCT FROM p_organization_id
       OR v_operation.store_id
          IS DISTINCT FROM p_store_id
       OR v_operation.commercial_opportunity_id
          IS DISTINCT FROM p_commercial_opportunity_id
       OR v_operation.profile_version_id
          IS DISTINCT FROM p_profile_version_id
       OR v_operation.profile_version_number
          IS DISTINCT FROM p_profile_version_number
       OR v_operation.operation_key
          IS DISTINCT FROM p_creation_idempotency_key
       OR v_operation.request_fingerprint
          IS DISTINCT FROM p_creation_request_fingerprint THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_OPERATION_IDENTITY_CONFLICT';
    END IF;

    -- Replay de uma criacao previamente confirmada.
    -- Nao reservar outro numero nem alterar o orcamento.
    IF v_operation.status IN ('completed', 'uncertain')
       AND v_operation.quote_id IS NOT NULL THEN

        SELECT *
        INTO v_quote
        FROM public.sales_quotes
        WHERE id = v_operation.quote_id
          AND organization_id = p_organization_id
          AND store_id = p_store_id
          AND commercial_opportunity_id =
              p_commercial_opportunity_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'P19A_QUOTE_DRAFT_REPLAY_QUOTE_NOT_FOUND';
        END IF;

        IF v_quote.creation_idempotency_key
              IS DISTINCT FROM v_operation.operation_key
           OR v_quote.creation_request_fingerprint
              IS DISTINCT FROM v_operation.request_fingerprint
           OR v_quote.created_by IS DISTINCT FROM 'system'
           OR v_quote.lead_id IS DISTINCT FROM v_operation.lead_id
           OR v_quote.conversation_id
              IS DISTINCT FROM v_operation.conversation_id
           OR v_quote.metadata ->> 'created_via'
              IS DISTINCT FROM 'p19a_quote_preparation'
           OR v_quote.metadata ->> 'operation_id'
              IS DISTINCT FROM v_operation.id::text
           OR v_quote.metadata ->> 'profile_version_id'
              IS DISTINCT FROM v_operation.profile_version_id::text
           OR v_quote.metadata ->> 'profile_version_number'
              IS DISTINCT FROM v_operation.profile_version_number::text
        THEN
            RAISE EXCEPTION
                'P19A_QUOTE_DRAFT_REPLAY_IDENTITY_CONFLICT';
        END IF;

        SELECT pg_catalog.count(*)::integer
        INTO v_item_count
        FROM public.sales_quote_items
        WHERE quote_id = v_quote.id
          AND organization_id = p_organization_id
          AND store_id = p_store_id;

        IF v_item_count <= 0 OR EXISTS (
            SELECT 1
            FROM public.sales_quote_items i
            WHERE i.quote_id = v_quote.id
              AND (
                  i.profile_component_id IS NULL
                  OR NOT EXISTS (
                      SELECT 1
                      FROM public.commercial_opportunity_profile_components c
                      WHERE c.id = i.profile_component_id
                        AND c.profile_version_id =
                            v_operation.profile_version_id
                        AND c.organization_id = p_organization_id
                        AND c.store_id = p_store_id
                        AND c.commercial_opportunity_id =
                            p_commercial_opportunity_id
                  )
              )
        ) THEN
            RAISE EXCEPTION
                'P19A_QUOTE_DRAFT_REPLAY_ITEMS_INVALID';
        END IF;

        -- Validar todo o conjunto canonico do perfil,
        -- inclusive componentes ausentes e duplicados.
        IF NOT EXISTS (
            SELECT 1
            FROM public.commercial_opportunity_profile_components c
            WHERE c.profile_version_id =
                v_operation.profile_version_id
              AND c.organization_id = p_organization_id
              AND c.store_id = p_store_id
              AND c.commercial_opportunity_id =
                  p_commercial_opportunity_id
              AND c.component_state = 'resolved'
        )
        OR EXISTS (
            SELECT 1
            FROM public.commercial_opportunity_profile_components c
            WHERE c.profile_version_id =
                v_operation.profile_version_id
              AND c.organization_id = p_organization_id
              AND c.store_id = p_store_id
              AND c.commercial_opportunity_id =
                  p_commercial_opportunity_id
              AND (
                  c.component_state IS DISTINCT FROM 'resolved'
                  OR (
                      SELECT count(*)
                      FROM public.sales_quote_items i
                      WHERE i.quote_id = v_quote.id
                        AND i.organization_id = p_organization_id
                        AND i.store_id = p_store_id
                        AND i.commercial_opportunity_id =
                            p_commercial_opportunity_id
                        AND i.profile_component_id = c.id
                  ) <> 1
              )
        )
        OR EXISTS (
            SELECT 1
            FROM public.sales_quote_items i
            WHERE i.quote_id = v_quote.id
              AND (
                  i.organization_id
                      IS DISTINCT FROM p_organization_id
                  OR i.store_id
                      IS DISTINCT FROM p_store_id
                  OR i.commercial_opportunity_id
                      IS DISTINCT FROM p_commercial_opportunity_id
                  OR i.profile_component_id IS NULL
              )
        ) THEN
            RAISE EXCEPTION
                'P19A_QUOTE_DRAFT_REPLAY_ITEM_SET_MISMATCH';
        END IF;

        -- Um resultado incerto so e concluido quando
        -- o orcamento persistido foi validado integralmente.
        IF v_operation.status = 'uncertain' THEN
            UPDATE public.p19a_quote_preparation_operations
            SET status = 'completed',
                completed_at = COALESCE(
                    completed_at,
                    pg_catalog.clock_timestamp()
                ),
                updated_at = pg_catalog.clock_timestamp(),
                claim_token = NULL,
                lease_expires_at = NULL,
                locked_at = NULL,
                locked_by = NULL,
                last_error_code = NULL,
                last_error_message = NULL
            WHERE id = v_operation.id
              AND organization_id = p_organization_id
              AND store_id = p_store_id
              AND quote_id = v_quote.id
              AND status = 'uncertain'
            RETURNING id INTO v_updated_operation_id;

            IF v_updated_operation_id
                IS DISTINCT FROM v_operation.id THEN
                RAISE EXCEPTION
                    'P19A_QUOTE_DRAFT_UNCERTAIN_RECOVERY_FAILED';
            END IF;
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'idempotent_replay',
            'operation_id', v_operation.id,
            'quote_id', v_quote.id,
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'commercial_opportunity_id',
                p_commercial_opportunity_id,
            'profile_version_id', v_operation.profile_version_id,
            'profile_version_number',
                v_operation.profile_version_number,
            'quote_status', v_quote.status,
            'item_count', v_item_count
        );
    END IF;

    IF v_operation.quote_id IS NOT NULL
       OR v_operation.status NOT IN ('queued', 'processing') THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_OPERATION_STATE_CONFLICT';
    END IF;

    -- Confirmar que a oportunidade continua vinculada
    -- ao contexto original da operacao.
    IF v_opportunity.origin_lead_id
          IS DISTINCT FROM v_operation.lead_id
       OR v_opportunity.primary_conversation_id
          IS DISTINCT FROM v_operation.conversation_id
       OR v_opportunity.stage IN (
           'perdido',
           'concluido_sem_mais_acoes'
       ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_OPPORTUNITY_CONTEXT_INVALID';
    END IF;

    -- Manter a projecao corrente bloqueada durante
    -- a chamada ao materializador.
    SELECT *
    INTO v_current
    FROM public.commercial_opportunity_profile_current
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id =
          p_commercial_opportunity_id
    FOR SHARE;

    IF NOT FOUND
       OR v_current.current_profile_version_id
          IS DISTINCT FROM v_operation.profile_version_id THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_PROFILE_NOT_CURRENT';
    END IF;

    SELECT *
    INTO v_profile
    FROM public.commercial_opportunity_profile_versions
    WHERE id = v_operation.profile_version_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id =
          p_commercial_opportunity_id
      AND version_number = v_operation.profile_version_number
      AND profile_state = 'resolved'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_PROFILE_NOT_RESOLVED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.commercial_opportunity_profile_components c
        WHERE c.profile_version_id = v_operation.profile_version_id
          AND c.organization_id = p_organization_id
          AND c.store_id = p_store_id
          AND c.commercial_opportunity_id =
              p_commercial_opportunity_id
    ) OR EXISTS (
        SELECT 1
        FROM public.commercial_opportunity_profile_components c
        WHERE c.profile_version_id = v_operation.profile_version_id
          AND c.organization_id = p_organization_id
          AND c.store_id = p_store_id
          AND c.commercial_opportunity_id =
              p_commercial_opportunity_id
          AND c.component_state <> 'resolved'
    ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_COMPONENTS_NOT_READY';
    END IF;

    -- Nao assumir orcamentos criados por outro fluxo
    -- ou por outra operacao.
    IF EXISTS (
        SELECT 1
        FROM public.sales_quotes q
        WHERE q.organization_id = p_organization_id
          AND q.store_id = p_store_id
          AND q.commercial_opportunity_id =
              p_commercial_opportunity_id
    ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_EXISTING_OPPORTUNITY_QUOTE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sales_quotes q
        WHERE q.organization_id = p_organization_id
          AND q.store_id = p_store_id
          AND q.creation_idempotency_key =
              v_operation.operation_key
    ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_EXISTING_OPERATION_KEY';
    END IF;

    -- A reserva ocorre na mesma transacao do INSERT
    -- e da materializacao. Erros revertem o contador.
    SELECT
        r.quote_number,
        r.reserved_number,
        r.quote_number_prefix
    INTO STRICT
        v_quote_number,
        v_reserved_number,
        v_prefix
    FROM public.reserve_next_sales_quote_number_by_system(
        p_organization_id,
        p_store_id
    ) r;

    -- Respeitar a configuracao que permite a IA gerar
    -- o rascunho. Isso nao concede autoridade de envio.
    SELECT qs.ai_can_generate_quote
    INTO v_ai_allowed
    FROM public.store_quote_settings qs
    WHERE qs.organization_id = p_organization_id
      AND qs.store_id = p_store_id;

    IF v_ai_allowed IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AI_GENERATION_DISABLED';
    END IF;

    IF v_quote_number IS NULL
       OR v_reserved_number IS NULL
       OR v_reserved_number < 1
       OR v_prefix IS NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_NUMBER_INVALID';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sales_quotes q
        WHERE q.organization_id = p_organization_id
          AND q.store_id = p_store_id
          AND q.quote_number = v_quote_number
    ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_NUMBER_ALREADY_USED';
    END IF;

    v_quote_id := pg_catalog.gen_random_uuid();

    v_metadata := pg_catalog.jsonb_build_object(
        'created_via', 'p19a_quote_preparation',
        'operation_id', v_operation.id,
        'profile_version_id', v_operation.profile_version_id,
        'profile_version_number',
            v_operation.profile_version_number,
        'operation_key', v_operation.operation_key,
        'reserved_number', v_reserved_number,
        'quote_number_prefix', v_prefix
    );

    INSERT INTO public.sales_quotes (
        id,
        organization_id,
        store_id,
        commercial_opportunity_id,
        conversation_id,
        lead_id,
        quote_number,
        status,
        created_by,
        requires_human_approval,
        current_version_id,
        subtotal_cents,
        discount_cents,
        total_cents,
        metadata,
        creation_idempotency_key,
        creation_request_fingerprint
    )
    VALUES (
        v_quote_id,
        p_organization_id,
        p_store_id,
        p_commercial_opportunity_id,
        v_operation.conversation_id,
        v_operation.lead_id,
        v_quote_number,
        'draft',
        'system',
        TRUE,
        NULL,
        0,
        0,
        0,
        v_metadata,
        v_operation.operation_key,
        v_operation.request_fingerprint
    );

    -- Funcao canônica P9: itens e totais.
    -- A chamada participa da mesma transacao SQL.
    SELECT COALESCE(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m)),
        '[]'::jsonb
    )
    INTO v_materialization_rows
    FROM public.materialize_sales_quote_items_from_current_profile_by_system(
        p_organization_id,
        p_store_id,
        v_quote_id
    ) m;

    IF pg_catalog.jsonb_array_length(v_materialization_rows) <> 1 THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_MATERIALIZER_RESULT_INVALID';
    END IF;

    v_materialization := v_materialization_rows -> 0;

    IF v_materialization ->> 'quote_id'
          IS DISTINCT FROM v_quote_id::text
       OR v_materialization ->> 'profile_version_id'
          IS DISTINCT FROM v_operation.profile_version_id::text
       OR v_materialization ->> 'outcome'
          IS DISTINCT FROM 'materialized' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_MATERIALIZER_IDENTITY_CONFLICT';
    END IF;

    v_item_count :=
        (v_materialization ->> 'item_count')::integer;

    IF v_item_count IS NULL OR v_item_count <= 0 THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_MATERIALIZER_ITEMS_INVALID';
    END IF;

    SELECT pg_catalog.count(*)::integer
    INTO v_persisted_count
    FROM public.sales_quote_items
    WHERE quote_id = v_quote_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id;

    IF v_persisted_count IS DISTINCT FROM v_item_count THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_ITEM_COUNT_MISMATCH';
    END IF;

    -- O vinculo e a conclusao somente ocorrem depois
    -- do materializador confirmar itens e totais.
    UPDATE public.p19a_quote_preparation_operations
    SET quote_id = v_quote_id,
        status = 'completed',
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp(),
        claim_token = NULL,
        lease_expires_at = NULL,
        locked_at = NULL,
        locked_by = NULL,
        last_error_code = NULL,
        last_error_message = NULL
    WHERE id = v_operation.id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND quote_id IS NULL
      AND status IN ('queued', 'processing')
    RETURNING id INTO v_updated_operation_id;

    IF v_updated_operation_id IS DISTINCT FROM v_operation.id THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_OPERATION_FINALIZATION_FAILED';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'created',
        'operation_id', v_operation.id,
        'quote_id', v_quote_id,
        'organization_id', p_organization_id,
        'store_id', p_store_id,
        'commercial_opportunity_id', p_commercial_opportunity_id,
        'profile_version_id', v_operation.profile_version_id,
        'profile_version_number', v_operation.profile_version_number,
        'quote_status', 'draft',
        'quote_number', v_quote_number,
        'item_count', v_item_count
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.create_sales_quote_draft_from_current_profile_by_system(
        uuid, uuid, uuid, uuid, uuid, integer, text, text
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.create_sales_quote_draft_from_current_profile_by_system(
        uuid, uuid, uuid, uuid, uuid, integer, text, text
    )
TO service_role;

COMMENT ON FUNCTION
    public.create_sales_quote_draft_from_current_profile_by_system(
        uuid, uuid, uuid, uuid, uuid, integer, text, text
    )
IS
    'Cria um orcamento draft a partir da operacao P19-A '
    'e materializa seus itens pelo Pilar 9 na mesma transacao. '
    'Nao gera PDF, aprova ou envia o orcamento.';

COMMIT;
