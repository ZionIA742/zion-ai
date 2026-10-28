BEGIN;

CREATE TABLE public.p19a_quote_preparation_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    commercial_opportunity_id uuid NOT NULL,
    request_message_id uuid NOT NULL,

    profile_version_id uuid NOT NULL,
    profile_version_number integer NOT NULL,

    operation_key text NOT NULL,
    request_fingerprint text NOT NULL,

    status text NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0,

    locked_at timestamptz,
    locked_by text,
    claim_token uuid,
    lease_expires_at timestamptz,

    confirmation_message_id uuid,

    last_error_code text,
    last_error_message text,

    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,

    CONSTRAINT p19a_quote_prep_profile_number_chk
        CHECK (profile_version_number > 0),

    CONSTRAINT p19a_quote_prep_operation_key_chk
        CHECK (
            operation_key = btrim(operation_key)
            AND length(operation_key) BETWEEN 1 AND 200
        ),

    CONSTRAINT p19a_quote_prep_fingerprint_chk
        CHECK (
            length(request_fingerprint) = 64
            AND request_fingerprint ~ '^[0-9a-f]{64}$'
        ),

    CONSTRAINT p19a_quote_prep_status_chk
        CHECK (
            status IN (
                'queued',
                'processing',
                'blocked',
                'failed',
                'uncertain',
                'completed'
            )
        ),

    CONSTRAINT p19a_quote_prep_attempts_chk
        CHECK (attempts >= 0),

    CONSTRAINT p19a_quote_prep_store_fk
        FOREIGN KEY (store_id, organization_id)
        REFERENCES public.stores (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT p19a_quote_prep_lead_fk
        FOREIGN KEY (lead_id, organization_id, store_id)
        REFERENCES public.leads (id, organization_id, store_id)
        ON DELETE RESTRICT,

    CONSTRAINT p19a_quote_prep_conversation_fk
        FOREIGN KEY (conversation_id, organization_id)
        REFERENCES public.conversations (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT p19a_quote_prep_opportunity_fk
        FOREIGN KEY (
            commercial_opportunity_id,
            organization_id,
            store_id
        )
        REFERENCES public.commercial_opportunities (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT p19a_quote_prep_profile_fk
        FOREIGN KEY (
            profile_version_id,
            organization_id,
            store_id,
            commercial_opportunity_id
        )
        REFERENCES public.commercial_opportunity_profile_versions (
            id,
            organization_id,
            store_id,
            commercial_opportunity_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT p19a_quote_prep_request_msg_fk
        FOREIGN KEY (
            request_message_id,
            organization_id,
            store_id
        )
        REFERENCES public.messages (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT p19a_quote_prep_confirm_msg_fk
        FOREIGN KEY (
            confirmation_message_id,
            organization_id,
            store_id
        )
        REFERENCES public.messages (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX p19a_quote_prep_operation_uidx
ON public.p19a_quote_preparation_operations (
    organization_id,
    store_id,
    operation_key
);

CREATE UNIQUE INDEX p19a_quote_prep_request_msg_uidx
ON public.p19a_quote_preparation_operations (
    organization_id,
    store_id,
    request_message_id
);

CREATE UNIQUE INDEX p19a_quote_prep_active_opp_uidx
ON public.p19a_quote_preparation_operations (
    organization_id,
    store_id,
    commercial_opportunity_id
)
WHERE status IN ('queued', 'processing', 'uncertain');

CREATE INDEX p19a_quote_prep_status_created_idx
ON public.p19a_quote_preparation_operations (
    status,
    created_at
);

CREATE INDEX p19a_quote_prep_lease_idx
ON public.p19a_quote_preparation_operations (
    lease_expires_at
)
WHERE status = 'processing';

ALTER TABLE public.p19a_quote_preparation_operations
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.p19a_quote_preparation_operations
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.p19a_quote_preparation_operations
TO service_role;

COMMIT;
