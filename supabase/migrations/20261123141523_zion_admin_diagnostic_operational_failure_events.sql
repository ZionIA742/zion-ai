-- ZION-ADM | Bloco 2 | Eventos operacionais
-- Nao cria incidentes nem ativa o processador.
-- Registra somente metadados seguros de transicoes relevantes.
-- Eventos anteriores a ativacao nao serao elegiveis ao coletor.

BEGIN;

CREATE TABLE public.zion_admin_diagnostic_operational_failure_events (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),

    source_system text NOT NULL
        CHECK (source_system IN (
            'channel_whatsapp_inbox',
            'ai_run_queue',
            'ai_sales_action_queue'
        )),

    source_record_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,

    failure_code text NOT NULL
        CHECK (failure_code IN (
            'whatsapp_sales_ai_failed_final',
            'whatsapp_status_failed_final',
            'ai_run_queue_failed_final',
            'sales_action_processing_failed'
        )),

    attempt_count integer,
    captured_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT operational_failure_attempt_check
        CHECK (attempt_count IS NULL OR attempt_count >= 0)
);

CREATE INDEX zadofe_source_idx
ON public.zion_admin_diagnostic_operational_failure_events (
    source_system,
    source_record_id,
    captured_at DESC
);

CREATE INDEX zadofe_capture_idx
ON public.zion_admin_diagnostic_operational_failure_events (
    captured_at,
    id
);

ALTER TABLE
    public.zion_admin_diagnostic_operational_failure_events
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_failure_events
FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_operational_failure_events
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.capture_zion_admin_operational_failure_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_error text;
    v_code text;
    v_attempt_count integer;
BEGIN
    IF TG_TABLE_SCHEMA <> 'public' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME NOT IN (
        'channel_whatsapp_inbox',
        'ai_run_queue',
        'ai_sales_action_queue'
    ) THEN
        RETURN NEW;
    END IF;

    -- Capturar novas transicoes desde a instalacao.
    -- Nao depender do snapshot de ativacao do produtor.
    -- Consumidores aplicam o corte temporal de ativacao.
    -- Eventos anteriores ao corte nao geram incidentes.

    -- Somente mudancas reais do campo de erro.
    -- Alterar processed_at isoladamente nao
    -- constitui uma nova falha.

    IF TG_OP = 'UPDATE'
       AND NEW.processing_error
           IS NOT DISTINCT FROM OLD.processing_error
    THEN
        RETURN NEW;
    END IF;


    -- Falhas encerradas/processadas nao sao novas
    -- pendencias terminais.

    IF NEW.processed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    v_error := pg_catalog.btrim(
        COALESCE(NEW.processing_error, '')
    );

    IF v_error = '' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'channel_whatsapp_inbox' THEN

        IF v_error LIKE 'sales_ai_failed_final:%' THEN
            v_code := 'whatsapp_sales_ai_failed_final';

        ELSIF v_error LIKE 'whatsapp_status_failed_final:%' THEN
            v_code := 'whatsapp_status_failed_final';
        END IF;

    ELSIF TG_TABLE_NAME = 'ai_run_queue' THEN

        IF v_error LIKE 'sales_ai_failed_final:%' THEN
            v_code := 'ai_run_queue_failed_final';
        END IF;

    ELSIF TG_TABLE_NAME = 'ai_sales_action_queue' THEN

        -- As falhas novas desta fila permanecem pendentes
        -- com processing_error preenchido.
        v_code := 'sales_action_processing_failed';

    END IF;

    IF v_code IS NULL THEN
        RETURN NEW;
    END IF;

    -- A fila de acoes comerciais nao possui attempt_count.

    IF TG_TABLE_NAME IN (
        'channel_whatsapp_inbox',
        'ai_run_queue'
    ) THEN
        v_attempt_count := NEW.attempt_count;
    ELSE
        v_attempt_count := NULL;
    END IF;

    -- Falha no diagnostico nao pode cancelar a operacao.
    -- Nunca registrar payload ou erro original.

    BEGIN
        INSERT INTO
            public.zion_admin_diagnostic_operational_failure_events (
                source_system,
                source_record_id,
                organization_id,
                store_id,
                failure_code,
                attempt_count
            )
        VALUES (
            TG_TABLE_NAME,
            NEW.id,
            NEW.organization_id,
            NEW.store_id,
            v_code,
            v_attempt_count
        );

    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING
            'ZION_ADM_OPERATIONAL_EVENT_CAPTURE_FAILED: %',
            SQLSTATE;
    END;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.capture_zion_admin_operational_failure_transition()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zion_admin_capture_whatsapp_failure
AFTER INSERT OR UPDATE OF processing_error, processed_at
ON public.channel_whatsapp_inbox
FOR EACH ROW
EXECUTE FUNCTION
    public.capture_zion_admin_operational_failure_transition();

CREATE TRIGGER zion_admin_capture_ai_queue_failure
AFTER INSERT OR UPDATE OF processing_error, processed_at
ON public.ai_run_queue
FOR EACH ROW
EXECUTE FUNCTION
    public.capture_zion_admin_operational_failure_transition();

CREATE TRIGGER zion_admin_capture_sales_action_failure
AFTER INSERT OR UPDATE OF processing_error, processed_at
ON public.ai_sales_action_queue
FOR EACH ROW
EXECUTE FUNCTION
    public.capture_zion_admin_operational_failure_transition();

COMMIT;