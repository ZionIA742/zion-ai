-- ZION / P9 / 9.4-A.2.1 - validacao funcional transacional
-- Executar somente no banco autorizado, depois da migration correspondente.
-- Usa exclusivamente a loja de teste ZION como fixture temporaria; tudo termina em ROLLBACK.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

DO $setup$
DECLARE
  v_org constant uuid := 'b02252ce-0e73-4371-9e23-f1009e7b1698';
  v_store constant uuid := '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b';
  v_member uuid;
  v_scope_count integer;
  v_stock_overrides integer;
  v_order_overrides integer;
BEGIN
  SELECT count(*) INTO v_scope_count
  FROM public.organizations o
  JOIN public.stores s ON s.organization_id = o.id
  WHERE o.id = v_org
    AND s.id = v_store
    AND lower(btrim(s.name)) = 'zion';
  IF v_scope_count <> 1 THEN
    RAISE EXCEPTION 'P9_A2_1_TEST_ZION_SCOPE_NOT_UNIQUE';
  END IF;

  SELECT m.user_id INTO v_member
  FROM public.memberships m
  WHERE m.organization_id = v_org
    AND m.is_active IS TRUE
    AND m.user_id IS NOT NULL
  ORDER BY m.user_id
  LIMIT 1;
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'P9_A2_1_TEST_ZION_ACTIVE_MEMBERSHIP_MISSING';
  END IF;

  SELECT count(*) FILTER (WHERE q.supply_mode = 'stock'),
         count(*) FILTER (WHERE q.supply_mode = 'on_order')
    INTO v_stock_overrides, v_order_overrides
  FROM public.pool_supply_policies q
  WHERE q.organization_id = v_org AND q.store_id = v_store;

  PERFORM set_config('p9a2.org', v_org::text, true);
  PERFORM set_config('p9a2.store', v_store::text, true);
  PERFORM set_config('p9a2.member', v_member::text, true);
  PERFORM set_config('p9a2.has_stock_override', (v_stock_overrides > 0)::text, true);
  PERFORM set_config('p9a2.has_order_override', (v_order_overrides > 0)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $tests$
DECLARE
  v_org uuid := current_setting('p9a2.org')::uuid;
  v_store uuid := current_setting('p9a2.store')::uuid;
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
  v_denied boolean;
  v_case integer;
  v_order_enabled boolean := current_setting('p9a2.has_order_override')::boolean;
  v_expected_mode text := CASE WHEN current_setting('p9a2.has_order_override')::boolean THEN 'mixed' ELSE 'stock' END;
  v_pass integer := 0;
BEGIN
  IF auth.uid() IS DISTINCT FROM current_setting('p9a2.member')::uuid THEN
    RAISE EXCEPTION 'P9_A2_1_TEST_AUTH_UID_MISMATCH';
  END IF;
  v_pass := v_pass + 1;

  -- Os overrides existentes determinam o modo seguro do salvamento. Nenhum
  -- override e removido ou reclassificado pelo teste.
  v_before := public.read_store_supply_policy_scoped(v_org, v_store);

  -- Nulo e whitespace sao rejeitados antes de qualquer UPSERT.
  FOR v_case IN 1..2 LOOP
    v_denied := false;
    BEGIN
      PERFORM public.upsert_store_supply_policy_scoped(
        v_org, v_store, TRUE, v_order_enabled,
        CASE WHEN v_case = 1 THEN NULL ELSE '   ' END,
        NULL, NULL, NULL, NULL, NULL, NULL
      );
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'P9_SUPPLY_EXPLANATION_REQUIRED' THEN
        v_denied := true;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'P9_A2_1_TEST_EMPTY_EXPLANATION_ACCEPTED'; END IF;
    v_pass := v_pass + 1;
  END LOOP;
  v_after := public.read_store_supply_policy_scoped(v_org, v_store);
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'P9_A2_1_TEST_REJECTED_WRITE_CHANGED_POLICY';
  END IF;

  -- Uma configuracao valida grava modalidade e explicacao.
  v_result := public.upsert_store_supply_policy_scoped(
    v_org, v_store, TRUE, v_order_enabled, 'Fixture sintetica A2.1',
    NULL, NULL, NULL, NULL, NULL, NULL
  );
  IF v_result->>'store_supply_mode' IS DISTINCT FROM v_expected_mode
     OR v_result->>'operational_explanation' IS DISTINCT FROM 'Fixture sintetica A2.1' THEN
    RAISE EXCEPTION 'P9_A2_1_TEST_VALID_WRITE_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- Nao existe writer legado distinto nesta migration. Este cenario testa
  -- explicitamente a repeticao do writer instalado e a preservacao do modo.
  v_result := public.upsert_store_supply_policy_scoped(
    v_org, v_store, TRUE, v_order_enabled, 'Fixture sintetica A2.1 preservada',
    NULL, NULL, NULL, NULL, NULL, NULL
  );
  IF v_result->>'store_supply_mode' IS DISTINCT FROM v_expected_mode
     OR v_result->>'operational_explanation' IS DISTINCT FROM 'Fixture sintetica A2.1 preservada' THEN
    RAISE EXCEPTION 'P9_A2_1_TEST_PRESERVATION_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- A transacao deve ter exercitado a assinatura exata da RPC instalada.
  IF to_regprocedure('public.upsert_store_supply_policy_scoped(uuid,uuid,boolean,boolean,text,integer,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'P9_A2_1_TEST_RPC_SIGNATURE_MISSING';
  END IF;
  v_pass := v_pass + 1;

  PERFORM set_config('p9a2.pass', v_pass::text, true);
  RAISE NOTICE 'P9_A2_1_CHECKS_PASS=%', v_pass;
END;
$tests$;

RESET ROLE;
SELECT 'P9_9_4_A2_1_SUPPLY_EXPLANATION_REQUIRED' AS etapa,
       current_setting('p9a2.pass')::integer AS checks_pass,
       'ROLLBACK pendente na instrucao seguinte' AS observacao;

ROLLBACK;
