-- ZION-ADM | Bloco 2 | Captura automatica de ai_runs
-- Registra somente a estrutura de agendamento.
-- Nao executa descobertas, processamento ou ativacao.
-- Nenhum HTTP e enviado nesta migration.
-- A configuracao HTTP sera uma operacao separada.

BEGIN;

SET LOCAL statement_timeout = '30000ms';
SET LOCAL lock_timeout = '2000ms';

DO $setup$
DECLARE
    v_job_id bigint;
    v_existing integer;
BEGIN
    IF (
        SELECT count(*)
        FROM supabase_migrations.schema_migrations
        WHERE version IN (
            '20261115050000',
            '20261115051000',
            '20261115052000',
            '20261116090000',
            '20261116091000',
            '20261117170000'
        )
    ) <> 6 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_CRON_PREREQUISITES_MISSING';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM supabase_migrations.schema_migrations
        WHERE version = '20261117183000'
    ) THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_CRON_MIGRATION_ALREADY_REGISTERED';
    END IF;

    IF to_regclass(
        'public.zion_admin_diagnostic_ai_run_capture_activation'
    ) IS NULL
    OR to_regclass(
        'public.zion_admin_diagnostic_ai_run_capture_baseline'
    ) IS NULL
    OR to_regclass('cron.job') IS NULL
    THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_CRON_INFRASTRUCTURE_MISSING';
    END IF;

    IF (
        SELECT count(*)
        FROM public.zion_admin_diagnostic_ai_run_capture_activation
        WHERE singleton IS TRUE
          AND activated_at IS NULL
    ) <> 1 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_CRON_CAPTURE_NOT_DISABLED';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_ai_run_capture_baseline
    )
    OR EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_ai_run_capture_attempts
    )
    OR EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_ai_run_capture_history
    ) THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_CRON_CAPTURE_STATE_UNEXPECTED';
    END IF;

    SELECT count(*)
    INTO v_existing
    FROM cron.job
    WHERE jobname =
        'zion_admin_diagnostic_ai_runs_every_5_minutes';

    IF v_existing <> 0 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_CRON_NAME_ALREADY_EXISTS';
    END IF;

    -- Cria inicialmente com comando inofensivo.
    SELECT cron.schedule(
        'zion_admin_diagnostic_ai_runs_every_5_minutes',
        '*/5 * * * *',
        'SELECT 1;'
    )
    INTO v_job_id;

    -- Desativa dentro da mesma transacao.
    PERFORM cron.alter_job(
        job_id := v_job_id,
        active := false
    );

    IF NOT EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobid = v_job_id
          AND jobname =
              'zion_admin_diagnostic_ai_runs_every_5_minutes'
          AND schedule = '*/5 * * * *'
          AND command = 'SELECT 1;'
          AND active IS FALSE
    ) THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_CRON_DISABLED_STATE_INVALID';
    END IF;
END;
$setup$;

COMMIT;
