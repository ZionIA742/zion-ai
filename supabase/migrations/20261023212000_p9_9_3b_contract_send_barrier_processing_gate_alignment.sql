-- ZION / Pilar 9 / Etapa 9.3-B
-- Align an already-installed internal activation function with the transport gate.
-- The sender claims a message as `processing` before the pre-Meta gate runs.
-- An outbound `pending` message must NOT create an enduring barrier: it can sit
-- queued for an extended period, unintentionally blocking human operations.
-- No outbound queue, sender, messages, commercial records or barrier rows are changed.
-- Installation does not execute the activation function or enable outbound sending.
-- Forward-only; requires the exact version previously installed in production.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'
  );
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_FUNCTION_MISSING';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid)) INTO v_hash;
  IF v_hash IS DISTINCT FROM '2073747dafe87cc4499cf6a6a0ad3dc5' THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_FUNCTION_CHANGED: %', v_hash;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_DEPENDENCY_MISSING';
  END IF;
  IF pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid='public.p9_sales_contract_send_barriers'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_BARRIER_RLS_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_EXISTING_BARRIER_REQUIRES_REVIEW';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=v_oid AND prosecdef AND proowner='postgres'::regrole
  ) OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_FUNCTION_SECURITY_INVALID';
  END IF;
END;
$preflight$;

-- Exact replacement of the prior function. The only behavioral change is
-- accepting `processing` (claimed, not attempted) instead of `pending`.
-- All identity, current-proposal, approval, PDF, lock and replay checks remain.

