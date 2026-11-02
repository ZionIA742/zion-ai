-- ZION | P9.9.15 | Compatibilidade manual sem quote + barreira por versao.
-- Substitui exclusivamente a ativacao. Nao altera as quatro autoridades auxiliares.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $preflight$
DECLARE
  v_fn oid := pg_catalog.to_regprocedure(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'
  );
BEGIN
  IF v_fn IS NULL OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_fn)) IS DISTINCT FROM
       '154a09230b6bf139fa702e5c62654ea1' THEN
    RAISE EXCEPTION 'P9_9_15_MANUAL_BARRIER_ACTIVATION_BASE_CHANGED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_fn AND p.prosecdef AND p.proowner='postgres'::pg_catalog.regrole
      AND NOT pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'P9_9_15_MANUAL_BARRIER_AUTHORITY_SECURITY_CHANGED';
  END IF;
  IF pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL OR
     pg_catalog.to_regclass('public.sales_contracts') IS NULL OR
     pg_catalog.to_regclass('public.sales_contract_versions') IS NULL OR
     pg_catalog.to_regclass('public.commercial_opportunities') IS NULL OR
     pg_catalog.to_regclass('public.messages') IS NULL OR
     pg_catalog.to_regprocedure('public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)') IS NULL OR
     pg_catalog.to_regprocedure('public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'P9_9_15_MANUAL_BARRIER_DEPENDENCY_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.p9_sales_contract_send_barriers'::regclass
      AND a.attname='contract_origin' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'P9_9_15_MANUAL_BARRIER_ORIGIN_COLUMN_MISSING';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.p9_activate_sales_contract_send_barrier_internal(p_organization_id uuid, p_store_id uuid, p_commercial_opportunity_id uuid, p_contract_id uuid, p_contract_version_id uuid, p_message_id uuid, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
 SET row_security TO 'off'
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
    v_lineage_opportunity_id uuid;
    v_origin text;
    v_barrier_id uuid;
BEGIN
    IF p_organization_id IS NULL OR p_store_id IS NULL
       OR p_commercial_opportunity_id IS NULL OR p_contract_id IS NULL
       OR p_contract_version_id IS NULL OR p_message_id IS NULL THEN
        RAISE EXCEPTION 'P9_BARRIER_ACTIVATION_SCOPE_REQUIRED';
    END IF;

    v_key := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
    v_expected_key := 'sales_contract_send:' || p_organization_id::text
        || ':' || p_store_id::text || ':' || p_contract_id::text
        || ':' || p_contract_version_id::text;
    IF v_key IS DISTINCT FROM v_expected_key THEN
        RAISE EXCEPTION 'P9_BARRIER_IDEMPOTENCY_KEY_INVALID';
    END IF;

    PERFORM public.p9_acquire_sales_contract_send_domain_lock(
        p_organization_id, p_store_id, p_commercial_opportunity_id
    );

    SELECT * INTO v_contract FROM public.sales_contracts
    WHERE id=p_contract_id AND organization_id=p_organization_id AND store_id=p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_CONTRACT_INVALID'; END IF;

    SELECT * INTO v_version FROM public.sales_contract_versions
    WHERE id=p_contract_version_id AND contract_id=p_contract_id
      AND organization_id=p_organization_id AND store_id=p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_VERSION_INVALID'; END IF;

    SELECT * INTO v_opportunity FROM public.commercial_opportunities
    WHERE id=p_commercial_opportunity_id AND organization_id=p_organization_id
      AND store_id=p_store_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_OPPORTUNITY_INVALID'; END IF;

    IF v_contract.metadata->>'created_via' = 'create_sales_contract_manual_by_system'
       OR v_contract.metadata->>'source' = 'responsible_text_draft' THEN
      v_origin := 'responsible_text_draft';
      IF v_contract.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
         OR v_contract.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
         OR v_contract.quote_id IS NOT NULL OR v_contract.quote_version_id IS NOT NULL
         OR v_contract.metadata->>'commercial_opportunity_id' IS DISTINCT FROM v_opportunity.id::text
         OR v_contract.metadata->>'customer_id' IS DISTINCT FROM v_opportunity.customer_id::text
         OR v_contract.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'P9_BARRIER_MANUAL_LINEAGE_INVALID';
      END IF;
    ELSE
      v_origin := 'accepted_quote_version_snapshot';
      SELECT * INTO v_quote FROM public.sales_quotes
      WHERE id=v_contract.quote_id AND organization_id=p_organization_id
        AND store_id=p_store_id AND commercial_opportunity_id=p_commercial_opportunity_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_QUOTE_SCOPE_INVALID'; END IF;
    END IF;

    SELECT * INTO v_message FROM public.messages
    WHERE id=p_message_id AND organization_id=p_organization_id AND store_id=p_store_id
      AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'P9_BARRIER_MESSAGE_INVALID'; END IF;

    IF v_contract.status IS DISTINCT FROM 'approved'
       OR v_version.status IS DISTINCT FROM 'approved'
       OR v_contract.current_version_id IS DISTINCT FROM v_version.id
       OR (v_origin='accepted_quote_version_snapshot' AND
           (v_opportunity.current_quote_id IS DISTINCT FROM v_contract.quote_id
            OR v_opportunity.current_quote_version_id IS DISTINCT FROM v_contract.quote_version_id)) THEN
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
       OR (v_origin='responsible_text_draft' AND v_message.metadata->>'contract_origin' IS DISTINCT FROM v_origin)
       OR v_message.metadata->>'file_kind' IS DISTINCT FROM 'sales_contract_pdf'
       OR v_message.metadata->>'storage_path' IS DISTINCT FROM v_version.storage_path THEN
      RAISE EXCEPTION 'P9_BARRIER_MESSAGE_SCOPE_OR_STATE_INVALID';
    END IF;

    SELECT lineage.guard_state, lineage.commercial_opportunity_id
      INTO v_guard_state, v_lineage_opportunity_id
    FROM public.p9_assert_sales_contract_current_proposal_lineage_internal(
      p_organization_id, p_store_id, p_contract_id
    ) AS lineage;
    IF NOT FOUND OR v_guard_state IS DISTINCT FROM 'current'
       OR v_lineage_opportunity_id IS DISTINCT FROM v_opportunity.id THEN
      RAISE EXCEPTION 'P9_BARRIER_CURRENT_PROPOSAL_REQUIRED';
    END IF;

    SELECT * INTO v_existing FROM public.p9_sales_contract_send_barriers b
    WHERE b.organization_id=p_organization_id AND b.store_id=p_store_id
      AND (b.outbound_idempotency_key=v_key OR b.message_id=p_message_id OR
           (b.sales_contract_id=p_contract_id AND b.sales_contract_version_id=p_contract_version_id) OR
           (b.commercial_opportunity_id=p_commercial_opportunity_id AND b.released_at IS NULL))
    ORDER BY b.activated_at, b.id LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      IF v_existing.outbound_idempotency_key=v_key
         AND v_existing.message_id=p_message_id
         AND v_existing.sales_contract_id=p_contract_id
         AND v_existing.sales_contract_version_id=p_contract_version_id
         AND v_existing.commercial_opportunity_id=p_commercial_opportunity_id
         AND v_existing.released_at IS NULL
         AND v_existing.contract_origin IS NOT DISTINCT FROM v_origin
         AND v_existing.sales_quote_id IS NOT DISTINCT FROM v_contract.quote_id
         AND v_existing.sales_quote_version_id IS NOT DISTINCT FROM v_contract.quote_version_id THEN
        RETURN v_existing.id;
      END IF;
      RAISE EXCEPTION 'P9_BARRIER_CONFLICT_OR_RELEASED_ATTEMPT';
    END IF;

    INSERT INTO public.p9_sales_contract_send_barriers
      (organization_id, store_id, sales_contract_id, sales_contract_version_id,
       sales_quote_id, sales_quote_version_id, contract_origin,
       commercial_opportunity_id, message_id, outbound_idempotency_key)
    VALUES
      (p_organization_id, p_store_id, v_contract.id, v_version.id,
       v_contract.quote_id, v_contract.quote_version_id, v_origin,
       v_opportunity.id, v_message.id, v_key)
    RETURNING id INTO v_barrier_id;

    IF v_barrier_id IS NULL THEN RAISE EXCEPTION 'P9_BARRIER_INSERT_FAILED'; END IF;
    RETURN v_barrier_id;
END;
$function$;

ALTER FUNCTION public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)
  OWNER TO postgres;

DO $postconditions$
DECLARE
  v_body text := pg_catalog.pg_get_functiondef(
    'public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure
  );
BEGIN
  IF pg_catalog.strpos(v_body, 'create_sales_contract_manual_by_system') = 0
     OR pg_catalog.strpos(v_body, 'P9_BARRIER_MANUAL_LINEAGE_INVALID') = 0
     OR v_body !~ 'b\.sales_contract_version_id\s*=\s*p_contract_version_id'
     OR pg_catalog.strpos(v_body, 'b.released_at IS NULL') = 0
     OR pg_catalog.strpos(v_body, 'P9_BARRIER_QUOTE_SCOPE_INVALID') = 0 THEN
    RAISE EXCEPTION 'P9_9_15_MANUAL_BARRIER_POSTCONDITION_FAILED';
  END IF;
END;
$postconditions$;

COMMIT;
