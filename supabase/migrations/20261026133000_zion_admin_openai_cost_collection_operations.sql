-- ZION-ADM 8-C.4-A
-- Operacoes persistentes e auditoria de coletas OpenAI
-- Migration: 20261026133000_zion_admin_openai_cost_collection_operations.sql
-- Somente estrutura. Sem jobs, cron ou chamadas reais.

BEGIN;

CREATE TABLE public.zion_admin_openai_cost_collection_operations (
    id uuid PRIMARY KEY
        DEFAULT pg_catalog.gen_random_uuid(),

    operation_key text NOT NULL UNIQUE,

    provider text NOT NULL DEFAULT 'openai',
    source text NOT NULL DEFAULT 'openai_organization_costs',

    query_identity text NOT NULL,
    query_parameters jsonb NOT NULL,

    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,

    state text NOT NULL DEFAULT 'pending',

    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    next_attempt_at timestamptz
        DEFAULT pg_catalog.clock_timestamp(),

    claim_token uuid,
    claim_expires_at timestamptz,
    claimed_by text,

    snapshot_collection_id uuid
        REFERENCES public.zion_admin_provider_cost_collections(id)
        ON DELETE RESTRICT,

    supersedes_operation_id uuid
        REFERENCES public.zion_admin_openai_cost_collection_operations(id)
        ON DELETE RESTRICT,

    last_error_code text,
    last_error_at timestamptz,

    created_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    updated_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    confirmed_at timestamptz,

    CONSTRAINT zaocco_key_check CHECK (
        pg_catalog.length(pg_catalog.btrim(operation_key))
        BETWEEN 1 AND 1024
    ),

    CONSTRAINT zaocco_provider_check CHECK (
        provider = 'openai'
        AND source = 'openai_organization_costs'
    ),

    CONSTRAINT zaocco_query_check CHECK (
        pg_catalog.length(pg_catalog.btrim(query_identity)) > 0
        AND pg_catalog.jsonb_typeof(query_parameters) = 'object'
    ),

    CONSTRAINT zaocco_period_check CHECK (
        period_end > period_start
    ),

    CONSTRAINT zaocco_state_check CHECK (
        state IN (
            'pending',
            'processing',
            'confirmed',
            'retryable_failed',
            'permanent_failed',
            'uncertain'
        )
    ),

    CONSTRAINT zaocco_attempts_check CHECK (
        attempt_count >= 0
        AND max_attempts BETWEEN 1 AND 10
        AND attempt_count <= max_attempts
    ),

    CONSTRAINT zaocco_claim_check CHECK (
        (
            state = 'processing'
            AND claim_token IS NOT NULL
            AND claim_expires_at IS NOT NULL
            AND claimed_by IS NOT NULL
            AND attempt_count > 0
        )
        OR
        (
            state <> 'processing'
            AND claim_token IS NULL
            AND claim_expires_at IS NULL
            AND claimed_by IS NULL
        )
    ),

    CONSTRAINT zaocco_schedule_check CHECK (
        state NOT IN ('pending', 'retryable_failed')
        OR next_attempt_at IS NOT NULL
    ),

    CONSTRAINT zaocco_confirmation_check CHECK (
        (
            state = 'confirmed'
            AND snapshot_collection_id IS NOT NULL
            AND confirmed_at IS NOT NULL
        )
        OR
        (
            state <> 'confirmed'
            AND snapshot_collection_id IS NULL
            AND confirmed_at IS NULL
        )
    ),

    CONSTRAINT zaocco_supersedes_check CHECK (
        supersedes_operation_id IS NULL
        OR supersedes_operation_id <> id
    )
);

-- Operacoes elegiveis para o proximo claim.

CREATE INDEX zaocco_due_idx
ON public.zion_admin_openai_cost_collection_operations (
    next_attempt_at,
    created_at
)
WHERE state IN ('pending', 'retryable_failed');

-- Leases expirados para reconciliacao.

CREATE INDEX zaocco_expired_lease_idx
ON public.zion_admin_openai_cost_collection_operations (
    claim_expires_at
)
WHERE state = 'processing';

-- Consultas historicas e reconsultas do provedor.

CREATE INDEX zaocco_query_history_idx
ON public.zion_admin_openai_cost_collection_operations (
    query_identity,
    created_at DESC
);

