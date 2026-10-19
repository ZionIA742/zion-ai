-- ZION / P9 9.3-B
-- Distinguish Meta status webhook failures from Sales AI failures.
-- Additive migration: changes two inbox worker RPC bodies only.
-- Does not rewrite existing records, reprocess events or send messages.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.channel_whatsapp_inbox') IS NULL
     OR to_regprocedure('public.claim_whatsapp_inbox_events_by_system(uuid,uuid,integer,text,integer,integer)') IS NULL
     OR to_regprocedure('public.finalize_whatsapp_inbox_event_by_system(uuid,uuid,uuid,uuid,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'P9_9_3_B_STATUS_CLASSIFICATION_PRECONDITION_MISSING';
  END IF;
END;
$preflight$;

-- Reclaim expired attempts without mislabeling Meta status failures as AI errors.
-- Include the new retryable status prefix in the claimable predicate.
CREATE OR REPLACE FUNCTION public.claim_whatsapp_inbox_events_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer,
  p_claimed_by text,
  p_lease_seconds integer,
  p_max_attempts integer
)
RETURNS TABLE (
  id uuid, organization_id uuid, store_id uuid, provider text,
  external_event_id text, payload jsonb, received_at timestamptz,
  processed_at timestamptz, processing_error text,
  claim_token uuid, claim_expires_at timestamptz, attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_WORKER_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 3600
     OR p_max_attempts IS DISTINCT FROM 3
     OR p_claimed_by IS NULL OR btrim(p_claimed_by) = '' OR length(p_claimed_by) > 200 THEN
    RAISE EXCEPTION 'ZION_WORKER_INVALID_CLAIM_ARGUMENTS' USING ERRCODE = '22023';
  END IF;

  UPDATE public.channel_whatsapp_inbox AS i
  SET processing_error =
        CASE WHEN i.payload ->> 'event_kind' = 'status'
          THEN 'whatsapp_status_failed_final:lease_expired_max_attempts'
          ELSE 'sales_ai_failed_final:lease_expired_max_attempts'
        END,
      claim_token = NULL, claim_expires_at = NULL, claimed_by = NULL
  WHERE i.organization_id = p_organization_id AND i.store_id = p_store_id
    AND i.processed_at IS NULL
    AND i.payload ->> 'source' = 'meta_whatsapp_webhook'
    AND i.attempt_count >= p_max_attempts
    AND i.claim_expires_at IS NOT NULL
    AND i.claim_expires_at <= clock_timestamp()
    AND (i.processing_error IS NULL
         OR i.processing_error LIKE 'sales_ai_retryable:%'
         OR i.processing_error LIKE 'whatsapp_status_retryable:%');

  RETURN QUERY
  WITH picked AS (
    SELECT i.id
    FROM public.channel_whatsapp_inbox AS i
    WHERE i.organization_id = p_organization_id AND i.store_id = p_store_id
      AND i.processed_at IS NULL
      AND i.payload ->> 'source' = 'meta_whatsapp_webhook'
      AND (i.processing_error IS NULL
           OR i.processing_error LIKE 'sales_ai_retryable:%'
           OR i.processing_error LIKE 'whatsapp_status_retryable:%')
      AND i.attempt_count < p_max_attempts
      AND (i.claim_expires_at IS NULL OR i.claim_expires_at <= clock_timestamp())
    ORDER BY i.received_at ASC, i.id ASC
    LIMIT p_limit
    FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.channel_whatsapp_inbox AS i
  SET claim_token = pg_catalog.gen_random_uuid(),
      claim_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      claimed_by = p_claimed_by,
      attempt_count = i.attempt_count + 1
  FROM picked AS p
  WHERE i.id = p.id
  RETURNING i.id, i.organization_id, i.store_id, i.provider,
            i.external_event_id, i.payload, i.received_at, i.processed_at,
            i.processing_error, i.claim_token, i.claim_expires_at, i.attempt_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_whatsapp_inbox_event_by_system(
  p_organization_id uuid, p_store_id uuid, p_inbox_id uuid,
  p_claim_token uuid, p_outcome text, p_error_text text, p_max_attempts integer
)
RETURNS TABLE(
  ok boolean, id uuid, organization_id uuid, store_id uuid,
  claim_token uuid, outcome text, processed_at timestamptz,
  processing_error text, attempt_count integer, terminal boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_WORKER_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('processed','retryable','failed_final')
     OR p_max_attempts IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'ZION_WORKER_INVALID_FINALIZATION_ARGUMENTS' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH changed AS (
    UPDATE public.channel_whatsapp_inbox AS i
    SET processed_at = CASE WHEN p_outcome = 'processed' THEN clock_timestamp() ELSE NULL END,
        processing_error = CASE
          WHEN p_outcome = 'processed' THEN NULL
          WHEN p_outcome = 'failed_final' OR i.attempt_count >= p_max_attempts THEN
            (CASE WHEN i.payload ->> 'event_kind' = 'status'
               THEN 'whatsapp_status_failed_final:'
               ELSE 'sales_ai_failed_final:'
             END) || left(coalesce(nullif(btrim(p_error_text),''),'unspecified'),900)
          ELSE
            (CASE WHEN i.payload ->> 'event_kind' = 'status'
               THEN 'whatsapp_status_retryable:'
               ELSE 'sales_ai_retryable:'
             END) || left(coalesce(nullif(btrim(p_error_text),''),'unspecified'),900)
        END,
        claim_token = NULL, claim_expires_at = NULL, claimed_by = NULL
    WHERE i.organization_id = p_organization_id AND i.store_id = p_store_id
      AND i.id = p_inbox_id AND i.claim_token = p_claim_token
      AND p_claim_token IS NOT NULL AND i.claim_expires_at > clock_timestamp()
      AND i.processed_at IS NULL
    RETURNING i.id, i.organization_id, i.store_id, i.processed_at,
              i.processing_error, i.attempt_count
  )
  SELECT true, c.id, c.organization_id, c.store_id,
         p_claim_token, p_outcome, c.processed_at, c.processing_error,
         c.attempt_count,
         (c.processing_error LIKE 'sales_ai_failed_final:%'
          OR c.processing_error LIKE 'whatsapp_status_failed_final:%')
  FROM changed AS c;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, p_inbox_id, p_organization_id, p_store_id,
           p_claim_token, p_outcome, NULL::timestamptz,
           NULL::text, NULL::integer, NULL::boolean;
  END IF;
END;
$function$;

-- Preserve privilege boundary even if the database had ACL drift.
REVOKE ALL ON FUNCTION public.claim_whatsapp_inbox_events_by_system(
  uuid,uuid,integer,text,integer,integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_inbox_event_by_system(
  uuid,uuid,uuid,uuid,text,text,integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_inbox_events_by_system(
  uuid,uuid,integer,text,integer,integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_inbox_event_by_system(
  uuid,uuid,uuid,uuid,text,text,integer
) TO service_role;

COMMIT;
