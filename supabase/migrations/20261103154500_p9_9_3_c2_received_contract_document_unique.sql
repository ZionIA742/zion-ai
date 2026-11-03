-- ZION | P9.3-C.2
-- Unicidade atomica para documentos contratuais recebidos.
-- Nao modifica contratos, assinaturas ou mensagens.

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.store_business_events
        WHERE event_key = 'contract_uploaded'
          AND event_payload ->> 'schema' =
              'received_contract_document_evidence'
          AND NULLIF(
              BTRIM(event_payload ->> 'source_message_id'),
              ''
          ) IS NOT NULL
        GROUP BY
            organization_id,
            store_id,
            (event_payload ->> 'source_message_id')
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'P9_9_3_C2_DUPLICATE_EVIDENCE_EVENTS';
    END IF;
END;
$$;

CREATE UNIQUE INDEX
    store_business_events_received_contract_document_uidx
ON public.store_business_events (
    organization_id,
    store_id,
    ((event_payload ->> 'source_message_id'))
)
WHERE event_key = 'contract_uploaded'
  AND event_payload ->> 'schema' =
      'received_contract_document_evidence'
  AND NULLIF(
      BTRIM(event_payload ->> 'source_message_id'),
      ''
  ) IS NOT NULL;

COMMIT;