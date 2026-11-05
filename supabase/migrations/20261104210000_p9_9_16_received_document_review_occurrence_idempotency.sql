-- ZION | P9.9.16 C.4/C.5
-- Deduplicates received-document review messages by the canonical inbound
-- occurrence, while leaving other document-review flows unchanged.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.store_assistant_messages
    WHERE metadata ->> 'kind' = 'document_review'
      AND metadata ->> 'source' = 'received_contract_document_evidence_v1'
      AND NULLIF(BTRIM(metadata ->> 'received_evidence_source_message_id'), '') IS NOT NULL
    GROUP BY
      organization_id,
      store_id,
      metadata ->> 'received_evidence_source_message_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'P9_9_16 duplicate received-document review occurrences found';
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX store_assistant_messages_received_document_occurrence_uidx
ON public.store_assistant_messages (
  organization_id,
  store_id,
  (metadata ->> 'received_evidence_source_message_id')
)
WHERE metadata ->> 'kind' = 'document_review'
  AND metadata ->> 'source' = 'received_contract_document_evidence_v1'
  AND NULLIF(BTRIM(metadata ->> 'received_evidence_source_message_id'), '') IS NOT NULL;

COMMIT;
