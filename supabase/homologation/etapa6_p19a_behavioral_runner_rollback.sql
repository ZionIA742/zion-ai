-- ZION/P19-A ETAPA 6 - HOMOLOGACAO COMPORTAMENTAL POS-MIGRATIONS.
--
-- Preparacao para execucao manual, somente apos as cinco migrations estarem
-- aplicadas no destino autorizado. Este arquivo NAO aplica migrations.
--
-- O runner cria fixtures sinteticas nas tabelas publicas dentro de UMA unica
-- transacao e termina com ROLLBACK. Nao chama Meta, pg_net, webhooks, cron ou
-- qualquer servico externo. Nao executar em uma sessao compartilhada com
-- outra operacao de DDL/DML.
--
-- Este arquivo comprova: standard, business_app_coexistence, recovery,
-- replay, mismatch de modalidade, grants/SECURITY DEFINER e isolamento de
-- organizacao/loja. Nao declara concorrencia multi-sessao aprovada: esse
-- cenario exige duas sessoes controladas e permanece pendente.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL search_path = pg_catalog, pg_temp, public, auth, extensions;

CREATE TEMP TABLE pg_temp.zion_etapa6_behavior_results (
  scenario text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS', 'SUT_FAIL', 'HARNESS_ERROR', 'PENDING')),
  detail text
) ON COMMIT PRESERVE ROWS;

