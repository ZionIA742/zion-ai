-- ZION / Pilar 9 / 9.3-B
-- Fencing atomico de claims somente no caminho de materializacao dos workers.
-- A RPC original permanece intacta para simulacoes e outros callers sem worker.
-- Nao altera dados historicos, crons, filas ou transporte externo.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'
  ) IS NULL
  OR pg_catalog.to_regclass('public.channel_whatsapp_inbox') IS NULL
  OR pg_catalog.to_regclass('public.ai_run_queue') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'ZION_P9_WORKER_FENCE_PRECONDITION_MISSING';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.materialize_sales_ai_reply_set_by_worker_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_anchor_message_id uuid,
  p_commercial_opportunity_id uuid,
  p_ai_text text,
  p_outbound_kind text,
  p_external_authorized boolean,
  p_claim_kind text,
  p_claim_id uuid,
  p_claim_token uuid,
  p_document_actions jsonb DEFAULT '[]'::jsonb,
  p_photo_action jsonb DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  response_set_id uuid,
  text_message_id uuid,
  document_message_ids uuid[],
  photo_message_id uuid,
  request_fingerprint text,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  v_expires_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'ZION_WORKER_SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_claim_id IS NULL OR p_claim_token IS NULL
     OR p_claim_kind IS NULL OR p_claim_kind NOT IN ('inbox', 'ai_run_queue') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'ZION_WORKER_FENCE_INVALID_ARGUMENTS';
  END IF;

  -- FOR UPDATE e mantido durante TODA a chamada abaixo (mesma transacao).
  -- Outro claim/reclaim desse registro nao atravessa a materializacao.
  IF p_claim_kind = 'inbox' THEN
    SELECT i.claim_expires_at INTO v_expires_at
    FROM public.channel_whatsapp_inbox AS i
    WHERE i.id = p_claim_id
      AND i.organization_id = p_organization_id
      AND i.store_id = p_store_id
      AND i.claim_token = p_claim_token
      AND i.processed_at IS NULL
      AND i.payload ->> 'source' = 'meta_whatsapp_webhook'
      AND i.attempt_count BETWEEN 1 AND 3
    FOR UPDATE OF i;
  ELSE
    SELECT q.claim_expires_at INTO v_expires_at
    FROM public.ai_run_queue AS q
    WHERE q.id = p_claim_id
      AND q.organization_id = p_organization_id
      AND q.store_id = p_store_id
      AND q.claim_token = p_claim_token
      AND q.processed_at IS NULL
      AND q.attempt_count BETWEEN 1 AND 3
    FOR UPDATE OF q;
  END IF;

  IF NOT FOUND OR v_expires_at IS NULL
     OR v_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'ZION_WORKER_FENCE_CLAIM_INVALID_OR_EXPIRED';
  END IF;

  -- A RPC original conserva os checks comerciais e a idempotencia por ancora.
  RETURN QUERY
  SELECT m.response_set_id, m.text_message_id, m.document_message_ids,
         m.photo_message_id, m.request_fingerprint, m.replayed
  FROM public.materialize_sales_ai_reply_set_by_system(
    p_organization_id, p_store_id, p_conversation_id, p_lead_id,
    p_anchor_message_id, p_commercial_opportunity_id, p_ai_text,
    p_outbound_kind, p_external_authorized, p_document_actions,
    p_photo_action, p_payload
  ) AS m;
END;
$function$;

ALTER FUNCTION public.materialize_sales_ai_reply_set_by_worker_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.materialize_sales_ai_reply_set_by_worker_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.materialize_sales_ai_reply_set_by_worker_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb
) TO service_role;

COMMIT;
