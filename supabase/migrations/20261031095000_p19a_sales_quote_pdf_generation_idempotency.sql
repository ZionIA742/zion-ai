-- GENERATED CANDIDATE for local repository review. NOT YET DEPLOYED.
-- Based on Codex SQL supplied by the user on 2026-10-31.
-- Corrections: quote -> operation lock order, server canonical payload v1.
-- Required TS contract: canonical_payload_v1 is UTF-8 of deterministically
-- serialized JSON object with exactly these keys:
--   protocol: "zion-sales-quote-pdf-v1"
--   organizationId: UUID string
--   storeId: UUID string
--   quoteId: UUID string
--   quoteKind: "preliminary"|"definitive"|null
--   snapshot: p_quote_snapshot excluding top-level generatedAt/generationError
-- fingerprint = hex(SHA-256(UTF8(canonical_payload_v1))).
-- For retries, render the PDF from the saved operation.quote_snapshot.
-- CAUTION: do not run on Supabase before static review of the local schema
-- and endpoint/Storage implementation.

-- P19-A / Etapa 5/16
-- Idempotência durável da geração de PDF de sales_quotes.
-- Não altera create_sales_quote_version_by_system.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_type text;
BEGIN
  IF to_regclass('public.sales_quotes') IS NULL
     OR to_regclass('public.sales_quote_versions') IS NULL
     OR to_regclass('public.store_files') IS NULL THEN
    RAISE EXCEPTION 'P19A_PDF_DEPENDENCY_TABLE_MISSING';
  END IF;

  IF to_regprocedure(
    'public.create_sales_quote_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,integer,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'P19A_PDF_HISTORICAL_VERSION_RPC_MISSING';
  END IF;

  IF to_regprocedure('public.zion_resolve_request_role_internal()') IS NULL THEN
    RAISE EXCEPTION 'P19A_PDF_SERVICE_ROLE_RESOLVER_MISSING';
  END IF;

  SELECT c.data_type
    INTO v_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'store_files'
    AND c.column_name = 'size_bytes';

  IF v_type IS DISTINCT FROM 'bigint'
     AND v_type IS DISTINCT FROM 'integer'
     AND v_type IS DISTINCT FROM 'numeric' THEN
    RAISE EXCEPTION 'P19A_PDF_STORE_FILES_SIZE_TYPE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.store_files'::regclass
      AND pg_get_constraintdef(c.oid) ILIKE '%sales_quote_pdf%'
  ) THEN
    RAISE EXCEPTION 'P19A_PDF_STORE_FILES_KIND_NOT_SUPPORTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_index x ON x.indexrelid = i.oid
    WHERE i.relname = 'sales_quote_versions_quote_id_version_number_uidx'
      AND x.indisunique
  ) THEN
    RAISE EXCEPTION 'P19A_PDF_VERSION_UNIQUE_INDEX_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_quote_pdf_generation_operations'
      AND column_name = 'quote_version_id'
      AND data_type IS DISTINCT FROM 'uuid'
  ) THEN
    RAISE EXCEPTION 'P19A_PDF_EXISTING_OPERATION_VERSION_TYPE_INVALID';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.sales_quote_pdf_generation_operations (
  operation_id uuid PRIMARY KEY,

  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  quote_id uuid NOT NULL,

  request_fingerprint text NOT NULL,
  quote_kind text NULL,
  quote_snapshot jsonb NOT NULL,

  source_quote_updated_at timestamptz NOT NULL,
  source_current_version_id uuid NULL,

  status text NOT NULL DEFAULT 'claimed',
  attempts integer NOT NULL DEFAULT 1,

  claim_token uuid NULL,
  lease_expires_at timestamptz NULL,

  storage_bucket text NOT NULL DEFAULT 'zion-store-files',
  storage_path text NOT NULL,
  original_filename text NOT NULL,

  store_file_id uuid NULL,
  pdf_size_bytes bigint NULL,
  pdf_sha256 text NULL,
  quote_version_id uuid NULL,
  quote_version_number integer NULL,

  last_error_code text NULL,
  last_error_message text NULL,

  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz NULL,
  recoverable_at timestamptz NULL,
  materialized_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT p19a_pdf_operation_status_chk
    CHECK (status IN ('claimed', 'processing', 'recoverable', 'materialized', 'failed')),

  CONSTRAINT p19a_pdf_operation_attempts_chk
    CHECK (attempts > 0),

  CONSTRAINT p19a_pdf_operation_fingerprint_chk
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),

  CONSTRAINT p19a_pdf_operation_kind_chk
    CHECK (
      quote_kind IS NULL
      OR quote_kind IN ('preliminary', 'definitive')
    ),

  CONSTRAINT p19a_pdf_operation_sha_chk
    CHECK (
      pdf_sha256 IS NULL
      OR pdf_sha256 ~ '^[0-9a-f]{64}$'
    ),

  CONSTRAINT p19a_pdf_operation_path_chk
    CHECK (
      storage_bucket = 'zion-store-files'
      AND storage_path =
        organization_id::text
        || '/'
        || store_id::text
        || '/sales-quotes/'
        || quote_id::text
        || '/operations/'
        || operation_id::text
        || '.pdf'
    ),

  CONSTRAINT p19a_pdf_operation_materialized_fields_chk
    CHECK (
      status <> 'materialized'
      OR (
        store_file_id IS NOT NULL
        AND pdf_size_bytes IS NOT NULL
        AND pdf_size_bytes > 0
        AND pdf_sha256 IS NOT NULL
        AND quote_version_id IS NOT NULL
        AND quote_version_number IS NOT NULL
        AND materialized_at IS NOT NULL
        AND lease_expires_at IS NULL
        AND claim_token IS NULL
      )
    )
);

