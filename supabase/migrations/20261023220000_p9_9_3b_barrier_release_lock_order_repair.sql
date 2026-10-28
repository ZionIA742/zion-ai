-- ZION | Pilar 9 | Bloco 9 | 9.3-B
-- Forward-only reconciliation: finalized release must lock contract -> version
-- -> opportunity -> message -> barrier, like activation/approval.
-- The calling finalizer MUST acquire the opportunity domain advisory lock
-- before it obtains any relational row lock; this migration does not yet
-- install that finalizer or enable the WhatsApp contract-send origin.
-- No barrier rows or message states are modified by this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_release oid := pg_catalog.to_regprocedure(
    'public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)'
  );
  v_activation oid := pg_catalog.to_regprocedure(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'
  );
  v_guard oid := pg_catalog.to_regprocedure(
    'public.p9_guard_sales_contract_send_barrier_immutability()'
  );
BEGIN
  IF v_release IS NULL OR v_activation IS NULL OR v_guard IS NULL THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_DEPENDENCY_MISSING';
  END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_release)) IS DISTINCT FROM
    'ac719fa11b27d5dc992b31f44dcad857' THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_RELEASE_VERSION_CHANGED';
  END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_activation)) IS DISTINCT FROM
    'c11747791670ba1893b66bca9e36e20d' THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_ACTIVATION_VERSION_CHANGED';
  END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard)) IS DISTINCT FROM
    '855a4904d84e3f16a8efda4db776aac5' THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_GUARD_VERSION_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_EXISTING_BARRIERS_REQUIRE_REVIEW';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.messages
    WHERE metadata->>'outbound_origin' = 'sales_contract_send'
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_EXISTING_OUTBOUND_REQUIRE_REVIEW';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_release AND p.prosecdef AND p.proowner = 'postgres'::regrole
  ) OR pg_catalog.has_function_privilege('anon', v_release, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_release, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_release, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_SECURITY_CHANGED';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.p9_release_sales_contract_send_barrier_finalized_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
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
  v_barrier public.p9_sales_contract_send_barriers%ROWTYPE;
  v_locked public.p9_sales_contract_send_barriers%ROWTYPE;
  v_opportunity public.commercial_opportunities%ROWTYPE;
  v_contract public.sales_contracts%ROWTYPE;
  v_version public.sales_contract_versions%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_key text := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  v_evidence jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL
     OR p_message_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_SCOPE_REQUIRED';
  END IF;

  -- Identity discovery only: no row lock before the opportunity advisory lock.
  SELECT b.* INTO v_barrier
  FROM public.p9_sales_contract_send_barriers b
  WHERE b.organization_id = p_organization_id
    AND b.store_id = p_store_id
    AND b.sales_contract_id = p_contract_id
    AND b.message_id = p_message_id
    AND b.outbound_idempotency_key = v_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_MATCH_NOT_FOUND';
  END IF;
  IF v_key IS DISTINCT FROM
       'sales_contract_send:' || p_organization_id::text || ':' || p_store_id::text
       || ':' || p_contract_id::text || ':' || v_barrier.sales_contract_version_id::text THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_KEY_INVALID';
  END IF;

  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id, p_store_id, v_barrier.commercial_opportunity_id
  );

  -- Match approval, lineage and barrier activation relational order:
  -- contract -> version -> opportunity -> message -> barrier.
  -- The domain advisory lock above must be acquired by the calling
  -- finalizer BEFORE it takes any relational row locks.
  SELECT c.* INTO v_contract FROM public.sales_contracts c
  WHERE c.id = p_contract_id
    AND c.organization_id = p_organization_id AND c.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_CONTRACT_NOT_FOUND'; END IF;

  SELECT v.* INTO v_version FROM public.sales_contract_versions v
  WHERE v.id = v_barrier.sales_contract_version_id AND v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id AND v.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_VERSION_NOT_FOUND'; END IF;

  SELECT o.* INTO v_opportunity
  FROM public.commercial_opportunities o
  WHERE o.id = v_barrier.commercial_opportunity_id
    AND o.organization_id = p_organization_id AND o.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_OPPORTUNITY_NOT_FOUND'; END IF;

  SELECT m.* INTO v_message FROM public.messages m
  WHERE m.id = p_message_id
    AND m.organization_id = p_organization_id AND m.store_id = p_store_id
    AND m.deleted_at IS NULL AND m.outbound_idempotency_key = v_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_MESSAGE_NOT_FOUND'; END IF;

  SELECT b.* INTO v_locked FROM public.p9_sales_contract_send_barriers b
  WHERE b.id = v_barrier.id
    AND b.organization_id = p_organization_id AND b.store_id = p_store_id
    AND b.sales_contract_id = p_contract_id AND b.message_id = p_message_id
    AND b.outbound_idempotency_key = v_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_BARRIER_CHANGED'; END IF;

  IF v_locked.released_at IS NOT NULL THEN
    IF v_locked.release_reason = 'finalized' THEN
      RETURN v_locked.id; -- Idempotent finalized replay, no new external send.
    END IF;
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_ALREADY_RECONCILED_OTHER_REASON';
  END IF;

  IF v_contract.current_version_id IS DISTINCT FROM v_version.id
     OR v_contract.quote_id IS DISTINCT FROM v_locked.sales_quote_id
     OR v_contract.quote_version_id IS DISTINCT FROM v_locked.sales_quote_version_id
     OR v_opportunity.current_quote_id IS DISTINCT FROM v_locked.sales_quote_id
     OR v_opportunity.current_quote_version_id IS DISTINCT FROM v_locked.sales_quote_version_id
     OR v_contract.status IS DISTINCT FROM 'sent_to_customer'
     OR v_version.status IS DISTINCT FROM 'sent'
     OR v_message.outbound_delivery_state IS DISTINCT FROM 'sent'
     OR NULLIF(pg_catalog.btrim(COALESCE(v_message.external_message_id, '')), '') IS NULL
     OR v_message.outbound_provider_accepted_at IS NULL
     OR v_message.outbound_commercial_finalized_at IS NULL
     OR v_message.conversation_id IS DISTINCT FROM v_contract.conversation_id
     OR v_message.metadata->>'outbound_origin' IS DISTINCT FROM 'sales_contract_send'
     OR v_message.metadata->>'sales_contract_id' IS DISTINCT FROM p_contract_id::text
     OR v_message.metadata->>'sales_contract_version_id' IS DISTINCT FROM v_version.id::text THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_NOT_COMMERCIALLY_FINALIZED';
  END IF;

  v_evidence := pg_catalog.jsonb_build_object(
    'message_id', v_message.id,
    'external_message_id', v_message.external_message_id,
    'provider_accepted_at', v_message.outbound_provider_accepted_at,
    'commercial_finalized_at', v_message.outbound_commercial_finalized_at
  );

  UPDATE public.p9_sales_contract_send_barriers b
  SET released_at = pg_catalog.clock_timestamp(),
      release_reason = 'finalized',
      release_evidence = v_evidence
  WHERE b.id = v_locked.id AND b.released_at IS NULL
  RETURNING b.* INTO v_locked;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_UPDATE_LOST'; END IF;
  RETURN v_locked.id;
