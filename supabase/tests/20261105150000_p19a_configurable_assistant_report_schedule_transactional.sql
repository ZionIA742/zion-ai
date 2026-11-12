-- TEMPORARIO: migration + teste funcional P19-A em uma unica transacao.
-- Uso: SQL Editor Supabase, em banco de teste autorizado.
-- Nao executar em producao. O ROLLBACK final e intencional.

BEGIN;

-- Corpo da migration 20261105130000, sem BEGIN/COMMIT internos.
DO $migration_preflight$
BEGIN
  IF to_regclass('public.store_schedule_settings') IS NULL THEN
    RAISE EXCEPTION 'P19-A prerequisite missing: public.store_schedule_settings';
  END IF;

  IF to_regprocedure('public.upsert_store_schedule_settings(uuid,uuid,boolean,boolean,integer,boolean,jsonb,jsonb,jsonb,text,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'P19-A prerequisite missing: legacy 13-argument RPC';
  END IF;
END;
$migration_preflight$;

ALTER TABLE public.store_schedule_settings
  ADD COLUMN IF NOT EXISTS assistant_morning_report_time time without time zone NULL,
  ADD COLUMN IF NOT EXISTS assistant_evening_report_time time without time zone NULL,
  ADD COLUMN IF NOT EXISTS assistant_non_operating_report_policy text NOT NULL
    DEFAULT 'skip_and_consolidate_non_operating_days';

DO $migration_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.store_schedule_settings'::regclass
      AND conname = 'store_schedule_settings_assistant_report_policy_valid'
  ) THEN
    ALTER TABLE public.store_schedule_settings
      ADD CONSTRAINT store_schedule_settings_assistant_report_policy_valid
      CHECK (assistant_non_operating_report_policy IN (
        'send_on_non_operating_ai_days',
        'skip_non_operating_days',
        'skip_and_consolidate_non_operating_days'
      ));
  END IF;
END;
$migration_constraint$;

CREATE OR REPLACE FUNCTION public.upsert_store_schedule_settings(
  p_organization_id uuid,
  p_store_id uuid,
  p_allow_multiple_appointments_per_day boolean,
  p_allow_same_time_appointments boolean,
  p_same_time_capacity integer,
  p_attends_holidays boolean,
  p_operating_days jsonb,
  p_operating_hours jsonb,
  p_installation_days jsonb,
  p_after_hours_behavior text,
  p_notes text,
  p_enforce_operating_window boolean,
  p_timezone_name text,
  p_assistant_morning_report_time time without time zone,
  p_assistant_evening_report_time time without time zone,
  p_assistant_non_operating_report_policy text
)
RETURNS public.store_schedule_settings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $migration_function$
DECLARE
  v_policy text;
  v_settings public.store_schedule_settings;
