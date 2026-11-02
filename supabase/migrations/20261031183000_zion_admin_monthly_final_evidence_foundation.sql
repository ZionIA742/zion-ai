-- ZION-ADM / 8-E.11-D.1
-- Registro protegido das evidencias financeiras.
--
-- Nao cria comprovantes automaticamente.
-- Nao permite gravacao direta pela aplicacao.
-- Nao executa fechamento definitivo.
-- Nao modifica o fechamento legado.
-- Nao altera o cron de pre-fechamento.
--
-- A futura RPC verificara:
-- 1. Identidade e permissao administrativa.
-- 2. Existencia e integridade do documento.
-- 3. Correspondencia com a fonte financeira real.
-- 4. Competencia e revisao do pre-fechamento.
-- 5. Coerencia dos valores e moedas.
--
-- Somente apos essas verificacoes a RPC podera
-- registrar uma evidencia verificada nesta tabela.

BEGIN;

CREATE TABLE public.zion_admin_monthly_final_evidence (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    month date NOT NULL
        CHECK (EXTRACT(DAY FROM month) = 1),

    preclosure_revision integer NOT NULL
        CHECK (preclosure_revision >= 1),

    source text NOT NULL
        CHECK (source IN (
            'fixed_costs',
            'manual_expenses',
            'openai_invoice',
            'meta_invoice'
        )),

    proof_type text NOT NULL,

    document_reference text NOT NULL
        CHECK (
            length(btrim(document_reference))
            BETWEEN 3 AND 512
        ),

    document_sha256 text NOT NULL
        CHECK (
            document_sha256 ~ '^[0-9a-f]{64}$'
        ),

    amount_brl_cents bigint
        CHECK (
            amount_brl_cents IS NULL
            OR amount_brl_cents >= 0
        ),

    amount_usd numeric(20,8)
        CHECK (
            amount_usd IS NULL
            OR amount_usd >= 0
        ),

    verification_method text NOT NULL
        CHECK (verification_method IN (
            'manual_document_review',
            'official_provider_reconciliation'
        )),

    verified_by_user_id uuid NOT NULL,

    verified_at timestamptz NOT NULL,

    recorded_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zion_admin_final_evidence_amount_required
        CHECK (
            amount_brl_cents IS NOT NULL
            OR amount_usd IS NOT NULL
        ),

    CONSTRAINT zion_admin_final_evidence_proof_type_valid
        CHECK (
            (
                source = 'fixed_costs'
                AND proof_type IN (
                    'supplier_invoice',
                    'supplier_statement',
                    'expense_receipt',
                    'internal_reconciliation'
                )
            )
            OR
            (
                source = 'manual_expenses'
                AND proof_type IN (
                    'expense_receipt',
                    'internal_reconciliation'
                )
            )
            OR
            (
                source IN (
                    'openai_invoice',
                    'meta_invoice'
                )
                AND proof_type IN (
                    'supplier_invoice',
                    'supplier_statement'
                )
            )
        ),

    CONSTRAINT zion_admin_final_evidence_preclosure_fk
        FOREIGN KEY (month, preclosure_revision)
        REFERENCES public.zion_admin_monthly_preclosure_audit
            (month, revision),

    CONSTRAINT zion_admin_final_evidence_actor_fk
        FOREIGN KEY (verified_by_user_id)
        REFERENCES auth.users(id),

    CONSTRAINT zion_admin_final_evidence_document_unique
        UNIQUE (
            month,
            preclosure_revision,
            source,
            document_sha256
        )
);

-- Nenhum acesso direto para usuarios e aplicacoes.
-- A futura gravacao dependera de uma RPC protegida.

ALTER TABLE public.zion_admin_monthly_final_evidence
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_monthly_final_evidence
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.zion_admin_monthly_final_evidence
TO service_role;

COMMIT;