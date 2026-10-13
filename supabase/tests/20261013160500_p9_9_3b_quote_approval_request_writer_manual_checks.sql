-- ZION / Pilar 9 / Etapa 9.3-B
-- Runner focal do writer de solicitacao de aprovacao de orcamento.
-- Executar no Supabase SQL Editor, preferencialmente DEV.
-- Nao envia WhatsApp nem documentos.
-- As chamadas de escrita do teste funcional sao revertidas em subtransacao PL/pgSQL.
-- A tabela de resultados e TEMPORARIA (nao persistida no projeto/banco).
-- Nao confundir SKIP com PASS: SKIP significa falta de fixture elegivel.

BEGIN;

DROP TABLE IF EXISTS pg_temp.p9_9_3b_writer_test_results;

CREATE TEMP TABLE p9_9_3b_writer_test_results (
    ordem integer PRIMARY KEY,
    teste text NOT NULL,
    resultado text NOT NULL CHECK (resultado IN ('PASS', 'FAIL', 'SKIP')),
    detalhe text NOT NULL DEFAULT ''
) ON COMMIT PRESERVE ROWS;

DO $test$
DECLARE
    v_fn regprocedure := to_regprocedure(
      'public.p9_request_quote_send_approval_by_system(uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb)'
    );
    v_oid oid;
    v_def text;
    v_previous_jwt_role text := current_setting('request.jwt.claim.role', true);
    v_observed text;
    v_fixture record;
    v_first jsonb;
    v_repeat jsonb;
    v_positive_ok boolean := false;
    v_idempotent_ok boolean := false;
    v_positive_detail text := '';
    v_idempotent_detail text := '';
