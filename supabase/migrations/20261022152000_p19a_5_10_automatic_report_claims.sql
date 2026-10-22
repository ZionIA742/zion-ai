BEGIN;

-- ZION / P19-A / 5.10
-- Claims e materializacao atomica de relatorios automaticos.
-- Nao altera RPCs ou filas existentes.

CREATE TABLE public.store_assistant_automatic_report_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    store_id uuid NOT NULL
        REFERENCES public.stores(id) ON DELETE CASCADE,
    local_date date NOT NULL,
    report_type text NOT NULL
        CHECK (report_type IN ('morning_report', 'evening_report')),
    status text NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'retryable', 'completed')),
    claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 1
        CHECK (attempt_count >= 1),
    message_id uuid
        REFERENCES public.store_assistant_messages(id)
        ON DELETE SET NULL,
    notification_id uuid
        REFERENCES public.store_assistant_notification_queue(id)
        ON DELETE SET NULL,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT store_assistant_automatic_report_claims_identity_key
        UNIQUE (
            organization_id,
            store_id,
            local_date,
            report_type
        )
);

CREATE INDEX store_assistant_auto_reports_recovery_idx
ON public.store_assistant_automatic_report_claims
    (status, lease_expires_at);

ALTER TABLE public.store_assistant_automatic_report_claims
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.store_assistant_automatic_report_claims
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON public.store_assistant_automatic_report_claims
TO service_role;


-- 1. Claim atomico, com recuperacao por lease.

CREATE FUNCTION public.assistant_claim_automatic_report(
    p_organization_id uuid,
    p_store_id uuid,
    p_local_date date,
    p_report_type text,
    p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    v_run public.store_assistant_automatic_report_claims%ROWTYPE;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'REPORT_SERVICE_ROLE_REQUIRED';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_local_date IS NULL
       OR p_report_type NOT IN ('morning_report', 'evening_report')
       OR p_report_type IS NULL
       OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 30 AND 1800
    THEN
        RAISE EXCEPTION 'INVALID_REPORT_CLAIM';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.stores s
        WHERE s.id = p_store_id
          AND s.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'INVALID_REPORT_STORE_SCOPE';
    END IF;

    INSERT INTO public.store_assistant_automatic_report_claims (
        organization_id,
        store_id,
        local_date,
        report_type,
        status,
        claim_token,
        lease_expires_at,
        attempt_count
    )
    VALUES (
        p_organization_id,
        p_store_id,
        p_local_date,
        p_report_type,
        'processing',
        gen_random_uuid(),
        v_now + make_interval(secs => p_lease_seconds),
        1
    )
    ON CONFLICT ON CONSTRAINT
        store_assistant_automatic_report_claims_identity_key
    DO NOTHING
    RETURNING * INTO v_run;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'result', 'claimed',
            'claim_id', v_run.id,
            'claim_token', v_run.claim_token,
            'attempt_count', v_run.attempt_count
        );
    END IF;

    SELECT *
    INTO v_run
    FROM public.store_assistant_automatic_report_claims r
    WHERE r.organization_id = p_organization_id
      AND r.store_id = p_store_id
      AND r.local_date = p_local_date
      AND r.report_type = p_report_type
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REPORT_CLAIM_NOT_FOUND';
    END IF;

    IF v_run.status = 'completed' THEN
        RETURN jsonb_build_object(
            'result', 'completed',
            'claim_id', v_run.id,
            'message_id', v_run.message_id,
            'notification_id', v_run.notification_id
        );
    END IF;

    IF v_run.lease_expires_at > clock_timestamp() THEN
        RETURN jsonb_build_object(
            'result',
            CASE
                WHEN v_run.status = 'retryable'
                    THEN 'retry_later'
                ELSE 'already_claimed'
            END,
            'claim_id', v_run.id
        );
    END IF;

    UPDATE public.store_assistant_automatic_report_claims
    SET status = 'processing',
        claim_token = gen_random_uuid(),
        lease_expires_at =
            clock_timestamp() +
            make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_run.id
    RETURNING * INTO v_run;

    RETURN jsonb_build_object(
        'result', 'claimed',
        'claim_id', v_run.id,
        'claim_token', v_run.claim_token,
        'attempt_count', v_run.attempt_count
    );
END;
$function$;


-- 2. Mensagem e notificacao na mesma transacao.
-- Se alguma gravacao falhar, nenhuma das duas e confirmada.

