-- ZION-ADM | BLOCO 1 | 2.3-C.1-B.8-D.6
-- Writer autorizado de evidencias PTAX.
--
-- Nao consulta o Banco Central.
-- Nao comprova sozinho a origem HTTPS da resposta.
-- Nao cria cron nem habilita fechamento definitivo.
-- Nao altera evidencias existentes.

BEGIN;

CREATE FUNCTION
public.zion_admin_register_ptax_collection_evidence_by_system(
    p_evidence jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_key text;
    v_source text;
    v_from date;
    v_to date;
    v_started timestamptz;
    v_finished timestamptz;
    v_url text;
    v_expected_url text;
    v_payload jsonb;
    v_count integer;
    v_key_count integer;

    v_row jsonb;
    v_rate text;
    v_timestamp text;
    v_quote_date date;

    v_existing
        public.zion_admin_ptax_collection_evidence%ROWTYPE;

    v_id uuid;
BEGIN
    -- 1. Contrato exato do envelope.

    IF p_evidence IS NULL
       OR pg_catalog.jsonb_typeof(p_evidence)
          IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_ENVELOPE';
    END IF;

    SELECT count(*)
    INTO v_key_count
    FROM pg_catalog.jsonb_object_keys(p_evidence) AS k;

    IF v_key_count <> 9
       OR NOT (
           p_evidence ?& ARRAY[
               'collectionKey',
               'source',
               'requestedFrom',
               'requestedTo',
               'requestStartedAt',
               'requestFinishedAt',
               'endpointUrl',
               'responsePayload',
               'resultCount'
           ]
       )
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_FIELDS';
    END IF;

    IF pg_catalog.jsonb_typeof(p_evidence -> 'collectionKey')
           IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'source')
           IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'requestedFrom')
           IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'requestedTo')
           IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'requestStartedAt')
           IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'requestFinishedAt')
           IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'endpointUrl')
           IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'resultCount')
           IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(p_evidence -> 'responsePayload')
           IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_TYPES';
    END IF;

    v_key := p_evidence ->> 'collectionKey';
    v_source := p_evidence ->> 'source';

    IF v_key !~ '^bcb_ptax_venda:v1:[A-Za-z0-9_-]{16,128}$'
       OR v_source IS DISTINCT FROM 'bcb_ptax_venda'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_IDENTITY';
    END IF;

    -- 2. Datas e periodo solicitado.

    IF (p_evidence ->> 'requestedFrom')
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR (p_evidence ->> 'requestedTo')
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_DATES';
    END IF;

    v_from := (p_evidence ->> 'requestedFrom')::date;
    v_to := (p_evidence ->> 'requestedTo')::date;

    IF pg_catalog.to_char(v_from, 'YYYY-MM-DD')
           IS DISTINCT FROM p_evidence ->> 'requestedFrom'
       OR pg_catalog.to_char(v_to, 'YYYY-MM-DD')
           IS DISTINCT FROM p_evidence ->> 'requestedTo'
       OR v_from > v_to
       OR v_to - v_from > 365
       OR v_from < DATE '2020-01-01'
       OR v_to > DATE '2100-12-31'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_PERIOD';
    END IF;

    -- 3. Horarios da requisicao.

    IF (p_evidence ->> 'requestStartedAt')
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
       OR (p_evidence ->> 'requestFinishedAt')
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_TIMESTAMPS';
    END IF;

    v_started :=
        (p_evidence ->> 'requestStartedAt')::timestamptz;

    v_finished :=
        (p_evidence ->> 'requestFinishedAt')::timestamptz;

    IF v_finished < v_started
       OR v_finished - v_started > INTERVAL '1 minute'
       OR v_finished > pg_catalog.clock_timestamp()
                       + INTERVAL '5 minutes'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_REQUEST_TIME';
    END IF;

    -- 4. Conferir a URL canonica gerada pelo leitor PTAX.

    v_url := p_evidence ->> 'endpointUrl';

    v_expected_url :=
        'https://olinda.bcb.gov.br/olinda/servico/PTAX/'
        || 'versao/v1/odata/CotacaoDolarPeriodo'
        || '(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?'
        || '%40dataInicial=%27'
        || pg_catalog.to_char(v_from - 10, 'MM-DD-YYYY')
        || '%27&%40dataFinalCotacao=%27'
        || pg_catalog.to_char(v_to, 'MM-DD-YYYY')
        || '%27&%24top=1500'
        || '&%24select=cotacaoVenda%2CdataHoraCotacao'
        || '&%24format=json';

    IF v_url IS DISTINCT FROM v_expected_url THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_ENDPOINT_MISMATCH';
    END IF;

    -- 5. Validar a resposta e cada cotacao.

    v_payload := p_evidence -> 'responsePayload';

    IF pg_catalog.jsonb_typeof(v_payload -> 'value')
           IS DISTINCT FROM 'array'
       OR (p_evidence ->> 'resultCount')
           !~ '^(0|[1-9][0-9]{0,3})$'
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_RESPONSE';
    END IF;

    v_count := (p_evidence ->> 'resultCount')::integer;

    IF v_count >= 1500
       OR pg_catalog.jsonb_array_length(v_payload -> 'value')
          <> v_count
    THEN
        RAISE EXCEPTION 'PTAX_EVIDENCE_COUNT_MISMATCH';
    END IF;

    FOR v_row IN
        SELECT item.value
        FROM pg_catalog.jsonb_array_elements(
            v_payload -> 'value'
        ) AS item(value)
    LOOP
        IF pg_catalog.jsonb_typeof(v_row)
               IS DISTINCT FROM 'object'
           OR (
               pg_catalog.jsonb_typeof(v_row -> 'cotacaoVenda')
                   IS DISTINCT FROM 'number'
               AND pg_catalog.jsonb_typeof(v_row -> 'cotacaoVenda')
                   IS DISTINCT FROM 'string'
           )
           OR pg_catalog.jsonb_typeof(v_row -> 'dataHoraCotacao')
               IS DISTINCT FROM 'string'
        THEN
            RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_QUOTATION';
        END IF;

        v_rate := v_row ->> 'cotacaoVenda';
        v_timestamp := v_row ->> 'dataHoraCotacao';

        IF pg_catalog.length(v_rate) > 32
           OR v_rate !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
           OR pg_catalog.length(v_timestamp) > 40
           OR v_timestamp !~
              '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[ T]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?$'
        THEN
            RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_QUOTATION';
        END IF;

        IF v_rate::numeric <= 0
           OR v_rate::numeric >= 1000
        THEN
            RAISE EXCEPTION 'PTAX_EVIDENCE_INVALID_RATE';
        END IF;

        v_quote_date := pg_catalog.left(
            v_timestamp, 10
        )::date;

        IF pg_catalog.to_char(v_quote_date, 'YYYY-MM-DD')
              IS DISTINCT FROM pg_catalog.left(v_timestamp, 10)
           OR v_quote_date < v_from - 10
           OR v_quote_date > v_to
        THEN
            RAISE EXCEPTION 'PTAX_EVIDENCE_QUOTATION_OUT_OF_PERIOD';
        END IF;
    END LOOP;

    -- 6. Serializacao de gravacoes da mesma coleta.

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_ptax_evidence'),
        pg_catalog.hashtext(v_key)
    );

    SELECT *
    INTO v_existing
    FROM public.zion_admin_ptax_collection_evidence
    WHERE collection_key = v_key;

    -- 7. Reenvio identico ou conflito.

    IF FOUND THEN
        IF v_existing.source IS DISTINCT FROM v_source
           OR v_existing.requested_from IS DISTINCT FROM v_from
           OR v_existing.requested_to IS DISTINCT FROM v_to
           OR v_existing.request_started_at IS DISTINCT FROM v_started
           OR v_existing.request_finished_at IS DISTINCT FROM v_finished
           OR v_existing.endpoint_url IS DISTINCT FROM v_url
           OR v_existing.response_payload IS DISTINCT FROM v_payload
           OR v_existing.result_count IS DISTINCT FROM v_count
        THEN
            RAISE EXCEPTION 'PTAX_EVIDENCE_IDEMPOTENCY_CONFLICT';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'replayed',
            'collection_id', v_existing.id,
            'collection_key', v_existing.collection_key,
            'result_count', v_existing.result_count
        );
    END IF;

    -- 8. Inserir uma unica vez.
    -- A tabela continua sem INSERT direto para service_role.

    INSERT INTO public.zion_admin_ptax_collection_evidence (
        collection_key,
        source,
        requested_from,
        requested_to,
        request_started_at,
        request_finished_at,
        endpoint_url,
        response_payload,
        result_count
    )
    VALUES (
        v_key,
        v_source,
        v_from,
        v_to,
        v_started,
        v_finished,
        v_url,
        v_payload,
        v_count
    )
    RETURNING id INTO v_id;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'inserted',
        'collection_id', v_id,
        'collection_key', v_key,
        'result_count', v_count
    );
END;
$function$;

REVOKE ALL ON FUNCTION
public.zion_admin_register_ptax_collection_evidence_by_system(jsonb)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.zion_admin_register_ptax_collection_evidence_by_system(jsonb)
TO service_role;

COMMENT ON FUNCTION
public.zion_admin_register_ptax_collection_evidence_by_system(jsonb)
IS
    'Writer append-only de evidencias PTAX. '
    'Requer backend autorizado e verificacao independente da origem. '
    'Nao habilita fechamento financeiro definitivo.';

COMMIT;