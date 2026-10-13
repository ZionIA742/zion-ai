-- ZION / Pilar 9 / 9.3-B / runner do relatorio canonico BRL.
-- Executar no Supabase DEV depois da migration 20261013190000.
-- NAO faz envio WhatsApp. O unico write funcional e desfeito por EXCEPTION.
-- SKIP = fixture ausente ou concorrencia nao exercitada, nunca PASS.
BEGIN;
DROP TABLE IF EXISTS pg_temp.p9_quote_canonical_report_checks;
CREATE TEMP TABLE p9_quote_canonical_report_checks (
  ordem integer PRIMARY KEY,
  teste text NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('PASS','FAIL','SKIP')),
  detalhe text NOT NULL DEFAULT ''
) ON COMMIT PRESERVE ROWS;

DO $runner$
DECLARE
  v_writer regprocedure := to_regprocedure('public.p9_request_quote_send_approval_by_system(uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb)');
  v_helper regprocedure := to_regprocedure('public.p9_build_quote_approval_canonical_report_internal(jsonb,uuid,uuid,integer,uuid)');
  v_def text;
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_store uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_quote uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_pdf uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_snapshot jsonb;
  v_report jsonb;
  v_mutated jsonb;
  v_error text;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_fixture record;
  v_first jsonb;
  v_repeat jsonb;
  v_persisted jsonb;
  v_positive_ok boolean := false;
  v_replay_ok boolean := false;
  v_spoof_ok boolean := false;
  v_positive_detail text := '';
  v_replay_detail text := '';
  v_spoof_detail text := '';
  v_test_no integer;
  v_case text;
  v_expected text;
