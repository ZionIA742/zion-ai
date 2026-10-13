-- ZION | P9 | 9.3-B | Autoridade transacional da entrega ao responsavel
-- Somente registro/claim/finalizacao. NAO envia WhatsApp, NAO altera PDFs.
-- Requer a fundacao 20261013150000 e o writer 20261013160000.
BEGIN;

-- A chave composta impede reatribuir partes entre tenant/store.
CREATE UNIQUE INDEX p9_commercial_approval_request_scoped_uidx
ON public.p9_responsible_commercial_approval_requests (id, organization_id, store_id);

CREATE TABLE public.p9_quote_approval_delivery_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  component text NOT NULL CHECK (component IN ('opening_template', 'report', 'pdf')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'accepted', 'failed', 'uncertain')),
  claim_token uuid,
  claimed_at timestamptz,
  finalized_at timestamptz,
  accepted_at timestamptz,
  external_message_id text,
  failure_reason text,
  inbound_window_message_id uuid,
  pdf_store_file_id uuid,
  pdf_storage_bucket text,
  pdf_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p9_quote_delivery_parent_scope_fk FOREIGN KEY (request_id, organization_id, store_id)
    REFERENCES public.p9_responsible_commercial_approval_requests(id, organization_id, store_id)
    ON DELETE RESTRICT,
  CONSTRAINT p9_quote_delivery_file_fk FOREIGN KEY (pdf_store_file_id)
    REFERENCES public.store_files(id) ON DELETE RESTRICT,
  CONSTRAINT p9_quote_delivery_inbound_fk FOREIGN KEY (inbound_window_message_id)
    REFERENCES public.store_assistant_messages(id) ON DELETE RESTRICT,
  CONSTRAINT p9_quote_delivery_one_component UNIQUE(request_id, component),
  CONSTRAINT p9_quote_delivery_claim_consistency CHECK (
    (status = 'pending' AND claim_token IS NULL AND claimed_at IS NULL
      AND finalized_at IS NULL AND external_message_id IS NULL)
    OR
    (status = 'claimed' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL
      AND finalized_at IS NULL AND external_message_id IS NULL)
    OR
    (status IN ('accepted', 'failed', 'uncertain') AND claim_token IS NOT NULL
      AND claimed_at IS NOT NULL AND finalized_at IS NOT NULL)
  ),
  CONSTRAINT p9_quote_delivery_result_evidence CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL
      AND NULLIF(btrim(external_message_id), '') IS NOT NULL
      AND failure_reason IS NULL)
    OR (status IN ('failed', 'uncertain') AND accepted_at IS NULL
      AND NULLIF(btrim(failure_reason), '') IS NOT NULL
      AND external_message_id IS NULL)
    OR (status IN ('pending', 'claimed') AND accepted_at IS NULL
      AND failure_reason IS NULL)
  ),
  CONSTRAINT p9_quote_delivery_pdf_binding CHECK (
    (component = 'pdf' AND pdf_store_file_id IS NOT NULL
       AND NULLIF(btrim(pdf_storage_bucket), '') IS NOT NULL
       AND NULLIF(btrim(pdf_storage_path), '') IS NOT NULL)
    OR (component <> 'pdf' AND pdf_store_file_id IS NULL
       AND pdf_storage_bucket IS NULL AND pdf_storage_path IS NULL)
  ),
  CONSTRAINT p9_quote_delivery_window_binding CHECK (
    (component = 'opening_template' AND inbound_window_message_id IS NULL)
    OR component IN ('report', 'pdf')
  )
);

CREATE UNIQUE INDEX p9_quote_delivery_external_wamid_uidx
ON public.p9_quote_approval_delivery_parts (organization_id, store_id, external_message_id)
WHERE external_message_id IS NOT NULL;
CREATE INDEX p9_quote_delivery_pending_idx
ON public.p9_quote_approval_delivery_parts (organization_id, store_id, status, created_at);

ALTER TABLE public.p9_quote_approval_delivery_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.p9_quote_approval_delivery_parts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.p9_quote_approval_delivery_parts TO service_role;

