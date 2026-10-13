-- ZION / Pilar 9 / Bloco 9 / 9.3-B
-- Solicitar aprovacao humana de uma versao de orcamento (somente registro).
-- Nao envia WhatsApp, nao envia PDF ao cliente, nao altera contrato padrao.
-- Executar uma unica vez no Supabase SQL Editor; depois salvar em migrations.

BEGIN;

-- Reforcar no banco o escopo da oportunidade, do orcamento e da versao.
ALTER TABLE public.p9_responsible_commercial_approval_requests
  ADD CONSTRAINT p9_commercial_approval_opportunity_scope_fk
    FOREIGN KEY (commercial_opportunity_id, organization_id, store_id)
    REFERENCES public.commercial_opportunities (id, organization_id, store_id)
    ON DELETE RESTRICT;

ALTER TABLE public.p9_responsible_commercial_approval_requests
  ADD CONSTRAINT p9_commercial_approval_quote_scope_fk
    FOREIGN KEY (quote_id, commercial_opportunity_id, organization_id, store_id)
    REFERENCES public.sales_quotes (id, commercial_opportunity_id, organization_id, store_id)
    ON DELETE RESTRICT;

ALTER TABLE public.p9_responsible_commercial_approval_requests
  ADD CONSTRAINT p9_commercial_approval_quote_version_scope_fk
    FOREIGN KEY (quote_version_id, quote_id, organization_id, store_id)
    REFERENCES public.sales_quote_versions (id, quote_id, organization_id, store_id)
    ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.p9_request_quote_send_approval_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_responsible_id uuid,
  p_commercial_opportunity_id uuid,
  p_expected_lifecycle_cycle integer,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_report_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_opportunity record;
  v_quote record;
  v_version record;
  v_file record;
  v_responsible record;
  v_responsible_count bigint;
  v_existing record;
  v_active record;
  v_request_key text;
  v_request_id uuid;
  v_report jsonb;
