-- Bind every independent human quote attempt to its provider channel.
-- Preserve the existing attempt lifecycle and original request identity.
-- No provider requests, commercial transitions or human control changes.

ALTER TABLE public.human_quote_send_operations
ADD COLUMN transport_phone_number_id text;

ALTER TABLE public.human_quote_send_operations
ADD CONSTRAINT hqso_transport_channel_chk
CHECK (
    (
        transport_phone_number_id IS NULL
        OR transport_phone_number_id ~ '^[0-9]{1,128}$'
    )
    AND (
        attempt_started_at IS NULL
        OR transport_phone_number_id IS NOT NULL
    )
);

CREATE FUNCTION public.transition_bound_human_quote_send_by_system(
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
    p_external_message_id text,
    p_phone_number_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE

    v_op public.human_quote_send_operations%ROWTYPE;
    v_integration public.external_integrations%ROWTYPE;
    v_result jsonb;

BEGIN

    IF p_phone_number_id IS NULL
       OR p_phone_number_id !~ '^[0-9]{1,128}$'
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_CHANNEL_INVALID';
    END IF;

    IF p_action IS NULL
       OR p_action NOT IN (
           'start','block','accept','fail','uncertain'
       )
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_CHANNEL_ACTION_INVALID';
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
        RAISE EXCEPTION
            'HUMAN_QUOTE_CHANNEL_OPERATION_NOT_FOUND';
    END IF;

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
        RAISE EXCEPTION
            'HUMAN_QUOTE_CHANNEL_IDENTITY_MISMATCH';
    END IF;

    -- The original channel remains immutable after an attempt.

    IF v_op.transport_phone_number_id IS NOT NULL
       AND v_op.transport_phone_number_id
            IS DISTINCT FROM p_phone_number_id
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_CHANNEL_CHANGED';
    END IF;

    IF p_action = 'start'
       AND v_op.status = 'registered'
    THEN

        -- Require exactly one eligible integration.
        -- Hold its row lock until this transaction completes.

        BEGIN

            SELECT i.*
            INTO STRICT v_integration

            FROM public.external_integrations i

            WHERE i.organization_id = p_organization_id
              AND i.store_id = p_store_id
              AND i.provider = 'whatsapp'
              AND i.status = 'active'
              AND i.is_active IS TRUE
              AND nullif(
                  btrim(i.phone_number_id),''
              ) IS NOT NULL

            FOR SHARE;

        EXCEPTION
            WHEN no_data_found OR too_many_rows THEN

                RAISE EXCEPTION
                    'HUMAN_QUOTE_CHANNEL_INTEGRATION_INVALID';

        END;

        IF btrim(v_integration.phone_number_id)
               IS DISTINCT FROM p_phone_number_id
           OR nullif(
               btrim(v_integration.access_token),''
           ) IS NULL
        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_CHANNEL_INTEGRATION_MISMATCH';
        END IF;

        -- A customer history binding must identify this same
        -- provider channel. Skipped history is permitted.

        IF v_op.recipient_kind = 'lead'
           AND v_op.history_binding->>'phone_number_id'
               IS DISTINCT FROM p_phone_number_id
        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_CHANNEL_HISTORY_MISMATCH';
        END IF;

        UPDATE public.human_quote_send_operations o

        SET transport_phone_number_id = p_phone_number_id

        WHERE o.organization_id = p_organization_id
          AND o.store_id = p_store_id
          AND o.actor_user_id = p_actor_user_id
          AND o.operation_id = p_operation_id
          AND o.status = 'registered';

        IF NOT FOUND THEN

            RAISE EXCEPTION
                'HUMAN_QUOTE_CHANNEL_BINDING_FAILED';

        END IF;

    ELSIF p_action IN ('accept','fail','uncertain')
          AND v_op.transport_phone_number_id IS NULL
    THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_CHANNEL_BINDING_REQUIRED';

    END IF;

    -- Preserve all original membership, document,
    -- transition and attempt-token validations.

    v_result :=
        public.transition_human_quote_send_by_system(
            p_organization_id,
            p_store_id,
            p_actor_user_id,
            p_operation_id,
            p_operation_key,
            p_request_fingerprint,
            p_quote_id,
            p_quote_version_id,
            p_store_file_id,
            p_destination_phone,
            p_action,
            p_attempt_token,
            p_reason,
            p_external_message_id
        );

    RETURN v_result;

END;
$function$;

ALTER FUNCTION public.transition_bound_human_quote_send_by_system(
    uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,
    text,text,uuid,text,text,text
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.transition_bound_human_quote_send_by_system(
    uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,
    text,text,uuid,text,text,text
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.transition_bound_human_quote_send_by_system(
    uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,
    text,text,uuid,text,text,text
)
TO service_role;

-- The original bridge remains available to the new
-- postgres-owned authority, not as an alternative API.

REVOKE ALL ON FUNCTION
public.transition_human_quote_send_by_system(
    uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,
    text,text,uuid,text,text
)
FROM PUBLIC, anon, authenticated, service_role;
