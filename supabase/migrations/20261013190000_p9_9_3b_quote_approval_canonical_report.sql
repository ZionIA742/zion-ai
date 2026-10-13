-- ZION / P9 / Bloco 9 / 9.3-B: relatorio comercial canonico de aprovacao.
-- Moeda do piloto: BRL. Totais e itens extraidos da versao imutavel.
-- NAO envia WhatsApp, nao envia PDF, nao escreve em contratos.
-- PRE-REQUISITOS: migrations 20261013160000 e 20261013173000 aplicadas.
-- Nao reexecutar em producao antes de validar no DEV.
BEGIN;

-- Helper puro e interno: extrai campos comerciais da versao IMUTAVEL.
-- Nao recebe ou consulta precos mutaveis; BRL e a unica moeda aprovada no piloto.
CREATE OR REPLACE FUNCTION public.p9_build_quote_approval_canonical_report_internal(
  p_quote_snapshot jsonb,
  p_quote_id uuid,
  p_store_id uuid,
  p_version_number integer,
  p_pdf_store_file_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $report$
DECLARE
  v_quote jsonb;
  v_items jsonb;
  v_item jsonb;
  v_safe_items jsonb := '[]'::jsonb;
  v_number text;
  v_customer text;
  v_subtotal numeric;
  v_discount numeric;
  v_total numeric;
  v_item_subtotal numeric;
  v_item_discount numeric;
  v_item_total numeric;
  v_item_price numeric;
  v_item_qty numeric;
  v_sum_subtotal numeric := 0;
  v_sum_discount numeric := 0;
  v_sum_total numeric := 0;
  v_money_key text;
  v_money numeric;
  v_item_idx integer := 0;
BEGIN
  IF p_quote_id IS NULL OR p_store_id IS NULL OR p_pdf_store_file_id IS NULL
    OR p_version_number IS NULL OR p_version_number < 1 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ARGUMENTS_INVALID';
  END IF;
  IF p_quote_snapshot IS NULL OR jsonb_typeof(p_quote_snapshot) <> 'object'
     OR jsonb_typeof(p_quote_snapshot->'quote') <> 'object'
     OR jsonb_typeof(p_quote_snapshot->'store') <> 'object'
     OR jsonb_typeof(p_quote_snapshot->'items') <> 'array' THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_SNAPSHOT_INVALID';
  END IF;
  v_quote := p_quote_snapshot->'quote';
  v_items := p_quote_snapshot->'items';
  IF v_quote->>'id' IS DISTINCT FROM p_quote_id::text
     OR p_quote_snapshot->'store'->>'id' IS DISTINCT FROM p_store_id::text THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_LINEAGE_MISMATCH';
  END IF;
  IF NULLIF(btrim(COALESCE(p_quote_snapshot->>'generationError','')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_GENERATION_ERROR';
  END IF;
  -- Rejeita moeda explicitamente conflitante, caso snapshots futuros a incluam.
  IF (NULLIF(btrim(COALESCE(v_quote->>'currency','')), '') IS NOT NULL
      AND upper(btrim(v_quote->>'currency')) <> 'BRL')
     OR (NULLIF(btrim(COALESCE(p_quote_snapshot->>'currency','')), '') IS NOT NULL
      AND upper(btrim(p_quote_snapshot->>'currency')) <> 'BRL') THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CURRENCY_NOT_BRL';
  END IF;
  v_number := NULLIF(btrim(COALESCE(v_quote->>'quoteNumber','')), '');
  IF v_number IS NULL OR length(v_number) > 120 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_QUOTE_NUMBER_INVALID';
  END IF;

  FOREACH v_money_key IN ARRAY ARRAY['subtotalCents','discountCents','totalCents'] LOOP
    IF jsonb_typeof(v_quote->v_money_key) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_MONEY_INVALID';
    END IF;
    v_money := (v_quote->>v_money_key)::numeric;
    IF v_money < 0 OR v_money > 2147483647 OR trunc(v_money) <> v_money THEN
      RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_MONEY_INVALID';
    END IF;
  END LOOP;
  v_subtotal := (v_quote->>'subtotalCents')::numeric;
  v_discount := (v_quote->>'discountCents')::numeric;
  v_total := (v_quote->>'totalCents')::numeric;
  IF v_discount > v_subtotal OR v_subtotal - v_discount <> v_total THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_TOTAL_INCOHERENT';
  END IF;

  IF jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 200 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ITEMS_INVALID';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_item_idx := v_item_idx + 1;
    IF jsonb_typeof(v_item) <> 'object'
       OR NULLIF(btrim(COALESCE(v_item->>'name','')), '') IS NULL
       OR length(v_item->>'name') > 300
       OR jsonb_typeof(v_item->'quantity') <> 'number' THEN
      RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ITEM_INVALID';
    END IF;
    v_item_qty := (v_item->>'quantity')::numeric;
    IF v_item_qty <= 0 OR v_item_qty > 1000000 THEN
      RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ITEM_INVALID';
    END IF;
    FOREACH v_money_key IN ARRAY ARRAY['unitPriceCents','subtotalCents','discountCents','totalCents'] LOOP
      IF jsonb_typeof(v_item->v_money_key) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ITEM_MONEY_INVALID';
      END IF;
      v_money := (v_item->>v_money_key)::numeric;
      IF v_money < 0 OR v_money > 2147483647 OR trunc(v_money) <> v_money THEN
        RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ITEM_MONEY_INVALID';
      END IF;
    END LOOP;
    v_item_price := (v_item->>'unitPriceCents')::numeric;
    v_item_subtotal := (v_item->>'subtotalCents')::numeric;
    v_item_discount := (v_item->>'discountCents')::numeric;
    v_item_total := (v_item->>'totalCents')::numeric;
    -- Centavos por item: confere aritmetica, sem assumir que todo desconto
    -- e por item; um desconto geral da cotacao pode existir no cabecalho.
    IF v_item_discount > v_item_subtotal
       OR v_item_subtotal - v_item_discount <> v_item_total THEN
      RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ITEM_TOTAL_INCOHERENT';
    END IF;
    v_sum_subtotal := v_sum_subtotal + v_item_subtotal;
    v_sum_discount := v_sum_discount + v_item_discount;
    v_sum_total := v_sum_total + v_item_total;
    v_safe_items := v_safe_items || jsonb_build_array(jsonb_build_object(
      'name', btrim(v_item->>'name'),
      'quantity', v_item->'quantity',
      'unit_price_cents', v_item_price::integer,
      'subtotal_cents', v_item_subtotal::integer,
      'discount_cents', v_item_discount::integer,
      'total_cents', v_item_total::integer
    ));
  END LOOP;
  -- O subtotal deve refletir as linhas; desconto adicional pode ser global.
  IF v_sum_subtotal <> v_subtotal OR v_sum_discount > v_discount
     OR v_sum_total < v_total
     OR v_sum_total - v_total <> v_discount - v_sum_discount THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_ITEMS_TOTAL_MISMATCH';
  END IF;

  v_customer := COALESCE(
    NULLIF(btrim(COALESCE(v_quote->>'customerName','')), ''),
    NULLIF(btrim(COALESCE(p_quote_snapshot->'lead'->>'name','')), '')
  );
  IF v_customer IS NULL OR length(v_customer) > 300 THEN
    RAISE EXCEPTION 'P9_QUOTE_APPROVAL_CANONICAL_CUSTOMER_MISSING';
  END IF;
  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'quote_number', v_number,
    'quote_version_number', p_version_number::text,
    'quote_pdf_store_file_id', p_pdf_store_file_id,
    'currency', 'BRL',
    'subtotal_cents', v_subtotal::integer,
    'discount_cents', v_discount::integer,
    'total_cents', v_total::integer,
    'customer_name', v_customer,
    'payment_terms', NULLIF(btrim(COALESCE(v_quote->>'paymentTerms','')), ''),
    'delivery_terms', NULLIF(btrim(COALESCE(v_quote->>'deliveryTerms','')), ''),
    'warranty_terms', NULLIF(btrim(COALESCE(v_quote->>'warrantyTerms','')), ''),
    'valid_until', NULLIF(btrim(COALESCE(v_quote->>'validUntil','')), ''),
    'items_count', v_item_idx,
    'items', v_safe_items,
    'source', 'immutable_quote_version_snapshot'
  );
END;
$report$;

-- Somente o owner/SECURITY DEFINER pode usar o extrator; nao expor como API.
REVOKE ALL ON FUNCTION public.p9_build_quote_approval_canonical_report_internal(
  jsonb,uuid,uuid,integer,uuid
) FROM PUBLIC, anon, authenticated, service_role;

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
  v_canonical_report jsonb;
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

  SELECT v.id, v.quote_id, v.version_number, v.status, v.sent_at, v.store_file_id, v.quote_snapshot
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

  -- Fonte comercial exclusiva: snapshot da versao imutavel, nunca o cabecalho mutavel
  -- nem p_report_snapshot de origem externa. O helper rejeita snapshots invalidos.
  v_canonical_report := public.p9_build_quote_approval_canonical_report_internal(
    v_version.quote_snapshot, p_quote_id, p_store_id, v_version.version_number, v_file.id
  );

  v_request_key := 'quote_send_approval:' ||
    p_commercial_opportunity_id::text || ':' ||
    p_expected_lifecycle_cycle::text || ':' ||
    p_quote_id::text || ':' || p_quote_version_id::text;

  -- Repeticao exata e idempotente, mas nao reabre recusa ou cancelamento.
  SELECT r.id, r.status, r.report_snapshot
    INTO v_existing
    FROM public.p9_responsible_commercial_approval_requests AS r
   WHERE r.organization_id = p_organization_id
     AND r.store_id = p_store_id
     AND r.request_key = v_request_key
   FOR UPDATE;

  IF FOUND THEN
    -- Requests legados sem relatorio canonico nao sao silenciosamente reutilizados.
    -- Nao reescrever solicitacoes que possam ja ter sido enviadas ou decididas.
    IF NOT (v_existing.report_snapshot @> v_canonical_report) THEN
      RAISE EXCEPTION 'P9_QUOTE_APPROVAL_LEGACY_REPORT_RECONCILIATION_REQUIRED';
    END IF;
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

  -- O resumo do chamador nao participa do relatorio nem pode sobrescrever valores.
  v_report := v_canonical_report || jsonb_build_object(
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle', p_expected_lifecycle_cycle,
    'quote_id', p_quote_id,
    'quote_version_id', p_quote_version_id,
    'quote_version_number', v_version.version_number::text,
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

-- Mantem estritamente as permissoes de origem.
REVOKE ALL ON FUNCTION public.p9_request_quote_send_approval_by_system(
  uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p9_request_quote_send_approval_by_system(
  uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb
) TO service_role;

COMMENT ON FUNCTION public.p9_request_quote_send_approval_by_system(
  uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb
) IS 'P9: solicita aprovacao humana; relatorio canonico derivado exclusivamente do quote_snapshot imutavel, moeda BRL; nunca envia mensagens.';

COMMIT;
