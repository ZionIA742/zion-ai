-- ZION-ADM | Bloco 2 | Processamento operacional
-- Dependencias: baseline, eventos e writer operacional.
-- Estrutura somente; nao ativa processamento.
-- Nunca armazenar mensagens, payloads ou erros brutos.

BEGIN;

CREATE TABLE public.zion_admin_diagnostic_operational_capture_attempts (
    event_id uuid PRIMARY KEY
        REFERENCES public.zion_admin_diagnostic_operational_failure_events(id)
        ON DELETE RESTRICT,

    state text NOT NULL DEFAULT 'pending',

    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,

    next_attempt_at timestamptz
        DEFAULT pg_catalog.clock_timestamp(),

    last_sqlstate text,
    last_failure_code text,
    last_failure_at timestamptz,

    created_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    updated_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT zadoa_state_check CHECK (
        state IN (
            'pending',
            'retryable_failed',
            'registered',
            'needs_review',
            'no_longer_eligible'
        )
    ),

    CONSTRAINT zadoa_attempts_check CHECK (
        attempt_count >= 0
        AND max_attempts BETWEEN 1 AND 10
        AND attempt_count <= max_attempts
    ),

    CONSTRAINT zadoa_schedule_check CHECK (
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

    CONSTRAINT zadoa_result_check CHECK (
        state NOT IN ('registered', 'needs_review')
        OR attempt_count > 0
    ),

    CONSTRAINT zadoa_sqlstate_check CHECK (
        last_sqlstate IS NULL
        OR last_sqlstate ~ '^[0-9A-Z]{5}$'
    ),

    CONSTRAINT zadoa_failure_code_check CHECK (
        last_failure_code IS NULL
        OR last_failure_code ~ '^[a-z0-9_]{1,80}$'
    )
);

CREATE INDEX zadoa_ready_idx
ON public.zion_admin_diagnostic_operational_capture_attempts (
    next_attempt_at,
    created_at,
    event_id
)
WHERE state IN ('pending', 'retryable_failed');

CREATE INDEX zadoa_review_idx
ON public.zion_admin_diagnostic_operational_capture_attempts (
    last_failure_at DESC,
    event_id
)
WHERE state = 'needs_review';

CREATE TABLE public.zion_admin_diagnostic_operational_capture_history (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),

    event_id uuid NOT NULL
        REFERENCES public.zion_admin_diagnostic_operational_capture_attempts(
            event_id
        )
        ON DELETE RESTRICT,

    event_kind text NOT NULL,
    previous_state text,
    new_state text,

    attempt_count_before integer,
    attempt_count_after integer,

    failure_sqlstate text,
    failure_code text,

    actor_kind text NOT NULL DEFAULT 'system',

    created_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT zadoh_event_kind_check CHECK (
        event_kind IN (
            'discovered',
            'attempt_started',
            'attempt_succeeded',
            'retry_scheduled',
            'needs_review',
            'no_longer_eligible',
            'manual_requeued'
        )
    ),

    CONSTRAINT zadoh_previous_state_check CHECK (
        previous_state IS NULL
        OR previous_state IN (
            'pending',
            'retryable_failed',
            'registered',
            'needs_review',
            'no_longer_eligible'
        )
    ),

    CONSTRAINT zadoh_new_state_check CHECK (
        new_state IS NULL
        OR new_state IN (
            'pending',
            'retryable_failed',
            'registered',
            'needs_review',
            'no_longer_eligible'
        )
    ),

    CONSTRAINT zadoh_attempt_counts_check CHECK (
        (
            attempt_count_before IS NULL
            OR attempt_count_before BETWEEN 0 AND 10
        )
        AND
        (
            attempt_count_after IS NULL
            OR attempt_count_after BETWEEN 0 AND 10
        )
    ),

    CONSTRAINT zadoh_failure_sqlstate_check CHECK (
        failure_sqlstate IS NULL
        OR failure_sqlstate ~ '^[0-9A-Z]{5}$'
    ),

    CONSTRAINT zadoh_failure_code_check CHECK (
        failure_code IS NULL
        OR failure_code ~ '^[a-z0-9_]{1,80}$'
    ),

    CONSTRAINT zadoh_actor_check CHECK (
        actor_kind IN ('system', 'administrator')
    )
);

CREATE INDEX zadoh_event_time_idx
ON public.zion_admin_diagnostic_operational_capture_history (
    event_id,
    created_at DESC
);

CREATE INDEX zadoh_kind_time_idx
ON public.zion_admin_diagnostic_operational_capture_history (
    event_kind,
    created_at DESC
);

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_attempts
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_attempts
FORCE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_history
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_history
FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_operational_capture_attempts,
    public.zion_admin_diagnostic_operational_capture_history
FROM PUBLIC, anon, authenticated, service_role;

-- Acesso indireto, exclusivamente pelas futuras
-- funcoes SECURITY DEFINER com verificacao de role.
-- Nenhum worker, cron ou trigger criado nesta etapa.

COMMIT;