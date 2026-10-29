-- ZION / P19-A / BLOCO 6 / ETAPA 5.1-A
-- Vinculo duravel entre operacao de preparacao e orcamento canonico.
-- Nao cria orcamentos nem altera operacoes existentes.

BEGIN;

ALTER TABLE public.p19a_quote_preparation_operations
    ADD COLUMN IF NOT EXISTS quote_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid =
            'public.p19a_quote_preparation_operations'::regclass
          AND conname = 'p19a_quote_prep_quote_scope_fk'
    ) THEN
        ALTER TABLE public.p19a_quote_preparation_operations
            ADD CONSTRAINT p19a_quote_prep_quote_scope_fk
            FOREIGN KEY (
                quote_id,
                commercial_opportunity_id,
                organization_id,
                store_id
            )
            REFERENCES public.sales_quotes (
                id,
                commercial_opportunity_id,
                organization_id,
                store_id
            )
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
    p19a_quote_prep_quote_id_uidx
ON public.p19a_quote_preparation_operations (quote_id)
WHERE quote_id IS NOT NULL;

COMMENT ON COLUMN
    public.p19a_quote_preparation_operations.quote_id
IS
    'Orcamento canonico associado a operacao P19-A. '
    'Preenchido pela autoridade sistemica transacional.';

COMMIT;
