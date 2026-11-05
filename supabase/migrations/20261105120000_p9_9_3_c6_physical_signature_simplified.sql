BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF to_regclass('public.sales_contracts') IS NULL
     OR to_regclass('public.sales_contract_versions') IS NULL
     OR to_regclass('public.commercial_opportunities') IS NULL
     OR to_regclass('public.stores') IS NULL
     OR to_regclass('public.memberships') IS NULL
     OR to_regclass('public.store_assistant_notification_queue') IS NULL
     OR to_regprocedure('public.assistant_enqueue_internal_notification(uuid,uuid,text,text,text,text,jsonb,uuid,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42883', MESSAGE='P9_C6_CANONICAL_CONTRACT_OR_ASSISTANT_AUTHORITY_MISSING';
  END IF;
  -- ZION stores the contract-to-opportunity link in sales_contracts.metadata,
  -- not in a physical sales_contracts.commercial_opportunity_id column.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'sales_contracts'
      AND c.column_name = 'metadata' AND c.data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42703', MESSAGE='P9_C6_CONTRACT_METADATA_AUTHORITY_MISSING';
  END IF;
  -- ZION: only active organization memberships can act within a store
  -- whose organization_id matches that membership.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'memberships'
      AND c.column_name = 'is_active' AND c.data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42703', MESSAGE='P9_C6_ACTIVE_MEMBERSHIP_AUTHORITY_MISSING';
  END IF;
END;
$preflight$;

-- P9.9.3-C.6: declaration of physical-signature preference only.
-- This is intentionally separate from C.5 and never creates an electronic signature.
CREATE TABLE IF NOT EXISTS public.p9_physical_contract_signature_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  commercial_opportunity_id uuid NULL,
  sales_contract_id uuid NOT NULL,
  sales_contract_version_id uuid NOT NULL,
  source_message_id uuid NULL,
  preference text NOT NULL DEFAULT 'physical' CHECK (preference = 'physical'),
  planned_date date NULL,
  planned_time time without time zone NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  operation_key text NOT NULL,
  confirmed_by_user_id uuid NULL,
  confirmed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, store_id, sales_contract_id, sales_contract_version_id),
  UNIQUE (organization_id, store_id, operation_key)
);

CREATE TABLE IF NOT EXISTS public.p9_physical_contract_signature_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  preference_id uuid NOT NULL REFERENCES public.p9_physical_contract_signature_preferences(id) ON DELETE RESTRICT,
  sales_contract_id uuid NOT NULL,
  sales_contract_version_id uuid NOT NULL,
  event_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('preference_recorded','preference_changed','confirmed','not_signed','cancelled')),
  actor_type text NOT NULL CHECK (actor_type IN ('customer_signal','human')),
  actor_user_id uuid NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, store_id, event_key)
);

CREATE INDEX IF NOT EXISTS p9_physical_signature_pending_date_idx
  ON public.p9_physical_contract_signature_preferences (organization_id, store_id, planned_date, status)
  WHERE status = 'pending';