BEGIN
  v_policy := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(
    p_assistant_non_operating_report_policy, ''
  )), ''));

  IF v_policy IS NULL OR v_policy NOT IN (
    'send_on_non_operating_ai_days',
    'skip_non_operating_days',
    'skip_and_consolidate_non_operating_days'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ASSISTANT_NON_OPERATING_REPORT_POLICY_INVALID';
  END IF;

  v_settings := public.upsert_store_schedule_settings(
    p_organization_id,
    p_store_id,
    p_allow_multiple_appointments_per_day,
    p_allow_same_time_appointments,
    p_same_time_capacity,
    p_attends_holidays,
    p_operating_days,
    p_operating_hours,
    p_installation_days,
    p_after_hours_behavior,
    p_notes,
    p_enforce_operating_window,
    p_timezone_name
  );

  UPDATE public.store_schedule_settings
  SET assistant_morning_report_time = p_assistant_morning_report_time,
      assistant_evening_report_time = p_assistant_evening_report_time,
      assistant_non_operating_report_policy = v_policy,
      updated_at = pg_catalog.clock_timestamp()
  WHERE organization_id = p_organization_id
    AND store_id = p_store_id
  RETURNING * INTO v_settings;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'STORE_SCHEDULE_SETTINGS_NOT_FOUND_AFTER_LEGACY_WRITE';
  END IF;

  RETURN v_settings;
END;
$migration_function$;

ALTER FUNCTION public.upsert_store_schedule_settings(
  uuid, uuid, boolean, boolean, integer, boolean, jsonb, jsonb, jsonb,
  text, text, boolean, text, time without time zone,
  time without time zone, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.upsert_store_schedule_settings(
  uuid, uuid, boolean, boolean, integer, boolean, jsonb, jsonb, jsonb,
  text, text, boolean, text, time without time zone,
  time without time zone, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_store_schedule_settings(
  uuid, uuid, boolean, boolean, integer, boolean, jsonb, jsonb, jsonb,
  text, text, boolean, text, time without time zone,
  time without time zone, text
) TO authenticated, service_role;

-- Harnesso funcional: somente fixtures sinteticas e sem dados persistentes.
CREATE TEMP TABLE _p19a_results (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp._p19a_assert(
  p_name text,
  p_condition boolean,
  p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $test_assert$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P19-A assertion failed [%]: %', p_name, coalesce(p_detail, '');
  END IF;
  INSERT INTO _p19a_results VALUES (p_name, true, p_detail);
END;
$test_assert$;

CREATE OR REPLACE FUNCTION pg_temp._p19a_call(
  p_role text,
  p_user_id uuid,
  p_sql text
) RETURNS TABLE(ok boolean, error_code text, message text)
LANGUAGE plpgsql AS $test_call$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id::text, 'role', p_role
  )::text, true);
  IF p_role = 'authenticated' THEN
    SET LOCAL ROLE authenticated;
  ELSIF p_role = 'anon' THEN
    SET LOCAL ROLE anon;
  END IF;

  BEGIN
    EXECUTE p_sql;
    ok := true; error_code := NULL; message := NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_code = RETURNED_SQLSTATE, message = MESSAGE_TEXT;
    ok := false;
  END;
  RESET ROLE;
  RETURN NEXT;
END;
$test_call$;

DO $test_fixtures$
DECLARE
  v_org_a uuid := '10000000-0000-0000-0000-000000000001';
  v_org_b uuid := '10000000-0000-0000-0000-000000000002';
  v_store_a uuid := '20000000-0000-0000-0000-000000000001';
  v_store_b uuid := '20000000-0000-0000-0000-000000000002';
  v_user_a uuid := '30000000-0000-0000-0000-000000000001';
  v_user_b uuid := '30000000-0000-0000-0000-000000000002';
  v_user_inactive uuid := '30000000-0000-0000-0000-000000000003';
  v_call record;
  v_before record;
  v_after record;
  v_null_morning boolean;
  v_null_evening boolean;
BEGIN
  INSERT INTO public.organizations (id, name)
  VALUES (v_org_a, 'P19A synthetic organization A'),
         (v_org_b, 'P19A synthetic organization B');

  INSERT INTO public.stores (id, organization_id, name)
  VALUES (v_store_a, v_org_a, 'P19A synthetic store A'),
         (v_store_b, v_org_b, 'P19A synthetic store B');

  INSERT INTO auth.users (id)
  VALUES (v_user_a), (v_user_b), (v_user_inactive);

  INSERT INTO public.memberships (organization_id, user_id, role, is_active)
  VALUES (v_org_a, v_user_a, 'owner'::public.app_role, true),
         (v_org_b, v_user_b, 'owner'::public.app_role, true),
         (v_org_a, v_user_inactive, 'owner'::public.app_role, false);

  INSERT INTO public.store_schedule_settings (
    organization_id, store_id, allow_multiple_appointments_per_day,
    allow_same_time_appointments, same_time_capacity, attends_holidays,
    enforce_operating_window, operating_days, operating_hours,
    installation_days, after_hours_behavior, timezone_name, notes
  ) VALUES (
    v_org_a, v_store_a, true, false, 1, false, false,
    '["monday","tuesday"]'::jsonb,
    '{"monday":{"start":"08:00","end":"18:00"},"tuesday":{"start":"08:00","end":"18:00"}}'::jsonb,
    '["monday"]'::jsonb, 'queue_next_day', 'America/Sao_Paulo',
    'P19A synthetic fixture'
  );

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, true, false, 1, false,
        '["monday","tuesday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'authorized new RPC', false,
        'America/Sao_Paulo', '07:30'::time, '20:15'::time,
        'send_on_non_operating_ai_days'
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert('authorized_new_rpc', v_call.ok, v_call.message);

  SELECT assistant_morning_report_time, assistant_evening_report_time,
         assistant_non_operating_report_policy
  INTO v_before
  FROM public.store_schedule_settings
  WHERE organization_id = v_org_a AND store_id = v_store_a;

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, false, true, 2, false, '{"legacy":true}'::jsonb,
        '{"monday":{"start":"09:00","end":"19:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'legacy update', false,
        'America/Sao_Paulo'
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert('legacy_rpc_preserves_new_fields', v_call.ok, v_call.message);

  SELECT assistant_morning_report_time, assistant_evening_report_time,
         assistant_non_operating_report_policy
  INTO v_after
  FROM public.store_schedule_settings
  WHERE organization_id = v_org_a AND store_id = v_store_a;
  PERFORM pg_temp._p19a_assert(
    'legacy_update_keeps_schedule_times_and_policy',
    v_after.assistant_morning_report_time = v_before.assistant_morning_report_time
      AND v_after.assistant_evening_report_time = v_before.assistant_evening_report_time
      AND v_after.assistant_non_operating_report_policy = v_before.assistant_non_operating_report_policy
  );

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, true, false, 1, false,
        '["monday"]'::jsonb, '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'clear custom times', false,
        'America/Sao_Paulo', NULL, NULL,
        'skip_non_operating_days'
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert('null_clears_custom_times', v_call.ok, v_call.message);
  SELECT assistant_morning_report_time IS NULL,
         assistant_evening_report_time IS NULL
  INTO v_null_morning, v_null_evening
  FROM public.store_schedule_settings
  WHERE organization_id = v_org_a AND store_id = v_store_a;
  PERFORM pg_temp._p19a_assert(
    'null_values_persist',
    v_null_morning AND v_null_evening
  );

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, true, false, 1, false, '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'invalid policy', false,
        'America/Sao_Paulo', NULL, NULL, 'invalid_policy'
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert(
    'invalid_policy_rejected', NOT v_call.ok AND v_call.error_code IN ('22023', '23514')
  );

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, true, false, 1, false, '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'null policy', false,
        'America/Sao_Paulo', NULL, NULL, NULL
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert(
    'null_policy_rejected', NOT v_call.ok AND v_call.error_code IN ('22023', '23514')
  );

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_a,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, true, false, 1, false, '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'empty policy', false,
        'America/Sao_Paulo', NULL, NULL, ''
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert(
    'empty_policy_rejected', NOT v_call.ok AND v_call.error_code IN ('22023', '23514')
  );

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_inactive,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, true, false, 1, false, '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'inactive user', false,
        'America/Sao_Paulo', NULL, NULL, 'skip_non_operating_days'
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert('inactive_membership_rejected', NOT v_call.ok AND v_call.error_code = '42501');

  SELECT * INTO v_call FROM pg_temp._p19a_call(
    'authenticated', v_user_b,
    format($sql$
      SELECT public.upsert_store_schedule_settings(
        %L, %L, true, false, 1, false, '["monday"]'::jsonb,
        '{"monday":{"start":"08:00","end":"18:00"}}'::jsonb,
        '["monday"]'::jsonb, 'queue_next_day', 'cross tenant', false,
        'America/Sao_Paulo', NULL, NULL, 'skip_non_operating_days'
      )
    $sql$, v_org_a, v_store_a)
  );
  PERFORM pg_temp._p19a_assert('cross_tenant_rejected', NOT v_call.ok AND v_call.error_code = '42501');

  PERFORM pg_temp._p19a_assert(
    'synthetic_row_exists_before_rollback',
    EXISTS (SELECT 1 FROM public.store_schedule_settings WHERE organization_id = v_org_a AND store_id = v_store_a)
  );
END;
$test_fixtures$;

SELECT * FROM _p19a_results ORDER BY check_name;

-- Obrigatorio: desfaz DDL, fixtures, grants, funcoes temporarias e resultados.
ROLLBACK;
