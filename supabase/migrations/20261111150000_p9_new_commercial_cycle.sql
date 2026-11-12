-- ZION | P9 | Novo ciclo comercial explicito por lead existente.
-- Nao e chamado pelo inbound: exige operacao humana autenticada e conversa
-- anterior terminal. Contratos, mensagens e barreiras antigas nao sao tocados.

BEGIN;

CREATE TABLE public.p9_commercial_cycle_operations (
  operation_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  previous_conversation_id uuid NOT NULL,
  previous_opportunity_id uuid NOT NULL,
  new_conversation_id uuid NOT NULL,
  new_opportunity_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  reason text NOT NULL,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p9_commercial_cycle_operations_reason_not_blank
    CHECK (length(btrim(reason)) > 0),
  CONSTRAINT p9_commercial_cycle_operations_fingerprint_format
    CHECK (payload_fingerprint ~ '^[0-9a-f]{32}$')
);

ALTER TABLE public.p9_commercial_cycle_operations OWNER TO postgres;
REVOKE ALL ON TABLE public.p9_commercial_cycle_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.p9_commercial_cycle_operations TO service_role;

CREATE OR REPLACE FUNCTION public.start_new_commercial_cycle_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_previous_conversation_id uuid,
  p_previous_opportunity_id uuid,
  p_operation_id uuid,
  p_reason text
)
RETURNS TABLE (
  operation_id uuid,
  lead_id uuid,
  previous_conversation_id uuid,
  previous_opportunity_id uuid,
  new_conversation_id uuid,
  new_opportunity_id uuid,
  lifecycle_cycle integer,
  replayed boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_fingerprint text;
  v_existing public.p9_commercial_cycle_operations;
  v_lead public.leads;
  v_previous_conversation public.conversations;
  v_previous_opportunity public.commercial_opportunities;
  v_customer_id uuid;
  v_lead_customer_link_id uuid;
  v_customer_count bigint;
  v_active_conversation_count bigint;
  v_new_conversation_id uuid;
  v_new_session_id uuid;
  v_new_opportunity_id uuid;
  v_new_link_id uuid;
  v_created_at timestamptz;
BEGIN
  IF v_user_id IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = 'P9_NEW_CYCLE_NOT_AUTHORIZED';
  END IF;

  IF p_request_organization_id IS NULL OR p_store_id IS NULL
     OR p_lead_id IS NULL OR p_previous_conversation_id IS NULL
     OR p_previous_opportunity_id IS NULL OR p_operation_id IS NULL
     OR v_reason IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023',
      message = 'P9_NEW_CYCLE_INPUT_INVALID';
  END IF;

  v_fingerprint := md5(
    p_request_organization_id::text || ':' || p_store_id::text || ':' ||
    p_lead_id::text || ':' || p_previous_conversation_id::text || ':' ||
    p_previous_opportunity_id::text || ':' || v_reason
  );

  SELECT * INTO v_existing
  FROM public.p9_commercial_cycle_operations
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.organization_id IS DISTINCT FROM p_request_organization_id
       OR v_existing.store_id IS DISTINCT FROM p_store_id
       OR v_existing.lead_id IS DISTINCT FROM p_lead_id
       OR v_existing.previous_conversation_id IS DISTINCT FROM p_previous_conversation_id
       OR v_existing.previous_opportunity_id IS DISTINCT FROM p_previous_opportunity_id
       OR v_existing.actor_user_id IS DISTINCT FROM v_user_id
       OR v_existing.payload_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING errcode = '23505',
        message = 'P9_NEW_CYCLE_OPERATION_REPLAY_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.operation_id, v_existing.lead_id,
      v_existing.previous_conversation_id, v_existing.previous_opportunity_id,
      v_existing.new_conversation_id, v_existing.new_opportunity_id,
      1, true, v_existing.created_at;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:new-commercial-cycle:v1:' ||
      p_request_organization_id::text || ':' || p_store_id::text || ':' ||
      p_lead_id::text,
      0
    )
  );

  -- Recheck after the per-lead lock so two simultaneous calls with the same
  -- operation_id cannot both pass the initial read before either commits.
  SELECT * INTO v_existing
  FROM public.p9_commercial_cycle_operations
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.organization_id IS DISTINCT FROM p_request_organization_id
       OR v_existing.store_id IS DISTINCT FROM p_store_id
       OR v_existing.lead_id IS DISTINCT FROM p_lead_id
       OR v_existing.previous_conversation_id IS DISTINCT FROM p_previous_conversation_id
       OR v_existing.previous_opportunity_id IS DISTINCT FROM p_previous_opportunity_id
       OR v_existing.actor_user_id IS DISTINCT FROM v_user_id
       OR v_existing.payload_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING errcode = '23505',
        message = 'P9_NEW_CYCLE_OPERATION_REPLAY_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.operation_id, v_existing.lead_id,
      v_existing.previous_conversation_id, v_existing.previous_opportunity_id,
      v_existing.new_conversation_id, v_existing.new_opportunity_id,
      1, true, v_existing.created_at;
    RETURN;
  END IF;

  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id
    AND organization_id = p_request_organization_id
    AND store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR nullif(btrim(coalesce(v_lead.phone, '')), '') IS NULL THEN
    RAISE EXCEPTION USING errcode = '23514',
      message = 'P9_NEW_CYCLE_LEAD_SCOPE_OR_IDENTITY_INVALID';
  END IF;

  SELECT * INTO v_previous_conversation
  FROM public.conversations
  WHERE id = p_previous_conversation_id
    AND organization_id = p_request_organization_id
    AND lead_id = p_lead_id
    AND status IN ('closed', 'resolved')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P9_NEW_CYCLE_PREVIOUS_CONVERSATION_NOT_TERMINAL';
  END IF;

  SELECT * INTO v_previous_opportunity
  FROM public.commercial_opportunities
  WHERE id = p_previous_opportunity_id
    AND organization_id = p_request_organization_id
    AND store_id = p_store_id
    AND origin_lead_id = p_lead_id
    AND primary_conversation_id = p_previous_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P9_NEW_CYCLE_PREVIOUS_OPPORTUNITY_SCOPE_INVALID';
  END IF;

  SELECT count(*) INTO v_active_conversation_count
  FROM public.conversations
  WHERE organization_id = p_request_organization_id
    AND lead_id = p_lead_id
    AND status NOT IN ('closed', 'resolved');
  IF v_active_conversation_count <> 0 THEN
    RAISE EXCEPTION USING errcode = 'P9_NEW_CYCLE_ACTIVE_CONVERSATION_EXISTS';
  END IF;

  SELECT count(*), min(link.id::text)::uuid, min(link.customer_id::text)::uuid
  INTO v_customer_count, v_lead_customer_link_id, v_customer_id
  FROM public.lead_customer_links link
  WHERE link.organization_id = p_request_organization_id
    AND link.store_id = p_store_id
    AND link.lead_id = p_lead_id
    AND link.status = 'active'
    AND link.unlinked_at IS NULL;
  IF v_customer_count <> 1 OR v_customer_id IS NULL OR v_lead_customer_link_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '23514',
      message = 'P9_NEW_CYCLE_LEAD_CUSTOMER_IDENTITY_AMBIGUOUS';
  END IF;

  v_new_conversation_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:new-commercial-cycle:conversation:v1:' || p_operation_id::text
  );
  v_new_session_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:new-commercial-cycle:session:v1:' || p_operation_id::text
  );
  v_new_opportunity_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:new-commercial-cycle:opportunity:v1:' || p_operation_id::text
  );
  v_new_link_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:new-commercial-cycle:context-link:v1:' || p_operation_id::text
  );

  INSERT INTO public.conversations (id, organization_id, lead_id, status)
  VALUES (v_new_conversation_id, p_request_organization_id, p_lead_id, 'active');

  INSERT INTO public.conversation_sessions (
    id, organization_id, store_id, conversation_id, status
  ) VALUES (
    v_new_session_id, p_request_organization_id, p_store_id,
    v_new_conversation_id, 'active'
  );

  INSERT INTO public.commercial_opportunities (
    id, organization_id, store_id, customer_id, origin_lead_id,
    primary_conversation_id, stage, lifecycle_cycle
  ) VALUES (
    v_new_opportunity_id, p_request_organization_id, p_store_id, v_customer_id,
    p_lead_id, v_new_conversation_id, 'novo_lead', 1
  );

  INSERT INTO public.commercial_session_context_links (
    id, organization_id, store_id, conversation_session_id, customer_id,
    commercial_opportunity_id, lead_customer_link_id, replaces_link_id,
    status, source, source_reference, idempotency_key, correlation_id,
    lifecycle_cycle, linked_by_actor_type, linked_by_user_id, metadata
  ) VALUES (
    v_new_link_id, p_request_organization_id, p_store_id, v_new_session_id,
    v_customer_id, v_new_opportunity_id, v_lead_customer_link_id, NULL,
    'active', 'manual', 'p9_new_commercial_cycle',
    'p9_new_commercial_cycle:' || p_operation_id::text, p_operation_id,
    1, 'human', v_user_id,
    jsonb_build_object(
      'writer', 'start_new_commercial_cycle_by_user',
      'operation_id', p_operation_id,
      'previous_conversation_id', p_previous_conversation_id,
      'previous_opportunity_id', p_previous_opportunity_id,
      'reason', v_reason
    )
  );

  v_created_at := clock_timestamp();
  INSERT INTO public.p9_commercial_cycle_operations (
    operation_id, organization_id, store_id, lead_id,
    previous_conversation_id, previous_opportunity_id,
    new_conversation_id, new_opportunity_id, actor_user_id,
    reason, payload_fingerprint, created_at
  ) VALUES (
    p_operation_id, p_request_organization_id, p_store_id, p_lead_id,
    p_previous_conversation_id, p_previous_opportunity_id,
    v_new_conversation_id, v_new_opportunity_id, v_user_id,
    v_reason, v_fingerprint, v_created_at
  );

  RETURN QUERY SELECT p_operation_id, p_lead_id,
    p_previous_conversation_id, p_previous_opportunity_id,
    v_new_conversation_id, v_new_opportunity_id, 1, false, v_created_at;
END;
$function$;

ALTER FUNCTION public.start_new_commercial_cycle_by_user(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.start_new_commercial_cycle_by_user(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_new_commercial_cycle_by_user(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) TO authenticated;

COMMENT ON FUNCTION public.start_new_commercial_cycle_by_user(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) IS
  'P9: inicia explicitamente um ciclo novo para o mesmo lead apos conversa terminal, sem herdar contratos, versoes, mensagens ou barreiras.';

COMMIT;