CREATE OR REPLACE FUNCTION
public.p9_activate_sales_contract_send_barrier_internal(
    p_organization_id uuid,
    p_store_id uuid,
    p_commercial_opportunity_id uuid,
    p_contract_id uuid,
    p_contract_version_id uuid,
    p_message_id uuid,
    p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
    v_opportunity public.commercial_opportunities%ROWTYPE;
    v_contract public.sales_contracts%ROWTYPE;
    v_version public.sales_contract_versions%ROWTYPE;
    v_quote public.sales_quotes%ROWTYPE;
    v_message public.messages%ROWTYPE;
    v_existing public.p9_sales_contract_send_barriers%ROWTYPE;

    v_key text;
    v_expected_key text;
    v_guard_state text;
    v_barrier_id uuid;
BEGIN
    IF p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_commercial_opportunity_id IS NULL
       OR p_contract_id IS NULL
       OR p_contract_version_id IS NULL
       OR p_message_id IS NULL THEN
        RAISE EXCEPTION
            'P9_BARRIER_ACTIVATION_SCOPE_REQUIRED';
    END IF;

    v_key := nullif(
        pg_catalog.btrim(
            coalesce(p_idempotency_key, '')
        ),
        ''
    );

    v_expected_key :=
        'sales_contract_send:'
        || p_organization_id::text
        || ':' || p_store_id::text
        || ':' || p_contract_id::text
        || ':' || p_contract_version_id::text;

    IF v_key IS DISTINCT FROM v_expected_key THEN
        RAISE EXCEPTION
            'P9_BARRIER_IDEMPOTENCY_KEY_INVALID';
    END IF;

    -- Primeira autoridade de lock desta funcao.
    PERFORM
        public.p9_acquire_sales_contract_send_domain_lock(
            p_organization_id,
            p_store_id,
            p_commercial_opportunity_id
        );

    -- Ordem relacional: oportunidade, contrato, versao,
    -- mensagem e finalmente barreira.

    SELECT *
    INTO v_opportunity
    FROM public.commercial_opportunities
    WHERE id = p_commercial_opportunity_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P9_BARRIER_OPPORTUNITY_INVALID';
    END IF;

    SELECT *
    INTO v_contract
    FROM public.sales_contracts
    WHERE id = p_contract_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P9_BARRIER_CONTRACT_INVALID';
    END IF;

    SELECT *
    INTO v_version
    FROM public.sales_contract_versions
    WHERE id = p_contract_version_id
      AND contract_id = p_contract_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P9_BARRIER_VERSION_INVALID';
    END IF;

    SELECT *
    INTO v_quote
    FROM public.sales_quotes
    WHERE id = v_contract.quote_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id =
          p_commercial_opportunity_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P9_BARRIER_QUOTE_SCOPE_INVALID';
    END IF;

    SELECT *
    INTO v_message
    FROM public.messages
    WHERE id = p_message_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'P9_BARRIER_MESSAGE_INVALID';
    END IF;

    -- Impedir ativacao para contrato nao aprovado,
    -- versao substituida ou proposta diferente.

    IF v_contract.status IS DISTINCT FROM 'approved'
       OR v_version.status IS DISTINCT FROM 'approved'
       OR v_contract.current_version_id
           IS DISTINCT FROM v_version.id
       OR v_opportunity.current_quote_id
           IS DISTINCT FROM v_contract.quote_id
       OR v_opportunity.current_quote_version_id
           IS DISTINCT FROM v_contract.quote_version_id
    THEN
        RAISE EXCEPTION
            'P9_BARRIER_CONTRACT_NOT_CURRENT_APPROVED';
    END IF;

    -- Validar identidade e estado do outbound.

    IF v_message.conversation_id
           IS DISTINCT FROM v_contract.conversation_id
       OR v_message.sender IS DISTINCT FROM 'human'
       OR v_message.direction IS DISTINCT FROM 'outgoing'
       OR v_message.message_type IS DISTINCT FROM 'document'
       OR v_message.media_url
           IS DISTINCT FROM v_version.storage_path
       OR v_message.outbound_delivery_state
           IS DISTINCT FROM 'processing'
       OR v_message.outbound_attempt_started_at IS NOT NULL
       OR v_message.external_message_id IS NOT NULL
       OR v_message.outbound_idempotency_key
           IS DISTINCT FROM v_key
       OR v_message.metadata->>'source'
           IS DISTINCT FROM 'sales_contract_send_route'
       OR v_message.metadata->>'outbound_origin'
           IS DISTINCT FROM 'sales_contract_send'
       OR v_message.metadata->>'contract_id'
           IS DISTINCT FROM v_contract.id::text
       OR v_message.metadata->>'sales_contract_id'
           IS DISTINCT FROM v_contract.id::text
       OR v_message.metadata->>'sales_contract_version_id'
           IS DISTINCT FROM v_version.id::text
       OR v_message.metadata->>'outbound_idempotency_key'
           IS DISTINCT FROM v_key
       OR v_message.metadata->>'file_kind'
           IS DISTINCT FROM 'sales_contract_pdf'
       OR v_message.metadata->>'storage_path'
           IS DISTINCT FROM v_version.storage_path
    THEN
        RAISE EXCEPTION
            'P9_BARRIER_MESSAGE_SCOPE_OR_STATE_INVALID';
    END IF;

    -- Contratos legados nao recebem autorizacao automatica
    -- do novo transporte.

    SELECT lineage.guard_state
    INTO v_guard_state
    FROM public.p9_assert_sales_contract_current_proposal_lineage_internal(
        p_organization_id,
        p_store_id,
        p_contract_id
    ) AS lineage;

    IF NOT FOUND
       OR v_guard_state IS DISTINCT FROM 'current' THEN
        RAISE EXCEPTION
            'P9_BARRIER_CURRENT_PROPOSAL_REQUIRED';
    END IF;

    -- Rejeitar tentativas conflitantes e reutilizacoes
    -- indevidas da identidade.

    SELECT *
    INTO v_existing
    FROM public.p9_sales_contract_send_barriers b
    WHERE b.organization_id = p_organization_id
      AND b.store_id = p_store_id
      AND (
          b.outbound_idempotency_key = v_key
          OR b.message_id = p_message_id
          OR b.sales_contract_id = p_contract_id
          OR (
              b.commercial_opportunity_id =
                  p_commercial_opportunity_id
              AND b.released_at IS NULL
          )
      )
    ORDER BY b.activated_at, b.id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.outbound_idempotency_key = v_key
           AND v_existing.message_id = p_message_id
           AND v_existing.sales_contract_id = p_contract_id
           AND v_existing.sales_contract_version_id =
               p_contract_version_id
           AND v_existing.commercial_opportunity_id =
               p_commercial_opportunity_id
           AND v_existing.released_at IS NULL
        THEN
            RETURN v_existing.id;
        END IF;

        RAISE EXCEPTION
            'P9_BARRIER_CONFLICT_OR_RELEASED_ATTEMPT';
    END IF;

    INSERT INTO public.p9_sales_contract_send_barriers (
        organization_id,
        store_id,
        sales_contract_id,
        sales_contract_version_id,
        sales_quote_id,
        sales_quote_version_id,
        commercial_opportunity_id,
        message_id,
        outbound_idempotency_key
    )
    VALUES (
        p_organization_id,
        p_store_id,
        v_contract.id,
        v_version.id,
        v_contract.quote_id,
        v_contract.quote_version_id,
        v_opportunity.id,
        v_message.id,
        v_key
    )
    RETURNING id INTO v_barrier_id;

    IF v_barrier_id IS NULL THEN
        RAISE EXCEPTION
            'P9_BARRIER_INSERT_FAILED';
    END IF;

    RETURN v_barrier_id;
END;
$function$;


ALTER FUNCTION public.p9_activate_sales_contract_send_barrier_internal(
  uuid,uuid,uuid,uuid,uuid,uuid,text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p9_activate_sales_contract_send_barrier_internal(
  uuid,uuid,uuid,uuid,uuid,uuid,text
) FROM PUBLIC, anon, authenticated, service_role;

DO $postconditions$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'
  );
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_POST_FUNCTION_MISSING';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF position('IS DISTINCT FROM ''processing''' IN v_definition)=0
     OR position('IS DISTINCT FROM ''pending''' IN v_definition)>0
     OR pg_catalog.md5(v_definition)='2073747dafe87cc4499cf6a6a0ad3dc5' THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_POST_STATE_NOT_ALIGNED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=v_oid AND prosecdef AND proowner='postgres'::regrole
  ) OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_POST_SECURITY_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) THEN
    RAISE EXCEPTION 'P9_ACTIVATION_GATE_POST_UNEXPECTED_BARRIER';
  END IF;
END;
$postconditions$;

COMMIT;

SELECT
  'PASS' AS resultado,
  'BARREIRA_ALINHADA_AO_GATE_PROCESSING' AS correcao,
  pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure
  )) AS hash_funcao,
  'NAO_HABILITADO' AS envio_externo;
