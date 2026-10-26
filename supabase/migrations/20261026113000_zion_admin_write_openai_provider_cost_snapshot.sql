-- ZION-ADM / 8-C.2
-- RPC transacional para snapshots oficiais OpenAI
-- Migration: 20261026113000_zion_admin_write_openai_provider_cost_snapshot.sql

BEGIN;

CREATE FUNCTION
public.zion_admin_write_openai_provider_cost_snapshot(
    p_collection jsonb,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_collection record;
    v_line record;

    v_existing
      public.zion_admin_provider_cost_collections%ROWTYPE;

    v_parsed_line
      public.zion_admin_provider_cost_lines%ROWTYPE;

    v_collection_id uuid;

    v_input_header jsonb;
    v_input_lines jsonb := '[]'::jsonb;
    v_sorted_input jsonb;
    v_existing_lines jsonb;

    v_raw_line jsonb;
    v_key_count integer;
    v_line_count integer := 0;
BEGIN

    -- Validacao do envelope.

    IF pg_catalog.jsonb_typeof(p_collection) <> 'object'
       OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
       OR p_collection IS NULL
       OR p_lines IS NULL
    THEN
        RAISE EXCEPTION
          'OPENAI_SNAPSHOT_INVALID_ENVELOPE';
    END IF;

    -- Contrato exato do writer: 12 campos.

    SELECT count(*)
    INTO v_key_count
    FROM pg_catalog.jsonb_object_keys(p_collection);

    IF v_key_count <> 12
       OR NOT (
         p_collection ?& ARRAY[
           'collection_key',
           'provider',
           'source',
           'query_identity',
           'period_start',
           'period_end',
           'provider_timezone',
           'status',
           'result_count',
           'query_parameters',
           'error_code',
           'collected_at'
         ]
       )
    THEN
        RAISE EXCEPTION
          'OPENAI_SNAPSHOT_INVALID_COLLECTION_FIELDS';
    END IF;

    SELECT *
    INTO v_collection
    FROM pg_catalog.jsonb_to_record(p_collection)
    AS c(
        collection_key text,
        provider text,
        source text,
        query_identity text,
        period_start timestamptz,
        period_end timestamptz,
        provider_timezone text,
        status text,
        result_count integer,
        query_parameters jsonb,
        error_code text,
        collected_at timestamptz
    );

    IF v_collection.collection_key IS NULL
       OR pg_catalog.length(v_collection.collection_key)
          NOT BETWEEN 30 AND 1024
       OR pg_catalog.left(
            v_collection.collection_key,
            pg_catalog.length(
              'openai_organization_costs:v1:'
            )
          ) <> 'openai_organization_costs:v1:'
       OR v_collection.provider IS DISTINCT FROM 'openai'
       OR v_collection.source IS DISTINCT FROM
          'openai_organization_costs'
       OR v_collection.provider_timezone IS DISTINCT FROM
          'UTC'
       OR v_collection.status NOT IN (
          'available', 'confirmed_empty'
       )
       OR v_collection.status IS NULL
       OR v_collection.query_identity IS NULL
       OR pg_catalog.length(v_collection.query_identity) = 0
       OR v_collection.period_start IS NULL
       OR v_collection.period_end IS NULL
       OR v_collection.period_end <= v_collection.period_start
       OR v_collection.collected_at IS NULL
       OR v_collection.result_count IS NULL
       OR v_collection.result_count < 0
       OR v_collection.error_code IS NOT NULL
       OR pg_catalog.jsonb_typeof(
            p_collection -> 'error_code'
          ) IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(
            v_collection.query_parameters
          ) IS DISTINCT FROM 'object'
       OR v_collection.query_parameters ->> 'query_identity'
          IS DISTINCT FROM v_collection.query_identity
       OR p_collection ->> 'period_start' !~ 'Z$'
       OR p_collection ->> 'period_end' !~ 'Z$'
       OR p_collection ->> 'collected_at' !~ 'Z$'
    THEN
        RAISE EXCEPTION
          'OPENAI_SNAPSHOT_INVALID_COLLECTION';
    END IF;

    IF v_collection.result_count <>
       pg_catalog.jsonb_array_length(p_lines)
       OR (
         v_collection.status = 'available'
         AND v_collection.result_count = 0
       )
       OR (
         v_collection.status = 'confirmed_empty'
         AND v_collection.result_count <> 0
       )
    THEN
        RAISE EXCEPTION
          'OPENAI_SNAPSHOT_COUNT_STATUS_MISMATCH';
    END IF;

    -- Normalizacao rigorosa das linhas.
    -- Sem conversao cambial ou arredondamento.

    FOR v_raw_line IN
        SELECT value
        FROM pg_catalog.jsonb_array_elements(p_lines)
    LOOP

        IF pg_catalog.jsonb_typeof(v_raw_line)
           IS DISTINCT FROM 'object'
        THEN
            RAISE EXCEPTION
              'OPENAI_SNAPSHOT_INVALID_LINE_OBJECT';
        END IF;

        SELECT count(*)
        INTO v_key_count
        FROM pg_catalog.jsonb_object_keys(v_raw_line);

        IF v_key_count <> 18
           OR NOT (
             v_raw_line ?& ARRAY[
               'provider_line_identity',
               'provider_version_fingerprint',
               'provider_page',
               'provider_result_index',
               'period_start',
               'period_end',
               'currency',
               'amount_numeric',
               'amount_decimal_text',
               'project_id',
               'user_id',
               'line_item',
               'api_key_id',
               'api_source',
               'quantity',
               'quantity_unit',
               'provider_bucket_object',
               'provider_result_object'
             ]
           )
        THEN
            RAISE EXCEPTION
              'OPENAI_SNAPSHOT_INVALID_LINE_FIELDS';
        END IF;

        SELECT *
        INTO v_line
        FROM pg_catalog.jsonb_to_record(v_raw_line)
        AS l(
            provider_line_identity text,
            provider_version_fingerprint text,
            provider_page integer,
            provider_result_index integer,
            period_start timestamptz,
            period_end timestamptz,
            currency text,
            amount_numeric text,
            amount_decimal_text text,
            project_id text,
            user_id text,
            line_item text,
            api_key_id text,
            api_source text,
            quantity text,
            quantity_unit text,
            provider_bucket_object text,
            provider_result_object text
        );

        IF v_line.provider_line_identity IS NULL
           OR pg_catalog.length(
                v_line.provider_line_identity
              ) = 0
           OR v_line.provider_version_fingerprint IS NULL
           OR pg_catalog.length(
                v_line.provider_version_fingerprint
              ) = 0
           OR v_line.provider_page IS NULL
           OR v_line.provider_page < 0
           OR v_line.provider_result_index IS NULL
           OR v_line.provider_result_index < 0
           OR v_line.period_start IS NULL
           OR v_line.period_end IS NULL
           OR v_line.period_end <= v_line.period_start
           OR v_line.period_start < v_collection.period_start
           OR v_line.period_end > v_collection.period_end
           OR v_line.currency !~ '^[A-Z]{3}$'
           OR v_line.currency IS NULL
           OR v_line.amount_numeric IS NULL
           OR v_line.amount_decimal_text IS NULL
           OR v_line.amount_numeric !~
              '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'
           OR v_line.amount_decimal_text !~
              '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'
           OR v_line.amount_numeric::numeric
              IS DISTINCT FROM
              v_line.amount_decimal_text::numeric
           OR (
                v_line.quantity IS NOT NULL
                AND v_line.quantity !~
                  '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'
              )
           OR v_line.provider_bucket_object IS DISTINCT FROM
              'bucket'
           OR v_line.provider_result_object IS DISTINCT FROM
              'organization.costs.result'
           OR v_raw_line ->> 'period_start' !~ 'Z$'
           OR v_raw_line ->> 'period_end' !~ 'Z$'
        THEN
            RAISE EXCEPTION
              'OPENAI_SNAPSHOT_INVALID_LINE';
        END IF;

        v_parsed_line.provider_line_identity :=
            v_line.provider_line_identity;

        v_parsed_line.provider_version_fingerprint :=
            v_line.provider_version_fingerprint;

        v_parsed_line.provider_page :=
            v_line.provider_page;

        v_parsed_line.provider_result_index :=
            v_line.provider_result_index;

        v_parsed_line.period_start :=
            v_line.period_start;

        v_parsed_line.period_end :=
            v_line.period_end;

        v_parsed_line.currency :=
            v_line.currency;

        v_parsed_line.amount_numeric :=
            v_line.amount_numeric::numeric;

        v_parsed_line.amount_decimal_text :=
            v_line.amount_decimal_text;

        v_parsed_line.project_id :=
            v_line.project_id;

        v_parsed_line.user_id :=
            v_line.user_id;

        v_parsed_line.line_item :=
            v_line.line_item;

        v_parsed_line.api_key_id :=
            v_line.api_key_id;

        v_parsed_line.api_source :=
            v_line.api_source;

        v_parsed_line.quantity :=
            v_line.quantity::numeric;

        v_parsed_line.quantity_unit :=
            v_line.quantity_unit;

        v_parsed_line.provider_bucket_object :=
            v_line.provider_bucket_object;

        v_parsed_line.provider_result_object :=
            v_line.provider_result_object;

        v_input_lines := v_input_lines ||
          pg_catalog.jsonb_build_array(
            pg_catalog.to_jsonb(v_parsed_line)
              - 'id'
              - 'collection_id'
              - 'created_at'
          );

        v_line_count := v_line_count + 1;

    END LOOP;

    -- Canonicalizacao do cabecalho.
    -- collected_at e excluido apenas da
    -- comparacao de replay.

    v_input_header :=
      pg_catalog.jsonb_build_object(
        'collection_key', v_collection.collection_key,
        'provider', v_collection.provider,
        'source', v_collection.source,
        'query_identity', v_collection.query_identity,
        'period_start', v_collection.period_start,
        'period_end', v_collection.period_end,
        'provider_timezone',
            v_collection.provider_timezone,
        'status', v_collection.status,
        'result_count', v_collection.result_count,
        'query_parameters', v_collection.query_parameters,
        'error_code', v_collection.error_code
      );

    -- Ordenar linhas para comparar conjuntos
    -- sem depender da ordem do array recebido.

    SELECT pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        value
        ORDER BY
          (value ->> 'provider_page')::integer,
          (value ->> 'provider_result_index')::integer
      ),
      '[]'::jsonb
    )
    INTO v_sorted_input
    FROM pg_catalog.jsonb_array_elements(
      v_input_lines
    );

    -- Serializar escritores da mesma chave.

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(
        'zion_admin_openai_cost_snapshot'
      ),
      pg_catalog.hashtext(
        v_collection.collection_key
      )
    );

    -- Replay de operacao ja registrada.

    SELECT *
    INTO v_existing
    FROM public.zion_admin_provider_cost_collections
    WHERE collection_key = v_collection.collection_key;

    IF FOUND THEN

        IF (
          pg_catalog.to_jsonb(v_existing)
            - 'id'
            - 'collected_at'
        ) IS DISTINCT FROM v_input_header
        THEN
            RAISE EXCEPTION
              'OPENAI_SNAPSHOT_IDEMPOTENCY_CONFLICT';
        END IF;

        SELECT pg_catalog.coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(l)
              - 'id'
              - 'collection_id'
              - 'created_at'
            ORDER BY
              l.provider_page,
              l.provider_result_index
          ),
          '[]'::jsonb
        )
        INTO v_existing_lines
        FROM public.zion_admin_provider_cost_lines l
        WHERE l.collection_id = v_existing.id;

        IF v_existing_lines IS DISTINCT FROM v_sorted_input
        THEN
            RAISE EXCEPTION
              'OPENAI_SNAPSHOT_IDEMPOTENCY_CONFLICT';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
          'outcome', 'replayed',
          'collection_id', v_existing.id,
          'collection_key', v_existing.collection_key,
          'status', v_existing.status,
          'line_count', v_line_count
        );

    END IF;

    -- Insercao atomica do cabecalho.

    INSERT INTO
      public.zion_admin_provider_cost_collections (
        collection_key,
        provider,
        source,
        query_identity,
        period_start,
        period_end,
        provider_timezone,
        status,
        result_count,
        query_parameters,
        error_code,
        collected_at
      )
    VALUES (
        v_collection.collection_key,
        v_collection.provider,
        v_collection.source,
        v_collection.query_identity,
        v_collection.period_start,
        v_collection.period_end,
        v_collection.provider_timezone,
        v_collection.status,
        v_collection.result_count,
        v_collection.query_parameters,
        v_collection.error_code,
        v_collection.collected_at
    )
    RETURNING id INTO v_collection_id;

    -- Todas as linhas sao inseridas dentro
    -- da mesma transacao.

    INSERT INTO public.zion_admin_provider_cost_lines (
      collection_id,
      provider_line_identity,
      provider_version_fingerprint,
      provider_page,
      provider_result_index,
      period_start,
      period_end,
      currency,
      amount_numeric,
      amount_decimal_text,
      project_id,
      user_id,
      line_item,
      api_key_id,
      api_source,
      quantity,
      quantity_unit,
      provider_bucket_object,
      provider_result_object
    )
    SELECT
      v_collection_id,
      l.provider_line_identity,
      l.provider_version_fingerprint,
      l.provider_page,
      l.provider_result_index,
      l.period_start,
      l.period_end,
      l.currency,
      l.amount_numeric,
      l.amount_decimal_text,
      l.project_id,
      l.user_id,
      l.line_item,
      l.api_key_id,
      l.api_source,
      l.quantity,
      l.quantity_unit,
      l.provider_bucket_object,
      l.provider_result_object
    FROM pg_catalog.jsonb_to_recordset(
      v_input_lines
    ) AS l(
      provider_line_identity text,
      provider_version_fingerprint text,
      provider_page integer,
      provider_result_index integer,
      period_start timestamptz,
      period_end timestamptz,
      currency text,
      amount_numeric numeric,
      amount_decimal_text text,
      project_id text,
      user_id text,
      line_item text,
      api_key_id text,
      api_source text,
      quantity numeric,
      quantity_unit text,
      provider_bucket_object text,
      provider_result_object text
    );

    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'inserted',
      'collection_id', v_collection_id,
      'collection_key', v_collection.collection_key,
      'status', v_collection.status,
      'line_count', v_line_count
    );
END;
$function$;

-- Nao permitir chamada pelo navegador
-- ou por usuarios autenticados comuns.

REVOKE ALL ON FUNCTION
public.zion_admin_write_openai_provider_cost_snapshot(
  jsonb, jsonb
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_write_openai_provider_cost_snapshot(
  jsonb, jsonb
)
TO service_role;

COMMIT;
