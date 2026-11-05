-- P19-A / Bloco 5 / Etapa 1
-- Persistencia dos horarios dos relatorios automaticos por loja.
--
-- Esta migration nao altera a interface, o cron, o conteudo dos relatorios
-- ou o comportamento operacional. Os campos so passam a ter efeito quando
-- uma etapa posterior os consumir.
--
-- A RPC legada upsert_store_schedule_settings permanece intacta. A nova
-- sobrecarga delega primeiro para a RPC legada e depois grava exclusivamente
-- os tres campos novos. Chamadas antigas continuam usando a assinatura de
-- 13 argumentos e nao sobrescrevem os campos novos.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.store_schedule_settings') IS NULL THEN
    RAISE EXCEPTION
      'P19A_REPORT_SCHEDULE_SETTINGS_TABLE_MISSING';
  END IF;

  IF to_regprocedure(
       'public.upsert_store_schedule_settings(uuid,uuid,boolean,boolean,integer,boolean,jsonb,jsonb,jsonb,text,text,boolean,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'P19A_LEGACY_SCHEDULE_RPC_SIGNATURE_MISSING';
  END IF;
END;
$preflight$;

ALTER TABLE public.store_schedule_settings
  ADD COLUMN IF NOT EXISTS assistant_morning_report_time
    time without time zone NULL,
  ADD COLUMN IF NOT EXISTS assistant_evening_report_time
    time without time zone NULL,
  ADD COLUMN IF NOT EXISTS assistant_non_operating_report_policy
    text NOT NULL
    DEFAULT 'skip_and_consolidate_non_operating_days';

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.store_schedule_settings'::regclass
      AND conname =
        'store_schedule_settings_assistant_report_policy_valid'
  ) THEN
    ALTER TABLE public.store_schedule_settings
      ADD CONSTRAINT
        store_schedule_settings_assistant_report_policy_valid
      CHECK (
        assistant_non_operating_report_policy IN (
          'send_on_non_operating_ai_days',
          'skip_non_operating_days',
          'skip_and_consolidate_non_operating_days'
        )
      );
  END IF;
END;
$constraints$;

COMMENT ON COLUMN public.store_schedule_settings
  .assistant_morning_report_time IS
  'Optional local time for the Assistant morning report. NULL preserves the current default.';

COMMENT ON COLUMN public.store_schedule_settings
  .assistant_evening_report_time IS
  'Optional local time for the Assistant evening report. NULL preserves the current default.';

COMMENT ON COLUMN public.store_schedule_settings
  .assistant_non_operating_report_policy IS
  'Policy for automatic reports on days without human operation: send, skip, or skip and consolidate.';

CREATE OR REPLACE FUNCTION
public.upsert_store_schedule_settings(
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
AS $function$
DECLARE
  v_policy text;
  v_result public.store_schedule_settings;
BEGIN
  v_policy := pg_catalog.lower(
    nullif(
      pg_catalog.btrim(
        coalesce(
          p_assistant_non_operating_report_policy,
          ''
        )
      ),
      ''
    )
  );

  IF v_policy IS NULL OR v_policy NOT IN (
    'send_on_non_operating_ai_days',
    'skip_non_operating_days',
    'skip_and_consolidate_non_operating_days'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ASSISTANT_NON_OPERATING_REPORT_POLICY_INVALID';
  END IF;

  -- A RPC legada permanece a autoridade para identidade, organizacao,
  -- loja e todas as configuracoes operacionais existentes.
  v_result := public.upsert_store_schedule_settings(
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
  SET
    assistant_morning_report_time =
      p_assistant_morning_report_time,
    assistant_evening_report_time =
      p_assistant_evening_report_time,
    assistant_non_operating_report_policy = v_policy,
    updated_at = pg_catalog.clock_timestamp()
  WHERE organization_id = p_organization_id
    AND store_id = p_store_id
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'STORE_SCHEDULE_SETTINGS_NOT_FOUND_AFTER_LEGACY_WRITE';
  END IF;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.upsert_store_schedule_settings(
  uuid, uuid, boolean, boolean, integer, boolean,
  jsonb, jsonb, jsonb, text, text, boolean, text,
  time without time zone, time without time zone, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.upsert_store_schedule_settings(
  uuid, uuid, boolean, boolean, integer, boolean,
  jsonb, jsonb, jsonb, text, text, boolean, text,
  time without time zone, time without time zone, text
)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.upsert_store_schedule_settings(
  uuid, uuid, boolean, boolean, integer, boolean,
  jsonb, jsonb, jsonb, text, text, boolean, text,
  time without time zone, time without time zone, text
)
TO authenticated, service_role;

COMMIT;
