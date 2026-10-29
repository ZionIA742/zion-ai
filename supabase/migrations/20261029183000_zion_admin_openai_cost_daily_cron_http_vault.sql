-- ZION-ADM: cron diario de custos OpenAI.
-- Instalacao idempotente e fail-closed.
-- Nunca ativa o agendamento nem executa HTTP.
-- Requer URL e credencial previamente cadastradas no Vault.

BEGIN;

DO $$
DECLARE
    v_job_id bigint;
    v_count bigint;
    v_job cron.job%ROWTYPE;

    v_command text := $cron_sql$
        SELECT net.http_get(
            url := (
                SELECT decrypted_secret
                FROM vault.decrypted_secrets
                WHERE name = 'zion_admin_openai_cost_url'
            ),
            headers := jsonb_build_object(
                'Authorization',
                'Bearer ' || (
                    SELECT decrypted_secret
                    FROM vault.decrypted_secrets
                    WHERE name = 'zion_admin_openai_cost_cron_secret'
                )
            ),
            timeout_milliseconds := 60000
        ) AS request_id;
    $cron_sql$;
BEGIN
    -- Falha se o Vault nao estiver preparado corretamente.
    IF (
        SELECT COUNT(*)
        FROM vault.decrypted_secrets
        WHERE (
            name = 'zion_admin_openai_cost_url'
            AND decrypted_secret =
                'https://zionapi.com.br/api/cron/zion-admin-openai-costs'
        )
        OR (
            name = 'zion_admin_openai_cost_cron_secret'
            AND decrypted_secret ~ '^[A-Za-z0-9_-]{64}$'
        )
    ) <> 2 THEN
        RAISE EXCEPTION
            'ZION_ADM_OPENAI_COST_VAULT_INVALID';
    END IF;

    SELECT COUNT(*), MAX(jobid)
    INTO v_count, v_job_id
    FROM cron.job
    WHERE jobname = 'zion_admin_openai_cost_daily';

    IF v_count > 1 THEN
        RAISE EXCEPTION
            'ZION_ADM_OPENAI_COST_DUPLICATE_CRON';
    END IF;

    IF v_count = 0 THEN
        -- Cria inicialmente com comando inofensivo.
        SELECT cron.schedule(
            'zion_admin_openai_cost_daily',
            '15 12 * * *',
            'SELECT 1;'
        )
        INTO v_job_id;

        -- Desativa na mesma transacao.
        PERFORM cron.alter_job(
            job_id := v_job_id,
            active := false
        );
    END IF;

    SELECT *
    INTO v_job
    FROM cron.job
    WHERE jobid = v_job_id;

    IF NOT FOUND
        OR v_job.jobname <> 'zion_admin_openai_cost_daily'
        OR v_job.schedule <> '15 12 * * *'
        OR v_job.active IS DISTINCT FROM false
    THEN
        RAISE EXCEPTION
            'ZION_ADM_OPENAI_COST_CRON_STATE_INVALID';
    END IF;

    IF v_job.command = v_command THEN
        -- Ja configurado corretamente. Nenhuma alteracao.
        NULL;
    ELSIF btrim(v_job.command) = 'SELECT 1;' THEN
        PERFORM cron.alter_job(
            job_id := v_job_id,
            command := v_command,
            active := false
        );
    ELSE
        RAISE EXCEPTION
            'ZION_ADM_OPENAI_COST_CRON_COMMAND_DIVERGENT';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobid = v_job_id
          AND jobname = 'zion_admin_openai_cost_daily'
          AND schedule = '15 12 * * *'
          AND active = false
          AND command = v_command
    ) THEN
        RAISE EXCEPTION
            'ZION_ADM_OPENAI_COST_CRON_FINAL_CHECK_FAILED';
    END IF;
END;
$$;

COMMIT;