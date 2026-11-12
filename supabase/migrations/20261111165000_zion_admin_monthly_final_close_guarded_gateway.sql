-- ZION-ADM / 2.16-A.4-B
-- Entrada transacional protegida para futuro fechamento mensal.
--
-- Nao altera as autoridades financeiras existentes.
-- Nao autentica fontes ausentes.
-- Nao registra fechamento definitivo nesta versao.
-- Nao habilita cron.

BEGIN;

CREATE FUNCTION public.zion_admin_monthly_final_close_gateway_by_system(
    p_month date,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_now_sp timestamp;
    v_current_month date;
    v_preflight jsonb;
    v_blockers jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_CLOSE_UNAUTHORIZED';
    END IF;

    IF p_month IS NULL
       OR p_month < DATE '2020-01-01'
       OR p_month > DATE '2100-12-01'
       OR p_month <> pg_catalog.date_trunc(
            'month', p_month::timestamp
       )::date
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_CLOSE_INVALID_MONTH';
    END IF;

    IF p_reason IS NULL
       OR pg_catalog.length(pg_catalog.btrim(p_reason))
          NOT BETWEEN 1 AND 200
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_CLOSE_INVALID_REASON';
    END IF;

    v_now_sp :=
        pg_catalog.clock_timestamp()
        AT TIME ZONE 'America/Sao_Paulo';

    v_current_month :=
        pg_catalog.date_trunc('month', v_now_sp)::date;

    IF p_month >= v_current_month THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'status', 'blocked',
            'month', p_month,
            'blockers',
                pg_catalog.jsonb_build_array(
                    'month_not_finished'
                )
        );
    END IF;

    -- Mesmo lock transacional do pre-fechamento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_monthly_preclosure'),
        pg_catalog.hashtext(p_month::text)
    );

    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_final_closures
        WHERE month = p_month
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'status', 'already_finalized',
            'month', p_month,
            'blockers',
                pg_catalog.jsonb_build_array(
                    'already_finalized'
                )
        );
    END IF;

    -- Verificacao dentro da mesma transacao.
    -- A funcao existente confere a revisao corrente
    -- do pre-fechamento e conserva as fontes pendentes.
    SELECT public.zion_admin_monthly_final_close_preflight_by_system(
        p_month
    )
    INTO v_preflight;

    IF v_preflight IS NULL
       OR pg_catalog.jsonb_typeof(v_preflight)
          IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_CLOSE_INVALID_PREFLIGHT';
    END IF;

    IF v_preflight ->> 'eligible' IS DISTINCT FROM 'true' THEN
        v_blockers := v_preflight -> 'blockers';

        IF pg_catalog.jsonb_typeof(v_blockers)
           IS DISTINCT FROM 'array'
        THEN
            v_blockers := pg_catalog.jsonb_build_array(
                'source_authority_unverified'
            );
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'status', 'blocked',
            'month', p_month,
            'preclosure_revision',
                v_preflight -> 'preclosure_revision',
            'blockers', v_blockers
        );
    END IF;

    -- Defesa adicional: mesmo que o preflight passe
    -- futuramente, ainda sera exigida a vinculacao
    -- independente das evidencias financeiras.
    --
    -- Esta versao nao grava snapshots.
    RETURN pg_catalog.jsonb_build_object(
        'ok', false,
        'status', 'blocked',
        'month', p_month,
        'blockers',
            pg_catalog.jsonb_build_array(
                'final_source_binding_not_implemented'
            )
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.zion_admin_monthly_final_close_gateway_by_system(
        date, text
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.zion_admin_monthly_final_close_gateway_by_system(
        date, text
    )
TO service_role;

COMMIT;
