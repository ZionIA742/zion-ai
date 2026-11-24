\set ON_ERROR_STOP on

-- ZION-ADM | Bloco 2 | Etapa 2
-- Instalador operacional homologado: 18-BB-T.
-- Instalacao original: 2026-11-24.
--
-- ATENCAO:
-- Executar exclusivamente mediante autorizacao.
-- Nao faz parte das migrations automaticas.
-- Nao reexecutar no ambiente ja instalado.
--
-- Evidencias originais:
-- Job operacional: 22.
-- Frequencia: a cada minuto.
-- Descoberta e processamento: lotes de 20.
-- Job anterior de ai_runs: 21, preservado.
-- Baseline original: 936 registros.
-- Erros historicos no baseline: 259.
--
-- Este instalador preserva as precondicoes do
-- ambiente de producao original.
-- Outros ambientes exigem adaptacao e auditoria.
--
-- Nenhum segredo ou token de acesso incluido.
-- Nao executa backfill historico.
-- Nao modifica as filas operacionais.
-- Nao depende do Vercel.
--
-- INICIO DO SQL ORIGINAL HOMOLOGADO

BEGIN ISOLATION LEVEL READ COMMITTED;

SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '750ms';
SET LOCAL idle_in_transaction_session_timeout = '10000ms';

DO $preflight$
BEGIN
    IF current_setting(
        'transaction_timeout',true
    ) IS NOT NULL THEN
        PERFORM set_config(
            'transaction_timeout','15000ms',true
        );
    END IF;

    IF current_user <> session_user THEN
        RAISE EXCEPTION 'CRON_SESSION_IDENTITY_UNEXPECTED';
    END IF;

    IF (
        SELECT count(*)
        FROM public.zion_admin_diagnostic_operational_capture_activation
        WHERE singleton IS TRUE
    ) <> 1 THEN
        RAISE EXCEPTION 'CAPTURE_NOT_ACTIVE';
    END IF;

    IF (
        SELECT count(*)
        FROM public.zion_admin_diagnostic_operational_capture_baseline
    ) <> 936 THEN
        RAISE EXCEPTION 'BASELINE_CHANGED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension
        WHERE extname = 'pg_cron'
    ) THEN
        RAISE EXCEPTION 'PG_CRON_UNAVAILABLE';
    END IF;
END;
$preflight$;

SELECT 'CRON|PREFLIGHT|PASS';

-- Verificar novamente a identidade do executor.
-- Nenhuma RPC operacional sera chamada aqui.

SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;

DO $identity$
BEGIN
    IF current_user <> 'service_role'
       OR auth.role() IS DISTINCT FROM 'service_role'
       OR NOT has_function_privilege(
           current_user,
           'public.discover_zion_admin_operational_capture_attempts_by_system(integer)',
           'EXECUTE'
       )
       OR NOT has_function_privilege(
           current_user,
           'public.process_zion_admin_operational_capture_attempts_by_system(integer)',
           'EXECUTE'
       )
    THEN
        RAISE EXCEPTION 'CRON_EXECUTOR_PERMISSION_INVALID';
    END IF;
END;
$identity$;

RESET ROLE;

SELECT 'CRON|EXECUTOR_IDENTITY|PASS';

-- Impedir corrida com outro agendamento simultaneo.
-- NOWAIT: nao esperar por bloqueio incompatível.

DO $scheduler_guard$
BEGIN
    IF NOT pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'zion-admin:diagnostic-operational:cron-install:v1',
            0
        )
    ) THEN
        RAISE EXCEPTION 'CONCURRENT_CRON_INSTALLATION';
    END IF;
END;
$scheduler_guard$;

SELECT 'CRON|ADVISORY_LOCK|ACQUIRED';

-- Guardar fingerprints dos jobs existentes,
-- sem imprimir comandos ou segredos.

CREATE TEMP TABLE zion_existing_jobs
ON COMMIT DROP AS
SELECT
    j.jobid,
    md5(to_jsonb(j)::text) AS fingerprint