ALTER TABLE public.sales_quote_pdf_generation_operations
  ALTER COLUMN lease_expires_at DROP NOT NULL;

CREATE INDEX IF NOT EXISTS
  p19a_pdf_operation_status_lease_idx
ON public.sales_quote_pdf_generation_operations (
  status,
  lease_expires_at
);

CREATE INDEX IF NOT EXISTS
  p19a_pdf_operation_quote_idx
ON public.sales_quote_pdf_generation_operations (
  organization_id,
  store_id,
  quote_id,
  created_at DESC
);

ALTER TABLE public.sales_quote_pdf_generation_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sales_quote_pdf_generation_operations
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_sales_quote_pdf_generation_by_system(
  p_operation_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid,
  p_request_fingerprint text,
  p_quote_kind text,
  p_quote_snapshot jsonb,
  p_original_filename text,
  p_canonical_payload_v1 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp, auth
SET row_security = off
AS $function$
DECLARE
  v_quote public.sales_quotes%ROWTYPE;
  v_operation public.sales_quote_pdf_generation_operations%ROWTYPE;
  v_claim_token uuid;
  v_expected_fingerprint text;
  v_canonical_payload jsonb;
  v_now timestamptz := clock_timestamp();
  v_lease timestamptz := v_now + interval '10 minutes';
BEGIN
  IF public.zion_resolve_request_role_internal()
     IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'P19A_PDF_SYSTEM_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation_id IS NULL
     OR p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_quote_id IS NULL
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
      OR p_canonical_payload_v1 IS NULL
      OR length(p_canonical_payload_v1) = 0
     OR jsonb_typeof(p_quote_snapshot) IS DISTINCT FROM 'object'
     OR p_original_filename IS NULL
     OR btrim(p_original_filename) = ''
     OR (
       p_quote_kind IS NOT NULL
       AND p_quote_kind NOT IN ('preliminary', 'definitive')
     ) THEN
    RAISE EXCEPTION 'P19A_PDF_BEGIN_ARGUMENTS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Hash the exact canonical UTF-8 payload provided by the server.
  -- Do NOT hash jsonb::text: JS/PG textual JSON encodings can diverge.
  -- canonical_payload_v1 must be deterministic JSON serialized by the
  -- TypeScript canonical serializer (same bytes for every replay).
  BEGIN
    v_canonical_payload := p_canonical_payload_v1::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'P19A_PDF_CANONICAL_PAYLOAD_INVALID'
      USING ERRCODE = '22023';
  END;

  IF jsonb_typeof(v_canonical_payload) IS DISTINCT FROM 'object'
      OR v_canonical_payload->>'protocol' IS DISTINCT FROM 'zion-sales-quote-pdf-v1'
      OR v_canonical_payload->>'organizationId' IS DISTINCT FROM p_organization_id::text
      OR v_canonical_payload->>'storeId' IS DISTINCT FROM p_store_id::text
      OR v_canonical_payload->>'quoteId' IS DISTINCT FROM p_quote_id::text
      OR NOT (v_canonical_payload ? 'quoteKind')
      OR v_canonical_payload->'snapshot' IS DISTINCT FROM
        (p_quote_snapshot - 'generatedAt' - 'generationError')
      OR (v_canonical_payload
          - 'protocol' - 'organizationId' - 'storeId' - 'quoteId'
          - 'quoteKind' - 'snapshot') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'P19A_PDF_CANONICAL_PAYLOAD_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  IF p_quote_kind IS NULL THEN
    IF v_canonical_payload->'quoteKind'
         IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'P19A_PDF_CANONICAL_QUOTE_KIND_MISMATCH'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_canonical_payload->'quoteKind'
         IS DISTINCT FROM to_jsonb(p_quote_kind) THEN
    RAISE EXCEPTION 'P19A_PDF_CANONICAL_QUOTE_KIND_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  v_expected_fingerprint := encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_canonical_payload_v1, 'UTF8')),
    'hex'
  );

  IF p_request_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'P19A_PDF_REQUEST_FINGERPRINT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_quote
  FROM public.sales_quotes q
  WHERE q.id = p_quote_id
    AND q.organization_id = p_organization_id
    AND q.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P19A_PDF_QUOTE_SCOPE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(p_quote_snapshot->'quote') IS DISTINCT FROM 'object'
     OR p_quote_snapshot->'quote'->>'id'
          IS DISTINCT FROM p_quote_id::text
     OR p_quote_snapshot->'quote'->>'status'
          IS DISTINCT FROM v_quote.status
     OR NULLIF(
          p_quote_snapshot->'quote'->>'updatedAt',
          ''
        )::timestamptz IS DISTINCT FROM v_quote.updated_at
     OR p_quote_snapshot->'quote'->>'currentVersionId'
          IS DISTINCT FROM v_quote.current_version_id::text THEN
    RAISE EXCEPTION 'P19A_PDF_SNAPSHOT_QUOTE_STATE_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_operation
  FROM public.sales_quote_pdf_generation_operations o
  WHERE o.operation_id = p_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_operation.organization_id IS DISTINCT FROM p_organization_id
       OR v_operation.store_id IS DISTINCT FROM p_store_id
       OR v_operation.quote_id IS DISTINCT FROM p_quote_id
       OR v_operation.request_fingerprint
            IS DISTINCT FROM p_request_fingerprint
       OR v_operation.quote_kind
            IS DISTINCT FROM p_quote_kind
       OR v_operation.quote_snapshot - 'generatedAt' - 'generationError'
            IS DISTINCT FROM p_quote_snapshot - 'generatedAt' - 'generationError'
       OR v_operation.original_filename
            IS DISTINCT FROM btrim(p_original_filename) THEN
      RAISE EXCEPTION 'P19A_PDF_OPERATION_IDENTITY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;

    IF v_operation.status = 'materialized' THEN
      RETURN jsonb_build_object(
        'outcome', 'idempotent_replay',
        'status', v_operation.status,
        'operation_id', v_operation.operation_id,
        'quote_id', v_operation.quote_id,
        'quote_version_id', v_operation.quote_version_id,
        'quote_version_number', v_operation.quote_version_number,
        'store_file_id', v_operation.store_file_id,
        'storage_bucket', v_operation.storage_bucket,
        'storage_path', v_operation.storage_path,
        'original_filename', v_operation.original_filename,
        'pdf_size_bytes', v_operation.pdf_size_bytes,
        'pdf_sha256', v_operation.pdf_sha256
      );
    END IF;

    IF v_operation.status IN ('claimed', 'processing')
       AND v_operation.lease_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'outcome', 'in_progress',
        'status', v_operation.status,
        'operation_id', v_operation.operation_id,
        'lease_expires_at', v_operation.lease_expires_at
      );
    END IF;

    IF v_operation.status IN ('claimed', 'processing')
       AND (
         v_operation.lease_expires_at IS NULL
         OR v_operation.lease_expires_at <= v_now
       ) THEN
      UPDATE public.sales_quote_pdf_generation_operations
      SET status = 'recoverable',
          claim_token = NULL,
          lease_expires_at = NULL,
          recoverable_at = v_now,
          last_error_code = 'P19A_PDF_LEASE_EXPIRED',
          last_error_message = 'A reivindicacao expirou antes da materializacao.',
          updated_at = v_now
      WHERE operation_id = v_operation.operation_id;

      RETURN jsonb_build_object(
        'outcome', 'recoverable',
        'status', 'recoverable',
        'operation_id', v_operation.operation_id
      );
    END IF;

    IF v_operation.status = 'recoverable' THEN
      RETURN jsonb_build_object(
        'outcome', 'recoverable',
        'status', 'recoverable',
        'operation_id', v_operation.operation_id
      );
    END IF;

    RAISE EXCEPTION 'P19A_PDF_OPERATION_STATE_CONFLICT'
      USING ERRCODE = '23514';
  END IF;

  v_claim_token := gen_random_uuid();

  INSERT INTO public.sales_quote_pdf_generation_operations (
    operation_id,
    organization_id,
    store_id,
    quote_id,
    request_fingerprint,
    quote_kind,
    quote_snapshot,
    source_quote_updated_at,
    source_current_version_id,
    status,
    attempts,
    claim_token,
    lease_expires_at,
    storage_path,
    original_filename
  )
  VALUES (
    p_operation_id,
    p_organization_id,
    p_store_id,
    p_quote_id,
    p_request_fingerprint,
    p_quote_kind,
    p_quote_snapshot,
    v_quote.updated_at,
    v_quote.current_version_id,
    'claimed',
    1,
    v_claim_token,
    v_lease,
    p_organization_id::text
      || '/'
      || p_store_id::text
      || '/sales-quotes/'
      || p_quote_id::text
      || '/operations/'
      || p_operation_id::text
      || '.pdf',
    btrim(p_original_filename)
  );

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'status', 'claimed',
    'operation_id', p_operation_id,
    'quote_snapshot', p_quote_snapshot,
    'claim_token', v_claim_token,
    'lease_expires_at', v_lease,
    'storage_bucket', 'zion-store-files',
    'storage_path',
      p_organization_id::text
      || '/'
      || p_store_id::text
      || '/sales-quotes/'
      || p_quote_id::text
      || '/operations/'
      || p_operation_id::text
      || '.pdf',
    'original_filename', btrim(p_original_filename)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_recoverable_sales_quote_pdf_generation_by_system(
  p_operation_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp, auth
SET row_security = off
AS $function$
DECLARE
  v_operation public.sales_quote_pdf_generation_operations%ROWTYPE;
  v_claim_token uuid := gen_random_uuid();
  v_lease timestamptz := clock_timestamp() + interval '10 minutes';
BEGIN
  IF public.zion_resolve_request_role_internal()
     IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'P19A_PDF_SYSTEM_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_operation
  FROM public.sales_quote_pdf_generation_operations
  WHERE operation_id = p_operation_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND request_fingerprint = p_request_fingerprint
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P19A_PDF_RECOVERY_OPERATION_NOT_FOUND'
      USING ERRCODE = '23514';
  END IF;

  IF v_operation.status = 'materialized' THEN
    RETURN jsonb_build_object(
      'outcome', 'idempotent_replay',
      'status', v_operation.status,
      'operation_id', v_operation.operation_id,
      'quote_version_id', v_operation.quote_version_id,
      'store_file_id', v_operation.store_file_id,
      'storage_bucket', v_operation.storage_bucket,
      'storage_path', v_operation.storage_path,
      'original_filename', v_operation.original_filename,
      'pdf_size_bytes', v_operation.pdf_size_bytes,
      'pdf_sha256', v_operation.pdf_sha256
    );
  END IF;

  IF v_operation.status IS DISTINCT FROM 'recoverable' THEN
    RAISE EXCEPTION 'P19A_PDF_RECOVERY_STATE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.sales_quote_pdf_generation_operations
  SET status = 'claimed',
      attempts = attempts + 1,
      claim_token = v_claim_token,
      lease_expires_at = v_lease,
      started_at = NULL,
      updated_at = clock_timestamp(),
      last_error_code = NULL,
      last_error_message = NULL
  WHERE operation_id = v_operation.operation_id;

  RETURN jsonb_build_object(
    'outcome', 'reclaimed',
    'status', 'claimed',
    'operation_id', v_operation.operation_id,
    'quote_snapshot', v_operation.quote_snapshot,
    'claim_token', v_claim_token,
    'lease_expires_at', v_lease,
    'storage_bucket', v_operation.storage_bucket,
    'storage_path', v_operation.storage_path,
    'original_filename', v_operation.original_filename
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_sales_quote_pdf_generation_by_system(
  p_operation_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp, auth
SET row_security = off
AS $function$
DECLARE
  v_operation public.sales_quote_pdf_generation_operations%ROWTYPE;
BEGIN
  IF public.zion_resolve_request_role_internal()
     IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'P19A_PDF_SYSTEM_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_operation
  FROM public.sales_quote_pdf_generation_operations
  WHERE operation_id = p_operation_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_operation.status IS DISTINCT FROM 'claimed'
     OR v_operation.claim_token IS DISTINCT FROM p_claim_token
     OR v_operation.lease_expires_at IS NULL
     OR v_operation.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'P19A_PDF_CLAIM_INVALID'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.sales_quote_pdf_generation_operations
  SET status = 'processing',
      started_at = COALESCE(started_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE operation_id = v_operation.operation_id;

  RETURN jsonb_build_object(
    'outcome', 'processing',
    'status', 'processing',
    'operation_id', v_operation.operation_id,
    'storage_bucket', v_operation.storage_bucket,
    'storage_path', v_operation.storage_path,
    'original_filename', v_operation.original_filename,
    'lease_expires_at', v_operation.lease_expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_sales_quote_pdf_generation_recoverable_by_system(
  p_operation_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp, auth
SET row_security = off
AS $function$
DECLARE
  v_updated uuid;
BEGIN
  IF public.zion_resolve_request_role_internal()
     IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'P19A_PDF_SYSTEM_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.sales_quote_pdf_generation_operations
  SET status = 'recoverable',
      claim_token = NULL,
      lease_expires_at = NULL,
      recoverable_at = clock_timestamp(),
      last_error_code = NULLIF(btrim(p_error_code), ''),
      last_error_message = NULLIF(btrim(p_error_message), ''),
      updated_at = clock_timestamp()
  WHERE operation_id = p_operation_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND status IN ('claimed', 'processing')
    AND claim_token = p_claim_token
  RETURNING operation_id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'P19A_PDF_RECOVERABLE_TRANSITION_FAILED'
      USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'recoverable',
    'status', 'recoverable',
    'operation_id', v_updated
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.materialize_sales_quote_pdf_generation_by_system(
  p_operation_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_claim_token uuid,
  p_store_file_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_size_bytes bigint,
  p_pdf_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp, auth
SET row_security = off
AS $function$
DECLARE
  v_operation public.sales_quote_pdf_generation_operations%ROWTYPE;
  v_quote public.sales_quotes%ROWTYPE;
  v_file public.store_files%ROWTYPE;
  v_version_id uuid;
  v_version_number integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF public.zion_resolve_request_role_internal()
     IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'P19A_PDF_SYSTEM_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  -- Strict lock order: sales_quotes first, operation second.
  -- The join only reads the operation while acquiring the quote lock;
  -- it does not lock the operation row until the next SELECT.
  SELECT q.*
    INTO v_quote
  FROM public.sales_quotes q
  JOIN public.sales_quote_pdf_generation_operations o
    ON o.quote_id = q.id
    AND o.organization_id = q.organization_id
    AND o.store_id = q.store_id
  WHERE o.operation_id = p_operation_id
    AND o.organization_id = p_organization_id
    AND o.store_id = p_store_id
  FOR UPDATE OF q;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P19A_PDF_OPERATION_OR_QUOTE_NOT_FOUND'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_operation
  FROM public.sales_quote_pdf_generation_operations
  WHERE operation_id = p_operation_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND quote_id = v_quote.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P19A_PDF_OPERATION_NOT_FOUND'
      USING ERRCODE = '23514';
  END IF;

  IF v_operation.status = 'materialized' THEN
    RETURN jsonb_build_object(
      'outcome', 'idempotent_replay',
      'status', v_operation.status,
      'operation_id', v_operation.operation_id,
      'quote_id', v_operation.quote_id,
      'quote_version_id', v_operation.quote_version_id,
      'quote_version_number', v_operation.quote_version_number,
      'store_file_id', v_operation.store_file_id,
      'storage_bucket', v_operation.storage_bucket,
      'storage_path', v_operation.storage_path,
      'original_filename', v_operation.original_filename,
      'pdf_size_bytes', v_operation.pdf_size_bytes,
      'pdf_sha256', v_operation.pdf_sha256
    );
  END IF;

  IF v_operation.status IS DISTINCT FROM 'processing'
     OR v_operation.claim_token IS DISTINCT FROM p_claim_token
     OR v_operation.lease_expires_at IS NULL
     OR v_operation.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'P19A_PDF_MATERIALIZATION_CLAIM_INVALID'
      USING ERRCODE = '23514';
  END IF;

  IF p_size_bytes IS NULL
     OR p_size_bytes <= 0
     OR p_size_bytes > 2147483647
     OR p_pdf_sha256 IS NULL
     OR p_pdf_sha256 !~ '^[0-9a-f]{64}$'
     OR p_storage_bucket IS DISTINCT FROM v_operation.storage_bucket
     OR p_storage_path IS DISTINCT FROM v_operation.storage_path
     OR p_original_filename IS DISTINCT FROM v_operation.original_filename THEN
    RAISE EXCEPTION 'P19A_PDF_ARTIFACT_IDENTITY_INVALID'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_file
  FROM public.store_files f
  WHERE f.id = p_store_file_id
    AND f.organization_id = p_organization_id
    AND f.store_id = p_store_id
    AND f.file_kind = 'sales_quote_pdf'
    AND f.storage_bucket = v_operation.storage_bucket
    AND f.storage_path = v_operation.storage_path
    AND f.original_filename = v_operation.original_filename
    AND f.mime_type = 'application/pdf'
    AND f.size_bytes = p_size_bytes;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P19A_PDF_STORE_FILE_EVIDENCE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  -- Quote is already locked before the operation.
  IF v_quote.updated_at IS DISTINCT FROM v_operation.source_quote_updated_at
     OR v_quote.current_version_id
          IS DISTINCT FROM v_operation.source_current_version_id THEN
    RAISE EXCEPTION 'P19A_PDF_QUOTE_CHANGED_DURING_GENERATION'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    r.id,
    r.version_number
  INTO
    v_version_id,
    v_version_number
  FROM public.create_sales_quote_version_by_system(
    v_operation.organization_id,
    v_operation.store_id,
    v_operation.quote_id,
    'generated',
    'pending_review',
    v_operation.quote_kind,
    p_store_file_id,
    v_operation.storage_bucket,
    v_operation.storage_path,
    v_operation.original_filename,
    'application/pdf',
    p_size_bytes::integer,
    v_operation.quote_snapshot
  ) r;

  IF v_version_id IS NULL OR v_version_number IS NULL THEN
    RAISE EXCEPTION 'P19A_PDF_HISTORICAL_VERSION_RESULT_INVALID';
  END IF;

  UPDATE public.sales_quote_pdf_generation_operations
  SET status = 'materialized',
      claim_token = NULL,
      lease_expires_at = NULL,
      store_file_id = p_store_file_id,
      pdf_size_bytes = p_size_bytes,
      pdf_sha256 = p_pdf_sha256,
      quote_version_id = v_version_id,
      quote_version_number = v_version_number,
      materialized_at = v_now,
      updated_at = v_now,
      last_error_code = NULL,
      last_error_message = NULL
  WHERE operation_id = v_operation.operation_id
    AND status = 'processing';

  RETURN jsonb_build_object(
    'outcome', 'materialized',
    'status', 'materialized',
    'operation_id', v_operation.operation_id,
    'quote_id', v_operation.quote_id,
    'quote_version_id', v_version_id,
    'quote_version_number', v_version_number,
    'store_file_id', p_store_file_id,
    'storage_bucket', v_operation.storage_bucket,
    'storage_path', v_operation.storage_path,
    'original_filename', v_operation.original_filename,
    'pdf_size_bytes', p_size_bytes,
    'pdf_sha256', p_pdf_sha256
  );
END;
$function$;

ALTER FUNCTION public.begin_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, text
) OWNER TO postgres;

ALTER FUNCTION public.claim_recoverable_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, text
) OWNER TO postgres;

ALTER FUNCTION public.start_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid
) OWNER TO postgres;

ALTER FUNCTION public.mark_sales_quote_pdf_generation_recoverable_by_system(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;

ALTER FUNCTION public.materialize_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.begin_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_recoverable_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.start_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_sales_quote_pdf_generation_recoverable_by_system(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.materialize_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.begin_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.claim_recoverable_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.start_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid
) TO service_role;

GRANT EXECUTE ON FUNCTION public.mark_sales_quote_pdf_generation_recoverable_by_system(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.materialize_sales_quote_pdf_generation_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text
) TO service_role;

-- Read-only replay lookup. Never regenerate a PDF when materialized.
CREATE OR REPLACE FUNCTION public.get_sales_quote_pdf_generation_replay_by_system(
  p_operation_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_quote_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp, auth
SET row_security = off
AS $function$
DECLARE
  v_operation public.sales_quote_pdf_generation_operations%ROWTYPE;
BEGIN
  IF public.zion_resolve_request_role_internal()
     IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'P19A_PDF_SYSTEM_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation_id IS NULL
     OR p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_quote_id IS NULL THEN
    RAISE EXCEPTION 'P19A_PDF_LOOKUP_ARGUMENTS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_operation
  FROM public.sales_quote_pdf_generation_operations
  WHERE operation_id = p_operation_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND quote_id = p_quote_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'not_found',
      'operation_id', p_operation_id
    );
  END IF;

  IF v_operation.status = 'materialized' THEN
    RETURN jsonb_build_object(
      'outcome', 'idempotent_replay',
      'status', v_operation.status,
      'operation_id', v_operation.operation_id,
      'quote_id', v_operation.quote_id,
      'quote_version_id', v_operation.quote_version_id,
      'quote_version_number', v_operation.quote_version_number,
      'store_file_id', v_operation.store_file_id,
      'storage_bucket', v_operation.storage_bucket,
      'storage_path', v_operation.storage_path,
      'original_filename', v_operation.original_filename,
      'pdf_size_bytes', v_operation.pdf_size_bytes,
      'pdf_sha256', v_operation.pdf_sha256
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'existing_operation',
    'status', v_operation.status,
    'operation_id', v_operation.operation_id
  );
END;
$function$;

ALTER FUNCTION public.get_sales_quote_pdf_generation_replay_by_system(
  uuid, uuid, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_sales_quote_pdf_generation_replay_by_system(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_sales_quote_pdf_generation_replay_by_system(
  uuid, uuid, uuid, uuid
) TO service_role;

COMMIT;
