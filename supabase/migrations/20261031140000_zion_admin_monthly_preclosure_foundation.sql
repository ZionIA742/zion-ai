-- ZION-ADM / 8-E.1
-- Fundacao do pre-fechamento mensal em duas fases.
--
-- Esta migration NAO cria fechamento definitivo.
-- NAO executa coleta OpenAI ou Meta.
-- NAO cria cron.
-- NAO altera mensalidades, despesas ou registros existentes.
-- Valores desconhecidos devem ser representados como null
-- nos snapshots futuros, nunca como zero presumido.
--
-- O pre-fechamento e um registro informativo.
-- A confirmacao financeira definitiva exigira outro fluxo,
-- validando as fontes e seus comprovantes.

BEGIN;

CREATE TABLE public.zion_admin_monthly_preclosures (
    month date PRIMARY KEY
        CHECK (EXTRACT(DAY FROM month) = 1),

    revision integer NOT NULL DEFAULT 1
        CHECK (revision >= 1),

    source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(source_snapshot) = 'object'),

    pending_sources text[] NOT NULL
        DEFAULT ARRAY[]::text[],

    preclosed_at timestamptz NOT NULL DEFAULT now(),

    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Historico separado para preservar cada revisao
-- do pre-fechamento antes do fechamento definitivo.

CREATE TABLE public.zion_admin_monthly_preclosure_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    month date NOT NULL
        REFERENCES public.zion_admin_monthly_preclosures(month),

    revision integer NOT NULL
        CHECK (revision >= 1),

    source_snapshot jsonb NOT NULL
        CHECK (jsonb_typeof(source_snapshot) = 'object'),

    pending_sources text[] NOT NULL,

    reason text NOT NULL
        CHECK (length(btrim(reason)) BETWEEN 1 AND 200),

    recorded_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (month, revision)
);

-- Apenas componentes administrativos autorizados
-- poderao ler estes registros.
-- Escritas serao feitas posteriormente por funcoes
-- controladas no servidor, com registro de auditoria.

ALTER TABLE public.zion_admin_monthly_preclosures
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.zion_admin_monthly_preclosure_audit
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_monthly_preclosures,
    public.zion_admin_monthly_preclosure_audit
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.zion_admin_monthly_preclosures,
    public.zion_admin_monthly_preclosure_audit
TO service_role;

COMMIT;