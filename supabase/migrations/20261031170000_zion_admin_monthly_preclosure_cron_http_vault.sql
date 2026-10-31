-- ZION-ADM / 8-E.7
-- Agendamento mensal do pre-fechamento.
--
-- Reutiliza pg_cron, pg_net e credencial ja existente no Vault.
-- Nao modifica o cron diario da OpenAI.
-- Nao altera flags de aplicacao.
-- Nao executa HTTP nesta migration.
-- Nao cria nem revisa pre-fechamentos.
--
-- Agenda candidatos nos dias 28-31, as 23:00 UTC
-- (20:00 America/Sao_Paulo).
-- A rota e o writer SQL so permitem gravacao
-- no ultimo dia real da competencia.
--
-- O job permanece DESATIVADO ate autorizacao posterior.

BEGIN;

DO $$
DECLARE
    v_job_id bigint;
    v_count bigint;
    v_job cron.job%ROWTYPE;

    v_schedule text := '0 23 28-31 * *';

    v_command text := $cron_sql$
        SELECT net.http_get(
            url :=
                'https://zionapi.com.br/api/cron/zion-admin-monthly-preclosure',
            headers := jsonb_build_object(
                'Authorization',
                'Bearer ' || (
                    SELECT decrypted_secret
                    FROM vault.decrypted_secrets
                    WHERE name =
                        'zion_admin_openai_cost_cron_secret'
                )
            ),
            timeout_milliseconds := 60000
        ) AS request_id;
    $cron_sql$;
BEGIN
    -- Reutilizar somente a credencial ja configurada
    -- para o cron financeiro existente.
    -- Nunca armazenar o valor da credencial no SQL.
    IF (
        SELECT COUNT(*)
        FROM vault.decrypted_secrets
        WHERE name = 'zion_admin_openai_cost_cron_secret'
          AND decrypted_secret ~ '^[A-Za-z0-9_-]{64}$'
    ) <> 1 THEN
        RAISE EXCEPTION
            'ZION_ADM_PRECLOSURE_VAULT_INVALID';
    END IF;

    -- Nao criar job duplicado nem assumir que um
    -- agendamento divergente pertence a esta migration.
    SELECT COUNT(*), MAX(jobid)
    INTO v_count, v_job_id
    FROM cron.job
    WHERE jobname = 'zion_admin_monthly_preclosure';

    IF v_count > 1 THEN
        RAISE EXCEPTION
            'ZION_ADM_PRECLOSURE_DUPLICATE_CRON';
    END IF;

    IF v_count = 0 THEN
        -- Cria com comando inofensivo.
        -- Nada fica visivel ao executor externo antes
        -- do COMMIT desta transacao.
        SELECT cron.schedule(
            'zion_admin_monthly_preclosure',
            v_schedule,
            'SELECT 1;'
        )
        INTO v_job_id;

        -- Desativa antes de definir o comando HTTP.
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
       OR v_job.jobname <> 'zion_admin_monthly_preclosure'
       OR v_job.schedule <> v_schedule
       OR v_job.active IS DISTINCT FROM false
    THEN
        RAISE EXCEPTION
            'ZION_ADM_PRECLOSURE_CRON_STATE_INVALID';
    END IF;

    IF v_job.command = v_command THEN
        -- Reexecucao identica: nenhuma alteracao.
        NULL;

    ELSIF btrim(v_job.command) = 'SELECT 1;' THEN
        -- Instala o comando definitivo, ainda OFF.
        PERFORM cron.alter_job(
            job_id := v_job_id,
            command := v_command,
            active := false
        );

    ELSE
        -- Nunca sobrescrever outro comando.
        RAISE EXCEPTION
            'ZION_ADM_PRECLOSURE_CRON_COMMAND_DIVERGENT';
    END IF;

    -- Validacao final, ainda dentro da transacao.
    IF NOT EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobid = v_job_id
          AND jobname = 'zion_admin_monthly_preclosure'
          AND schedule = v_schedule
          AND active = false
          AND command = v_command
    ) THEN
        RAISE EXCEPTION
            'ZION_ADM_PRECLOSURE_CRON_FINAL_CHECK_FAILED';
    END IF;
END;
$$;

COMMIT;