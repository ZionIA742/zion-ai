-- ZION / P9 9.3-B -- worker claims for Meta inbox and AI run queue
-- APPLY ONLY AFTER REVIEW. This script does not change cron jobs or reprocess old events.
BEGIN;

ALTER TABLE public.channel_whatsapp_inbox
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_by text;

ALTER TABLE public.ai_run_queue
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_by text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbox_worker_claim
  ON public.channel_whatsapp_inbox (organization_id, store_id, received_at)
  WHERE processed_at IS NULL
    AND (payload ->> 'source') = 'meta_whatsapp_webhook';

CREATE INDEX IF NOT EXISTS idx_ai_run_queue_worker_claim
  ON public.ai_run_queue (organization_id, store_id, enqueued_at)
  WHERE processed_at IS NULL;

-- Internal helper: do not claim a scheduled resume before resumeAt.
-- Malformed times are passed to the worker for explicit handling instead of silently hidden.
CREATE OR REPLACE FUNCTION public._zion_ai_run_resume_is_due(p_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $function$
DECLARE
  v_raw text;
  v_at timestamptz;
BEGIN
  v_raw := p_input ->> 'resumeAt';
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RETURN true;
  END IF;
  BEGIN
    v_at := v_raw::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN true;
  END;
  RETURN v_at <= clock_timestamp();
END;
$function$;

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

  -- A worker that exhausted all attempts and disappeared must become terminal.
  UPDATE public.channel_whatsapp_inbox AS i
  SET processing_error = 'sales_ai_failed_final:lease_expired_max_attempts',
      claim_token = NULL, claim_expires_at = NULL, claimed_by = NULL
  WHERE i.organization_id = p_organization_id AND i.store_id = p_store_id
    AND i.processed_at IS NULL
    AND i.payload ->> 'source' = 'meta_whatsapp_webhook'
    AND i.attempt_count >= p_max_attempts
    AND i.claim_expires_at IS NOT NULL
    AND i.claim_expires_at <= clock_timestamp()
    AND (i.processing_error IS NULL
         OR i.processing_error LIKE 'sales_ai_retryable:%');

  RETURN QUERY
  WITH picked AS (
    SELECT i.id
    FROM public.channel_whatsapp_inbox AS i
    WHERE i.organization_id = p_organization_id AND i.store_id = p_store_id
      AND i.processed_at IS NULL
      AND i.payload ->> 'source' = 'meta_whatsapp_webhook'
      AND (i.processing_error IS NULL
           OR i.processing_error LIKE 'sales_ai_retryable:%')
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

CREATE OR REPLACE FUNCTION public.claim_ai_run_queue_tasks_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer,
  p_claimed_by text,
  p_lease_seconds integer,
  p_max_attempts integer
)
RETURNS TABLE (
  id uuid, organization_id uuid, store_id uuid, conversation_id uuid,
  lead_id uuid, queue_key text, input jsonb, enqueued_at timestamptz,
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

  UPDATE public.ai_run_queue AS q
  SET processing_error = 'sales_ai_failed_final:lease_expired_max_attempts',
      claim_token = NULL, claim_expires_at = NULL, claimed_by = NULL
  WHERE q.organization_id = p_organization_id AND q.store_id = p_store_id
    AND q.processed_at IS NULL AND q.attempt_count >= p_max_attempts
    AND q.claim_expires_at IS NOT NULL AND q.claim_expires_at <= clock_timestamp()
    AND (q.processing_error IS NULL
         OR q.processing_error LIKE 'sales_ai_retryable:%');

  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.ai_run_queue AS q
    WHERE q.organization_id = p_organization_id AND q.store_id = p_store_id
      AND q.processed_at IS NULL
      AND (q.processing_error IS NULL
           OR q.processing_error LIKE 'sales_ai_retryable:%')
      AND q.attempt_count < p_max_attempts
      AND (q.claim_expires_at IS NULL OR q.claim_expires_at <= clock_timestamp())
      AND public._zion_ai_run_resume_is_due(q.input)
    ORDER BY q.enqueued_at ASC, q.id ASC
    LIMIT p_limit
    FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.ai_run_queue AS q
  SET claim_token = pg_catalog.gen_random_uuid(),
      claim_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      claimed_by = p_claimed_by,
      attempt_count = q.attempt_count + 1
  FROM picked AS p
  WHERE q.id = p.id
  RETURNING q.id, q.organization_id, q.store_id, q.conversation_id,
            q.lead_id, q.queue_key, q.input, q.enqueued_at,
            q.processed_at, q.processing_error, q.claim_token,
            q.claim_expires_at, q.attempt_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_whatsapp_inbox_event_claim_by_system(
  p_organization_id uuid, p_store_id uuid, p_inbox_id uuid, p_claim_token uuid
)
RETURNS TABLE(ok boolean, id uuid, claim_token uuid, claim_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_WORKER_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT true, i.id, i.claim_token, i.claim_expires_at
  FROM public.channel_whatsapp_inbox AS i
  WHERE i.organization_id = p_organization_id AND i.store_id = p_store_id
    AND i.id = p_inbox_id AND i.claim_token = p_claim_token
    AND i.claim_token IS NOT NULL AND i.processed_at IS NULL
    AND i.claim_expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, p_inbox_id, p_claim_token, NULL::timestamptz;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_ai_run_queue_task_claim_by_system(
  p_organization_id uuid, p_store_id uuid, p_queue_id uuid, p_claim_token uuid
)
RETURNS TABLE(ok boolean, id uuid, claim_token uuid, claim_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_WORKER_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT true, q.id, q.claim_token, q.claim_expires_at
  FROM public.ai_run_queue AS q
  WHERE q.organization_id = p_organization_id AND q.store_id = p_store_id
    AND q.id = p_queue_id AND q.claim_token = p_claim_token
    AND q.claim_token IS NOT NULL AND q.processed_at IS NULL
    AND q.claim_expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, p_queue_id, p_claim_token, NULL::timestamptz;
  END IF;
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
          WHEN p_outcome = 'failed_final' OR i.attempt_count >= p_max_attempts
            THEN 'sales_ai_failed_final:' || left(coalesce(nullif(btrim(p_error_text),''),'unspecified'),900)
          ELSE 'sales_ai_retryable:' || left(coalesce(nullif(btrim(p_error_text),''),'unspecified'),900)
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
         (c.processing_error LIKE 'sales_ai_failed_final:%')
  FROM changed AS c;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, p_inbox_id, p_organization_id, p_store_id,
           p_claim_token, p_outcome, NULL::timestamptz,
           NULL::text, NULL::integer, NULL::boolean;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_ai_run_queue_task_by_system(
  p_organization_id uuid, p_store_id uuid, p_queue_id uuid,
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
    UPDATE public.ai_run_queue AS q
    SET processed_at = CASE WHEN p_outcome = 'processed' THEN clock_timestamp() ELSE NULL END,
        processing_error = CASE
          WHEN p_outcome = 'processed' THEN NULL
          WHEN p_outcome = 'failed_final' OR q.attempt_count >= p_max_attempts
            THEN 'sales_ai_failed_final:' || left(coalesce(nullif(btrim(p_error_text),''),'unspecified'),900)
          ELSE 'sales_ai_retryable:' || left(coalesce(nullif(btrim(p_error_text),''),'unspecified'),900)
        END,
        claim_token = NULL, claim_expires_at = NULL, claimed_by = NULL
    WHERE q.organization_id = p_organization_id AND q.store_id = p_store_id
      AND q.id = p_queue_id AND q.claim_token = p_claim_token
      AND p_claim_token IS NOT NULL AND q.claim_expires_at > clock_timestamp()
      AND q.processed_at IS NULL
    RETURNING q.id, q.organization_id, q.store_id, q.processed_at,
              q.processing_error, q.attempt_count
  )
  SELECT true, c.id, c.organization_id, c.store_id,
         p_claim_token, p_outcome, c.processed_at, c.processing_error,
         c.attempt_count,
         (c.processing_error LIKE 'sales_ai_failed_final:%')
  FROM changed AS c;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, p_queue_id, p_organization_id, p_store_id,
           p_claim_token, p_outcome, NULL::timestamptz,
           NULL::text, NULL::integer, NULL::boolean;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._zion_ai_run_resume_is_due(jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_whatsapp_inbox_events_by_system(uuid,uuid,integer,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_inbox_event_by_system(uuid,uuid,uuid,uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_whatsapp_inbox_event_claim_by_system(uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ai_run_queue_tasks_by_system(uuid,uuid,integer,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_ai_run_queue_task_by_system(uuid,uuid,uuid,uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_ai_run_queue_task_claim_by_system(uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_whatsapp_inbox_events_by_system(uuid,uuid,integer,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_inbox_event_by_system(uuid,uuid,uuid,uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_whatsapp_inbox_event_claim_by_system(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_run_queue_tasks_by_system(uuid,uuid,integer,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_ai_run_queue_task_by_system(uuid,uuid,uuid,uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_ai_run_queue_task_claim_by_system(uuid,uuid,uuid,uuid) TO service_role;

COMMIT;
