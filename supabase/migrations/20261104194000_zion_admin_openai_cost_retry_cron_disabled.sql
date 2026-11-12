-- ZION-ADM OpenAI: retentativas economicas.
-- Quatro verificacoes por dia, distribuidas em dois jobs.
-- Horarios de Brasilia: 09:25, 09:50, 10:10, 10:40.
-- Ambos os jobs permanecem DESATIVADOS.
-- Nao altera cron 17, operacoes ou valores financeiros.
-- Nao executa requisicao HTTP durante a instalacao.

BEGIN;

DO $guard$
BEGIN
    IF (
        SELECT count(*)
        FROM cron.job
        WHERE jobid = 17
          AND jobname = 'zion_admin_openai_cost_daily'
          AND schedule = '15 12 * * *'
          AND active = true
    ) <> 1 THEN
        RAISE EXCEPTION 'OPENAI_DAILY_CRON_DIVERGENTE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname IN (
            'zion_admin_openai_cost_retry_0920',
            'zion_admin_openai_cost_retry_1000',
            'zion_admin_openai_cost_retry_0925_0950',
            'zion_admin_openai_cost_retry_1010_1040'
        )
    ) THEN
        RAISE EXCEPTION 'OPENAI_RETRY_JOB_EXISTENTE';
    END IF;

    IF (
        SELECT count(*)
        FROM vault.decrypted_secrets
        WHERE name = 'zion_admin_openai_cost_url'
          AND decrypted_secret ~
            '^https://[^[:space:]]+/api/cron/zion-admin-openai-costs/?$'
    ) <> 1 THEN
        RAISE EXCEPTION 'OPENAI_CRON_URL_INVALIDA';
    END IF;

    IF (
        SELECT count(*)
        FROM vault.decrypted_secrets
        WHERE name = 'zion_admin_openai_cost_cron_secret'
          AND decrypted_secret IS NOT NULL
          AND length(decrypted_secret) > 0
    ) <> 1 THEN
        RAISE EXCEPTION 'OPENAI_CRON_SEGREDO_INDISPONIVEL';
    END IF;
END;
$guard$;

-- 09:25 e 09:50 BRT = 12:25 e 12:50 UTC.

SELECT cron.schedule(
    'zion_admin_openai_cost_retry_0925_0950',
    '25,50 12 * * *',
    $request_a$
    SELECT net.http_get(
        url := (
            SELECT regexp_replace(
                decrypted_secret,
                '/api/cron/zion-admin-openai-costs/?$',
                '/api/cron/zion-admin-openai-cost-retries'
            )
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
        timeout_milliseconds := 30000
    ) AS request_id;
    $request_a$
);

-- 10:10 e 10:40 BRT = 13:10 e 13:40 UTC.

SELECT cron.schedule(
    'zion_admin_openai_cost_retry_1010_1040',
    '10,40 13 * * *',
    $request_b$
    SELECT net.http_get(
        url := (
            SELECT regexp_replace(
                decrypted_secret,
                '/api/cron/zion-admin-openai-costs/?$',
                '/api/cron/zion-admin-openai-cost-retries'
            )
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
        timeout_milliseconds := 30000
    ) AS request_id;
    $request_b$
);

-- Desativacao na mesma transacao.
-- Se qualquer verificacao falhar, tudo e revertido.

DO $disable$
DECLARE
    first_job bigint;
    second_job bigint;
BEGIN
    SELECT jobid INTO first_job
    FROM cron.job
    WHERE jobname = 'zion_admin_openai_cost_retry_0925_0950';

    SELECT jobid INTO second_job
    FROM cron.job
    WHERE jobname = 'zion_admin_openai_cost_retry_1010_1040';

    IF first_job IS NULL
       OR second_job IS NULL
       OR first_job = second_job THEN
        RAISE EXCEPTION 'OPENAI_RETRY_JOBS_INCOMPLETOS';
    END IF;

    PERFORM cron.alter_job(
        job_id := first_job,
        active := false
    );

    PERFORM cron.alter_job(
        job_id := second_job,
        active := false
    );

    IF (
        SELECT count(*)
        FROM cron.job
        WHERE jobname IN (
            'zion_admin_openai_cost_retry_0925_0950',
            'zion_admin_openai_cost_retry_1010_1040'
        )
          AND active = false
    ) <> 2 THEN
        RAISE EXCEPTION 'OPENAI_RETRY_JOBS_NAO_DESATIVADOS';
    END IF;
END;
$disable$;

COMMIT;