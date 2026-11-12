BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  v_org constant uuid :=
    'b02252ce-0e73-4371-9e23-f1009e7b1698';
  v_store constant uuid :=
    '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b';
  v_contract_id constant uuid :=
    '70cd906d-a980-4a50-b241-a044a3d9cb6c';
  v_old_version_id constant uuid :=
    '8f7f80b3-c189-4711-af77-eda97a840cae';
  v_current_version_id constant uuid :=
    'b9cbd144-976a-42e1-bf0d-d97f0da06b3a';
  v_message_id constant uuid :=
    '81ed84bc-6b02-449b-94a6-d8ae058657b4';

  v_reason constant text :=
    'P9_CONTRACT_SEND_OBSOLETE_VERSION_NOT_CURRENT';

  v_key text;
  v_selector_hash text;
  v_contract public.sales_contracts%ROWTYPE;
  v_old public.sales_contract_versions%ROWTYPE;
  v_current public.sales_contract_versions%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_updated uuid;
BEGIN
  v_key :=
    'sales_contract_send:' ||
    v_org::text || ':' ||
    v_store::text || ':' ||
    v_contract_id::text || ':' ||
    v_old_version_id::text;

  SELECT md5(pg_catalog.pg_get_functiondef(p.oid))
  INTO v_selector_hash
  FROM pg_catalog.pg_proc p
  WHERE p.oid = to_regprocedure(
    'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'
  );

  IF v_selector_hash IS DISTINCT FROM
     '8207fc2b9cbbaafde6552654c4f863d8'
  THEN
    RAISE EXCEPTION
      'P9_REPAIR_SELECTOR_ALREADY_CHANGED: %',
      v_selector_hash;
  END IF;

  SELECT *
  INTO v_message
  FROM public.messages m
  WHERE m.id = v_message_id
    AND m.organization_id = v_org
    AND m.store_id = v_store
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE
      'P9_14H39_TARGET_MESSAGE_ABSENT_NOOP';
  ELSE
    SELECT *
    INTO v_contract
    FROM public.sales_contracts c
    WHERE c.id = v_contract_id
      AND c.organization_id = v_org
      AND c.store_id = v_store
    FOR UPDATE;

    IF NOT FOUND
       OR v_contract.status IS DISTINCT FROM
          'pending_review'
       OR v_contract.current_version_id IS DISTINCT FROM
          v_current_version_id
    THEN
      RAISE EXCEPTION
        'P9_REPAIR_CONTRACT_STATE_MISMATCH';
    END IF;

    SELECT *
    INTO v_old
    FROM public.sales_contract_versions v
    WHERE v.id = v_old_version_id
      AND v.contract_id = v_contract_id;

    IF NOT FOUND
       OR v_old.status IS DISTINCT FROM 'approved'
    THEN
      RAISE EXCEPTION
        'P9_REPAIR_OLD_VERSION_STATE_MISMATCH';
    END IF;

    SELECT *
    INTO v_current
    FROM public.sales_contract_versions v
    WHERE v.id = v_current_version_id
      AND v.contract_id = v_contract_id;

    IF NOT FOUND
       OR v_current.status IS DISTINCT FROM 'generated'
    THEN
      RAISE EXCEPTION
        'P9_REPAIR_CURRENT_VERSION_STATE_MISMATCH';
    END IF;

    IF v_message.sender IS DISTINCT FROM 'human'
       OR v_message.direction IS DISTINCT FROM 'outgoing'
       OR v_message.message_type IS DISTINCT FROM 'document'
       OR v_message.deleted_at IS NOT NULL
       OR v_message.outbound_idempotency_key
            IS DISTINCT FROM v_key
       OR v_message.metadata->>'outbound_origin'
            IS DISTINCT FROM 'sales_contract_send'
       OR v_message.metadata->>'source'
            IS DISTINCT FROM 'sales_contract_send_route'
       OR v_message.metadata->>'sales_contract_id'
            IS DISTINCT FROM v_contract_id::text
       OR v_message.metadata->>'sales_contract_version_id'
            IS DISTINCT FROM v_old_version_id::text
       OR v_message.metadata->>'send_external'
            IS DISTINCT FROM 'true'
       OR v_message.metadata->>'external_channel'
            IS DISTINCT FROM 'whatsapp'
    THEN
      RAISE EXCEPTION
        'P9_REPAIR_MESSAGE_IDENTITY_MISMATCH';
    END IF;

    IF v_message.outbound_claimed_at IS NOT NULL
       OR v_message.outbound_claimed_by IS NOT NULL
       OR v_message.outbound_attempt_started_at IS NOT NULL
       OR v_message.outbound_uncertain_at IS NOT NULL
       OR v_message.outbound_provider_accepted_at IS NOT NULL
       OR v_message.external_message_id IS NOT NULL
       OR v_message.outbound_commercial_finalized_at IS NOT NULL
    THEN
      RAISE EXCEPTION
        'P9_REPAIR_EXTERNAL_ATTEMPT_EVIDENCE_PRESENT';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.p9_sales_contract_send_barriers b
      WHERE b.organization_id = v_org
        AND b.store_id = v_store
        AND b.sales_contract_id = v_contract_id
    ) THEN
      RAISE EXCEPTION
        'P9_REPAIR_CONTRACT_BARRIER_PRESENT';
    END IF;

    IF v_message.outbound_delivery_state = 'failed'
       AND v_message.outbound_error_text = v_reason
    THEN
      RAISE NOTICE
        'P9_14H39_ALREADY_RECONCILED';
    ELSIF v_message.outbound_delivery_state = 'pending'
       AND NULLIF(
         pg_catalog.btrim(
           COALESCE(v_message.outbound_error_text, '')
         ),
         ''
       ) IS NULL
    THEN
      UPDATE public.messages m
      SET
        outbound_delivery_state = 'failed',
        outbound_error_text = v_reason
      WHERE m.id = v_message_id
        AND m.organization_id = v_org
        AND m.store_id = v_store
        AND m.outbound_delivery_state = 'pending'
      RETURNING m.id INTO v_updated;

      IF v_updated IS DISTINCT FROM v_message_id THEN
        RAISE EXCEPTION 'P9_REPAIR_UPDATE_NOT_APPLIED';
      END IF;

      RAISE NOTICE
        'P9_14H39_OBSOLETE_MESSAGE_RECONCILED';
    ELSE
      RAISE EXCEPTION
        'P9_REPAIR_UNEXPECTED_MESSAGE_STATE: %',
        v_message.outbound_delivery_state;
    END IF;
  END IF;
END;
$repair$;

COMMIT;

SELECT
  m.id AS message_id,
  m.outbound_delivery_state AS delivery_state,
  m.outbound_error_text AS reason,
  m.outbound_claimed_at AS claimed_at,
  m.outbound_attempt_started_at AS attempt_started_at,
  m.outbound_uncertain_at AS uncertain_at,
  m.external_message_id,
  m.outbound_provider_accepted_at,
  m.metadata->>'sales_contract_version_id'
    AS original_contract_version_id
FROM public.messages m
WHERE m.id =
  '81ed84bc-6b02-449b-94a6-d8ae058657b4'::uuid;