-- Chamada SOMENTE de outras RPCs SECURITY DEFINER. Lock ordenado como o
-- writer anterior: advisory da oportunidade -> request -> opportunity -> quote.
CREATE FUNCTION public.p9_quote_delivery_current_guard_internal(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $body$
DECLARE
  r record; o record; q record; v record; f record; resp record;
  v_count bigint;
BEGIN
  SELECT organization_id, store_id, commercial_opportunity_id
    INTO r FROM public.p9_responsible_commercial_approval_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_DELIVERY_REQUEST_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'p9_quote_approval:' || r.organization_id::text || ':' || r.store_id::text || ':' ||
    r.commercial_opportunity_id::text, 0));

  SELECT * INTO r FROM public.p9_responsible_commercial_approval_requests
   WHERE id = p_request_id FOR UPDATE;
  IF r.request_kind <> 'quote_send_approval' OR r.status <> 'pending_dispatch' THEN
    RAISE EXCEPTION 'P9_DELIVERY_REQUEST_NOT_DISPATCHABLE';
  END IF;

  SELECT lifecycle_cycle, stage INTO o FROM public.commercial_opportunities
   WHERE id = r.commercial_opportunity_id AND organization_id = r.organization_id
     AND store_id = r.store_id FOR UPDATE;
  IF NOT FOUND OR o.lifecycle_cycle IS DISTINCT FROM r.lifecycle_cycle
      OR o.stage IN ('perdido', 'concluido') THEN
    RAISE EXCEPTION 'P9_DELIVERY_OPPORTUNITY_STALE';
  END IF;

  SELECT current_version_id, status INTO q FROM public.sales_quotes
   WHERE id = r.quote_id AND commercial_opportunity_id = r.commercial_opportunity_id
     AND organization_id = r.organization_id AND store_id = r.store_id FOR UPDATE;
  IF NOT FOUND OR q.current_version_id IS DISTINCT FROM r.quote_version_id
    OR lower(btrim(COALESCE(q.status,''))) IN ('cancelled','canceled','void','archived','rejected') THEN
    RAISE EXCEPTION 'P9_DELIVERY_QUOTE_STALE';
  END IF;

  SELECT status, sent_at, store_file_id INTO v FROM public.sales_quote_versions
   WHERE id = r.quote_version_id AND quote_id = r.quote_id
     AND organization_id = r.organization_id AND store_id = r.store_id FOR UPDATE;
  IF NOT FOUND OR v.store_file_id IS NULL OR v.sent_at IS NOT NULL
    OR lower(btrim(COALESCE(v.status,''))) IN
      ('sent','superseded','cancelled','canceled','void','rejected','expired') THEN
    RAISE EXCEPTION 'P9_DELIVERY_VERSION_STALE';
  END IF;

  SELECT storage_bucket, storage_path, mime_type INTO f FROM public.store_files
   WHERE id = v.store_file_id AND organization_id = r.organization_id
     AND store_id = r.store_id FOR SHARE;
  IF NOT FOUND OR lower(btrim(COALESCE(f.mime_type,''))) <> 'application/pdf'
    OR NULLIF(btrim(COALESCE(f.storage_bucket,'')), '') IS NULL
    OR NULLIF(btrim(COALESCE(f.storage_path,'')), '') IS NULL THEN
    RAISE EXCEPTION 'P9_DELIVERY_PDF_INVALID';
  END IF;
  IF r.report_snapshot->>'quote_pdf_store_file_id' IS DISTINCT FROM v.store_file_id::text
    OR r.report_snapshot->>'quote_version_id' IS DISTINCT FROM r.quote_version_id::text THEN
    RAISE EXCEPTION 'P9_DELIVERY_REPORT_BINDING_MISMATCH';
  END IF;

  SELECT count(*) INTO v_count FROM public.store_responsibles
   WHERE organization_id = r.organization_id AND store_id = r.store_id
     AND is_primary IS TRUE AND is_active IS TRUE;
  IF v_count <> 1 THEN RAISE EXCEPTION 'P9_DELIVERY_RESPONSIBLE_AMBIGUOUS'; END IF;

  SELECT whatsapp_number INTO resp FROM public.store_responsibles
   WHERE id = r.responsible_id AND organization_id = r.organization_id
     AND store_id = r.store_id AND is_primary IS TRUE AND is_active IS TRUE FOR SHARE;
  IF NOT FOUND OR NULLIF(btrim(COALESCE(resp.whatsapp_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'P9_DELIVERY_RESPONSIBLE_INVALID';
  END IF;

  RETURN jsonb_build_object(
    'request_id', r.id, 'organization_id', r.organization_id,
    'store_id', r.store_id, 'responsible_id', r.responsible_id,
    'destination', resp.whatsapp_number,
    'commercial_opportunity_id', r.commercial_opportunity_id,
    'quote_id', r.quote_id, 'quote_version_id', r.quote_version_id,
    'report_snapshot', r.report_snapshot, 'pdf_store_file_id', v.store_file_id,
    'pdf_storage_bucket', f.storage_bucket, 'pdf_storage_path', f.storage_path
  );
END;
$body$;

CREATE FUNCTION public.p9_prepare_quote_approval_delivery_by_system(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $body$
DECLARE g jsonb; v_existing record;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'P9_DELIVERY_SERVICE_ROLE_REQUIRED';
  END IF;
  g := public.p9_quote_delivery_current_guard_internal(p_request_id);
  INSERT INTO public.p9_quote_approval_delivery_parts
    (request_id, organization_id, store_id, component)
  SELECT p_request_id, (g->>'organization_id')::uuid, (g->>'store_id')::uuid, x.component
  FROM (VALUES ('opening_template'), ('report')) AS x(component)
  ON CONFLICT (request_id, component) DO NOTHING;

  INSERT INTO public.p9_quote_approval_delivery_parts
    (request_id, organization_id, store_id, component, pdf_store_file_id,
      pdf_storage_bucket, pdf_storage_path)
  VALUES (p_request_id, (g->>'organization_id')::uuid, (g->>'store_id')::uuid,
    'pdf', (g->>'pdf_store_file_id')::uuid,
    g->>'pdf_storage_bucket', g->>'pdf_storage_path')
  ON CONFLICT (request_id, component) DO NOTHING;

  SELECT * INTO v_existing FROM public.p9_quote_approval_delivery_parts
   WHERE request_id = p_request_id AND component = 'pdf';
  IF v_existing.pdf_store_file_id::text IS DISTINCT FROM g->>'pdf_store_file_id'
     OR v_existing.pdf_storage_bucket IS DISTINCT FROM g->>'pdf_storage_bucket'
     OR v_existing.pdf_storage_path IS DISTINCT FROM g->>'pdf_storage_path' THEN
    RAISE EXCEPTION 'P9_DELIVERY_PDF_SNAPSHOT_CHANGED';
  END IF;
  RETURN g || jsonb_build_object('prepared', true);
END;
$body$;

CREATE FUNCTION public.p9_claim_quote_approval_delivery_by_system(
 p_request_id uuid, p_component text, p_inbound_window_message_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $body$
DECLARE g jsonb; p record; opener record; report_part record; win record; v_token uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'P9_DELIVERY_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_component NOT IN ('opening_template','report','pdf') OR p_component IS NULL THEN
    RAISE EXCEPTION 'P9_DELIVERY_COMPONENT_INVALID';
  END IF;

  g := public.p9_prepare_quote_approval_delivery_by_system(p_request_id);
  SELECT * INTO p FROM public.p9_quote_approval_delivery_parts
   WHERE request_id = p_request_id AND component = p_component FOR UPDATE;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'P9_DELIVERY_COMPONENT_ALREADY_CLAIMED';
  END IF;

  SELECT * INTO opener FROM public.p9_quote_approval_delivery_parts
   WHERE request_id = p_request_id AND component = 'opening_template';
  SELECT * INTO report_part FROM public.p9_quote_approval_delivery_parts
   WHERE request_id = p_request_id AND component = 'report';

  IF p_component = 'opening_template' THEN
    IF p_inbound_window_message_id IS NOT NULL THEN
      RAISE EXCEPTION 'P9_DELIVERY_OPENING_INBOUND_NOT_ALLOWED';
    END IF;
    -- Nao abrir template desnecessario quando ja houve inbound recente.
    IF EXISTS (
      SELECT 1 FROM public.store_assistant_messages AS m
       WHERE m.organization_id = (g->>'organization_id')::uuid
         AND m.store_id = (g->>'store_id')::uuid
         AND m.sender_role = 'store_responsible' AND m.direction = 'incoming'
         AND m.metadata->>'origin' = 'whatsapp'
         AND m.metadata->>'responsible_id' = g->>'responsible_id'
         AND NULLIF(btrim(COALESCE(m.metadata->>'external_message_id','')), '') IS NOT NULL
         AND m.created_at > now() - interval '24 hours'
    ) THEN
      RAISE EXCEPTION 'P9_DELIVERY_RECENT_INBOUND_USE_FREEFORM';
    END IF;
  ELSE
    IF p_inbound_window_message_id IS NULL THEN
      RAISE EXCEPTION 'P9_DELIVERY_INBOUND_WINDOW_REQUIRED';
    END IF;
    SELECT id, created_at INTO win FROM public.store_assistant_messages AS m
     WHERE m.id = p_inbound_window_message_id
       AND m.organization_id = (g->>'organization_id')::uuid
       AND m.store_id = (g->>'store_id')::uuid
       AND m.sender_role = 'store_responsible' AND m.direction = 'incoming'
       AND m.metadata->>'origin' = 'whatsapp'
       AND m.metadata->>'responsible_id' = g->>'responsible_id'
       AND NULLIF(btrim(COALESCE(m.metadata->>'external_message_id','')), '') IS NOT NULL
       AND m.created_at > now() - interval '24 hours';
    IF NOT FOUND THEN RAISE EXCEPTION 'P9_DELIVERY_WHATSAPP_WINDOW_NOT_VERIFIED'; END IF;
    IF opener.status IN ('claimed','uncertain') THEN
      RAISE EXCEPTION 'P9_DELIVERY_OPENING_NOT_RECONCILED';
    END IF;
    IF opener.status = 'accepted' AND win.created_at <= opener.accepted_at THEN
      RAISE EXCEPTION 'P9_DELIVERY_NO_INBOUND_AFTER_OPENING';
    END IF;
    IF p_component = 'pdf' AND report_part.status <> 'accepted' THEN
      RAISE EXCEPTION 'P9_DELIVERY_REPORT_NOT_ACCEPTED';
    END IF;
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.p9_quote_approval_delivery_parts
     SET status = 'claimed', claim_token = v_token, claimed_at = now(),
         inbound_window_message_id = p_inbound_window_message_id, updated_at = now()
   WHERE id = p.id;
  RETURN g || jsonb_build_object('component', p_component, 'claim_token', v_token,
     'state', 'claimed', 'pdf_store_file_id', g->>'pdf_store_file_id');
END;
$body$;

CREATE FUNCTION public.p9_finish_quote_approval_delivery_by_system(
 p_request_id uuid, p_component text, p_claim_token uuid,
 p_result text, p_external_message_id text DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $body$
DECLARE r record; p record; report_part record; pdf_part record; v_live boolean := false;
        v_result text; v_msg text; v_reason text;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'P9_DELIVERY_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_request_id IS NULL OR p_claim_token IS NULL
     OR p_component NOT IN ('opening_template','report','pdf') OR p_component IS NULL
     OR p_result NOT IN ('accepted','failed','uncertain') OR p_result IS NULL THEN
    RAISE EXCEPTION 'P9_DELIVERY_FINISH_ARGUMENTS_INVALID';
  END IF;
  v_result := p_result;
  v_msg := NULLIF(btrim(COALESCE(p_external_message_id,'')), '');
  v_reason := NULLIF(btrim(COALESCE(p_reason,'')), '');
  IF (v_result='accepted' AND (v_msg IS NULL OR length(v_msg) > 512 OR v_reason IS NOT NULL))
     OR (v_result <> 'accepted' AND (v_reason IS NULL OR length(v_reason) > 1024
                                     OR v_msg IS NOT NULL)) THEN
    RAISE EXCEPTION 'P9_DELIVERY_FINISH_EVIDENCE_INVALID';
  END IF;

  -- Mesmo lock por oportunidade do writer original, antes de atualizar estado.
  SELECT organization_id, store_id, commercial_opportunity_id INTO r
    FROM public.p9_responsible_commercial_approval_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_DELIVERY_REQUEST_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'p9_quote_approval:' || r.organization_id::text || ':' || r.store_id::text || ':' ||
    r.commercial_opportunity_id::text, 0));
  SELECT * INTO r FROM public.p9_responsible_commercial_approval_requests
   WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO p FROM public.p9_quote_approval_delivery_parts
   WHERE request_id = p_request_id AND component = p_component FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_DELIVERY_PART_NOT_PREPARED'; END IF;
  IF p.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'P9_DELIVERY_CLAIM_TOKEN_MISMATCH';
  END IF;
  IF p.status IN ('accepted','failed','uncertain') THEN
    IF p.status = v_result AND p.external_message_id IS NOT DISTINCT FROM v_msg
       AND p.failure_reason IS NOT DISTINCT FROM v_reason THEN
      RETURN jsonb_build_object('request_id',p_request_id, 'component',p_component,
          'state',p.status, 'idempotent',true, 'request_status',r.status);
    END IF;
    RAISE EXCEPTION 'P9_DELIVERY_FINALIZATION_CONFLICT';
  END IF;
  IF p.status <> 'claimed' THEN RAISE EXCEPTION 'P9_DELIVERY_NOT_CLAIMED'; END IF;

  -- Registrar primeiro o resultado externo para jamais perder aceite Meta em
  -- uma reconciliacao por quote alterado / request superseded.
  UPDATE public.p9_quote_approval_delivery_parts
     SET status=v_result, external_message_id=v_msg, failure_reason=v_reason,
         finalized_at=now(), accepted_at=CASE WHEN v_result='accepted' THEN now() ELSE NULL END,
         updated_at=now()
   WHERE id=p.id;

  IF r.status = 'pending_dispatch' AND v_result='uncertain' THEN
    UPDATE public.p9_responsible_commercial_approval_requests
       SET status='dispatch_uncertain', updated_at=now()
     WHERE id=p_request_id;
  ELSIF r.status='pending_dispatch' AND v_result='accepted'
         AND p_component IN ('report','pdf') THEN
    SELECT * INTO report_part FROM public.p9_quote_approval_delivery_parts
     WHERE request_id=p_request_id AND component='report';
    SELECT * INTO pdf_part FROM public.p9_quote_approval_delivery_parts
     WHERE request_id=p_request_id AND component='pdf';
    IF report_part.status='accepted' AND pdf_part.status='accepted' THEN
      -- Erro de readiness apos Meta aceita nao pode apagar o ack: fail closed.
      BEGIN
        PERFORM public.p9_quote_delivery_current_guard_internal(p_request_id);
        v_live := true;
      EXCEPTION WHEN OTHERS THEN
        v_live := false;
      END;
      IF v_live THEN
        UPDATE public.p9_responsible_commercial_approval_requests
           SET status='awaiting_responsible',
               outbound_external_message_id=pdf_part.external_message_id,
               updated_at=now()
         WHERE id=p_request_id AND status='pending_dispatch';
      ELSE
        UPDATE public.p9_responsible_commercial_approval_requests
           SET status='dispatch_uncertain', updated_at=now()
         WHERE id=p_request_id AND status='pending_dispatch';
      END IF;
    END IF;
  END IF;
  SELECT status INTO v_result FROM public.p9_responsible_commercial_approval_requests
   WHERE id=p_request_id;
  RETURN jsonb_build_object('request_id',p_request_id,'component',p_component,
    'state',p_result, 'idempotent',false, 'request_status',v_result);
END;
$body$;

-- A autoridade deve ser detida por postgres, nao por um papel de API.
ALTER FUNCTION public.p9_quote_delivery_current_guard_internal(uuid) OWNER TO postgres;
ALTER FUNCTION public.p9_prepare_quote_approval_delivery_by_system(uuid) OWNER TO postgres;
ALTER FUNCTION public.p9_claim_quote_approval_delivery_by_system(uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.p9_finish_quote_approval_delivery_by_system(uuid,text,uuid,text,text,text) OWNER TO postgres;

-- Sem grants implicitos via PUBLIC, nem escrita direta por service_role.
REVOKE ALL ON FUNCTION public.p9_quote_delivery_current_guard_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.p9_prepare_quote_approval_delivery_by_system(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p9_claim_quote_approval_delivery_by_system(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p9_finish_quote_approval_delivery_by_system(uuid,text,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p9_prepare_quote_approval_delivery_by_system(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.p9_claim_quote_approval_delivery_by_system(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.p9_finish_quote_approval_delivery_by_system(uuid,text,uuid,text,text,text)
  TO service_role;

DO $permissions$
BEGIN
  IF has_table_privilege('service_role','public.p9_quote_approval_delivery_parts','INSERT')
    OR has_table_privilege('service_role','public.p9_quote_approval_delivery_parts','UPDATE')
    OR has_table_privilege('service_role','public.p9_quote_approval_delivery_parts','DELETE')
    OR has_function_privilege('service_role',
        'public.p9_quote_delivery_current_guard_internal(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'P9_DELIVERY_DIRECT_WRITE_OR_INTERNAL_CALL_GRANTED';
  END IF;
END;
$permissions$;

COMMENT ON TABLE public.p9_quote_approval_delivery_parts IS
'P9 9.3-B: ledger de template de abertura, relatorio e PDF para responsavel; cada parte tem claim unico, ack Meta ou uncertain. Sem envio automatico nem retry de resultados incertos.';
COMMIT;
