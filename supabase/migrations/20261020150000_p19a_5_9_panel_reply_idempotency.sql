-- ZION / P19-A / Bloco 5 / Etapa 5.9
-- Idempotencia de respostas originadas no painel.
--
-- VERSAO REVISADA: PRE-FLIGHT SUPABASE PASS (20/10/2026).
-- Executar apenas apos revisao e autorizacao.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. Ledger exclusivo das respostas do painel.

CREATE TABLE public.store_assistant_panel_reply_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    human_message_id uuid NOT NULL,
    assistant_message_id uuid,

    status text NOT NULL DEFAULT 'processing',
    claim_token uuid NOT NULL,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 1,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT panel_reply_run_unique_human
        UNIQUE (
            organization_id,
            store_id,
            human_message_id
        ),

    CONSTRAINT panel_reply_run_status_check
        CHECK (
            (
                status = 'processing'
                AND assistant_message_id IS NULL
                AND lease_expires_at IS NOT NULL
            )
            OR
            (
                status = 'confirmed'
                AND assistant_message_id IS NOT NULL
                AND lease_expires_at IS NULL
            )
        ),

    CONSTRAINT panel_reply_run_attempt_check
        CHECK (attempt_count >= 1),

    CONSTRAINT panel_reply_run_thread_fk
        FOREIGN KEY (
            thread_id,
            organization_id,
            store_id
        )
        REFERENCES public.store_assistant_threads (
            id,
            organization_id,
            store_id
        )
        ON DELETE CASCADE,

    CONSTRAINT panel_reply_run_human_fk
        FOREIGN KEY (
            human_message_id,
            organization_id,
            store_id,
            thread_id
        )
        REFERENCES public.store_assistant_messages (
            id,
            organization_id,
            store_id,
            thread_id
        )
        ON DELETE CASCADE,

    CONSTRAINT panel_reply_run_assistant_fk
        FOREIGN KEY (
            assistant_message_id,
            organization_id,
            store_id,
            thread_id
        )
        REFERENCES public.store_assistant_messages (
            id,
            organization_id,
            store_id,
            thread_id
        )
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.store_assistant_panel_reply_runs
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.store_assistant_panel_reply_runs
FROM PUBLIC, anon, authenticated, service_role;

-- 2. Claim atomico antes da geracao.