CREATE INDEX zaocco_snapshot_idx
ON public.zion_admin_openai_cost_collection_operations (
    snapshot_collection_id
)
WHERE snapshot_collection_id IS NOT NULL;

-- Historico append-only das transicoes operacionais.

CREATE TABLE public.zion_admin_openai_cost_collection_operation_events (
    id uuid PRIMARY KEY
        DEFAULT pg_catalog.gen_random_uuid(),

    operation_id uuid NOT NULL
        REFERENCES public.zion_admin_openai_cost_collection_operations(id)
        ON DELETE RESTRICT,

    event_kind text NOT NULL,

    from_state text,
    to_state text NOT NULL,

    attempt_count integer NOT NULL,

    occurred_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    error_code text,

    snapshot_collection_id uuid
        REFERENCES public.zion_admin_provider_cost_collections(id)
        ON DELETE RESTRICT,

    technical_actor text NOT NULL,

    CONSTRAINT zaoccoe_kind_check CHECK (
        pg_catalog.length(pg_catalog.btrim(event_kind))
        BETWEEN 1 AND 64
    ),

    CONSTRAINT zaoccoe_attempt_check CHECK (
        attempt_count >= 0
    ),

    CONSTRAINT zaoccoe_state_check CHECK (
        (from_state IS NULL OR from_state IN (
            'pending',
            'processing',
            'confirmed',
            'retryable_failed',
            'permanent_failed',
            'uncertain'
        ))
        AND to_state IN (
            'pending',
            'processing',
            'confirmed',
            'retryable_failed',
            'permanent_failed',
            'uncertain'
        )
    ),

    CONSTRAINT zaoccoe_actor_check CHECK (
        pg_catalog.length(
            pg_catalog.btrim(technical_actor)
        ) BETWEEN 1 AND 128
    )
);

CREATE INDEX zaoccoe_history_idx
ON public.zion_admin_openai_cost_collection_operation_events (
    operation_id,
    occurred_at,
    id
);

-- Eventos de auditoria nao podem ser reescritos ou excluidos.

CREATE FUNCTION
public.zion_admin_refuse_openai_cost_operation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'ZION_ADMIN_OPENAI_COST_OPERATION_EVENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER zaoccoe_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_openai_cost_collection_operation_events
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_refuse_openai_cost_operation_event_mutation();

-- RLS e isolamento das tabelas operacionais.

ALTER TABLE
public.zion_admin_openai_cost_collection_operations
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
public.zion_admin_openai_cost_collection_operation_events
ENABLE ROW LEVEL SECURITY;

-- Nenhuma permissao direta para o navegador
-- nem para o cliente service_role.
-- A etapa seguinte criara RPCs de servico especificas.

REVOKE ALL ON TABLE
    public.zion_admin_openai_cost_collection_operations,
    public.zion_admin_openai_cost_collection_operation_events
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
public.zion_admin_refuse_openai_cost_operation_event_mutation()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Verificacao somente leitura depois da criacao.

SELECT
    '01_operations_table' AS verificacao,
    CASE WHEN pg_catalog.to_regclass(
        'public.zion_admin_openai_cost_collection_operations'
    ) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS resultado

UNION ALL

SELECT
    '02_operation_events',
    CASE WHEN pg_catalog.to_regclass(
        'public.zion_admin_openai_cost_collection_operation_events'
    ) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
    '03_rls_enabled',
    CASE WHEN (
        SELECT count(*)
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'zion_admin_openai_cost_collection_operations',
            'zion_admin_openai_cost_collection_operation_events'
          )
          AND c.relrowsecurity
    ) = 2 THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
    '04_audit_immutable',
    CASE WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger
        WHERE tgname = 'zaoccoe_immutable'
          AND tgenabled = 'O'
          AND NOT tgisinternal
    ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
    '05_no_operations_created',
    CASE WHEN NOT EXISTS (
        SELECT 1
        FROM public.zion_admin_openai_cost_collection_operations
    ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT
    '06_no_events_created',
    CASE WHEN NOT EXISTS (
        SELECT 1
        FROM public.zion_admin_openai_cost_collection_operation_events
    ) THEN 'PASS' ELSE 'FAIL' END

ORDER BY verificacao;