FROM cron.job j;

-- Identificar o job 21 e referencias diretas
-- ou intermediarias ao coletor operacional.

CREATE TEMP TABLE zion_cron_audit
ON COMMIT DROP AS
SELECT
    j.jobid,
    j.active,

    (
        j.jobname::text =
            'zion-admin-diagnostic-operational'
        OR j.command ILIKE '%diagnostic-operational%'
        OR j.command ILIKE '%operational_capture%'
        OR j.command ILIKE '%operational_failure_event%'
        OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n
              ON n.oid = p.pronamespace
            WHERE n.nspname NOT IN (
                'pg_catalog','information_schema'
            )
              AND length(p.proname::text) >= 10
              AND strpos(
                  lower(j.command),
                  lower(p.proname::text)
              ) > 0
              AND (
                  p.prosrc ILIKE '%diagnostic-operational%'
                  OR p.prosrc ILIKE '%operational_capture%'
                  OR p.prosrc ILIKE '%operational_failure_event%'
              )
        )
    ) AS operational_match,

    (
        (
    j.jobid = 21
    AND j.jobname::text =
        'zion_admin_diagnostic_ai_runs_every_5_minutes'
    AND j.username::text = current_user::text
    AND j.schedule = '*/5 * * * *'
    AND j.active IS TRUE
    AND j.command ILIKE '%http_get%'
    AND j.command ILIKE '%vault.%'
    AND strpos(
        lower(j.command),
        'zion_admin_diagnostic_ai_run_cron_secret'
    ) > 0
    AND strpos(
        lower(j.command),
        'zion_admin_diagnostic_ai_run_url'
    ) > 0
)
OR j.command ILIKE '%diagnostic-ai-runs%'
        OR j.command ILIKE '%diagnostic_ai_runs%'
        OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n
              ON n.oid = p.pronamespace
            WHERE n.nspname NOT IN (
                'pg_catalog','information_schema'
            )
              AND length(p.proname::text) >= 10
              AND strpos(
                  lower(j.command),
                  lower(p.proname::text)
              ) > 0
              AND (
                  p.prosrc ILIKE '%diagnostic-ai-runs%'
                  OR p.prosrc ILIKE '%diagnostic_ai_runs%'
              )
        )
    ) AS ai_runs_match

FROM cron.job j;

SELECT 'CRON|EXISTING_OPERATIONAL_MATCHES|' ||
    count(*)::text
FROM zion_cron_audit
WHERE operational_match IS TRUE;

SELECT 'CRON|JOB21|' ||
CASE
    WHEN EXISTS (
        SELECT 1
        FROM zion_cron_audit
        WHERE jobid = 21
          AND ai_runs_match IS TRUE
          AND operational_match IS NOT TRUE
    ) THEN 'AI_RUNS_REFERENCE_FOUND'
    ELSE 'UNCLASSIFIED'
END;

DO $duplicates$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM zion_cron_audit
        WHERE operational_match IS TRUE
    ) THEN
        RAISE EXCEPTION 'OPERATIONAL_CRON_ALREADY_EXISTS';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM zion_cron_audit
        WHERE jobid = 21
          AND ai_runs_match IS TRUE
          AND operational_match IS NOT TRUE
    ) THEN
        RAISE EXCEPTION 'EXISTING_DIAGNOSTIC_JOB_UNCLASSIFIED';
    END IF;
END;
$duplicates$;

SELECT 'CRON|DUPLICATE_GUARD|PASS';

-- Criar exclusivamente o novo job.

