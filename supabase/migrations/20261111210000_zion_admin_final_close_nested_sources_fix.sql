-- ZION-ADM / 2.16-A.6-C
-- Alinha os verificadores ao snapshot canonico.
-- Nao executa fechamento definitivo.
-- Nao altera fontes ou valores Meta.
BEGIN;

CREATE OR REPLACE FUNCTION public.zion_admin_verify_final_close_manual_revenue_by_system(
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
        v_preclosure.source_snapshot #> '{sources,manualRevenue}';

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

CREATE OR REPLACE FUNCTION public.zion_admin_verify_final_close_registered_costs_by_system(
    p_month date,
    p_preclosure_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_pre public.zion_admin_monthly_preclosures%ROWTYPE;
    v_audit public.zion_admin_monthly_preclosure_audit%ROWTYPE;
    v_month_end date;

    v_item_count bigint;
    v_version_count bigint;
    v_expense_count bigint;
    v_invalid_count bigint;

    v_fixed numeric;
    v_manual_brl numeric;
    v_manual_usd numeric;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_UNAUTHORIZED';
    END IF;

    IF p_month IS NULL
       OR p_month < DATE '2020-01-01'
       OR p_month > DATE '2100-12-01'
       OR p_month <> pg_catalog.date_trunc(
           'month', p_month::timestamp
       )::date
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_INVALID_MONTH';
    END IF;

    IF p_preclosure_revision IS NULL
       OR p_preclosure_revision < 1
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_INVALID_REVISION';
    END IF;

    IF p_month >= pg_catalog.date_trunc(
        'month',
        pg_catalog.clock_timestamp()
            AT TIME ZONE 'America/Sao_Paulo'
    )::date
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_MONTH_NOT_FINISHED';
    END IF;

    -- Serializa a leitura com as operacoes do pre-fechamento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_monthly_preclosure'),
        pg_catalog.hashtext(p_month::text)
    );

    SELECT *
    INTO v_pre
    FROM public.zion_admin_monthly_preclosures
    WHERE month = p_month
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_PRECLOSURE_MISSING';
    END IF;

    IF v_pre.revision <> p_preclosure_revision THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_STALE_PRECLOSURE';
    END IF;

    SELECT *
    INTO v_audit
    FROM public.zion_admin_monthly_preclosure_audit
    WHERE month = p_month
      AND revision = p_preclosure_revision
    FOR SHARE;

    IF NOT FOUND
       OR v_audit.source_snapshot
            IS DISTINCT FROM v_pre.source_snapshot
       OR v_audit.pending_sources
            IS DISTINCT FROM v_pre.pending_sources
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_PRECLOSURE_AUDIT_MISMATCH';
    END IF;

    -- Impede alteracoes concorrentes nas tabelas consultadas
    -- enquanto esta transacao estiver aberta.
    LOCK TABLE
        public.zion_admin_fixed_cost_items,
        public.zion_admin_fixed_cost_versions,
        public.zion_admin_variable_expenses
    IN SHARE MODE;

    v_month_end := (
        p_month + INTERVAL '1 month' - INTERVAL '1 day'
    )::date;

    SELECT pg_catalog.count(*)
    INTO v_item_count
    FROM public.zion_admin_fixed_cost_items;

    SELECT pg_catalog.count(*)
    INTO v_version_count
    FROM public.zion_admin_fixed_cost_versions;

    -- Mesmos limites de completude do leitor atual.
    IF v_item_count >= 1000 OR v_version_count >= 1000 THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_FIXED_READER_LIMIT';
    END IF;

    -- Ultima versao efetiva por item.
    -- O rateio anual reproduz:
    -- floor(mes * valor / 12) - floor((mes-1) * valor / 12).
    WITH applicable AS (
        SELECT DISTINCT ON (v.item_id)
            v.item_id,
            v.amount_cents,
            v.frequency,
            v.enabled,
            i.starts_on
        FROM public.zion_admin_fixed_cost_versions AS v
        JOIN public.zion_admin_fixed_cost_items AS i
          ON i.id = v.item_id
        WHERE v.effective_month <= p_month
        ORDER BY v.item_id, v.effective_month DESC
    )
    SELECT COALESCE(
        pg_catalog.sum(
            CASE
                WHEN NOT a.enabled OR a.starts_on > v_month_end
                    THEN 0::numeric
                WHEN a.frequency = 'monthly'
                    THEN a.amount_cents::numeric
                WHEN a.frequency = 'annual'
                    THEN
                        pg_catalog.floor(
                            a.amount_cents::numeric *
                            EXTRACT(MONTH FROM p_month) / 12
                        )
                        -
                        pg_catalog.floor(
                            a.amount_cents::numeric *
                            (
                                EXTRACT(MONTH FROM p_month) - 1
                            ) / 12
                        )
                ELSE NULL
            END
        ),
        0::numeric
    )
    INTO v_fixed
    FROM applicable AS a;

    IF v_fixed IS NULL
       OR v_fixed < 0
       OR v_fixed > 9007199254740991
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_FIXED_INVALID';
    END IF;

    -- Apura apenas despesas ativas da competencia.
    -- BRL e USD nunca sao somados entre si.
    SELECT
        pg_catalog.count(*),
        pg_catalog.count(*) FILTER (
            WHERE currency NOT IN ('BRL', 'USD')
               OR currency IS NULL
               OR amount_minor IS NULL
               OR amount_minor < 0
               OR amount_minor > 9007199254740991
        ),
        COALESCE(
            pg_catalog.sum(
                CASE WHEN currency = 'BRL'
                    THEN amount_minor::numeric
                    ELSE 0::numeric
                END
            ), 0::numeric
        ),
        COALESCE(
            pg_catalog.sum(
                CASE WHEN currency = 'USD'
                    THEN amount_minor::numeric
                    ELSE 0::numeric
                END
            ), 0::numeric
        )
    INTO
        v_expense_count,
        v_invalid_count,
        v_manual_brl,
        v_manual_usd
    FROM public.zion_admin_variable_expenses
    WHERE competence_month = p_month
      AND status = 'active';

    IF v_expense_count >= 100000
       OR v_invalid_count <> 0
       OR v_manual_brl < 0
       OR v_manual_usd < 0
       OR v_manual_brl > 9007199254740991
       OR v_manual_usd > 9007199254740991
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_MANUAL_INVALID';
    END IF;

    -- O snapshot deve corresponder aos totais atuais.
    IF pg_catalog.jsonb_typeof(
        v_pre.source_snapshot #> '{sources,fixed}'
    ) IS DISTINCT FROM 'object'
       OR v_pre.source_snapshot #>> '{sources,fixed,status}'
            IS DISTINCT FROM 'registered'
       OR v_pre.source_snapshot #> '{sources,fixed,registeredBrlCents}'
            IS DISTINCT FROM pg_catalog.to_jsonb(v_fixed::bigint)
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_FIXED_SNAPSHOT_MISMATCH';
    END IF;

    IF pg_catalog.jsonb_typeof(
        v_pre.source_snapshot #> '{sources,manual}'
    ) IS DISTINCT FROM 'object'
       OR v_pre.source_snapshot #>> '{sources,manual,status}'
            IS DISTINCT FROM 'registered'
       OR v_pre.source_snapshot #> '{sources,manual,registeredBrlCents}'
            IS DISTINCT FROM pg_catalog.to_jsonb(v_manual_brl::bigint)
       OR v_pre.source_snapshot #> '{sources,manual,registeredUsdCents}'
            IS DISTINCT FROM pg_catalog.to_jsonb(v_manual_usd::bigint)
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_MANUAL_SNAPSHOT_MISMATCH';
    END IF;

    -- Nao existe aqui autoridade de conversao para
    -- despesas manuais em USD. Bloqueio conservador.
    IF v_manual_usd <> 0 THEN
        RAISE EXCEPTION 'ZION_ADMIN_FINAL_COSTS_MANUAL_USD_FX_MISSING';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'status', 'consistent_registered_costs',
        'month', p_month,
        'preclosure_revision', p_preclosure_revision,
        'fixed_brl_cents', v_fixed::bigint,
        'manual_brl_cents', v_manual_brl::bigint,
        'manual_usd_cents', v_manual_usd::bigint,
        'definitive', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.zion_admin_verify_final_close_manual_revenue_by_system(date,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zion_admin_verify_final_close_manual_revenue_by_system(date,integer) TO service_role;

REVOKE ALL ON FUNCTION public.zion_admin_verify_final_close_registered_costs_by_system(date,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zion_admin_verify_final_close_registered_costs_by_system(date,integer) TO service_role;

COMMIT;
