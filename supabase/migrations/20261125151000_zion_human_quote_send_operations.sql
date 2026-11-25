-- ZION: independent human quote delivery operations.
-- This migration creates persistence only.
-- No transport, worker, scheduler or commercial effects.
-- All future writes must use scoped database authorities.

CREATE TABLE public.human_quote_send_operations (
    operation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,

    operation_key text NOT NULL,
    request_fingerprint text NOT NULL,

    quote_id uuid NOT NULL,
    quote_version_id uuid NOT NULL,
    store_file_id uuid NOT NULL,
    source_quote_updated_at timestamptz NOT NULL,

    storage_bucket text NOT NULL,
    storage_path text NOT NULL,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,

    recipient_kind text NOT NULL,
    recipient_lead_id uuid,
    recipient_responsible_id uuid,
    destination_phone text NOT NULL,

    status text NOT NULL DEFAULT 'registered',
    status_reason text,

    external_message_id text,
    attempt_started_at timestamptz,
    provider_accepted_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT hqso_pkey
        PRIMARY KEY (
            organization_id,
            store_id,
            actor_user_id,
            operation_id
        ),

    CONSTRAINT hqso_operation_key_unique
        UNIQUE (operation_key),

    CONSTRAINT hqso_operation_id_chk
        CHECK (
            operation_id <>
                '00000000-0000-0000-0000-000000000000'::uuid
            AND actor_user_id <>
                '00000000-0000-0000-0000-000000000000'::uuid
        ),

    CONSTRAINT hqso_operation_key_chk
        CHECK (
            operation_key ~ '^human_quote_send:v1:[0-9a-f]{64}$'
        ),

    CONSTRAINT hqso_request_fingerprint_chk
        CHECK (
            request_fingerprint ~ '^[0-9a-f]{64}$'
        ),

    CONSTRAINT hqso_store_scope_fk
        FOREIGN KEY (
            store_id,
            organization_id
        )
        REFERENCES public.stores (
            id,
            organization_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT hqso_quote_scope_fk
        FOREIGN KEY (
            quote_id,
            organization_id,
            store_id
        )
        REFERENCES public.sales_quotes (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT hqso_version_scope_fk
        FOREIGN KEY (
            quote_version_id,
            quote_id,
            organization_id,
            store_id
        )
        REFERENCES public.sales_quote_versions (
            id,
            quote_id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT hqso_file_scope_fk
        FOREIGN KEY (
            store_file_id,
            organization_id,
            store_id
        )
        REFERENCES public.store_files (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT hqso_lead_scope_fk
        FOREIGN KEY (
            recipient_lead_id,
            organization_id,
            store_id
        )
        REFERENCES public.leads (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT hqso_responsible_scope_fk
        FOREIGN KEY (
            recipient_responsible_id,
            organization_id,
            store_id
        )
        REFERENCES public.store_responsibles (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT hqso_recipient_kind_chk
        CHECK (
            (
                recipient_kind = 'lead'
                AND recipient_lead_id IS NOT NULL
                AND recipient_responsible_id IS NULL
            )
            OR (
                recipient_kind = 'phone'
                AND recipient_lead_id IS NULL
                AND recipient_responsible_id IS NULL
            )
            OR (
                recipient_kind = 'responsible'
                AND recipient_lead_id IS NULL
                AND recipient_responsible_id IS NOT NULL
            )
        ),

    CONSTRAINT hqso_destination_phone_chk
        CHECK (
            destination_phone ~ '^[+][1-9][0-9]{7,14}$'
            AND destination_phone !~ '[[:cntrl:]]'
        ),

    CONSTRAINT hqso_pdf_bucket_chk
        CHECK (
            storage_bucket = 'zion-store-files'
        ),

    CONSTRAINT hqso_pdf_path_chk
        CHECK (
            storage_path ~ (
                '^' || organization_id::text ||
                '/' || store_id::text ||
                '/sales-quotes/' || quote_id::text ||
                '/(' ||
                '[A-Za-z0-9][A-Za-z0-9._-]*[.][pP][dD][fF]' ||
                '|operations/' ||
                '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-' ||
                '[0-9a-f]{4}-[0-9a-f]{12}[.]pdf' ||
                ')$'
            )
            AND position('..' IN storage_path) = 0
            AND storage_path !~ '[[:cntrl:]]'
        ),

    CONSTRAINT hqso_pdf_filename_chk
        CHECK (
            char_length(original_filename) <= 255
            AND original_filename ~
                '^[A-Za-z0-9][A-Za-z0-9._-]*[.][pP][dD][fF]$'
            AND position('..' IN original_filename) = 0
            AND original_filename !~ '[[:cntrl:]]'
        ),

    CONSTRAINT hqso_pdf_mime_chk
        CHECK (
            mime_type = 'application/pdf'
        ),

    CONSTRAINT hqso_pdf_size_chk
        CHECK (
            size_bytes > 0
            AND size_bytes <= 9007199254740991
        ),

    CONSTRAINT hqso_status_chk
        CHECK (
            status IN (
                'registered',
                'blocked',
                'attempt_started',
                'accepted',
                'failed',
                'uncertain'
            )
        ),

    CONSTRAINT hqso_status_reason_chk
        CHECK (
            status_reason IS NULL
            OR (
                status_reason ~ '^[A-Za-z0-9_:-]{1,160}$'
                AND status_reason !~ '[[:cntrl:]]'
            )
        ),

    CONSTRAINT hqso_external_id_chk
        CHECK (
            external_message_id IS NULL
            OR (
                char_length(external_message_id) BETWEEN 1 AND 512
                AND btrim(external_message_id) = external_message_id
                AND external_message_id !~ '[[:space:][:cntrl:]]'
            )
        ),

    CONSTRAINT hqso_state_consistency_chk
        CHECK (
            (
                status = 'registered'
                AND attempt_started_at IS NULL
                AND provider_accepted_at IS NULL
                AND external_message_id IS NULL
                AND status_reason IS NULL
            )
            OR (
                status = 'blocked'
                AND attempt_started_at IS NULL
                AND provider_accepted_at IS NULL
                AND external_message_id IS NULL
                AND status_reason IS NOT NULL
            )
            OR (
                status = 'attempt_started'
                AND attempt_started_at IS NOT NULL
                AND provider_accepted_at IS NULL
                AND external_message_id IS NULL
                AND status_reason IS NULL
            )
            OR (
                status = 'accepted'
                AND attempt_started_at IS NOT NULL
                AND provider_accepted_at IS NOT NULL
                AND external_message_id IS NOT NULL
                AND status_reason IS NULL
            )
            OR (
                status IN ('failed', 'uncertain')
                AND attempt_started_at IS NOT NULL
                AND provider_accepted_at IS NULL
                AND external_message_id IS NULL
                AND status_reason IS NOT NULL
            )
        ),

    CONSTRAINT hqso_timestamp_order_chk
        CHECK (
            updated_at >= created_at
            AND (
                attempt_started_at IS NULL
                OR (
                    attempt_started_at >= created_at
                    AND updated_at >= attempt_started_at
                )
            )
            AND (
                provider_accepted_at IS NULL
                OR (
                    provider_accepted_at >= attempt_started_at
                    AND updated_at >= provider_accepted_at
                )
            )
        )
);

CREATE INDEX hqso_quote_history_idx
    ON public.human_quote_send_operations (
        organization_id,
        store_id,
        quote_id,
        created_at DESC
    );

CREATE UNIQUE INDEX hqso_external_message_uidx
    ON public.human_quote_send_operations (
        external_message_id
    )
    WHERE external_message_id IS NOT NULL;

ALTER TABLE public.human_quote_send_operations
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.human_quote_send_operations
    FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
    ON TABLE public.human_quote_send_operations
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.human_quote_send_operations IS
    'Private scoped ledger of explicit human quote delivery operations. No direct API-role access and no automatic commercial effects.';

COMMENT ON COLUMN public.human_quote_send_operations.actor_user_id IS
    'Historical authenticated actor identity. Active membership must be verified by the registration authority.';

COMMENT ON COLUMN public.human_quote_send_operations.destination_phone IS
    'Explicit canonical international recipient snapshot, revalidated before transport.';

COMMENT ON COLUMN public.human_quote_send_operations.status IS
    'Registered is not sent. Accepted means provider acceptance, not customer delivery or CRM finalization.';

COMMENT ON COLUMN public.human_quote_send_operations.attempt_started_at IS
    'Persist before any provider POST. An interrupted attempt must not be blindly retried.';