SELECT cron.schedule(
    'zion-admin-diagnostic-operational',
    '* * * * *',
    $zion_job_command$SET statement_timeout = '20000ms';
SET lock_timeout = '750ms';

SET request.jwt.claim.role = 'service_role';
SET request.jwt.claims = '{"role":"service_role"}';

SET ROLE service_role;

DO $operational_cron$
DECLARE
    v_discovery jsonb;
    v_processing jsonb;

    v_discovered integer;
    v_selected integer;
    v_registered integer;
    v_retry integer;
    v_review integer;
    v_ineligible integer;
BEGIN
    IF current_user <> 'service_role'
       OR auth.role() IS DISTINCT FROM 'service_role'
    THEN
        RAISE EXCEPTION 'CRON_IDENTITY_INVALID';
    END IF;

    v_discovery :=
        public.discover_zion_admin_operational_capture_attempts_by_system(20);

    IF v_discovery ->> 'status'
           IS DISTINCT FROM 'active'
       OR v_discovery ->> 'source_system'
           IS DISTINCT FROM 'operational_failure_events'
       OR v_discovery ->> 'batch_limit'
           IS DISTINCT FROM '20'
    THEN
        RAISE EXCEPTION 'CRON_DISCOVERY_INVALID_RESULT';
    END IF;

    v_discovered :=
        (v_discovery ->> 'discovered')::integer;

    IF v_discovered IS NULL
       OR v_discovered NOT BETWEEN 0 AND 20
    THEN
        RAISE EXCEPTION 'CRON_DISCOVERY_INVALID_COUNT';
    END IF;

    v_processing :=
        public.process_zion_admin_operational_capture_attempts_by_system(20);

    IF v_processing ->> 'status'
           IS DISTINCT FROM 'processed'
       OR v_processing ->> 'source_system'
           IS DISTINCT FROM 'operational_failure_events'
       OR v_processing ->> 'batch_limit'
           IS DISTINCT FROM '20'
    THEN
        RAISE EXCEPTION 'CRON_PROCESSOR_INVALID_RESULT';
    END IF;

    v_selected :=
        (v_processing ->> 'selected')::integer;

    v_registered :=
        (v_processing ->> 'registered')::integer;

    v_retry :=
        (v_processing ->> 'retry_scheduled')::integer;

    v_review :=
        (v_processing ->> 'needs_review')::integer;

    v_ineligible :=
        (v_processing ->> 'no_longer_eligible')::integer;

    IF v_selected IS NULL
       OR v_selected NOT BETWEEN 0 AND 20
       OR v_registered IS NULL
       OR v_registered NOT BETWEEN 0 AND 20
       OR v_retry IS NULL
       OR v_retry NOT BETWEEN 0 AND 20
       OR v_review IS NULL
       OR v_review NOT BETWEEN 0 AND 20
       OR v_ineligible IS NULL
       OR v_ineligible NOT BETWEEN 0 AND 20
       OR v_selected <>
           v_registered + v_retry + v_review + v_ineligible
    THEN
        RAISE EXCEPTION 'CRON_PROCESSOR_INVALID_COUNTS';
    END IF;

EXCEPTION WHEN OTHERS THEN
    -- Nao propagar mensagens internas ou dados brutos.
    RAISE EXCEPTION USING
        MESSAGE = 'ZION_OPERATIONAL_CRON_FAILED',
        ERRCODE = SQLSTATE;
END;
$operational_cron$;

RESET ROLE;$zion_job_command$
) AS created_job_id
\gset

SELECT 'CRON|CREATED_JOB_ID|' ||
    :created_job_id::text;

-- Validar a configuracao antes do COMMIT.

