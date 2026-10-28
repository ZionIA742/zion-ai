-- ZION / Pilar 9 / Bloco 9 / 9.3-B
-- Forward-only: internal release of a contract-send barrier after provider acceptance
-- AND durable commercial finalization. No access for anon/authenticated/service_role.
-- Does not support releasing uncertain messages or asserting no-delivery.
-- IMPORTANT: this is infrastructure only; it does not install sender RPCs or enqueue messages.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_guard oid := pg_catalog.to_regprocedure('public.p9_guard_sales_contract_send_barrier_immutability()');
  v_activation oid := pg_catalog.to_regprocedure('public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)');
  v_barrier_rel oid := pg_catalog.to_regclass('public.p9_sales_contract_send_barriers');
BEGIN
  IF v_guard IS NULL
     OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard))
          IS DISTINCT FROM 'be24c7549637541ad6d221a0e7561af8' THEN
    RAISE EXCEPTION 'P9_RELEASE_EXISTING_IMMUTABILITY_GUARD_CHANGED';
  END IF;
  IF v_activation IS NULL
     OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_activation))
          IS DISTINCT FROM '2073747dafe87cc4499cf6a6a0ad3dc5' THEN
    RAISE EXCEPTION 'P9_RELEASE_ACTIVATION_AUTHORITY_CHANGED';
  END IF;
  IF pg_catalog.to_regprocedure('public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'P9_RELEASE_AUTHORITY_ALREADY_EXISTS';
  END IF;
  IF v_barrier_rel IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
       WHERE c.oid = v_barrier_rel AND c.relrowsecurity AND c.relforcerowsecurity
     ) THEN
    RAISE EXCEPTION 'P9_RELEASE_BARRIER_RLS_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = v_barrier_rel AND t.tgfoid = v_guard
      AND t.tgname = 'p9_contract_send_barrier_immutability_guard'
      AND t.tgenabled = 'O' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'P9_RELEASE_IMMUTABILITY_TRIGGER_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) THEN
    RAISE EXCEPTION 'P9_RELEASE_EXISTING_BARRIERS_REQUIRE_REVIEW';
  END IF;
  IF pg_catalog.to_regprocedure('public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'P9_RELEASE_DOMAIN_LOCK_MISSING';
  END IF;
END;
$preflight$;

-- Strict append-only release: no DELETE and no modification except the three
-- release fields. Only finalized and provider-accepted outbound can release.
-- The underlying table remains inaccessible for direct UPDATE by API roles.
CREATE OR REPLACE FUNCTION public.p9_guard_sales_contract_send_barrier_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
  v_message public.messages%ROWTYPE;
  v_evidence jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='P9_9_3_CONTRACT_SEND_BARRIER_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='P9_CONTRACT_SEND_BARRIER_OPERATION_FORBIDDEN';
  END IF;
  IF OLD.released_at IS NOT NULL
     OR OLD.release_reason IS NOT NULL
     OR OLD.release_evidence IS NOT NULL
     OR NEW.released_at IS NULL
     OR NEW.released_at < OLD.activated_at
     OR NEW.release_reason IS DISTINCT FROM 'finalized'
     OR pg_catalog.jsonb_typeof(NEW.release_evidence) IS DISTINCT FROM 'object'
     OR (
       pg_catalog.to_jsonb(NEW) - 'released_at' - 'release_reason' - 'release_evidence'
     ) IS DISTINCT FROM (
       pg_catalog.to_jsonb(OLD) - 'released_at' - 'release_reason' - 'release_evidence'
     ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='P9_CONTRACT_SEND_BARRIER_IMMUTABLE_OR_INVALID_RELEASE';
  END IF;

  SELECT m.* INTO v_message
  FROM public.messages m
  WHERE m.id = OLD.message_id
    AND m.organization_id = OLD.organization_id
    AND m.store_id = OLD.store_id
    AND m.deleted_at IS NULL
    AND m.outbound_idempotency_key = OLD.outbound_idempotency_key;
  IF NOT FOUND
     OR v_message.outbound_delivery_state IS DISTINCT FROM 'sent'
     OR NULLIF(pg_catalog.btrim(COALESCE(v_message.external_message_id, '')), '') IS NULL
     OR v_message.outbound_provider_accepted_at IS NULL
     OR v_message.outbound_commercial_finalized_at IS NULL
     OR v_message.metadata->>'outbound_origin' IS DISTINCT FROM 'sales_contract_send'
     OR v_message.metadata->>'sales_contract_id' IS DISTINCT FROM OLD.sales_contract_id::text
     OR v_message.metadata->>'sales_contract_version_id' IS DISTINCT FROM OLD.sales_contract_version_id::text THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='P9_CONTRACT_SEND_BARRIER_PROVIDER_AND_FINALIZATION_EVIDENCE_REQUIRED';
  END IF;

  v_evidence := pg_catalog.jsonb_build_object(
    'message_id', v_message.id,
    'external_message_id', v_message.external_message_id,
    'provider_accepted_at', v_message.outbound_provider_accepted_at,
    'commercial_finalized_at', v_message.outbound_commercial_finalized_at
  );
  IF NEW.release_evidence IS DISTINCT FROM v_evidence THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='P9_CONTRACT_SEND_BARRIER_RELEASE_EVIDENCE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.p9_guard_sales_contract_send_barrier_immutability() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p9_guard_sales_contract_send_barrier_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

-- Called only inside a future postgres-owned SECURITY DEFINER finalizer,
-- after its commercial updates and the durable message finalization marker.
-- The function itself is NOT executable by service_role directly.
CREATE FUNCTION public.p9_release_sales_contract_send_barrier_finalized_internal(
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

  -- Global row-lock order: opportunity -> contract -> version -> message -> barrier.
  SELECT o.* INTO v_opportunity
  FROM public.commercial_opportunities o
  WHERE o.id = v_barrier.commercial_opportunity_id
    AND o.organization_id = p_organization_id AND o.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_RELEASE_OPPORTUNITY_NOT_FOUND'; END IF;

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

ALTER FUNCTION public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $postconditions$
DECLARE
  v_release oid := pg_catalog.to_regprocedure('public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)');
  v_guard oid := pg_catalog.to_regprocedure('public.p9_guard_sales_contract_send_barrier_immutability()');
  v_oid oid;
BEGIN
  IF v_release IS NULL OR v_guard IS NULL THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_POST_FUNCTION_MISSING';
  END IF;
  FOREACH v_oid IN ARRAY ARRAY[v_release,v_guard] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_oid AND p.prosecdef AND p.proowner = 'postgres'::regrole
    ) OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'P9_BARRIER_RELEASE_POST_SECURITY_INVALID';
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.p9_sales_contract_send_barriers'::regclass
      AND t.tgfoid = v_guard AND t.tgenabled = 'O'
      AND t.tgname = 'p9_contract_send_barrier_immutability_guard'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_POST_TRIGGER_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) THEN
    RAISE EXCEPTION 'P9_BARRIER_RELEASE_POST_UNEXPECTED_RECORD';
  END IF;
END;
$postconditions$;

COMMIT;

SELECT 'PASS' AS resultado,
       'LIBERACAO_FINALIZED_INSTALADA' AS correcao,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)'::regprocedure
       )) AS hash_release,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'public.p9_guard_sales_contract_send_barrier_immutability()'::regprocedure
       )) AS hash_guard,
       'NAO_HABILITADO' AS envio_externo;