CREATE OR REPLACE FUNCTION pg_temp.zion_etapa6_record(
  p_scenario text,
  p_name text,
  p_status text,
  p_detail text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO pg_temp.zion_etapa6_behavior_results(scenario, name, status, detail)
  VALUES (p_scenario, p_name, p_status, p_detail)
  ON CONFLICT (scenario) DO UPDATE
    SET name = excluded.name,
        status = excluded.status,
        detail = excluded.detail;
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.zion_etapa6_uuid(p_seed text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT (
    substr(md5(p_seed), 1, 8) || '-' ||
    substr(md5(p_seed), 9, 4) || '-4' ||
    substr(md5(p_seed), 14, 3) || '-8' ||
    substr(md5(p_seed), 18, 3) || '-' ||
    substr(md5(p_seed), 21, 12)
  )::uuid;
$function$;

DO $preflight$
DECLARE
  v_signature text;
  v_version text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'ZION_ETAPA6_BEHAVIOR_EXPECTED_POSTGRES_ROLE';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'ZION_ETAPA6_BEHAVIOR_MIGRATION_HISTORY_MISSING';
  END IF;

  FOREACH v_version IN ARRAY ARRAY[
    '20261114000000', '20261114030000', '20261114170000',
    '20261114180000', '20261114183000'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version::text = v_version
    ) THEN
      RAISE EXCEPTION 'ZION_ETAPA6_BEHAVIOR_MIGRATION_NOT_APPLIED: %', v_version;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)',
    'public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)',
    'public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)',
    'public.materialize_whatsapp_first_connection_mode_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz,text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'ZION_ETAPA6_BEHAVIOR_FUNCTION_MISSING: %', v_signature;
    END IF;
  END LOOP;

  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.stores') IS NULL
     OR to_regclass('public.external_integrations') IS NULL THEN
    RAISE EXCEPTION 'ZION_ETAPA6_BEHAVIOR_FIXTURE_TABLE_MISSING';
  END IF;

  -- Nenhuma autoridade deste runner pode iniciar transporte externo.
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
     WHERE p.oid IN (
       to_regprocedure('public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
       to_regprocedure('public.materialize_store_whatsapp_embedded_signup_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
       to_regprocedure('public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
       to_regprocedure('public.materialize_whatsapp_first_connection_mode_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz,text)')
     )
     AND lower(coalesce(pg_get_functiondef(p.oid), '')) ~ '(net\.http|pg_net|cron\.|http_post|http_get)'
  ) THEN
    RAISE EXCEPTION 'ZION_ETAPA6_BEHAVIOR_EXTERNAL_CALL_PATH_DETECTED';
  END IF;
END;
$preflight$;

DO $fixture_and_behavior$
DECLARE
  v_org_standard uuid := pg_temp.zion_etapa6_uuid('etapa6:standard:org');
  v_store_standard uuid := pg_temp.zion_etapa6_uuid('etapa6:standard:store');
  v_org_coexistence uuid := pg_temp.zion_etapa6_uuid('etapa6:coexistence:org');
  v_store_coexistence uuid := pg_temp.zion_etapa6_uuid('etapa6:coexistence:store');
  v_other_org uuid := pg_temp.zion_etapa6_uuid('etapa6:other:org');
  v_standard_id uuid;
  v_replay_id uuid;
  v_recovery_id uuid;
  v_coexistence_id uuid;
  v_coexistence_replay_id uuid;
  v_mode text;
  v_pending boolean;
  v_active boolean;
  v_outcome text;
  v_error text;
  v_fn regprocedure;
BEGIN
  INSERT INTO public.organizations(id, name, subscription_status)
  VALUES
    (v_org_standard, 'ZION Etapa 6 synthetic standard', 'active'),
    (v_org_coexistence, 'ZION Etapa 6 synthetic coexistence', 'active'),
    (v_other_org, 'ZION Etapa 6 synthetic other tenant', 'active');

  INSERT INTO public.stores(id, organization_id, name)
  VALUES
    (v_store_standard, v_org_standard, 'ZION Etapa 6 standard store'),
    (v_store_coexistence, v_org_coexistence, 'ZION Etapa 6 coexistence store');

  -- STANDARD: primeira conexao materializa pendencia de PIN e grava a modalidade.
  BEGIN
    SELECT integration_id, outcome INTO v_standard_id, v_outcome
      FROM public.materialize_whatsapp_first_connection_mode_by_system(
        v_org_standard, v_store_standard, 'zion-etapa6-standard-waba',
        'zion-etapa6-standard-phone', '+55 11 90000-6001',
        'synthetic-token-standard', 'v23.0', 'synthetic-app', now(), 'standard'
      );
    SELECT metadata ->> 'connection_mode',
           (metadata ->> 'pin_activation_pending')::boolean,
           is_active
      INTO v_mode, v_pending, v_active
      FROM public.external_integrations
     WHERE id = v_standard_id;
    PERFORM pg_temp.zion_etapa6_record(
      'standard.first', 'standard cria pending PIN e preserva modalidade',
      CASE WHEN v_mode = 'standard' AND v_pending IS TRUE AND v_active IS FALSE
             AND v_outcome IN ('inserted', 'reconnected') THEN 'PASS' ELSE 'SUT_FAIL' END,
      format('outcome=%s mode=%s pending=%s active=%s', v_outcome, v_mode, v_pending, v_active)
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('standard.first', 'standard cria pending PIN e preserva modalidade', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  -- STANDARD replay: mesma modalidade, mesmo binding e mesma integracao.
  BEGIN
    SELECT integration_id, outcome INTO v_replay_id, v_outcome
      FROM public.materialize_whatsapp_first_connection_mode_by_system(
        v_org_standard, v_store_standard, 'zion-etapa6-standard-waba',
        'zion-etapa6-standard-phone', '+55 11 90000-6001',
        'synthetic-token-standard', 'v23.0', 'synthetic-app', now(), 'standard'
      );
    SELECT metadata ->> 'connection_mode' INTO v_mode
      FROM public.external_integrations WHERE id = v_replay_id;
    PERFORM pg_temp.zion_etapa6_record(
      'standard.replay', 'standard replay e idempotente',
      CASE WHEN v_replay_id = v_standard_id AND v_mode = 'standard'
             AND v_outcome IN ('idempotent_replay', 'reconnected') THEN 'PASS' ELSE 'SUT_FAIL' END,
      format('same_id=%s outcome=%s mode=%s', v_replay_id = v_standard_id, v_outcome, v_mode)
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('standard.replay', 'standard replay e idempotente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  -- Modalidade divergente deve falhar antes de materializar outro binding.
  BEGIN
    PERFORM * FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_org_standard, v_store_standard, 'zion-etapa6-standard-waba',
      'zion-etapa6-standard-phone', '+55 11 90000-6001',
      'synthetic-token-standard', 'v23.0', 'synthetic-app', now(), 'business_app_coexistence'
    );
    PERFORM pg_temp.zion_etapa6_record('standard.mode_mismatch', 'standard nao aceita replay coexistence', 'SUT_FAIL', 'chamada deveria falhar');
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
    PERFORM pg_temp.zion_etapa6_record('standard.mode_mismatch', 'standard nao aceita replay coexistence',
      CASE WHEN v_error LIKE '%ZION_WHATSAPP_CONNECTION_MODE_REPLAY_MISMATCH%' THEN 'PASS' ELSE 'SUT_FAIL' END,
      sqlstate || ' ' || v_error);
  END;

  -- COEXISTENCE: usa o writer embedded e permanece ativo.
  BEGIN
    SELECT integration_id, outcome INTO v_coexistence_id, v_outcome
      FROM public.materialize_whatsapp_first_connection_mode_by_system(
        v_org_coexistence, v_store_coexistence, 'zion-etapa6-coexistence-waba',
        'zion-etapa6-coexistence-phone', '+55 11 90000-6002',
        'synthetic-token-coexistence', 'v23.0', 'synthetic-app', now(), 'business_app_coexistence'
      );
    SELECT metadata ->> 'connection_mode',
           coalesce((metadata ->> 'pin_activation_pending')::boolean, false),
           is_active
      INTO v_mode, v_pending, v_active
      FROM public.external_integrations WHERE id = v_coexistence_id;
    PERFORM pg_temp.zion_etapa6_record(
      'coexistence.first', 'coexistence cria integracao ativa sem pending PIN',
      CASE WHEN v_mode = 'business_app_coexistence' AND v_pending IS FALSE AND v_active IS TRUE
             AND v_outcome IN ('inserted', 'reconnected') THEN 'PASS' ELSE 'SUT_FAIL' END,
      format('outcome=%s mode=%s pending=%s active=%s', v_outcome, v_mode, v_pending, v_active)
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('coexistence.first', 'coexistence cria integracao ativa sem pending PIN', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  BEGIN
    SELECT integration_id, outcome INTO v_coexistence_replay_id, v_outcome
      FROM public.materialize_whatsapp_first_connection_mode_by_system(
        v_org_coexistence, v_store_coexistence, 'zion-etapa6-coexistence-waba',
        'zion-etapa6-coexistence-phone', '+55 11 90000-6002',
        'synthetic-token-coexistence', 'v23.0', 'synthetic-app', now(), 'business_app_coexistence'
      );
    SELECT metadata ->> 'connection_mode' INTO v_mode
      FROM public.external_integrations WHERE id = v_coexistence_replay_id;
    PERFORM pg_temp.zion_etapa6_record(
      'coexistence.replay', 'coexistence replay preserva modalidade',
      CASE WHEN v_coexistence_replay_id = v_coexistence_id
             AND v_mode = 'business_app_coexistence' THEN 'PASS' ELSE 'SUT_FAIL' END,
      format('same_id=%s outcome=%s mode=%s', v_coexistence_replay_id = v_coexistence_id, v_outcome, v_mode)
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('coexistence.replay', 'coexistence replay preserva modalidade', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  -- Recovery deve exigir modalidade e nao reclassificar o binding.
  BEGIN
    SELECT integration_id INTO v_recovery_id
      FROM public.materialize_store_whatsapp_pin_recovery_by_system(
        v_org_standard, v_store_standard, 'zion-etapa6-standard-waba',
        'zion-etapa6-standard-phone', '+55 11 90000-6001',
        'synthetic-token-standard', 'v23.0', 'synthetic-app', now()
      );
    SELECT metadata ->> 'connection_mode' INTO v_mode
      FROM public.external_integrations WHERE id = v_recovery_id;
    PERFORM pg_temp.zion_etapa6_record(
      'recovery.mode_preservation', 'recovery preserva standard',
      CASE WHEN v_recovery_id = v_standard_id AND v_mode = 'standard' THEN 'PASS' ELSE 'SUT_FAIL' END,
      format('same_id=%s mode=%s', v_recovery_id = v_standard_id, v_mode)
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zion_etapa6_record('recovery.mode_preservation', 'recovery preserva standard', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
  END;

  -- Isolamento: loja correta sob organizacao errada deve falhar fechado.
  BEGIN
    PERFORM * FROM public.materialize_whatsapp_first_connection_mode_by_system(
      v_other_org, v_store_standard, 'zion-etapa6-cross-waba',
      'zion-etapa6-cross-phone', '+55 11 90000-6003',
      'synthetic-token-cross', 'v23.0', 'synthetic-app', now(), 'standard'
    );
    PERFORM pg_temp.zion_etapa6_record('tenant.cross_org', 'cross-tenant e rejeitado', 'SUT_FAIL', 'chamada deveria falhar');
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
    PERFORM pg_temp.zion_etapa6_record('tenant.cross_org', 'cross-tenant e rejeitado',
      CASE WHEN v_error LIKE '%ZION_WHATSAPP_CONNECTION_MODE_STORE_SCOPE_MISMATCH%' THEN 'PASS' ELSE 'SUT_FAIL' END,
      sqlstate || ' ' || v_error);
  END;

  -- Permissoes efetivas e modo de seguranca das autoridades.
  FOR v_fn IN SELECT unnest(ARRAY[
    to_regprocedure('public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
    to_regprocedure('public.materialize_store_whatsapp_pin_recovery_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'),
    to_regprocedure('public.materialize_whatsapp_first_connection_mode_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz,text)')
  ]) LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn)
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      PERFORM pg_temp.zion_etapa6_record('permissions.system_authorities', 'grants e SECURITY DEFINER', 'SUT_FAIL', v_fn::text);
      RETURN;
    END IF;
  END LOOP;
  PERFORM pg_temp.zion_etapa6_record('permissions.system_authorities', 'grants e SECURITY DEFINER', 'PASS');

  -- Uma sessao nao prova concorrencia multi-sessao real.
  PERFORM pg_temp.zion_etapa6_record(
    'concurrency.multi_session', 'concorrencia real entre duas sessoes', 'PENDING',
    'Exige duas conexoes controladas; nao foi simulada por lock/advisory lock.'
  );
END;
$fixture_and_behavior$;

SELECT scenario, name, status, detail
  FROM pg_temp.zion_etapa6_behavior_results
 ORDER BY scenario;

SELECT
  CASE WHEN count(*) FILTER (WHERE status IN ('SUT_FAIL', 'HARNESS_ERROR')) = 0
       THEN 'ZION_ETAPA6_BEHAVIORAL_PASS_WITH_CONCURRENCY_PENDING'
       ELSE 'ZION_ETAPA6_BEHAVIORAL_FAIL'
  END AS veredito,
  count(*) AS scenarios,
  count(*) FILTER (WHERE status = 'PASS') AS passed,
  count(*) FILTER (WHERE status = 'PENDING') AS pending,
  count(*) FILTER (WHERE status IN ('SUT_FAIL', 'HARNESS_ERROR')) AS failed
  FROM pg_temp.zion_etapa6_behavior_results;

ROLLBACK;
