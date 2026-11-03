-- ZION / P9.9.3-C.5
-- Autoridade para conferência de documento contratual recebido via IA Assistente.
-- Não cria assinatura eletrônica do cliente ou da loja.
-- Identidade humana nominal não é registrada neste evento.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Acrescentar um event_key sem substituir nem reduzir o CHECK real já instalado.
-- A expressão anterior é preservada integralmente, independentemente
-- de novas chaves aceitas em outras frentes.
DO $p9c5_event_key$
DECLARE
  v_predicate text;
BEGIN
  SELECT pg_catalog.pg_get_expr(c.conbin, c.conrelid)
    INTO v_predicate
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.store_business_events'::pg_catalog.regclass
    AND c.conname = 'store_business_events_event_key_check'
    AND c.contype = 'c';

  IF v_predicate IS NULL OR pg_catalog.btrim(v_predicate) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'P9_C5_EVENT_KEY_CHECK_NOT_FOUND';
  END IF;

  EXECUTE 'ALTER TABLE public.store_business_events '
       || 'DROP CONSTRAINT store_business_events_event_key_check';
  EXECUTE pg_catalog.format(
    'ALTER TABLE public.store_business_events '
      || 'ADD CONSTRAINT store_business_events_event_key_check '
      || 'CHECK ((%s) OR event_key = %L)',
    v_predicate,
    'contrato_conferencia_documental'
  );
END;
$p9c5_event_key$;

-- Uma notificação pode ter uma recusa seguida de uma confirmação,
-- mas não duas decisões iguais materializadas.
CREATE UNIQUE INDEX IF NOT EXISTS
  store_business_events_contract_doc_decision_once_uidx
ON public.store_business_events (
  organization_id, store_id,
  (event_payload ->> 'notification_id'),
  (event_payload ->> 'decision')
)
WHERE event_key = 'contrato_conferencia_documental'
  AND event_payload ->> 'schema' = 'received_contract_document_decision_v1'
  AND NULLIF(BTRIM(event_payload ->> 'notification_id'), '') IS NOT NULL;

-- Uma mensagem humana não pode ser reaproveitada para decidir outro contrato.
CREATE UNIQUE INDEX IF NOT EXISTS
  store_business_events_contract_doc_decision_message_uidx
