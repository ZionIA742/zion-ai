-- ZION | P9.9.3-C.5 | correcao incremental dos textos contratuais
-- Nao altera registros historicos; apenas atualiza as funcoes vigentes.

BEGIN;

DO $ack_text_patch$
DECLARE
  v_signature CONSTANT text :=
    'public.enqueue_received_contract_document_ack_by_system(uuid,uuid,uuid,uuid,text)';
  v_definition text;
  v_before text;
  v_named_old CONSTANT text :=
    $$'Obrigado, ' || v_name || '. Recebemos seu documento.'$$;
  v_unnamed_old CONSTANT text :=
    $$'Recebemos seu documento.'$$;
  v_new CONSTANT text :=
    $$'Me dê alguns minutos para verificar esse arquivo'$$;
BEGIN
  IF pg_catalog.to_regprocedure(v_signature) IS NULL THEN
    RAISE EXCEPTION 'P9_9_3_C5_ACK_TEXT_FUNCTION_MISSING';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_signature::regprocedure);

  IF pg_catalog.length(v_definition) -
       pg_catalog.length(pg_catalog.replace(v_definition, v_named_old, ''))
       <> pg_catalog.length(v_named_old)
     OR pg_catalog.length(v_definition) -
       pg_catalog.length(pg_catalog.replace(v_definition, v_unnamed_old, ''))
       <> pg_catalog.length(v_unnamed_old) THEN
    RAISE EXCEPTION 'P9_9_3_C5_ACK_TEXT_PATCH_PATTERN_COUNT_INVALID';
  END IF;

  v_before := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_named_old, v_new);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'P9_9_3_C5_ACK_TEXT_NAMED_PATCH_NOT_APPLIED';
  END IF;

  v_before := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_unnamed_old, v_new);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'P9_9_3_C5_ACK_TEXT_UNNAMED_PATCH_NOT_APPLIED';
  END IF;

  IF pg_catalog.strpos(v_definition, v_new) = 0
     OR pg_catalog.strpos(v_definition, 'Recebemos seu documento.') > 0
     OR pg_catalog.strpos(v_definition, 'Obrigado, ') > 0 THEN
    RAISE EXCEPTION 'P9_9_3_C5_ACK_TEXT_POSTCONDITION_FAILED';
  END IF;

  EXECUTE v_definition;
END;
$ack_text_patch$;

DO $confirmation_text_patch$
DECLARE
  v_signature CONSTANT text :=
    'public.enqueue_received_contract_document_confirmation_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)';
  v_definition text;
  v_before text;
  v_named_old CONSTANT text :=
    $$v_name || ', está tudo certo com seu contrato.'$$;
  v_unnamed_old CONSTANT text :=
    $$'Está tudo certo com seu contrato.'$$;
  v_named_new CONSTANT text :=
    $$v_name || ', está tudo certo com seu contrato'$$;
  v_unnamed_new CONSTANT text :=
    $$'Está tudo certo com seu contrato'$$;
BEGIN
  IF pg_catalog.to_regprocedure(v_signature) IS NULL THEN
    RAISE EXCEPTION 'P9_9_3_C5_CONFIRMATION_TEXT_FUNCTION_MISSING';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_signature::regprocedure);

  IF pg_catalog.strpos(v_definition, v_named_new) > 0
     AND pg_catalog.strpos(v_definition, v_unnamed_new) > 0 THEN
    RETURN;
  END IF;

  IF pg_catalog.strpos(v_definition, v_named_old) = 0
     OR pg_catalog.strpos(v_definition, v_unnamed_old) = 0 THEN
    RAISE EXCEPTION 'P9_9_3_C5_CONFIRMATION_TEXT_PATCH_PATTERN_COUNT_INVALID';
  END IF;

  v_before := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_named_old, v_named_new);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'P9_9_3_C5_CONFIRMATION_TEXT_NAMED_PATCH_NOT_APPLIED';
  END IF;

  v_before := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_unnamed_old, v_unnamed_new);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'P9_9_3_C5_CONFIRMATION_TEXT_UNNAMED_PATCH_NOT_APPLIED';
  END IF;

  IF pg_catalog.strpos(v_definition, v_named_new) = 0
     OR pg_catalog.strpos(v_definition, v_unnamed_new) = 0
     OR pg_catalog.strpos(v_definition, 'contrato.') > 0 THEN
    RAISE EXCEPTION 'P9_9_3_C5_CONFIRMATION_TEXT_POSTCONDITION_FAILED';
  END IF;

  EXECUTE v_definition;
END;
$confirmation_text_patch$;

COMMIT;
