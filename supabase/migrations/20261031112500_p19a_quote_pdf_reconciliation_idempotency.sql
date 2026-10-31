-- P19-A - Quote PDF reconciliation idempotency
-- Protects quote-generated events and quote document-review messages.
-- Does not affect contract document-review records.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.conversation_events') IS NULL THEN
    RAISE EXCEPTION
      'P19A precondition failed: conversation_events ausente';
  END IF;

  IF to_regclass('public.store_assistant_messages') IS NULL THEN
    RAISE EXCEPTION
      'P19A precondition failed: store_assistant_messages ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversation_events'
      AND column_name IN (
        'organization_id',
        'conversation_id',
        'event_type',
        'payload'
      )
    GROUP BY table_schema, table_name
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION
      'P19A precondition failed: colunas de conversation_events ausentes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'store_assistant_messages'
      AND column_name IN (
        'organization_id',
        'store_id',
        'metadata'
      )
    GROUP BY table_schema, table_name
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION
      'P19A precondition failed: colunas de store_assistant_messages ausentes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.conversation_events
    WHERE event_type = 'orcamento_gerado'
      AND coalesce(payload->>'quote_id', '') <> ''
      AND coalesce(payload->>'version_id', '') <> ''
      AND coalesce(payload->>'operation_id', '') <> ''
    GROUP BY
      organization_id,
      conversation_id,
      event_type,
      payload->>'quote_id',
      payload->>'version_id',
      payload->>'operation_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'P19A duplicate preflight failed: conversation_events';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.store_assistant_messages
    WHERE metadata->>'kind' = 'document_review'
      AND metadata->>'document_type' = 'quote'
      AND metadata->>'source' = 'assistant_document_workflow_v1'
      AND metadata->>'document_status' = 'pending_review'
      AND coalesce(metadata->>'document_id', '') <> ''
      AND coalesce(metadata->>'document_version_id', '') <> ''
    GROUP BY
      organization_id,
      store_id,
      metadata->>'document_type',
      metadata->>'document_id',
      metadata->>'document_version_id',
      metadata->>'document_status',
      metadata->>'source'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'P19A duplicate preflight failed: store_assistant_messages';
  END IF;
END;
$preflight$;

CREATE UNIQUE INDEX conversation_events_quote_pdf_generation_uidx
ON public.conversation_events (
  organization_id,
  conversation_id,
  event_type,
  (payload->>'quote_id'),
  (payload->>'version_id'),
  (payload->>'operation_id')
)
WHERE event_type = 'orcamento_gerado'
  AND coalesce(payload->>'quote_id', '') <> ''
  AND coalesce(payload->>'version_id', '') <> ''
  AND coalesce(payload->>'operation_id', '') <> '';

CREATE UNIQUE INDEX store_assistant_messages_quote_pdf_document_review_uidx
ON public.store_assistant_messages (
  organization_id,
  store_id,
  (metadata->>'document_type'),
  (metadata->>'document_id'),
  (metadata->>'document_version_id'),
  (metadata->>'document_status'),
  (metadata->>'source')
)
WHERE metadata->>'kind' = 'document_review'
  AND metadata->>'document_type' = 'quote'
  AND metadata->>'source' = 'assistant_document_workflow_v1'
  AND metadata->>'document_status' = 'pending_review'
  AND coalesce(metadata->>'document_id', '') <> ''
  AND coalesce(metadata->>'document_version_id', '') <> '';

COMMIT;
