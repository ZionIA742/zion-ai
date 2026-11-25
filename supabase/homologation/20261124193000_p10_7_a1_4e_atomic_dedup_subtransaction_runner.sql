-- MICROETAPA 10.7-A1.4e.1
-- Homologacao temporaria da deduplicacao A1.4b.
--
-- Este arquivo nao e a migration definitiva e nao deve ser executado junto
-- com o drainer. A subtransacao instala indice/trigger, testa somente a fila
-- interna e reverte tudo antes do SELECT final.
-- Nenhuma mensagem externa e enviada e nenhum registro historico e removido.

DROP TABLE IF EXISTS pg_temp.p10_7_a1_4e_results;
SET lock_timeout = '5s';
SET statement_timeout = '30s';
CREATE TEMP TABLE p10_7_a1_4e_results (
  test_name text NOT NULL,
  verdict text NOT NULL,
  details text NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $runner$
DECLARE
  v_org uuid;
  v_store uuid;
  v_thread uuid;
  v_event_key text := 'p10-7-a1-4e:' || gen_random_uuid()::text;
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_other uuid;
  v_status text;
  v_status_after_first text;
  v_status_after_sent text;
  v_status_after_replay text;
  v_count_after_first integer;
  v_count_after_replay integer;
  v_count_after_sent integer;
  v_count_after_reopen integer;
  v_duplicate_rejected boolean := false;
  v_sqlstate text;
  v_error text;
  v_index_before boolean;
  v_trigger_before boolean;
  v_function_before boolean;
  v_index_after boolean;
  v_trigger_after boolean;
  v_function_after boolean;
  v_test_rows_after integer;
  v_verdict text := 'BLOQUEADO';
  v_details text := 'ensaio nao concluido';
BEGIN
  IF to_regclass('public.store_assistant_notification_queue') IS NULL
     OR to_regprocedure('public.assistant_enqueue_internal_notification(uuid,uuid,text,text,text,text,jsonb,uuid,uuid,uuid,text)') IS NULL THEN
    INSERT INTO pg_temp.p10_7_a1_4e_results VALUES
      ('preflight', 'BLOQUEADO', 'fila ou RPC canonica ausente');
    RETURN;
  END IF;

  SELECT to_regclass('public.uq_store_assistant_notification_human_response_event') IS NOT NULL
    INTO v_index_before;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.store_assistant_notification_queue'::regclass
      AND tgname = 'trg_p10_7_a1_4b_preserve_delivered_human_response_alert'
      AND NOT tgisinternal
  ) INTO v_trigger_before;
  SELECT to_regprocedure('public.p10_7_a1_4b_preserve_delivered_human_response_alert()') IS NOT NULL
    INTO v_function_before;

  SELECT s.organization_id, s.id
    INTO v_org, v_store
  FROM public.stores s
  ORDER BY s.created_at NULLS LAST, s.id
  LIMIT 1;

  IF v_org IS NULL OR v_store IS NULL THEN
    INSERT INTO pg_temp.p10_7_a1_4e_results VALUES
      ('fixture', 'BLOQUEADO', 'nenhuma loja existente; nenhum fixture criado');
    RETURN;
  END IF;

  BEGIN
    -- Protecoes A1.4b temporarias. Todas estas alteracoes estao dentro da
    -- subtransacao e serao revertidas pelo erro-sentinela abaixo.
    CREATE UNIQUE INDEX IF NOT EXISTS
      uq_store_assistant_notification_human_response_event
    ON public.store_assistant_notification_queue (
      organization_id, store_id, (context ->> 'event_key')
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

    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
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

    v_first := public.assistant_enqueue_internal_notification(
      v_org, v_store, 'important_alert', 'A1.4e teste',
      'Alerta interno de homologacao; nao enviar.', 'normal',
      jsonb_build_object(
        'source', 'p10_7_a1_2_human_response_scanner',
        'reason', 'human_response_pending',
        'commitment_id', gen_random_uuid()::text,
        'event_key', v_event_key,
        'needs_human_action', true
      ), NULL, NULL, NULL, v_event_key
    );
    IF v_first IS NULL THEN RAISE EXCEPTION 'primeiro ID nulo'; END IF;
    SELECT q.status, count(*) OVER ()
      INTO v_status_after_first, v_count_after_first
    FROM public.store_assistant_notification_queue q
    WHERE q.organization_id = v_org
      AND q.store_id = v_store
      AND q.context ->> 'event_key' = v_event_key;
    IF v_status_after_first IS DISTINCT FROM 'pending'
       OR v_count_after_first IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'primeiro alerta retornou status/cardinalidade inesperados';
    END IF;

    v_second := public.assistant_enqueue_internal_notification(
      v_org, v_store, 'important_alert', 'A1.4e replay',
      'Replay interno de homologacao; nao enviar.', 'normal',
      jsonb_build_object(
        'source', 'p10_7_a1_2_human_response_scanner',
        'reason', 'human_response_pending',
        'commitment_id', gen_random_uuid()::text,
        'event_key', v_event_key,
        'needs_human_action', true
      ), NULL, NULL, NULL, v_event_key
    );
    SELECT count(*) INTO v_count_after_replay
    FROM public.store_assistant_notification_queue q
    WHERE q.organization_id = v_org
      AND q.store_id = v_store
      AND q.context ->> 'event_key' = v_event_key;
    IF v_second IS NULL OR v_second IS DISTINCT FROM v_first
       OR v_count_after_replay IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'replay nao preservou ID/cardinalidade';
    END IF;

    UPDATE public.store_assistant_notification_queue
       SET status = 'sent'
     WHERE id = v_first;
    SELECT q.status, count(*) OVER ()
      INTO v_status_after_sent, v_count_after_sent
    FROM public.store_assistant_notification_queue q
    WHERE q.id = v_first;
    IF v_status_after_sent IS DISTINCT FROM 'sent'
       OR v_count_after_sent IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'transicao de teste para sent falhou';
    END IF;

    v_third := public.assistant_enqueue_internal_notification(
      v_org, v_store, 'important_alert', 'A1.4e reopen',
      'Tentativa interna de reabertura; nao enviar.', 'normal',
      jsonb_build_object(
        'source', 'p10_7_a1_2_human_response_scanner',
        'reason', 'human_response_pending',
        'commitment_id', gen_random_uuid()::text,
        'event_key', v_event_key,
        'needs_human_action', true
      ), NULL, NULL, NULL, v_event_key
    );
    SELECT q.status, count(*) OVER ()
      INTO v_status_after_replay, v_count_after_reopen
    FROM public.store_assistant_notification_queue q
    WHERE q.id = v_first;
    IF v_third IS NULL OR v_third IS DISTINCT FROM v_first
       OR v_status_after_replay IS DISTINCT FROM 'sent'
       OR v_count_after_reopen IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'estado sent foi reaberto ou cardinalidade alterada';
    END IF;

    SELECT q.thread_id INTO v_thread
    FROM public.store_assistant_notification_queue q
    WHERE q.id = v_first;
    IF v_thread IS NULL THEN
      RAISE EXCEPTION 'thread_id nulo para alerta de teste';
    END IF;

    BEGIN
      INSERT INTO public.store_assistant_notification_queue (
        organization_id, store_id, thread_id, notification_type, priority,
        status, title, body, context, available_at
      ) VALUES (
        v_org, v_store, v_thread, 'important_alert', 'normal', 'pending',
        'A1.4e duplicata direta', 'Insercao duplicada bloqueada pelo indice.',
        jsonb_build_object(
          'source', 'assistant_enqueue_internal_notification',
          'reason', 'human_response_pending',
          'event_key', v_event_key,
          'needs_human_action', true
        ),
        pg_catalog.clock_timestamp()
      );
    EXCEPTION WHEN unique_violation THEN
      v_duplicate_rejected := true;
    END;
    IF NOT v_duplicate_rejected THEN
      RAISE EXCEPTION 'indice unico nao rejeitou insercao duplicada';
    END IF;

    -- A mesma chave textual fora da origem humana nao conflita com o indice
    -- parcial A1.4b. A linha tambem sera revertida pela subtransacao.
    INSERT INTO public.store_assistant_notification_queue (
      organization_id, store_id, thread_id, notification_type, priority,
      status, title, body, context, available_at
    ) VALUES (
      v_org, v_store, v_thread, 'important_alert', 'normal', 'pending',
      'A1.4e outra notificacao', 'Notificacao nao humana de homologacao.',
      jsonb_build_object('source', 'other_notification_test', 'event_key', v_event_key),
      pg_catalog.clock_timestamp()
    ) RETURNING id INTO v_other;
    IF v_other IS NULL OR v_other IS NOT DISTINCT FROM v_first THEN
      RAISE EXCEPTION 'isolamento das demais notificacoes falhou';
    END IF;

    RAISE EXCEPTION USING errcode = 'P10E4', message = 'P10_7_A1_4E_INTENTIONAL_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_error = MESSAGE_TEXT;
    IF v_sqlstate = 'P10E4' AND v_error = 'P10_7_A1_4E_INTENTIONAL_ROLLBACK' THEN
      v_verdict := 'PASS';
      v_details := 'unicidade, duplicata 23505, replay, IDs, estado sent e isolamento passaram; rollback executado';
    ELSE
      v_details := coalesce(v_sqlstate, 'erro') || ': ' || coalesce(v_error, 'desconhecido');
    END IF;
  END;

  SELECT to_regclass('public.uq_store_assistant_notification_human_response_event') IS NOT NULL
    INTO v_index_after;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.store_assistant_notification_queue'::regclass
      AND tgname = 'trg_p10_7_a1_4b_preserve_delivered_human_response_alert'
      AND NOT tgisinternal
  ) INTO v_trigger_after;
  SELECT to_regprocedure('public.p10_7_a1_4b_preserve_delivered_human_response_alert()') IS NOT NULL
    INTO v_function_after;
  SELECT count(*) INTO v_test_rows_after
  FROM public.store_assistant_notification_queue
  WHERE organization_id = v_org
    AND store_id = v_store
      AND context ->> 'event_key' = v_event_key;

  INSERT INTO pg_temp.p10_7_a1_4e_results VALUES
    ('rollback_objects',
     CASE WHEN v_index_after = v_index_before
             AND v_trigger_after = v_trigger_before
             AND v_function_after = v_function_before
             AND v_test_rows_after = 0
          THEN 'PASS' ELSE 'BLOQUEADO' END,
     'indice=' || v_index_after::text || ', trigger=' || v_trigger_after::text ||
     ', funcao=' || v_function_after::text || ', alertas_teste=' || v_test_rows_after::text);
  INSERT INTO pg_temp.p10_7_a1_4e_results VALUES
    ('transactional_homologation', v_verdict, v_details);
