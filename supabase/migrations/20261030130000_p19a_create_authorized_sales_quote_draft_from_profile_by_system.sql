-- ZION / PILAR 19-A / ETAPA 5.2-E.1-B.3
-- Criacao autorizada e transacional do rascunho automatico.
-- Nao altera a RPC escritora existente e nao habilita automacao.

BEGIN;

CREATE FUNCTION public.create_authorized_sales_quote_draft_from_current_profile_by_system(
    p_authorization_id uuid,
    p_organization_id uuid,
    p_store_id uuid,
    p_task_id uuid,
    p_request_message_id uuid,
    p_queue_id uuid,
    p_operation_id uuid,
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
    v_authorization public.p19a_quote_preparation_task_authorizations%ROWTYPE;
    v_task public.store_assistant_operational_tasks%ROWTYPE;
    v_queue public.store_assistant_operational_task_queue%ROWTYPE;
    v_operation public.p19a_quote_preparation_operations%ROWTYPE;
    v_settings_count bigint;
    v_ai_can_generate_quote boolean;
    v_writer_result jsonb;
BEGIN
    IF public.zion_resolve_request_role_internal()
        IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_SYSTEM_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_authorization_id IS NULL
       OR p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_task_id IS NULL
       OR p_request_message_id IS NULL
       OR p_queue_id IS NULL
       OR p_operation_id IS NULL
       OR p_commercial_opportunity_id IS NULL
       OR p_profile_version_id IS NULL
       OR p_profile_version_number IS NULL
       OR p_profile_version_number <= 0
       OR p_creation_idempotency_key IS NULL
       OR p_creation_request_fingerprint IS NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_IDENTITIES_INVALID'
            USING ERRCODE = '22023';
    END IF;

    /*
     * Mesma ordem inicial da RPC escritora:
     * oportunidade antes da operacao.
     * Isso evita introduzir uma ordem de locks concorrente.
     */
    PERFORM 1
    FROM public.commercial_opportunities o
    WHERE o.id = p_commercial_opportunity_id
      AND o.organization_id = p_organization_id
      AND o.store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_OPPORTUNITY_NOT_FOUND';
    END IF;

    /*
     * O lock FOR UPDATE serializa revogacao concorrente.
     * Se a revogacao confirmou antes deste ponto, a linha ja
     * sera observada como revogada.
     */
    SELECT *
    INTO v_authorization
    FROM public.p19a_quote_preparation_task_authorizations a
    WHERE a.id = p_authorization_id
      AND a.organization_id = p_organization_id
      AND a.store_id = p_store_id
      AND a.task_id = p_task_id
      AND a.request_message_id = p_request_message_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_AUTHORIZATION_NOT_FOUND';
    END IF;

    IF v_authorization.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_AUTHORIZATION_REVOKED';
    END IF;

    IF v_authorization.expires_at <= pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_AUTHORIZATION_EXPIRED';
    END IF;

    /*
     * O lock da tarefa impede cancelamento ou resolucao concorrente
     * durante a validacao e a materializacao.
     */
    SELECT *
    INTO v_task
    FROM public.store_assistant_operational_tasks t
    WHERE t.id = p_task_id
      AND t.organization_id = p_organization_id
      AND t.store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_TASK_NOT_FOUND';
    END IF;

    IF v_task.task_type IS DISTINCT FROM 'commercial_quote_request'
       OR v_task.status NOT IN (
            'open',
            'waiting_user_choice',
            'waiting_customer_response',
            'ready_to_execute',
            'in_progress'
       )
       OR v_task.cancelled_at IS NOT NULL
       OR v_task.resolved_at IS NOT NULL
       OR pg_catalog.btrim(
            v_task.task_payload #>> '{quote_preparation,request_message_id}'
          ) IS DISTINCT FROM p_request_message_id::text THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_TASK_NOT_ELIGIBLE';
    END IF;

    /*
     * Somente uma entrada ja reivindicada pelo worker pode usar
     * esta autoridade. O lock impede cancelamento ou processamento
     * concorrente da mesma entrada.
     */
    SELECT *
    INTO v_queue
    FROM public.store_assistant_operational_task_queue q
    WHERE q.id = p_queue_id
      AND q.organization_id = p_organization_id
      AND q.store_id = p_store_id
      AND q.task_id = p_task_id
      AND q.message_id = p_request_message_id
      AND q.queue_type = 'quote_preparation_request'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_QUEUE_NOT_FOUND';
    END IF;

    IF v_queue.status IS DISTINCT FROM 'processing' THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_QUEUE_NOT_CLAIMED';
    END IF;

    /*
     * A operacao deve ser a operacao canonica da mesma mensagem,
     * tenant, loja, oportunidade e perfil.
     */
    SELECT *
    INTO v_operation
    FROM public.p19a_quote_preparation_operations o
    WHERE o.id = p_operation_id
      AND o.organization_id = p_organization_id
      AND o.store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_OPERATION_NOT_FOUND';
    END IF;

    IF v_operation.request_message_id
           IS DISTINCT FROM p_request_message_id
       OR v_operation.commercial_opportunity_id
           IS DISTINCT FROM p_commercial_opportunity_id
       OR v_operation.profile_version_id
           IS DISTINCT FROM p_profile_version_id
       OR v_operation.profile_version_number
           IS DISTINCT FROM p_profile_version_number
       OR v_operation.operation_key
           IS DISTINCT FROM p_creation_idempotency_key
       OR v_operation.request_fingerprint
           IS DISTINCT FROM p_creation_request_fingerprint
       OR v_operation.status NOT IN (
            'queued',
            'processing',
            'uncertain',
            'completed'
       ) THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_OPERATION_IDENTITY_CONFLICT';
    END IF;

    /*
     * Exatamente uma configuracao deve existir e permanecer
     * bloqueada contra atualizacao ate o fim desta transacao.
     */
    SELECT count(*)
    INTO v_settings_count
    FROM public.store_quote_settings qs
    WHERE qs.organization_id = p_organization_id
      AND qs.store_id = p_store_id;

    IF v_settings_count <> 1 THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_SETTINGS_MISSING_OR_AMBIGUOUS';
    END IF;

    SELECT qs.ai_can_generate_quote
    INTO v_ai_can_generate_quote
    FROM public.store_quote_settings qs
    WHERE qs.organization_id = p_organization_id
      AND qs.store_id = p_store_id
    FOR UPDATE;

    IF v_ai_can_generate_quote IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_AI_GENERATION_DISABLED';
    END IF;

    /*
     * Toda a criacao, materializacao, reserva de numero e finalizacao
     * da operacao permanecem na autoridade existente.
     */
    v_writer_result :=
        public.create_sales_quote_draft_from_current_profile_by_system(
            p_operation_id,
            p_organization_id,
            p_store_id,
            p_commercial_opportunity_id,
            p_profile_version_id,
            p_profile_version_number,
            p_creation_idempotency_key,
            p_creation_request_fingerprint
        );

    /*
     * Se a validade temporal terminar durante a materializacao,
     * a excecao desfaz integralmente a chamada da escritora.
     */
    IF v_authorization.expires_at <= pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION
            'P19A_QUOTE_DRAFT_AUTHORIZED_AUTHORIZATION_EXPIRED_DURING_WRITE';
    END IF;

    RETURN v_writer_result;
END;
$function$;

ALTER FUNCTION
    public.create_authorized_sales_quote_draft_from_current_profile_by_system(
        uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text
    )
OWNER TO postgres;

REVOKE ALL ON FUNCTION
    public.create_authorized_sales_quote_draft_from_current_profile_by_system(
        uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text
    )
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.create_authorized_sales_quote_draft_from_current_profile_by_system(
        uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text
    )
TO service_role;

COMMENT ON FUNCTION
    public.create_authorized_sales_quote_draft_from_current_profile_by_system(
        uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text
    )
IS
    'Valida autorizacao individual, tarefa, fila, configuracao e operacao '
    'com locks transacionais antes de delegar a criacao idempotente do '
    'rascunho P19-A. Nao aprova, publica, gera PDF ou envia mensagem.';

COMMIT;
