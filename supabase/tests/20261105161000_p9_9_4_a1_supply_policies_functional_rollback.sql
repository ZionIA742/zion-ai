-- ZION / P9 / 9.4-A.1 - Testes funcionais transacionais das politicas de fornecimento
-- Executar no SQL Editor do Supabase ATUAL. Nao usar em outro banco.
-- Usa 1 loja/piscina existente apenas dentro de BEGIN/ROLLBACK.
-- Nao envia WhatsApp, nao cria pedido fabril e nao modifica dados apos ROLLBACK.
-- ATENCAO: se der erro, a transacao deve ser revertida (ROLLBACK).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

-- Prepara escopo usando um membro ativo, sem revelar IDs nos resultados.
DO $setup$
DECLARE
  v record;
BEGIN
  SELECT p.organization_id AS org_id, p.store_id AS store_id,
         p.id AS pool_id, m.user_id AS member_id,
         p.stock_status, p.stock_quantity, p.track_stock
  INTO v
  FROM public.pools p
  JOIN public.stores s ON s.id = p.store_id AND s.organization_id = p.organization_id
  JOIN public.memberships m ON m.organization_id = p.organization_id
    AND m.is_active IS TRUE AND m.user_id IS NOT NULL
  WHERE p.organization_id IS NOT NULL AND p.store_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.pool_supply_policies existing
      WHERE existing.organization_id = p.organization_id
        AND existing.store_id = p.store_id
    )
  ORDER BY p.id, m.user_id
  LIMIT 1;

  IF v.pool_id IS NULL THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_NO_ELIGIBLE_POOL_AND_ACTIVE_MEMBER';
  END IF;

  PERFORM set_config('p9s.org', v.org_id::text, true);
  PERFORM set_config('p9s.store', v.store_id::text, true);
  PERFORM set_config('p9s.pool', v.pool_id::text, true);
  PERFORM set_config('p9s.member', v.member_id::text, true);
  PERFORM set_config('p9s.stock_status', COALESCE(v.stock_status,'<null>'), true);
  PERFORM set_config('p9s.stock_quantity', COALESCE(v.stock_quantity::text,'<null>'), true);
  PERFORM set_config('p9s.track_stock', COALESCE(v.track_stock::text,'<null>'), true);
  -- auth.uid() costuma ler request.jwt.claim.sub no Supabase.
  PERFORM set_config('request.jwt.claim.sub', v.member_id::text, true);
END;
$setup$;

-- Executa as RPCs como authenticated (nao como postgres/service_role).
SET LOCAL ROLE authenticated;

DO $tests$
DECLARE
  v_org uuid := current_setting('p9s.org')::uuid;
  v_store uuid := current_setting('p9s.store')::uuid;
  v_pool uuid := current_setting('p9s.pool')::uuid;
  v_result jsonb;
  v_pass integer := 0;
  v_denied boolean;
  v_stock record;
