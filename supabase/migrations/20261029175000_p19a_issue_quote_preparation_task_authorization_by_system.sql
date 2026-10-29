-- ZION / PILAR 19-A / BLOCO 6 / ETAPA 5.2-E.1-A.3
-- Emissao sistêmica de autorizacao individual para preparar rascunho.
-- Nao enfileira, nao cria orcamento e nao autoriza envio.
-- Diferenca pontual do rascunho Codex: estado NULL dos componentes e bloqueado.

BEGIN;

DO $preflight$
DECLARE
    v_required text;
BEGIN
    FOREACH v_required IN ARRAY ARRAY[
        'public.p19a_quote_preparation_task_authorizations',
        'public.store_assistant_operational_tasks',
        'public.messages',
        'public.leads',
        'public.conversations',
        'public.commercial_opportunities',
        'public.commercial_opportunity_profile_current',
        'public.commercial_opportunity_profile_versions',
        'public.commercial_opportunity_profile_components',
        'public.store_quote_settings'
    ] LOOP
        IF pg_catalog.to_regclass(v_required) IS NULL THEN
            RAISE EXCEPTION
                'P19A_AUTH_DEPENDENCY_MISSING: %',
                v_required;
        END IF;
    END LOOP;

    IF pg_catalog.to_regprocedure(
        'public.zion_resolve_request_role_internal()'
    ) IS NULL THEN
        RAISE EXCEPTION
            'P19A_AUTH_DEPENDENCY_MISSING: public.zion_resolve_request_role_internal()';
    END IF;

    FOREACH v_required IN ARRAY ARRAY[
        'id',
        'organization_id',
        'store_id',
        'task_type',
        'status',
        'related_lead_id',
        'related_conversation_id',
        'commercial_opportunity_id',
        'task_payload',
        'created_at',
        'cancelled_at',
        'resolved_at'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'store_assistant_operational_tasks'
              AND c.column_name = v_required
        ) THEN
            RAISE EXCEPTION
                'P19A_AUTH_TASK_COLUMN_MISSING: %',
                v_required;
        END IF;
    END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION
public.issue_quote_preparation_task_authorization_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_task_id uuid,
    p_request_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
    v_now timestamptz := pg_catalog.clock_timestamp();

    -- Janela fixa e conservadora.
    v_task_max_age constant interval := interval '15 minutes';
    v_authorization_ttl constant interval := interval '10 minutes';

    v_task public.store_assistant_operational_tasks%ROWTYPE;
    v_message public.messages%ROWTYPE;
    v_lead public.leads%ROWTYPE;
    v_conversation public.conversations%ROWTYPE;
    v_opportunity public.commercial_opportunities%ROWTYPE;
    v_current public.commercial_opportunity_profile_current%ROWTYPE;
    v_profile public.commercial_opportunity_profile_versions%ROWTYPE;
    v_existing public.p19a_quote_preparation_task_authorizations%ROWTYPE;

    v_payload_message_text text;
    v_payload_message_id uuid;
    v_ai_can_generate_quote boolean;
    v_new_id uuid;
    v_expires_at timestamptz;
