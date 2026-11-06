-- ZION | P9.9.3 C.5
-- Corrige somente a ordem de leitura da origem do ACK documental.
-- A migration 20261106140000 já foi aplicada e não deve ser alterada.

BEGIN;

DO $patch$
DECLARE
  v_signature constant text :=
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)';
  v_definition text;
  v_patched text;
  v_premature_check constant text :=
    $$    if v_outbound_origin is distinct from 'received_contract_document_ack' then
      v_block_reason := 'received_document_ack_origin_mismatch';
    end if;$$;
  v_safe_check constant text :=
    $$    if nullif(
      pg_catalog.btrim(
        coalesce(v_message.metadata ->> 'outbound_origin', '')
      ),
      ''
    ) is distinct from 'received_contract_document_ack' then
      v_block_reason := 'received_document_ack_origin_mismatch';
    end if;$$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature::regprocedure)
    INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_EXTERNAL_SEND_GUARD_NOT_FOUND_FOR_ORIGIN_ORDER_FIX';
  END IF;

  IF pg_catalog.strpos(v_definition, v_premature_check) = 0 THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_PREMATURE_ORIGIN_CHECK_NOT_FOUND';
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_premature_check, v_safe_check);

  IF v_patched = v_definition
     OR pg_catalog.strpos(v_patched, v_premature_check) <> 0
     OR pg_catalog.strpos(v_patched, 'v_message.metadata ->> ''outbound_origin''') = 0
     OR pg_catalog.strpos(v_patched, 'received_document_ack_origin_mismatch') = 0 THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_ORIGIN_ORDER_FIX_NOT_APPLIED';
  END IF;

  EXECUTE v_patched;
END;
$patch$;

COMMIT;