BEGIN
  INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
    (1,'writer_e_helper_existem',CASE WHEN v_writer IS NOT NULL AND v_helper IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END,'Assinaturas do writer e do extrator imutavel');

  IF v_writer IS NULL OR v_helper IS NULL THEN
    INSERT INTO pg_temp.p9_quote_canonical_report_checks
    SELECT n, name, 'SKIP', 'Dependencias ausentes'
    FROM (VALUES
      (2,'permissoes_e_owner'),(3,'helper_canonico_BRl'),
      (4,'moeda_conflitante_bloqueada'),(5,'quote_id_incorreto_bloqueado'),
      (6,'store_id_incorreto_bloqueado'),(7,'total_ausente_bloqueado'),
      (8,'aritmetica_cabecalho_bloqueia_incoerencia'),
      (9,'item_incoerente_bloqueado'),(10,'soma_itens_bloqueia_incoerencia'),
      (11,'sem_itens_bloqueado'),(12,'numero_ausente_bloqueado'),
      (13,'centavos_fracionarios_bloqueados'),(14,'erro_de_geracao_bloqueado'),
      (15,'writer_nao_consume_campos_livres'),(16,'writer_role_invalido'),
      (17,'writer_fixture_canonico'),(18,'writer_idempotencia'),
      (19,'caller_nao_altera_valores'),(20,'cross_tenant_bloqueado'),
      (21,'concorrencia_real'),(22,'sem_transporte_na_migration')
    ) AS x(n,name);
    RETURN;
  END IF;

  SELECT pg_get_functiondef(v_writer::oid) INTO v_def;
  INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
    (2,'permissoes_e_owner',CASE WHEN
       has_function_privilege('service_role',v_writer,'EXECUTE')
       AND NOT has_function_privilege('anon',v_writer,'EXECUTE')
       AND NOT has_function_privilege('authenticated',v_writer,'EXECUTE')
       AND NOT has_function_privilege('service_role',v_helper,'EXECUTE')
       AND NOT has_function_privilege('anon',v_helper,'EXECUTE')
       AND NOT has_function_privilege('authenticated',v_helper,'EXECUTE')
       AND (SELECT prosecdef FROM pg_proc WHERE oid=v_writer::oid)
       AND (SELECT provolatile='i' FROM pg_proc WHERE oid=v_helper::oid)
       AND NOT has_table_privilege('service_role','public.p9_responsible_commercial_approval_requests','INSERT')
       AND NOT has_table_privilege('service_role','public.p9_responsible_commercial_approval_requests','UPDATE')
       AND NOT has_table_privilege('service_role','public.p9_responsible_commercial_approval_requests','DELETE')
      THEN 'PASS' ELSE 'FAIL' END,'Writer so service_role; helper interno imutavel');

  v_snapshot := jsonb_build_object(
    'quote', jsonb_build_object(
      'id',v_quote,'quoteNumber','ZION-TEST-001',
      'customerName','Cliente DEV',
      'subtotalCents',70000,'discountCents',10000,'totalCents',60000,
      'paymentTerms','Pix','deliveryTerms','Entrega a combinar',
      'validUntil','2026-12-31'
    ),
    'store',jsonb_build_object('id',v_store,'name','Loja DEV'),
    'lead',jsonb_build_object('name','Cliente DEV'),
    'items',jsonb_build_array(
      jsonb_build_object('name','Produto','quantity',2,'unitPriceCents',20000,
        'subtotalCents',40000,'discountCents',5000,'totalCents',35000),
      jsonb_build_object('name','Servico','quantity',1,'unitPriceCents',30000,
        'subtotalCents',30000,'discountCents',0,'totalCents',30000)
    ),
    'generationError',NULL
  );

  v_report := public.p9_build_quote_approval_canonical_report_internal(
     v_snapshot,v_quote,v_store,2,v_pdf);
  INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
    (3,'helper_canonico_BRl',CASE WHEN
       v_report->>'quote_number'='ZION-TEST-001'
       AND v_report->>'quote_version_number'='2'
       AND v_report->>'currency'='BRL'
       AND (v_report->>'subtotal_cents')::integer=70000
       AND (v_report->>'discount_cents')::integer=10000
       AND (v_report->>'total_cents')::integer=60000
       AND (v_report->>'items_count')::integer=2
       AND jsonb_array_length(v_report->'items')=2
       AND v_report->>'quote_pdf_store_file_id'=v_pdf::text
       AND v_report->>'customer_name'='Cliente DEV'
      THEN 'PASS' ELSE 'FAIL' END,
      'Exercicio sintetico com desconto por item e desconto global: 70000-10000=60000');

  FOR v_test_no, v_case, v_expected IN
    SELECT * FROM (VALUES
      (4,'moeda_conflitante_bloqueada','P9_QUOTE_APPROVAL_CURRENCY_NOT_BRL'),
      (5,'quote_id_incorreto_bloqueado','P9_QUOTE_APPROVAL_CANONICAL_LINEAGE_MISMATCH'),
      (6,'store_id_incorreto_bloqueado','P9_QUOTE_APPROVAL_CANONICAL_LINEAGE_MISMATCH'),
      (7,'total_ausente_bloqueado','P9_QUOTE_APPROVAL_CANONICAL_MONEY_INVALID'),
      (8,'aritmetica_cabecalho_bloqueia_incoerencia','P9_QUOTE_APPROVAL_CANONICAL_TOTAL_INCOHERENT'),
      (9,'item_incoerente_bloqueado','P9_QUOTE_APPROVAL_CANONICAL_ITEM_TOTAL_INCOHERENT'),
      (10,'soma_itens_bloqueia_incoerencia','P9_QUOTE_APPROVAL_CANONICAL_ITEMS_TOTAL_MISMATCH'),
      (11,'sem_itens_bloqueado','P9_QUOTE_APPROVAL_CANONICAL_ITEMS_INVALID'),
      (12,'numero_ausente_bloqueado','P9_QUOTE_APPROVAL_CANONICAL_QUOTE_NUMBER_INVALID'),
      (13,'centavos_fracionarios_bloqueados','P9_QUOTE_APPROVAL_CANONICAL_MONEY_INVALID'),
      (14,'erro_de_geracao_bloqueado','P9_QUOTE_APPROVAL_CANONICAL_GENERATION_ERROR')
    ) x(n,name,err)
  LOOP
    v_mutated := v_snapshot;
    CASE v_test_no
      WHEN 4 THEN v_mutated := jsonb_set(v_mutated,'{quote,currency}','"USD"');
      WHEN 5 THEN v_mutated := jsonb_set(v_mutated,'{quote,id}',to_jsonb(gen_random_uuid()::text));
      WHEN 6 THEN v_mutated := jsonb_set(v_mutated,'{store,id}',to_jsonb(gen_random_uuid()::text));
      WHEN 7 THEN v_mutated := v_mutated #- '{quote,totalCents}';
      WHEN 8 THEN v_mutated := jsonb_set(v_mutated,'{quote,totalCents}','60001'::jsonb);
      WHEN 9 THEN v_mutated := jsonb_set(v_mutated,'{items,0,totalCents}','35001'::jsonb);
      WHEN 10 THEN v_mutated := jsonb_set(jsonb_set(jsonb_set(v_mutated,'{items,1,subtotalCents}','29000'::jsonb),'{items,1,totalCents}','29000'::jsonb),'{items,1,unitPriceCents}','29000'::jsonb);
      WHEN 11 THEN v_mutated := jsonb_set(v_mutated,'{items}','[]'::jsonb);
      WHEN 12 THEN v_mutated := jsonb_set(v_mutated,'{quote,quoteNumber}','""'::jsonb);
      WHEN 13 THEN v_mutated := jsonb_set(v_mutated,'{quote,totalCents}','60000.5'::jsonb);
      WHEN 14 THEN v_mutated := jsonb_set(v_mutated,'{generationError}','"pdf_error"'::jsonb);
    END CASE;
    v_error := 'NAO_BLOQUEOU';
    BEGIN
      PERFORM public.p9_build_quote_approval_canonical_report_internal(
        v_mutated,v_quote,v_store,2,v_pdf);
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
    END;
    INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
      (v_test_no,v_case,
       CASE WHEN v_error=v_expected THEN 'PASS' ELSE 'FAIL' END,v_error);
  END LOOP;

  INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
    (15,'writer_nao_consume_campos_livres', CASE WHEN
      position('v_report := v_canonical_report || jsonb_build_object' IN v_def)>0
      AND position('v_report := p_report_snapshot ||' IN v_def)=0
      AND position('v_version.quote_snapshot' IN v_def)>0
      THEN 'PASS' ELSE 'FAIL' END,
      'Teste estrutural: snapshot do chamador nao cria campos comerciais');

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_error := 'NAO_BLOQUEOU';
  BEGIN
    PERFORM public.p9_request_quote_send_approval_by_system(
      v_org,v_store,v_org,v_org,1,v_quote,v_org,'{"runner":"negative"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
    (16,'writer_role_invalido',CASE WHEN v_error='P9_QUOTE_APPROVAL_SERVICE_ROLE_REQUIRED'
      THEN 'PASS' ELSE 'FAIL' END,v_error);
  PERFORM set_config('request.jwt.claim.role','service_role',true);

  -- Busca fixture real para testar SQL persistido. Nenhum insert permanece:
  -- toda chamada de writer nesta secao ocorre numa subtransacao revertida.
  SELECT o.organization_id, o.store_id, o.id opportunity_id,
      o.lifecycle_cycle, q.id quote_id, v.id version_id, v.store_file_id pdf_file_id,
      r.id responsible_id
    INTO v_fixture
  FROM public.commercial_opportunities o
  JOIN public.sales_quotes q ON q.commercial_opportunity_id=o.id
    AND q.organization_id=o.organization_id AND q.store_id=o.store_id
  JOIN public.sales_quote_versions v ON v.id=q.current_version_id
    AND v.quote_id=q.id AND v.organization_id=o.organization_id AND v.store_id=o.store_id
  JOIN public.store_files f ON f.id=v.store_file_id
    AND f.organization_id=o.organization_id AND f.store_id=o.store_id
  JOIN public.store_responsibles r ON r.organization_id=o.organization_id
    AND r.store_id=o.store_id AND r.is_primary IS TRUE AND r.is_active IS TRUE
    AND NULLIF(btrim(r.whatsapp_number),'') IS NOT NULL
  WHERE o.lifecycle_cycle>0 AND o.stage NOT IN ('perdido','concluido')
    AND v.sent_at IS NULL AND v.version_number>=1
    AND lower(btrim(COALESCE(q.status,''))) NOT IN
      ('cancelled','canceled','void','archived','rejected')
    AND lower(btrim(COALESCE(v.status,''))) NOT IN
      ('sent','superseded','cancelled','canceled','void','rejected','expired')
    AND lower(btrim(COALESCE(f.mime_type,'')))='application/pdf'
    AND NULLIF(btrim(f.storage_bucket),'') IS NOT NULL
    AND NULLIF(btrim(f.storage_path),'') IS NOT NULL
    AND jsonb_typeof(v.quote_snapshot->'quote')='object'
    AND jsonb_typeof(v.quote_snapshot->'items')='array'
    AND (SELECT count(*) FROM public.store_responsibles rr
      WHERE rr.organization_id=o.organization_id AND rr.store_id=o.store_id
        AND rr.is_primary AND rr.is_active)=1
    AND NOT EXISTS (SELECT 1 FROM public.p9_responsible_commercial_approval_requests ar
      WHERE ar.organization_id=o.organization_id AND ar.store_id=o.store_id
        AND ar.commercial_opportunity_id=o.id AND ar.request_kind='quote_send_approval')
  ORDER BY o.id LIMIT 1;

  IF v_fixture.opportunity_id IS NULL THEN
    INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
      (17,'writer_fixture_canonico','SKIP','Nao existe fixture com versao atual, PDF e responsavel elegivel'),
      (18,'writer_idempotencia','SKIP','Sem fixture'),
      (19,'caller_nao_altera_valores','SKIP','Sem fixture'),
      (20,'cross_tenant_bloqueado','SKIP','Sem fixture');
  ELSE
    BEGIN
      v_first := public.p9_request_quote_send_approval_by_system(
        v_fixture.organization_id,v_fixture.store_id,v_fixture.responsible_id,
        v_fixture.opportunity_id,v_fixture.lifecycle_cycle,
        v_fixture.quote_id,v_fixture.version_id,
        '{"quote_number":"FAKE","total_cents":1,"currency":"USD","runner":"rollback"}'::jsonb
      );
      SELECT report_snapshot INTO v_persisted
      FROM public.p9_responsible_commercial_approval_requests
      WHERE id=(v_first->>'request_id')::uuid;
      v_positive_ok := v_first->>'status'='pending_dispatch'
        AND v_first->>'created'='true'
        AND v_persisted->>'currency'='BRL'
        AND v_persisted->>'quote_pdf_store_file_id'=v_fixture.pdf_file_id::text;
      -- Checagens comerciais adicionais e teste de spoofing (valores do caller nao entram).
      v_positive_ok := v_positive_ok
        AND v_persisted->>'quote_version_id'=v_fixture.version_id::text
        AND (v_persisted->>'total_cents') IS NOT NULL
        AND (v_persisted->>'quote_number') IS NOT NULL;
      v_spoof_ok := v_persisted->>'currency'='BRL'
        AND v_persisted->>'quote_number' <> 'FAKE'
        AND v_persisted->>'total_cents' <> '1'
        AND NOT (v_persisted ? 'runner');
      v_repeat := public.p9_request_quote_send_approval_by_system(
        v_fixture.organization_id,v_fixture.store_id,v_fixture.responsible_id,
        v_fixture.opportunity_id,v_fixture.lifecycle_cycle,
        v_fixture.quote_id,v_fixture.version_id,
        '{"caller":"replay"}'::jsonb
      );
      v_replay_ok := v_repeat->>'created'='false'
        AND v_repeat->>'request_id'=v_first->>'request_id';
      v_positive_detail := 'snapshot canonico derivado da versao; dados comerciais pessoais omitidos';
      v_spoof_detail := 'caller fields FAKE/USD/1 foram descartados';
      v_replay_detail := v_repeat::text;
      RAISE EXCEPTION 'P9_CANONICAL_RUNNER_FORCE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'P9_CANONICAL_RUNNER_FORCE_ROLLBACK' THEN
        v_positive_ok := false;
        v_replay_ok := false;
        v_spoof_ok := false;
        v_positive_detail := SQLERRM;
        v_replay_detail := SQLERRM;
        v_spoof_detail := SQLERRM;
      END IF;
    END;
    INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
      (17,'writer_fixture_canonico',CASE WHEN v_positive_ok THEN 'PASS' ELSE 'FAIL' END,v_positive_detail),
      (18,'writer_idempotencia',CASE WHEN v_replay_ok THEN 'PASS' ELSE 'FAIL' END,v_replay_detail),
      (19,'caller_nao_altera_valores',CASE WHEN v_spoof_ok THEN 'PASS' ELSE 'FAIL' END,v_spoof_detail);

    v_error := 'NAO_BLOQUEOU';
    BEGIN
      PERFORM public.p9_request_quote_send_approval_by_system(
        v_fixture.organization_id,gen_random_uuid(),v_fixture.responsible_id,
        v_fixture.opportunity_id,v_fixture.lifecycle_cycle,
        v_fixture.quote_id,v_fixture.version_id,
        '{"runner":"negative"}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
    END;
    INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
      (20,'cross_tenant_bloqueado',CASE WHEN
         v_error='P9_QUOTE_APPROVAL_OPPORTUNITY_CYCLE_MISMATCH'
         THEN 'PASS' ELSE 'FAIL' END,v_error);
  END IF;

  INSERT INTO pg_temp.p9_quote_canonical_report_checks VALUES
    (21,'concorrencia_real','SKIP','Precisa duas sessoes independentes'),
    (22,'sem_transporte_na_migration',CASE WHEN
      position('sendWhatsapp' IN v_def)=0
      AND position('http_post' IN v_def)=0
      AND position('net.http_post' IN v_def)=0
      THEN 'PASS' ELSE 'FAIL' END,
      'Inspecao estrutural; nenhum envio e realizado');
  PERFORM set_config('request.jwt.claim.role',COALESCE(v_previous_role,''),true);
END;
$runner$;
COMMIT;
SELECT ordem, teste, resultado, detalhe
FROM pg_temp.p9_quote_canonical_report_checks ORDER BY ordem;
