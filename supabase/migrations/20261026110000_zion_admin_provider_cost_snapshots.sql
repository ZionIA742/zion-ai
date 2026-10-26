-- ZION-ADM / 8-C
-- Ledger de coletas financeiras dos provedores
-- Migration: 20261026110000_zion_admin_provider_cost_snapshots.sql
-- Nao altera os fechamentos existentes.

BEGIN;

CREATE TABLE public.zion_admin_provider_cost_collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    collection_key text NOT NULL UNIQUE,
    provider text NOT NULL,
    source text NOT NULL,
    query_identity text NOT NULL,

    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,

    provider_timezone text NOT NULL DEFAULT 'UTC',

    status text NOT NULL,
    result_count integer NOT NULL DEFAULT 0,

    query_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,

    error_code text,

    collected_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zapcc_provider_check
        CHECK (
            provider IN (
                'openai',
                'meta',
                'vercel',
                'supabase'
            )
        ),

    CONSTRAINT zapcc_status_check
        CHECK (
            status IN (
                'available',
                'confirmed_empty',
                'partial',
                'unavailable',
                'failed'
            )
        ),

    CONSTRAINT zapcc_period_check
        CHECK (period_end > period_start),

    CONSTRAINT zapcc_result_count_check
        CHECK (result_count >= 0),

    CONSTRAINT zapcc_timezone_check
        CHECK (char_length(provider_timezone) > 0),

    CONSTRAINT zapcc_empty_check
        CHECK (
            status <> 'confirmed_empty'
            OR result_count = 0
        )
);

CREATE INDEX zapcc_provider_period_idx
ON public.zion_admin_provider_cost_collections (
    provider,
    period_start,
    period_end,
    collected_at DESC
);

CREATE INDEX zapcc_query_idx
ON public.zion_admin_provider_cost_collections (
    query_identity,
    collected_at DESC
);


CREATE TABLE public.zion_admin_provider_cost_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    collection_id uuid NOT NULL
        REFERENCES public.zion_admin_provider_cost_collections(id)
        ON DELETE RESTRICT,

    provider_line_identity text NOT NULL,
    provider_version_fingerprint text NOT NULL,

    provider_page integer NOT NULL,
    provider_result_index integer NOT NULL,

    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,

    currency text NOT NULL,

    amount_numeric numeric NOT NULL,
    amount_decimal_text text NOT NULL,

    project_id text,
    user_id text,
    line_item text,
    api_key_id text,
    api_source text,

    quantity numeric,
    quantity_unit text,

    provider_bucket_object text,
    provider_result_object text,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zapcl_period_check
        CHECK (period_end > period_start),

    CONSTRAINT zapcl_currency_check
        CHECK (currency ~ '^[A-Z]{3}$'),

    CONSTRAINT zapcl_position_check
        CHECK (
            provider_page >= 0
            AND provider_result_index >= 0
        ),

    CONSTRAINT zapcl_line_identity_unique
        UNIQUE (
            collection_id,
            provider_line_identity,
            provider_version_fingerprint
        ),

    CONSTRAINT zapcl_position_unique
        UNIQUE (
            collection_id,
            provider_page,
            provider_result_index
        )
);

CREATE INDEX zapcl_period_idx
ON public.zion_admin_provider_cost_lines (
    period_start,
    period_end
);

CREATE INDEX zapcl_collection_idx
ON public.zion_admin_provider_cost_lines (
    collection_id
);


-- Registros financeiros imutaveis.
-- Uma nova consulta produz novo snapshot;
-- nao reescreve silenciosamente o anterior.

CREATE FUNCTION
public.zion_admin_refuse_provider_cost_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'PROVIDER_COST_SNAPSHOT_IMMUTABLE';
END;
$$;

CREATE TRIGGER zapcc_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_provider_cost_collections
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_refuse_provider_cost_snapshot_mutation();

CREATE TRIGGER zapcl_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_provider_cost_lines
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_refuse_provider_cost_snapshot_mutation();


-- Seguranca administrativa.

ALTER TABLE
public.zion_admin_provider_cost_collections
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
public.zion_admin_provider_cost_lines
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_provider_cost_collections,
    public.zion_admin_provider_cost_lines
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE
    public.zion_admin_provider_cost_collections,
    public.zion_admin_provider_cost_lines
TO service_role;

REVOKE ALL ON FUNCTION
public.zion_admin_refuse_provider_cost_snapshot_mutation()
FROM PUBLIC, anon, authenticated;

COMMIT;
