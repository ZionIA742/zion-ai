-- ZION P9 / 9.3-B / Integracao 1B
-- Runner: 20261016120500_p9_9_3b_accepted_quote_revision_atomic_manual_checks.sql
-- So verifica a fundacao instalada. NAO simula venda real nem envia PDF.
BEGIN;
DO $$
DECLARE
  v_fn oid;
  v_table oid;
  v_def text;
  v_count integer := 0;
BEGIN
  v_table := pg_catalog.to_regclass('public.p9_accepted_quote_revisions');
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'FAIL_01: ledger ausente';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_01: ledger presente';

  v_fn := pg_catalog.to_regprocedure(
    'public.create_accepted_sales_quote_revision_by_system(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid,text,jsonb)'
  );
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'FAIL_02: RPC ausente';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_02: RPC instalada';

  SELECT pg_catalog.pg_get_functiondef(v_fn) INTO v_def;
  IF pg_catalog.strpos(v_def, 'apply_sales_quote_change_money_and_items_by_system') = 0
     OR pg_catalog.strpos(v_def, 'create_sales_quote_version_by_system') = 0 THEN
    RAISE EXCEPTION 'FAIL_03: reuso de writers nao encontrado';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_03: reaproveitamento dos writers';

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = v_table AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL_04: RLS desabilitada';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_04: RLS ativa';

  IF pg_catalog.has_function_privilege(
      'anon', v_fn, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'authenticated', v_fn, 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'FAIL_05: RPC executavel diretamente por usuario';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_05: EXECUTE restrito';

  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL_06: RPC inacessivel ao service_role';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_06: service_role autorizado';

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_table
      AND conname = 'p9_accepted_quote_revisions_acceptance_fk'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'FAIL_07: lineage do aceite ausente';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_07: FK de aceite';

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_table
      AND conname = 'p9_accepted_quote_revisions_operation_uidx'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'FAIL_08: idempotencia ausente';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_08: chave idempotente unica';

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = v_table
      AND tgname = 'p9_accepted_quote_revisions_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL_09: ledger nao imutavel';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_09: trigger imutavel';

  IF pg_catalog.strpos(v_def, 'current_quote_version_id = NULL') = 0
     OR pg_catalog.strpos(v_def, 'ZION_P9_ACCEPTED_REVISION_CONTRACT_ALREADY_SENT') = 0 THEN
    RAISE EXCEPTION 'FAIL_10: protecao proposta/contrato ausente';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_10: protecao proposta/contrato';

  IF pg_catalog.strpos(v_def, 'BRL') = 0
     OR pg_catalog.strpos(v_def, 'pending_review') = 0 THEN
    RAISE EXCEPTION 'FAIL_11: moeda ou estado V2 ausente';
  END IF;
  v_count := v_count + 1; RAISE NOTICE 'PASS_11: BRL e pendencia de aprovacao';

  RAISE NOTICE 'TOTAL: %/11 checks estruturais PASS; E2E nao executado', v_count;
END;
$$;
ROLLBACK;