CREATE FUNCTION public.assistant_materialize_automatic_report(
    p_organization_id uuid,
    p_store_id uuid,
    p_local_date date,
    p_report_type text,
    p_claim_token uuid,
    p_content text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    v_run public.store_assistant_automatic_report_claims%ROWTYPE;
    v_message public.store_assistant_messages%ROWTYPE;
    v_notification_id uuid;
    v_message_type text;
    v_event_key text;
    v_metadata jsonb;
    v_context jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'REPORT_SERVICE_ROLE_REQUIRED';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_local_date IS NULL
       OR p_claim_token IS NULL
       OR p_report_type IS NULL
       OR p_report_type NOT IN ('morning_report', 'evening_report')
       OR NULLIF(btrim(COALESCE(p_content, '')), '') IS NULL
       OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object'
    THEN
        RAISE EXCEPTION 'INVALID_REPORT_MATERIALIZATION';
    END IF;

    SELECT *
    INTO v_run
    FROM public.store_assistant_automatic_report_claims r
    WHERE r.organization_id = p_organization_id
      AND r.store_id = p_store_id
      AND r.local_date = p_local_date
      AND r.report_type = p_report_type
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REPORT_CLAIM_NOT_FOUND';
    END IF;

    IF v_run.status = 'completed' THEN
        RETURN jsonb_build_object(
            'result', 'completed',
            'claim_id', v_run.id,
            'message_id', v_run.message_id,
            'notification_id', v_run.notification_id
        );
    END IF;

    IF v_run.status <> 'processing'
       OR v_run.claim_token IS DISTINCT FROM p_claim_token
       OR v_run.lease_expires_at IS NULL
       OR v_run.lease_expires_at <= clock_timestamp()
    THEN
        RAISE EXCEPTION 'REPORT_CLAIM_INVALID_OR_EXPIRED';
    END IF;

    v_message_type := CASE p_report_type
        WHEN 'morning_report' THEN 'report_morning'
        ELSE 'report_evening'
    END;

    v_event_key := concat(
        'assistant-automatic-report:',
        p_organization_id::text, ':',
        p_store_id::text, ':',
        p_local_date::text, ':',
        p_report_type
    );

    v_metadata :=
        COALESCE(p_metadata, '{}'::jsonb) ||
        jsonb_build_object(
            'source', 'assistant_automatic_reports',
            'local_date', p_local_date::text,
            'report_type', p_report_type,
            'event_key', v_event_key
        );

    SELECT *
    INTO v_message
    FROM public.assistant_push_system_message(
        p_organization_id,
        p_store_id,
        btrim(p_content),
        v_message_type,
        NULL::uuid,
        NULL::uuid,
        NULL::uuid,
        v_metadata
    );

    IF v_message.id IS NULL THEN
        RAISE EXCEPTION 'REPORT_MESSAGE_NOT_CREATED';
    END IF;

    v_context := jsonb_build_object(
        'report_source', 'assistant_automatic_reports',
        'event_key', v_event_key,
        'local_date', p_local_date::text,
        'report_type', p_report_type,
        'assistant_message_id', v_message.id
    );

    SELECT public.assistant_enqueue_internal_notification(
        p_organization_id,
        p_store_id,
        p_report_type,
        CASE p_report_type
            WHEN 'morning_report' THEN 'Relatório da manhã'
            ELSE 'Relatório da noite'
        END,
        btrim(p_content),
        'normal',
        v_context,
        NULL::uuid,
        NULL::uuid,
        NULL::uuid,
        v_event_key
    )
    INTO v_notification_id;

    IF v_notification_id IS NULL THEN
        RAISE EXCEPTION 'REPORT_NOTIFICATION_NOT_CREATED';
    END IF;

    UPDATE public.store_assistant_automatic_report_claims
    SET status = 'completed',
        message_id = v_message.id,
        notification_id = v_notification_id,
        lease_expires_at = NULL,
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_run.id
      AND claim_token = p_claim_token
      AND status = 'processing';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REPORT_FINALIZATION_FENCE_FAILED';
    END IF;

    RETURN jsonb_build_object(
        'result', 'completed',
        'claim_id', v_run.id,
        'message_id', v_message.id,
        'notification_id', v_notification_id
    );
END;
$function$;


-- 3. Registrar falha recuperavel sem permitir token antigo.

CREATE FUNCTION public.assistant_fail_automatic_report(
    p_organization_id uuid,
    p_store_id uuid,
    p_local_date date,
    p_report_type text,
    p_claim_token uuid,
    p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    v_id uuid;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'REPORT_SERVICE_ROLE_REQUIRED';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_local_date IS NULL
       OR p_claim_token IS NULL
       OR p_report_type IS NULL
       OR p_report_type NOT IN ('morning_report', 'evening_report')
    THEN
        RAISE EXCEPTION 'INVALID_REPORT_FAILURE';
    END IF;

    UPDATE public.store_assistant_automatic_report_claims
    SET status = 'retryable',
        lease_expires_at =
            clock_timestamp() + interval '5 minutes',
        last_error = left(
            COALESCE(NULLIF(btrim(p_error_code), ''), 'UNKNOWN'),
            160
        ),
        updated_at = clock_timestamp()
    WHERE organization_id = p_organization_id
      AND store_id = p_store_id
      AND local_date = p_local_date
      AND report_type = p_report_type
      AND claim_token = p_claim_token
      AND status = 'processing'
      AND lease_expires_at > clock_timestamp()
    RETURNING id INTO v_id;

    RETURN v_id IS NOT NULL;
END;
$function$;


-- Restringir todas as novas RPCs ao service_role.

REVOKE ALL ON FUNCTION
    public.assistant_claim_automatic_report(
        uuid, uuid, date, text, integer
    )
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
    public.assistant_materialize_automatic_report(
        uuid, uuid, date, text, uuid, text, jsonb
    )
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
    public.assistant_fail_automatic_report(
        uuid, uuid, date, text, uuid, text
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.assistant_claim_automatic_report(
        uuid, uuid, date, text, integer
    )
TO service_role;

GRANT EXECUTE ON FUNCTION
    public.assistant_materialize_automatic_report(
        uuid, uuid, date, text, uuid, text, jsonb
    )
TO service_role;

GRANT EXECUTE ON FUNCTION
    public.assistant_fail_automatic_report(
        uuid, uuid, date, text, uuid, text
    )
TO service_role;

COMMIT;
