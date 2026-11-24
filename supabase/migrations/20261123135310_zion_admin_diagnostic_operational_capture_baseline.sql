-- ZION-ADM | Bloco 2 | Captura operacional compartilhada
-- Primeira etapa: baseline e ativacao protegida.
-- Nenhum cron, trigger, incidente ou alteracao nas filas.

BEGIN;

CREATE TABLE public.zion_admin_diagnostic_operational_capture_baseline (
    source_system text NOT NULL
        CHECK (source_system IN (
            'channel_whatsapp_inbox',
            'ai_run_queue',
            'ai_sales_action_queue'
        )),
    source_record_id uuid NOT NULL,
    had_error_at_activation boolean NOT NULL,
    captured_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),
    PRIMARY KEY (source_system, source_record_id)
);

CREATE TABLE public.zion_admin_diagnostic_operational_capture_activation (
    singleton boolean PRIMARY KEY DEFAULT true
        CHECK (singleton),
    activated_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),
    source_rows_snapshot integer NOT NULL DEFAULT 0
        CHECK (source_rows_snapshot >= 0),
    error_rows_snapshot integer NOT NULL DEFAULT 0
        CHECK (error_rows_snapshot >= 0),
    CONSTRAINT operational_snapshot_counts_check
        CHECK (error_rows_snapshot <= source_rows_snapshot)
);

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_baseline
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_baseline
FORCE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_activation
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_capture_activation
FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_operational_capture_baseline,
    public.zion_admin_diagnostic_operational_capture_activation
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.activate_zion_admin_operational_capture_by_system()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_started boolean := false;
    v_sources integer := 0;
    v_errors integer := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    -- Ativacao unica e transacional.
    -- Chamadas concorrentes nao recriam o baseline.

    -- Proteger o intervalo entre baseline e commit.
    -- NOWAIT evita espera por escritas ja em andamento.
    -- O bloqueio dura ate o fim da transacao.
    IF NOT EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_operational_capture_activation
        WHERE singleton IS TRUE
    ) THEN
        LOCK TABLE
            public.channel_whatsapp_inbox,
            public.ai_run_queue,
            public.ai_sales_action_queue
            IN SHARE MODE NOWAIT;
    END IF;

    INSERT INTO
        public.zion_admin_diagnostic_operational_capture_activation (
            singleton,
            source_rows_snapshot,
            error_rows_snapshot
        )
    VALUES (true, 0, 0)
    ON CONFLICT (singleton) DO NOTHING
    RETURNING true INTO v_started;

    IF NOT COALESCE(v_started, false) THEN
        SELECT source_rows_snapshot, error_rows_snapshot
        INTO v_sources, v_errors
        FROM public.zion_admin_diagnostic_operational_capture_activation
        WHERE singleton = true;

        RETURN pg_catalog.jsonb_build_object(
            'activated_now', false,
            'already_active', true,
            'source_rows', v_sources,
            'historical_errors', v_errors
        );
    END IF;

    -- As tres leituras participam de uma instrucao SQL,
    -- compartilhando o mesmo snapshot PostgreSQL.
    -- Nenhum erro bruto e copiado para o baseline.

    INSERT INTO
        public.zion_admin_diagnostic_operational_capture_baseline (
            source_system,
            source_record_id,
            had_error_at_activation
        )
    SELECT
        'channel_whatsapp_inbox',
        q.id,
        NULLIF(pg_catalog.btrim(q.processing_error), '')
            IS NOT NULL
    FROM public.channel_whatsapp_inbox q

    UNION ALL

    SELECT
        'ai_run_queue',
        q.id,
        NULLIF(pg_catalog.btrim(q.processing_error), '')
            IS NOT NULL
    FROM public.ai_run_queue q

    UNION ALL

    SELECT
        'ai_sales_action_queue',
        q.id,
        NULLIF(pg_catalog.btrim(q.processing_error), '')
            IS NOT NULL
    FROM public.ai_sales_action_queue q;

    GET DIAGNOSTICS v_sources = ROW_COUNT;

    SELECT count(*)
    INTO v_errors
    FROM public.zion_admin_diagnostic_operational_capture_baseline
    WHERE had_error_at_activation = true;

    UPDATE
        public.zion_admin_diagnostic_operational_capture_activation
    SET
        source_rows_snapshot = v_sources,
        error_rows_snapshot = v_errors
    WHERE singleton = true;

    RETURN pg_catalog.jsonb_build_object(
        'activated_now', true,
        'already_active', false,
        'source_rows', v_sources,
        'historical_errors', v_errors
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.activate_zion_admin_operational_capture_by_system()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.activate_zion_admin_operational_capture_by_system()
TO service_role;

COMMIT;