BEGIN;

CREATE FUNCTION public.zion_admin_reconcile_monthly_registered_costs_by_system(
    p_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_preclosure public.zion_admin_monthly_preclosures%ROWTYPE;
    v_audit public.zion_admin_monthly_preclosure_audit%ROWTYPE;
    v_sources jsonb;

    v_fixed_versions bigint;
    v_fixed_items bigint;
    v_manual_rows bigint;

    v_fixed numeric;
    v_manual_brl numeric;
    v_manual_usd numeric;

    v_expected_fixed numeric;
    v_expected_manual_brl numeric;
    v_expected_manual_usd numeric;

    v_fixed_match boolean := false;
    v_manual_match boolean := false;
    v_blockers text[] := ARRAY[]::text[];
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_ADMIN_REGISTERED_COSTS_UNAUTHORIZED';
    END IF;

    IF p_month IS NULL
       OR p_month < DATE '2020-01-01'
       OR p_month > DATE '2100-12-01'
       OR p_month <> pg_catalog.date_trunc('month', p_month::timestamp)::date
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_REGISTERED_COSTS_INVALID_MONTH';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_monthly_preclosure'),
        pg_catalog.hashtext(p_month::text)
    );

    SELECT *
    INTO v_preclosure
    FROM public.zion_admin_monthly_preclosures
    WHERE month = p_month
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ZION_ADMIN_REGISTERED_COSTS_PRECLOSURE_MISSING';
    END IF;

    SELECT *
    INTO v_audit
    FROM public.zion_admin_monthly_preclosure_audit
    WHERE month = p_month
      AND revision = v_preclosure.revision;

    IF NOT FOUND
       OR v_audit.source_snapshot IS DISTINCT FROM v_preclosure.source_snapshot
       OR v_audit.pending_sources IS DISTINCT FROM v_preclosure.pending_sources
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_REGISTERED_COSTS_REVISION_MISMATCH';
    END IF;

    IF v_preclosure.source_snapshot ->> 'financial_status'
         IS DISTINCT FROM 'preliminary'
       OR pg_catalog.jsonb_typeof(
           v_preclosure.source_snapshot -> 'sources'
       ) IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION 'ZION_ADMIN_REGISTERED_COSTS_INVALID_SNAPSHOT';
    END IF;

    v_sources := v_preclosure.source_snapshot -> 'sources';

    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_final_closures
        WHERE month = p_month
    ) THEN
        v_blockers := pg_catalog.array_append(
            v_blockers, 'already_finalized'
        );
    END IF;

    -- Preservar os limites fail-closed do leitor TypeScript.
    SELECT pg_catalog.count(*) INTO v_fixed_versions
    FROM public.zion_admin_fixed_cost_versions;

    SELECT pg_catalog.count(*) INTO v_fixed_items
    FROM public.zion_admin_fixed_cost_items;

    IF v_fixed_versions >= 1000 OR v_fixed_items >= 1000 THEN
        v_blockers := pg_catalog.array_append(
            v_blockers, 'fixed_source_limit_exceeded'
        );
    ELSE
        -- Versao mais recente aplicavel por item.
        WITH latest AS (
            SELECT DISTINCT ON (v.item_id)
                v.item_id,
                v.amount_cents,
                v.frequency,
                v.enabled,
                i.starts_on
            FROM public.zion_admin_fixed_cost_versions v
            JOIN public.zion_admin_fixed_cost_items i
              ON i.id = v.item_id
            WHERE v.effective_month <= p_month
            ORDER BY v.item_id, v.effective_month DESC
        )
        SELECT COALESCE(
            pg_catalog.sum(
                CASE
                    WHEN frequency = 'monthly'
                    THEN amount_cents::numeric
                    ELSE
                        pg_catalog.floor(
                            EXTRACT(MONTH FROM p_month)
                            * amount_cents::numeric / 12
                        )
                        -
                        pg_catalog.floor(
                            (EXTRACT(MONTH FROM p_month) - 1)
                            * amount_cents::numeric / 12
                        )
                END
            ), 0
        )
        INTO v_fixed
        FROM latest
        WHERE enabled = true
          AND starts_on <= (
              p_month + INTERVAL '1 month - 1 day'
          )::date;

        IF v_fixed > 9007199254740991 THEN
            v_blockers := pg_catalog.array_append(
                v_blockers, 'fixed_total_unsafe'
            );
        END IF;
    END IF;

    -- Apenas lancamentos ativos da competencia.
    SELECT
        pg_catalog.count(*),
        COALESCE(
            pg_catalog.sum(amount_minor) FILTER (WHERE currency = 'BRL'),
            0
        ),
        COALESCE(
            pg_catalog.sum(amount_minor) FILTER (WHERE currency = 'USD'),
            0
        )
    INTO v_manual_rows, v_manual_brl, v_manual_usd
    FROM public.zion_admin_variable_expenses
    WHERE competence_month = p_month
      AND status = 'active';

    IF v_manual_rows >= 100000
       OR v_manual_brl > 9007199254740991
       OR v_manual_usd > 9007199254740991
    THEN
        v_blockers := pg_catalog.array_append(
            v_blockers, 'manual_source_limit_exceeded'
        );
    END IF;

    -- Comparacao tipada, sem confiar em totais recebidos da aplicacao.
    IF v_sources -> 'fixed' ->> 'status' = 'registered'
       AND pg_catalog.jsonb_typeof(
           v_sources -> 'fixed' -> 'registeredBrlCents'
       ) = 'number'
    THEN
        v_expected_fixed := (
            v_sources -> 'fixed' ->> 'registeredBrlCents'
        )::numeric;

        v_fixed_match :=
            v_fixed IS NOT NULL
            AND v_fixed <= 9007199254740991
            AND v_expected_fixed >= 0
            AND v_expected_fixed <= 9007199254740991
            AND v_expected_fixed = pg_catalog.trunc(v_expected_fixed)
            AND v_fixed = v_expected_fixed;
    END IF;

    IF NOT v_fixed_match THEN
        v_blockers := pg_catalog.array_append(
            v_blockers, 'fixed_snapshot_mismatch'
        );
    END IF;

    IF v_sources -> 'manual' ->> 'status' = 'registered'
       AND pg_catalog.jsonb_typeof(
           v_sources -> 'manual' -> 'registeredBrlCents'
       ) = 'number'
       AND pg_catalog.jsonb_typeof(
           v_sources -> 'manual' -> 'registeredUsdCents'
       ) = 'number'
    THEN
        v_expected_manual_brl := (
            v_sources -> 'manual' ->> 'registeredBrlCents'
        )::numeric;

        v_expected_manual_usd := (
            v_sources -> 'manual' ->> 'registeredUsdCents'
        )::numeric;

        v_manual_match :=
            v_manual_brl <= 9007199254740991
            AND v_manual_usd <= 9007199254740991
            AND v_expected_manual_brl >= 0
            AND v_expected_manual_usd >= 0
            AND v_expected_manual_brl <= 9007199254740991
            AND v_expected_manual_usd <= 9007199254740991
            AND v_expected_manual_brl = pg_catalog.trunc(v_expected_manual_brl)
            AND v_expected_manual_usd = pg_catalog.trunc(v_expected_manual_usd)
            AND v_manual_brl = v_expected_manual_brl
            AND v_manual_usd = v_expected_manual_usd;
    END IF;

    IF NOT v_manual_match THEN
        v_blockers := pg_catalog.array_append(
            v_blockers, 'manual_snapshot_mismatch'
        );
    END IF;

    IF v_manual_usd > 0 THEN
        v_blockers := pg_catalog.array_append(
            v_blockers, 'manual_usd_conversion_undefined'
        );
    END IF;

    -- Esta funcao verifica apenas custos registrados.
    -- Nao comprova OpenAI, PTAX ou autoridade financeira Meta.
    -- Nao autoriza nem executa fechamento definitivo.
    RETURN pg_catalog.jsonb_build_object(
        'month', p_month,
        'preclosure_revision', v_preclosure.revision,
        'registered_sources_match', v_fixed_match AND v_manual_match,
        'fixed_match', v_fixed_match,
        'manual_match', v_manual_match,
        'status',
            CASE
                WHEN pg_catalog.cardinality(v_blockers) = 0
                THEN 'matched'
                ELSE 'blocked'
            END,
        'final_close_eligible', false,
        'blockers', v_blockers
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.zion_admin_reconcile_monthly_registered_costs_by_system(date)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.zion_admin_reconcile_monthly_registered_costs_by_system(date)
TO service_role;

COMMIT;