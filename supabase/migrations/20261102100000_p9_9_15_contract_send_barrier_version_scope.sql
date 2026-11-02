BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'P9_9_15_BARRIER_ACTIVATION_PRECONDITION_MISSING';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.p9_activate_sales_contract_send_barrier_internal(
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
        RAISE EXCEPTION 'P9_BARRIER_ACTIVATION_SCOPE_REQUIRED';
    END IF;

    v_key := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
    v_expected_key :=
        'sales_contract_send:' || p_organization_id::text
        || ':' || p_store_id::text
        || ':' || p_contract_id::text
        || ':' || p_contract_version_id::text;

    IF v_key IS DISTINCT FROM v_expected_key THEN
        RAISE EXCEPTION 'P9_BARRIER_IDEMPOTENCY_KEY_INVALID';
    END IF;

    PERFORM public.p9_acquire_sales_contract_send_domain_lock(
        p_organization_id, p_store_id, p_commercial_opportunity_id
    );

    SELECT * INTO v_contract
    FROM public.sales_contracts
    WHERE id = p_contract_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_CONTRACT_INVALID';
    END IF;

    SELECT * INTO v_version
    FROM public.sales_contract_versions
    WHERE id = p_contract_version_id
      AND contract_id = p_contract_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_VERSION_INVALID';
    END IF;

    SELECT * INTO v_opportunity
    FROM public.commercial_opportunities
    WHERE id = p_commercial_opportunity_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_OPPORTUNITY_INVALID';
    END IF;

    SELECT * INTO v_quote
    FROM public.sales_quotes
    WHERE id = v_contract.quote_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND commercial_opportunity_id = p_commercial_opportunity_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_QUOTE_SCOPE_INVALID';
    END IF;

    SELECT * INTO v_message
    FROM public.messages
    WHERE id = p_message_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id
      AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P9_BARRIER_MESSAGE_INVALID';
    END IF;

    IF v_contract.status IS DISTINCT FROM 'approved'
       OR v_version.status IS DISTINCT FROM 'approved'
       OR v_contract.current_version_id IS DISTINCT FROM v_version.id
       OR v_opportunity.current_quote_id IS DISTINCT FROM v_contract.quote_id
       OR v_opportunity.current_quote_version_id IS DISTINCT FROM v_contract.quote_version_id
    THEN
        RAISE EXCEPTION 'P9_BARRIER_CONTRACT_NOT_CURRENT_APPROVED';
    END IF;

    IF v_message.conversation_id IS DISTINCT FROM v_contract.conversation_id
       OR v_message.sender IS DISTINCT FROM 'human'
       OR v_message.direction IS DISTINCT FROM 'outgoing'
       OR v_message.message_type IS DISTINCT FROM 'document'
       OR v_message.media_url IS DISTINCT FROM v_version.storage_path
       OR v_message.outbound_delivery_state IS DISTINCT FROM 'processing'
       OR v_message.outbound_attempt_started_at IS NOT NULL
       OR v_message.external_message_id IS NOT NULL
       OR v_message.outbound_idempotency_key IS DISTINCT FROM v_key
       OR v_message.metadata->>'source' IS DISTINCT FROM 'sales_contract_send_route'
       OR v_message.metadata->>'outbound_origin' IS DISTINCT FROM 'sales_contract_send'
       OR v_message.metadata->>'contract_id' IS DISTINCT FROM v_contract.id::text
       OR v_message.metadata->>'sales_contract_id' IS DISTINCT FROM v_contract.id::text
       OR v_message.metadata->>'sales_contract_version_id' IS DISTINCT FROM v_version.id::text
       OR v_message.metadata->>'outbound_idempotency_key' IS DISTINCT FROM v_key
       OR v_message.metadata->>'file_kind' IS DISTINCT FROM 'sales_contract_pdf'
       OR v_message.metadata->>'storage_path' IS DISTINCT FROM v_version.storage_path
    THEN
        RAISE EXCEPTION 'P9_BARRIER_MESSAGE_SCOPE_OR_STATE_INVALID';
    END IF;

    SELECT lineage.guard_state INTO v_guard_state
    FROM public.p9_assert_sales_contract_current_proposal_lineage_internal(
        p_organization_id, p_store_id, p_contract_id
    ) AS lineage;
    IF NOT FOUND OR v_guard_state IS DISTINCT FROM 'current' THEN
        RAISE EXCEPTION 'P9_BARRIER_CURRENT_PROPOSAL_REQUIRED';
    END IF;

    SELECT * INTO v_existing
    FROM public.p9_sales_contract_send_barriers b
    WHERE b.organization_id = p_organization_id
      AND b.store_id = p_store_id
      AND (
          b.outbound_idempotency_key = v_key
          OR b.message_id = p_message_id
          OR (
              b.sales_contract_id = p_contract_id
              AND b.sales_contract_version_id = p_contract_version_id
          )
          OR (b.commercial_opportunity_id = p_commercial_opportunity_id
              AND b.released_at IS NULL)
      )
    ORDER BY b.activated_at, b.id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.outbound_idempotency_key = v_key
           AND v_existing.message_id = p_message_id
           AND v_existing.sales_contract_id = p_contract_id
           AND v_existing.sales_contract_version_id = p_contract_version_id
           AND v_existing.commercial_opportunity_id = p_commercial_opportunity_id
           AND v_existing.released_at IS NULL
        THEN
            RETURN v_existing.id;
        END IF;
        RAISE EXCEPTION 'P9_BARRIER_CONFLICT_OR_RELEASED_ATTEMPT';
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
    ) VALUES (
        p_organization_id,
        p_store_id,
        v_contract.id,
        v_version.id,
        v_contract.quote_id,
        v_contract.quote_version_id,
        v_opportunity.id,
        v_message.id,
        v_key
    ) RETURNING id INTO v_barrier_id;

    IF v_barrier_id IS NULL THEN
        RAISE EXCEPTION 'P9_BARRIER_INSERT_FAILED';
    END IF;
    RETURN v_barrier_id;
END;
$function$;

DO $postconditions$
DECLARE
  v_body text;
BEGIN
  v_body := pg_catalog.pg_get_functiondef(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure
  );
  IF pg_catalog.strpos(v_body, 'b.sales_contract_version_id = p_contract_version_id') = 0
     OR pg_catalog.strpos(v_body, 'b.released_at IS NULL') = 0
     OR pg_catalog.strpos(v_body, 'P9_BARRIER_CONFLICT_OR_RELEASED_ATTEMPT') = 0 THEN
    RAISE EXCEPTION 'P9_9_15_BARRIER_VERSION_SCOPE_POSTCONDITION_FAILED';
  END IF;
END;
$postconditions$;

COMMIT;
