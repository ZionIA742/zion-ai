-- ZION P9 / 9.3-B / Integracao 1B
-- Migration: 20261016120000_p9_9_3b_accepted_quote_revision_atomic.sql
-- Aplicar SOMENTE no Supabase do ambiente de construcao do ZION.
-- Nao altera as autoridades de primeiro orcamento ou contratos.
BEGIN;

CREATE TABLE public.p9_accepted_quote_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  commercial_opportunity_id uuid NOT NULL,
  lifecycle_cycle integer NOT NULL CHECK (lifecycle_cycle = 1),
  quote_id uuid NOT NULL,
  source_quote_version_id uuid NOT NULL,
  source_acceptance_event_id uuid NOT NULL,
  change_request_id uuid NOT NULL REFERENCES public.sales_quote_change_requests(id) ON DELETE RESTRICT,
  target_quote_version_id uuid NOT NULL,
  operation_key text NOT NULL CHECK (
    pg_catalog.length(pg_catalog.btrim(operation_key)) BETWEEN 1 AND 128
  ),
  request_fingerprint text NOT NULL CHECK (pg_catalog.length(request_fingerprint) = 32),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT p9_accepted_quote_revisions_operation_uidx
    UNIQUE (organization_id, store_id, quote_id, operation_key),
  CONSTRAINT p9_accepted_quote_revisions_target_uidx
    UNIQUE (target_quote_version_id),
  CONSTRAINT p9_accepted_quote_revisions_opp_fk
    FOREIGN KEY (commercial_opportunity_id, organization_id, store_id)
    REFERENCES public.commercial_opportunities (id, organization_id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT p9_accepted_quote_revisions_quote_fk
    FOREIGN KEY (quote_id, commercial_opportunity_id, organization_id, store_id)
    REFERENCES public.sales_quotes (id, commercial_opportunity_id, organization_id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT p9_accepted_quote_revisions_source_version_fk
    FOREIGN KEY (source_quote_version_id, quote_id, organization_id, store_id)
    REFERENCES public.sales_quote_versions (id, quote_id, organization_id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT p9_accepted_quote_revisions_target_version_fk
    FOREIGN KEY (target_quote_version_id, quote_id, organization_id, store_id)
    REFERENCES public.sales_quote_versions (id, quote_id, organization_id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT p9_accepted_quote_revisions_acceptance_fk
    FOREIGN KEY (
      source_acceptance_event_id, organization_id, store_id,
      commercial_opportunity_id, lifecycle_cycle, quote_id,
      source_quote_version_id
    )
    REFERENCES public.commercial_proposal_acceptance_events (
      id, organization_id, store_id, commercial_opportunity_id,
      lifecycle_cycle, quote_id, quote_version_id
    )
    ON DELETE RESTRICT
);

CREATE INDEX p9_accepted_quote_revisions_opportunity_idx
  ON public.p9_accepted_quote_revisions
  (organization_id, store_id, commercial_opportunity_id, created_at DESC);

ALTER TABLE public.p9_accepted_quote_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.p9_accepted_quote_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.p9_accepted_quote_revisions TO service_role;

CREATE FUNCTION public.p9_reject_accepted_quote_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'ZION_P9_ACCEPTED_QUOTE_REVISION_APPEND_ONLY';
END;
$$;

CREATE TRIGGER p9_accepted_quote_revisions_immutable
BEFORE UPDATE OR DELETE ON public.p9_accepted_quote_revisions
FOR EACH ROW
EXECUTE FUNCTION public.p9_reject_accepted_quote_revision_mutation();

CREATE FUNCTION public.create_accepted_sales_quote_revision_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_quote_id uuid,
  p_source_quote_version_id uuid,
  p_source_acceptance_event_id uuid,
  p_change_request_id uuid,
  p_operation_key text,
  p_revision jsonb
)
RETURNS TABLE (
  revision_id uuid,
  quote_id uuid,
  source_quote_version_id uuid,
  target_quote_version_id uuid,
  source_acceptance_event_id uuid,
  quote_status text,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp', 'public'
SET row_security TO 'off'
AS $$
DECLARE
  v_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_opportunity public.commercial_opportunities%ROWTYPE;
  v_quote public.sales_quotes%ROWTYPE;
  v_source public.sales_quote_versions%ROWTYPE;
  v_acceptance public.commercial_proposal_acceptance_events%ROWTYPE;
  v_change public.sales_quote_change_requests%ROWTYPE;
  v_file public.store_files%ROWTYPE;
  v_existing public.p9_accepted_quote_revisions%ROWTYPE;
  v_revision_id uuid;
  v_version_id uuid;
  v_fingerprint text;
  v_store_file_id uuid;
  v_bucket text;
  v_path text;
  v_filename text;
  v_mime text;
  v_size integer;
  v_kind text;
  v_subtotal integer;
  v_discount integer;
  v_total integer;
  v_valid_until date;
  v_metadata jsonb;
  v_items jsonb;
  v_snapshot jsonb;
  v_updated integer;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role'
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_UNAUTHORIZED';
  END IF;

  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_commercial_opportunity_id IS NULL
     OR p_expected_lifecycle_cycle IS DISTINCT FROM 1
     OR p_quote_id IS NULL OR p_source_quote_version_id IS NULL
     OR p_source_acceptance_event_id IS NULL
     OR p_change_request_id IS NULL
     OR p_operation_key IS NULL
     OR pg_catalog.length(pg_catalog.btrim(p_operation_key)) NOT BETWEEN 1 AND 128
     OR p_revision IS NULL
     OR pg_catalog.jsonb_typeof(p_revision) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_ARGUMENTS_INVALID';
  END IF;

  v_items := p_revision -> 'items';
  v_snapshot := p_revision -> 'quote_snapshot';
  v_metadata := coalesce(p_revision -> 'metadata', '{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(v_items) = 0
     OR pg_catalog.jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(v_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_PAYLOAD_INVALID';
  END IF;

  -- Casts rejeitam JSON malformado; nao existe coercao silenciosa de moeda.
  v_subtotal := (p_revision ->> 'subtotal_cents')::integer;
  v_discount := (p_revision ->> 'discount_cents')::integer;
  v_total := (p_revision ->> 'total_cents')::integer;
  v_valid_until := nullif(p_revision ->> 'valid_until', '')::date;
  v_store_file_id := nullif(p_revision ->> 'store_file_id', '')::uuid;
  v_bucket := nullif(pg_catalog.btrim(p_revision ->> 'storage_bucket'), '');
  v_path := nullif(pg_catalog.btrim(p_revision ->> 'storage_path'), '');
  v_filename := nullif(pg_catalog.btrim(p_revision ->> 'original_filename'), '');
  v_mime := nullif(pg_catalog.btrim(p_revision ->> 'mime_type'), '');
  v_size := (p_revision ->> 'size_bytes')::integer;
  v_kind := nullif(pg_catalog.lower(pg_catalog.btrim(p_revision ->> 'quote_kind')), '');

  IF v_subtotal IS NULL OR v_discount IS NULL OR v_total IS NULL
     OR v_subtotal < 0 OR v_discount < 0 OR v_total < 0
     OR v_subtotal - v_discount <> v_total
     OR v_store_file_id IS NULL OR v_bucket IS NULL OR v_path IS NULL
     OR v_filename IS NULL OR v_mime IS DISTINCT FROM 'application/pdf'
     OR v_size IS NULL OR v_size <= 0
     OR (v_kind IS NOT NULL AND v_kind NOT IN ('preliminary','definitive')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_DATA_INVALID';
  END IF;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'lifecycle_cycle', p_expected_lifecycle_cycle,
      'quote_id', p_quote_id,
      'source_quote_version_id', p_source_quote_version_id,
      'source_acceptance_event_id', p_source_acceptance_event_id,
      'change_request_id', p_change_request_id,
      'revision', p_revision
    )::text
  );

  -- Ordem fixa: oportunidade, depois quote (mesma ordem do writer de aceite).
  SELECT * INTO v_opportunity
  FROM public.commercial_opportunities
  WHERE id = p_commercial_opportunity_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND OR v_opportunity.lifecycle_cycle IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_OPPORTUNITY_INVALID';
  END IF;

  SELECT * INTO v_quote
  FROM public.sales_quotes
  WHERE id = p_quote_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND commercial_opportunity_id = p_commercial_opportunity_id
  FOR UPDATE;

  IF NOT FOUND OR v_quote.currency IS DISTINCT FROM 'BRL' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_QUOTE_INVALID';
  END IF;

  SELECT * INTO v_existing
  FROM public.p9_accepted_quote_revisions
  WHERE organization_id = p_organization_id
    AND store_id = p_store_id
    AND quote_id = p_quote_id
    AND operation_key = p_operation_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = '23505',
        MESSAGE = 'ZION_P9_ACCEPTED_REVISION_OPERATION_KEY_CONFLICT';
    END IF;
    RETURN QUERY SELECT
      v_existing.id, v_existing.quote_id,
      v_existing.source_quote_version_id, v_existing.target_quote_version_id,
      v_existing.source_acceptance_event_id, 'pending_review'::text,
      'replayed'::text;
    RETURN;
  END IF;

  IF v_quote.current_version_id IS DISTINCT FROM p_source_quote_version_id
     OR v_opportunity.current_quote_id IS DISTINCT FROM p_quote_id
     OR v_opportunity.current_quote_version_id IS DISTINCT FROM p_source_quote_version_id
     OR v_quote.status IS DISTINCT FROM 'changes_requested' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_SOURCE_STALE';
  END IF;

  SELECT * INTO v_source FROM public.sales_quote_versions
  WHERE id = p_source_quote_version_id
    AND quote_id = p_quote_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id;

  IF NOT FOUND OR v_source.sent_at IS NULL OR v_source.status <> 'sent' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_SOURCE_NOT_SENT';
  END IF;

  SELECT * INTO v_acceptance FROM public.commercial_proposal_acceptance_events
  WHERE id = p_source_acceptance_event_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND commercial_opportunity_id = p_commercial_opportunity_id
    AND lifecycle_cycle = 1
    AND quote_id = p_quote_id
    AND quote_version_id = p_source_quote_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_ACCEPTANCE_MISSING';
  END IF;

  SELECT * INTO v_change FROM public.sales_quote_change_requests
  WHERE id = p_change_request_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND quote_id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND OR v_change.status <> 'open'
     OR (v_change.quote_version_id IS NOT NULL
         AND v_change.quote_version_id <> p_source_quote_version_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_CHANGE_REQUEST_INVALID';
  END IF;

  -- Revisao somente antes do envio do contrato; nao reescreve contratos.
  IF EXISTS (
    SELECT 1 FROM public.sales_contracts contract_row
    WHERE contract_row.organization_id = p_organization_id
      AND contract_row.store_id = p_store_id
      AND contract_row.quote_id = p_quote_id
      AND contract_row.quote_version_id = p_source_quote_version_id
      AND (
        contract_row.sent_at IS NOT NULL
        OR contract_row.status IN
          ('sent_to_customer','customer_signed','store_signed','completed')
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_CONTRACT_ALREADY_SENT';
  END IF;

  SELECT * INTO v_file FROM public.store_files
  WHERE id = v_store_file_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND file_kind = 'sales_quote_pdf';

  IF NOT FOUND OR v_file.storage_bucket IS DISTINCT FROM v_bucket
     OR v_file.storage_path IS DISTINCT FROM v_path
     OR v_file.original_filename IS DISTINCT FROM v_filename
     OR v_file.mime_type IS DISTINCT FROM v_mime
     OR v_file.size_bytes IS DISTINCT FROM v_size::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_PDF_EVIDENCE_INVALID';
  END IF;

  -- O writer existente valida centavos, totais, itens e lineage de catalogo.
  PERFORM public.apply_sales_quote_change_money_and_items_by_system(
    p_organization_id, p_store_id, p_quote_id,
    p_revision ->> 'title', 'pending_review',
    v_subtotal, v_discount, v_total,
    p_revision ->> 'customer_notes',
    p_revision ->> 'internal_notes',
    p_revision ->> 'payment_terms',
    p_revision ->> 'delivery_terms',
    p_revision ->> 'warranty_terms',
    v_valid_until, v_metadata, v_items
  );

  -- O writer existente materializa o snapshot exato e supersede V1.
  SELECT version_row.id INTO v_version_id
  FROM public.create_sales_quote_version_by_system(
    p_organization_id, p_store_id, p_quote_id,
    'generated', 'pending_review', v_kind, v_store_file_id,
    v_bucket, v_path, v_filename, v_mime, v_size, v_snapshot
  ) version_row;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_VERSION_FAILED';
  END IF;

  -- A oportunidade representa a ultima proposta ENVIADA, nao um rascunho.
  -- Limpa o par na mesma transacao para V1 nao autorizar contrato stale.
  UPDATE public.commercial_opportunities
  SET current_quote_id = NULL,
      current_quote_version_id = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_commercial_opportunity_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND current_quote_id = p_quote_id
    AND current_quote_version_id = p_source_quote_version_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_POINTER_UPDATE_FAILED';
  END IF;

  UPDATE public.sales_quote_change_requests
  SET status = 'applied',
      applied_at = pg_catalog.clock_timestamp(),
      resolved_at = pg_catalog.clock_timestamp(),
      applied_changes = pg_catalog.jsonb_build_object(
        'kind', 'accepted_quote_revision',
        'source_quote_version_id', p_source_quote_version_id,
        'target_quote_version_id', v_version_id
      )
  WHERE id = p_change_request_id AND status = 'open';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'ZION_P9_ACCEPTED_REVISION_CHANGE_REQUEST_UPDATE_FAILED';
  END IF;

  INSERT INTO public.p9_accepted_quote_revisions (
    organization_id, store_id, commercial_opportunity_id, lifecycle_cycle,
    quote_id, source_quote_version_id, source_acceptance_event_id,
    change_request_id, target_quote_version_id, operation_key,
    request_fingerprint
  ) VALUES (
    p_organization_id, p_store_id, p_commercial_opportunity_id, 1,
    p_quote_id, p_source_quote_version_id, p_source_acceptance_event_id,
    p_change_request_id, v_version_id, p_operation_key, v_fingerprint
  ) RETURNING id INTO v_revision_id;

  RETURN QUERY SELECT
    v_revision_id, p_quote_id, p_source_quote_version_id, v_version_id,
    p_source_acceptance_event_id, 'pending_review'::text, 'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.create_accepted_sales_quote_revision_by_system(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_accepted_sales_quote_revision_by_system(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMIT;
