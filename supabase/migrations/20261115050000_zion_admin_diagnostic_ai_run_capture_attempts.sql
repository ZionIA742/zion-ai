-- ZION-ADM | Bloco 2 | 2.3-D.9-B
-- Controle independente de tentativas do coletor.
-- Nenhuma captura automatica, cron ou trigger.
-- Nenhuma mensagem ou erro bruto armazenado.

BEGIN;

CREATE TABLE public.zion_admin_diagnostic_ai_run_capture_attempts (
    source_run_id uuid PRIMARY KEY,

    state text NOT NULL DEFAULT 'pending',

    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,

    next_attempt_at timestamptz
        DEFAULT now(),

    last_sqlstate text,
    last_failure_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zadarca_state_check CHECK (
        state IN (
            'pending',
            'retryable_failed',
            'registered',
            'needs_review',
            'no_longer_eligible'
        )
    ),

    CONSTRAINT zadarca_attempts_check CHECK (
        attempt_count >= 0
        AND max_attempts BETWEEN 1 AND 10
        AND attempt_count <= max_attempts
    ),

    CONSTRAINT zadarca_schedule_check CHECK (
        (
            state IN ('pending', 'retryable_failed')
            AND next_attempt_at IS NOT NULL
        )
        OR
        (
            state IN (
                'registered',
                'needs_review',
                'no_longer_eligible'
            )
            AND next_attempt_at IS NULL
        )
    ),

    CONSTRAINT zadarca_result_check CHECK (
        state NOT IN ('registered', 'needs_review')
        OR attempt_count > 0
    ),

    CONSTRAINT zadarca_sqlstate_check CHECK (
        last_sqlstate IS NULL
        OR last_sqlstate ~ '^[0-9A-Z]{5}$'
    )
);

CREATE INDEX zadarca_ready_idx
ON public.zion_admin_diagnostic_ai_run_capture_attempts (
    next_attempt_at,
    created_at,
    source_run_id
)
WHERE state IN ('pending', 'retryable_failed');

CREATE INDEX zadarca_review_idx
ON public.zion_admin_diagnostic_ai_run_capture_attempts (
    last_failure_at DESC,
    source_run_id
)
WHERE state = 'needs_review';

ALTER TABLE
    public.zion_admin_diagnostic_ai_run_capture_attempts
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_ai_run_capture_attempts
FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_ai_run_capture_attempts
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE
    public.zion_admin_diagnostic_ai_run_capture_attempts
TO service_role;

COMMIT;