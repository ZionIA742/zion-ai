-- ZION-ADM / 8-E.11-D.2-A
-- Bucket privado para comprovantes financeiros.
--
-- Nao realiza upload ou download.
-- Nao cria politicas de acesso para usuarios.
-- Nao altera buckets ou politicas existentes.
-- Nao registra evidencias como verificadas.
-- Nao executa fechamento financeiro.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM storage.buckets
        WHERE id = 'zion-admin-financial-evidence'
           OR name = 'zion-admin-financial-evidence'
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINANCIAL_EVIDENCE_BUCKET_ALREADY_EXISTS';
    END IF;
END;
$$;

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'zion-admin-financial-evidence',
    'zion-admin-financial-evidence',
    false,
    10485760,
    ARRAY[
        'application/pdf',
        'image/png',
        'image/jpeg'
    ]::text[]
);

COMMIT;