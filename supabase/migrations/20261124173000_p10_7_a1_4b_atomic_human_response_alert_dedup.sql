BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- MICROETAPA 10.7-A1.4b
-- Deduplicacao atomica somente dos alertas do scanner de resposta humana.
-- Nenhum registro historico e removido ou reescrito.

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.store_assistant_notification_queue q
    WHERE q.notification_type = 'important_alert'
      AND q.context ->> 'reason' = 'human_response_pending'
      AND NULLIF(BTRIM(q.context ->> 'event_key'), '') IS NOT NULL
    GROUP BY q.organization_id, q.store_id, q.context ->> 'event_key'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'P10_7_A1_4B_DUPLICATE_HUMAN_RESPONSE_EVENT_KEYS_REQUIRE_REVIEW';
  END IF;
END;
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_store_assistant_notification_human_response_event
ON public.store_assistant_notification_queue (
  organization_id,
  store_id,
  (context ->> 'event_key')
)
WHERE notification_type = 'important_alert'
  AND context ->> 'reason' = 'human_response_pending'
  AND NULLIF(BTRIM(context ->> 'event_key'), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.p10_7_a1_4b_preserve_delivered_human_response_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.notification_type = 'important_alert'
     AND OLD.context ->> 'reason' = 'human_response_pending'
     AND NULLIF(BTRIM(OLD.context ->> 'event_key'), '') IS NOT NULL
     AND OLD.status IN ('sent', 'delivered', 'read')
     AND NEW.status = 'pending' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

DO $trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.store_assistant_notification_queue'::regclass
      AND tgname = 'trg_p10_7_a1_4b_preserve_delivered_human_response_alert'
      AND NOT tgisinternal
  ) THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_p10_7_a1_4b_preserve_delivered_human_response_alert
        BEFORE UPDATE ON public.store_assistant_notification_queue
        FOR EACH ROW
        EXECUTE FUNCTION public.p10_7_a1_4b_preserve_delivered_human_response_alert()
    $sql$;
  END IF;
END;
$trigger$;

REVOKE EXECUTE ON FUNCTION
  public.p10_7_a1_4b_preserve_delivered_human_response_alert()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.p10_7_a1_4b_preserve_delivered_human_response_alert()
TO service_role;

COMMIT;