BEGIN
  -- Esta RPC e exclusiva do backend de sistema; nao confiar em IDs vindos do cliente.
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_responsible_id IS NULL OR p_commercial_opportunity_id IS NULL
     OR p_quote_id IS NULL OR p_quote_version_id IS NULL
     OR p_expected_lifecycle_cycle IS NULL OR p_expected_lifecycle_cycle < 1 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_ARGUMENTS_INVALID';
  END IF;

  IF p_report_snapshot IS NULL
     OR jsonb_typeof(p_report_snapshot) <> 'object'
     OR p_report_snapshot = '{}'::jsonb
     OR length(p_report_snapshot::text) > 16000 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_REPORT_INVALID';
  END IF;

  -- Serializar pedidos da mesma oportunidade; nao e um bypass de autorizacao.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'p9_quote_approval:' || p_organization_id::text || ':' ||
      p_store_id::text || ':' || p_commercial_opportunity_id::text,
      0
    )
  );

  SELECT o.id, o.lifecycle_cycle, o.stage, o.current_quote_id,
         o.current_quote_version_id
    INTO v_opportunity
    FROM public.commercial_opportunities AS o
   WHERE o.id = p_commercial_opportunity_id
     AND o.organization_id = p_organization_id
     AND o.store_id = p_store_id
   FOR UPDATE;

  IF NOT FOUND OR v_opportunity.lifecycle_cycle <> p_expected_lifecycle_cycle THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_OPPORTUNITY_CYCLE_MISMATCH';
  END IF;

  IF v_opportunity.stage IN ('perdido', 'concluido') THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_OPPORTUNITY_CLOSED';
  END IF;

  SELECT q.id, q.current_version_id, q.status, q.commercial_opportunity_id
    INTO v_quote
    FROM public.sales_quotes AS q
   WHERE q.id = p_quote_id
     AND q.organization_id = p_organization_id
     AND q.store_id = p_store_id
     AND q.commercial_opportunity_id = p_commercial_opportunity_id
   FOR UPDATE;

  IF NOT FOUND OR v_quote.current_version_id IS DISTINCT FROM p_quote_version_id THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_NOT_CURRENT_QUOTE_VERSION';
  END IF;

  -- A oportunidade pode continuar apontando para a versao anterior enviada;
  -- a versao nova deve ser a atual do proprio orcamento em preparacao.
  IF lower(btrim(COALESCE(v_quote.status, ''))) IN
     ('cancelled', 'canceled', 'void', 'archived', 'rejected') THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_QUOTE_INACTIVE';
  END IF;

  SELECT v.id, v.quote_id, v.version_number, v.status, v.sent_at, v.store_file_id
    INTO v_version
    FROM public.sales_quote_versions AS v
   WHERE v.id = p_quote_version_id
     AND v.quote_id = p_quote_id
     AND v.organization_id = p_organization_id
     AND v.store_id = p_store_id
   FOR UPDATE;

  IF NOT FOUND OR v_version.version_number < 1 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_VERSION_INVALID';
  END IF;

  IF v_version.sent_at IS NOT NULL
     OR lower(btrim(COALESCE(v_version.status, ''))) IN
       ('sent', 'superseded', 'cancelled', 'canceled', 'void', 'rejected', 'expired') THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_VERSION_ALREADY_SENT_OR_INACTIVE';
  END IF;

  IF v_version.store_file_id IS NULL THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_PDF_MISSING';
  END IF;

  SELECT f.id, f.storage_bucket, f.storage_path, f.mime_type
    INTO v_file
    FROM public.store_files AS f
   WHERE f.id = v_version.store_file_id
     AND f.organization_id = p_organization_id
     AND f.store_id = p_store_id
   FOR SHARE;

  IF NOT FOUND
     OR lower(btrim(COALESCE(v_file.mime_type, ''))) <> 'application/pdf'
     OR NULLIF(btrim(COALESCE(v_file.storage_bucket, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_file.storage_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_PDF_INVALID_OR_OUT_OF_SCOPE';
  END IF;

  SELECT count(*) INTO v_responsible_count
    FROM public.store_responsibles AS r
   WHERE r.organization_id = p_organization_id
     AND r.store_id = p_store_id
     AND r.is_primary IS TRUE
     AND r.is_active IS TRUE;

  IF v_responsible_count <> 1 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_PRIMARY_RESPONSIBLE_AMBIGUOUS';
  END IF;

  SELECT r.id, r.whatsapp_number
    INTO v_responsible
    FROM public.store_responsibles AS r
   WHERE r.organization_id = p_organization_id
     AND r.store_id = p_store_id
     AND r.id = p_responsible_id
     AND r.is_primary IS TRUE
     AND r.is_active IS TRUE
   FOR SHARE;

  IF NOT FOUND OR NULLIF(btrim(COALESCE(v_responsible.whatsapp_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_RESPONSIBLE_NOT_AUTHORIZED';
  END IF;

  v_request_key := 'quote_send_approval:' ||
    p_commercial_opportunity_id::text || ':' ||
    p_expected_lifecycle_cycle::text || ':' ||
    p_quote_id::text || ':' || p_quote_version_id::text;

  -- Repeticao exata e idempotente, mas nao reabre recusa ou cancelamento.
  SELECT r.id, r.status
    INTO v_existing
    FROM public.p9_responsible_commercial_approval_requests AS r
   WHERE r.organization_id = p_organization_id
     AND r.store_id = p_store_id
     AND r.request_key = v_request_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status IN (
      'pending_dispatch', 'awaiting_responsible',
      'dispatch_uncertain', 'approved'
    ) THEN
      RETURN jsonb_build_object(
        'request_id', v_existing.id,
        'status', v_existing.status,
        'created', false
      );
    END IF;
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_TERMINAL_REQUEST_NOT_REOPENED';
  END IF;

  -- Se a revisao e da mesma cotacao, invalidar a versao anterior pendente.
  -- Outra cotacao ativa exige conciliacao explicita; nao adivinhar qual vale.
  SELECT r.id, r.quote_id, r.quote_version_id
    INTO v_active
    FROM public.p9_responsible_commercial_approval_requests AS r
   WHERE r.organization_id = p_organization_id
     AND r.store_id = p_store_id
     AND r.commercial_opportunity_id = p_commercial_opportunity_id
     AND r.request_kind = 'quote_send_approval'
     AND r.status IN (
       'pending_dispatch', 'awaiting_responsible',
       'dispatch_uncertain', 'approved'
     )
   FOR UPDATE;

  IF FOUND THEN
    IF v_active.quote_id <> p_quote_id THEN
      RAISE EXCEPTION 'P9_QUOTE_APPROVAL_OTHER_QUOTE_REQUEST_ACTIVE';
    END IF;

    UPDATE public.p9_responsible_commercial_approval_requests AS r
       SET status = 'superseded',
           invalidated_at = now(),
           invalidated_reason = 'new_quote_version_pending_approval',
           updated_at = now()
     WHERE r.id = v_active.id
       AND r.organization_id = p_organization_id
       AND r.store_id = p_store_id;
  END IF;

  -- Campos comerciais verificados pelo banco prevalecem sobre o resumo da IA.
  v_report := p_report_snapshot || jsonb_build_object(
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle', p_expected_lifecycle_cycle,
    'quote_id', p_quote_id,
    'quote_version_id', p_quote_version_id,
    'quote_version_number', v_version.version_number,
    'quote_pdf_store_file_id', v_file.id
  );

  INSERT INTO public.p9_responsible_commercial_approval_requests (
    organization_id, store_id, responsible_id,
    commercial_opportunity_id, lifecycle_cycle,
    request_kind, request_key, quote_id, quote_version_id,
    report_snapshot, status
  ) VALUES (
    p_organization_id, p_store_id, p_responsible_id,
    p_commercial_opportunity_id, p_expected_lifecycle_cycle,
    'quote_send_approval', v_request_key, p_quote_id, p_quote_version_id,
    v_report, 'pending_dispatch'
  ) RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'status', 'pending_dispatch',
    'created', true
  );
END;
$function$;

-- A leitura de sistema permanece; toda escrita passa pela RPC SECURITY DEFINER.
REVOKE INSERT, UPDATE, DELETE
  ON public.p9_responsible_commercial_approval_requests
  FROM PUBLIC, anon, authenticated, service_role;

-- Se algum privilegio herdado mantiver escrita direta, abortar a migration.
DO $permissions$
BEGIN
  IF has_table_privilege(
       'service_role', 'public.p9_responsible_commercial_approval_requests', 'INSERT'
     ) OR has_table_privilege(
       'service_role', 'public.p9_responsible_commercial_approval_requests', 'UPDATE'
     ) OR has_table_privilege(
       'service_role', 'public.p9_responsible_commercial_approval_requests', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_DIRECT_WRITE_STILL_GRANTED';
  END IF;
END;
$permissions$;

REVOKE ALL ON FUNCTION public.p9_request_quote_send_approval_by_system(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.p9_request_quote_send_approval_by_system(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, jsonb
) TO service_role;

COMMENT ON FUNCTION public.p9_request_quote_send_approval_by_system(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, jsonb
) IS 'P9: registra pedido de aprovacao humana de uma versao de orcamento com PDF. Nao envia mensagens nem autoriza o envio ao cliente.';

COMMIT;
