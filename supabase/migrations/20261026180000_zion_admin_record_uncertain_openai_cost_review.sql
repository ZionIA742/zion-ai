-- ZION-ADM 8-C.4-B.6-C
-- Registro auditavel de revisao de operacoes uncertain.
-- Migration:
-- 20261026180000_zion_admin_record_uncertain_openai_cost_review.sql
--
-- Nao altera estados de operacoes.
-- Nao vincula snapshots.
-- Nao confirma despesas.
-- Nao autoriza retries.
-- Nao ativa cron.
-- Preserva o RLS e o trigger de imutabilidade.

BEGIN;

-- 1. Ampliar a auditoria existente.
-- Campos opcionais para nao afetar eventos anteriores.

ALTER TABLE
  public.zion_admin_openai_cost_collection_operation_events

ADD COLUMN review_key text,
ADD COLUMN review_finding text,
ADD COLUMN review_reason text,
ADD COLUMN review_evidence jsonb;

-- 2. Garantir que apenas eventos de revisao
-- possam utilizar os novos campos.
--
-- A revisao deve manter uncertain -> uncertain.
-- Nao pode criar vinculo financeiro.

ALTER TABLE
  public.zion_admin_openai_cost_collection_operation_events

ADD CONSTRAINT zaoccoe_manual_review_fields_check

CHECK (
    (
        event_kind <> 'manual_uncertain_review'
        AND review_key IS NULL
        AND review_finding IS NULL
        AND review_reason IS NULL
        AND review_evidence IS NULL
    )
    OR
    (
        event_kind = 'manual_uncertain_review'

        AND review_key IS NOT NULL
        AND pg_catalog.length(
            pg_catalog.btrim(review_key)
        ) BETWEEN 1 AND 128

        AND review_finding IS NOT NULL
        AND review_finding IN (
            'insufficient_evidence',
            'matching_candidates_observed',
            'external_confirmation_required',
            'no_financial_effect_observed'
        )

        AND review_reason IS NOT NULL
        AND pg_catalog.length(
            pg_catalog.btrim(review_reason)
        ) BETWEEN 12 AND 2000

        AND review_evidence IS NOT NULL
        AND pg_catalog.jsonb_typeof(
            review_evidence
        ) = 'object'
        AND review_evidence <> '{}'::jsonb
        AND pg_catalog.octet_length(
            review_evidence::text
        ) <= 16384

        AND from_state = 'uncertain'
        AND to_state = 'uncertain'

        AND snapshot_collection_id IS NULL
        AND error_code IS NULL
    )
);

-- 3. Identidade estavel por operacao e revisao.
-- Impede duplicacao da mesma revisao.

CREATE UNIQUE INDEX
zaoccoe_manual_review_operation_key_uq

ON
  public.zion_admin_openai_cost_collection_operation_events (
      operation_id,
      review_key
  )

WHERE event_kind = 'manual_uncertain_review';

-- 4. RPC de registro auditavel.
-- Exclusivamente para chamadas server-side autorizadas.
--
-- A autorizacao do administrador devera ser
-- verificada no backend antes da chamada.
--
-- Esta RPC registra evidencias.
-- Nao executa uma decisao financeira.

