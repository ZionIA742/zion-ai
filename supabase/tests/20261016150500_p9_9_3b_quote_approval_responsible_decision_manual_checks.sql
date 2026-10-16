-- ZION P9 9.3-B/1E — Runner de verificacao ESTRUTURAL, somente leitura.
-- Nao cria mensagens, nao decide propostas, nao envia WhatsApp.
BEGIN;

CREATE TEMP TABLE p9_1e_check_results (
  item integer NOT NULL,
  check_name text NOT NULL,
  result text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $checks$
DECLARE
  v_fn regprocedure := to_regprocedure(
    'public.p9_decide_quote_approval_by_responsible_by_system(uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text)'
  );
  v_definition text;
  v_table oid := to_regclass('public.p9_responsible_commercial_approval_requests');
  v_message oid := to_regclass('public.store_assistant_messages');
  v_parts oid := to_regclass('public.p9_quote_approval_delivery_parts');
  v_status_count integer;
BEGIN
  INSERT INTO pg_temp.p9_1e_check_results VALUES
    (1, 'rpc_presente', CASE WHEN v_fn IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
     'Assinatura exata da autoridade de decisao 1E');

  IF v_fn IS NULL THEN
    RAISE NOTICE 'RPC ausente: demais verificacoes nao podem ser executadas';
    RETURN;
  END IF;

  SELECT pg_get_functiondef(v_fn::oid) INTO v_definition;
  INSERT INTO pg_temp.p9_1e_check_results VALUES
    (2, 'security_definer', CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE oid=v_fn::oid AND prosecdef
    ) THEN 'PASS' ELSE 'FAIL' END, 'SECURITY DEFINER presente'),
    (3, 'execucao_restrita', CASE WHEN
      has_function_privilege('service_role',v_fn,'EXECUTE')
      AND NOT has_function_privilege('anon',v_fn,'EXECUTE')
      AND NOT has_function_privilege('authenticated',v_fn,'EXECUTE')
      THEN 'PASS' ELSE 'FAIL' END, 'Apenas service_role tem EXECUTE'),
    (4, 'search_path_fixo', CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p, unnest(p.proconfig) cfg(setting)
      WHERE p.oid=v_fn::oid AND replace(lower(cfg.setting),' ','') = 'search_path=pg_catalog,public'
    ) THEN 'PASS' ELSE 'FAIL' END, 'search_path explícito'),
    (5, 'tabelas_reutilizadas', CASE WHEN
      v_table IS NOT NULL AND v_message IS NOT NULL AND v_parts IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END, 'Sem tabela ou fila 1E adicional'),
    (6, 'replay_inbound_unico', CASE WHEN EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
      WHERE c.relname='p9_commercial_approval_inbound_decision_uidx'
        AND i.indrelid=v_table AND i.indisunique
    ) THEN 'PASS' ELSE 'FAIL' END, 'Um inbound nao decide duas solicitacoes'),
    (7, 'replay_externo_unico', CASE WHEN EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
      WHERE c.relname='p9_commercial_approval_external_decision_uidx'
        AND i.indrelid=v_table AND i.indisunique
    ) THEN 'PASS' ELSE 'FAIL' END, 'Unicidade externa por loja'),
    (8, 'binding_responsavel_e_whatsapp', CASE WHEN
      strpos(v_definition, 'm.metadata->>''responsible_id''') > 0
      AND strpos(v_definition, 'v_message.metadata->>''from_phone''') > 0
      AND strpos(v_definition, 'v_message.metadata->>''context_message_id''') > 0
      THEN 'PASS' ELSE 'FAIL' END, 'Mensagem, telefone e contexto verificados'),
    (9, 'versionamento_e_ciclo', CASE WHEN
      strpos(v_definition, 'v_quote.current_version_id IS DISTINCT FROM p_quote_version_id') > 0
      AND strpos(v_definition, 'v_opportunity.lifecycle_cycle <> p_expected_lifecycle_cycle') > 0
      AND strpos(v_definition, 'public.p9_accepted_quote_revisions') > 0
      THEN 'PASS' ELSE 'FAIL' END, 'Escopo e versao corrente obrigatorios'),
    (10, 'somente_decisao', CASE WHEN
      strpos(v_definition, 'UPDATE public.p9_responsible_commercial_approval_requests') > 0
      AND strpos(v_definition, 'INSERT INTO public.store_assistant_messages') = 0
      AND strpos(v_definition, 'UPDATE public.sales_quotes') = 0
      THEN 'PASS' ELSE 'FAIL' END, 'Writer sem envio e sem alterar quote'),
    (11, 'entrega_verificada', CASE WHEN
      strpos(v_definition, 'p.status = ''accepted''') > 0
      AND strpos(v_definition, 'p.component IN (''report'', ''pdf'')') > 0
      THEN 'PASS' ELSE 'FAIL' END, 'Relatorio e PDF aceitos antes da decisao'),
    (12, 'estado_pendente', CASE WHEN
      strpos(v_definition, 'awaiting_responsible') > 0
      AND strpos(v_definition, 'P9_QUOTE_DECISION_REQUEST_NOT_AWAITING_RESPONSIBLE') > 0
      THEN 'PASS' ELSE 'FAIL' END, 'Sem decidir pending_dispatch/dispatch_uncertain');
END;
$checks$;

SELECT item, check_name, result, detail
FROM pg_temp.p9_1e_check_results
ORDER BY item;

SELECT COUNT(*) FILTER (WHERE result='PASS') AS passed,
       COUNT(*) FILTER (WHERE result='FAIL') AS failed,
       CASE WHEN COUNT(*)=12 AND COUNT(*) FILTER (WHERE result='FAIL')=0
            THEN 'STRUCTURE_PASS_ONLY' ELSE 'STRUCTURE_INCOMPLETE' END AS verdict,
       'Testes funcionais reais e concorrencia: NAO EXECUTADOS' AS limitation
FROM pg_temp.p9_1e_check_results;

COMMIT;
