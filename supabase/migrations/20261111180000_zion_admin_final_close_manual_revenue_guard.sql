-- ZION-ADM / 2.16-A.5-B
-- Consistencia transacional da receita mensal.
--
-- Le a receita canonica, sua auditoria e o pre-fechamento.
-- Nao autentica recebimentos externos.
-- Nao realiza fechamento definitivo.
-- Nao altera OpenAI, Meta, cron ou despesas.

BEGIN;

CREATE FUNCTION public.zion_admin_verify_final_close_manual_revenue_by_system(
    p_month date,
    p_preclosure_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_current_month date;

    v_preclosure
        public.zion_admin_monthly_preclosures%ROWTYPE;

    v_preclosure_audit
        public.zion_admin_monthly_preclosure_audit%ROWTYPE;

    v_revenue
        public.zion_admin_monthly_manual_revenue%ROWTYPE;

    v_revenue_audit
        public.zion_admin_monthly_manual_revenue_audit%ROWTYPE;

    v_snapshot_revenue jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_UNAUTHORIZED';
    END IF;

    IF p_month IS NULL
       OR p_month < DATE '2020-01-01'
       OR p_month > DATE '2100-12-01'
       OR p_month <> pg_catalog.date_trunc(
            'month', p_month::timestamp
       )::date
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_INVALID_MONTH';
    END IF;

    IF p_preclosure_revision IS NULL
       OR p_preclosure_revision < 1
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_INVALID_REVISION';
    END IF;

    v_current_month := pg_catalog.date_trunc(
        'month',
        pg_catalog.clock_timestamp()
            AT TIME ZONE 'America/Sao_Paulo'
    )::date;

    IF p_month >= v_current_month THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_MONTH_NOT_FINISHED';
    END IF;

    -- Mesma autoridade de concorrencia do pre-fechamento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_monthly_preclosure'),
        pg_catalog.hashtext(p_month::text)
    );

    SELECT *
    INTO v_preclosure
    FROM public.zion_admin_monthly_preclosures
    WHERE month = p_month
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_PRECLOSURE_MISSING';
    END IF;

    IF v_preclosure.revision <> p_preclosure_revision THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_STALE_PRECLOSURE';
    END IF;

    SELECT *
    INTO v_preclosure_audit
    FROM public.zion_admin_monthly_preclosure_audit
    WHERE month = p_month
      AND revision = p_preclosure_revision
    FOR SHARE;

    IF NOT FOUND
       OR v_preclosure_audit.source_snapshot
            IS DISTINCT FROM v_preclosure.source_snapshot
       OR v_preclosure_audit.pending_sources
            IS DISTINCT FROM v_preclosure.pending_sources
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_PRECLOSURE_AUDIT_MISMATCH';
    END IF;

    -- Autoridade: valor registrado no banco.
    SELECT *
    INTO v_revenue
    FROM public.zion_admin_monthly_manual_revenue
    WHERE month = p_month
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_NOT_REPORTED';
    END IF;

    SELECT *
    INTO v_revenue_audit
    FROM public.zion_admin_monthly_manual_revenue_audit
    WHERE month = p_month
      AND revision = v_revenue.revision
    FOR SHARE;

    IF NOT FOUND
       OR v_revenue_audit.amount_brl_cents
            IS DISTINCT FROM v_revenue.amount_brl_cents
       OR v_revenue_audit.revision
            IS DISTINCT FROM v_revenue.revision
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_AUDIT_MISMATCH';
    END IF;

    v_snapshot_revenue :=
        v_preclosure.source_snapshot -> 'manualRevenue';

    -- Zero confirmado e permitido.
    -- Receita ausente nunca equivale a zero.
    IF pg_catalog.jsonb_typeof(v_snapshot_revenue)
            IS DISTINCT FROM 'object'
       OR v_snapshot_revenue ->> 'source'
            IS DISTINCT FROM 'manual_subscription_revenue'
       OR v_snapshot_revenue ->> 'status'
            IS DISTINCT FROM 'confirmed'
       OR v_snapshot_revenue -> 'amountBrlCents'
            IS DISTINCT FROM
                pg_catalog.to_jsonb(v_revenue.amount_brl_cents)
       OR v_snapshot_revenue -> 'revision'
            IS DISTINCT FROM
                pg_catalog.to_jsonb(v_revenue.revision)
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_REVENUE_SNAPSHOT_MISMATCH';
    END IF;

    -- Consistencia da receita declarada, nao comprovante externo.
    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'status', 'consistent_declared_revenue',
        'month', p_month,
        'preclosure_revision', p_preclosure_revision,
        'revenue_revision', v_revenue.revision,
        'revenue_brl_cents', v_revenue.amount_brl_cents,
        'definitive', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.zion_admin_verify_final_close_manual_revenue_by_system(
        date, integer
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.zion_admin_verify_final_close_manual_revenue_by_system(
        date, integer
    )
TO service_role;

COMMIT;