CREATE FUNCTION
public.zion_admin_record_uncertain_openai_cost_review_by_system(
    p_operation_id uuid,
    p_review_key text,
    p_review_finding text,
    p_review_reason text,
    p_review_evidence jsonb,
    p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_operation record;
    v_existing record;

    v_event_id uuid;
    v_now timestamptz;
BEGIN

    -- 5. Validar entradas obrigatorias.

    IF p_operation_id IS NULL
       OR p_review_key IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_review_key)
          ) NOT BETWEEN 1 AND 128
       OR p_review_key IS DISTINCT FROM
          pg_catalog.btrim(p_review_key)

       OR p_review_finding IS NULL
       OR p_review_finding NOT IN (
          'insufficient_evidence',
          'matching_candidates_observed',
          'external_confirmation_required',
          'no_financial_effect_observed'
       )

       OR p_review_reason IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_review_reason)
          ) NOT BETWEEN 12 AND 2000
       OR p_review_reason IS DISTINCT FROM
          pg_catalog.btrim(p_review_reason)

       OR p_review_evidence IS NULL
       OR pg_catalog.jsonb_typeof(
            p_review_evidence
          ) IS DISTINCT FROM 'object'
       OR p_review_evidence = '{}'::jsonb
       OR pg_catalog.octet_length(
            p_review_evidence::text
          ) > 16384

       OR p_actor IS NULL
       OR pg_catalog.length(
            pg_catalog.btrim(p_actor)
          ) NOT BETWEEN 1 AND 128
       OR p_actor IS DISTINCT FROM
          pg_catalog.btrim(p_actor)
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_REVIEW_INVALID_REQUEST';
    END IF;

    -- 6. Bloqueio atomico da operacao.
    -- Apenas uncertain sem claim e sem confirmacao.

    SELECT
        o.id,
        o.operation_key,
        o.state,
        o.attempt_count,
        o.snapshot_collection_id,
        o.confirmed_at,
        o.claim_token,
        o.claim_expires_at,
        o.claimed_by

    INTO v_operation

    FROM
      public.zion_admin_openai_cost_collection_operations o

    WHERE o.id = p_operation_id

    FOR UPDATE OF o;

    IF NOT FOUND
       OR v_operation.state IS DISTINCT FROM 'uncertain'
       OR v_operation.snapshot_collection_id IS NOT NULL
       OR v_operation.confirmed_at IS NOT NULL
       OR v_operation.claim_token IS NOT NULL
       OR v_operation.claim_expires_at IS NOT NULL
       OR v_operation.claimed_by IS NOT NULL
    THEN
        RAISE EXCEPTION
          'OPENAI_COST_REVIEW_OPERATION_NOT_UNCERTAIN';
    END IF;

    -- 7. Replay idempotente.
    --
    -- Mesma chave + mesmos dados:
    -- devolver evento ja registrado.
    --
    -- Mesma chave + dados diferentes:
    -- rejeitar conflito.

    SELECT
        e.id,
        e.review_finding,
        e.review_reason,
        e.review_evidence,
        e.technical_actor,
        e.attempt_count

    INTO v_existing

    FROM
      public.zion_admin_openai_cost_collection_operation_events e

    WHERE e.operation_id = p_operation_id
      AND e.event_kind = 'manual_uncertain_review'
      AND e.review_key = p_review_key;

    IF FOUND THEN

        IF v_existing.review_finding
             IS DISTINCT FROM p_review_finding
           OR v_existing.review_reason
             IS DISTINCT FROM p_review_reason
           OR v_existing.review_evidence
             IS DISTINCT FROM p_review_evidence
           OR v_existing.technical_actor
             IS DISTINCT FROM p_actor
        THEN
            RAISE EXCEPTION
              'OPENAI_COST_REVIEW_IDEMPOTENCY_CONFLICT';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'review_already_recorded',
            'operation_id', p_operation_id,
            'review_event_id', v_existing.id,
            'idempotent_replay', true,
            'state', 'uncertain',
            'operation_modified', false,
            'snapshot_modified', false,
            'financial_confirmation_performed', false,
            'retry_authorized', false,
            'retry_scheduled', false
        );

    END IF;

    -- 8. Inserir somente um novo evento imutavel.
    --
    -- Nao existe UPDATE na operacao.
    -- Nao existe escrita nos snapshots.
    -- Nenhuma transicao de estado ocorre.

    v_now := pg_catalog.clock_timestamp();

    INSERT INTO
      public.zion_admin_openai_cost_collection_operation_events (
          operation_id,
          event_kind,
          from_state,
          to_state,
          attempt_count,
          occurred_at,
          error_code,
          snapshot_collection_id,
          technical_actor,
          review_key,
          review_finding,
          review_reason,
          review_evidence
      )

    VALUES (
        v_operation.id,
        'manual_uncertain_review',
        'uncertain',
        'uncertain',
        v_operation.attempt_count,
        v_now,
        NULL,
        NULL,
        p_actor,
        p_review_key,
        p_review_finding,
        p_review_reason,
        p_review_evidence
    )

    RETURNING id
    INTO v_event_id;

    -- 9. Retorno sem interpretacao financeira.

    RETURN pg_catalog.jsonb_build_object(
        'outcome', 'review_recorded',
        'operation_id', v_operation.id,
        'review_event_id', v_event_id,
        'idempotent_replay', false,
        'state', 'uncertain',
        'review_finding', p_review_finding,
        'operation_modified', false,
        'snapshot_modified', false,
        'financial_confirmation_performed', false,
        'retry_authorized', false,
        'retry_scheduled', false,
        'resolution', 'requires_manual_reconciliation'
    );

