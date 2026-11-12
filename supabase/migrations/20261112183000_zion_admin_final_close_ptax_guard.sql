BEGIN;

-- ZION-ADM | 2.16-A.6-G.3-D
-- Verificacao da PTAX persistida e da conversao oficial USD/BRL.
-- Nunca autoriza fechamento definitivo.
-- Nao consulta BCB, OpenAI ou outros provedores.

CREATE OR REPLACE FUNCTION
public.zion_admin_final_ptax_stable_json_v1(
    p_value jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO ''
AS $function$
DECLARE
    v_type text;
    v_result text;
BEGIN
    v_type := pg_catalog.jsonb_typeof(p_value);

    IF v_type = 'object' THEN
        SELECT
            '{' || COALESCE(
                pg_catalog.string_agg(
                    pg_catalog.to_json(e.key)::text
                    || ':'
                    || public.zion_admin_final_ptax_stable_json_v1(
                        e.value
                    ),
                    ','
                    ORDER BY e.key COLLATE "C"
                ),
                ''
            ) || '}'
        INTO v_result
        FROM pg_catalog.jsonb_each(p_value)
            AS e(key, value);

        RETURN v_result;

    ELSIF v_type = 'array' THEN
        SELECT
            '[' || COALESCE(
                pg_catalog.string_agg(
                    public.zion_admin_final_ptax_stable_json_v1(
                        e.value
                    ),
                    ','
                    ORDER BY e.position
                ),
                ''
            ) || ']'
        INTO v_result
        FROM pg_catalog.jsonb_array_elements(p_value)
            WITH ORDINALITY AS e(value, position);

        RETURN v_result;

    ELSIF v_type = 'string' THEN
        RETURN pg_catalog.to_json(
            p_value #>> '{}'
        )::text;

    ELSIF v_type = 'number' THEN
        RETURN pg_catalog.trim_scale(
            p_value::text::numeric
        )::text;

    ELSIF v_type IN ('boolean', 'null') THEN
        RETURN p_value::text;
    END IF;

    RAISE EXCEPTION 'ZION_ADMIN_FINAL_PTAX_INVALID_JSON';
END;
$function$;

REVOKE ALL ON FUNCTION
    public.zion_admin_final_ptax_stable_json_v1(jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.zion_admin_final_ptax_stable_json_v1(jsonb)
TO service_role;


CREATE OR REPLACE FUNCTION
public.zion_admin_verify_final_close_ptax_by_system(
    p_month date,
    p_preclosure_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_official_result jsonb;
    v_snapshot jsonb;
    v_openai jsonb;
    v_daily jsonb;
    v_entry jsonb;
    v_evidence jsonb;

    v_collection
        public.zion_admin_ptax_collection_evidence%ROWTYPE;

    v_envelope jsonb;
    v_expected_url text;
    v_digest text;

    v_quotes jsonb := '{}'::jsonb;
    v_quote jsonb;
    v_quote_date date;
    v_quote_timestamp text;
    v_quote_rate text;
    v_existing jsonb;

    v_last_day date;
    v_expected_days integer;
    v_index integer;
    v_offset integer;
    v_day date;
    v_candidate date;
    v_selected jsonb;
    v_selected_date date;

    v_usd numeric;
    v_day_cents numeric;
    v_total_cents numeric := 0;
    v_positive_days integer := 0;
    v_max_safe constant numeric := 9007199254740991;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_UNAUTHORIZED';
    END IF;

    -- Herda as verificacoes de fonte oficial, auditoria,
    -- cobertura, proveniencia e valor USD da funcao anterior.
    v_official_result :=
        public.zion_admin_verify_final_close_openai_daily_by_system(
            p_month,
            p_preclosure_revision
        );

    IF v_official_result ->> 'status'
            IS DISTINCT FROM 'official_openai_daily_verified'
       OR v_official_result ->> 'ok'
            IS DISTINCT FROM 'true'
       OR v_official_result ->> 'definitive'
            IS DISTINCT FROM 'false'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_OFFICIAL_NOT_VERIFIED';
    END IF;

    SELECT p.source_snapshot
    INTO v_snapshot
    FROM public.zion_admin_monthly_preclosures p
    WHERE p.month = p_month
      AND p.revision = p_preclosure_revision
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_PRECLOSURE_MISSING';
    END IF;

    v_openai := v_snapshot #> '{sources,openai}';
    v_daily := v_openai -> 'dailyEvidence';

    v_last_day :=
        (p_month + INTERVAL '1 month')::date - 1;

    v_expected_days :=
        pg_catalog.date_part('day', v_last_day)::integer;

    IF pg_catalog.jsonb_typeof(v_daily)
            IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(v_daily)
            IS DISTINCT FROM v_expected_days
       OR pg_catalog.jsonb_typeof(
            v_openai -> 'knownBrlCents'
        ) IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(
            v_openai -> 'estimatedBrlCents'
        ) IS DISTINCT FROM 'number'
       OR v_openai -> 'missingPtaxDays'
            IS DISTINCT FROM '[]'::jsonb
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_INCOMPLETE_SNAPSHOT';
    END IF;

    -- USD zero confirmado dispensa cotacao,
    -- mas exige zero em cada dia e nos totais BRL.
    IF (v_openai ->> 'officialUsd')::numeric = 0 THEN
        FOR v_index IN 0..(v_expected_days - 1) LOOP
            v_entry := v_daily -> v_index;

            IF (v_entry ->> 'usd')::numeric <> 0
               OR pg_catalog.jsonb_typeof(
                    v_entry -> 'estimatedBrlCents'
                ) IS DISTINCT FROM 'number'
               OR (v_entry ->> 'estimatedBrlCents')::numeric
                    IS DISTINCT FROM 0::numeric
               OR v_entry ->> 'quotationDate' IS NOT NULL
               OR v_entry ->> 'rate' IS NOT NULL
            THEN
                RAISE EXCEPTION
                    'ZION_ADMIN_FINAL_PTAX_INVALID_ZERO_DAY';
            END IF;
        END LOOP;

        IF (v_openai ->> 'knownBrlCents')::numeric <> 0
           OR (v_openai ->> 'estimatedBrlCents')::numeric <> 0
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_PTAX_ZERO_TOTAL_MISMATCH';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'ok', true,
            'status', 'ptax_not_required_zero_usd',
            'month', p_month,
            'preclosure_revision', p_preclosure_revision,
            'official_usd', '0',
            'brl_cents', 0,
            'ptax_required', false,
            'ptax_verified', false,
            'fx_requirement_satisfied', true,
            'definitive', false
        );
    END IF;

    -- Com USD positivo, a evidencia reprocessada
    -- precisa existir no pre-fechamento.
    v_evidence := v_openai -> 'ptaxEvidence';

    IF pg_catalog.jsonb_typeof(v_evidence)
            IS DISTINCT FROM 'object'
       OR v_evidence ->> 'status'
            IS DISTINCT FROM 'reconciled_payload'
       OR pg_catalog.jsonb_typeof(
            v_evidence -> 'collectionId'
        ) IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(
            v_evidence -> 'collectionKey'
        ) IS DISTINCT FROM 'string'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_EVIDENCE_MISSING';
    END IF;

    IF (v_evidence ->> 'collectionId') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR (v_evidence ->> 'collectionKey') !~
        '^bcb_ptax_venda:v1:[0-9a-f]{64}$'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_INVALID_IDENTITY';
    END IF;

    SELECT e.*
    INTO v_collection
    FROM public.zion_admin_ptax_collection_evidence e
    WHERE e.id = (v_evidence ->> 'collectionId')::uuid
      AND e.collection_key =
          v_evidence ->> 'collectionKey';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_EVIDENCE_NOT_FOUND';
    END IF;

    IF v_collection.source IS DISTINCT FROM 'bcb_ptax_venda'
       OR v_collection.requested_from IS DISTINCT FROM p_month
       OR v_collection.requested_to IS DISTINCT FROM v_last_day
       OR v_collection.request_finished_at <
            v_collection.request_started_at
       OR v_collection.request_finished_at -
            v_collection.request_started_at > INTERVAL '1 minute'
       OR v_collection.request_finished_at >
            pg_catalog.clock_timestamp() + INTERVAL '5 minutes'
       OR v_collection.result_count < 0
       OR v_collection.result_count >= 1500
       OR pg_catalog.jsonb_typeof(
            v_collection.response_payload -> 'value'
        ) IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_INVALID_EVIDENCE';
    END IF;

    IF pg_catalog.jsonb_array_length(
        v_collection.response_payload -> 'value'
    ) <> v_collection.result_count THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_COUNT_MISMATCH';
    END IF;

    v_expected_url :=
        'https://olinda.bcb.gov.br/olinda/servico/PTAX/'
        || 'versao/v1/odata/CotacaoDolarPeriodo'
        || '(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?'
        || '%40dataInicial=%27'
        || pg_catalog.to_char(p_month - 10, 'MM-DD-YYYY')
        || '%27&%40dataFinalCotacao=%27'
        || pg_catalog.to_char(v_last_day, 'MM-DD-YYYY')
        || '%27&%24top=1500'
        || '&%24select=cotacaoVenda%2CdataHoraCotacao'
        || '&%24format=json';

    IF v_collection.endpoint_url
        IS DISTINCT FROM v_expected_url
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_ENDPOINT_MISMATCH';
    END IF;

    -- Reconstrucao do envelope original em formato
    -- identico ao serializador canonico TypeScript.
    v_envelope := pg_catalog.jsonb_build_object(
        'source', v_collection.source,
        'requestedFrom', v_collection.requested_from::text,
        'requestedTo', v_collection.requested_to::text,
        'requestStartedAt',
            pg_catalog.to_char(
                v_collection.request_started_at
                    AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
        'requestFinishedAt',
            pg_catalog.to_char(
                v_collection.request_finished_at
                    AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
        'endpointUrl', v_collection.endpoint_url,
        'responsePayload', v_collection.response_payload,
        'resultCount', v_collection.result_count
    );

    v_digest := pg_catalog.encode(
        pg_catalog.sha256(
            pg_catalog.convert_to(
                public.zion_admin_final_ptax_stable_json_v1(
                    v_envelope
                ),
                'UTF8'
            )
        ),
        'hex'
    );

    IF v_collection.collection_key
        IS DISTINCT FROM
            'bcb_ptax_venda:v1:' || v_digest
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_SHA256_MISMATCH';
    END IF;

    -- Reconstitui a cotacao de horario mais recente
    -- para cada data presente na resposta original.
    FOR v_quote IN
        SELECT item.value
        FROM pg_catalog.jsonb_array_elements(
            v_collection.response_payload -> 'value'
        ) AS item(value)
    LOOP
        IF pg_catalog.jsonb_typeof(v_quote)
                IS DISTINCT FROM 'object'
           OR pg_catalog.jsonb_typeof(
                v_quote -> 'dataHoraCotacao'
            ) IS DISTINCT FROM 'string'
           OR pg_catalog.jsonb_typeof(
                v_quote -> 'cotacaoVenda'
            ) NOT IN ('string', 'number')
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_PTAX_INVALID_QUOTATION';
        END IF;

        v_quote_timestamp :=
            v_quote ->> 'dataHoraCotacao';

        v_quote_rate := CASE
            WHEN pg_catalog.jsonb_typeof(
                v_quote -> 'cotacaoVenda'
            ) = 'number'
            THEN pg_catalog.trim_scale(
                (v_quote ->> 'cotacaoVenda')::numeric
            )::text
            ELSE v_quote ->> 'cotacaoVenda'
        END;

        IF pg_catalog.length(v_quote_rate) > 32
           OR v_quote_rate !~
                '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
           OR v_quote_rate::numeric <= 0
           OR v_quote_rate::numeric >= 1000
           OR pg_catalog.length(v_quote_timestamp) > 40
           OR v_quote_timestamp !~
                '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[ T]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?$'
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_PTAX_INVALID_QUOTATION';
        END IF;

        v_quote_date :=
            pg_catalog.left(v_quote_timestamp, 10)::date;

        IF pg_catalog.to_char(
            v_quote_date, 'YYYY-MM-DD'
        ) IS DISTINCT FROM
            pg_catalog.left(v_quote_timestamp, 10)
           OR v_quote_date < p_month - 10
           OR v_quote_date > v_last_day
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_PTAX_QUOTATION_OUT_OF_RANGE';
        END IF;

        v_existing := v_quotes -> v_quote_date::text;

        IF v_existing IS NULL
           OR v_quote_timestamp >
                v_existing ->> 'timestamp'
        THEN
            v_quotes := pg_catalog.jsonb_set(
                v_quotes,
                ARRAY[v_quote_date::text],
                pg_catalog.jsonb_build_object(
                    'timestamp', v_quote_timestamp,
                    'rate', v_quote_rate
                ),
                true
            );
        END IF;
    END LOOP;

    -- Cada dia e convertido separadamente.
    -- round(numeric, 0) usa arredondamento half-up
    -- para estes valores nao negativos.
    FOR v_index IN 0..(v_expected_days - 1) LOOP
        v_day := p_month + v_index;
        v_entry := v_daily -> v_index;
        v_usd := (v_entry ->> 'usd')::numeric;

        IF pg_catalog.jsonb_typeof(
            v_entry -> 'estimatedBrlCents'
        ) IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_PTAX_DAILY_BRL_MISSING';
        END IF;

        IF v_usd = 0 THEN
            v_day_cents := 0;

            IF v_entry ->> 'quotationDate' IS NOT NULL
               OR v_entry ->> 'rate' IS NOT NULL
            THEN
                RAISE EXCEPTION
                    'ZION_ADMIN_FINAL_PTAX_ZERO_DAY_HAS_QUOTE';
            END IF;
        ELSE
            v_positive_days := v_positive_days + 1;
            v_selected := NULL;
            v_selected_date := NULL;

            FOR v_offset IN 0..10 LOOP
                v_candidate := v_day - v_offset;
                v_selected := v_quotes -> v_candidate::text;

                IF v_selected IS NOT NULL THEN
                    v_selected_date := v_candidate;
                    EXIT;
                END IF;
            END LOOP;

            IF v_selected IS NULL THEN
                RAISE EXCEPTION
                    'ZION_ADMIN_FINAL_PTAX_MISSING_RATE';
            END IF;

            IF v_entry ->> 'quotationDate'
                    IS DISTINCT FROM v_selected_date::text
               OR v_entry ->> 'rate'
                    IS DISTINCT FROM v_selected ->> 'rate'
            THEN
                RAISE EXCEPTION
                    'ZION_ADMIN_FINAL_PTAX_DAILY_RATE_MISMATCH';
            END IF;

            v_day_cents := pg_catalog.round(
                v_usd *
                    (v_selected ->> 'rate')::numeric * 100,
                0
            );
        END IF;

        IF v_day_cents < 0
           OR v_day_cents > v_max_safe
           OR v_entry ->> 'estimatedBrlCents'
                !~ '^(0|[1-9][0-9]*)$'
           OR (v_entry ->> 'estimatedBrlCents')::numeric
                IS DISTINCT FROM v_day_cents
        THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_PTAX_DAILY_BRL_MISMATCH';
        END IF;

        v_total_cents := v_total_cents + v_day_cents;

        IF v_total_cents > v_max_safe THEN
            RAISE EXCEPTION
                'ZION_ADMIN_FINAL_PTAX_BRL_OVERFLOW';
        END IF;
    END LOOP;

    IF (v_openai ->> 'knownBrlCents') !~
            '^(0|[1-9][0-9]*)$'
       OR (v_openai ->> 'estimatedBrlCents') !~
            '^(0|[1-9][0-9]*)$'
       OR (v_openai ->> 'knownBrlCents')::numeric
            IS DISTINCT FROM v_total_cents
       OR (v_openai ->> 'estimatedBrlCents')::numeric
            IS DISTINCT FROM v_total_cents
    THEN
        RAISE EXCEPTION
            'ZION_ADMIN_FINAL_PTAX_MONTHLY_BRL_MISMATCH';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'status', 'ptax_payload_verified',
        'month', p_month,
        'preclosure_revision', p_preclosure_revision,
        'official_usd', v_openai ->> 'officialUsd',
        'brl_cents', v_total_cents,
        'positive_usd_days', v_positive_days,
        'ptax_required', true,
        'ptax_verified', true,
        'fx_requirement_satisfied', true,
        'definitive', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.zion_admin_verify_final_close_ptax_by_system(
        date, integer
    )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.zion_admin_verify_final_close_ptax_by_system(
        date, integer
    )
TO service_role;

COMMIT;