END;
$function$;

-- CREATE OR REPLACE preserves ownership and pre-existing grants.
-- Reaffirm that the internal authority cannot be called by the API roles.
REVOKE ALL ON FUNCTION
  public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $postconditions$
DECLARE
  v_release oid := pg_catalog.to_regprocedure(
    'public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)'
  );
  v_body text;
  v_contract integer;
  v_version integer;
  v_opportunity integer;
BEGIN
  IF v_release IS NULL THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_FUNCTION_MISSING';
  END IF;
  v_body := pg_catalog.pg_get_functiondef(v_release);
  v_contract := strpos(v_body, 'SELECT c.* INTO v_contract');
  v_version := strpos(v_body, 'SELECT v.* INTO v_version');
  v_opportunity := strpos(v_body, 'SELECT o.* INTO v_opportunity');
  IF v_contract = 0 OR v_version = 0 OR v_opportunity = 0
     OR NOT (v_contract < v_version AND v_version < v_opportunity) THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_POSTCONDITION_FAILED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_release AND p.prosecdef AND p.proowner = 'postgres'::regrole
  ) OR pg_catalog.has_function_privilege('anon', v_release, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_release, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_release, 'EXECUTE') THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_SECURITY_POSTCONDITION_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) THEN
    RAISE EXCEPTION 'P9_RELEASE_LOCK_ORDER_UNEXPECTED_BARRIER_ROWS';
  END IF;
END;
$postconditions$;

COMMIT;

SELECT 'PASS' AS resultado,
       'LIBERACAO_LOCK_ORDER_ALINHADA' AS correcao,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)'::regprocedure
       )) AS hash_funcao,
       'NAO_HABILITADO' AS envio_externo;
