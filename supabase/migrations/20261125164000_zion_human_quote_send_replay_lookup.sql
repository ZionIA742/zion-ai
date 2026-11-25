-- ZION: read-only recovery of previously registered human quote sends.
-- This authority never registers or authorizes a new provider attempt.

CREATE FUNCTION public.lookup_human_quote_send_replay_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid,
    p_quote_id uuid,
    p_quote_version_id uuid,
    p_operation_key text,
    p_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE

    v_op public.human_quote_send_operations%ROWTYPE;

    v_expected_key text;

BEGIN

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_actor_user_id IS NULL
       OR p_operation_id IS NULL
       OR p_quote_id IS NULL
       OR p_quote_version_id IS NULL
       OR '00000000-0000-0000-0000-000000000000'::uuid IN (
           p_organization_id,
           p_store_id,
           p_actor_user_id,
           p_operation_id,
           p_quote_id,
           p_quote_version_id
       )
       OR p_operation_key IS NULL
       OR p_operation_key !~
           '^human_quote_send:v1:[0-9a-f]{64}$'
       OR p_request_fingerprint IS NULL
       OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    THEN

        RAISE EXCEPTION 'HUMAN_QUOTE_SEND_SCOPE_INVALID';

    END IF;

    v_expected_key :=
        'human_quote_send:v1:' ||
        encode(
            sha256(
                convert_to(
                    format(
                        '["%s","%s","%s","%s"]',
                        p_organization_id,
                        p_store_id,
                        p_actor_user_id,
                        p_operation_id
                    ),
                    'UTF8'
                )
            ),
            'hex'
        );

    IF p_operation_key IS DISTINCT FROM v_expected_key THEN

        RAISE EXCEPTION 'HUMAN_QUOTE_SEND_IDENTITY_MISMATCH';

    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.organization_id = p_organization_id
          AND m.user_id = p_actor_user_id
          AND m.is_active IS TRUE
    ) THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_ACTIVE_MEMBERSHIP_REQUIRED';

    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.stores s
        WHERE s.id = p_store_id
          AND s.organization_id = p_organization_id
    ) THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_STORE_SCOPE_INVALID';

    END IF;

    SELECT o.*
    INTO v_op
    FROM public.human_quote_send_operations o
    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- The immutable request fingerprint binds the original
    -- recipient contract and document version.

    IF v_op.operation_key IS DISTINCT FROM p_operation_key
       OR v_op.request_fingerprint
            IS DISTINCT FROM p_request_fingerprint
       OR v_op.quote_id IS DISTINCT FROM p_quote_id
       OR v_op.quote_version_id
            IS DISTINCT FROM p_quote_version_id
    THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_OPERATION_CONFLICT';

    END IF;

    -- Registered operations still need all ordinary
    -- registration and transport authorization checks.

    IF v_op.status = 'registered' THEN
        RETURN NULL;
    END IF;

    IF v_op.status NOT IN (
        'blocked',
        'attempt_started',
        'accepted',
        'failed',
        'uncertain'
    ) THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_SEND_REPLAY_STATE_INVALID';

    END IF;

    RETURN jsonb_build_object(
        'outcome','existing_operation',
        'operation_id',v_op.operation_id,
        'operation_key',v_op.operation_key,
        'quote_id',v_op.quote_id,
        'quote_version_id',v_op.quote_version_id,
        'recipient_kind',v_op.recipient_kind,
        'status',v_op.status,
        'status_reason',v_op.status_reason,
        'created_at',v_op.created_at
    );

END;
$function$;


ALTER FUNCTION public.lookup_human_quote_send_replay_by_system(
    uuid,uuid,uuid,uuid,uuid,uuid,text,text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.lookup_human_quote_send_replay_by_system(
    uuid,uuid,uuid,uuid,uuid,uuid,text,text
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.lookup_human_quote_send_replay_by_system(
    uuid,uuid,uuid,uuid,uuid,uuid,text,text
) TO service_role;


COMMENT ON FUNCTION public.lookup_human_quote_send_replay_by_system(
    uuid,uuid,uuid,uuid,uuid,uuid,text,text
) IS 'Read-only replay lookup. Existing nonregistered operations can be recovered without revalidating the current document version or destination. Never authorizes transport.';
