-- Backend-only bridge to the existing human quote attempt authority.
-- The trusted backend must validate the channel policy before start.
-- No public route, provider request, commercial event or approval write.

CREATE FUNCTION public.transition_human_quote_send_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid,
    p_operation_key text,
    p_request_fingerprint text,
    p_quote_id uuid,
    p_quote_version_id uuid,
    p_store_file_id uuid,
    p_destination_phone text,
    p_action text,
    p_attempt_token uuid,
    p_reason text,
    p_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
    v_op public.human_quote_send_operations%ROWTYPE;
    v_result jsonb;
BEGIN

    IF p_action IS NULL
       OR p_action NOT IN (
           'start', 'block', 'accept', 'fail', 'uncertain'
       )
    THEN
        RAISE EXCEPTION 'HUMAN_QUOTE_TRANSPORT_ACTION_INVALID';
    END IF;

    SELECT o.*
    INTO v_op
    FROM public.human_quote_send_operations o
    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'HUMAN_QUOTE_TRANSPORT_OPERATION_NOT_FOUND';
    END IF;

    -- Bind the prepared transport to the registered operation.
    IF v_op.operation_key IS DISTINCT FROM p_operation_key
       OR v_op.request_fingerprint
          IS DISTINCT FROM p_request_fingerprint
       OR v_op.quote_id IS DISTINCT FROM p_quote_id
       OR v_op.quote_version_id
          IS DISTINCT FROM p_quote_version_id
       OR v_op.store_file_id
          IS DISTINCT FROM p_store_file_id
       OR v_op.destination_phone
          IS DISTINCT FROM p_destination_phone
    THEN
        RAISE EXCEPTION 'HUMAN_QUOTE_TRANSPORT_IDENTITY_MISMATCH';
    END IF;

    IF p_action = 'start' AND v_op.status = 'registered' THEN

        -- Essential authorization only.
        PERFORM 1
        FROM public.memberships m
        WHERE m.organization_id = p_organization_id
          AND m.user_id = p_actor_user_id
          AND m.is_active IS TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_TRANSPORT_MEMBERSHIP_INVALID';
        END IF;

        PERFORM 1
        FROM public.sales_quotes q
        JOIN public.sales_quote_versions v
          ON v.quote_id = q.id
         AND v.organization_id = q.organization_id
         AND v.store_id = q.store_id
        JOIN public.store_files f
          ON f.id = v.store_file_id
         AND f.organization_id = q.organization_id
         AND f.store_id = q.store_id
        WHERE q.id = p_quote_id
          AND q.organization_id = p_organization_id
          AND q.store_id = p_store_id
          AND q.status NOT IN (
              'expired', 'cancelled', 'failed'
          )
          AND q.metadata->>'created_via' =
              'api_sales_quotes_create'
          AND q.metadata->>'creation_actor_kind' = 'user'
          AND v.id = p_quote_version_id
          AND v.status NOT IN ('failed', 'superseded')
          AND f.id = p_store_file_id
          AND f.file_kind = 'sales_quote_pdf'
          AND f.storage_bucket = v_op.storage_bucket
          AND f.storage_path = v_op.storage_path
          AND f.original_filename = v_op.original_filename
          AND f.mime_type = 'application/pdf'
          AND f.size_bytes = v_op.size_bytes;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_TRANSPORT_DOCUMENT_UNAVAILABLE';
        END IF;

    END IF;

    -- All attempt transitions, idempotency and token checks
    -- remain owned by the previously homologated authority.
    v_result :=
        public.transition_human_quote_send_attempt_internal(
            p_organization_id,
            p_store_id,
            p_actor_user_id,
            p_operation_id,
            p_action,
            p_attempt_token,
            p_reason,
            p_external_message_id
        );

    RETURN v_result;

END;
$function$;

ALTER FUNCTION public.transition_human_quote_send_by_system(
    uuid, uuid, uuid, uuid,
    text, text, uuid, uuid, uuid,
    text, text, uuid, text, text
)
OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.transition_human_quote_send_by_system(
    uuid, uuid, uuid, uuid,
    text, text, uuid, uuid, uuid,
    text, text, uuid, text, text
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.transition_human_quote_send_by_system(
    uuid, uuid, uuid, uuid,
    text, text, uuid, uuid, uuid,
    text, text, uuid, text, text
)
TO service_role;

COMMENT ON FUNCTION public.transition_human_quote_send_by_system(
    uuid, uuid, uuid, uuid,
    text, text, uuid, uuid, uuid,
    text, text, uuid, text, text
)
IS 'Trusted backend attempt bridge. Channel consent, destination policy and WhatsApp window must be validated by the authorized backend before start. No direct provider call or commercial mutation.';