ALTER TABLE public.p9_physical_contract_signature_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p9_physical_contract_signature_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.p9_physical_contract_signature_preferences, public.p9_physical_contract_signature_events FROM PUBLIC, anon, authenticated;
-- The morning report reads preferences with service_role. All changes are
-- performed through the SECURITY DEFINER RPCs, never through direct DML.
REVOKE ALL ON TABLE public.p9_physical_contract_signature_preferences, public.p9_physical_contract_signature_events FROM service_role;
GRANT SELECT ON TABLE public.p9_physical_contract_signature_preferences, public.p9_physical_contract_signature_events TO service_role;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p9_physical_signature_preferences_contract_scope_fkey') THEN
    ALTER TABLE public.p9_physical_contract_signature_preferences
      ADD CONSTRAINT p9_physical_signature_preferences_contract_scope_fkey
      FOREIGN KEY (sales_contract_id, organization_id, store_id)
      REFERENCES public.sales_contracts (id, organization_id, store_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p9_physical_signature_preferences_version_scope_fkey') THEN
    ALTER TABLE public.p9_physical_contract_signature_preferences
      ADD CONSTRAINT p9_physical_signature_preferences_version_scope_fkey
      FOREIGN KEY (sales_contract_version_id, sales_contract_id, organization_id, store_id)
      REFERENCES public.sales_contract_versions (id, contract_id, organization_id, store_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p9_physical_signature_preferences_opportunity_scope_fkey') THEN
    ALTER TABLE public.p9_physical_contract_signature_preferences
      ADD CONSTRAINT p9_physical_signature_preferences_opportunity_scope_fkey
      FOREIGN KEY (commercial_opportunity_id, organization_id, store_id)
      REFERENCES public.commercial_opportunities (id, organization_id, store_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p9_physical_signature_events_preference_fkey') THEN
    ALTER TABLE public.p9_physical_contract_signature_events
      ADD CONSTRAINT p9_physical_signature_events_preference_fkey
      FOREIGN KEY (preference_id)
      REFERENCES public.p9_physical_contract_signature_preferences (id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p9_physical_signature_events_contract_scope_fkey') THEN
    ALTER TABLE public.p9_physical_contract_signature_events
      ADD CONSTRAINT p9_physical_signature_events_contract_scope_fkey
      FOREIGN KEY (sales_contract_id, organization_id, store_id)
      REFERENCES public.sales_contracts (id, organization_id, store_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p9_physical_signature_events_version_scope_fkey') THEN
    ALTER TABLE public.p9_physical_contract_signature_events
      ADD CONSTRAINT p9_physical_signature_events_version_scope_fkey
      FOREIGN KEY (sales_contract_version_id, sales_contract_id, organization_id, store_id)
      REFERENCES public.sales_contract_versions (id, contract_id, organization_id, store_id)
      ON DELETE RESTRICT;
  END IF;
END;
$constraints$;

CREATE OR REPLACE FUNCTION public.record_physical_contract_signature_preference_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_contract_id uuid,
  p_sales_contract_version_id uuid,
  p_source_message_id uuid,
  p_planned_date date,
  p_planned_time time without time zone,
  p_operation_key text
)
RETURNS TABLE (outcome text, preference_id uuid, notification_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','pg_temp' SET row_security = off
AS $function$
DECLARE
  v_contract public.sales_contracts;
  v_version public.sales_contract_versions;
  v_row public.p9_physical_contract_signature_preferences;
  v_notification_id uuid;
  v_contract_opportunity_text text;
  v_contract_opportunity_id uuid;
  v_event_key text := 'p9-physical-signature:' || p_organization_id || ':' || p_store_id || ':' || p_sales_contract_id || ':' || p_sales_contract_version_id || ':' || coalesce(p_source_message_id::text,'none');
  v_event_type text;
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_sales_contract_id IS NULL OR p_sales_contract_version_id IS NULL OR nullif(btrim(p_operation_key),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_C6_MISSING_IDENTITY';
  END IF;
  SELECT * INTO v_contract FROM public.sales_contracts c WHERE c.id=p_sales_contract_id AND c.organization_id=p_organization_id AND c.store_id=p_store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_CONTRACT_SCOPE_MISMATCH'; END IF;
  SELECT * INTO v_version FROM public.sales_contract_versions v WHERE v.id=p_sales_contract_version_id AND v.contract_id=p_sales_contract_id AND v.organization_id=p_organization_id AND v.store_id=p_store_id FOR UPDATE;
  IF NOT FOUND OR v_contract.current_version_id IS DISTINCT FROM p_sales_contract_version_id THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_VERSION_NOT_CURRENT'; END IF;
  IF v_contract.status IN ('cancelled','expired','failed','completed') OR v_version.status IN ('superseded','failed','completed') THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_CONTRACT_NOT_PENDING'; END IF;
  -- The canonical opportunity association is stored in contract metadata.
  -- Never trust a caller-provided opportunity ID if it contradicts this link.
  v_contract_opportunity_text := nullif(btrim(v_contract.metadata->>'commercial_opportunity_id'), '');
  IF v_contract_opportunity_text IS NULL OR v_contract_opportunity_text !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_CONTRACT_OPPORTUNITY_NOT_RESOLVED';
  END IF;
  v_contract_opportunity_id := v_contract_opportunity_text::uuid;
  IF p_commercial_opportunity_id IS NOT NULL
     AND p_commercial_opportunity_id IS DISTINCT FROM v_contract_opportunity_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_OPPORTUNITY_SCOPE_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commercial_opportunities o
    WHERE o.id = v_contract_opportunity_id
      AND o.organization_id = p_organization_id
      AND o.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_CONTRACT_OPPORTUNITY_SCOPE_MISMATCH';
  END IF;
  SELECT * INTO v_row
  FROM public.p9_physical_contract_signature_preferences p
  WHERE p.organization_id=p_organization_id
    AND p.store_id=p_store_id
    AND p.sales_contract_id=p_sales_contract_id
    AND p.sales_contract_version_id=p_sales_contract_version_id
  FOR UPDATE;
  -- Exact operation replays must not rewrite the pending date or enqueue
  -- the same notification again. A genuinely new operation may reschedule.
  IF FOUND AND (v_row.status = 'confirmed' OR v_row.operation_key = p_operation_key) THEN
    RETURN QUERY SELECT 'replayed', v_row.id, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.p9_physical_contract_signature_preferences (organization_id,store_id,commercial_opportunity_id,sales_contract_id,sales_contract_version_id,source_message_id,planned_date,planned_time,operation_key)
  VALUES (p_organization_id,p_store_id,v_contract_opportunity_id,p_sales_contract_id,p_sales_contract_version_id,p_source_message_id,p_planned_date,p_planned_time,p_operation_key)
  ON CONFLICT (organization_id,store_id,sales_contract_id,sales_contract_version_id) DO UPDATE SET source_message_id=excluded.source_message_id, planned_date=excluded.planned_date, planned_time=excluded.planned_time, operation_key=excluded.operation_key, status='pending', updated_at=now()
  RETURNING * INTO v_row;
  v_event_type := CASE WHEN EXISTS (SELECT 1 FROM public.p9_physical_contract_signature_events e WHERE e.preference_id=v_row.id) THEN 'preference_changed' ELSE 'preference_recorded' END;
  INSERT INTO public.p9_physical_contract_signature_events (organization_id,store_id,preference_id,sales_contract_id,sales_contract_version_id,event_key,event_type,actor_type,event_payload)
  VALUES (p_organization_id,p_store_id,v_row.id,p_sales_contract_id,p_sales_contract_version_id,v_event_key,v_event_type,'customer_signal',jsonb_build_object('source_message_id',p_source_message_id,'planned_date',p_planned_date,'planned_time',p_planned_time))
  ON CONFLICT (organization_id,store_id,event_key) DO NOTHING;
  SELECT public.assistant_enqueue_internal_notification(p_organization_id,p_store_id,'important_alert','Assinatura física pendente', 'Cliente informou preferência por assinatura física.' ,'high', jsonb_build_object('source','p9_physical_signature_c6','event_key',v_event_key,'reason','physical_contract_signature_pending','related_contract_id',p_sales_contract_id,'document_version_id',p_sales_contract_version_id,'commercial_opportunity_id',v_row.commercial_opportunity_id,'planned_date',p_planned_date,'planned_time',p_planned_time,'needs_human_action',true), v_contract.lead_id, v_contract.conversation_id, NULL, v_event_key) INTO v_notification_id;
  RETURN QUERY SELECT 'recorded',v_row.id,v_notification_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_physical_contract_signature_by_user(
  p_organization_id uuid,
  p_store_id uuid,
  p_preference_id uuid,
  p_sales_contract_id uuid,
  p_sales_contract_version_id uuid,
  p_actor_user_id uuid,
  p_confirmation text
)
RETURNS TABLE (outcome text, preference_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','pg_temp' SET row_security = off
AS $function$
DECLARE
  v_row public.p9_physical_contract_signature_preferences;
  v_contract public.sales_contracts;
  v_version public.sales_contract_versions;
  v_confirmation text := lower(btrim(coalesce(p_confirmation, '')));
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_preference_id IS NULL OR p_sales_contract_id IS NULL
     OR p_sales_contract_version_id IS NULL OR p_actor_user_id IS NULL
     OR v_confirmation NOT IN ('sim', 'não', 'nao') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_C6_INVALID_HUMAN_CONFIRMATION';
  END IF;

  -- Existing ZION store authorization: an active member of the organization
  -- that owns this store. No new role or store_id column is invented.
  -- Only service_role can invoke this RPC; the server must resolve the
  -- authentic actor identity rather than accepting a client-supplied UUID.
  IF NOT EXISTS (
    SELECT 1
    FROM public.stores s
    JOIN public.memberships m ON m.organization_id = s.organization_id
    WHERE s.id = p_store_id AND s.organization_id = p_organization_id
      AND m.user_id = p_actor_user_id AND m.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='P9_C6_ACTOR_NOT_AUTHORIZED_FOR_STORE';
  END IF;

  -- Keep lock order consistent with preference recording: contract, then
  -- version, then pending preference.
  SELECT * INTO v_contract
  FROM public.sales_contracts c
  WHERE c.id = p_sales_contract_id AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_CONTRACT_SCOPE_MISMATCH';
  END IF;

  SELECT * INTO v_version
  FROM public.sales_contract_versions v
  WHERE v.id = p_sales_contract_version_id
    AND v.contract_id = p_sales_contract_id
    AND v.organization_id = p_organization_id AND v.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_VERSION_SCOPE_MISMATCH';
  END IF;

  SELECT * INTO v_row
  FROM public.p9_physical_contract_signature_preferences p
  WHERE p.id = p_preference_id AND p.organization_id = p_organization_id
    AND p.store_id = p_store_id AND p.sales_contract_id = p_sales_contract_id
    AND p.sales_contract_version_id = p_sales_contract_version_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_PREFERENCE_SCOPE_MISMATCH';
  END IF;

  -- A confirmed signature cannot be undone by a negative answer. An exact
  -- positive replay is harmless but must retain the original human actor.
  IF v_row.status = 'confirmed' THEN
    IF v_confirmation = 'sim' THEN
      RETURN QUERY SELECT 'replayed', v_row.id;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_ALREADY_CONFIRMED';
  END IF;
  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_ALREADY_CANCELLED';
  END IF;
  IF v_contract.current_version_id IS DISTINCT FROM p_sales_contract_version_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_VERSION_NOT_CURRENT';
  END IF;
  IF v_contract.status IN ('cancelled', 'expired', 'failed', 'completed')
     OR v_version.status IN ('superseded', 'failed', 'completed') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_CONTRACT_NOT_PENDING';
  END IF;

  IF v_confirmation IN ('não', 'nao') THEN
    -- Record the factual negative human answer; keep the signature pending.
    INSERT INTO public.p9_physical_contract_signature_events
      (organization_id, store_id, preference_id, sales_contract_id,
       sales_contract_version_id, event_key, event_type, actor_type,
       actor_user_id, event_payload)
    VALUES
      (p_organization_id, p_store_id, v_row.id, p_sales_contract_id,
       p_sales_contract_version_id,
       'p9-physical-signature-not-signed:' || v_row.id,
       'not_signed', 'human', p_actor_user_id,
       jsonb_build_object('confirmation', 'nao'))
    ON CONFLICT (organization_id, store_id, event_key) DO NOTHING;
    RETURN QUERY SELECT 'still_pending', v_row.id;
    RETURN;
  END IF;

  UPDATE public.p9_physical_contract_signature_preferences
  SET status = 'confirmed', confirmed_by_user_id = p_actor_user_id,
      confirmed_at = now(), updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.p9_physical_contract_signature_events
    (organization_id, store_id, preference_id, sales_contract_id,
     sales_contract_version_id, event_key, event_type, actor_type,
     actor_user_id, event_payload)
  VALUES
    (p_organization_id, p_store_id, v_row.id, p_sales_contract_id,
     p_sales_contract_version_id,
     'p9-physical-signature-confirmed:' || v_row.id,
     'confirmed', 'human', p_actor_user_id,
     jsonb_build_object('confirmation', 'sim'))
  ON CONFLICT (organization_id, store_id, event_key) DO NOTHING;

  RETURN QUERY SELECT 'confirmed', v_row.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_physical_contract_signature_by_user(
  p_organization_id uuid,
  p_store_id uuid,
  p_preference_id uuid,
  p_sales_contract_id uuid,
  p_sales_contract_version_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
RETURNS TABLE (outcome text, preference_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','pg_temp' SET row_security = off
AS $function$
DECLARE
  v_row public.p9_physical_contract_signature_preferences;
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR p_preference_id IS NULL OR p_sales_contract_id IS NULL
     OR p_sales_contract_version_id IS NULL OR p_actor_user_id IS NULL
     OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='P9_C6_INVALID_HUMAN_CANCELLATION';
  END IF;

  -- Same canonical active membership + store/organization authorization.
  IF NOT EXISTS (
    SELECT 1
    FROM public.stores s
    JOIN public.memberships m ON m.organization_id = s.organization_id
    WHERE s.id = p_store_id AND s.organization_id = p_organization_id
      AND m.user_id = p_actor_user_id AND m.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='P9_C6_ACTOR_NOT_AUTHORIZED_FOR_STORE';
  END IF;

  -- Cancellation can clear an obsolete pending version, including after a
  -- reschedule. It never changes a contract or a digitally-signed version.
  SELECT * INTO v_row
  FROM public.p9_physical_contract_signature_preferences p
  WHERE p.id = p_preference_id AND p.organization_id = p_organization_id
    AND p.store_id = p_store_id AND p.sales_contract_id = p_sales_contract_id
    AND p.sales_contract_version_id = p_sales_contract_version_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_PREFERENCE_SCOPE_MISMATCH';
  END IF;
  IF v_row.status = 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P9_C6_ALREADY_CONFIRMED';
  END IF;
  IF v_row.status = 'cancelled' THEN
    RETURN QUERY SELECT 'replayed', v_row.id;
    RETURN;
  END IF;

  UPDATE public.p9_physical_contract_signature_preferences
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.p9_physical_contract_signature_events
    (organization_id, store_id, preference_id, sales_contract_id,
     sales_contract_version_id, event_key, event_type, actor_type,
     actor_user_id, event_payload)
  VALUES
    (p_organization_id, p_store_id, v_row.id, p_sales_contract_id,
     p_sales_contract_version_id,
     'p9-physical-signature-cancelled:' || v_row.id,
     'cancelled', 'human', p_actor_user_id,
     jsonb_build_object('reason', btrim(p_reason)))
  ON CONFLICT (organization_id, store_id, event_key) DO NOTHING;

  RETURN QUERY SELECT 'cancelled', v_row.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_physical_contract_signature_preference_by_system(uuid,uuid,uuid,uuid,uuid,uuid,date,time,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_physical_contract_signature_preference_by_system(uuid,uuid,uuid,uuid,uuid,uuid,date,time,text) TO service_role;
REVOKE ALL ON FUNCTION public.confirm_physical_contract_signature_by_user(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_physical_contract_signature_by_user(uuid,uuid,uuid,uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_physical_contract_signature_by_user(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_physical_contract_signature_by_user(uuid,uuid,uuid,uuid,uuid,uuid,text) TO service_role;
COMMIT;