END;
$runner$;

SELECT test_name, verdict, details
FROM pg_temp.p10_7_a1_4e_results
ORDER BY test_name;

-- CONCORRENCIA REAL: executar em duas sessoes separadas, fora deste bloco.
-- Substitua TOKEN_UNICO pela mesma chave em A e B antes de iniciar.
-- Nao execute o drainer nem qualquer rotina de envio.
--
-- SESSAO A:
-- BEGIN;
-- SELECT public.assistant_enqueue_internal_notification(
--   s.organization_id, s.id, 'important_alert', 'A1.4e concorrencia A',
--   'Teste interno; nao enviar.', 'normal',
--   jsonb_build_object('source','p10_7_a1_2_human_response_scanner',
--     'reason','human_response_pending','commitment_id',gen_random_uuid()::text,
--     'event_key','p10-7-a1-4e:TOKEN_UNICO','needs_human_action',true),
--   NULL, NULL, NULL, 'p10-7-a1-4e:TOKEN_UNICO')
-- FROM (SELECT organization_id, id FROM public.stores ORDER BY id LIMIT 1) s;
-- -- manter aberta; nao executar COMMIT ainda
--
-- SESSAO B:
-- BEGIN;
-- SELECT public.assistant_enqueue_internal_notification(
--   s.organization_id, s.id, 'important_alert', 'A1.4e concorrencia B',
--   'Teste interno; nao enviar.', 'normal',
--   jsonb_build_object('source','p10_7_a1_2_human_response_scanner',
--     'reason','human_response_pending','commitment_id',gen_random_uuid()::text,
--     'event_key','p10-7-a1-4e:TOKEN_UNICO','needs_human_action',true),
--   NULL, NULL, NULL, 'p10-7-a1-4e:TOKEN_UNICO')
-- FROM (SELECT organization_id, id FROM public.stores ORDER BY id LIMIT 1) s;
-- -- apos COMMIT da Sessao A, B deve retornar o mesmo ID ou 23505;
-- -- 23505 e resultado esperado de deduplicacao atomica.
-- ROLLBACK;
--
-- SESSAO A (final): COMMIT;