END;
$function$;

-- 10. Nao conceder permissao direta sobre eventos.
-- Exposicao somente pela RPC server-side.

REVOKE ALL ON FUNCTION
public.zion_admin_record_uncertain_openai_cost_review_by_system(
    uuid, text, text, text, jsonb, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_record_uncertain_openai_cost_review_by_system(
    uuid, text, text, text, jsonb, text
)
TO service_role;

COMMIT;

-- 11. Diagnostico de instalacao.
-- SOMENTE LEITURA.
-- Nao executar a RPC neste momento.

WITH rpc AS (
    SELECT
        p.oid,
        p.prosecdef,
        p.proconfig

    FROM pg_catalog.pg_proc p

    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.zion_admin_record_uncertain_openai_cost_review_by_system(uuid,text,text,text,jsonb,text)'
    )
),
checks AS (

    SELECT
        '01_rpc_existe' AS verificacao,
        EXISTS (SELECT 1 FROM rpc) AS passou

    UNION ALL

    SELECT
        '02_security_definer',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE prosecdef
        )

    UNION ALL

    SELECT
        '03_search_path_restrito',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE 'search_path=""' = ANY(proconfig)
        )

    UNION ALL

    SELECT
        '04_service_role_autorizado',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE pg_catalog.has_function_privilege(
                'service_role', oid, 'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '05_anon_bloqueado',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE NOT pg_catalog.has_function_privilege(
                'anon', oid, 'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '06_authenticated_bloqueado',
        EXISTS (
            SELECT 1 FROM rpc
            WHERE NOT pg_catalog.has_function_privilege(
                'authenticated', oid, 'EXECUTE'
            )
        )

    UNION ALL

    SELECT
        '07_campos_revisao',
        (
            SELECT count(*) = 4
            FROM pg_catalog.pg_attribute a
            WHERE a.attrelid =
              'public.zion_admin_openai_cost_collection_operation_events'::regclass
              AND a.attname IN (
                  'review_key',
                  'review_finding',
                  'review_reason',
                  'review_evidence'
              )
              AND NOT a.attisdropped
        )

    UNION ALL

    SELECT
        '08_constraint_revisao',
        EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint c
            WHERE c.conrelid =
              'public.zion_admin_openai_cost_collection_operation_events'::regclass
              AND c.conname =
              'zaoccoe_manual_review_fields_check'
        )

    UNION ALL

    SELECT
        '09_indice_idempotencia',
        EXISTS (
            SELECT 1
            FROM pg_catalog.pg_indexes
            WHERE schemaname = 'public'
              AND tablename =
              'zion_admin_openai_cost_collection_operation_events'
              AND indexname =
              'zaoccoe_manual_review_operation_key_uq'
        )

    UNION ALL

    SELECT
        '10_trigger_imutavel',
        EXISTS (
            SELECT 1
            FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid =
              'public.zion_admin_openai_cost_collection_operation_events'::regclass
              AND t.tgname = 'zaoccoe_immutable'
              AND t.tgenabled = 'O'
        )

    UNION ALL

    SELECT
        '11_rls_preservado',
        EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class c
            WHERE c.oid =
              'public.zion_admin_openai_cost_collection_operation_events'::regclass
              AND c.relrowsecurity
        )

    UNION ALL

    SELECT
        '12_sem_policies',
        NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policies p
            WHERE p.schemaname = 'public'
              AND p.tablename =
              'zion_admin_openai_cost_collection_operation_events'
        )

    UNION ALL

    SELECT
        '13_insert_direto_bloqueado',
        NOT pg_catalog.has_table_privilege(
            'service_role',
            'public.zion_admin_openai_cost_collection_operation_events',
            'INSERT'
        )

    UNION ALL

    SELECT
        '14_operacoes_preservadas',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operations
        )

    UNION ALL

    SELECT
        '15_eventos_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_openai_cost_collection_operation_events
        )

    UNION ALL

    SELECT
        '16_snapshots_openai_preservados',
        NOT EXISTS (
            SELECT 1
            FROM public.zion_admin_provider_cost_collections
            WHERE provider = 'openai'
              AND source = 'openai_organization_costs'
        )
)

SELECT
    verificacao,
    CASE
        WHEN passou THEN 'PASS'
        ELSE 'FAIL'
    END AS resultado
FROM checks
ORDER BY verificacao;