BEGIN
  IF auth.uid() IS DISTINCT FROM current_setting('p9s.member')::uuid THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_JWT_AUTH_UID_MISMATCH';
  END IF;
  v_pass := v_pass + 1;

  -- 1. Leitura humana autorizada, antes de qualquer mutacao.
  v_result := public.read_store_supply_policy_scoped(v_org, v_store);
  IF v_result->>'store_id' IS DISTINCT FROM v_store::text THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_STORE_READ_SCOPE_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- 2. Configuracao mista com prazo, unidade e evento inicial.
  v_result := public.upsert_store_supply_policy_scoped(
    v_org, v_store, TRUE, TRUE, 'Teste transacional: fornecimento da loja',
    30, 'calendar_days', 'factory_order_placed', NULL, 'delivery',
    'Pedido conforme politica da loja'
  );
  IF v_result->>'store_supply_mode' IS DISTINCT FROM 'mixed'
     OR v_result->>'store_lead_time_days' IS DISTINCT FROM '30' THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_MIXED_POLICY_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- 3. Loja mista sem override nao escolhe modalidade do produto.
  v_result := public.read_pool_supply_policy_scoped(v_org, v_store, v_pool);
  IF v_result->>'effective_supply_mode' IS DISTINCT FROM 'unconfigured' THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_MIXED_FALLBACK_UNSAFE';
  END IF;
  v_pass := v_pass + 1;

  -- 4. Override para estoque: nao herda prazo fabril.
  v_result := public.upsert_pool_supply_policy_scoped(
    v_org, v_store, v_pool, 'stock', NULL, NULL, NULL, NULL, NULL
  );
  IF v_result->>'effective_supply_mode' IS DISTINCT FROM 'stock'
     OR v_result->'lead_time_days' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_STOCK_OVERRIDE_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- 5. Override por encomenda herda prazo da loja quando nao tem prazo proprio.
  v_result := public.upsert_pool_supply_policy_scoped(
    v_org, v_store, v_pool, 'on_order', NULL, NULL, NULL, NULL, NULL
  );
  IF v_result->>'effective_supply_mode' IS DISTINCT FROM 'on_order'
     OR v_result->>'lead_time_days' IS DISTINCT FROM '30'
     OR v_result->>'lead_time_start_event' IS DISTINCT FROM 'factory_order_placed' THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_ON_ORDER_INHERITANCE_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- 6. Override completo de prazo deve ser indivisivel.
  v_result := public.upsert_pool_supply_policy_scoped(
    v_org, v_store, v_pool, 'on_order', 45, 'business_days',
    'factory_order_confirmed', NULL, 'release'
  );
  IF v_result->>'lead_time_days' IS DISTINCT FROM '45'
     OR v_result->>'lead_time_unit' IS DISTINCT FROM 'business_days'
     OR v_result->>'lead_time_start_event' IS DISTINCT FROM 'factory_order_confirmed'
     OR v_result->>'lead_time_applies_until' IS DISTINCT FROM 'release' THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_LEAD_TIME_OVERRIDE_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- 7. Configuracao fisicamente invalida deve ser recusada.
  v_denied := false;
  BEGIN
    PERFORM public.upsert_pool_supply_policy_scoped(
      v_org, v_store, v_pool, 'stock', 5, 'calendar_days',
      'sale_confirmed', NULL, 'delivery'
    );
  EXCEPTION WHEN check_violation THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_STOCK_WITH_FACTORY_LEAD_TIME_ACCEPTED';
  END IF;
  v_pass := v_pass + 1;

  -- 8. Loja nao pode desabilitar encomenda deixando override incompatível.
  v_denied := false;
  BEGIN
    PERFORM public.upsert_store_supply_policy_scoped(
      v_org, v_store, TRUE, FALSE, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'P9_SUPPLY_STORE_CHANGE_CONFLICTS_WITH_POOL_OVERRIDES' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_STORE_OVERRIDE_CONFLICT_NOT_ENFORCED';
  END IF;
  v_pass := v_pass + 1;

  -- 9. Piscina fora do escopo deve ser recusada.
  v_denied := false;
  BEGIN
    PERFORM public.upsert_pool_supply_policy_scoped(
      v_org, v_store, gen_random_uuid(), 'on_order',
      NULL, NULL, NULL, NULL, NULL
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'P9_SUPPLY_POOL_NOT_FOUND_OR_OUT_OF_SCOPE' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_POOL_SCOPE_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- 10. Remocao da excecao volta a unconfigured na loja mista.
  v_result := public.delete_pool_supply_policy_scoped(v_org, v_store, v_pool);
  IF v_result->>'effective_supply_mode' IS DISTINCT FROM 'unconfigured'
     OR v_result->'pool_override_mode' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_DELETE_OVERRIDE_FAILED';
  END IF;
  v_pass := v_pass + 1;

  -- 11. As RPCs nao alteraram estoque, quantidade ou controle de estoque.
  SELECT stock_status, stock_quantity, track_stock INTO v_stock
  FROM public.pools
  WHERE organization_id = v_org AND store_id = v_store AND id = v_pool;
  IF NOT FOUND OR COALESCE(v_stock.stock_status,'<null>')
      IS DISTINCT FROM current_setting('p9s.stock_status')
     OR COALESCE(v_stock.stock_quantity::text,'<null>')
      IS DISTINCT FROM current_setting('p9s.stock_quantity')
     OR COALESCE(v_stock.track_stock::text,'<null>')
      IS DISTINCT FROM current_setting('p9s.track_stock') THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_STOCK_WAS_CHANGED';
  END IF;
  v_pass := v_pass + 1;

  -- 12. Usuario nao membro nao pode ler politicas de outra organizacao.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_denied := false;
  BEGIN
    PERFORM public.read_store_supply_policy_scoped(v_org, v_store);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'P9_SUPPLY_HUMAN_SCOPE_DENIED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_NONMEMBER_READ_SUCCEEDED';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', current_setting('p9s.member'), true);
  v_pass := v_pass + 1;

  PERFORM set_config('p9s.auth_pass', v_pass::text, true);
  RAISE NOTICE 'P9_A1_AUTHENTICATED_CHECKS_PASS=%', v_pass;
END;
$tests$;

-- anon nao deve executar o leitor nem os escritores.
SET LOCAL ROLE anon;
DO $anon$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.read_store_supply_policy_scoped(
      current_setting('p9s.org')::uuid,
      current_setting('p9s.store')::uuid
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'P9_SUPPLY_TEST_ANON_EXECUTED_SCOPED_READ';
  END IF;
  PERFORM set_config('p9s.anon_pass', '1', true);
  RAISE NOTICE 'P9_A1_ANON_EXECUTION_DENIED=PASS';
END;
$anon$;

RESET ROLE;

-- Resultado do teste (deve ser 14 PASS; nenhuma alteracao sera persistida).
SELECT 'P9_9_4_A1_TESTE_FUNCIONAL' AS etapa,
       current_setting('p9s.auth_pass')::integer +
       current_setting('p9s.anon_pass')::integer AS checks_pass,
       'ROLLBACK pendente na instrucao seguinte' AS observacao;

-- Obrigatorio: desfaz a configuracao temporaria, overrides e todas as escritas.
ROLLBACK;
