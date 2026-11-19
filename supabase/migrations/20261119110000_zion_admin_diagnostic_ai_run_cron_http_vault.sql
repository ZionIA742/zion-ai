-- ZION-ADM | Bloco 2 | 2.3-D
-- Configura HTTP do cron de diagnosticos.
-- Exige URL e segredo exclusivos no Supabase Vault.
-- Nunca executa HTTP durante a instalacao.
-- Nunca ativa o job, a captura ou as IAs.

BEGIN;

SET LOCAL statement_timeout = '30000ms';
SET LOCAL lock_timeout = '2000ms';

DO $setup$
DECLARE
    v_job cron.job%ROWTYPE;
    v_url text;
    v_secret text;
    v_url_count integer;
    v_secret_count integer;

    v_command text := $cron_sql$
        SELECT net.http_get(
            url := (
                SELECT decrypted_secret
                FROM vault.decrypted_secrets
                WHERE name = 'zion_admin_diagnostic_ai_run_url'
            ),
            headers := jsonb_build_object(
                'Authorization',
                'Bearer ' || (
                    SELECT decrypted_secret
                    FROM vault.decrypted_secrets
                    WHERE name =
                        'zion_admin_diagnostic_ai_run_cron_secret'
                )
            ),
            timeout_milliseconds := 60000
        ) AS request_id;
    $cron_sql$;
BEGIN
    -- Historico anterior deve estar completo.
    IF (
        SELECT count(*)
        FROM supabase_migrations.schema_migrations
        WHERE version IN (
            '20261115050000',
            '20261115051000',
            '20261115052000',
            '20261116090000',
            '20261116091000',
            '20261117170000',
            '20261117183000'
        )
    ) <> 7 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_PREREQUISITES_MISSING';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM supabase_migrations.schema_migrations
        WHERE version = '20261119110000'
    ) THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_VERSION_REGISTERED';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_extension
        WHERE extname = 'pg_net'
    ) THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_PG_NET_MISSING';
    END IF;

    -- A captura continua desligada.
    IF (
        SELECT count(*)
        FROM public.zion_admin_diagnostic_ai_run_capture_activation
        WHERE singleton IS TRUE
          AND activated_at IS NULL
    ) <> 1 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_CAPTURE_ALREADY_ACTIVE';
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
            'ZION_DIAGNOSTIC_HTTP_CAPTURE_STATE_INVALID';
    END IF;

    -- Os valores nunca sao copiados para o comando do cron.
    SELECT count(*), max(decrypted_secret)
    INTO v_url_count, v_url
    FROM vault.decrypted_secrets
    WHERE name = 'zion_admin_diagnostic_ai_run_url';

    SELECT count(*), max(decrypted_secret)
    INTO v_secret_count, v_secret
    FROM vault.decrypted_secrets
    WHERE name =
        'zion_admin_diagnostic_ai_run_cron_secret';

    IF v_url_count <> 1
       OR v_url IS NULL
       OR v_url !~
          '^https://[A-Za-z0-9][A-Za-z0-9.-]*/api/cron/zion-admin-diagnostic-ai-runs$'
    THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_URL_NOT_CONFIGURED';
    END IF;

    IF v_secret_count <> 1
       OR v_secret IS NULL
       OR v_secret !~ '^[A-Za-z0-9_-]{64}$'
    THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_SECRET_NOT_CONFIGURED';
    END IF;

    -- Usa somente o job preparado na 17-BB.
    SELECT *
    INTO v_job
    FROM cron.job
    WHERE jobname =
        'zion_admin_diagnostic_ai_runs_every_5_minutes'
    FOR UPDATE;

    IF NOT FOUND
       OR v_job.schedule <> '*/5 * * * *'
       OR v_job.active IS DISTINCT FROM false
    THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_JOB_STATE_INVALID';
    END IF;

    IF v_job.command = v_command THEN
        -- Configuracao identica: nenhuma mudanca.
        NULL;
    ELSIF btrim(v_job.command) = 'SELECT 1;' THEN
        PERFORM cron.alter_job(
            job_id := v_job.jobid,
            command := v_command,
            active := false
        );
    ELSE
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_COMMAND_DIVERGENCE';
    END IF;

    IF (
        SELECT count(*)
        FROM cron.job
        WHERE jobid = v_job.jobid
          AND jobname =
              'zion_admin_diagnostic_ai_runs_every_5_minutes'
          AND schedule = '*/5 * * * *'
          AND command = v_command
          AND active IS FALSE
    ) <> 1 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_HTTP_FINAL_CHECK_FAILED';
    END IF;
END;
$setup$;

COMMIT;