CREATE FUNCTION public.claim_assistant_panel_reply_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_human_message_id uuid,
    p_claim_token uuid,
    p_lease_seconds integer DEFAULT 600
)
RETURNS TABLE (
    outcome text,
    run_id uuid,
    assistant_message_id uuid,
    lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $fn$
DECLARE
    v_human public.store_assistant_messages%ROWTYPE;
    v_run public.store_assistant_panel_reply_runs%ROWTYPE;
    v_existing_count bigint;
    v_existing_id uuid;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND session_user <> 'postgres' THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_human_message_id IS NULL
       OR p_claim_token IS NULL
       OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 60 AND 900 THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_INVALID_INPUT'
            USING ERRCODE = '22023';
    END IF;

    SELECT m.*
    INTO v_human
    FROM public.store_assistant_messages m
    WHERE m.id = p_human_message_id
      AND m.organization_id = p_organization_id
      AND m.store_id = p_store_id
      AND m.sender = 'human'
      AND m.sender_role = 'store_responsible'
      AND m.direction = 'incoming'
      AND m.metadata ->> 'origin' = 'panel'
      AND EXISTS (
          SELECT 1
          FROM public.store_assistant_threads t
          WHERE t.id = m.thread_id
            AND t.organization_id = m.organization_id
            AND t.store_id = m.store_id
            AND t.thread_type = 'primary'
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_HUMAN_SCOPE_INVALID'
            USING ERRCODE = '42501';
    END IF;

    SELECT r.*
    INTO v_run
    FROM public.store_assistant_panel_reply_runs r
    WHERE r.organization_id = p_organization_id
      AND r.store_id = p_store_id
      AND r.human_message_id = p_human_message_id
    FOR UPDATE;

    -- Reconciliar resposta ja gravada pelo caminho anterior.
    -- Nunca criar uma segunda resposta historica.

    SELECT
        count(*),
        min(m.id::text)::uuid
    INTO
        v_existing_count,
        v_existing_id
    FROM public.store_assistant_messages m
    WHERE m.organization_id = p_organization_id
      AND m.store_id = p_store_id
      AND m.thread_id = v_human.thread_id
      AND (m.sender = 'assistant' OR m.sender_role = 'assistant_operational')
      AND m.direction = 'outgoing'
      AND m.metadata ->> 'source_external_message_id'
          = 'panel:' || p_human_message_id::text;

    IF v_existing_count > 1 THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_EXISTING_DUPLICATES'
            USING ERRCODE = '23514';
    END IF;

    IF v_existing_count = 1 THEN
        IF v_run.id IS NULL THEN
            INSERT INTO public.store_assistant_panel_reply_runs (
                organization_id,
                store_id,
                thread_id,
                human_message_id,
                assistant_message_id,
                status,
                claim_token
            )
            VALUES (
                p_organization_id,
                p_store_id,
                v_human.thread_id,
                p_human_message_id,
                v_existing_id,
                'confirmed',
                p_claim_token
            )
            RETURNING * INTO v_run;
        ELSE
            IF v_run.assistant_message_id IS NOT NULL
               AND v_run.assistant_message_id
                   IS DISTINCT FROM v_existing_id THEN
                RAISE EXCEPTION
                    'P19A_PANEL_REPLY_CONFLICT'
                    USING ERRCODE = '23514';
            END IF;

            UPDATE public.store_assistant_panel_reply_runs
            SET status = 'confirmed',
                assistant_message_id = v_existing_id,
                claim_token = p_claim_token,
                lease_expires_at = NULL,
                updated_at = clock_timestamp()
            WHERE id = v_run.id
            RETURNING * INTO v_run;
        END IF;

        RETURN QUERY
        SELECT
            'confirmed'::text,
            v_run.id,
            v_existing_id,
            NULL::timestamptz;
        RETURN;
    END IF;

    IF v_run.id IS NULL THEN
        INSERT INTO public.store_assistant_panel_reply_runs (
            organization_id,
            store_id,
            thread_id,
            human_message_id,
            status,
            claim_token,
            lease_expires_at
        )
        VALUES (
            p_organization_id,
            p_store_id,
            v_human.thread_id,
            p_human_message_id,
            'processing',
            p_claim_token,
            clock_timestamp()
                + make_interval(secs => p_lease_seconds)
        )
        RETURNING * INTO v_run;

        RETURN QUERY
        SELECT
            'claimed'::text,
            v_run.id,
            NULL::uuid,
            v_run.lease_expires_at;
        RETURN;
    END IF;

    IF v_run.status = 'confirmed' THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_CONFIRMED_MESSAGE_MISSING'
            USING ERRCODE = '23514';
    END IF;

    IF v_run.lease_expires_at > clock_timestamp() THEN
        RETURN QUERY
        SELECT
            'already_processing'::text,
            v_run.id,
            NULL::uuid,
            v_run.lease_expires_at;
        RETURN;
    END IF;

    -- Recuperacao apos lease expirado.
    -- O token anterior perde autoridade.

    UPDATE public.store_assistant_panel_reply_runs
    SET claim_token = p_claim_token,
        lease_expires_at = clock_timestamp()
            + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        updated_at = clock_timestamp()
    WHERE id = v_run.id
    RETURNING * INTO v_run;

    RETURN QUERY
    SELECT
        'claimed'::text,
        v_run.id,
        NULL::uuid,
        v_run.lease_expires_at;
END;
$fn$;

-- 3. Finalizacao atomica.
-- Reutiliza o writer existente sem alterar seu contrato.

CREATE FUNCTION public.finalize_assistant_panel_reply_by_system(
    p_run_id uuid,
    p_claim_token uuid,
    p_ai_text text,
    p_message_type text,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_related_lead_id uuid DEFAULT NULL,
    p_related_conversation_id uuid DEFAULT NULL,
    p_related_appointment_id uuid DEFAULT NULL
)
RETURNS TABLE (
    outcome text,
    assistant_message_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $fn$
DECLARE
    v_run public.store_assistant_panel_reply_runs%ROWTYPE;
    v_reply public.store_assistant_messages%ROWTYPE;
    v_existing_count bigint;
    v_existing_id uuid;
    v_existing_content text;
    v_existing_message_type text;
    v_metadata jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND session_user <> 'postgres' THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_run_id IS NULL
       OR p_claim_token IS NULL
       OR NULLIF(btrim(p_ai_text), '') IS NULL
       OR p_message_type IS NULL
       OR p_message_type NOT IN (
           'text', 'report_morning', 'report_evening',
           'alert', 'context', 'followup_summary',
           'image', 'audio', 'file'
       )
       OR jsonb_typeof(
           COALESCE(p_metadata, '{}'::jsonb)
       ) <> 'object' THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_INVALID_INPUT'
            USING ERRCODE = '22023';
    END IF;

    SELECT r.*
    INTO v_run
    FROM public.store_assistant_panel_reply_runs r
    WHERE r.id = p_run_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_run.claim_token IS DISTINCT FROM p_claim_token THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_CLAIM_INVALID'
            USING ERRCODE = '42501';
    END IF;

    IF v_run.status = 'confirmed' THEN
        SELECT m.content, m.message_type
        INTO v_existing_content, v_existing_message_type
        FROM public.store_assistant_messages m
        WHERE m.id = v_run.assistant_message_id
          AND m.organization_id = v_run.organization_id
          AND m.store_id = v_run.store_id
          AND m.thread_id = v_run.thread_id;

        IF NOT FOUND
           OR v_existing_content IS DISTINCT FROM btrim(p_ai_text)
           OR v_existing_message_type IS DISTINCT FROM p_message_type THEN
            RAISE EXCEPTION
                'P19A_PANEL_REPLY_REPLAY_CONFLICT'
                USING ERRCODE = '23514';
        END IF;

        RETURN QUERY
        SELECT
            'confirmed'::text,
            v_run.assistant_message_id;
        RETURN;
    END IF;

    IF v_run.status <> 'processing'
       OR v_run.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_CLAIM_EXPIRED'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.store_assistant_messages m
        WHERE m.id = v_run.human_message_id
          AND m.organization_id = v_run.organization_id
          AND m.store_id = v_run.store_id
          AND m.thread_id = v_run.thread_id
          AND m.sender = 'human'
          AND m.sender_role = 'store_responsible'
          AND m.direction = 'incoming'
          AND m.metadata ->> 'origin' = 'panel'
    ) THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_HUMAN_SCOPE_INVALID'
            USING ERRCODE = '42501';
    END IF;

    SELECT
        count(*),
        min(m.id::text)::uuid
    INTO
        v_existing_count,
        v_existing_id
    FROM public.store_assistant_messages m
    WHERE m.organization_id = v_run.organization_id
      AND m.store_id = v_run.store_id
      AND m.thread_id = v_run.thread_id
      AND (m.sender = 'assistant' OR m.sender_role = 'assistant_operational')
      AND m.direction = 'outgoing'
      AND m.metadata ->> 'source_external_message_id'
          = 'panel:' || v_run.human_message_id::text;

    IF v_existing_count > 1 THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_EXISTING_DUPLICATES'
            USING ERRCODE = '23514';
    END IF;

    IF v_existing_count = 1 THEN
        UPDATE public.store_assistant_panel_reply_runs
        SET status = 'confirmed',
            assistant_message_id = v_existing_id,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = v_run.id;

        RETURN QUERY
        SELECT 'confirmed'::text, v_existing_id;
        RETURN;
    END IF;

    v_metadata :=
        COALESCE(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
            'source_external_message_id',
            'panel:' || v_run.human_message_id::text,
            'organization_id',
            v_run.organization_id,
            'store_id',
            v_run.store_id
        );

    SELECT *
    INTO v_reply
    FROM public.assistant_push_system_message(
        v_run.organization_id,
        v_run.store_id,
        btrim(p_ai_text),
        p_message_type,
        p_related_lead_id,
        p_related_conversation_id,
        p_related_appointment_id,
        v_metadata
    );

    IF v_reply.id IS NULL
       OR v_reply.thread_id IS DISTINCT FROM v_run.thread_id
       OR v_reply.organization_id IS DISTINCT FROM v_run.organization_id
       OR v_reply.store_id IS DISTINCT FROM v_run.store_id THEN
        RAISE EXCEPTION
            'P19A_PANEL_REPLY_PERSISTENCE_MISMATCH'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.store_assistant_panel_reply_runs
    SET status = 'confirmed',
        assistant_message_id = v_reply.id,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_run.id;

    RETURN QUERY
    SELECT 'confirmed'::text, v_reply.id;
END;
$fn$;

-- 4. Permissoes exclusivas de backend.

REVOKE ALL ON FUNCTION
    public.claim_assistant_panel_reply_by_system(
        uuid, uuid, uuid, uuid, integer
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.claim_assistant_panel_reply_by_system(
        uuid, uuid, uuid, uuid, integer
    )
TO service_role;

REVOKE ALL ON FUNCTION
    public.finalize_assistant_panel_reply_by_system(
        uuid, uuid, text, text, jsonb, uuid, uuid, uuid
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.finalize_assistant_panel_reply_by_system(
        uuid, uuid, text, text, jsonb, uuid, uuid, uuid
    )
TO service_role;

COMMIT;
