-- MICROETAPA 10.7-A1.4c
-- Runner funcional local/remoto autorizado. Nao executar nesta etapa.
-- Bloco 1 testa rollback em uma unica sessao; Bloco 2 exige duas sessoes SQL.
-- Todos os resultados sao SELECTs visiveis no SQL Editor.

DROP TABLE IF EXISTS pg_temp.p10_7_a1_4c_results;
CREATE TEMP TABLE p10_7_a1_4c_results (
  test_name text NOT NULL,
  verdict text NOT NULL,
  details text NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $runner$
DECLARE
  v_org uuid;
  v_store uuid;
  v_event_key text := 'p10-7-a1-4c:' || gen_random_uuid()::text;
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_status text;
  v_sqlstate text;
  v_error text;
  v_verdict text := 'BLOQUEADO';
  v_details text := 'ensaio nao concluido';
BEGIN
  IF to_regclass('public.store_assistant_notification_queue') IS NULL
     OR to_regprocedure('public.assistant_enqueue_internal_notification(uuid,uuid,text,text,text,text,jsonb,uuid,uuid,uuid,text)') IS NULL
     OR to_regclass('public.uq_store_assistant_notification_human_response_event') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.store_assistant_notification_queue'::regclass
         AND tgname = 'trg_p10_7_a1_4b_preserve_delivered_human_response_alert'
         AND NOT tgisinternal
     ) THEN
    INSERT INTO pg_temp.p10_7_a1_4c_results VALUES
      ('preflight', 'BLOQUEADO', 'tabela, RPC, indice ou trigger A1.4b ausente');
    RETURN;
  END IF;

  SELECT s.organization_id, s.id
    INTO v_org, v_store
  FROM public.stores s
  ORDER BY s.created_at NULLS LAST, s.id
  LIMIT 1;

  IF v_org IS NULL OR v_store IS NULL THEN
    INSERT INTO pg_temp.p10_7_a1_4c_results VALUES
      ('fixture', 'BLOQUEADO', 'nenhuma loja existente; nenhum fixture criado');
    RETURN;
  END IF;

  BEGIN
    v_first := public.assistant_enqueue_internal_notification(
      v_org, v_store, 'important_alert', 'A1.4c teste',
      'Alerta de homologacao que sera revertido.', 'normal',
      jsonb_build_object(
        'source', 'p10_7_a1_2_human_response_scanner',
        'reason', 'human_response_pending',
        'commitment_id', gen_random_uuid()::text,
        'event_key', v_event_key,
        'needs_human_action', true
      ), NULL, NULL, NULL, v_event_key
    );

    v_second := public.assistant_enqueue_internal_notification(
      v_org, v_store, 'important_alert', 'A1.4c teste replay',
      'Replay do mesmo alerta.', 'normal',
      jsonb_build_object(
        'source', 'p10_7_a1_2_human_response_scanner',
        'reason', 'human_response_pending',
        'commitment_id', gen_random_uuid()::text,
        'event_key', v_event_key,
        'needs_human_action', true
      ), NULL, NULL, NULL, v_event_key
    );

    IF v_first IS DISTINCT FROM v_second THEN
      RAISE EXCEPTION 'replay retornou IDs diferentes';
    END IF;

    UPDATE public.store_assistant_notification_queue
       SET status = 'sent'
     WHERE id = v_first;

    v_third := public.assistant_enqueue_internal_notification(
      v_org, v_store, 'important_alert', 'A1.4c teste reopen',
      'Tentativa de reabertura.', 'normal',
      jsonb_build_object(
        'source', 'p10_7_a1_2_human_response_scanner',
        'reason', 'human_response_pending',
        'commitment_id', gen_random_uuid()::text,
        'event_key', v_event_key,
        'needs_human_action', true
      ), NULL, NULL, NULL, v_event_key
    );

    SELECT status INTO v_status
    FROM public.store_assistant_notification_queue
    WHERE id = v_first;

    IF v_third IS DISTINCT FROM v_first OR v_status IS DISTINCT FROM 'sent' THEN
      RAISE EXCEPTION 'alerta entregue foi reaberto ou duplicado';
    END IF;

    RAISE EXCEPTION USING errcode = 'P10A4', message = 'P10_7_A1_4C_INTENTIONAL_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_error = MESSAGE_TEXT;
    IF v_sqlstate = 'P10A4' AND v_error = 'P10_7_A1_4C_INTENTIONAL_ROLLBACK' THEN
      v_verdict := 'PASS';
      v_details := 'replay atomico, estado sent preservado e mutacoes revertidas';
    ELSE
      v_details := coalesce(v_sqlstate, 'erro') || ': ' || coalesce(v_error, 'desconhecido');
    END IF;
  END;

  INSERT INTO pg_temp.p10_7_a1_4c_results VALUES ('rollback_single_session', v_verdict, v_details);
END;
$runner$;

-- Concorrencia real requer duas sessoes distintas. Execute ambos os blocos
-- abaixo com o MESMO p_event_key, mantendo a Sessao A aberta ate a Sessao B
-- atingir o INSERT; depois COMMIT A e verifique que B retorna o mesmo ID.
SELECT
  'concurrency_two_sessions'::text AS test_name,
  'MANUAL_REQUIRED'::text AS verdict,
  'Sessao A e Sessao B devem chamar a RPC com o mesmo p_event_key; a unicidade parcial deve serializar o conflito e produzir um unico ID. Nao usar ROLLBACK para declarar PASS desta etapa.'::text AS details;

SELECT test_name, verdict, details
FROM pg_temp.p10_7_a1_4c_results
ORDER BY test_name;
