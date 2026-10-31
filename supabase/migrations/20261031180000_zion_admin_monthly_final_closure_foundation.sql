-- ZION-ADM / 8-E.11-B
-- Fundacao independente do fechamento financeiro definitivo.
--
-- NAO realiza fechamento.
-- NAO confirma faturas ou pagamentos.
-- NAO modifica o fechamento legado.
-- NAO altera cron, OpenAI, Meta ou pre-fechamentos.
--
-- A futura RPC devera validar todas as fontes financeiras
-- e comprovantes reais antes de autorizar a gravacao.

BEGIN;

CREATE TABLE public.zion_admin_monthly_final_closures (
    month date PRIMARY KEY
        CHECK (EXTRACT(DAY FROM month) = 1),

    revision integer NOT NULL DEFAULT 1
        CHECK (revision >= 1),

    preclosure_revision integer NOT NULL
        CHECK (preclosure_revision >= 1),

    final_snapshot jsonb NOT NULL
        CHECK (jsonb_typeof(final_snapshot) = 'object'),

    evidence_snapshot jsonb NOT NULL
        CHECK (jsonb_typeof(evidence_snapshot) = 'object'),

    pending_sources text[] NOT NULL
        DEFAULT ARRAY[]::text[]
        CHECK (cardinality(pending_sources) = 0),

    finalized_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zion_admin_final_closure_preclosure_fk
        FOREIGN KEY (month, preclosure_revision)
        REFERENCES public.zion_admin_monthly_preclosure_audit
            (month, revision),

    CONSTRAINT zion_admin_final_closure_revision_unique
        UNIQUE (month, revision)
);

-- Historico das versoes e respectivos comprovantes.
-- Ajustes futuros exigirao fluxo autorizado e auditado.
-- Nenhuma RPC de ajuste e criada nesta migration.

CREATE TABLE public.zion_admin_monthly_final_closure_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    month date NOT NULL
        REFERENCES public.zion_admin_monthly_final_closures(month),

    revision integer NOT NULL
        CHECK (revision >= 1),

    preclosure_revision integer NOT NULL
        CHECK (preclosure_revision >= 1),

    final_snapshot jsonb NOT NULL
        CHECK (jsonb_typeof(final_snapshot) = 'object'),

    evidence_snapshot jsonb NOT NULL
        CHECK (jsonb_typeof(evidence_snapshot) = 'object'),

    reason text NOT NULL
        CHECK (length(btrim(reason)) BETWEEN 1 AND 200),

    recorded_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zion_admin_final_closure_audit_unique
        UNIQUE (month, revision),

    CONSTRAINT zion_admin_final_closure_audit_preclosure_fk
        FOREIGN KEY (month, preclosure_revision)
        REFERENCES public.zion_admin_monthly_preclosure_audit
            (month, revision)
);

-- Acesso administrativo controlado.
-- Sem permissao de INSERT, UPDATE ou DELETE
-- para os papeis utilizados pelas aplicacoes.

ALTER TABLE public.zion_admin_monthly_final_closures
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.zion_admin_monthly_final_closure_audit
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_monthly_final_closures,
    public.zion_admin_monthly_final_closure_audit
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.zion_admin_monthly_final_closures,
    public.zion_admin_monthly_final_closure_audit
TO service_role;

COMMIT;