BEGIN
    IF public.zion_resolve_request_role_internal()
       IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_SYSTEM_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_task_id IS NULL
       OR p_request_message_id IS NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_INVALID_IDENTITIES'
            USING ERRCODE = '22023';
    END IF;

    /*
     * Serializa emissões para a mesma tarefa.
     * Os identificadores fornecidos pelo chamador ainda são
     * revalidados contra os registros relacionais.
     */
    SELECT *
    INTO v_task
    FROM public.store_assistant_operational_tasks
    WHERE id = p_task_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_TASK_NOT_FOUND';
    END IF;

    IF v_task.task_type IS DISTINCT FROM 'commercial_quote_request'
       OR v_task.status NOT IN (
           'open',
           'waiting_user_choice',
           'waiting_customer_response',
           'ready_to_execute',
           'in_progress'
       ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_TASK_NOT_ELIGIBLE';
    END IF;

    IF v_task.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_TASK_CANCELLED';
    END IF;

    IF v_task.resolved_at IS NOT NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_TASK_RESOLVED';
    END IF;

    IF v_task.created_at IS NULL
       OR v_task.created_at < v_now - v_task_max_age
       OR v_task.created_at > v_now + interval '30 seconds' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_TASK_TOO_OLD_OR_FUTURE';
    END IF;

    IF v_task.related_lead_id IS NULL
       OR v_task.related_conversation_id IS NULL
       OR v_task.commercial_opportunity_id IS NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_TASK_IDENTITY_INCOMPLETE';
    END IF;

    /*
     * A origem JSON aceita somente a identidade da mensagem.
     * handoff_origin, created_by, requested_by e campos semelhantes
     * não são usados como autoridade.
     */
    v_payload_message_text :=
        NULLIF(
            pg_catalog.btrim(
                v_task.task_payload #>> '{quote_preparation,request_message_id}'
            ),
            ''
        );

    IF v_payload_message_text IS NULL
       OR v_payload_message_text !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_TASK_REQUEST_MESSAGE_MISSING';
    END IF;

    v_payload_message_id := v_payload_message_text::uuid;

    IF v_payload_message_id IS DISTINCT FROM p_request_message_id THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_REQUEST_MESSAGE_MISMATCH';
    END IF;

    /*
     * Replay por tarefa.
     * Autorizações expiradas ou revogadas permanecem bloqueadas;
     * nunca são substituídas automaticamente.
     */
    SELECT *
    INTO v_existing
    FROM public.p19a_quote_preparation_task_authorizations
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND task_id = p_task_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.request_message_id
           IS DISTINCT FROM p_request_message_id THEN
            RAISE EXCEPTION
                'P19A_QUOTE_PREP_AUTH_IDEMPOTENCY_CONFLICT';
        END IF;

        IF v_existing.revoked_at IS NOT NULL THEN
            RETURN jsonb_build_object(
                'outcome', 'blocked',
                'reason', 'authorization_revoked',
                'authorization_id', v_existing.id,
                'organization_id', v_existing.organization_id,
                'store_id', v_existing.store_id,
                'task_id', v_existing.task_id,
                'request_message_id', v_existing.request_message_id,
                'issued_at', v_existing.issued_at,
                'expires_at', v_existing.expires_at,
                'revoked_at', v_existing.revoked_at
            );
        END IF;

        IF v_existing.expires_at <= v_now THEN
            RETURN jsonb_build_object(
                'outcome', 'blocked',
                'reason', 'authorization_expired',
                'authorization_id', v_existing.id,
                'organization_id', v_existing.organization_id,
                'store_id', v_existing.store_id,
                'task_id', v_existing.task_id,
                'request_message_id', v_existing.request_message_id,
                'issued_at', v_existing.issued_at,
                'expires_at', v_existing.expires_at
            );
        END IF;

        RETURN jsonb_build_object(
            'outcome', 'idempotent_replay',
            'authorization_id', v_existing.id,
            'organization_id', v_existing.organization_id,
            'store_id', v_existing.store_id,
            'task_id', v_existing.task_id,
            'request_message_id', v_existing.request_message_id,
            'issued_at', v_existing.issued_at,
            'expires_at', v_existing.expires_at
        );
    END IF;

    /*
     * A unicidade por mensagem também é uma barreira de replay
     * entre tarefas diferentes.
     */
    SELECT *
    INTO v_existing
    FROM public.p19a_quote_preparation_task_authorizations
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND request_message_id = p_request_message_id
    FOR UPDATE;

    IF FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_MESSAGE_ALREADY_AUTHORIZED';
    END IF;

    SELECT *
    INTO v_message
    FROM public.messages
    WHERE id = p_request_message_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND lead_id = v_task.related_lead_id
      AND conversation_id = v_task.related_conversation_id
      AND sender = 'user'
      AND direction = 'incoming'
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_REQUEST_MESSAGE_INVALID';
    END IF;

    SELECT *
    INTO v_lead
    FROM public.leads
    WHERE id = v_task.related_lead_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_LEAD_NOT_FOUND';
    END IF;

    SELECT *
    INTO v_conversation
    FROM public.conversations
    WHERE id = v_task.related_conversation_id
      AND organization_id = p_organization_id
      AND lead_id = v_task.related_lead_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_CONVERSATION_MISMATCH';
    END IF;

    SELECT *
    INTO v_opportunity
    FROM public.commercial_opportunities
    WHERE id = v_task.commercial_opportunity_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_OPPORTUNITY_NOT_FOUND';
    END IF;

    IF v_opportunity.origin_lead_id
           IS DISTINCT FROM v_task.related_lead_id
       OR v_opportunity.primary_conversation_id
           IS DISTINCT FROM v_task.related_conversation_id THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_OPPORTUNITY_CONTEXT_MISMATCH';
    END IF;

    IF v_opportunity.stage IS NULL
       OR v_opportunity.stage IN (
           'perdido',
           'concluido_sem_mais_acoes'
       ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_OPPORTUNITY_INACTIVE';
    END IF;

    SELECT qs.ai_can_generate_quote
    INTO v_ai_can_generate_quote
    FROM public.store_quote_settings qs
    WHERE qs.organization_id = p_organization_id
      AND qs.store_id = p_store_id
    FOR SHARE;

    IF NOT FOUND
       OR v_ai_can_generate_quote IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_AI_GENERATION_DISABLED';
    END IF;

    SELECT *
    INTO v_current
    FROM public.commercial_opportunity_profile_current
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id = v_task.commercial_opportunity_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_PROFILE_CURRENT_MISSING';
    END IF;

    SELECT *
    INTO v_profile
    FROM public.commercial_opportunity_profile_versions
    WHERE id = v_current.current_profile_version_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id = v_task.commercial_opportunity_id
      AND profile_state = 'resolved';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_PROFILE_NOT_RESOLVED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.commercial_opportunity_profile_components c
        WHERE c.profile_version_id = v_profile.id
          AND c.organization_id = p_organization_id
          AND c.store_id = p_store_id
          AND c.commercial_opportunity_id =
              v_task.commercial_opportunity_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.commercial_opportunity_profile_components c
        WHERE c.profile_version_id = v_profile.id
          AND c.organization_id = p_organization_id
          AND c.store_id = p_store_id
          AND c.commercial_opportunity_id =
              v_task.commercial_opportunity_id
          AND c.component_state IS DISTINCT FROM 'resolved'
    ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_COMPONENTS_NOT_READY';
    END IF;

    v_expires_at := v_now + v_authorization_ttl;

    INSERT INTO public.p19a_quote_preparation_task_authorizations (
        organization_id,
        store_id,
        task_id,
        request_message_id,
        issued_at,
        expires_at
    )
    VALUES (
        p_organization_id,
        p_store_id,
        p_task_id,
        p_request_message_id,
        v_now,
        v_expires_at
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'outcome', 'created',
        'authorization_id', v_new_id,
        'organization_id', p_organization_id,
        'store_id', p_store_id,
        'task_id', p_task_id,
        'request_message_id', p_request_message_id,
        'issued_at', v_now,
        'expires_at', v_expires_at
    );

EXCEPTION
    WHEN unique_violation THEN
        /*
         * Concorrência entre tarefas diferentes usando a mesma mensagem,
         * ou corrida residual fora do lock da tarefa.
         */
        RAISE EXCEPTION
            'P19A_QUOTE_PREP_AUTH_UNIQUENESS_CONFLICT'
            USING ERRCODE = '23505';
END;
$function$;

ALTER FUNCTION
public.issue_quote_preparation_task_authorization_by_system(
    uuid,
    uuid,
    uuid,
    uuid
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.issue_quote_preparation_task_authorization_by_system(
    uuid,
    uuid,
    uuid,
    uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.issue_quote_preparation_task_authorization_by_system(
    uuid,
    uuid,
    uuid,
    uuid
)
TO service_role;

COMMIT;
