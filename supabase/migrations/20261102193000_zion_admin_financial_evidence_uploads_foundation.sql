-- ZION-ADM / 8-E.11-D.2-C.2
-- Registro de documentos financeiros enviados.
--
-- FUNDACAO ESTRUTURAL:
-- Nao cria autoridade de escrita.
-- Nao aprova comprovantes.
-- Nao altera evidencias verificadas.
-- Nao habilita fechamento definitivo.

BEGIN;

DO $$
BEGIN
    IF to_regclass(
        'public.zion_admin_financial_evidence_uploads'
    ) IS NOT NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINANCIAL_UPLOADS_ALREADY_EXISTS';
    END IF;

    IF to_regclass(
        'public.zion_admin_monthly_preclosure_audit'
    ) IS NULL THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_AUDIT_NOT_FOUND';
    END IF;
END;
$$;

CREATE TABLE public.zion_admin_financial_evidence_uploads (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    month date NOT NULL
        CHECK (EXTRACT(DAY FROM month) = 1),

    preclosure_revision integer NOT NULL
        CHECK (preclosure_revision >= 1),

    source text NOT NULL
        CHECK (
            source IN (
                'fixed_costs',
                'manual_expenses',
                'openai_invoice',
                'meta_invoice'
            )
        ),

    storage_bucket text NOT NULL
        DEFAULT 'zion-admin-financial-evidence'
        CHECK (
            storage_bucket =
                'zion-admin-financial-evidence'
        ),

    storage_path text NOT NULL,

    document_sha256 text NOT NULL
        CHECK (
            document_sha256 ~ '^[0-9a-f]{64}$'
        ),

    mime_type text NOT NULL
        CHECK (
            mime_type IN (
                'application/pdf',
                'image/png',
                'image/jpeg'
            )
        ),

    size_bytes bigint NOT NULL
        CHECK (
            size_bytes BETWEEN 1 AND 10485760
        ),

    uploaded_by_user_id uuid NOT NULL
        REFERENCES auth.users(id),

    uploaded_at timestamptz NOT NULL
        DEFAULT now(),

    CONSTRAINT zion_admin_fin_upload_preclosure_fk
        FOREIGN KEY (
            month,
            preclosure_revision
        )
        REFERENCES public.zion_admin_monthly_preclosure_audit(
            month,
            revision
        ),

    CONSTRAINT zion_admin_fin_upload_path_unique
        UNIQUE (
            storage_bucket,
            storage_path
        ),

    CONSTRAINT zion_admin_fin_upload_path_valid
        CHECK (
            storage_path ~ (
                '^unverified/'
                || month::text
                || '/'
                || preclosure_revision::text
                || '/'
                || source
                || '/[0-9a-f]{8}-[0-9a-f]{4}-'
                || '[0-9a-f]{4}-[0-9a-f]{4}-'
                || '[0-9a-f]{12}-'
                || document_sha256
                || '[.](pdf|png|jpg)$'
            )
        ),

    CONSTRAINT zion_admin_fin_upload_mime_path_match
        CHECK (
            (
                mime_type = 'application/pdf'
                AND storage_path LIKE '%.pdf'
            )
            OR (
                mime_type = 'image/png'
                AND storage_path LIKE '%.png'
            )
            OR (
                mime_type = 'image/jpeg'
                AND storage_path LIKE '%.jpg'
            )
        )
);

CREATE INDEX zion_admin_fin_upload_month_idx
    ON public.zion_admin_financial_evidence_uploads (
        month,
        preclosure_revision,
        source,
        uploaded_at DESC
    );

ALTER TABLE public.zion_admin_financial_evidence_uploads
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL
    ON public.zion_admin_financial_evidence_uploads
    FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
    ON public.zion_admin_financial_evidence_uploads
    TO service_role;

COMMENT ON TABLE
    public.zion_admin_financial_evidence_uploads
IS
    'Documentos privados enviados ao ZION-ADM; '
    'registro de upload nao constitui evidencia financeira '
    'verificada e nao autoriza fechamento definitivo.';

COMMIT;