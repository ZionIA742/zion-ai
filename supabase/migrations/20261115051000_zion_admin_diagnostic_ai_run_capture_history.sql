-- ZION-ADM | Bloco 2 | 2.3-D.9-E
-- Historico independente das tentativas de captura.
-- Append-only no contrato de permissoes da aplicacao.
-- Sem erro bruto, mensagem, stack ou dados de clientes.
-- Nao cria cron, trigger ou funcao de processamento.

BEGIN;

CREATE TABLE public.zion_admin_diagnostic_ai_run_capture_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    source_run_id uuid NOT NULL
        REFERENCES public.zion_admin_diagnostic_ai_run_capture_attempts(
            source_run_id
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
    actor_user_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zadarh_event_kind_check CHECK (
        event_kind IN (
            'discovered',
            'attempt_started',
            'attempt_succeeded',
            'retry_scheduled',
            'needs_review',
            'no_longer_eligible',
            'manually_requeued'
        )
    ),

    CONSTRAINT zadarh_previous_state_check CHECK (
        previous_state IS NULL
        OR previous_state IN (
            'pending',
            'retryable_failed',
            'registered',
            'needs_review',
            'no_longer_eligible'
        )
    ),

    CONSTRAINT zadarh_new_state_check CHECK (
        new_state IS NULL
        OR new_state IN (
            'pending',
            'retryable_failed',
            'registered',
            'needs_review',
            'no_longer_eligible'
        )
    ),

    CONSTRAINT zadarh_attempts_check CHECK (
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

    CONSTRAINT zadarh_sqlstate_check CHECK (
        failure_sqlstate IS NULL
        OR failure_sqlstate ~ '^[0-9A-Z]{5}$'
    ),

    CONSTRAINT zadarh_failure_code_check CHECK (
        failure_code IS NULL
        OR failure_code IN (
            'source_not_found',
            'source_has_no_error',
            'scope_missing',
            'scope_invalid',
            'scope_conflict',
            'incident_lookup_failed',
            'occurrence_conflict',
            'writer_invalid_result',
            'database_transient',
            'database_other'
        )
    ),

    CONSTRAINT zadarh_actor_check CHECK (
        (
            actor_kind = 'system'
            AND actor_user_id IS NULL
        )
        OR
        (
            actor_kind = 'zion_admin'
            AND actor_user_id IS NOT NULL
        )
    )
);

CREATE INDEX zadarh_source_time_idx
ON public.zion_admin_diagnostic_ai_run_capture_history (
    source_run_id,
    created_at DESC,
    id
);

CREATE INDEX zadarh_event_time_idx
ON public.zion_admin_diagnostic_ai_run_capture_history (
    event_kind,
    created_at DESC
);

ALTER TABLE
    public.zion_admin_diagnostic_ai_run_capture_history
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_ai_run_capture_history
FORCE ROW LEVEL SECURITY;

-- Nenhum acesso direto pela API.
-- Futuras RPCs controladas farao a insercao.

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_ai_run_capture_history
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;