ON public.store_business_events (
  organization_id, store_id,
  (event_payload ->> 'decision_message_id')
)
WHERE event_key = 'contrato_conferencia_documental'
  AND event_payload ->> 'schema' = 'received_contract_document_decision_v1'
  AND NULLIF(BTRIM(event_payload ->> 'decision_message_id'), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.confirm_received_contract_document_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_notification_id uuid,
  p_contract_id uuid,
  p_contract_version_id uuid,
  p_evidence_source_message_id uuid,
  p_decision_message_id uuid,
  p_channel text,
  p_decision text
)
RETURNS TABLE (
  outcome text,
  decision text,
  notification_id uuid,
  contract_id uuid,
  contract_version_id uuid,
  evidence_source_message_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public', 'pg_temp'
SET row_security = 'off'
AS $function$
DECLARE
  v_q public.store_assistant_notification_queue%ROWTYPE;
  v_m public.store_assistant_messages%ROWTYPE;
  v_c public.sales_contracts%ROWTYPE;
  v_v public.sales_contract_versions%ROWTYPE;
  v_e public.store_business_events%ROWTYPE;
  v_existing public.store_business_events%ROWTYPE;
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_event_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_notification_id IS NULL OR p_contract_id IS NULL
     OR p_contract_version_id IS NULL OR p_evidence_source_message_id IS NULL
     OR p_decision_message_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_C5_MISSING_IDENTITY';
  END IF;
  IF v_decision NOT IN ('confirmed','rejected') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_C5_INVALID_DECISION';
  END IF;
  IF v_channel NOT IN ('whatsapp_assistant','assistant_chat') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_C5_INVALID_CHANNEL';
  END IF;

  -- Uma mensagem de decisão deve ser efetivamente humana e da mesma loja.
  SELECT m.* INTO v_m
  FROM public.store_assistant_messages m
  WHERE m.id = p_decision_message_id
    AND m.organization_id = p_organization_id
    AND m.store_id = p_store_id
    AND m.sender = 'human'
    AND m.sender_role = 'store_responsible'
    AND m.direction IN ('incoming','internal')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_DECISION_MESSAGE_NOT_FOUND';
  END IF;
  IF v_decision = 'confirmed' AND lower(btrim(v_m.content)) <> 'sim' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_DECISION_MESSAGE_MISMATCH';
  END IF;
  IF v_decision = 'rejected' AND lower(btrim(v_m.content)) NOT IN ('não','nao') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_DECISION_MESSAGE_MISMATCH';
  END IF;
  IF v_channel = 'whatsapp_assistant'
     AND (v_m.metadata ->> 'origin') IS DISTINCT FROM 'whatsapp' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_CHANNEL_MISMATCH';
  END IF;
  IF v_channel = 'assistant_chat'
     AND (v_m.metadata ->> 'origin') = 'whatsapp' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_CHANNEL_MISMATCH';
  END IF;

  SELECT q.* INTO v_q
  FROM public.store_assistant_notification_queue q
  WHERE q.id = p_notification_id
    AND q.organization_id = p_organization_id
    AND q.store_id = p_store_id
    AND q.context ->> 'related_contract_id' = p_contract_id::text
    AND q.context ->> 'document_version_id' = p_contract_version_id::text
    AND q.context ->> 'received_evidence_source_message_id' = p_evidence_source_message_id::text
    AND NULLIF(btrim(q.context ->> 'event_key'), '') IS NOT NULL
    AND q.status <> 'cancelled'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_NOTIFICATION_NOT_FOUND';
  END IF;
  IF v_q.thread_id IS NULL OR v_m.thread_id IS DISTINCT FROM v_q.thread_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_THREAD_MISMATCH';
  END IF;

  SELECT e.* INTO v_e
  FROM public.store_business_events e
  WHERE e.organization_id = p_organization_id
    AND e.store_id = p_store_id
    AND e.event_key = 'contract_uploaded'
    AND e.event_payload ->> 'schema' = 'received_contract_document_evidence'
    AND e.event_payload ->> 'source_message_id' = p_evidence_source_message_id::text
    AND COALESCE(
      e.event_payload ->> 'contract_id',
      e.event_payload ->> 'related_contract_id'
    ) = p_contract_id::text
    AND COALESCE(
      e.event_payload ->> 'contract_version_id',
      e.event_payload ->> 'document_version_id'
    ) = p_contract_version_id::text
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_EVIDENCE_NOT_FOUND';
  END IF;

  -- A linha do contrato serializa decisões concorrentes sobre este contrato.
  SELECT c.* INTO v_c
  FROM public.sales_contracts c
  WHERE c.id = p_contract_id
    AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_CONTRACT_NOT_FOUND';
  END IF;

  SELECT v.* INTO v_v
  FROM public.sales_contract_versions v
  WHERE v.id = p_contract_version_id
    AND v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id
    AND v.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_c.current_version_id IS DISTINCT FROM p_contract_version_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_VERSION_NOT_CURRENT';
  END IF;

  -- Idempotência: replay da mesma decisão não deve gerar novos efeitos.
  SELECT e.* INTO v_existing
  FROM public.store_business_events e
  WHERE e.organization_id = p_organization_id
    AND e.store_id = p_store_id
    AND e.event_key = 'contrato_conferencia_documental'
    AND e.event_payload ->> 'schema' = 'received_contract_document_decision_v1'
    AND e.event_payload ->> 'notification_id' = p_notification_id::text
    AND e.event_payload ->> 'decision' = v_decision
  LIMIT 1;
  IF FOUND THEN
    IF (v_existing.event_payload ->> 'contract_id') IS DISTINCT FROM p_contract_id::text
       OR (v_existing.event_payload ->> 'contract_version_id') IS DISTINCT FROM p_contract_version_id::text
       OR (v_existing.event_payload ->> 'evidence_source_message_id') IS DISTINCT FROM p_evidence_source_message_id::text THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_REPLAY_CONFLICT';
    END IF;
    RETURN QUERY SELECT 'replayed'::text, v_decision,
      p_notification_id, p_contract_id, p_contract_version_id,
      p_evidence_source_message_id;
    RETURN;
  END IF;

  IF v_c.status IN ('cancelled','expired','failed','completed')
     OR v_v.status IN ('superseded','failed','completed') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C5_CONTRACT_NOT_PENDING';
  END IF;

  INSERT INTO public.store_business_events (
    organization_id, store_id, lead_id, conversation_id,
    event_key, actor_type, actor_user_id, event_payload
  ) VALUES (
    p_organization_id, p_store_id, v_c.lead_id, NULL,
    'contrato_conferencia_documental', 'human', NULL,
    jsonb_build_object(
      'schema','received_contract_document_decision_v1',
      'source','zion_assistant',
      'actor','usuario_zion_via_ia_assistente',
      'channel',v_channel,
      'decision',v_decision,
      'notification_id',p_notification_id,
      'decision_message_id',p_decision_message_id,
      'contract_id',p_contract_id,
      'contract_version_id',p_contract_version_id,
      'evidence_source_message_id',p_evidence_source_message_id,
      'received_document_event_id',v_e.id
    )
  ) RETURNING id INTO v_event_id;

  IF v_decision = 'confirmed' THEN
    UPDATE public.sales_contract_versions v
    SET status = 'completed'
    WHERE v.id = p_contract_version_id
      AND v.contract_id = p_contract_id
      AND v.organization_id = p_organization_id
      AND v.store_id = p_store_id;

    UPDATE public.sales_contracts c
    SET status = 'completed', completed_at = now()
    WHERE c.id = p_contract_id
      AND c.organization_id = p_organization_id
      AND c.store_id = p_store_id
      AND c.current_version_id = p_contract_version_id;

    -- Intencionalmente não atualiza customer_signed_at, store_signed_at
    -- ou completed_by: conferência documental não é assinatura eletrônica.
  END IF;

  RETURN QUERY SELECT 'decided'::text, v_decision,
    p_notification_id, p_contract_id, p_contract_version_id,
    p_evidence_source_message_id;
END;
$function$;

ALTER FUNCTION public.confirm_received_contract_document_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_received_contract_document_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_received_contract_document_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text
) TO service_role;
COMMIT;
