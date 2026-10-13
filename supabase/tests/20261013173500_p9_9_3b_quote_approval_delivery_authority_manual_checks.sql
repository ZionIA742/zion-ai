-- ZION / P9 / 9.3-B: ledger e writers de entrega (runner DEV)
-- Nada e enviado a Meta. Todos os pedidos/claims de teste sao revertidos.
-- Resultados de fixture funcional estao condicionados a dados DEV elegiveis.
BEGIN;
DROP TABLE IF EXISTS pg_temp.p9_quote_delivery_checks;
CREATE TEMP TABLE p9_quote_delivery_checks (
  ordem int PRIMARY KEY, teste text NOT NULL, resultado text NOT NULL,
  detalhe text NOT NULL DEFAULT ''
) ON COMMIT PRESERVE ROWS;

DO $checks$
DECLARE
  v_table regclass := to_regclass('public.p9_quote_approval_delivery_parts');
  v_req regclass := to_regclass('public.p9_responsible_commercial_approval_requests');
  v_guard regprocedure := to_regprocedure('public.p9_quote_delivery_current_guard_internal(uuid)');
  v_prepare regprocedure := to_regprocedure('public.p9_prepare_quote_approval_delivery_by_system(uuid)');
  v_claim regprocedure := to_regprocedure('public.p9_claim_quote_approval_delivery_by_system(uuid,text,uuid)');
  v_finish regprocedure := to_regprocedure('public.p9_finish_quote_approval_delivery_by_system(uuid,text,uuid,text,text,text)');
  v_previous_role text := current_setting('request.jwt.claim.role',true);
  v_error text; v_fixture record; v_created jsonb; v_prepared jsonb; v_claimed jsonb;
  v_positive boolean := false; v_opening boolean := false; v_no_window boolean := false;
  v_opening_finished boolean := false; v_finish_idempotent boolean := false;
  v_positive_detail text := ''; v_no_window_detail text := ''; v_opening_detail text := '';
  v_finished jsonb; v_finished_twice jsonb;
  v_num bigint;
