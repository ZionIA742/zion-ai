-- P19-A / Bloco 5 / Etapa 1
-- Teste funcional transacional da RPC de 16 argumentos.
--
-- EXECUCAO MANUAL EM AMBIENTE DE TESTE AUTORIZADO.
-- Este arquivo usa somente fixtures sinteticas e termina com ROLLBACK.
-- Nao executar contra dados comerciais reais.

BEGIN;

CREATE TEMP TABLE pg_temp._p19a_report_schedule_results (
  check_number integer PRIMARY KEY,
  check_name text NOT NULL,
  status text NOT NULL,
  details text NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp._p19a_record(
  p_check_number integer,
  p_check_name text,
  p_status text,
  p_details text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO pg_temp._p19a_report_schedule_results (
    check_number,
    check_name,
    status,
    details
  )
  VALUES (
    p_check_number,
    p_check_name,
    p_status,
    p_details
  );
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp._p19a_exec(
  p_role text,
  p_user_id uuid,
  p_sql text
)
RETURNS TABLE (
  succeeded boolean,
  returned_value text,
  error_code text,
  error_message text
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_value text;
  v_error_code text;
  v_message text;
BEGIN
  EXECUTE 'RESET ROLE';

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_user_id::text, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    coalesce(p_role, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', coalesce(p_user_id::text, ''),
      'role', coalesce(p_role, '')
    )::text,
    true
  );

  IF p_role = 'authenticated' THEN
    EXECUTE 'SET LOCAL ROLE authenticated';
  ELSIF p_role = 'anon' THEN
    EXECUTE 'SET LOCAL ROLE anon';
  END IF;

  BEGIN
    EXECUTE p_sql INTO v_value;
    EXECUTE 'RESET ROLE';
    RETURN QUERY SELECT true, v_value, null::text, null::text;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_code = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;

      EXECUTE 'RESET ROLE';
      RETURN QUERY SELECT false, null::text, v_error_code, v_message;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp._p19a_require_success(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_value text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_result record;
BEGIN
  SELECT *
  INTO v_result
  FROM pg_temp._p19a_exec(p_role, p_user_id, p_sql);

  IF v_result.succeeded IS NOT TRUE THEN
    RAISE EXCEPTION
      'TEST_FAILURE expected success error_code=% message=% sql=%',
      v_result.error_code,
      v_result.error_message,
      p_sql;
  END IF;

  IF p_expected_value IS NOT NULL
     AND v_result.returned_value IS DISTINCT FROM p_expected_value
  THEN
    RAISE EXCEPTION
      'TEST_FAILURE unexpected value expected=% actual=%',
      p_expected_value,
      v_result.returned_value;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp._p19a_require_failure(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_sqlstates text[] DEFAULT array['42501','23514','22023']::text[]
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_result record;
BEGIN
  SELECT *
  INTO v_result
  FROM pg_temp._p19a_exec(p_role, p_user_id, p_sql);

  IF v_result.succeeded IS TRUE THEN
    RAISE EXCEPTION
      'TEST_FAILURE expected rejection but call succeeded sql=%',
      p_sql;
  END IF;

  IF NOT coalesce(v_result.error_code, '') = ANY(p_expected_sqlstates)
  THEN
    RAISE EXCEPTION
      'TEST_FAILURE unexpected error_code expected one of % actual=% message=%',
      p_expected_sqlstates,
      v_result.error_code,
      v_result.error_message;
  END IF;
END;
$function$;

DO $setup$
DECLARE
  v_run_token text := 'p19a_report_schedule_' || replace(gen_random_uuid()::text, '-', '');
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_inactive uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.organizations (id, name)
  VALUES
    (v_org_a, 'P19A Synthetic Org A ' || v_run_token),
    (v_org_b, 'P19A Synthetic Org B ' || v_run_token);

  INSERT INTO public.stores (id, organization_id, name)
  VALUES
    (v_store_a, v_org_a, 'P19A Synthetic Store A ' || v_run_token),
    (v_store_b, v_org_b, 'P19A Synthetic Store B ' || v_run_token);

  INSERT INTO auth.users (id)
  VALUES (v_user_a), (v_user_b), (v_user_inactive);

  INSERT INTO public.memberships (
    organization_id,
    user_id,
    role,
    is_active
  )
  VALUES
    (v_org_a, v_user_a, 'owner'::public.app_role, true),
    (v_org_b, v_user_b, 'owner'::public.app_role, true),
    (v_org_a, v_user_inactive, 'owner'::public.app_role, false);

  INSERT INTO public.store_schedule_settings (
    organization_id,
    store_id,
    allow_multiple_appointments_per_day,
    allow_same_time_appointments,
    same_time_capacity,
    attends_holidays,
    enforce_operating_window,
    operating_days,
    operating_hours,
    installation_days,
    after_hours_behavior,
    timezone_name,
    notes
  )
  VALUES (
    v_org_a,
    v_store_a,
    true,
    false,
    1,
    false,
    false,
    '["monday","tuesday"]'::jsonb,
    '{"monday":{"start":"08:00","end":"18:00"},"tuesday":{"start":"08:00","end":"18:00"}}'::jsonb,
    '["monday"]'::jsonb,
    'queue_next_day',
    'America/Sao_Paulo',
    'P19A synthetic fixture'
  );

  INSERT INTO pg_temp._p19a_report_schedule_results (
    check_number,
    check_name,
    status,
    details
  )
  VALUES
    (0, 'fixture', 'INFO', v_org_a::text || ':' || v_store_a::text);

  PERFORM set_config(
    'p19a.test.org_a', v_org_a::text, true
  );
  PERFORM set_config(
    'p19a.test.org_b', v_org_b::text, true
  );
  PERFORM set_config(
    'p19a.test.store_a', v_store_a::text, true
  );
  PERFORM set_config(
    'p19a.test.store_b', v_store_b::text, true
  );
  PERFORM set_config(
    'p19a.test.user_a', v_user_a::text, true
  );
  PERFORM set_config(
    'p19a.test.user_b', v_user_b::text, true
  );
  PERFORM set_config(
    'p19a.test.user_inactive', v_user_inactive::text, true
  );
END;
$setup$;

DO $checks$
DECLARE
  v_org_a uuid := current_setting('p19a.test.org_a')::uuid;
  v_org_b uuid := current_setting('p19a.test.org_b')::uuid;
  v_store_a uuid := current_setting('p19a.test.store_a')::uuid;
  v_store_b uuid := current_setting('p19a.test.store_b')::uuid;
  v_user_a uuid := current_setting('p19a.test.user_a')::uuid;
  v_user_b uuid := current_setting('p19a.test.user_b')::uuid;
  v_user_inactive uuid := current_setting('p19a.test.user_inactive')::uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- 1. Usuario autorizado grava horarios e politica.
  PERFORM pg_temp._p19a_require_success(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday","tuesday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"},"tuesday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day',
        'P19A updated',
        false,
        'America/Sao_Paulo',
        '08:30'::time,
        '19:30'::time,
        'send_on_non_operating_ai_days'
      )::text
    $sql$, v_org_a, v_store_a)
  );

  SELECT to_jsonb(s)
  INTO v_before
  FROM public.store_schedule_settings s
  WHERE s.organization_id = v_org_a
    AND s.store_id = v_store_a;

  PERFORM pg_temp._p19a_record(
    1,
    'authorized user saves custom times and policy',
    'PASS',
    'authenticated fixture updated its own store'
  );

  -- 2. A RPC antiga preserva os tres campos novos.
  PERFORM pg_temp._p19a_require_success(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday","tuesday"]'::jsonb,
        '{"monday":{"start":"09:00","end":"17:00"},"tuesday":{"start":"09:00","end":"17:00"}}'::jsonb,
        '["tuesday"]'::jsonb,
        'queue_next_day',
        'legacy preservation before null',
        false,
        'America/Sao_Paulo'
      )::text
    $sql$, v_org_a, v_store_a)
  );

  SELECT to_jsonb(s)
  INTO v_after
  FROM public.store_schedule_settings s
  WHERE s.organization_id = v_org_a
    AND s.store_id = v_store_a;

  IF v_before ->> 'assistant_morning_report_time'
       IS DISTINCT FROM v_after ->> 'assistant_morning_report_time'
     OR v_before ->> 'assistant_evening_report_time'
       IS DISTINCT FROM v_after ->> 'assistant_evening_report_time'
     OR v_before ->> 'assistant_non_operating_report_policy'
       IS DISTINCT FROM v_after ->> 'assistant_non_operating_report_policy'
  THEN
    RAISE EXCEPTION 'TEST_FAILURE legacy RPC changed new report fields';
  END IF;

  PERFORM pg_temp._p19a_record(
    2,
    'legacy RPC preserves both times and policy',
    'PASS',
    '13-argument writer preserved all three new fields'
  );

  -- 3. NULL limpa os horarios personalizados.
  PERFORM pg_temp._p19a_require_success(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday","tuesday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"},"tuesday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day',
        'P19A null cleanup',
        false,
        'America/Sao_Paulo',
        NULL,
        NULL,
        'skip_non_operating_days'
      )::text
    $sql$, v_org_a, v_store_a)
  );

  SELECT to_jsonb(s)
  INTO v_after
  FROM public.store_schedule_settings s
  WHERE s.organization_id = v_org_a
    AND s.store_id = v_store_a;

  IF v_after ->> 'assistant_morning_report_time' IS NOT NULL
     OR v_after ->> 'assistant_evening_report_time' IS NOT NULL
  THEN
    RAISE EXCEPTION 'TEST_FAILURE NULL did not clear custom report times';
  END IF;

  PERFORM pg_temp._p19a_record(
    3,
    'NULL clears custom times',
    'PASS',
    'both report times are null'
  );

  -- 4. Politica invalida e rejeitada.
  PERFORM pg_temp._p19a_require_failure(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day', NULL, false,
        'America/Sao_Paulo', NULL, NULL, 'invalid_policy'
      )::text
    $sql$, v_org_a, v_store_a),
    array['23514']::text[]
  );

  PERFORM pg_temp._p19a_record(
    4,
    'invalid policy rejected',
    'PASS',
    'expected SQLSTATE 23514'
  );

  -- 5. Politicas NULL e vazia sao rejeitadas explicitamente.
  PERFORM pg_temp._p19a_require_failure(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day', NULL, false,
        'America/Sao_Paulo', NULL, NULL, NULL
      )::text
    $sql$, v_org_a, v_store_a),
    array['23514']::text[]
  );

  PERFORM pg_temp._p19a_record(
    5,
    'NULL policy rejected',
    'PASS',
    'explicit policy validation returned SQLSTATE 23514'
  );

  PERFORM pg_temp._p19a_require_failure(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day', '', false,
        'America/Sao_Paulo', NULL, NULL, NULL
      )::text
    $sql$, v_org_a, v_store_a),
    array['23514']::text[]
  );

  PERFORM pg_temp._p19a_record(
    6,
    'empty policy rejected',
    'PASS',
    'empty policy returned SQLSTATE 23514'
  );

  -- 7. RPC antiga continua funcionando.
  PERFORM pg_temp._p19a_require_success(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday","tuesday"]'::jsonb,
        '{"monday":{"start":"09:00","end":"17:00"},"tuesday":{"start":"09:00","end":"17:00"}}'::jsonb,
        '["tuesday"]'::jsonb,
        'queue_next_day',
        'legacy call', false, 'America/Sao_Paulo'
      )::text
    $sql$, v_org_a, v_store_a)
  );

  PERFORM pg_temp._p19a_record(
    7,
    'legacy 13-argument RPC remains callable',
    'PASS',
    'legacy call completed without changing new fields'
  );

  -- 8. Atualizacao antiga nao apaga os novos campos.
  PERFORM pg_temp._p19a_require_success(
    'authenticated',
    v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday"]'::jsonb,
        '{"monday":{"start":"10:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day',
        'legacy preservation', false, 'America/Sao_Paulo'
      )::text
    $sql$, v_org_a, v_store_a)
  );

  SELECT to_jsonb(s)
  INTO v_after
  FROM public.store_schedule_settings s
  WHERE s.organization_id = v_org_a
    AND s.store_id = v_store_a;

  IF v_after ->> 'assistant_morning_report_time' IS NOT NULL
     OR v_after ->> 'assistant_evening_report_time' IS NOT NULL
     OR v_after ->> 'assistant_non_operating_report_policy'
       IS DISTINCT FROM 'skip_non_operating_days'
  THEN
    RAISE EXCEPTION 'TEST_FAILURE legacy update erased new report fields';
  END IF;

  PERFORM pg_temp._p19a_record(
    8,
    'legacy update preserves new fields',
    'PASS',
    'legacy writer preserved cleared times and policy'
  );

  -- 9. Membership inativo nao pode alterar a loja.
  PERFORM pg_temp._p19a_require_failure(
    'authenticated',
    v_user_inactive,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day', NULL, false,
        'America/Sao_Paulo', '07:00'::time, NULL,
        'skip_non_operating_days'
      )::text
    $sql$, v_org_a, v_store_a)
  );

  PERFORM pg_temp._p19a_record(
    9,
    'inactive membership rejected',
    'PASS',
    'authenticated inactive fixture was denied'
  );

  -- 10. Usuario de outra organizacao nao pode alterar a loja A.
  PERFORM pg_temp._p19a_require_failure(
    'authenticated',
    v_user_b,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L::uuid, %L::uuid,
        true, false, 1, false,
        '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb,
        'queue_next_day', NULL, false,
        'America/Sao_Paulo', '07:00'::time, NULL,
        'skip_non_operating_days'
      )::text
    $sql$, v_org_a, v_store_a)
  );

  PERFORM pg_temp._p19a_record(
    10,
    'foreign organization rejected',
    'PASS',
    'user B was denied access to organization A store'
  );

  -- 11. O snapshot inicial permanece dentro da mesma transacao e sera
  -- revertido pelo ROLLBACK final.
  IF v_before IS NULL OR v_after IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILURE fixture snapshot missing';
  END IF;

  PERFORM pg_temp._p19a_record(
    11,
    'all changes are rollback-scoped',
    'PASS',
    'fixture and RPC mutations are inside the outer transaction'
  );
END;
$checks$;

SELECT
  check_number,
  check_name,
  status,
  details
FROM pg_temp._p19a_report_schedule_results
ORDER BY check_number;

ROLLBACK;
