BEGIN;

-- ZION-ADM | 2.3-C.1-B.8-C
-- Fundacao para preservar coletas PTAX do BCB.
--
-- Esta estrutura nao comprova, isoladamente,
-- que a resposta foi obtida do Banco Central.
--
-- A futura rotina autorizada devera:
-- 1. Consultar diretamente o BCB.
-- 2. Validar integralmente a resposta.
-- 3. Registrar a coleta com rastreabilidade.
-- 4. Reconciliar as cotacoes antes do fechamento.
--
-- Nenhum writer financeiro e habilitado aqui.

CREATE TABLE public.zion_admin_ptax_collection_evidence (
    id uuid PRIMARY KEY
        DEFAULT pg_catalog.gen_random_uuid(),

    collection_key text NOT NULL UNIQUE,

    source text NOT NULL
        DEFAULT 'bcb_ptax_venda',

    requested_from date NOT NULL,
    requested_to date NOT NULL,

    request_started_at timestamptz NOT NULL,
    request_finished_at timestamptz NOT NULL,

    endpoint_url text NOT NULL,

    response_payload jsonb NOT NULL,
    result_count integer NOT NULL,

    recorded_at timestamptz NOT NULL
        DEFAULT pg_catalog.now(),

    CONSTRAINT zapce_collection_key_check
        CHECK (
            char_length(btrim(collection_key))
                BETWEEN 1 AND 200
        ),

    CONSTRAINT zapce_source_check
        CHECK (
            source = 'bcb_ptax_venda'
        ),

    CONSTRAINT zapce_period_check
        CHECK (
            requested_to >= requested_from
            AND requested_to - requested_from <= 376
        ),

    CONSTRAINT zapce_request_time_check
        CHECK (
            request_finished_at >= request_started_at
        ),

    CONSTRAINT zapce_endpoint_check
        CHECK (
            endpoint_url LIKE
              'https://olinda.bcb.gov.br/olinda/servico/PTAX/%'
            AND char_length(endpoint_url)
                BETWEEN 60 AND 2048
        ),

    CONSTRAINT zapce_response_check
        CHECK (
            pg_catalog.jsonb_typeof(response_payload)
                = 'object'
            AND pg_catalog.jsonb_typeof(
                response_payload -> 'value'
            ) = 'array'
            AND result_count >= 0
            AND result_count < 1500
            AND pg_catalog.jsonb_array_length(
                response_payload -> 'value'
            ) = result_count
        )
);

CREATE INDEX zapce_requested_period_idx
ON public.zion_admin_ptax_collection_evidence (
    requested_from,
    requested_to,
    recorded_at DESC
);

-- Preservar eventos ja registrados.
-- Nao permitir alteracao ou exclusao silenciosa.

CREATE FUNCTION public.zion_admin_ptax_evidence_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
    RAISE EXCEPTION
        'ZION_ADMIN_PTAX_EVIDENCE_IMMUTABLE';
END;
$function$;

CREATE TRIGGER zapce_immutable_guard
BEFORE UPDATE OR DELETE
ON public.zion_admin_ptax_collection_evidence
FOR EACH ROW
EXECUTE FUNCTION
    public.zion_admin_ptax_evidence_reject_mutation();

-- TRUNCATE nao dispara os gatilhos UPDATE/DELETE por linha.
-- Bloquear tambem a limpeza integral da tabela.

CREATE TRIGGER zapce_immutable_truncate_guard
BEFORE TRUNCATE
ON public.zion_admin_ptax_collection_evidence
FOR EACH STATEMENT
EXECUTE FUNCTION
    public.zion_admin_ptax_evidence_reject_mutation();

-- Nenhuma politica publica de escrita ou leitura.

ALTER TABLE
    public.zion_admin_ptax_collection_evidence
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_ptax_collection_evidence
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.zion_admin_ptax_collection_evidence
TO service_role;

REVOKE ALL ON FUNCTION
    public.zion_admin_ptax_evidence_reject_mutation()
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE
    public.zion_admin_ptax_collection_evidence
IS
    'Historico imutavel de respostas PTAX; '
    'proveniencia financeira exige coletor autorizado '
    'e validacao independente. Sem writer nesta etapa.';

COMMIT;