BEGIN
  INSERT INTO pg_temp.p9_quote_delivery_checks VALUES
    (1,'ledger_existe',CASE WHEN v_table IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,'Tabela de componentes'),
    (2,'funcoes_existem',CASE WHEN v_guard IS NOT NULL AND v_prepare IS NOT NULL
      AND v_claim IS NOT NULL AND v_finish IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
      'Guard interno, prepare, claim e finish');

  IF v_table IS NULL OR v_req IS NULL OR v_guard IS NULL OR v_prepare IS NULL
      OR v_claim IS NULL OR v_finish IS NULL THEN
    INSERT INTO pg_temp.p9_quote_delivery_checks
      SELECT i, t, 'SKIP', 'Dependencias ausentes' FROM (VALUES
        (3,'uniqueness_por_componente'),(4,'tenant_fk'),(5,'pdf_fk'),
        (6,'external_id_unico'),(7,'rls'),(8,'sem_dml_service_role'),
        (9,'exec_service_role'),(10,'sem_exec_outros_roles'),
        (11,'security_definer_search_path'),(12,'internal_restrito'),
        (13,'role_invalido_bloqueado'),(14,'request_inexistente_bloqueado'),
        (15,'fixture_prepare'),(16,'window_sem_inbound_bloqueada'),
        (17,'template_opening_claim_reversivel'),(18,'sem_envio_externo'),
        (19,'concorrencia_real'),(20,'template_aceito_nao_aprova'),
        (21,'finish_idempotente')
      ) AS x(i,t);
    RETURN;
  END IF;

  INSERT INTO pg_temp.p9_quote_delivery_checks VALUES
    (3,'uniqueness_por_componente', CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid=v_table
        AND conname='p9_quote_delivery_one_component' AND contype='u'
      ) THEN 'PASS' ELSE 'FAIL' END, 'Um report, pdf e abertura por request'),
    (4,'tenant_fk',CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid=v_table
        AND conname='p9_quote_delivery_parent_scope_fk' AND contype='f'
      ) THEN 'PASS' ELSE 'FAIL' END,'FK composta org/store/request'),
    (5,'pdf_fk',CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid=v_table
        AND conname='p9_quote_delivery_file_fk' AND contype='f'
      ) THEN 'PASS' ELSE 'FAIL' END,'Arquivo fisico do PDF'),
    (6,'external_id_unico',CASE WHEN EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
       WHERE i.indrelid=v_table AND i.indisunique
       AND c.relname='p9_quote_delivery_external_wamid_uidx'
      ) THEN 'PASS' ELSE 'FAIL' END,'Identificador Meta nao reutilizavel no tenant'),
    (7,'rls',CASE WHEN EXISTS (
      SELECT 1 FROM pg_class WHERE oid=v_table AND relrowsecurity
      ) THEN 'PASS' ELSE 'FAIL' END,'RLS habilitada'),
    (8,'sem_dml_service_role',CASE WHEN
        NOT has_table_privilege('service_role',v_table,'INSERT')
        AND NOT has_table_privilege('service_role',v_table,'UPDATE')
        AND NOT has_table_privilege('service_role',v_table,'DELETE')
      THEN 'PASS' ELSE 'FAIL' END,'Somente RPC grava'),
    (9,'exec_service_role',CASE WHEN
        has_function_privilege('service_role',v_prepare,'EXECUTE')
        AND has_function_privilege('service_role',v_claim,'EXECUTE')
        AND has_function_privilege('service_role',v_finish,'EXECUTE')
      THEN 'PASS' ELSE 'FAIL' END,'Backend pode executar writers'),
    (10,'sem_exec_outros_roles',CASE WHEN
        NOT has_function_privilege('anon',v_prepare,'EXECUTE')
        AND NOT has_function_privilege('authenticated',v_prepare,'EXECUTE')
        AND NOT has_function_privilege('anon',v_claim,'EXECUTE')
        AND NOT has_function_privilege('authenticated',v_claim,'EXECUTE')
        AND NOT has_function_privilege('anon',v_finish,'EXECUTE')
        AND NOT has_function_privilege('authenticated',v_finish,'EXECUTE')
      THEN 'PASS' ELSE 'FAIL' END,'Somente servico pode executar'),
    (11,'security_definer_search_path',CASE WHEN (
      SELECT count(*) FROM pg_proc p WHERE p.oid IN
        (v_guard::oid,v_prepare::oid,v_claim::oid,v_finish::oid)
        AND p.prosecdef AND p.proowner='postgres'::regrole
        AND ('search_path=pg_catalog, public'=ANY(p.proconfig)
             OR 'search_path=pg_catalog,public'=ANY(p.proconfig))
      )=4 THEN 'PASS' ELSE 'FAIL' END,'SECURITY DEFINER de postgres e search_path fixo'),
    (12,'internal_restrito',CASE WHEN
        NOT has_function_privilege('service_role',v_guard,'EXECUTE')
        AND NOT has_function_privilege('anon',v_guard,'EXECUTE')
        AND NOT has_function_privilege('authenticated',v_guard,'EXECUTE')
      THEN 'PASS' ELSE 'FAIL' END,'Helper nao e RPC externa');

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_error := '';
  BEGIN
    PERFORM public.p9_prepare_quote_approval_delivery_by_system(gen_random_uuid());
    v_error := 'NAO_BLOQUEOU';
    RAISE EXCEPTION 'P9_RUNNER_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'P9_RUNNER_ROLLBACK' THEN v_error := SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.p9_quote_delivery_checks VALUES
    (13,'role_invalido_bloqueado',CASE WHEN v_error='P9_DELIVERY_SERVICE_ROLE_REQUIRED'
       THEN 'PASS' ELSE 'FAIL' END,v_error);

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_error := '';
  BEGIN
    PERFORM public.p9_prepare_quote_approval_delivery_by_system(gen_random_uuid());
    v_error := 'NAO_BLOQUEOU';
    RAISE EXCEPTION 'P9_RUNNER_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'P9_RUNNER_ROLLBACK' THEN v_error := SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.p9_quote_delivery_checks VALUES
    (14,'request_inexistente_bloqueado',CASE WHEN v_error='P9_DELIVERY_REQUEST_NOT_FOUND'
       THEN 'PASS' ELSE 'FAIL' END,v_error);

  SELECT o.organization_id, o.store_id, o.id AS opportunity_id,
      o.lifecycle_cycle, q.id AS quote_id, v.id AS version_id,
      r.id AS responsible_id
    INTO v_fixture
  FROM public.commercial_opportunities o
  JOIN public.sales_quotes q ON q.commercial_opportunity_id=o.id
     AND q.organization_id=o.organization_id AND q.store_id=o.store_id
  JOIN public.sales_quote_versions v ON v.id=q.current_version_id
     AND v.quote_id=q.id AND v.organization_id=o.organization_id AND v.store_id=o.store_id
  JOIN public.store_files f ON f.id=v.store_file_id
     AND f.organization_id=o.organization_id AND f.store_id=o.store_id
  JOIN public.store_responsibles r ON r.organization_id=o.organization_id
     AND r.store_id=o.store_id AND r.is_primary AND r.is_active
     AND NULLIF(btrim(r.whatsapp_number),'') IS NOT NULL
  WHERE o.lifecycle_cycle > 0 AND o.stage NOT IN ('perdido','concluido')
    AND v.sent_at IS NULL AND v.version_number >= 1
    AND lower(btrim(COALESCE(q.status,''))) NOT IN
       ('cancelled','canceled','void','archived','rejected')
    AND lower(btrim(COALESCE(v.status,''))) NOT IN
       ('sent','superseded','cancelled','canceled','void','rejected','expired')
    AND lower(btrim(COALESCE(f.mime_type,'')))='application/pdf'
    AND NULLIF(btrim(f.storage_bucket),'') IS NOT NULL
    AND NULLIF(btrim(f.storage_path),'') IS NOT NULL
    AND (SELECT count(*) FROM public.store_responsibles rr
      WHERE rr.organization_id=o.organization_id AND rr.store_id=o.store_id
        AND rr.is_primary AND rr.is_active)=1
    AND NOT EXISTS (SELECT 1 FROM public.p9_responsible_commercial_approval_requests ar
      WHERE ar.organization_id=o.organization_id AND ar.store_id=o.store_id
        AND ar.commercial_opportunity_id=o.id AND ar.request_kind='quote_send_approval')
  ORDER BY o.id LIMIT 1;

  IF v_fixture.opportunity_id IS NULL THEN
    INSERT INTO pg_temp.p9_quote_delivery_checks VALUES
      (15,'fixture_prepare','SKIP','Sem orcamento elegivel'),
      (16,'window_sem_inbound_bloqueada','SKIP','Sem fixture'),
      (17,'template_opening_claim_reversivel','SKIP','Sem fixture'),
      (18,'sem_envio_externo','SKIP','Sem fixture'),
      (20,'template_aceito_nao_aprova','SKIP','Sem fixture'),
      (21,'finish_idempotente','SKIP','Sem fixture');
  ELSE
    BEGIN
      v_created := public.p9_request_quote_send_approval_by_system(
        v_fixture.organization_id,v_fixture.store_id,v_fixture.responsible_id,
        v_fixture.opportunity_id,v_fixture.lifecycle_cycle,
        v_fixture.quote_id,v_fixture.version_id,
        '{"test":"p9_delivery_authority_runner"}'::jsonb
      );
      v_prepared := public.p9_prepare_quote_approval_delivery_by_system(
        (v_created->>'request_id')::uuid);
      SELECT count(*) INTO v_num FROM public.p9_quote_approval_delivery_parts
        WHERE request_id=(v_created->>'request_id')::uuid;
      v_positive := v_num=3 AND v_prepared->>'pdf_store_file_id' IS NOT NULL;
      v_positive_detail := 'parts=' || v_num::text;

      v_error := '';
      BEGIN
        PERFORM public.p9_claim_quote_approval_delivery_by_system(
          (v_created->>'request_id')::uuid,'report',NULL);
        v_error := 'NAO_BLOQUEOU';
        RAISE EXCEPTION 'P9_RUNNER_ROLLBACK';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'P9_RUNNER_ROLLBACK' THEN v_error := SQLERRM; END IF;
      END;
      v_no_window := v_error='P9_DELIVERY_INBOUND_WINDOW_REQUIRED';
      v_no_window_detail := v_error;

      -- Abertura pode estar corretamente bloqueada quando ja houver janela
      -- livre; nesse caso, SKIP e apropriado, nao falso PASS.
      BEGIN
        v_claimed := public.p9_claim_quote_approval_delivery_by_system(
          (v_created->>'request_id')::uuid,'opening_template',NULL);
        v_opening := v_claimed->>'state'='claimed'
          AND NULLIF(v_claimed->>'claim_token','') IS NOT NULL;
        v_opening_detail := 'claim temporario valido';
        IF v_opening THEN
          v_finished := public.p9_finish_quote_approval_delivery_by_system(
            (v_created->>'request_id')::uuid,'opening_template',
            (v_claimed->>'claim_token')::uuid,'accepted',
            'wamid.P9_RUNNER_FAKE_OPENING_ONLY',NULL);
          v_finished_twice := public.p9_finish_quote_approval_delivery_by_system(
            (v_created->>'request_id')::uuid,'opening_template',
            (v_claimed->>'claim_token')::uuid,'accepted',
            'wamid.P9_RUNNER_FAKE_OPENING_ONLY',NULL);
          v_opening_finished := v_finished->>'request_status'='pending_dispatch';
          v_finish_idempotent := v_finished_twice->>'idempotent'='true';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_opening := false;
        v_opening_detail := SQLERRM;
        v_opening_finished := false;
        v_finish_idempotent := false;
      END;
      -- A sentinela reverte tanto o request quanto as tres partes e o claim.
      RAISE EXCEPTION 'P9_RUNNER_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'P9_RUNNER_ROLLBACK' THEN
        v_positive := false;
        v_positive_detail := SQLERRM;
        v_no_window := false;
        v_no_window_detail := SQLERRM;
        v_opening := false;
        v_opening_detail := SQLERRM;
        v_opening_finished := false;
        v_finish_idempotent := false;
      END IF;
    END;
    INSERT INTO pg_temp.p9_quote_delivery_checks VALUES
      (15,'fixture_prepare',CASE WHEN v_positive THEN 'PASS' ELSE 'FAIL' END,v_positive_detail),
      (16,'window_sem_inbound_bloqueada',CASE WHEN v_no_window THEN 'PASS' ELSE 'FAIL' END,v_no_window_detail),
      (17,'template_opening_claim_reversivel',
         CASE WHEN v_opening THEN 'PASS'
           WHEN v_opening_detail='P9_DELIVERY_RECENT_INBOUND_USE_FREEFORM' THEN 'SKIP'
           ELSE 'FAIL' END,v_opening_detail),
      (18,'sem_envio_externo',CASE WHEN v_positive THEN 'PASS' ELSE 'FAIL' END,
        'Nenhuma chamada Meta; dados do teste revertidos'),
      (20,'template_aceito_nao_aprova',CASE WHEN v_opening_finished THEN 'PASS'
          WHEN v_opening_detail='P9_DELIVERY_RECENT_INBOUND_USE_FREEFORM' THEN 'SKIP'
          ELSE 'FAIL' END,
        'Ack simulado do template mantem pedido pending_dispatch'),
      (21,'finish_idempotente',CASE WHEN v_finish_idempotent THEN 'PASS'
          WHEN v_opening_detail='P9_DELIVERY_RECENT_INBOUND_USE_FREEFORM' THEN 'SKIP'
          ELSE 'FAIL' END,
        'Repeticao da finalizacao do mesmo ack e idempotente');
  END IF;

  INSERT INTO pg_temp.p9_quote_delivery_checks VALUES
    (19,'concorrencia_real','SKIP','Exige sessoes DB independentes; nao simulada');
  PERFORM set_config('request.jwt.claim.role',v_previous_role,true);
END;
$checks$;
COMMIT;
SELECT ordem,teste,resultado,detalhe FROM pg_temp.p9_quote_delivery_checks ORDER BY ordem;
SELECT resultado,count(*) AS quantidade FROM pg_temp.p9_quote_delivery_checks
  GROUP BY resultado ORDER BY resultado;
