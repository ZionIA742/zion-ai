BEGIN;

-- ZION-ADM | Etapa 2.16-A.6-G.2-A
-- Verifica o livro oficial diario da OpenAI.
-- Nao verifica PTAX e nao autoriza fechamento definitivo.

CREATE OR REPLACE FUNCTION
public.zion_admin_verify_final_close_openai_daily_by_system(
    p_month date,
    p_preclosure_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_snapshot jsonb;
    v_pending text[];
    v_revision integer;
    v_openai jsonb;
    v_daily jsonb;
    v_day_entry jsonb;

    v_last_day date;
    v_day date;
    v_expected_days integer;
    v_index integer;

    v_start timestamptz;
    v_end timestamptz;

    v_operations integer;
    v_operation_id uuid;
    v_collection_id uuid;
    v_query_identity text;

    v_collection public.zion_admin_provider_cost_collections%ROWTYPE;
    v_line_count bigint;
    v_invalid_lines bigint;
    v_day_usd numeric;
    v_total_usd numeric := 0;

    v_snapshot_usd text;
    v_collection_count integer := 0;
BEGIN
    -- Autoridade exclusivamente interna.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_UNAUTHORIZED';
    END IF;

    IF p_month IS NULL
       OR p_month <>
            pg_catalog.date_trunc(
                'month', p_month::timestamp
            )::date
       OR p_month >=
            pg_catalog.date_trunc(
                'month',
                pg_catalog.clock_timestamp()
                    AT TIME ZONE 'America/Sao_Paulo'
            )::date
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_INVALID_MONTH';
    END IF;

    IF p_preclosure_revision IS NULL
       OR p_preclosure_revision < 1
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_INVALID_REVISION';
    END IF;

    -- Mesma trava por competencia utilizada no pre-fechamento.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_monthly_preclosure'),
        pg_catalog.hashtext(p_month::text)
    );

    SELECT
        revision,
        source_snapshot,
        pending_sources
    INTO
        v_revision,
        v_snapshot,
        v_pending
    FROM public.zion_admin_monthly_preclosures
    WHERE month = p_month
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_PRECLOSURE_MISSING';
    END IF;

    IF v_revision IS DISTINCT FROM p_preclosure_revision THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_STALE_PRECLOSURE';
    END IF;

    -- O registro precisa corresponder exatamente a auditoria.
    IF NOT EXISTS (
        SELECT 1
        FROM public.zion_admin_monthly_preclosure_audit a
        WHERE a.month = p_month
          AND a.revision = p_preclosure_revision
          AND a.source_snapshot = v_snapshot
          AND a.pending_sources = v_pending
    ) THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_PRECLOSURE_AUDIT_MISMATCH';
    END IF;

    IF v_snapshot ->> 'financial_status'
        IS DISTINCT FROM 'preliminary'
       OR pg_catalog.jsonb_typeof(
           v_snapshot -> 'sources'
       ) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(
           v_snapshot #> '{sources,openai}'
       ) IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_INVALID_SNAPSHOT';
    END IF;

    v_openai := v_snapshot #> '{sources,openai}';

    v_last_day :=
        (p_month + INTERVAL '1 month')::date - 1;

    v_expected_days :=
        pg_catalog.date_part('day', v_last_day)::integer;

    IF v_openai ->> 'status'
        IS DISTINCT FROM 'official_period_complete'
       OR v_openai ->> 'confirmedDays'
            IS DISTINCT FROM v_expected_days::text
       OR v_openai ->> 'expectedDays'
            IS DISTINCT FROM v_expected_days::text
       OR pg_catalog.jsonb_typeof(
           v_openai -> 'dailyEvidence'
       ) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(
           v_openai -> 'dailyEvidence'
       ) <> v_expected_days
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_OFFICIAL_INCOMPLETE';
    END IF;

    v_snapshot_usd := v_openai ->> 'officialUsd';

    IF v_snapshot_usd IS NULL
       OR v_snapshot_usd !~
            '^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_INVALID_USD_TOTAL';
    END IF;

    v_daily := v_openai -> 'dailyEvidence';

    -- Reconstroi todos os dias UTC a partir do banco.
    FOR v_index IN 0..(v_expected_days - 1)
    LOOP
        v_day := p_month + v_index;

        v_start := v_day::timestamp
            AT TIME ZONE 'UTC';

        v_end := (v_day + 1)::timestamp
            AT TIME ZONE 'UTC';

        v_day_entry := v_daily -> v_index;

        IF pg_catalog.jsonb_typeof(v_day_entry)
                IS DISTINCT FROM 'object'
           OR v_day_entry ->> 'date'
                IS DISTINCT FROM v_day::text
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_OPENAI_DAILY_SNAPSHOT_MISMATCH';
        END IF;

        -- Operacoes com falha nao podem ser legitimadas
        -- por uma coleta confirmada no mesmo dia.
        IF EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operations o
            WHERE o.provider = 'openai'
              AND o.source = 'openai_organization_costs'
              AND o.period_start < v_end
              AND o.period_end > v_start
              AND o.state NOT IN ('confirmed', 'pending')
        ) THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_OPENAI_INVALID_OPERATION';
        END IF;

        -- Exatamente uma operacao confirmada vigente.
        SELECT pg_catalog.count(*)
        INTO v_operations
        FROM public.zion_admin_openai_cost_collection_operations o
        WHERE o.provider = 'openai'
          AND o.source = 'openai_organization_costs'
          AND o.state = 'confirmed'
          AND o.period_start = v_start
          AND o.period_end = v_end
          AND o.snapshot_collection_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.zion_admin_openai_cost_collection_operations s
              WHERE s.supersedes_operation_id = o.id
                AND s.state = 'confirmed'
          );

        IF v_operations <> 1 THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_OPENAI_DAILY_OPERATION_AMBIGUOUS';
        END IF;

        SELECT
            o.id,
            o.snapshot_collection_id,
            o.query_identity
        INTO
            v_operation_id,
            v_collection_id,
            v_query_identity
        FROM public.zion_admin_openai_cost_collection_operations o
        WHERE o.provider = 'openai'
          AND o.source = 'openai_organization_costs'
          AND o.state = 'confirmed'
          AND o.period_start = v_start
          AND o.period_end = v_end
          AND o.snapshot_collection_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.zion_admin_openai_cost_collection_operations s
              WHERE s.supersedes_operation_id = o.id
                AND s.state = 'confirmed'
          );

        SELECT *
        INTO v_collection
        FROM public.zion_admin_provider_cost_collections c
        WHERE c.id = v_collection_id;

        IF NOT FOUND
           OR v_collection.provider IS DISTINCT FROM 'openai'
           OR v_collection.source
                IS DISTINCT FROM 'openai_organization_costs'
           OR v_collection.query_identity
                IS DISTINCT FROM v_query_identity
           OR v_collection.provider_timezone IS DISTINCT FROM 'UTC'
           OR v_collection.period_start IS DISTINCT FROM v_start
           OR v_collection.period_end IS DISTINCT FROM v_end
           OR v_collection.status NOT IN (
               'available', 'confirmed_empty'
           )
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_OPENAI_COLLECTION_MISMATCH';
        END IF;

        -- Conferencia de proveniencia: IDs reais do banco.
        IF v_day_entry -> 'operationIds'
                IS DISTINCT FROM
                pg_catalog.jsonb_build_array(
                    v_operation_id::text
                )
           OR v_day_entry -> 'snapshotIds'
                IS DISTINCT FROM
                pg_catalog.jsonb_build_array(
                    v_collection_id::text
                )
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_OPENAI_DAILY_PROVENANCE_MISMATCH';
        END IF;

        SELECT
            pg_catalog.count(*),
            pg_catalog.count(*) FILTER (
                WHERE l.currency IS DISTINCT FROM 'USD'
                   OR l.amount_decimal_text IS NULL
                   OR l.amount_decimal_text !~
                        '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
                   OR l.period_start IS DISTINCT FROM v_start
                   OR l.period_end IS DISTINCT FROM v_end
            )
        INTO v_line_count, v_invalid_lines
        FROM public.zion_admin_provider_cost_lines l
        WHERE l.collection_id = v_collection_id;

        IF v_invalid_lines <> 0
           OR v_collection.result_count IS DISTINCT FROM v_line_count
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_OPENAI_INVALID_LINES';
        END IF;

        IF v_collection.status = 'confirmed_empty' THEN
            IF v_line_count <> 0 THEN
                RAISE EXCEPTION
                    'ZION_ADMIN_FINAL_OPENAI_INVALID_EMPTY';
            END IF;

            v_day_usd := 0;
        ELSE
            IF v_line_count < 1 THEN
                RAISE EXCEPTION
                    'ZION_ADMIN_FINAL_OPENAI_INVALID_AVAILABLE';
            END IF;

            -- Soma decimal exata, sem ponto flutuante JS.
            SELECT
                COALESCE(
                    pg_catalog.sum(
                        l.amount_decimal_text::numeric
                    ),
                    0::numeric
                )
            INTO v_day_usd
            FROM public.zion_admin_provider_cost_lines l
            WHERE l.collection_id = v_collection_id;

            IF EXISTS (
                SELECT 1
                FROM public.zion_admin_provider_cost_lines l
                WHERE l.collection_id = v_collection_id
                  AND (
                      l.amount_numeric IS NULL
                      OR l.amount_numeric IS DISTINCT FROM
                          l.amount_decimal_text::numeric
                  )
            ) THEN
                RAISE EXCEPTION
                    'ZION_ADMIN_FINAL_OPENAI_LINE_VALUE_MISMATCH';
            END IF;
        END IF;

        IF v_day_entry ->> 'usd' IS NULL
           OR v_day_entry ->> 'usd' !~
                '^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$'
           OR (v_day_entry ->> 'usd')::numeric
                IS DISTINCT FROM v_day_usd
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_OPENAI_DAILY_USD_MISMATCH';
        END IF;

        v_total_usd := v_total_usd + v_day_usd;
        v_collection_count := v_collection_count + 1;
    END LOOP;

    IF v_total_usd IS DISTINCT FROM v_snapshot_usd::numeric THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_OPENAI_MONTHLY_USD_MISMATCH';
    END IF;

    -- A conferencia de PTAX sera uma etapa separada.
    -- Este retorno NUNCA autoriza fechamento.
    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'status', 'official_openai_daily_verified',
        'month', p_month,
        'preclosure_revision', p_preclosure_revision,
        'confirmed_days', v_collection_count,
        'official_usd', v_snapshot_usd,
        'ptax_verified', false,
        'definitive', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.zion_admin_verify_final_close_openai_daily_by_system(
        date, integer
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.zion_admin_verify_final_close_openai_daily_by_system(
        date, integer
    )
TO service_role;

COMMIT;