BEGIN
    SELECT c.oid INTO v_oid
    FROM pg_class c
    WHERE c.oid = to_regclass('public.p9_responsible_commercial_approval_requests');

    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (1, 'tabela_e_writer_existem',
        CASE WHEN v_oid IS NOT NULL AND v_fn IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
        'Tabela da fundacao e assinatura canônica do writer');

    IF v_oid IS NULL OR v_fn IS NULL THEN
        INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
        (2,'funcao_security_definer','SKIP','Writer ausente'),
        (3,'execucao_restrita_service_role','SKIP','Writer ausente'),
        (4,'escrita_direta_service_role_bloqueada','SKIP','Tabela ou writer ausente'),
        (5,'fks_compostas_de_escopo','SKIP','Tabela ou writer ausente'),
        (6,'restricoes_de_unicidade','SKIP','Tabela ou writer ausente'),
        (7,'rejeita_argumentos_nulos','SKIP','Writer ausente'),
        (8,'rejeita_relatorio_vazio','SKIP','Writer ausente'),
        (9,'rejeita_oportunidade_inexistente','SKIP','Writer ausente'),
        (10,'rejeita_chamada_sem_service_role','SKIP','Writer ausente'),
        (11,'cria_solicitacao_para_fixture_valido','SKIP','Writer ausente'),
        (12,'idempotencia_mesma_versao','SKIP','Writer ausente'),
        (13,'nao_envia_notificacoes','SKIP','Writer ausente'),
        (14,'concorrencia_real','SKIP','Requer duas sessoes independentes');
        RETURN;
    END IF;

    SELECT pg_get_functiondef(v_fn::oid) INTO v_def;

    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (2,'funcao_security_definer',
      CASE WHEN EXISTS (
          SELECT 1 FROM pg_proc p WHERE p.oid=v_fn::oid AND p.prosecdef
      ) AND EXISTS (
          SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS setting(value)
          WHERE p.oid=v_fn::oid
            AND regexp_replace(lower(setting.value),'[[:space:]]','','g')
                = 'search_path=pg_catalog,public'
      )
      THEN 'PASS' ELSE 'FAIL' END,
      'SECURITY DEFINER e search_path restrito');

    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (3,'execucao_restrita_service_role',
      CASE WHEN
        has_function_privilege('service_role',v_fn,'EXECUTE')
        AND NOT has_function_privilege('anon',v_fn,'EXECUTE')
        AND NOT has_function_privilege('authenticated',v_fn,'EXECUTE')
      THEN 'PASS' ELSE 'FAIL' END,
      'Somente service_role pode invocar a funcao');

    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (4,'escrita_direta_service_role_bloqueada',
      CASE WHEN
        NOT has_table_privilege('service_role',v_oid,'INSERT')
        AND NOT has_table_privilege('service_role',v_oid,'UPDATE')
        AND NOT has_table_privilege('service_role',v_oid,'DELETE')
      THEN 'PASS' ELSE 'FAIL' END,
      'O acesso de escrita ocorre pelo writer, nao pela tabela');

    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (5,'fks_compostas_de_escopo',
      CASE WHEN (
        SELECT count(*) FROM pg_constraint c
        WHERE c.conrelid = v_oid AND c.contype='f'
          AND c.conname IN (
            'p9_commercial_approval_opportunity_scope_fk',
            'p9_commercial_approval_quote_scope_fk',
            'p9_commercial_approval_quote_version_scope_fk'
          )
      ) = 3 THEN 'PASS' ELSE 'FAIL' END,
      'Oportunidade, orcamento e versao vinculados por chaves compostas');

    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (6,'restricoes_de_unicidade',
      CASE WHEN (
        SELECT count(*) FROM pg_index i
        JOIN pg_class idx ON idx.oid=i.indexrelid
        WHERE i.indrelid=v_oid AND i.indisunique AND idx.relname IN (
          'p9_commercial_approval_request_key_uidx',
          'p9_commercial_approval_one_active_per_kind_uidx',
          'p9_commercial_approval_inbound_decision_uidx'
        )
      ) = 3 THEN 'PASS' ELSE 'FAIL' END,
      'Chave idempotente, solicitacao ativa e resposta humana unica');

    -- Em SQL Editor nao ha token JWT externo. Emulamos apenas a claim de teste.
    PERFORM set_config('request.jwt.claim.role','service_role',true);

    -- Cada chamada esta dentro de um bloco EXCEPTION: qualquer escrita inesperada
    -- seria revertida ao capturar a excecao ou ao lancar a sentinela.
    v_observed := '';
    BEGIN
        PERFORM public.p9_request_quote_send_approval_by_system(
          NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{"runner":"negative"}'::jsonb
        );
        v_observed := 'NAO_REJEITOU';
        RAISE EXCEPTION 'P9_RUNNER_FORCE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'P9_RUNNER_FORCE_ROLLBACK' THEN v_observed := SQLERRM; END IF;
    END;
    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (7,'rejeita_argumentos_nulos',
      CASE WHEN v_observed='P9_QUOTE_APPROVAL_ARGUMENTS_INVALID' THEN 'PASS' ELSE 'FAIL' END,
      v_observed);

    v_observed := '';
    BEGIN
        PERFORM public.p9_request_quote_send_approval_by_system(
          gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          gen_random_uuid(),1,gen_random_uuid(),gen_random_uuid(),'{}'::jsonb
        );
        v_observed := 'NAO_REJEITOU';
        RAISE EXCEPTION 'P9_RUNNER_FORCE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'P9_RUNNER_FORCE_ROLLBACK' THEN v_observed := SQLERRM; END IF;
    END;
    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (8,'rejeita_relatorio_vazio',
      CASE WHEN v_observed='P9_QUOTE_APPROVAL_REPORT_INVALID' THEN 'PASS' ELSE 'FAIL' END,
      v_observed);

    v_observed := '';
    BEGIN
        PERFORM public.p9_request_quote_send_approval_by_system(
          gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          gen_random_uuid(),1,gen_random_uuid(),gen_random_uuid(),
          '{"runner":"negative"}'::jsonb
        );
        v_observed := 'NAO_REJEITOU';
        RAISE EXCEPTION 'P9_RUNNER_FORCE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'P9_RUNNER_FORCE_ROLLBACK' THEN v_observed := SQLERRM; END IF;
    END;
    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (9,'rejeita_oportunidade_inexistente',
      CASE WHEN v_observed='P9_QUOTE_APPROVAL_OPPORTUNITY_CYCLE_MISMATCH' THEN 'PASS' ELSE 'FAIL' END,
      v_observed);

    v_observed := '';
    BEGIN
        PERFORM set_config('request.jwt.claim.role','authenticated',true);
        PERFORM public.p9_request_quote_send_approval_by_system(
          gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          gen_random_uuid(),1,gen_random_uuid(),gen_random_uuid(),
          '{"runner":"negative"}'::jsonb
        );
        v_observed := 'NAO_REJEITOU';
        RAISE EXCEPTION 'P9_RUNNER_FORCE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'P9_RUNNER_FORCE_ROLLBACK' THEN v_observed := SQLERRM; END IF;
    END;
    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (10,'rejeita_chamada_sem_service_role',
      CASE WHEN v_observed='P9_QUOTE_APPROVAL_SERVICE_ROLE_REQUIRED' THEN 'PASS' ELSE 'FAIL' END,
      v_observed);
    PERFORM set_config('request.jwt.claim.role','service_role',true);

    -- Fixture com PDF valido e versionamento atual; nada sera persistido.
    SELECT
      o.organization_id AS org_id, o.store_id AS store_id,
      o.id AS opportunity_id, o.lifecycle_cycle AS lifecycle_cycle,
      q.id AS quote_id, v.id AS version_id, r.id AS responsible_id
    INTO v_fixture
    FROM public.commercial_opportunities o
    JOIN public.sales_quotes q
      ON q.commercial_opportunity_id=o.id
     AND q.organization_id=o.organization_id AND q.store_id=o.store_id
    JOIN public.sales_quote_versions v
      ON v.id=q.current_version_id AND v.quote_id=q.id
     AND v.organization_id=o.organization_id AND v.store_id=o.store_id
    JOIN public.store_files f
      ON f.id=v.store_file_id
     AND f.organization_id=o.organization_id AND f.store_id=o.store_id
    JOIN public.store_responsibles r
      ON r.organization_id=o.organization_id AND r.store_id=o.store_id
     AND r.is_primary IS TRUE AND r.is_active IS TRUE
     AND NULLIF(btrim(r.whatsapp_number),'') IS NOT NULL
    WHERE o.lifecycle_cycle >= 1
      AND o.stage NOT IN ('perdido','concluido')
      AND v.version_number>=1
      AND v.sent_at IS NULL
      AND lower(btrim(v.status)) NOT IN (
        'sent','superseded','cancelled','canceled','void','rejected','expired'
      )
      AND lower(btrim(q.status)) NOT IN (
        'cancelled','canceled','void','archived','rejected'
      )
      AND lower(btrim(COALESCE(f.mime_type,'')))='application/pdf'
      AND NULLIF(btrim(f.storage_bucket),'') IS NOT NULL
      AND NULLIF(btrim(f.storage_path),'') IS NOT NULL
      AND (
        SELECT count(*) FROM public.store_responsibles rr
        WHERE rr.organization_id=o.organization_id AND rr.store_id=o.store_id
          AND rr.is_primary IS TRUE AND rr.is_active IS TRUE
      )=1
      AND NOT EXISTS (
        SELECT 1 FROM public.p9_responsible_commercial_approval_requests ar
        WHERE ar.organization_id=o.organization_id AND ar.store_id=o.store_id
          AND ar.commercial_opportunity_id=o.id
          AND ar.request_kind='quote_send_approval'
      )
    ORDER BY o.id
    LIMIT 1;

    IF v_fixture IS NULL THEN
      INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
      (11,'cria_solicitacao_para_fixture_valido','SKIP','Nenhum orcamento com PDF elegivel e sem solicitacao anterior'),
      (12,'idempotencia_mesma_versao','SKIP','Sem fixture elegivel');
    ELSE
      -- Exclusivamente nesta subtransacao: insercao e replay sempre revertidos.
      BEGIN
        v_first := public.p9_request_quote_send_approval_by_system(
          v_fixture.org_id, v_fixture.store_id, v_fixture.responsible_id,
          v_fixture.opportunity_id, v_fixture.lifecycle_cycle,
          v_fixture.quote_id, v_fixture.version_id,
          '{"runner":"p9_9_3b","test":"rollback"}'::jsonb
        );
        v_repeat := public.p9_request_quote_send_approval_by_system(
          v_fixture.org_id, v_fixture.store_id, v_fixture.responsible_id,
          v_fixture.opportunity_id, v_fixture.lifecycle_cycle,
          v_fixture.quote_id, v_fixture.version_id,
          '{"runner":"p9_9_3b","test":"rollback"}'::jsonb
        );
        v_positive_ok :=
          v_first->>'status'='pending_dispatch'
          AND v_first->>'created'='true'
          AND NULLIF(v_first->>'request_id','') IS NOT NULL;
        v_idempotent_ok :=
          v_repeat->>'created'='false'
          AND v_repeat->>'request_id'=v_first->>'request_id';
        v_positive_detail := v_first::text;
        v_idempotent_detail := v_repeat::text;
        RAISE EXCEPTION 'P9_RUNNER_FORCE_ROLLBACK';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'P9_RUNNER_FORCE_ROLLBACK' THEN
          v_positive_ok := false;
          v_idempotent_ok := false;
          v_positive_detail := SQLERRM;
          v_idempotent_detail := SQLERRM;
        END IF;
      END;
      INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
      (11,'cria_solicitacao_para_fixture_valido',
        CASE WHEN v_positive_ok THEN 'PASS' ELSE 'FAIL' END,v_positive_detail),
      (12,'idempotencia_mesma_versao',
        CASE WHEN v_idempotent_ok THEN 'PASS' ELSE 'FAIL' END,v_idempotent_detail);
    END IF;

    -- Writer nao realiza transporte. Teste estrutural, nao teste E2E.
    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (13,'nao_envia_notificacoes',
      CASE WHEN position('sendWhatsapp' IN v_def)=0
            AND position('store_responsible_external_notifications' IN v_def)=0
            AND position('assistant_enqueue_internal_notification' IN v_def)=0
      THEN 'PASS' ELSE 'FAIL' END,
      'Inspecao da funcao: sem mecanismo de envio externo');

    INSERT INTO pg_temp.p9_9_3b_writer_test_results VALUES
    (14,'concorrencia_real','SKIP',
      'Necessita duas transacoes/sessoes independentes; nao afirmar PASS nesta rodada');

    PERFORM set_config('request.jwt.claim.role',COALESCE(v_previous_jwt_role,''),true);
END;
$test$;

COMMIT;

-- A ultima instrucao e SELECT para o SQL Editor mostrar o relatorio.
SELECT ordem, teste, resultado, detalhe
FROM pg_temp.p9_9_3b_writer_test_results
ORDER BY ordem;
