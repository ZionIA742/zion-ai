-- ZION-ADM / Bloco 1 / Etapa 2.3-A
-- Protecao transacional de competencias ja finalizadas.
--
-- Preserva autorizacao, idempotencia e auditoria existentes.
-- Nao executa fechamento, cron ou coleta financeira.
-- Nao exige documentos ou aprovacao humana.
-- Aplicacao remota somente apos revisao e autorizacao.

BEGIN;

CREATE OR REPLACE FUNCTION public.zion_admin_register_monthly_preclosure_by_system(
    p_month date,
    p_source_snapshot jsonb,
    p_pending_sources text[],
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now_sp timestamp :=
        pg_catalog.clock_timestamp()
        AT TIME ZONE 'America/Sao_Paulo';

    v_current_month date;
    v_last_day date;
    v_pending text[];
    v_snapshot jsonb;
    v_existing public.zion_admin_monthly_preclosures%ROWTYPE;
    v_revision integer;
BEGIN
    -- Apenas o backend financeiro autorizado.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_UNAUTHORIZED';
    END IF;

    IF p_month IS NULL
       OR p_month <> pg_catalog.date_trunc(
           'month', p_month::timestamp
       )::date
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_INVALID_MONTH';
    END IF;

    IF p_source_snapshot IS NULL
       OR pg_catalog.jsonb_typeof(p_source_snapshot) <> 'object'
       OR p_source_snapshot = '{}'::jsonb
       OR pg_catalog.length(p_source_snapshot::text) > 100000
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_INVALID_SNAPSHOT';
    END IF;

    IF p_pending_sources IS NULL
       OR pg_catalog.cardinality(p_pending_sources) > 20
       OR EXISTS (
           SELECT 1
           FROM pg_catalog.unnest(p_pending_sources) AS source(value)
           WHERE value IS NULL
              OR value !~ '^[a-z][a-z0-9_]{1,63}$'
       )
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_INVALID_SOURCES';
    END IF;

    IF p_reason IS NULL
       OR pg_catalog.length(pg_catalog.btrim(p_reason))
          NOT BETWEEN 1 AND 200
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_INVALID_REASON';
    END IF;

    SELECT COALESCE(
        pg_catalog.array_agg(DISTINCT value ORDER BY value),
        ARRAY[]::text[]
    )
    INTO v_pending
    FROM pg_catalog.unnest(p_pending_sources) AS source(value);

    -- Identificacao explicita como registro preliminar.
    -- Nenhum campo do snapshot equivale a aprovacao
    -- ou comprovacao de fechamento definitivo.
    v_snapshot := pg_catalog.jsonb_build_object(
        'schema_version', 1,
        'financial_status', 'preliminary',
        'sources', p_source_snapshot
    );

    -- Uma transacao por competencia, impedindo revisoes
    -- concorrentes e duplicadas.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_monthly_preclosure'),
        pg_catalog.hashtext(p_month::text)
    );

    -- Impedir revisoes apos o fechamento definitivo.
    -- O advisory lock da competencia ja foi adquirido.
    -- A futura RPC de fechamento deve usar o mesmo lock.
    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_final_closures
        WHERE month = p_month
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_MONTH_ALREADY_FINALIZED';
    END IF;

    -- Nao revisar um mes definitivamente fechado.
    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_closures
        WHERE month = p_month
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_PRECLOSURE_MONTH_ALREADY_CLOSED';
    END IF;

    SELECT *
    INTO v_existing
    FROM public.zion_admin_monthly_preclosures
    WHERE month = p_month
    FOR UPDATE;

    IF NOT FOUND THEN
        v_current_month :=
            pg_catalog.date_trunc(
                'month', v_now_sp
            )::date;

        v_last_day :=
            (
                v_current_month +
                INTERVAL '1 month - 1 day'
            )::date;

        -- Criacao inicial somente na noite
        -- do ultimo dia da competencia.
        IF p_month <> v_current_month
           OR v_now_sp::date <> v_last_day
           OR v_now_sp::time < TIME '20:00:00'
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_PRECLOSURE_NOT_DUE';
        END IF;

        INSERT INTO public.zion_admin_monthly_preclosures (
            month,
            revision,
            source_snapshot,
            pending_sources
        )
        VALUES (
            p_month,
            1,
            v_snapshot,
            v_pending
        );

        v_revision := 1;

    ELSE
        -- Repeticao dos mesmos dados: sem nova revisao.
        IF v_existing.source_snapshot = v_snapshot
           AND v_existing.pending_sources = v_pending
        THEN
            RETURN pg_catalog.jsonb_build_object(
                'ok', true,
                'status', 'unchanged',
                'month', p_month,
                'revision', v_existing.revision
            );
        END IF;

        IF v_existing.revision >= 2147483647 THEN
            RAISE EXCEPTION
                'ZION_ADMIN_PRECLOSURE_REVISION_LIMIT';
        END IF;

        v_revision := v_existing.revision + 1;

        UPDATE public.zion_admin_monthly_preclosures
        SET
            revision = v_revision,
            source_snapshot = v_snapshot,
            pending_sources = v_pending,
            updated_at = pg_catalog.now()
        WHERE month = p_month;
    END IF;

    -- Registro atomico da revisao.
    -- Falha na auditoria desfaz toda a operacao.
    INSERT INTO public.zion_admin_monthly_preclosure_audit (
        month,
        revision,
        source_snapshot,
        pending_sources,
        reason
    )
    VALUES (
        p_month,
        v_revision,
        v_snapshot,
        v_pending,
        pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'status',
            CASE
                WHEN v_revision = 1 THEN 'created'
                ELSE 'revised'
            END,
        'month', p_month,
        'revision', v_revision
    );
END;
$$;

REVOKE ALL ON FUNCTION
public.zion_admin_register_monthly_preclosure_by_system(
    date, jsonb, text[], text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_register_monthly_preclosure_by_system(
    date, jsonb, text[], text
)
TO service_role;

COMMIT;