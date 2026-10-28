-- ZION | Pilar 9.9.15 | Contrato preparado manualmente: fundacao de origem na barreira de envio.
-- Etapa isolada: NAO cria contratos, NAO altera RPCs e NAO habilita envio.
-- Preserva todas as FKs existentes. O ramo de orcamento continua obrigatorio para envios legados.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_table oid := pg_catalog.to_regclass('public.p9_sales_contract_send_barriers');
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'P9_MANUAL_BARRIER_TABLE_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND attname = 'contract_origin' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'P9_MANUAL_BARRIER_ORIGIN_ALREADY_EXISTS';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_table
      AND conname = 'p9_sales_contract_send_barriers_scope_identity_ck'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'P9_MANUAL_BARRIER_ORIGINAL_SCOPE_CHECK_MISSING';
  END IF;
  IF (
    SELECT count(*) FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND NOT attisdropped
      AND attname IN ('sales_quote_id', 'sales_quote_version_id')
      AND atttypid = 'uuid'::regtype AND attnotnull
  ) <> 2 THEN
    RAISE EXCEPTION 'P9_MANUAL_BARRIER_QUOTE_COLUMNS_UNEXPECTED';
  END IF;
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint
    WHERE conrelid = v_table AND contype = 'f'
      AND conname IN (
        'p9_contract_send_barriers_contract_quote_lineage_fkey',
        'p9_contract_send_barriers_contract_scope_fkey',
        'p9_contract_send_barriers_contract_version_scope_fkey',
        'p9_contract_send_barriers_opportunity_scope_fkey',
        'p9_contract_send_barriers_quote_opportunity_scope_fkey',
        'p9_contract_send_barriers_quote_version_scope_fkey',
        'p9_contract_send_barriers_message_scope_fkey'
      )
  ) <> 7 THEN
    RAISE EXCEPTION 'P9_MANUAL_BARRIER_REQUIRED_FOREIGN_KEYS_MISSING';
  END IF;
END;
$preflight$;

ALTER TABLE public.p9_sales_contract_send_barriers
  ADD COLUMN contract_origin text NOT NULL
  DEFAULT 'accepted_quote_version_snapshot';

ALTER TABLE public.p9_sales_contract_send_barriers
  ALTER COLUMN sales_quote_id DROP NOT NULL,
  ALTER COLUMN sales_quote_version_id DROP NOT NULL;

-- Substitui a exigencia indiscriminada de quote pela identidade discriminada.
-- O ramo por orcamento continua exigindo ambos os IDs.
-- O ramo manual exige ambos NULL (nao e permitido quote parcial).
ALTER TABLE public.p9_sales_contract_send_barriers
  DROP CONSTRAINT p9_sales_contract_send_barriers_scope_identity_ck;

ALTER TABLE public.p9_sales_contract_send_barriers
  ADD CONSTRAINT p9_sales_contract_send_barriers_scope_identity_ck
  CHECK (
    organization_id IS NOT NULL
    AND store_id IS NOT NULL
    AND sales_contract_id IS NOT NULL
    AND sales_contract_version_id IS NOT NULL
    AND commercial_opportunity_id IS NOT NULL
    AND message_id IS NOT NULL
    AND (
      (contract_origin = 'accepted_quote_version_snapshot'
       AND sales_quote_id IS NOT NULL
       AND sales_quote_version_id IS NOT NULL)
      OR
      (contract_origin = 'responsible_text_draft'
       AND sales_quote_id IS NULL
       AND sales_quote_version_id IS NULL)
    )
  );

COMMENT ON COLUMN public.p9_sales_contract_send_barriers.contract_origin IS
  'Origem explicita do contrato: accepted_quote_version_snapshot (legado) ou responsible_text_draft (manual). Nao concede autorizacao de envio por si so.';

DO $postflight$
DECLARE
  v_table oid := pg_catalog.to_regclass('public.p9_sales_contract_send_barriers');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND attname = 'contract_origin'
      AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND NOT attisdropped
      AND attname IN ('sales_quote_id', 'sales_quote_version_id')
      AND NOT attnotnull
  ) <> 2 OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_table
      AND conname = 'p9_sales_contract_send_barriers_scope_identity_ck'
      AND contype = 'c' AND convalidated
  ) OR EXISTS (
    SELECT 1 FROM public.p9_sales_contract_send_barriers
    WHERE contract_origin IS DISTINCT FROM 'accepted_quote_version_snapshot'
  ) THEN
    RAISE EXCEPTION 'P9_MANUAL_BARRIER_POSTFLIGHT_FAILED';
  END IF;
END;
$postflight$;

SELECT
  'PASS' AS resultado,
  'P9_MANUAL_SEND_BARRIER_FOUNDATION_INSTALLED' AS componente,
  'NO_CONTRACTS_CREATED_NO_WHATSAPP_SEND' AS transporte;
COMMIT;
