-- Preparado para execução SQL local/transacional; não executar remotamente nesta etapa.
BEGIN;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'P9_C5_ORIGIN_ORDER_GUARD_NOT_INSTALLED';
  END IF;

  IF pg_catalog.position(
       'coalesce(v_message.metadata ->> ''outbound_origin'', '''')' IN v_definition
     ) = 0
     OR pg_catalog.position('received_document_ack_origin_mismatch' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'P9_C5_ORIGIN_ORDER_FIX_NOT_INSTALLED';
  END IF;
END;
$$;

-- Este arquivo é somente um manual check de instalação; não persiste alterações.
ROLLBACK;
