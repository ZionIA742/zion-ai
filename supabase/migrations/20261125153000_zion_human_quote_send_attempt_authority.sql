-- ZION: private human quote send attempt state machine.
-- No API-role execution, transport, scheduler or CRM effects.
-- Future scoped authorities must validate transport readiness
-- before invoking the internal start transition.

ALTER TABLE public.human_quote_send_operations
    ADD COLUMN attempt_token uuid;

ALTER TABLE public.human_quote_send_operations
    ADD CONSTRAINT hqso_attempt_token_consistency_chk
    CHECK (
        (
            status IN ('registered', 'blocked')
            AND attempt_token IS NULL
        )
        OR (
            status IN (
                'attempt_started',
                'accepted',
                'failed',
                'uncertain'
            )
            AND attempt_token IS NOT NULL
            AND attempt_token <>
                '00000000-0000-0000-0000-000000000000'::uuid
        )
    );

CREATE UNIQUE INDEX hqso_attempt_token_uidx
    ON public.human_quote_send_operations (
        attempt_token
    )
    WHERE attempt_token IS NOT NULL;

CREATE FUNCTION public.transition_human_quote_send_attempt_internal(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid,
    p_action text,
    p_attempt_token uuid,
    p_reason text,
    p_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
    v_operation public.human_quote_send_operations%ROWTYPE;

    v_status text;
    v_reason text;
    v_token uuid;

    v_attempt_started_at timestamptz;
    v_provider_accepted_at timestamptz;
    v_external_message_id text;

    v_stamp timestamptz;
    v_new_attempt boolean := false;
    v_replay boolean := false;

BEGIN

    -- Internal authority only.
    -- API roles must never invoke this function directly.

    IF current_user <> 'postgres' THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_INTERNAL_AUTHORITY_REQUIRED';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_actor_user_id IS NULL
       OR p_operation_id IS NULL
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_ATTEMPT_SCOPE_INVALID';
    END IF;

    IF p_action IS NULL
       OR p_action NOT IN (
           'block',
           'start',
           'accept',
           'fail',
           'uncertain'
       )
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_ACTION_INVALID';
    END IF;

    -- Strict argument contract.

    IF p_action IN ('block', 'start') THEN

        IF p_attempt_token IS NOT NULL THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_UNEXPECTED_ATTEMPT_TOKEN';
        END IF;

    ELSE

        IF p_attempt_token IS NULL
           OR p_attempt_token =
               '00000000-0000-0000-0000-000000000000'::uuid
        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_ATTEMPT_TOKEN_REQUIRED';
        END IF;

    END IF;

    IF p_action IN ('block', 'fail', 'uncertain') THEN

        IF p_reason IS NULL
           OR p_reason !~ '^[A-Za-z0-9_:-]{1,160}$'
           OR p_reason ~ '[[:cntrl:]]'
        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_REASON_INVALID';
        END IF;

    ELSIF p_reason IS NOT NULL THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_UNEXPECTED_REASON';

    END IF;

    IF p_action = 'accept' THEN

        IF p_external_message_id IS NULL
           OR char_length(p_external_message_id)
                NOT BETWEEN 1 AND 512
           OR p_external_message_id ~
                '[[:space:][:cntrl:]]'
        THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_EXTERNAL_ID_INVALID';
        END IF;

    ELSIF p_external_message_id IS NOT NULL THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_UNEXPECTED_EXTERNAL_ID';

    END IF;

    -- Lock the exact operation before examining its state.
    -- Concurrent starts serialize on the same row.

    SELECT o.*
    INTO v_operation
    FROM public.human_quote_send_operations o
    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_OPERATION_NOT_FOUND';
    END IF;

    v_status := v_operation.status;
    v_reason := v_operation.status_reason;
    v_token := v_operation.attempt_token;

    v_attempt_started_at :=
        v_operation.attempt_started_at;

    v_provider_accepted_at :=
        v_operation.provider_accepted_at;

    v_external_message_id :=
        v_operation.external_message_id;

    v_stamp := greatest(
        clock_timestamp(),
        v_operation.updated_at
    );

    -- Finalization must match the exact attempt token.

    IF p_action IN ('accept', 'fail', 'uncertain')
       AND v_token IS DISTINCT FROM p_attempt_token
    THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_ATTEMPT_TOKEN_MISMATCH';
    END IF;

    CASE p_action

        WHEN 'block' THEN

            IF v_status = 'registered' THEN

                v_status := 'blocked';
                v_reason := p_reason;

            ELSIF v_status = 'blocked'
                  AND v_reason = p_reason
            THEN

                v_replay := true;

            ELSE

                RAISE EXCEPTION
                    'HUMAN_QUOTE_SEND_TRANSITION_DENIED';

            END IF;

        WHEN 'start' THEN

            IF v_status = 'registered' THEN

                v_status := 'attempt_started';
                v_reason := NULL;

                v_token := gen_random_uuid();
                v_attempt_started_at := v_stamp;

                v_new_attempt := true;

            ELSE

                -- Existing operations must never authorize
                -- another provider request.
                v_replay := true;

            END IF;

        WHEN 'accept' THEN

            IF v_status IN (
                'attempt_started',
                'uncertain'
            ) THEN

                v_status := 'accepted';
                v_reason := NULL;

                v_external_message_id :=
                    p_external_message_id;

                v_provider_accepted_at := v_stamp;

            ELSIF v_status = 'accepted'
                  AND v_external_message_id =
                      p_external_message_id
            THEN

                v_replay := true;

            ELSE

                RAISE EXCEPTION
                    'HUMAN_QUOTE_SEND_TRANSITION_DENIED';

            END IF;

        WHEN 'fail' THEN

            IF v_status = 'attempt_started' THEN

                v_status := 'failed';
                v_reason := p_reason;

            ELSIF v_status = 'failed'
                  AND v_reason = p_reason
            THEN

                v_replay := true;

            ELSE

                RAISE EXCEPTION
                    'HUMAN_QUOTE_SEND_TRANSITION_DENIED';

            END IF;

        WHEN 'uncertain' THEN

            IF v_status = 'attempt_started' THEN

                v_status := 'uncertain';
                v_reason := p_reason;

            ELSIF v_status = 'uncertain'
                  AND v_reason = p_reason
            THEN

                v_replay := true;

            ELSE

                RAISE EXCEPTION
                    'HUMAN_QUOTE_SEND_TRANSITION_DENIED';

            END IF;

    END CASE;

    -- Replays do not mutate timestamps or recover a token.

    IF NOT v_replay THEN

        UPDATE public.human_quote_send_operations o
        SET
            status = v_status,
            status_reason = v_reason,
            attempt_token = v_token,
            attempt_started_at = v_attempt_started_at,
            provider_accepted_at = v_provider_accepted_at,
            external_message_id = v_external_message_id,
            updated_at = v_stamp

        WHERE o.organization_id = p_organization_id
          AND o.store_id = p_store_id
          AND o.actor_user_id = p_actor_user_id
          AND o.operation_id = p_operation_id

        RETURNING o.*
        INTO v_operation;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'HUMAN_QUOTE_SEND_TRANSITION_WRITE_FAILED';
        END IF;

    END IF;

    RETURN jsonb_build_object(
        'outcome',
            CASE
                WHEN v_new_attempt THEN 'attempt_created'
                WHEN v_replay THEN 'existing_state'
                ELSE 'transitioned'
            END,

        'operation_id',
            v_operation.operation_id,

        'status',
            v_operation.status,

        'status_reason',
            v_operation.status_reason,

        'new_attempt',
            v_new_attempt,

        'attempt_token',
            CASE
                WHEN v_new_attempt THEN
                    v_operation.attempt_token
                ELSE NULL::uuid
            END,

        'attempt_started_at',
            v_operation.attempt_started_at,

        'provider_accepted_at',
            v_operation.provider_accepted_at,

        'updated_at',
            v_operation.updated_at
    );

END;
$function$;

ALTER FUNCTION public.transition_human_quote_send_attempt_internal(
    uuid, uuid, uuid, uuid, text, uuid, text, text
)
OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.transition_human_quote_send_attempt_internal(
    uuid, uuid, uuid, uuid, text, uuid, text, text
)
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.transition_human_quote_send_attempt_internal(
    uuid, uuid, uuid, uuid, text, uuid, text, text
)
IS 'Private attempt state machine. Does not authorize transport. Only a new start returns an attempt token. Replays never authorize a second provider request.';

COMMENT ON COLUMN public.human_quote_send_operations.attempt_token
IS 'Private immutable attempt identity. Never expose through public responses or retry authorization.';