DO $validate$
BEGIN
    IF (
        SELECT count(*)
        FROM cron.job
        WHERE jobname::text =
            'zion-admin-diagnostic-operational'
          AND schedule = '* * * * *'
          AND active IS TRUE
          AND command = $zion_job_command$SET statement_timeout = '20000ms';
SET lock_timeout = '750ms';

SET request.jwt.claim.role = 'service_role';
SET request.jwt.claims = '{"role":"service_role"}';

SET ROLE service_role;

DO $operational_cron$
DECLARE
    v_discovery jsonb;
    v_processing jsonb;

    v_discovered integer;
    v_selected integer;
    v_registered integer;
    v_retry integer;
    v_review integer;
    v_ineligible integer;
BEGIN
    IF current_user <> 'service_role'
       OR auth.role() IS DISTINCT FROM 'service_role'
    THEN
        RAISE EXCEPTION 'CRON_IDENTITY_INVALID';
    END IF;

    v_discovery :=
        public.discover_zion_admin_operational_capture_attempts_by_system(20);

    IF v_discovery ->> 'status'
           IS DISTINCT FROM 'active'
       OR v_discovery ->> 'source_system'
           IS DISTINCT FROM 'operational_failure_events'
       OR v_discovery ->> 'batch_limit'
           IS DISTINCT FROM '20'
    THEN
        RAISE EXCEPTION 'CRON_DISCOVERY_INVALID_RESULT';
    END IF;

    v_discovered :=
        (v_discovery ->> 'discovered')::integer;

    IF v_discovered IS NULL
       OR v_discovered NOT BETWEEN 0 AND 20
    THEN
        RAISE EXCEPTION 'CRON_DISCOVERY_INVALID_COUNT';
    END IF;

    v_processing :=
        public.process_zion_admin_operational_capture_attempts_by_system(20);

    IF v_processing ->> 'status'
           IS DISTINCT FROM 'processed'
       OR v_processing ->> 'source_system'
           IS DISTINCT FROM 'operational_failure_events'
       OR v_processing ->> 'batch_limit'
           IS DISTINCT FROM '20'
    THEN
        RAISE EXCEPTION 'CRON_PROCESSOR_INVALID_RESULT';
    END IF;

    v_selected :=
        (v_processing ->> 'selected')::integer;

    v_registered :=
        (v_processing ->> 'registered')::integer;

    v_retry :=
        (v_processing ->> 'retry_scheduled')::integer;

    v_review :=
        (v_processing ->> 'needs_review')::integer;

    v_ineligible :=
        (v_processing ->> 'no_longer_eligible')::integer;

    IF v_selected IS NULL
       OR v_selected NOT BETWEEN 0 AND 20
       OR v_registered IS NULL
       OR v_registered NOT BETWEEN 0 AND 20
       OR v_retry IS NULL
       OR v_retry NOT BETWEEN 0 AND 20
       OR v_review IS NULL
       OR v_review NOT BETWEEN 0 AND 20
       OR v_ineligible IS NULL
       OR v_ineligible NOT BETWEEN 0 AND 20
       OR v_selected <>
           v_registered + v_retry + v_review + v_ineligible
    THEN
        RAISE EXCEPTION 'CRON_PROCESSOR_INVALID_COUNTS';
    END IF;

EXCEPTION WHEN OTHERS THEN
    -- Nao propagar mensagens internas ou dados brutos.
    RAISE EXCEPTION USING
        MESSAGE = 'ZION_OPERATIONAL_CRON_FAILED',
        ERRCODE = SQLSTATE;
END;
$operational_cron$;

RESET ROLE;$zion_job_command$
          AND username::text = current_user::text
          AND database::text = current_database()
    ) <> 1 THEN
        RAISE EXCEPTION 'NEW_CRON_CONFIGURATION_INVALID';
    END IF;

    IF EXISTS (
        SELECT jobid,fingerprint
        FROM zion_existing_jobs

        EXCEPT

        SELECT jobid,md5(to_jsonb(j)::text)
        FROM cron.job j
    ) THEN
        RAISE EXCEPTION 'EXISTING_JOB_CHANGED';
    END IF;

    IF (
        SELECT count(*) FROM cron.job
    ) <> (
        SELECT count(*) + 1 FROM zion_existing_jobs
    ) THEN
        RAISE EXCEPTION 'UNEXPECTED_JOB_COUNT';
    END IF;
END;
$validate$;

SELECT 'CRON|NEW_CONFIGURATION|PASS';
SELECT 'CRON|EXISTING_JOBS_PRESERVED|PASS';
SELECT 'CRON|PRECOMMIT_VALIDATION|PASS';

COMMIT;

SELECT 'CRON|COMMIT_CONFIRMED|PASS';